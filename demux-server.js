'use strict';

var net = require('net');
var util = require('util');
var cluster = require('cluster');

var tls = require('tls');
var fs = require('fs');

var mux = require('./mux.js');

var conf = {
	host: '127.0.0.1', // demux server bind port
	port: 8080
};

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

var sockslog = function (){
	process.stdout.write('[socks]');
	console.log.apply(null, arguments)
}

var handleRequest = function (chunk) {
	var client = this;
	var client_ip = client.remoteAddress;
	var client_port = client.remotePort;
	var errBuf = new Buffer([0x05, 0x01]);

	client.pause();

	if (chunk[0] !== 0x05 && chunk[2] !== 0x00) {
		sockslog('[handleRequest]wrong socks version: %d', chunk[0]);
		client.end(errBuf);
		return;
    }

	var cmd = chunk[1];
	if(cmd != 0x01) {
		sockslog('[handleRequest]unsupported command: %d', cmd);
		client.end(errBuf);
		return;
	}

	var addrtype = chunk[3];
	var host = null;
	var port = null;

	var responseBuf = null;

	switch(addrtype){
		case 0x01: // ipv4
			if(chunk.length < 10) return; // 4 for host + 2 for port
			host = util.format('%d.%d.%d.%d', chunk[4], chunk[5], chunk[6], chunk[7]);
			port = chunk.readUInt16BE(8);
			responseBuf = new Buffer(10);
			chunk.copy(responseBuf, 0, 0, 10);
			chunk = chunk.slice(10);
		break;

		case 0x03: // dns
			if(chunk.length < 5) return; // if no length present yet
			var addrLength = chunk[4];
			if(chunk.length < 5 + addrLength + 2) return; // host + port
			host = chunk.toString('utf8', 5, 5 + addrLength);
			port = chunk.readUInt16BE(5 + addrLength);
			responseBuf = new Buffer(5 + addrLength + 2);
			chunk.copy(responseBuf, 0, 0, 5 + addrLength + 2);
			chunk = chunk.slice(5 + addrLength + 2);

		case 0x04: // ipv6
			if(chunk.length < 22) return // 16 for host + 2 for port
			host = chunk.slice(4, 20);
			port = chunk.readUInt16BE(20);
			responseBuf = new Buffer(22);
			chunk.copy(responseBuf, 0, 0, 22);
			chunk = chunk.slice(22);

		default:
			sockslog('unsupported address type: %d', addrtype);
			client.end(errBuf);
			return;
	}

	var dest = net.createConnection(port, host, function() {
		sockslog('[forward to]', client_ip, client_port, ' -> ', host, port);
		responseBuf[1] = 0x00;
		responseBuf[2] = 0x00;
		client.write(responseBuf) // emit success to client

		client.pipe(dest);
		dest.pipe(client);

		client.resume();
		client.forward = dest;

		if(chunk && chunk.length) {
			client.emit(chunk)
			chunk = null
		}

	}).once('error', function(err) {
		sockslog('[forward error]', client_ip, client_port, ' -> ', host, port, err);
		if(client.forward) {
			//client.end(errBuf);
			client.destroy();
			client.forward = null;
			client.isend = true;
		}
	}).once('end', function() {
		sockslog('[forward end]', client_ip, client_port, ' -> ', host, port);
		if(!client.isend) {
			client.isend = true;
		}
	}).once('close', function() {
		sockslog('[forward close]', client_ip, client_port, ' -> ', host, port);
		if(client.forward) {
			if(!client.isend) client.end();
			client.unpipe(client.forward);
			client.forward.unpipe(client);
			client.forward = null;
		}
	});

}

var handshake = function (socket, chunk) {
//	var socket = this;
    if (chunk[0] != 0x05) {
        sockslog('[handshake]wrong socks version: %d', chunk[0]);
        socket.end();
		return;
    }

    var method_count = chunk[1];
	if(method_count != chunk.length - 2){
		sockslog('[handshake]wrong method count: %d', method_count, chunk.length - 2);
		socket.end();
		return;
	}

    var auth_methods = [];
    // i starts on 1, since we've read chunk 0 & 1 already
    for (var i=2; i < method_count + 2; i++) {
        auth_methods.push(chunk[i]);
    }
    sockslog('[handshake]Supported auth methods: %j', auth_methods);

    var resp = new Buffer([0x05, 0x00]);
    if (auth_methods.indexOf(0x00) > -1) {
        sockslog('[handshake]go to handleRequest');
        socket.once('data', handleRequest);
        if(!socket.isend) socket.write(resp);
    } else {
        sockslog('[handshake]Unsuported authentication method -- disconnecting');
        resp[1] = 0xFF;
        socket.end(resp);
    }
}

var handler = function (socket){
	var client_ip = socket.remoteAddress;
	var client_port = socket.remotePort;

	socket.forward = null;
	socket.isend = false;

	socket.on('error', function(err) {
		sockslog('[client Error]', client_ip, client_port, err);
		if(socket.forward){
			socket.forward.destroy();
			socket.forward = null;
		}
	});
	socket.once('data', function(data) {
		sockslog('[new client]', client_ip, client_port);
		handshake(socket, data);
	});
	socket.on('end', function() {
		sockslog('[client end]', client_ip, client_port);
		socket.isend = true;
	});
	socket.on('close', function() {
		sockslog('[client disconnected]', client_ip, client_port);
		if(socket.forward){
			socket.forward.destroy();
			socket.unpipe(socket.forward);
			socket.forward.unpipe(socket);
			socket.forward = null;
		}
	});
	socket.setTimeout(300 * 1000);
	socket.on('timeout', function() {
		sockslog('[client timeout]', client_ip, client_port);
		socket.destroy();
	});
}

	var demux_ser = function (host, port){
		var options = {
			key: fs.readFileSync('tls/server.key'),
			cert: fs.readFileSync('tls/server.crt'),

			// This is necessary only if using the client certificate authentication.
			requestCert: true,
			rejectUnauthorized: true,

			// This is necessary only if the client uses the self-signed certificate.
			ca: [ fs.readFileSync('tls/userA.crt') ]
		};
		/*var hub = net.createServer({
			allowHalfOpen: false,
			pauseOnConnect: false
		});*/
		var hub = tls.createServer(options);
		var iomux = null;

//		hub.on('connection', function (socket){
		hub.on('secureConnection', function (socket){
			iomux = new mux.mux(socket);

			var new_ch = function (ch_id){
				var self = this;
				var socket = new mux.Socket();
				var id = self.assign(ch_id, socket);
				if(id >= 0){
					socket.id = id;
					socket.server.id = id;
					socket.remoteAddress = socket.server.remoteAddress = host;
					socket.remotePort = socket.server.remotePort = port + '-' + id;
					console.log('[new_ch]', ch_id, iomux.count());
				}else{
					console.log('[new_ch][full]', ch_id, self.count());
					socket.destroy();
				}
				handler(socket.server);
			}
			iomux.on('new_ch', new_ch);

			socket.on('error', function(err) {
				console.log(now(), '[to demux Error]', err);
			});
			socket.on('end', function() {
				console.log(now(), '[to demux End]');
				socket.destroy();
			});
			socket.on('close', function() {
				console.log(now(), '[to demux disconnected]');
				if(iomux) iomux.closeAll();
			});
			//socket.setTimeout(300 * 1000);
			//socket.on('timeout', function() {
			//	console.log(now(), '[to hub timeout]');
			//	socket.destroy();
			//});
		});

		return hub;
	}
	
	var server = demux_ser(conf.host, conf.port);
	server.listen(conf.port);
	console.log(now(), 'demux server start at ', conf.host, ':', conf.port);
}


