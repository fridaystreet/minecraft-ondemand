var mc = require('minecraft-protocol');

mc.ping({
  host: process.argv[2] ? process.argv[2] : 'localhost'
})
.then(result => console.log(JSON.stringify(result)))
.catch(err => console.log(JSON.stringify({ error: err.message })));
