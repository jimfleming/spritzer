var redis;

exports.redis = redis = require('redis').createClient();

redis.on('error', function(err) {
  console.error(err);
});
