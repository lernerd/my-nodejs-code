// Config
var fs = require('fs');
var mongo_cfg = JSON.parse(fs.readFileSync(__dirname+'/../app/config/mongodb.json').toString());

// Libraries
var nl = require(__dirname+'/../app/lib/nicelog'),
	MongoClient = require(__dirname+'/../app/node_modules/twitter-video-scrap/node_modules/mongodb').MongoClient,
	request = require(__dirname+'/../app/node_modules/twitter-video-scrap/node_modules/request'),
	url = require('url');

// Functions
mongo_connect = function(callback) {
    var url = mongo_cfg.url;
    MongoClient.connect(url, function(err, db) {
        if(err) nl.log(err);
        else {
            nl.log("connected correctly to mongodb");
            callback(db);
        }
    });
}

url_decode = function(vurl) {
	if(vurl.substring(0,4) != 'http') vurl = 'http://'+vurl;
	vu = url.parse(vurl);

	// validate facebook or youtube video
	var regexq = /v=([a-zA-Z0-9_\- ]+)/,	// for youtube.com/watch expressions
		regexqa = /v%3D([a-zA-Z0-9_\- ]+)/,  // for youtube.com/attribution_link expressions
		regexb = /([a-zA-Z0-9_\- ]+)/,	// for youtu.be/ expressions
		regexp = /\/videos\//,	// for facebook.com/videos expressions
		source = false,
		id = false;

	if(vu.host.indexOf('facebook.com') != -1) {
		if(vu.query) {
			id = vu.query.match(regexq);
    		if(id && id.length) {
    			id = id[1];
    			source = 'fb';
    		}
		} else if(vu.pathname) {
			id = vu.pathname.match(regexp);
    		if(id && id.length) {
    			id = vu.pathname.split('/');
    			id = (id[id.length - 1]? id[id.length - 1] : id[id.length - 2]);
    			source = 'fb';
    		}
		}
	} else if(vu.query && vu.host.indexOf('youtube.com') != -1) {
		id = vu.query.match(regexq);
		if(id && id.length) {
			id = id[1];
			source = 'yt';
		} else {
			id = vu.query.match(regexqa);
	      	if(id && id.length) {
	        	id = id[1];
	        	source = 'yt';
	      	}
		}
	} else if(vu.pathname && vu.host == 'youtu.be') {
		id = vu.pathname.match(regexb);
		if(id && id.length) {
			id = id[1];
			source = 'yt';
		}
	}

	return {
		'_id': id,
		'source': source,
	};
}

url_cleanup = function(doc, num, total, db, callback) {
	// attempt to decode url without http request
	var parsed = url_decode(doc.urls[num]);
	var success = (parsed._id != false && parsed.source != false);

	if(success) {
		document_update(0, db, success, doc, parsed._id, parsed.source, callback);
	} else {
		nl.log('performing request (id '+doc._id+'): '+doc.urls[num]);
		request(doc.urls[num], {
		    'timeout': 10000,
		    'followAllRedirects': true,
		    'method': 'HEAD',
		    'headers': {
		      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.81 Safari/537.36',
		    }
		}, function (error, res, body) {
			nl.log('returned request (id '+doc._id+'): '+doc.urls[num]);
			if(error) {
				nl.log(error);
				var parsed = url_decode(doc.urls[num]);
				document_update(1, db, false, doc, parsed._id, parsed.source, callback);
			} else {
		    	var parsed = url_decode(res.request.uri && res.request.uri.href? res.request.uri.href : doc.urls[num]);
		    	success = (parsed._id != false && parsed.source != false);
		    	document_update(1, db, success, doc, parsed._id, parsed.source, callback);
		    }
		});
	}
}

document_update = function(httpr, db, success, tweet, video_id, source, callback) {
	if(success) {
		// adding item to videos collection
		var col = db.collection(mongo_cfg.collections.videos);
		col.update({
			'_id': video_id
		},{
			'$addToSet': {'tweets': tweet._id},
			'$set': {
				'source': source,
			}
		}, {'upsert': true }, function(err, result) {
			if(err) {
				nl.log('v'+video_id);
				nl.log('t'+tweet._id);
				nl.log(err);
			}

			// setting item as parsed in tweets collection
			var col = db.collection(mongo_cfg.collections.tweets);
			col.update({
				'_id': tweet._id
			},{
				'$set': {
					'parsed': true,
				}
			}, {}, function(err, result) {
				if(err) {
					nl.log('v'+video_id);
					nl.log('t'+tweet._id);
					nl.log(err);
				}

				// adding tweet/video relationship for rank calculation
				var tvcol = db.collection(mongo_cfg.collections.tweeted_videos);
				tvcol.update({
					'video_id': video_id,
					'tweet_id': tweet._id,
					'user_id': tweet.user._id,
					'date': tweet.date,
				},{
					'$set': {
						'video_id': video_id,
						'tweet_id': tweet._id,
						'user_id': tweet.user._id,
						'date': tweet.date,
					}
				}, {'upsert': true }, function(err, result) {
					if(err) {
						nl.log('v'+video_id);
						nl.log('t'+tweet._id);
						nl.log(err);
					}

					callback('updated -> ('+httpr+') ('+source+') '+video_id);
				});
			});
		});
	} else {
		var col = db.collection(mongo_cfg.collections.tweets);
		col.update({
			'_id': tweet._id
		},{
			'$set': {
				'parsed': true,
			}
		}, {}, function(err, result) {
			if(err) {
				nl.log('t'+tweet._id);
				nl.log(err);
			}
			callback('parsed, no video found -> ('+httpr+') '+tweet._id);
		});
	}
}

process_batch = function() {
	mongo_connect(function(db) {
		// set index on tweet/video relationship
		var tvcol = db.collection(mongo_cfg.collections.tweeted_videos);
		tvcol.createIndex({
			'video_id': 1,
			'tweet_id': 1,
			'user_id': 1,
			'date': -1,
		}, {
			'unique': true,
		}, function(err, res) {
			nl.log('video/tweet index creation:');
			nl.log(err);
			nl.log(res);
		});

		// get unparsed tweets
		var collection = db.collection(mongo_cfg.collections.tweets);
	  	collection.find({parsed:false}).limit(250).toArray(function(err, docs) {
	  		if(err) nl.log(err)
	  		else {
	  			nl.log('tweets to parse '+docs.length);
	  			if(docs.length) {
		  			var done = 0,
		  				total = 0,
		  				nourls = [];
		  			for (var i = 0; i < docs.length; i++) {
		  				if(docs[i].urls.length)
		  					total += docs[i].urls.length;
		  				else
		  					nourls[nourls.length] = docs[i]._id;
		  			}

		  			if(nourls.length) {
		  				nl.log(nourls.length+' tweets with no url');
		  				collection.update({'_id': {'$in': nourls}},{
							'$set': {'parsed': true}}, 
							{'multi': true}, function(err, result) {});
		  			}

		  			if(total) {
			  			for (var i = 0; i < docs.length; i++) {
			  				for (var j = 0; j < docs[i].urls.length; j++) {
				  				url_cleanup(docs[i], j, total, db, function(status) {
				  					done++; 
				  					nl.log(done+' out of '+total+': '+status);
				  					if(done == total) {
				  						db.close();
				  						process.exit(0);
				  					}
				  				});
				  			}
			  			};
			  		} else {
			  			nl.log('no urls found in tweets');
			  			db.close();
			  			process.exit(0);
			  		}
		  		} else {
		  			db.close();
		  			process.exit(0);
		  		}
	  		}
	  	});
	});	
}

// Main exec
process_batch();
