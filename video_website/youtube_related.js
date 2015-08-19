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
var Youtube = require(__dirname+'/../app/node_modules/twitter-video-scrap/node_modules/youtube-api');
Youtube.authenticate({
	type: "key",
	key: youtube_cfg.key,
});

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
			filter = {'related':{'$exists':false}};
		if(filter_field && filter_value) {
			filter['is_related'] = {'$exists':false};
			filter[filter_field] = eval(filter_value);
		}

		collection.find(filter).limit(50).toArray(function(err, docs) {
			if(docs.length) {
				nl.log(docs.length+' found for fetching');
				var i = 0;
				_next = function() {
					if(i < docs.length) {
						fetch_data(db, docs[i]._id, function(err) {
							nl.log(i+' ('+docs[i]._id+') fetched');
							i++;
							_next();
						});
					} else {
						nl.log('updated '+i+' ids');
						db.close();
						process.exit(0);
					}
				}
				_next();
			} else {
				nl.log('no videos to update');
				db.close();
				process.exit(0);
			}
		});
	});
};

fetch_data = function(db, id, callback) {
	Youtube.search.list({"part": "id,snippet", 'relatedToVideoId':id, 'type':'video', 'maxResults':10}, function (err, data) {
	    if(err) {
	    	console.log(err);
	    	var col = db.collection(mongo_cfg.collections.videos);
	    	col.update({
				'_id': id
			},{
				'$set': {'related': []},
			}, {'upsert': true }, function(err, result) {
				callback(err);
			});
	    } else {
	    	if(data.items.length) {
	    		var col = db.collection(mongo_cfg.collections.videos),
	    			rel = [];
		    	for (var i = 0; i < data.items.length; i++) {
		    		rel[rel.length] = {
		    			id: data.items[i].id.videoId,
		    			title: data.items[i].snippet.title,
		    		}
		    	}

		    	col.update({
					'_id': id
				},{
					'$addToSet': {'related': {'$each': rel}},
				}, {'upsert': true }, function(err, result) {

					// add related video as sub video collection
					var h = 0;
					_nextR = function() {
						if(h < data.items.length) {
							if(data.items[h].id.videoId == id) {
								h++;
								_nextR();
							} else {
								setf = {
									'source': 'yt',
									'parent_id': id,
									'title': data.items[h].snippet.title,
					    			'description': data.items[h].snippet.description,
					    			'category': data.items[h].snippet.categoryId,
					    			'category_group': yt_cat_map.map[data.items[h].snippet.categoryId]? yt_cat_map.map[data.items[h].snippet.categoryId] : 0,
					    			'is_related': true,
					    			'is_complete': null,
					    			'related': [],
								};
								if(filter_field && filter_value) setf[filter_field] = eval(filter_value);

								col.update({
									'_id': data.items[h].id.videoId,
								},{
									'$set': setf
								}, {'upsert': true }, function(err, result) {
									h++;
									_nextR();
								});
							}
						} else {
							callback();
						}
					}
					_nextR();
				});
		    } else callback();
	    }
	});
};

// Main exec
get_videos();
