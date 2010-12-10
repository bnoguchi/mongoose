/**
 * @param {Schema} schema is the schema instance
 * @param {Object} obj is a hash
 * @param {Function} fn
 * @param {Array} path is the array of keys representing the property path
 */
var walk = exports.walk = function(schema, obj, fn, path, fullpath) {
  path = path || [];
  fullpath = fullpath || [];
  var curpath = path
    , curpathstr
    , keys = Object.keys(obj)
    , key
    , val;
  for (var i = 0, l = keys.length; i < l; ++i) {
    key = keys[i];
    val = obj[key];
    if ('[object Object]' == {}.toString.call(val)) {
      walk(schema, val, fn, curpath.concat(key), fullpath.concat(key));
    } else {
      if ('$' === key[0]) { // Handle query "reserved" keywords
        curpathstr = curpath.join('.');
        fn(curpathstr, fullpath.concat(key), schema.paths[curpathstr], val);
      } else {
        curpathstr = curpath.concat(key).join('.');
        fn(curpathstr, fullpath.concat(key), schema.paths[curpathstr], val);
      }
    }
  }
};

var clone = exports.clone = function(item){
  var copy;
  if (Object.prototype.toString.call(item) === '[object Array]'){
    copy = [];
    for (var i = 0; i < item.length; i++) copy[i] = clone(item[i]);
    return copy;
  } else if (typeof item == 'object') {
    copy = {};
    for (var key in item) copy[key] = clone(item[key]);
    return copy;
  } else {
    return item;
  }
};
