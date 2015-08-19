var AWS = require('aws-sdk');
var s3 = new AWS.S3();

var request = require('request'),
	fs = require('fs'),
	zlib = require('zlib'),
	config = require('./config'),
	sumData = '';

bucket = process.argv[2];
path = process.argv[3];

if(!bucket || !path) {
	console.log('no bucket or path specified!');
	process.exit(1);
}

var params = {
	Bucket: bucket,
	Prefix: path,
};

s3.listObjects(params, function(err, data) {
	if (err) console.log(err, err.stack);
	else {
		var i = 0;
		_next = function() {
			if(i < data.Contents.length) {
				if(data.Contents[i].Key != params.Prefix) {
					var getfile = {
						Bucket: bucket,
						Key: data.Contents[i].Key,
					};
					s3.getObject(getfile, function(err, data) {
						if(!err) {
							sumData += (sumData.length? '\n':'') + data.Body.toString().trim();
						}
						i++;
						_next();
					});
				}
			} else {
				sendToDb(sumData);
			}
		}
		_next();
	}
});

sendToDb = function(data) {
	zlib.gzip(data, function (_, result) {
		var req = request.post(config.data.apiDump, function (err, resp, body) {
			if (err) {
				console.log('error!');
				console.log(err);
				process.exit(1);
			} else {
				console.log(body);
				process.exit(0);
			}
		});

		var form = req.form();
		form.append('file', result, {
			filename: 'data.gz',
			contentType: 'application/x-gzip'
		});

	});
}