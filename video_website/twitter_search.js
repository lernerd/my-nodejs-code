// Nice log
var nl = require(__dirname+'/../app/lib/nicelog');

// Libraries
var MongoClient = require(__dirname+'/../app/node_modules/twitter-video-scrap/node_modules/mongodb').MongoClient,
    Twitter = require(__dirname+'/../app/node_modules/twitter-node-client').Twitter,
    fs = require('fs');

var cfg = JSON.parse(fs.readFileSync(__dirname+'/../app/credentials/twitter.json').toString()),
    mongo_cfg = JSON.parse(fs.readFileSync(__dirname+'/../app/config/mongodb.json').toString());

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

mongo_insert = function(docs, db, callback) {
  var collection = db.collection(mongo_cfg.collections.tweets);
  collection.insert(docs, function(err, result) {
    if(err) {
        nl.log(err);
    } else {
        nl.log("inserted "+result.ops.length+" documents");
    }
    db.close();
    callback();
  });
}

twitter_error = function (err, response, body) {
    nl.log('Twitter API error');
    nl.log(err);
};

twitter_success = function (data, limits) {
    //nl.log('Data [%s]', data);
    var timeLeft = parseInt(limits['x-rate-limit-reset']) - (Date.now() / 1000 | 0);
    var reqLeft = parseInt(limits['x-rate-limit-remaining']);

    data = JSON.parse(data);
    var docs = [];

    if(data.statuses) {
        for (var i = 0; i < data.statuses.length; i++) {
            if(data.statuses[i].entities &&
                data.statuses[i].entities.urls) {

                var urls = [];
                for (var j = 0; j < data.statuses[i].entities.urls.length; j++) {
                    urls[urls.length] = data.statuses[i].entities.urls[j].expanded_url;
                }

                var hashtags = [];
                for (var j = 0; j < data.statuses[i].entities.hashtags.length; j++) {
                    hashtags[hashtags.length] = data.statuses[i].entities.hashtags[j].text;
                }

                docs[docs.length] = {
                    '_id': data.statuses[i].id,
                    'date': new Date(data.statuses[i].created_at),
                    'user': {
                        '_id': data.statuses[i].user.id,
                        'name': data.statuses[i].user.name,
                        'screen_name': data.statuses[i].user.screen_name,
                        'profile_image_url': data.statuses[i].user.profile_image_url,
                    },
                    'text': data.statuses[i].text,
                    'lang': data.statuses[i].lang,
                    'urls': urls,
                    'hashtags': hashtags,
                    'parsed': false,
                }
            }
        }
    }

    nl.log(reqLeft+' requests left in '+timeLeft+'s window ('+(reqLeft/timeLeft)+' per second)');
    nl.log(data.search_metadata.refresh_url);
    refresh_url = data.search_metadata.refresh_url;

    if(docs.length) {
        mongo_connect(function(db) {
            mongo_insert(docs, db, function() {
                fs.writeFileSync(__dirname+'/refresh_url.url', refresh_url);
                process.exit(0);
            });
        });
    }
};

twitter_refresh = function() {
    twitter.getCustomApiCall('/search/tweets.json'+refresh_url+'&count=100', {}, twitter_error, twitter_success);
}

// Main exec
var twitter = new Twitter(cfg.creds),
    refresh_url;

nl.log('fetching for '+cfg.source);
if(fs.existsSync(__dirname+'/refresh_url.url')) {
    nl.log('using refresh url');
    refresh_url = fs.readFileSync(__dirname+'/refresh_url.url');
    twitter_refresh();
} else {
    twitter.getSearch({'q':cfg.query, 'lang':'en', 'count': 100, 'result\_type':'recent'}, twitter_error, twitter_success);
}
