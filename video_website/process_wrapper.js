// Nice log
var nl = require(__dirname+'/../app/lib/nicelog');

var cp = require('child_process'),
	procname = process.argv[2],
	looptime = process.argv[3],
	killtime = process.argv[4] || false,

	start, handle;

if(!procname) {
	nl.log('WRAPPER: no process specified');
	process.exit(0);
}
if(!looptime) looptime = 3;

nl.log('WRAPPER: starting wrapped process for '+procname);

exec_proc = function() {
	handle = cp.fork(__dirname+'/'+procname+'.js', [], {stdio: 'pipe', silent: true});
	start = process.hrtime();

	handle.stdout.on('data', function (data) {
		process.stdout.write(data.toString());
	});

	handle.stderr.on('data', function (data) {
		process.stdout.write(data.toString());
	});

	handle.on('exit', function(code, signal) {
		nl.log('WRAPPER: exited -> code ('+code+') signal ('+signal+')')
		nl.timeout('exec_proc()', looptime);
		start = false;
	});

	setTimeout(function(){ check_proc() }, 5000);
}

check_proc = function() {
	if(start) {
		t = process.hrtime(start);
		t = Math.round((t[1] * 0.000000001) + t[0]);
		
		nl.log('WRAPPER: process running for '+t+' seconds');
		if(killtime && t > killtime) {
			nl.log('WRAPPER: killing and restarting process');
			handle.kill();
		} else {
			setTimeout(function(){ check_proc() }, 5000);
		}
	}
}

exec_proc();