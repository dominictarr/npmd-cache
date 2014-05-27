
//TODO: redo all of this with tests and stuff...

var github = require('npm-github-resolve-url')
var semver = require('semver')

module.exports = function (pkg, config) {
  config = config || {}
  var registry = config.registry || 'https://registry.npmjs.org'
  var name, version, m
  //pkg
  if('object' === typeof pkg && pkg.name && pkg.version) {
    name = pkg.name
    version = pkg.version
  }
  //module@version
  else if(m = /^([\w._-]+)@(.*)$/.exec(pkg)) {
    name = m[1]
    version = m[2]
    if(semver.validRange(version))
      return registry + '/' + name + '/-/' + name + '-' + version + '.tgz'
    //else, assume it's a url.
    return version
  }
  
  //handle multilpe type of github urls,
  //including git urls (which will download from github http download api)
  if(m = github(pkg))
    return m

  //http url
  else if(/(https?:\/\/.+)/.test(pkg)) {
    return pkg
  } 
  
  throw new Error('loading modules from format:' + pkg + 'not yet implemented')
}


