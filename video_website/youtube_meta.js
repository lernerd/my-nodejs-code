// Config & parameters
var filter_field = process.argv[2] || false,
	filter_value = process.argv[3] || false;
var fs = require('fs');
var mongo_cfg = JSON.parse(fs.readFileSync(__dirname+'/../app/config/mongodb.json').toString()),
	youtube_cfg = JSON.parse(fs.readFileSync(__dirname+'/../app/credentials/youtube.json').toString()),
	yt_cat_map = JSON.parse(fs.readFileSync(__dirname+'/../data/category_groups.json').toString());

// Libraries
var MongoClient = require(__dirname+'/../app/node_modules/twitter-video-scrap/node_modules/mongodb').MongoClient,
	nl = require(__dirname+'/../app/lib/nicelog');

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

get_videos = function() {
	mongo_connect(function(db) {
		var collection = db.collection(mongo_cfg.collections.videos),
			tvcol = db.collection(mongo_cfg.collections.tweeted_videos),
			filter = {
				'is_complete': null,
			};
		if(filter_field && filter_value) {
			filter[filter_field] = eval(filter_value);
		}

		collection.find(filter).limit(50).toArray(function(err, docs) {
			var ids = [];
			for (var i = 0; i < docs.length; i++) ids[ids.length] = docs[i]._id;
			nl.log('video ids to fetch '+ids.length);
			if(ids.length) {
				fetch_data(ids, function(err, res, resids) {
					if(err) {
						nl.log(err);
						process.exit(0);
					} else {
						if(res.length) {
							nl.log('video meta data retrieved '+res.length);
							var done = 0,
								notfound = [];

							// calculate ids that have not been returned
							for (var i = 0; i < ids.length; i++) {
								if(resids.indexOf(ids[i]) == -1) {
									notfound[notfound.length] = ids[i];
								}
							}

							for (var i = 0; i < res.length; i++) {
								//nl.log(res[i]._id+' > '+res[i].category);

								tvcol.update({
									'video_id': res[i]._id
								},{
									'$set': {
										'category_group': yt_cat_map.map[res[i].category]? yt_cat_map.map[res[i].category] : 0,
										'category': res[i].category,
										'is_complete': true,
									}
								}, {'multi': true }, function(err, result) {});

								collection.update({'_id': res[i]._id}, {'$set': res[i]}, {}, function(err, result) {
									if(err) nl.log(err);
									else {								
										done++;
										if(done == res.length) {
											nl.log('updated '+i+' ids');
											if(notfound.length) {
												tvcol.update({'video_id': {'$in': notfound}}, {'$set': {'is_complete': false}}, {'multi': true}, function(err, result) {});
												collection.update({'_id': {'$in': notfound}}, {'$set': {'is_complete': false}}, {'multi': true}, function(err, result) {
													nl.log('cleared '+notfound.length+' not found videos');
													db.close();
													get_videos();
												});
											} else {
												db.close();
												get_videos();
											}
										}
									}
								});
							};
						} else {
							tvcol.update({'video_id': {'$in': ids}}, {'$set': {'is_complete': false}}, {'multi': true}, function(err, result) {});
							collection.update({'_id': {'$in': ids}}, {'$set': {'is_complete': false}}, {'multi': true}, function(err, result) {
								if(err) nl.log(err);
								else {
									nl.log('cleared not found videos');
									db.close();
									get_videos();
								}
							});
						}
					}
				});
			} else {
				process.exit(0);
			}
	  	});
	});
}


var Youtube = require(__dirname+'/../app/node_modules/twitter-video-scrap/node_modules/youtube-api');
Youtube.authenticate({
	type: "key",
	key: youtube_cfg.key,
});

fetch_data = function(ids, callback) {
	Youtube.videos.list({"part": "snippet,status,statistics", 'id':ids.join()}, function (err, data) {
	    if(err) {
	    	nl.log(err);
	    	callback(err)
	    } else {
	    	//nl.log(data);
	    	var ret = [],
	    		jids = [];
	    	for (var i = 0; i < data.items.length; i++) {
	    		// check video status
	    		if(data.items[i].status.privacyStatus == 'public' &&
	    			data.items[i].status.embeddable == true) {

		    		ret[ret.length] = {
		    			'_id': data.items[i].id,
		    			'title': data.items[i].snippet.title,
		    			'description': data.items[i].snippet.description,
		    			'category': data.items[i].snippet.categoryId,
		    			'yt_views': data.items[i].statistics.viewCount,
		    			'category_group': yt_cat_map.map[data.items[i].snippet.categoryId]? yt_cat_map.map[data.items[i].snippet.categoryId] : 0,
		    			'is_complete': true,
		    		};
		    		jids[jids.length] = data.items[i].id;
		    	}
	    	};

	    	callback(null, ret, jids);
	    }
	});

}	

// Main exec
get_videos();
