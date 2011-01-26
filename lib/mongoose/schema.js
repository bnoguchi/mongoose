
/**
 * Module dependencies.
 */

var EventEmitter = require('events').EventEmitter
  , Types = require('./schema/')
  , utils = require('./utils');

/**
 * Schema constructor.
 *
 * @param {Object} definition
 * @api public
 */

function Schema (obj, options) {
  this.paths = {};
  this.inherits = {};
  this.callQueue = [];
  this._indexes = [];
  this._methods = {};
  this._statics = {};
  this.tree = {};
  if (obj)
    this.add(obj);
  this.add({ _id: ObjectId });
  this.options = utils.options({
    safe: false
  }, options);
};

/**
 * Inherit from EventEmitter.
 */

Schema.prototype.__proto__ = EventEmitter.prototype;

/**
 * Schema by paths
 *
 * Example (embedded doc):
 *    {
 *        'test'       : SchemaType,
 *      , 'test.test'  : SchemaType,
 *      , 'first_name' : SchemaType
 *    }
 *
 * @api private
 */

Schema.prototype.paths;

/**
 * Schema as a tree
 *
 * Example:
 *    {
 *        '_id'     : ObjectId
 *      , 'nested'  : {
 *            'key': String
 *        }
 *    }
 *
 * @api private
 */

Schema.prototype.tree;

/**
 * Sets the keys
 *
 * @param {Object} keys
 * @param {String} prefix
 * @api public
 */

Schema.prototype.add = function (obj, prefix) {
  prefix = prefix || '';
  for (var i in obj){
    // make sure set of keys are in `tree`
    if (!prefix && !this.tree[i])
      this.tree[i] = obj[i];

    if (obj[i].constructor == Object && (!obj[i].type || obj[i].__nested))
      this.add(obj[i], i + '.');
    else
      this.path(prefix + i, obj[i]);
  }
};

/**
 * Sets a path (if arity 2)
 * Gets a path (if arity 1)
 *
 * @param {String} path
 * @param {Object} constructor
 * @api public
 */

Schema.prototype.path = function (path, obj) {
  if (obj == undefined)
    return this.paths[path];

  if (obj.constructor != Object)
    obj = { type: obj };

  var type = obj.type;

  if (Array.isArray(type) || type == Array){
    // if it was specified through { type } look for `cast`
    var cast = type == Array ? obj.cast : type[0];

    if (cast instanceof Schema)
      this.paths[path] = new Types.DocumentArray(path, cast, obj);
    else 
      this.paths[path] = new Types.Array(path, cast, obj);
  } else
    this.paths[path] = new Types[type.name](path, obj);
};

/**
 * Iterates through the schema's paths, passing the path string and type object
 * to the callback.
 *
 * @param {Function} callback function - fn(pathstring, type)
 * @return {Schema} this for chaining
 * @api public
 */

Schema.prototype.eachPath = function (fn) {
  for (var k in this.paths)
    if (this.paths.hasOwnProperty(k))
      fn(k, this.paths[k]);
  return this;
};

/**
 * Adds a method call to the queue
 *
 * @param {String} method name
 * @param {Array} arguments
 * @api private
 */

Schema.prototype.queue = function(name, args){
  this.callQueue.push([name, args]);
  return this;
};

/**
 * Defines a pre for the document
 *
 * @param {String} method
 * @param {Function} callback
 * @api public
 */

Schema.prototype.pre = function(){
  return this.queue('pre', arguments);
};

/**
 * Defines a post for the document
 *
 * @param {String} method
 * @param {Function} callback
 * @api public
 */

Schema.prototype.post = function(method, fn){
  return this.queue('on', arguments);
};

/**
 * Registers a plugin for this schema
 *
 * @param {Function} plugin callback
 * @api public
 */

Schema.prototype.plugin = function (fn) {
  fn(this);
  return this;
};

/**
 * Adds a method
 *
 * @param {String} method name
 * @param {Function} handler
 * @api public
 */

Schema.prototype.method = function (name, fn) {
  this._methods[name] = fn;
  return this;
};

/**
 * Adds several methods
 *
 * @param {Object} handlers by name
 * @api public
 */

Schema.prototype.methods = function (obj) {
  if (obj)
    for (var i in obj)
      this._methods[i] = obj[i];
  return this;
};

/**
 * Defines a static method
 *
 * @param {String} name
 * @param {Function} handler
 * @api public
 */

Schema.prototype.static = function(name, fn) {
  this._statics[name] = fn;
  return this;
};

/**
 * Adds several statics
 *
 * @param {Object} handlers by name
 * @api public
 */

Schema.prototype.statics = function (obj) {
  if (obj)
    for (var i in obj)
      this._statics[i] = obj[i];
  return this;
};

/**
 * Defines an index (most likely compound)
 * Example:
 *    schema.index({ first: 1, last: -1 }, true })
 *
 * @param {Object} field
 * @param {Object} optional options object
 * @api public
 */

Schema.prototype.index = function (fields, options) {
  this._indexes.push([fields, options || {}]);
  return this;
};

/**
 * Sets/gets an option
 *
 * @param {String} key
 * @param {Object} optional value
 * @api public
 */

Schema.prototype.option = function (key, value) {
  if (arguments.length == 1)
    return this.options[key];
  this.options[key] = value;
  return this;
};

/**
 * Compiles indexes from fields and schema-level indexes
 *
 * @api public
 */

Schema.prototype.__defineGetter__('indexes', function () {
  var index
    , indexes = [];
  for (var i in this.paths){
    index = this.paths[i]._index;
    if (index !== false && index !== null){
      var field = {};
      field[i] = 1;
      indexes.push([field, index.constructor == Object ? index : {} ]);
    }
  }
  return indexes.concat(this._indexes);
});

['default', 'set', 'get', 'validate', 'required'].forEach( function (method) {
  Schema.prototype[method] = function () {
    if (!this._current) throw new Error("You must call '" + method + "' only after building a type when Schema building.");
    this._current[method].apply(this, arguments); // Delegate to the SchemaType
    return this;
  };
});

Schema.prototype.singleIndex = function () { // Must name singleIndex; otherwise name collision with `Schema.prototype.index`
  if (!this._current) throw new Error("You must call 'index' only after building a type when Schema building.");
  this._current.index.apply(this, arguments); // Delegate to the SchemaType
  return this;
};

['min', 'max'].forEach( function (method) {
  Schema.prototype[method] = function () {
    if (!this._current) throw new Error("You must call '" + method + "' only after building a type when Schema building.");
    if (! (this._current instanceof Types.Number)) throw new Error("You may only use '" + method + "' on a Number.");
    this._current[method].apply(this, arguments);
    return this;
  };
});

['enum', 'match'].forEach( function (method) {
  Schema.prototype[method] = function () {
    if (!this._current) throw new Error("You must call '" + method + "' only after building a type when Schema building.");
    if (! (this._current instanceof Types.String)) throw new Error("You may only use '" + method + "' on a String.");
    this._current[method].apply(this, arguments);
    return this;
  };
});

Schema.build = function () {
  return new Schema();
};

Schema.prototype.string = function (path) {
  var obj = {};
  obj[path] = String;
  this.add(obj);
  this._current = this.path(path);
  return this;
};

Schema.prototype.number = function (path) {
  var obj = {};
  obj[path] = Number;
  this.add(obj);
  this._current = this.path(path);
  return this;
};

Schema.prototype.date = function (path) {
  var obj = {};
  obj[path] = Date;
  this.add(obj);
  this._current = this.path(path);
  return this;
};

Schema.prototype.boolean = function (path) {
  var obj = {};
  obj[path] = Boolean; 
  this.add(obj);
  this._current = this.path(path);
  return this;
};

Schema.prototype.array = function (path, type) {
  var obj = {};
  obj[path] = [type];
  this.add(obj);
  this._current = this.path(path);
  return this;
};

Schema.prototype.object = function (path, schema) {
  var obj = {}
    , nested = obj[path] = {};
  schema.eachPath( function (nestedPath, type) {
    if (nestedPath === '_id') return;
    if (type instanceof Types.DocumentArray) {
      nested[nestedPath] = {type: Array, cast: type.caster};
    } else if (type instanceof Types.Array) {
      nested[nestedPath] = {type: Array, cast: type.caster};
    } else if (type instanceof Types.Number) {
      nested[nestedPath] = Number;
    } else if (type instanceof Types.String) {
      nested[nestedPath] = String;
    } else if (type instanceof Types.Date) {
      nested[nestedPath] = Date;
    } else if (type instanceof Types.Boolean) {
      nested[nestedPath] = Boolean;
    } else if (type instanceof Types.ObjectId) {
      nested[nestedPath] = ObjectId;
    } else {
      throw new Error("Type not supported by builder.");
    }
  });
  this.add(obj);
  this._current = this.path(path);
  return this;
};

/**
 * ObjectId schema identifier. Not an actual ObjectId, only used for Schemas.
 *
 * @api public
 */

function ObjectId () {
  throw new Error('This is an abstract interface. Its only purpose is to mark '
                + 'fields as ObjectId in the schema creation.');
}

/**
 * Module exports.
 */

module.exports = exports = Schema;

exports.Types = Types;

exports.ObjectId = ObjectId;
