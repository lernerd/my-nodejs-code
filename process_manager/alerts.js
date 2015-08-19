Step = require('step');

// required for running as a subprocess
require('subprocs.js');

Step(
	
	function() {
		Func.alertOnImpressions(this.parallel());
		Func.alertUnFixedDate(this.parallel());
	},
	
	function(err, res) {
		if(err) {
			sendmessage('error', err);
			process.exit(1);
		} else {
			sendmessage('debug', 'all ok');
			process.exit(0);
		}
	}
	
);
