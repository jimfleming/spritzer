var express = require('express');
var RedisStore = require('connect-redis')(express);

var app = express.createServer();
app.use(express.logger({ format: '[:date] [:response-time] [:status] [:method] [:url]' }));
app.use(express.bodyParser()); // pre-parses JSON body responses
app.use(express.cookieParser()); // pre-parses JSON cookies
app.use(express.session({ secret: 'SECRET', store: new RedisStore(), cookie: { path: '/', httpOnly: true, maxAge: 100800000 } }));

var firehose_handler = require('./lib/firehose').handler;
var auth_handler = require('./lib/auth').handler;

app.get('/api/firehose', firehose_handler);
app.get('/auth/twitter', auth_handler);

app.listen(80);
console.log('listening on :80');
