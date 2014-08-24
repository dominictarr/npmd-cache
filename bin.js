#! /usr/bin/env node
var npmdCache = require('./')
var path = require('path')

var opts = require('minimist')(process.argv.slice(2))
var config = {dbPath: opts.dbPath || path.join(process.env.HOME, '.npmd')}
var cachedb = npmdCache (null, config)
var id = opts._[0]

function dump (err, value) {
  if(err) throw err
  console.log(JSON.stringify(value, null, 2))
}

if(opts.resolve) {
  var parts = opts.resolve.split('@')
  var m = parts.shift()
  var v = parts.shift() || '*'
  if(/\//.test(m))
    v = m, m = null
  return cachedb.resolve(m, v, opts, dump)
}

if(opts.del) {
  var id = opts.del
  return cachedb._del(id, function (err, value) {
    if(err) throw err
    console.log(value)
  })
}

if(opts.allKeys) {
  return cachedb.allKeys(dump)
}

if(opts.allHashes) {
  return cachedb.allHashes(dump)
}

cachedb.get(id, opts, function (err, body, meta) {
  if(err) throw err
  if(opts.dump !== false)
    process.stdout.write(body)
  else
    console.log(meta)
})

