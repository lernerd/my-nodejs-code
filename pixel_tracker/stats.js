// modules
var http = require('http');
var url = require('url');
var fs = require('fs');
var redis = require('redis');
var Step = require('step');
var _ = require('underscore');

// config file
var config = require('./config/config');

// redis client connect
client = redis.createClient(config.redis.port, config.redis.host);
client.on("error", function (err) {
    console.log("Error " + err);
});

var htmlFile, htmlFile_total;
fs.readFile(__dirname+'/html/live.html', function(err,data) {
	htmlFile = data;
});
fs.readFile(__dirname+'/html/total.html', function(err,data) {
	htmlFile_total = data;
});

// http server
http.createServer(function (req, res) {
	var url_parts = url.parse(req.url, true);
	var query = url_parts.query;
	
	if(query['id']) {
		if(url.parse(req.url)['pathname'] == '/live.html') {
		  res.writeHead(200, {'Content-Type': 'text/html' });
		  res.end(htmlFile);
		} else if(url.parse(req.url)['pathname'] == '/total.html') {
		  res.writeHead(200, {'Content-Type': 'text/html' });
		  res.end(htmlFile_total);
		} else if(url.parse(req.url)['pathname'] == '/livedata.total') {
			Step(
				function() {
					var group = this.group();
					for(i=1 ; i <= 4 ; i++) {
						client.zrevrange('profileStats_'+query['id']+'.'+i, 0, -1, 'withscores', group());
					}
				},
				
				function(err, result) {
					for(i=0 ; i < result.length ; i++) {
						members = result[i];
						var lists=_.groupBy(members, function(a,b) {
					        return Math.floor(b/2);
					    });
					    
					    res.writeHead(200, {'Content-Type': 'text/plain'});
					    
					    arr = _.toArray(lists);
						result[i] = arr;
					}
					
					res.write(JSON.stringify(result).replace(/\\"/g,''));
					res.end();
				}
			);
		} else {
			client.zrevrange('profileStats_'+query['id'], 0, -1, 'withscores', function(err, members) {
			    var lists=_.groupBy(members, function(a,b) {
			        return Math.floor(b/2);
			    });
			    
			    res.writeHead(200, {'Content-Type': 'text/plain'});
			    
			    arr = _.toArray(lists);
				res.write(JSON.stringify(arr).replace(/\\"/g,''));
				
			    res.end();
			});	
		}
	} else {
		res.writeHead(200, {'Content-Type': 'text/html' });
		res.end('No server id specified.');
	}
	
}).listen(config.stats.port);

// stdout log started
console.log('STATS Server running on port '+config.stats.port+'...');
