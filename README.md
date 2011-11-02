Simply connects to the Twitter Streaming API via OAuth and stores (in redis) link occurences

* Authenticate at this url: `/auth/twitter` (should redirect automatically to `/api/firehose`)

* Start data fetching here: `/api/firehose`

Dependencies:

* Redis (http://redis.io)

* `npm install redis hiredis connect-redis express oauth underscore`
