#!/usr/bin/env node

var events = require('events');
var emitter = new events.EventEmitter();

var url = require('url');
var querystring = require('querystring');

var line = '';
var lineEvent = 'line';
var dataReady = 'dataReady';

// parse the querystring for usage
function parseUri(uri) {
  uri = url.parse(uri);
  if(uri.query) return querystring.parse(uri.query);
  return {};
}

// s3 logfile parser into fields
function parseLog(log, cb) {
  var logs = log.split('\n')
    , parsedLogs = []
    , bracketRegEx = /\[(.*?)\]/
    , quoteRegex = /\"(.*?)\"/
    ;


  for(var i = 0; i < logs.length; i++) {
    var logString = logs[i];
    if(logString.length == 0) continue;
    var time = bracketRegEx.exec(logString)[1];
    time = time.replace(/\//g, ' ');
    time = time.replace(/:/, ' ');
    time = new Date(time);
    logString = logString.replace(bracketRegEx, '');

    var requestUri = quoteRegex.exec(logString)[1];
    logString = logString.replace(quoteRegex, '');

    var referrer = quoteRegex.exec(logString)[1];
    logString = logString.replace(quoteRegex, '');

    var userAgent = quoteRegex.exec(logString)[1];
    logString = logString.replace(quoteRegex, '');

    var logStringSplit = logString.split(' ')
      , bucketOwner    = logStringSplit[0]
      , bucket         = logStringSplit[1]
      , remoteIp       = logStringSplit[3]
      , requestor      = logStringSplit[4]
      , requestId      = logStringSplit[5]
      , operation      = logStringSplit[6] + ' ' + logStringSplit[7]
      , statusCode     = logStringSplit[9]
      , errorCode      = logStringSplit[10]
      , bytesSent      = logStringSplit[11]
      , objectSize     = logStringSplit[12]
      , totalTime      = logStringSplit[13]
      , turnAroundTime = logStringSplit[14]
      , ctime          = logStringSplit[17]
      ;

    var log = {
      bucketOwner:    bucketOwner,
      bucket:         bucket,
      time:           time,
      remoteIp:       remoteIp,
      requestor:      requestor,
      requestId:      requestId,
      operation:      operation,
      requestUri:     requestUri,
      statusCode:     (statusCode == '-' ? statusCode : parseInt(statusCode, 10)),
      errorCode:      errorCode,
      bytesSent:      (bytesSent == '-' ? bytesSent : parseInt(bytesSent, 10)),
      objectSize:     (objectSize == '-' ? objectSize : parseInt(objectSize, 10)),
      totalTime:      (totalTime == '-' ? totalTime : parseInt(totalTime, 10)),
      turnAroundTime: (turnAroundTime == '-' ? turnAroundTime : parseInt(turnAroundTime, 10)),
      referrer:       referrer,
      userAgent:      userAgent,
      ctime:          ctime
    }

    parsedLogs.push(log);
  };

  return parsedLogs;
};

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
emitter.on(dataReady, function(arr) {
  var toOut = {
    'time': arr[0],
    'uri':  parseUri(arr[1]),
  };

  process.stdout.write((toOut.uri.id? toOut.uri.id : 0) + '\t' + JSON.stringify(toOut) + '\n');
});

// generate a JSON object from the captured input data, and then generate
// the required output
emitter.on(lineEvent, function(l) {
	var obj;

	// create the JSON object from the input event. if we cannot, then we discard
	// this item
	//
	// TODO Generate an exception here instead?
	if (!l || l == '') {
		return;
	}
	
	try {
		obj = parseLog(l);
	} catch (err) {
		//process.stderr.write('Error Processing Line \n\n*' + l + '*\n\n');
		//process.stderr.write(err);
		return;
	}
	
	// generate an output set per interaction object
	for ( var i = 0; i < obj.length; i++) {		
		// pull out the bits of the object model we want to retain
		var output = [ obj[i].time, obj[i].requestUri ];
		
		// raise an event that the output array is completed
		emitter.emit(dataReady, output);
	}
});

// fires on every block of data read from stdin
process.stdin.on('data', function(chunk) {
	// chunk and emit on newline
	lines = chunk.split("\n")
	
	if (lines.length > 0) {
		// append the first chunk to the existing buffer
		line += lines[0]
		
		if (lines.length > 1) {
			// emit the current buffer
			emitter.emit(lineEvent,line);

			// go through the rest of the lines and emit them, buffering the last
			for (i=1; i<lines.length; i++) {
        if (i < lines.length - 1) {
					emitter.emit(lineEvent,lines[i]);
				} else {
					line = lines[i];
				}
			}
		}
	}
});

// fires when stdin is completed being read
process.stdin.on('end', function() {
	emitter.emit(lineEvent,line);
});

// set up the encoding for STDIN
process.stdin.setEncoding('utf8');

// resume STDIN - paused by default
process.stdin.resume();