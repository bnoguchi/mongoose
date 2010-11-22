var en = require('../../support/lingo').en,
    sys = require('sys'),
    TypeSchema = require('./type'),
    Doc = require('./document'),
    clone = require('./util').clone,
    Query = require('./query').Writer;

/**
 * @constructor
 */
var Schema = module.exports = function(name, collection, mongoose){
  this.Query = function(){ Query.apply(this, arguments); };
  this.Query.prototype.__proto__ = Query.prototype;

  this.mongoose = mongoose;

  this.paths = {}; // Maps attribute names to type instances
  this._struct = []; // Stores either 1. the names of the attributes
                     //            or 2. elements like [attributeName, subtype._struct]
  this._embedded = {};
  this._current = null;
  if (typeof name == 'string'){
    this._name = name;
    this._collection = typeof collection == 'string' ? collection : en.pluralize(name);
    this._parent = null;
  } else {
    this._parent = name;
  }
  this._pres = {};
  this._posts = {};
  this._hooks = clone(Doc.Hooks);
  this._overrides = {};
  this._methods = {};
  this._statics = clone(Doc.Statics);
  this._description = [];
  this._indexes = [];
  this._compilers = [];
  
  this._staticGetters = {};
  this._staticSetters = {};
  
  this._indexes = [];

  // Used from Connection.prototype._compile as the superclass
  // to the model that is compiled
  this._model = function(){
    Doc.Document.apply(this, arguments);
  };
  sys.inherits(this._model, Doc.Document);
  Doc.defineMethod(this._model, '_schema', this);
};

/**
 * Adds an attribute <key> with <type> to this Schema instance by doing the following:
 * 1. Sets a reference to the type from this Schema instance
 * 2. Sets the _current object to the new type (enables declarative chaining)
 * 3. Add a getter <key> that returns the subtype of the type or (if no subtype) the type itself
 * 4. Add any index declared on the type to this Schema instance
 * @param {String} key is the name of the document attribute we're adding to this
 * @param {TypeSchema} type is the type instance we're assigning to the key
 * @return {Schema} this
 */
Schema.prototype._addType = function(key, type){
  this.paths[key] = type;
  this._current = type;
  // Add a getter so we can retrieve the TypeSchema instance from the Schema instance
  this.__defineGetter__(key, function(){
    var type = this.paths[key];
    if (type.subtype instanceof Schema) return type.subtype;
    else return type;
  });
  if (type._addedTo) type._addedTo(this, key, type);
  return this;
};

/**
 * @param {Object} indexHash maps index keys to their direction (-1 or 1 / 'desc' or 'asc')
 * @param {Object} options can be {unique: true} or {unique: true, dropDups: true}
 */
Schema.prototype.addIndex = function (indexHash, options) {
  var key, order, ensureIndexArgs = [[]];
  for (key in indexHash) if (indexHash.hasOwnProperty(key)) {
    order = indexHash[key];
    if (order === 'asc') {
      indexHash[key] = 1;
    } else if (order === 'desc') {
      indexHash[key] = -1;
    } else if (!(order === 1 || order === -1)) {
      throw new Error("The order in the index hash must be either: 'asc', 'desc', -1, 1");
    }
    ensureIndexArgs[0].push([key, indexHash[key]]);
  }
  if (options && options.unique) ensureIndexArgs.push(true);
  this._indexes.push(ensureIndexArgs);
  return this;
};

Schema.prototype.indexes = function(){
  return this;
};

Schema.prototype.setters = function(){
  return this;
};

Schema.prototype.getters = function(){
  return this;
};

Schema.prototype.pre = function(method, fn){
  if (!(method in this._pres)) this._pres[method] = [];
  this._pres[method].push(fn);
  return this;
};

Schema.prototype.post = function(method, fn){
  if (!(method in this._posts)) this._posts[method] = [];
  this._posts[method].push(fn);
  return this;
};

Schema.prototype.hook = function(method, fn){
  if(this._hooks[method]) this._overrides[method] = fn;
  else this._hooks[method] = fn;
  return this;
};

Schema.prototype.method = function(method, fn){
  this._methods[method] = fn;
  return this;
};

Schema.prototype.static = function(method, fn){
  this._statics[method] = fn;
  return this;
};

/**
 * Add several hooks at a time (pre-compilation).
 * Hooks are special non-enumerable methods. The standard hooks added via this method include:
 * - init(fn, obj, isNew)
 * - hydrate(fn, obj)
 * - merge(fn, obj)
 * - save(fn)
 * - remove(fn)
 * - (See document.js Doc.Hooks for more details)
 *
 * @param {Object} obj is a dictionary mapping (to-be) hook names to functions
 *                 that we want to add to this Schema's prototype.
 */
Schema.prototype.hooks = function(obj){
  for(method in obj){
    if(this._hooks[method]) this._overrides[method] = obj[method];
    else this._hooks[method] = obj[method];
  }
  return this;
};

/**
 * Add several instance (prototype) methods at a time (pre-compilation).
 * @param {Object} obj is a dictionary mapping (to-be) instance method names to functions
 *                 that we want to add to this Schema's prototype.
 */
Schema.prototype.methods = function(obj){
  for(method in obj){
    this._methods[method] = obj[method];
  }
  return this;
};

/**
 * Add several class methods at a time (pre-compilation).
 * 
 * Example:
 * schema.statics({
 *  doInception: function () {},
 *  dropToAnotherLevel: function () {}
 * });
 *
 * @param {Object} obj is a dictionary mapping (to-be) class method names to functions
 *                 that we want to add to this Schema's class methods
 * @return {Schema} this
 */
Schema.prototype.statics = function(obj){
  for(method in obj){
    this._statics[method] = obj[method];
  }
  return this;
};

Schema.prototype.staticGetter = function(name, fn){
  this._staticGetters[name] = fn;
  return this;
};

Schema.prototype.staticSetter = function(name, fn){
  this._staticSetters[name] = fn;
  return this;
}

/**
 * Add the plugin's functionality to the Schema.
 * @param {Function} fn is the decorator function
 * @param {Object} opts are the plugin options
 * @return {Schema} this
 */
Schema.prototype.plugin = function(fn,opts){
  fn(this,opts);
  return this;
};

Schema.prototype.description = function (markdown) {
  this._description.push(markdown);
  return this;
};

/**
 * Getter for the topmost ancestor in the inheritance tree.
 */
Schema.prototype.__defineGetter__('_root', function(){
  var p = this;
  while (p._parent) p = p._parent
  return p;
});

/**
 * Gets the ABSOLUTE path given the relative path represented by
 * arr. In other words,
 * - this is a Schema instance in an inheritance tree
 * - arr is a list of properties (e.g., ['user', 'name', 'first'] that
 *   looks up a value in this -- e.g., this.user.name.first
 * @param {Array} arr
 * @return {String} the absolute path string
 */
Schema.prototype.getPath = function(arr){
  var path = arr || [], p = this;
  while(p._parent){
    path.unshift(p._pkey);
    p = p._parent;
  }
  return path.join('.');
};

// Wrap TypeSchema instance methods, so we delegate the method
// to the most recently declared TypeSchema in this Schema
Object.keys(TypeSchema.prototype).forEach(function(method){
  Schema.prototype[method] = function(){
    if(!this._current) return;
    this._current[method].apply(this._current,arguments);
    return this;
  }
});
