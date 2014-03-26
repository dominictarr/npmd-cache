/*
 two parts: 
  - Content Addressable Store of tarballs
  - map of module_id:tarball hash

  module_id is module@version
  or http url or git url, or short github url

  If it's a module@version, or a giturl with a commit
  then it's immutable, the code it points to will never change.

  else, store the timestamp too, and freshen it if the user passes that option.

  Idea: also support sha256d?
  shouldn't use sha1 anymore...
  could detect this just by the length?

  Othewise: {sha1: hash, ts: timestamp, sha256d: hash2}

  Then the user can request a tarball by any valid id
  or by a hash, which will point to an exact version

  Then, check that both the sha1 AND the sha256d are correct.
  that will allow it to work with legacy code.
  hmm, maybe could add in signatures at this point too?

*/
var path    = require('path')
//var level   = require('level')
var levelup = require('levelup')
var locket  = require('locket')
var CAS     = require('content-addressable-store')
var cache   = require('level-content-cache')
var request = require('request')
var mkdirp  = require('mkdirp')
var npmUrl  = require('./npm-url')
var deterministic = require('./deterministic')

module.exports = function (config) {
  var get, waiting = []
  mkdirp(config.path, function () {

    var db = levelup(path.join(config.path, 'db'), {encoding: 'json', db: locket})
    var blobs = CAS(path.join(config.path, 'blobs'))
    get = cache(db, blobs, {getter: function (key, meta, cb) {
        var url = npmUrl (key)
        console.error(key, meta, url)
        //if it's a github url, must cleanup the tarball
        if(/^https?:\/\/\w+\.github\.com/.test(url))
          deterministic(request({url: url, encoding: null}), cb)
          
        else
          request({url: url, encoding: null}, function (err, response, body) {
            if(err) return cb(err)
            cb(null, body, {})
          })
        
      }})

    get.db = get
    get.cache = blobs


    //trigger all defered calls.
    while(waiting.length)
      get.apply(null, waiting.shift())

  })

  return function () {
    if(get) return get.apply(this, arguments)
    else waiting.push([].slice.call(arguments))
  }

}

if(!module.parent) {
  var opts = require('minimist')(process.argv.slice(2))
  var get = module.exports ({path: process.cwd() + '/tmp'})
  var id = opts._[0]

  get(id, opts, function (err, body, meta) {
    if(err) throw err
    console.error(meta)
    if(opts.dump !== false)
      process.stdout.write(body)
  })
}
