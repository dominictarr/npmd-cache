
var npmdCache = require('../')
var level = require('level')
var path = require('path')

var opts = require('minimist')(process.argv.slice(2))
var config = {dbPath: opts.dbPath || path.join(process.env.HOME, '.npmd')}
var cachedb = npmdCache (level(config.dbPath + '/db', {encoding: 'json'}), config)
var id = opts._[0]

var tape = require('tape')

var examples = [
  'https://github.com/nathan7/inherit/tarball/f1a75b4844',
  'http://github.com/timoxley/next-tick/tarball/0.0.2'
]

examples.forEach(function (m) {
  tape('resolve: '  + m, function (t) {
    cachedb.resolve(null, m, opts, function (err, pkg) {
      if(err) throw err
      t.ok(pkg)
      t.end()
    })
  })
})
