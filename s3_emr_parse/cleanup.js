var maxLife = 48, // in hours,
	dirs = [
		'emrdebug',
		'parsedoutput',
	];

var AWS = require('aws-sdk');
var s3 = new AWS.S3();

var config = require('./config'),
	date = new Date();

var dir = 0;

purgeDir = function() {
	if(dir < dirs.length) {
		var	params = {
				Bucket: config.data.bucketDest,
				Prefix: dirs[dir]+'/',
		};
		console.log('purging dir '+dirs[dir]);

		s3.listObjects(params, function(err, data) {
			if (err) {
				console.log(err, err.stack);
				dir++; purgeDir();
			} else {
				var objs = [];

				for(i=0 ; i < data.Contents.length ; i++) {
					if(data.Contents[i].Key != params.Prefix) {
						hourdiff = Math.floor((date - data.Contents[i].LastModified) / 1000 / 60 / 60);				
						if(hourdiff > maxLife) {
							objs[objs.length] = {'Key': data.Contents[i].Key};
						}
					}
				}

				if(objs.length) {
					var toDel = {
						Bucket: config.data.bucketDest,
						Delete: { Objects: objs }
					};
					console.log(toDel.Delete.Objects.length+' objects to delete');

					s3.deleteObjects(toDel, function(err, data) {
						if (err) {
							console.log(err, err.stack);
							dir++; purgeDir();
						} else {
							console.log('deleted!');
							dir++; purgeDir();
						}
					});
				} else {
					console.log('no objects to delete');
					dir++; purgeDir();
				}
			}
		});
	} else {
		console.log('done!');
		process.exit(0);
	}
};

purgeDir();
