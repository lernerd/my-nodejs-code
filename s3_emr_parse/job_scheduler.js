var AWS = require('aws-sdk');
var s3 = new AWS.S3();
var AWSt = require('./aws_tools');
var bufStr = '';

// stamp message returned on console
stamp = function(str, buf) {
	if(buf == undefined) {
		d = new Date();
		str = '['+d.toDateString()+' - '+d.toLocaleTimeString()+'] '+ bufStr + str;
		console.log(str);
		bufStr = '';
	} else {
		bufStr += str;
	}
}

reInit = function() {
	stamp('looping process, waiting and then working again...');
	setTimeout(function(){checkLogFiles()}, 15 * 60 * 1000);	
}

checkLogFiles = function() {
	var config = require('./config');

	var params = {
		Bucket: config.data.bucketOrigin,
		Prefix: config.data.pathOrigin,
		//MaxKeys: 100,
	};
	stamp('checking for NEW logs in s3://'+params.Bucket+'/'+params.Prefix+'... ', true);

	s3.listObjects(params, function(err, data) {
		if (err) {
			console.log(err, err.stack);
			reInit();
		} else {
			logfiles = [];
			for(i=0 ; i < data.Contents.length ; i++)
				if(data.Contents[i].Key != params.Prefix)
					logfiles[logfiles.length] = data.Contents[i].Key;

			stamp((data.IsTruncated? 'at least ':'') + logfiles.length + ' NEW logfiles to parse');

			var i = 0;
			_next = function() {
				if(i < logfiles.length) {
					AWSt.s3.moveFiles(	's3://'+config.data.bucketOrigin+'/'+logfiles[i],
										's3://'+config.data.bucketDest+'/'+config.data.tmpDir+'/', function(err) {

						if(err) console.log(err);
						i++; _next();
					});
				} else {
					setUpCluster();
				}
			}
			if(logfiles.length) {
				stamp('moving files to tmp dir s3://'+config.data.bucketDest+'/'+config.data.tmpDir);
				_next();
			} else {
				setUpCluster();
			}

		}
	});
}

setUpCluster = function() {
	var config = require('./config');
	
	var params = {
		Bucket: config.data.bucketDest,
		Prefix: config.data.tmpDir+'/',
	};
	stamp('checking for stored logs... ', true);

	s3.listObjects(params, function(err, data) {
		if (err) {
			console.log(err, err.stack);
			reInit();
		} else {
			logfiles = [];
			for(i=0 ; i < data.Contents.length ; i++)
				if(data.Contents[i].Key != params.Prefix)
					logfiles[logfiles.length] = data.Contents[i].Key;

			stamp(logfiles.length + ' stored logfiles to parse');
		}

		if(logfiles.length) {
			if(config.emr && config.emr.clusterId) {
				parseLogFiles(config.emr.clusterId);
			} else {
				AWSt.emr.createCluster(function(err, clusterId) {
					if(err) {
						console.log(err);
						reInit();
					} else parseLogFiles(clusterId);
				});
			}
		} else {
			reInit();
		}
	});
}

parseLogFiles = function(clusterId) {
	stamp('adding parsing step to cluster '+clusterId);
	AWSt.emr.createStep(clusterId, function(err, stepId, runId) {
		if(err) {
			console.log(err);
			reInit();
		} else {
			checkStepStatus(clusterId, stepId, runId);
		}
	});
}

checkStepStatus = function(clusterId, stepId, runId) {
	var emr = new AWS.EMR({region: 'us-east-1'});
	var params = {
		ClusterId: clusterId,
		StepId: stepId,
	};

	emr.describeStep(params, function(err, data) {
		if (err) {
			console.log(err, err.stack);
			setTimeout(function(){checkStepStatus(clusterId, stepId, runId)}, 10 * 1000);
		} else {
			stamp('step status: '+data.Step.Status.State);
			if(data.Step.Status.State == 'RUNNING' || data.Step.Status.State == 'PENDING') {
				setTimeout(function(){checkStepStatus(clusterId, stepId, runId)}, 30 * 1000);
			} else {
				dbDump(runId);
			}
		}
	});
}

dbDump = function(runId) {
	var config = require('./config');
	var cp = require('child_process'),
		params = [config.data.bucketDest, config.data.pathDest+runId+'/'];

	stamp('dumping on db... ', true);
	stamp(params);
	handle = cp.fork('../scripts/dbdump.js', params, {stdio: 'pipe', silent: true});
		
	if(handle && handle.stdout && handle.stderr) {
		handle.stdout.on('data', function (data) {stamp(data.toString().trim());});		
		handle.stderr.on('data', function (data) {stamp(data.toString().trim());});
		handle.on('exit', function(code, signal) {
			if(code == 0) doCleanup();
			else {
				console.log(code);
				console.log(signal);
			}
		});
	}
}

doCleanup = function() {
	stamp('cleaning up temp files...');

	var config = require('./config');	
	var params = {
		Bucket: config.data.bucketDest,
		Prefix: config.data.tmpDir+'/',
	};

	s3.listObjects(params, function(err, data) {
		if (err) {
			console.log(err, err.stack);
			reInit();
		} else {
			var toDel = {
				Bucket: config.data.bucketDest,
				Delete: { Objects: [] }
			};

			for(i=0 ; i < data.Contents.length ; i++)
				if(data.Contents[i].Key != params.Prefix)
					toDel.Delete.Objects[toDel.Delete.Objects.length] = {'Key': data.Contents[i].Key};

			if(toDel.Delete.Objects.length)	{
				s3.deleteObjects(toDel, function(err, data) {
					if (err) console.log(err, err.stack);
					else stamp('done! ', true);
					reInit();
				});
			} else {
				reInit();
			}
		}
	});

}

checkLogFiles();
