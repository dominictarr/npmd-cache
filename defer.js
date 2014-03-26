module.exports = function createDefer () {
  var waiting = []
  function defer (fun) {
    return function () {
      var args = [].slice.call(arguments)
      var self = this
      if(waiting) 
        waiting.push(function () {
          return fun.apply(self, args)
        })
      else
        return fun.apply(self, args)
    }
  }

  defer.ready = function () {
    defer.ready = function () {
      throw new Error('defer.ready called twice')
    }
    while(waiting.length)
      waiting.shift()()
  }

  return defer
}


