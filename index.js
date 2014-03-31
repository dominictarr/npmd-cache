var path    = require('path')
var levelup = require('levelup')
var locket  = require('locket')
var CAS     = require('content-addressable-store')
var cache   = require('level-content-cache')
var request = require('request')
var mkdirp  = require('mkdirp')
var npmUrl  = require('./npm-url')
var deterministic = require('./deterministic')

var createDefer = require('./defer')

var semver = require('semver')
var zlib   = require('zlib')
var crypto = require('crypto')
var tar    = require('tar-stream')
var concat = require('concat-stream')
var streamify = require('streamify')
var EventEmitter = require('events').EventEmitter

module.exports = function (config) {
  var get, db, blobs
  var getter = new EventEmitter()

  var defer = createDefer()

  mkdirp(config.dbPath, function () {
    db = levelup(path.join(config.dbPath, 'db'), {encoding: 'json', db: locket})

    //***************************************************
    //*** TODO: migrate to sha256.
    //*** sha1 is insecure, but need it to be compatible with npm.
    //***************************************************

    blobs = CAS(path.join(config.dbPath, 'blobs'), 'sha1')

    get = cache(db, blobs, {getter: function (key, meta, cb) {
      var url = npmUrl (key)

      //if it's a github url, must cleanup the tarball
      if(/^https?:\/\/\w+\.github\.com/.test(url))
        deterministic(request({url: url, encoding: null}), cb)
      
      else
        request({url: url, encoding: null}, function (err, response, body) {
          if(err) return cb(err)

          if(response.statusCode !== 200) {
            return cb(new Error(body.toString()))
          }
          cb(null, body, {})
        })
    
    }})

    defer.ready()
  })


  var get = defer(function () {
    return get.apply(this, arguments)
  })

  getter.get = get

  var createStream = defer(function (id, cb) {
    var key, hash
    function getHash (hash, cb) {
      blobs.has(hash, function (err) {
        if(err) return cb(err)
        cb(null, blobs.getStream(hash))
      })
    }

    function getKey (key, cb) {
      get(key, function (err, meta) {
        if(err) return cb(err)
        getHash(meta.hash, cb)
      })
    }

    if(id.key && id.hash) {
      getHash(id.hash, function (err, stream) {
        if(err) {
          if(err.code === 'ENOENT') getKey(id.key, cb)
          else                      cb(err)
          return
        }
        cb(null, stream)
      })
    }
    else if(blobs.isHash(id))
      return getHash(id, cb)
    else
      return getKey(id, cb)

  })

  getter.createStream = function (key, cb) {
    if(!cb) {
      var stream = streamify()
      return createStream(key, function (err, _stream) {
        if(err) return stream.emit('error', err)
        stream.resolve(_stream)
      })
      return stream
    }
    return createStream(key, cb)
  }

  //TODO this should use streams.

  getter.resolve = defer(function (module, range, opts, cb) {
    if(!cb) cb = opts, opts = {}
    //it's a url
    if(/\//.test(range)) {
      get(range, config, next)
    }
    else if(semver.valid(range, true))
      get(module+'@'+range, config, next)
    //it's a module
    else {
      var versions = {}
      db.createReadStream({start: module + '\x00', end: module + '\xff\xff'})
        .on('data', function (pkg) {
          var version = pkg.key.split('@')[1]
          versions[version] = pkg.value
        })
        .on('end', function () {
          var version = semver.maxSatisfying(Object.keys(versions), range, true)
          if(!version) return cb(new Error('could not resolve' + module + '@' + range))

          get(versions[version].hash, function (err, content) {
            next(err, content, versions[version])
          })
        })

    }

    function next(err, data, meta) {
      //**************************************************
      //extract the package.json from data, and return it.
      if(err) return cb(err)

      zlib.gunzip(data, function (err, data) {        
        if(err) return cb(err)

        var extract = tar.extract()
          .on('entry', function (header, stream, done) {
            if(header.name !== 'package/package.json') return done()
            
            stream.pipe(concat(function (data) {
              try { data = JSON.parse(data) } catch (err) { return done(), cb(err) }
              data.shasum = meta.hash
              done(), cb(null, data)
            }))
          })

        extract.write(data)
        extract.end()
      })  
    }
  })

  return getter
}

if(!module.parent) {
  var opts = require('minimist')(process.argv.slice(2))
  var config = {dbPath: opts.dbPath || path.join(process.env.HOME, '.npmd')}
  var get = module.exports (opts)
  var id = opts._[0]

  if(opts.resolve) {
    var parts = opts.resolve.split('@')
    var m = parts.shift()
    var v = parts.shift() || '*'
    return get.resolve(m, v, opts, function (err, pkg) {
      if(err) throw err
      console.log(JSON.stringify(pkg, null, 2))
    })
  }

  get(id, opts, function (err, body, meta) {
    if(err) throw err
    if(opts.dump !== false)
      process.stdout.write(body)
    else
      console.log(meta)
  })
}

