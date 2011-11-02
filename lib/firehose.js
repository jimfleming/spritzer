// initial imports

var url = require('url');
var https = require('https');
var qs = require('querystring');
var OAuth = require('oauth').OAuth;
var config = require('../config');
var redis = require('./common').redis;
var get_user_tokens = require('./auth').get_user_tokens;
var EventEmitter = require('events').EventEmitter;


// helper to build the oauth-signed requests

function build_api_request(user_tokens, body) {
  if (!user_tokens) {
    return null;
  }

  var request_url = 'https://stream.twitter.com/1/statuses/filter.json';
  var request_url_parts = url.parse(request_url);

  var oauth = new OAuth(config.request_token_url,
                        config.access_token_url,
                        config.consumer_key,
                        config.consumer_secret,
                        '1.0',
                        config.callback,
                        'HMAC-SHA1');

  var oauth_token = user_tokens.oauth_access_token;
  var oauth_token_secret = user_tokens.oauth_access_token_secret;

  var ordered_params = oauth._prepareParameters(oauth_token, oauth_token_secret, 'POST', request_url, body);

  var options = {
    host: request_url_parts.hostname,
    path: request_url_parts.pathname,
    method: 'POST',
    port: 443,
    headers: {
      'Authorization': oauth._buildAuthorizationHeaders(ordered_params),
      'Host': request_url_parts.hostname,
      'Content-length': qs.stringify(body).length,
      'Content-Type': 'application/x-www-form-urlencoded',
      'connection': 'keep-alive'
    }
  };

  return options;
};


// firehouse sampling API wrapper with events

// borrowed some stuff from here but they didn't include OAuth:
// https://github.com/technoweenie/twitter-node

function Firehose(user_tokens, body) {
  EventEmitter.call(this); // calling the EventEmitter constructor

  this.user_tokens = user_tokens;
  this.options = build_api_request(user_tokens, body);
  this.body = body;
  this.delay = 250;
};


// extending with EventEmitter

Firehose.prototype = Object.create(EventEmitter.prototype);


// define the actual api request

Firehose.prototype._request = function() {
  if (!this.options) {
    return false;
  }

  var context = this;

  var request = https.request(this.options, function(response) {
    context.response = response;
    console.log('status', response.statusCode);

    if (response.statusCode !== 200) {
      context.delay *= 2;
      context.emit('error', new Error('Invalid status: ' + response.statusCode));
      response.socket.end();
      return;
    }

    context.delay = 250;
    var buffer = '';

    response.on('data', function(data) {
      var index, json;
      buffer += data.toString('utf8');

      while ((index = buffer.indexOf('\r\n')) > -1) {
        json = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (json.length <= 0) {
          continue;
        }

        try {
          json = JSON.parse(json);
          context.emit('json', json);
        } catch (error) {
          context.emit('error', error);
        }
      }
    });

    response.on('end', function() {
      context.delay *= 2;
      context.emit('end', this);
    });

    response.on('close', function(err) {
      context.delay *= 2;
      context.response.socket.end();
      context.emit('close', err);
    });

  })
  
  request.on('error', function(err) {
    context.response.socket.end();
    context.emit('error', err);
  });

  request.end(qs.stringify(this.body));
  return true;

};


// wrapper for the actual request which handles throttling

Firehose.prototype.request = function() {
  if (!this.response) {
    this._request();
    return;
  }

  var context = this;

  if (this.delay > 10000) {
    return;
  }

  setTimeout(function() {
    context.response.socket.end();
    context._request();
  }, this.delay);

};


// very simple url regex - probably has problems but works for now

var url_regex = /\b((?:https?:\/\/|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))/i;


// handles the routing request for the firehose api

exports.handler = function(req, res) {

  get_user_tokens(req.sessionID, function(err, reply) {
    res.end('Output will be in the terminal...');

    if (err) {
      console.error(err);
      res.redirect('/auth/twitter');
      return;
    }

    if (!(reply.oauth_token && reply.oauth_token_secret)) {
      console.error(err);
      res.redirect('/auth/twitter');
      return;
    }

    var body = { 'track': config.search };

    var firehose = new Firehose(reply, body);
    firehose.request();

    firehose.on('json', function(json) {
      if (!(json && json.text)) {
        return;
      }
      
      var url_matches = json.text.match(url_regex);

      if (!(url_matches && url_matches.length)) {
        return;
      }

      var url = url_matches[0];

      if (!url) {
        return;
      }

      redis.zincrby('urls:twitter', 1, url, function(err, reply) {
        console.log(url, reply, json.text);
      });
    });

    firehose.on('end', function() {
      console.log('connection ended.');
    });

    firehose.on('close', function(err) {
      console.log('connection closed.');

      if (err) { // not guaranteed to receive an error from `close` event
        console.error(err.message);
      }

      firehose.request();
    });

    firehose.on('error', function(err) {
      console.error(err.message);
      firehose.request();
    });
  });

};
