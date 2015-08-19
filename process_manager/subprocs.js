var fs = require('fs'),
	path = require('path');

sendmessage = function(type, str) {
	process.send(type+'#'+str);
}

sendmessage('debug', 'started');

pidfile = '/tmp/sub-'+path.basename(process.argv[1], '.js')+'.pid';
fs.writeFile(pidfile, process.pid, 'UTF-8');

process.on('message', function(m) {
	if(m == 'health') sendmessage('health', 'ok');
});