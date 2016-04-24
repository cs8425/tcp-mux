#tcp-mux
Multiplexing on top of TCP, combine many tcp connections to 1.

##Features/Limitations

- up to 255 channels only
- ~~raw tcp *only* now~~
- ~~local mux server will *not* auto re-connect~~

##Architecture

- A : demux server (can connect from B)
- B : mux server (connect to A)
- C : user/client (can connect to B)

the line:
- `===>` : up to 255 connection, right side do listen
- `--->` : 1 connection only, right side do listen

```
                     |                  A               |                  |     B      |      |    C   |
'some way else' <=== |      demux + socks5 server       | <--------------- | mux server | <=== | client |
                     |                                  |    [network]     |            |      |        |
```


##Usage
###server (A & B)
set config in `demux-server.js`, `mux-server.js`
```javascript
var conf = {
	host: '127.0.0.1', // demux server bind port
	port: 8080
};
```
```javascript
	var conf = {
		host: '127.0.0.1', // demux server port
		port: 8080,
		bind: 8081, // the port to bind mux server
	};
```


```
# start demux server @ A
A $ node demux-server.js

# start mux server @ local or B
$ node mux-server.js
```

###Client (C)
Just set proxy server to mux server.
In example, mux server will bind to port `8081`.


##TODO
- [x] mux server auto re-connect
- [x] add TLS/SSL or some else encryption



