
var fs = require('fs')
var path = require('path')
var deterministic = require('../deterministic')

deterministic(
//  fs.createReadStream(path.join(__dirname, 'fixtures', 'curry-master.tgz')),
  fs.createReadStream(path.join(__dirname, 'fixtures', 'curry-0.0.1.tgz')),
  function (err, data) {
    if(err) throw err
    process.stdout.write(data)
  })
