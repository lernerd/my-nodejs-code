// nodetime profiling
require('nodetime').profile({
	accountKey: '98a9018a169556296be9c14accd927fe62517621', 
	appName: 'Pixel tracking'
});
 
// extended debug
var debug = 0;
 
// modules
var http = require('http');
var url = require('url');
var fs = require('fs');
var redis = require('redis');
var cluster = require('cluster');
var numCPUs = require('os').cpus().length;

if (cluster.isMaster) {
	// Fork workers.
	for (var i = 0; i < numCPUs; i++) {
		cluster.fork({
			'id': i+1
		});
	}
	
	cluster.on('exit', function(worker, code, signal) {
		console.log('worker ' + worker.process.pid + ' died');
	});
} else {
 
	// config file
	var config = require('./config/config'),
		procId = config.pixel.id + '.' + process.env.id;
	 
	process.on('uncaughtException', function(err) {
	  console.log('uncaughtException '+err);
	});
	 
	// redis client connect
	var client;
	function redisConnect() {
	    client = redis.createClient(config.redis.port, config.redis.host);
	    client.on("error", function (err) {
	        console.log("Redis "+err);
	    });
	}
	redisConnect();
	 
	// profiling counts
	var totalConns = 0;
	var totalRedisStore = 0;
	var totalTime = 0;
	 
	if(client.connected) {
	    client.multi()
	        .set('numRequests_'+procId, 0)
	        .sadd('pixelServers', procId) // add this server to the pool
	        .exec();
	}
	
	var redis_requests = {},
		redis_hits = [],
		redis_numRequests = 0;
	 
	// http server
	http.createServer(function (req, res) {
	 
	    if(url.parse(req.url)['pathname'].substr(-9) == 'pixel.gif') {
	        var t = process.hrtime();
	         
	        // response
	        res.writeHead(302, {'Location': config.pixel.imgredir });
	        res.end();
	         
	        var url_parts = url.parse(req.url, true),
	            query = url_parts.query,
	            date = new Date(),
	            ts = Math.round(date.getTime() / 1000),
	            //referer = req.headers && req.headers.referer? req.headers.referer : '';
	         
	        // data storage
	        /*
	        var request = {
	            id: query[config.pixel.trackField],
	            ip: req.connection.remoteAddress,
	            ts: ts,
	            url: req.url,
	            headers: req.headers
	        };
	        */
	         
	        key = t.toString();
	        referer = query['u']? query['u'] : 'url-not-set';
	        id = query[config.pixel.trackField]? query[config.pixel.trackField] : 0;
	        
	        redis_requests[key] = id;
			redis_hits[redis_hits.length] = key + '_' + ts + '_' + id + '_' + referer; // actual data for mysql dump
			redis_numRequests++;
	        
	        /*
	        if(client.connected) {
	            client.multi()
	                .hset('requests_'+procId, key, id)
	                .sadd('hits', key + '_' + ts + '_' + id + '_' + referer) // actual data for mysql dump
	                .incr('numRequests_'+procId)
	                .exec();
	        }
	        if(!client.connected) {
	            fs.appendFile(__dirname+'/failover.log', ts+'\t'+id+'\n', function (err) {});
	        }
	        */
	         
	        // profiling
	        t = process.hrtime(t);
	        totalTime += ((t[1] * 0.000000001) + t[0]);
	        totalConns++;
	    } else {
	        res.end();
	    }
	 
	}).listen(config.pixel.port);
	 
	// stdout log started
	console.log('PIXEL Server running on port '+config.pixel.port+' (#'+procId+') ...');
	if(config.pixel.imgredir) console.log('Redirecting pixel image to ' + config.pixel.imgredir);
	 
	// profiling
	var timeOut = 5;
	setInterval(function() {
	    if(debug) {
	        console.log('\n### This process is pid ' + process.pid+ ' ###');
	        console.log('running loop');
	    }
	    
	/*
	    console.log('#redis_requests#');
	    console.log(redis_requests);
		console.log('#redis_hits#');
		console.log(redis_hits);
		console.log('#redis_numRequests#');
		console.log(redis_numRequests);
		console.log('\n\n');
	    return;
	*/
	     
	    if(!client.connected) {
	        redisConnect();
	        return;
	    }
	    
	    var redis_requests_tmp = {},
			redis_hits_tmp = [],
			redis_numRequests_tmp = 0;
			
		redis_requests_tmp = redis_requests; redis_requests = {};
		redis_hits_tmp = redis_hits; redis_hits = [];
		redis_numRequests_tmp = redis_numRequests; redis_numRequests = 0;
	    
	    rmulti = client.multi();
	    for(key in redis_requests_tmp) rmulti.hset('requests_'+procId, key, redis_requests_tmp[key]);
	    for(h=0 ; h < redis_hits_tmp.length ; h++) rmulti.sadd('hits', redis_hits_tmp[h]); // actual data for mysql dump
	    rmulti.incrby('numRequests_'+procId, redis_numRequests_tmp);
	    rmulti.exec();
	    
	    totalConns_tmp = totalConns;
	     
	    client.multi()
	        .get('numRequests_'+procId)
	        .set('numRequests_'+procId, 0) // cantidad de requests contados por la instancia
	        .hlen('requests_'+procId)
	        .del('requests_'+procId) // cantidad de requests guardados por la instancia
	        .exec(function (err, replies) {
	            numRequests = replies[0];
	            if(!numRequests) numRequests = 0;
	             
	            redisStore = replies[2];
	            totalRedisStore += redisStore;
	             
	            date = new Date();
	
	            /* 
	            data = fs.readFileSync('/proc/stat', 'utf8');
	            lines = data.split("\n");
	            line = lines[0];
	            line = line.replace(/ +/,' ').split(/ /);
	            
	            totalProc = line[1] + line[2] + line[3] + line[4];
	            processor = 100 - (((totalProc - line[4]) * 100) / totalProc);
	            */
	            processor = 0;
	            if(debug) console.log(processor);
	             
	            var memTotal, memFree;
	             
	            /*
	            data = fs.readFileSync('/proc/meminfo', 'utf8');
	            lines = data.split("\n");
	            memTotal = lines[0].replace(/[^0-9]/g, '');
	            memFree = lines[1].replace(/[^0-9]/g, '')
	            */
	            memFree = 0;
	            if(debug) console.log(memFree);
	             
	            ts = Math.round(date.getTime() / 1000) + date.getTimezoneOffset() * 60; 
	            mem = process.memoryUsage();
	            memoryNode = (mem.rss / 1024);
	            if(debug) console.log(memoryNode);
	             
	            profileData = {
	                ts: ts,
	             
	                memRss: mem.rss,
	                memHeapTotal: mem.heapTotal,
	                memHeapUsed: mem.heapUsed,
	                 
	                processor: processor,
	                memory: 100 - ((memFree * 100) / memTotal),
	                memoryNode: (memoryNode * 100) / memTotal,
	                 
	                totalConns: totalConns_tmp,
	                totalRedisStore: totalRedisStore,
	                 
	                requests: numRequests,
	                redisStore: redisStore,
	                meanTime: numRequests? (totalTime/numRequests) : 0
	            };
	             
	            client.zadd('profileStats_'+procId, String(ts), JSON.stringify(profileData));
	             
	            totalTime = 0;
	            tmp = new Array();
	             
	            // data purge
	            date = new Date();
	            ts = Math.round(date.getTime() / 1000) + date.getTimezoneOffset() * 60;
	            // removing older than 10 minutes (600 secs)
	            ts -= 600;
	            client.zremrangebyscore('profileStats_'+procId, 0, ts);
	             
	            if(debug) console.log('end loop');
	        });
	 
	}, timeOut*1000);
	
}