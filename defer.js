module.exports = function createDefer () {
  var waiting = [], ready = false
  function defer (fun) {
    return function () {
      var args = [].slice.call(arguments)
      var self = this
      if(!ready) 
        waiting.push(function () {
          return fun.apply(self, args)
        })
      else
        return fun.apply(self, args)
    }
  }

  defer.ready = function () {
    defer.ready = function () {
      throw new Error('defer.ready() called twice')
    }
    ready = true
    while(waiting.length)
      waiting.shift()()
  }

  return defer
}


