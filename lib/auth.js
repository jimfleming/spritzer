// initial imports

var OAuth = require('oauth').OAuth;
var config = require('../config');
var redis = require('./common').redis;


// helper to fetch the users oauth tokens by session id

var get_user_tokens = exports.get_user_tokens = function(user_id, callback) {
  redis.get('user:' + user_id + ':twitter', function(err, reply) {
    callback(err, JSON.parse(reply)); // pre-parse the JSON reply
  });
};

var update_user_tokens = function(user_id, tokens, callback) {
  redis.set('user:' + user_id + ':twitter', JSON.stringify(tokens), callback);
};


// handle authentication requests

exports.handler = function(req, res) {
  var oauth, user_id;

  user_id = req.sessionID;

  oauth = new OAuth(config.request_token_url,
                    config.access_token_url,
                    config.consumer_key,
                    config.consumer_secret,
                    '1.0',
                    config.callback,
                    'HMAC-SHA1');

  get_user_tokens(user_id, function(err, reply) {
    // if the user already has session information:
    if (reply) {
      if (!(reply.oauth_token && reply.oauth_token_secret && req.query.oauth_verifier)) {
        res.end('Error: missing parameters; try running FLUSHDB/FLUSHALL in redis-cli');
        return;
      }

      oauth.getOAuthAccessToken(reply.oauth_token, reply.oauth_token_secret, req.query.oauth_verifier,
        function(err, oauth_access_token, oauth_access_token_secret, access_results) {
        if (err) {
          res.end(err);
          return;
        }

        reply.oauth_access_token = oauth_access_token;
        reply.oauth_access_token_secret = oauth_access_token_secret;

        update_user_tokens(user_id, reply, function() {
          res.redirect('/api/firehose');
        });
      });

      return;
    }

    // if the user doesn't have any session information, get authorization:
    oauth.getOAuthRequestToken(function(err, oauth_token, oauth_token_secret, request_results) {
      if (err) {
        res.end(err);
        return;
      }

      var reply = {
        oauth_token: oauth_token,
        oauth_token_secret: oauth_token_secret
      };

      update_user_tokens(user_id, reply, function() {
        res.redirect('https://twitter.com/oauth/authorize?oauth_token=' + oauth_token);
      });
    });
  });
};
