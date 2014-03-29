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


module.exports = function (config) {
  var get, db, blobs

  var defer = createDefer()

  mkdirp(config.path, function () {
    db = levelup(path.join(config.path, 'db'), {encoding: 'json', db: locket})

    //***************************************************
    //*** TODO: migrate to sha256.
    //*** sha1 is insecure, but need it to be compatible with npm.
    //***************************************************

    blobs = CAS(path.join(config.path, 'blobs'), 'sha1')

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

  var getter = defer(function () {
    return get.apply(this, arguments)
  })

  getter.resolve = defer(function (module, range, opts, cb) {
    if(!cb) cb = opts, opts = {}
    //it's a url
    if(/\//.test(range)) {
      get(range, config, next)
    }
    else if(semver.valid(range))
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
          var version = semver.maxSatisfying(Object.keys(versions), range)
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
  var get = module.exports ({path: path.join(process.env.HOME, '.npmd')})
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
