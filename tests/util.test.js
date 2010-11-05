var util = require('mongoose').util
  , subclass = util.subclass;

module.exports = {
  
  'test subclass of Native constructors': function(assert, done){
    var EmbeddedArray = subclass(Array, {
      test: function(){}
    }) 
    , arr = []
    , ea = new EmbeddedArray();

    assert.ok(ea instanceof EmbeddedArray);
    assert.ok(Array.isArray(ea));
    assert.ok(ea instanceof Array);
    assert.ok(typeof ea.test == 'function');
    assert.ok(typeof arr.test == 'undefined');
    assert.ok(Object.prototype.toString.call(ea) == '[object Array]');
    done();
  }
  
};