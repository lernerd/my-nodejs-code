/*
	Node process to control and chain-run subprocesses
*/

var cp = require('child_process'),
	fs = require('fs'),
	U = require('./api_modules/Utils'),
	cfg = require('./config/config');

var	procs = {},
	waitlist = {},
	fails = {}
	msgs = {},

	SHOW_DEBUG = cfg.procs.show_debug;
	
pidfile = '/tmp/api-main.pid';
fs.writeFile(pidfile, process.pid, 'UTF-8');

// stamp message returned on console
stamp = function(pid, name, event, str) {
	str = str.split('#');
	if(str.length == 1) {
		str[1] = str[0];
		str[0] = null;
	}

	if(str[0] != 'debug' || SHOW_DEBUG) {
		d = new Date();

		out  = '['+d.toDateString()+' - '+d.toLocaleTimeString()+']['+pid+']['+name+']';
		if(str[0]) out += '['+str[0]+']';
		out += ' '+event+': '+str[1];
		
		console.log( out );
	}
}

// log messages
logmsg = function(name, msg) {
	if(typeof(msgs[name]) != 'array') msgs[name] = new Array();
	msgs[name][msgs[name].length] = msg;
}

/*
	Handle the sub process and its recurrence
	- Name of the script
	- Wait time to run again in case of success
	- Wait time to run again in case of fail
*/
handleIt = function(name, timeOk, timeFail) {
	if(procs[name]) {
		stamp(process.pid, 'main', 'warning', name+' process already running!');
	} else {
		if(waitlist[name]) delete waitlist[name];
		handle = cp.fork('./sub/'+name+'.js', [], {stdio: 'pipe', silent: true});
		
		handle.stdout.on('data', function (data) {
			console.log(name + ': ' + data);
		});
		
		handle.stderr.on('data', function (data) {
			logmsg(name, 'stderr: '+data);
			fs.appendFileSync(__dirname+'/main.err', name+' -> '+data+"\n");
		});
		
		procs[name] = {
			'time':   process.hrtime(),
			'handle': handle,
		};
		
		handle.on('message', function(m) {
			logmsg(name, m);
			
			// toDo: chequear mejor cuantas veces tienen que correr los procesos
			if(m.substr(0,4) == 'run#') handleIt(m.substr(4), 0, 0);
			else stamp(this.pid, name, 'message', m);
		});
	
		handle.on('exit', function(code, signal) {
			stamp(this.pid, name, 'exit', 'debug#code('+code+') / signal('+signal+')');
			delete procs[name];
			
			if(code == 0) {
				delete fails[name];
				fs.unlink('/tmp/api-sub-'+name+'.pid');
			} else {
				// email admin upon X failures
				if(typeof(fails[name]) != 'number') fails[name] = 0;
				fails[name]++;
				if(fails[name] >= cfg.procs.fail_mail_count) {
					stamp(this.pid, name, 'warning', 'debug#sending mail to admin');
					var message  = 'code('+code+') / signal('+signal+')'+"\n";
						message += msgs[name].join("\n");
					U.sendmail('lernerd@gmail.com', 'API process failed ('+name+')', message, function(){});
				}
			}
			delete msgs[name];
			
			timeToRun = (code == 0? timeOk : timeFail);
			if(timeToRun) {
				stamp(this.pid, name, 'timing', 'debug#running again in '+timeToRun+' minutes ('+(timeToRun*60)+' seconds)');
			
				waitlist[name] = setTimeout(function() {
					handleIt(name, timeOk, timeFail);
				}, timeToRun * 1000 * 60);
			}
		});	
	}
}

// check processes status
setInterval(function() {
	hasProcs = '';
	for(name in procs) {
		t = process.hrtime(procs[name].time);
		t = Math.round((t[1] * 0.000000001) + t[0]);
		hasProcs += name+' ('+t+'s) ';
		
		if(t >= cfg.procs.time_kill_proc) {
			stamp(process.pid, 'main', 'health', 'killing process '+name);
			procs[name].handle.kill();
		}
	}
	
	hasWait = 0;
	for(a in waitlist) hasWait++;
	
	stamp(process.pid, 'main', 'health', hasProcs+' ('+hasWait+' waiting)');
}, cfg.procs.time_health_check * 1000);

// ########### MAIN ###########

// impression alerts
handleIt('alerts', 60, 30);
