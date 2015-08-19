#!/usr/bin/env node

process.env.TZ = 'America/New_York';

var events = require('events');
var emitter = new events.EventEmitter();

var remaining = '';
var lineReady = 'lineReady';
var dataReady = 'dataReady';

var totals = {};

// escape all control characters so that they are plain text in the output
String.prototype.escape = function() {
	return this.replace('\n', '\\n').replace('\'', '\\\'').replace('\"', '\\"')
			.replace('\&', '\\&').replace('\r', '\\r').replace('\t', '\\t')
			.replace('\b', '\\b').replace('\f', '\\f');
}

// append an array to this one
Array.prototype.appendArray = function(arr) {
	this.push.apply(this, arr);
}

// data is complete, write it to the required output channel
emitter.on(dataReady, function(o) {
	if (o) {
		for(id in o)
		process.stdout.write(JSON.stringify({'id': id, 'counts': o[id]}) + '\n');
	}
});

// generate a JSON object from the captured input data, and then generate
// the required output
emitter.on(lineReady,function(data) {	
	if (!data || data == '') {
		// null data is probably a closing event, so emit a data ready
		emitter.emit(dataReady, totals);
		return;
	}
	
	time = null;
	try {
		obj = JSON.parse(data.split('\t')[1]);
		time = obj.time;
		time = new Date(time);
		time = time.getFullYear()+'-'+(time.getMonth()+1)+'-'+time.getDate();
	} catch (err) {
		process.stderr.write('Error Processing Line ' + data + '\n')
		process.stderr.write(err);
		return;
	}

	if(obj.uri.id && time) {
		id = obj.uri.id;

		if (totals[id] == undefined) {
			totals[id] = {};
			totals[id][time] = 1;
		} else {
			if(totals[id][time] == undefined) {
				totals[id][time] = 1;
			} else {
				totals[id][time]++;
			}
		}
	}
});

// fires on every block of data read from stdin
process.stdin.on('data', function(chunk) {
	var capture = chunk.split('\n');

	for (var i=0;i<capture.length; i++) {
		if (i==0) {
			emitter.emit(lineReady,remaining + capture[i]);
		} else if (i<capture.length-1) {
			emitter.emit(lineReady,capture[i]);
		} else {
			remaining = capture[i];
		}
	}
});

// fires when stdin is completed being read
process.stdin.on('end', function() {
	emitter.emit(lineReady,remaining);
});

// resume STDIN - paused by default
process.stdin.resume();

// set up the encoding for STDIN
process.stdin.setEncoding('utf8');