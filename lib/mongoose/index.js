var url = require('url')
  , sys = require('sys')
  , mongo = require('../../support/node-mongodb-native/lib/mongodb')
  , DBRef = require('../../support/node-mongodb-native/lib/mongodb/bson/bson').DBRef
  , EventEmitter = require('events').EventEmitter
  , Schema = require('./schema')
  , Doc = require('./document')
  , Documentation = require('./documentation')
  , Query = require('./query').Writer
  , TypeSchema = require('./type')
  , Types = require('./types')

var Mongoose = function(){
  this._connections = [];
  this._models = {};
  this._types = {};
  this.define = this.define.bind(this); // bind(this) because of loading issues -- see Types.loadTypes in this file
  this.type = this.type.bind(this);
};

sys.inherits(Mongoose, EventEmitter);

/**
 * Initializes a new connection and adds it to the connection pool,
 * this._connections
 * @param {String} uri of the mongodb server (mongodb://...)
 * @param {Object} options is a hash of options
 * @param {Function} callback is the callback function
 * @return {Connection} the created connection
 */
Mongoose.prototype.connect = function(uri, options, callback){
  var conn = new Connection(uri, options, callback, this);
  this._connections.push(conn);
  return conn;
};

/**
 * Closes each connection in the connection pool, this._connections
 * @param {Function} callback with profile function (err) {...} to be called on any error
 *                   that occurs attempting to close a connection or called after all
 *                   connections have been closed.
 */
Mongoose.prototype.disconnect = function(callback){
  var i = 0
    , self = this
    , length = this._connections.length;
  this._connections.forEach(function(c, i){
    c.disconnect = true;
    c.close(function(err){
      if (err) return callback ? callback(err) : null;
      if (++i == length){
        self._connections = [];
        if(callback) callback(null);
      }
    });
  });
};

Mongoose.prototype.new = function(){
    var instance = new Mongoose();
    Types.loadTypes(instance);
    return instance;
};

/**
 * Factory method to define new schemas.
 * 1. Initializes the new Schema
 * 2. Adds a reference to the schema in this._models (to be used later during Connection.prototype._compile)
 * 3. Adds a shortcut getter, name, that delegates to this.connection, which compiles the model (if it hasn't done so already) and returns it.
 * @param {String} name of the schema.
 * @return {Schema} schema that was just initialized
 */
Mongoose.prototype.define = function(name, collection){
  var schema = new Schema(name, collection, this);
  if (typeof name == 'string'){
    if (name in Mongoose.prototype || name in Connection.prototype){
      throw new Error('Name conflict "'+ name +'". Please choose a different model name.');
    }
    this._models[name] = schema;
    /**
     * Exposes the model to the client.
     * e.g., new mongoose.User({...});
     * The first time we call mongoose.<name>, the connection compiles the model.
     */
    this.__defineGetter__(name, function(){
      if (this.connection){
        return this.connection.model(name);
      }
      else return null;
    });
  }
  return schema;
};

/**
 * When only `name` is given and the type exists, return it,
 * otherwise a new `TypeSchema` is created and returned for modification.
 * 
 * You may also specify an `alias` for your type, for example "boolean" is
 * aliased as "bool".
 *
 * @param {String} name
 * @param {String} alias
 * @return {TypeSchema}
 * @api public
 */

Mongoose.prototype.type = function(name, alias){
  if(name && this._types[name]) return this._types[name];
  else {
    var mongoose = this;

    // Exposes a shortcut factory method for declaring type instances
    // from the document definition chain
    /**
     * @param {String} key is the name of the attribute
     * @param {Object|Schema} subtype
     * @param {Object} options is a JSON object. It's used for dbreffedArray to tell the schema what attribute name the other schema is using to refer to it
     * @return {Schema} this
     */
    Schema.prototype[name] = Schema.prototype[alias || name] = function (key, subtype, options){
      var schemaType = function(){
        TypeSchema.apply(this,arguments);
        this.options = options;
      };
      schemaType.prototype = mongoose._types[name];
      
      var path = this.getPath([key]);

      this._addType(key, new schemaType(name, key, subtype, this));
      
      if (subtype instanceof Schema) {
        if(name == 'array'){
          this._struct.push(key);
          this._root._embedded[path] = subtype;
          subtype._pkey = key;
        } else if (name == 'object') {
          subtype._parent = this;
          this._struct.push([key, subtype._struct]);
          for(prop in subtype.paths){
            this.paths[key+'.'+prop] = subtype.paths[prop];
          }
          subtype._pkey = key;
        } else {
          this._struct.push(key);
        }
      } else {
        this._struct.push(key);
      }
      var setups = this.paths[key].setups;
      for (var i=0, l=setups.length; i<l; i++) setups[i].call(this, key, path);
      return this;
    };
    return this._types[name] = new TypeSchema(name); // Used above in Schema.prototype[name]
  }
};

/**
 * Generate documentation with the given `options`.
 *
 * Options:
 *
 *    - `title`     page title when using _decorate_
 *    - `decorate`  generated styled html output, defaulting to true 
 *    - `models`    an array of model names, defaults to all models
 *    - `dest`      destination output directory defaulting to the __CWD__
 *    - `markdown`  generate markdown output
 *    - `html`      generate html output
 *
 * @param {Object} options
 * @api public
 */

Mongoose.prototype.documentation = function(options){
  var self = this;
  options = options || {};
  if (options.models) {
    options.models = options.models.reduce(function(obj, name){
      obj[name] = self._models[name];
      return obj;
    }, {});
  } else {
    options.models = this._models;
  }
  new Documentation(options).generate();
};

/**
 * A getter that returns the first connection in the connection pool.
 */
Mongoose.prototype.__defineGetter__('connection', function(){
  return this._connections[0];
});

/**
 * A getter that specifies if we have attempted to connect AND
 * the connection has been opened.
 */
Mongoose.prototype.__defineGetter__('connected', function(){
  return this.connection && this.connection.open;
});

exports = module.exports = new Mongoose();
exports.Document = require('./document').Document;
exports.Schema = require('./schema');
exports.TypeSchema = require('./type');
exports.util = require('./util');
exports.ObjectID = mongo.BSONPure.ObjectID;
exports.DBRef = DBRef;

Types.loadTypes(exports);

/**
 * @constructor
 * Assigns
 * - name
 * - host
 * - port
 * - user (optional)
 * - pass (optional)
 * - _collections
 * - _compiled
 * - _db
 * Begins opening the connection and attempting authentication.
 * Asyncrhonously invokes a callback if successful.
 * @param {String} uri is the address of the mongodb database
 * @param {Object} options hash
 * @param {Function} optional callback
 */
var Connection = this.Connection = function(uri, callback){
  var _uri = url.parse(uri)
    , options = typeof callback !== 'function' ? callback : {}
    , self = this;
  callback = typeof callback == 'function' ? callback : arguments[2]
  if (_uri.protocol !== 'mongodb:') throw new Error('Please include the mongodb:// protocol');
  this.name = _uri.pathname.replace(/\//g, '');
  this.host = _uri.hostname;
  this.port = _uri.port || 27017;
  this.mongoose = arguments[arguments.length-1];
  if (_uri.auth){
    var auth = _uri.auth.split(':')[0];
    this.user = auth[0];
    this.pass = auth[1];
  }
  if (!this.host) throw new Error('Please provide a hostname')
  if (!this.name) throw new Error('Please provide a database name');
  this._collections = {}; // Maps model name to the Collection instance
  this._compiled = {}; // Maps the model names to compiled models
  this._db = new mongo.Db(this.name, new mongo.Server(this.host, this.port, options));
  this._db.open(function(err){
    if (err) return callback ? callback(err) : null;
    if(self.disconnect) self.close(callback || function(){});
    if(self.user){
      self._db.authenticate(self.user, db.pass, function(){
        self._onOpen();
        if (callback) callback(null);
      });
    } else {
      self._onOpen();
      if (callback) callback(null);
    }
  });
};

sys.inherits(Connection, EventEmitter);

/**
 * Invoked when the connection is opened successfully and passes (optional) authentication (AND we haven't already asked the connection to disconnect).
 * We iterate through the collections and add each collection to the db.
 * Finally, we emit the "connect" event.
 */
Connection.prototype._onOpen = function(){
  if(this.disconnect) return; // If we've placed a command to close this connection before we trigger _onOpen, then do nothing
  this.open = true;
  for (var i in this._collections) this._collections[i]._setDb(this._db);
  this.emit('connect');
};

/**
 * 1. Initializes a new Collection to this connection's dictionary of
 * collections (if it doesn't already exist).
 * 2. Sets the db of the collection to this connection's db (if the connection is open)
 * 3. Returns the collection
 *
 * Used in Connection.prototype._compile in assigning a collection to model._collection
 * @param {String} name
 * @return {Collection}
 */
Connection.prototype.collection = function(name){
  if (!(name in this._collections)) this._collections[name] = new Collection(this, name);
  if (this.open) this._collections[name]._setDb(this._db);
  return this._collections[name];
};

/**
 * Either
 * 1. Compiles the model and returns it
 * 2. Returns the compiled model if it is already compiled
 * @param {String} name of the model
 * @return {Function}
 */
Connection.prototype.model = function(name){
  if (name in this._compiled) return this._compiled[name];
  return this._compiled[name] = this._compile(name);
};

/**
 * Compiles the model
 * 1. Creates a new constructor (model) that inherits from the approprite schema's model
 *    -- i.e., mongoose._models[name]._model (mongoose._models[name] is a Schema instance)
 *    which itself inherits from Doc.Document
 * 2. Assigns this as the new model's connection
 * 3. Assigns a collection to the new model.
 * 4. Adds the declared hooks (in mongoose.models[name]._methods) to the model
 * 5. Adds the declared methods (in mongoose.models[name]._hooks) to the model
 * 6. Adds the declared static class methods (in mongoose.models[name]._statics) to the model
 * 7. Compile the getters and setters
 * 8. Register any declared indexes with mongodb server.
 * @param {String} name is the name of the model
 * @return {Function} an new model constructor (inheritance is model < schema._model < Doc.Document)
 */
Connection.prototype._compile = function(name){
  var schema = this.mongoose._models[name], prop,
      /**
       * This is the model constructor we return
       */ 
      model = function(){
        schema._model.apply(this, arguments);
        this._model = model;
      };
  sys.inherits(model, schema._model);

  // Make the schema accessible directly from the constructor (useful in Query.Writer -- see query.js)
  model._schema = schema;

  // Make the connection and collection accessible from the constructor (class method) ...
  model._connection = this;
  var collection = model._collection = this.collection(schema._collection);

  // ... and also make the connection & collection accessible from any model instances (instance methods)
  Doc.defineMethod(model, '_connection', this);
  Doc.defineMethod(model, '_collection', model._collection);

  model.Query = schema.Query;
  var queryKeys = Object.keys(Query.prototype);
  for(prop in schema._hooks) Doc.defineHook(model, prop, schema._hooks[prop]);
  for(prop in schema._methods) Doc.defineMethod(model, prop, schema._methods[prop]);
  for(prop in schema._statics) {
    model[prop] = schema._statics[prop];
    if (!~queryKeys.indexOf(prop)) {
      model.Query.prototype[prop] = schema._statics[prop];
    }
  }
  for(prop in schema._staticGetters) {
    model.__defineGetter__(prop, schema._staticGetters[prop]);
    model.Query.prototype.__defineGetter__(prop, schema._staticGetters[prop]);
  }
  for(prop in schema._staticSetters) {
    model.__defineSetter__(prop, schema._staticSetters[prop]);
    model.Query.prototype.__defineSetter__(prop, schema._staticSetters[prop]);
  }
  
  for(path in schema.paths){
    if(typeof schema.paths[path]._compiler == 'function') schema._compilers.push(path);
  }

  Doc.compileEtters(schema._struct, model.prototype);
  for(embedded in schema._embedded){
    schema._embedded[embedded] = this._compileEmbedded(schema._embedded[embedded]);
  }

  // Register all your indexes with mongodb
  var ensureIndexArgs,
      self = this;
  schema._indexes.forEach( function (ensureIndexArgs) {
    ensureIndexArgs.push( function (err, indexName) {
      // TODO Anonymous fn -> Pre-defined fn
      if (err) {
        throw err;
      }
    });
    collection.createIndex.apply(collection, ensureIndexArgs);
  });
  return model;
};

Connection.prototype._compileEmbedded = function(schema){
    var model = function(){
      Doc.Document.apply(this, arguments);
    };
    sys.inherits(model, Doc.Document);
    Doc.defineMethod(model, '_schema',  schema);
    Doc.defineMethod(model, '_getters', {});
    for(prop in schema._hooks) Doc.defineHook(model, prop, schema._hooks[prop]);
    Doc.compileEtters(schema._struct, model.prototype);
    return model;
};

Connection.prototype.close = function(callback){
  if(this._db.state == 'notConnected') return;
  if (this.open || this.disconnect) {
    var self = this;
    this._db.close(function (err) {
      if (err) return callback ? callback(err) : null;
      self.open = false;
      if (callback) callback(null);
      self.emit('close');
    });
    // temporary, until -native close() fires a callback
    this.open = false;
    if (callback) callback(null);
    this.emit('close');
  }
  return this;
};

/**
 * @constructor
 * @param {Connection} base is the connection that this collection is associated with
 * @param {String} name is the name of the collection
 */
var Collection = this.Collection = function(base, name){
  this.base = base;
  this.name = name;
  this._queued = [];
};

Collection.prototype._setDb = function(db){
  var self = this;
  var name = this.name; // TODO Remove
  db.createCollection(this.name, function(err, collection){
    if (err) return self.base.emit('error', err);
    self._setCollection(collection);
  });
};

Collection.prototype._setCollection = function(c){
  this._collection = c;
  this._process();
};

Collection.prototype._queue = function(method, args){
  if (this._collection) return this._collection[method].apply(this._collection, args);
  this._queued.push([method, args]);
};

Collection.prototype._process = function(){
  var a;
  while (a = this._queued.shift()) {
    this._collection[a[0]].apply(this._collection, a[1]);
  }
  return this;
};

// Wrap native mongodb Collection methods, so calling them from our (distinctly non-native mongodb)
// Collection interface either:
// 1. If the collection's db has already been set asynchronously, then invoke the method.
// 2. If the collection's db hasn't yet successfully been set asynchronously, then queues up the
//    methods and calls them as soon as the collection's db has been set.
for (var i in require('../../support/node-mongodb-native/lib/mongodb/collection').Collection.prototype){
  (function(name){
    if (!(name in Collection.prototype)){
      Collection.prototype[name] = function(){
        return this._queue(name, arguments);
      };
    }
  })(i);
}
