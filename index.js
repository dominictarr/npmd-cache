#! /usr/bin/env node

var path      = require('path')
var CAS       = require('content-addressable-store')
var cache     = require('level-content-cache')
var request   = require('request')
var mkdirp    = require('mkdirp')
var npmUrl    = require('npmd-url')
var levelup   = require('levelup')
var medeadown = require('medeadown')

var deterministic = require('./deterministic')

var createDefer = require('./defer')

var semver = require('semver')
var xft = require('extract-from-tarball')

var concat = require('concat-stream')
var streamify = require('streamify')
var EventEmitter = require('events').EventEmitter

var pull = require('pull-stream')
var pl = require('pull-level')

module.exports = function (db, config) {
  if(!config) config = db, db = null
  if(!config) throw new Error('must have db and config')
  if(!db)
    db = levelup(
      path.join(config.dbPath, config.jsdb ? 'jsdb' : 'db'),
      {encoding: 'json', db: medeadown}
    )

  var get, db, blobs, auth
  var getter = new EventEmitter()

  if (config.alwaysAuth) {
    var creds = Buffer(config.Auth, 'base64').toString()
    var segs = creds.split(':')
    auth = { user: segs[0], pass: segs[1] }
  }

  var defer = createDefer()

  mkdirp(config.dbPath, function () {

    //***************************************************
    //*** TODO: migrate to sha256.
    //*** sha1 is insecure, but need it to be compatible with npm.
    //***************************************************

    blobs = CAS(path.join(config.dbPath, 'blobs'), 'sha1')

    get = cache(db, blobs, {getter: function (key, meta, cb) {
      var url = npmUrl (key, config)
      //if it's a github url, must cleanup the tarball
      //DO NOT DO THIS ON NPM REGISTRIES! It will break the shasum!!!
      if(/^https?:\/\/[^/]*github.com/.test(url))
        deterministic(request({url: url, encoding: null}), cb)
      else
        request({
          url: url, encoding: null, auth: auth
        }, function (err, response, body) {
          if(err) return cb(err)

          if(response.statusCode !== 200) {
            return cb(new Error(
              'error attemping to fetch: ' + url +
              ' ' + body.toString()))
          }
          cb(null, body, {})
        })
    }})

    defer.ready()
  })

  getter.get = defer(function () {
    return get.apply(this, arguments)
  })

  //sometimes you want to add a module that
  //hasn't actually been published yet.
  //so stick it in, indexing only by it's hash.

  //if it's actually published later, that is cool.

  getter.addTarball = defer(function (buffer, opts, cb) {
    return blobs.add(buffer, opts, cb)
  })

  //some times you need to delete something from the cache
  //so you can debug the fetch code. that is what this is for.
  getter._del = defer(function (key, cb) {
    get._del(key, cb)
  })

  getter.allHashes = defer(function (cb) {
    blobs.all(cb)
  })

  getter.allKeys = defer(function (cb) {
    pull(pl.read(db, {keys: false}), pull.collect(cb))
  })

  var createStream = defer(function (id, cb) {
    var key, hash
    function getHash (hash, cb) {
      if(!hash) throw new Error('no hash was provided')
      blobs.has(hash, function (err) {
        if(err) return cb(err)
        cb(null, blobs.getStream(hash))
      })
    }

    function getKey (key, opts, cb) {
      if(!cb) cb = opts, opts = {}
      get(key, opts, function (err, content, meta) {
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

        //Is this a security hole?
        //I think we can't resolve that until there are signed packages anyway.
        //sometimes we definately don't want to update this...
        //like, when we are installing a prepublished hash, say for testing.
        //the version number cannot be official until it's in the registry,
        //because otherwise it'll be out of order. I needed this for offline
        //resolve, but maybe the better way is to resolve from the .cache.json
        //but filter to the tarballs that are in the content store?
        //
        //I was worried that would be slow -- a bloom filter would need to be saved
        //what about if has kept a cache? yeah - doing a readdir and remembering the hashes would be very fast.

//This should not be needed with the new offline resolve.
//        db.get(id.key, function (err) {
//          if(err)
//            db.put(id.key, {
//              key: id.key, hash: id.hash, ts: Date.now()              
//            }, function () {})
//        })
//
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
    else if(/^[0-9a-f]{40,64}$/.test(range))
      get(range, config, next)
    else {
      var versions = {}
      db.createReadStream({start: module + '\x00', end: module + '\xff\xff'})
        .on('data', function (pkg) {
          var parts = pkg.key.split('@')
          var name = parts[0]
          if(name !== module) return
          var version = parts[1]
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

      xft(data, {package: xft.package}, function (err, out) {
        if(err) return cb(err)
        var pkg
        try {
          pkg = JSON.parse(out.package.source.toString('utf8'))
          pkg.shasum = meta.hash
        } catch (err) {
          return cb(err)
        }
        cb(null, pkg)
      })
    }
  })

  return getter
}

