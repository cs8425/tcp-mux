'use strict';

var net = require('net');
var cluster = require('cluster');

var tls = require('tls');
var fs = require('fs');

var Mux = require('./mux.js');

var pand = function(num) {
    return (num < 10) ? '0' + num : num + '';
}

var now = function() {
    var t = new Date();
    var out = '[';
    out += t.getFullYear();
    out += '/' + pand(t.getMonth() + 1);
    out += '/' + pand(t.getDate());
    out += ' ' + pand(t.getHours());
    out += ':' + pand(t.getMinutes());
    out += ':' + pand(t.getSeconds()) + ']';
    return out;
}

if (cluster.isMaster) {
    cluster.fork();
    cluster.on('exit', function(worker, code, signal) {
        console.log(now(), 'worker ' + worker.process.pid + ' died');
        cluster.fork();
    });

} else {

	var conf = {
		host: '127.0.0.1', // demux server port
		port: 8080,
		bind: 8081, // the port to bind mux server
	};

	var mkserver = function(profile){
		var ser = net.createServer({
			allowHalfOpen: false,
			pauseOnConnect: false
		}, function (socket) {
			var client_ip = socket.remoteAddress;
			socket.on('error', function(err) {
				console.log(now(), '[mux <-> user Error]', client_ip, err);
			});
			/*socket.on('data', function(data) {
//				console.log(now(), '[mux <-> user data]', client_ip, data);
				console.log(now(), '[mux <-> user data]', client_ip);
			});
			socket.on('close', function() {
				console.log(now(), '[mux <-> user disconnected]', client_ip);
			});*/
			socket.setTimeout(300 * 1000);
			socket.on('timeout', function() {
				console.log(now(), '[mux <-> user timeout]', client_ip);
				socket.destroy();
			});
		});
		return ser;
    }


	var allo_server = function(res_socket){
		var new_server = mkserver();

		console.log(now(), '[mk server]');
		var iomux = new Mux.mux(res_socket);
		new_server.iomux = iomux;
		new_server.on('connection', function(socket){
			var ch_id = iomux.new(socket);
			if(ch_id < 0){
				console.log(now(), '[mux server][ch full]');
				socket.destroy();
				return;
			}
			console.log(now(), '[mux server][new ch]', ch_id, iomux.count());
		});
		var stop_server = function (){
			console.log(now(), '[stopping server]');
			iomux.closeAll();
			new_server.close(function(){
				console.log(now(), '[server close]');
			});
		}
		//iomux.on('empty', stop_server);

		res_socket.on('close', function(){
			console.log(now(), '[demux <-> mux disconnected]');
			stop_server();
		});

		res_socket.on('stop', function(){
			console.log(now(), '[stop server]');
			//stop_server();
		});

		res_socket.setTimeout(120 * 1000);
		return new_server;
	};

	var options = {
		// These are necessary only if using the client certificate authentication
		key: fs.readFileSync('tls/userA.key'),
		cert: fs.readFileSync('tls/userA.crt'),

		// This is necessary only if the server uses the self-signed certificate
		ca: [ fs.readFileSync('tls/server.crt') ],

		checkServerIdentity: function (host, cert) {
			return undefined;
		}
	};

	var to_demux = tls.connect(conf.port, conf.host, options);
//	var to_demux = net.connect(conf.port, conf.host, options);
	to_demux.on('connect', function (){
		var ser = allo_server(to_demux);
		ser.listen(conf.bind);
	});
	to_demux.on('error', function(err) {
		console.log(now(), '[to mux Error]', err);
	});
	to_demux.on('end', function() {
		console.log(now(), '[to mux End]');
		to_demux.destroy();
	});
	to_demux.on('close', function() {
		console.log(now(), '[to mux disconnected]');
//		var t = setTimeout(connect, 3000);
	});

}


