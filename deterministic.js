var dtar = require('deterministic-tar')
var zlib = require('zlib')
var path = require('path')
var concat = require('concat-stream')

//unpack and repack a stream so that it always hashes the same,
//by it's content, not it's timestamps.

module.exports = function (stream, cb) {

  
  var offset = new Date().getTimezoneOffset() * -1
  var THE_BEGINNING_OF_TIME = new Date(offset)

  var buffer = []
  var ended = false

  function errback (err) {
    if(ended) return
    cb(ended = err)
  }

  stream
    .pipe(zlib.createGunzip())
    .on('error', errback)
    .pipe(dtar(function (header) {
      var i = header.name.indexOf('/')
      var dir = header.name.substring(0, i)
      if(dir !== 'package')
        header.name = 'package'+ header.name.substring(i)
      return header
    }))
    .on('error', errback)
    .pipe(zlib.createGzip())
    .pipe(concat(function (data) {
      if(ended) return
      ended = true
      cb(null, data)
    }))
}
