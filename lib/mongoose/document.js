var sys = require('sys')
  , Subclass = require('./util').subclass
  , Schema = require('./schema')
  , EventEmitter = require('events').EventEmitter
  , ObjectID = require("../../support/node-mongodb-native/lib/mongodb").BSONPure.ObjectID;

/**
 * @constructor
 * This is what every model class inherits from. i.e., mongoose.User inherits
 * from Document.
 * Can be used in either of the following 2 ways:
 * - new Document(callback, obj [, hydrate]);
 * - new Document(obj [, hydrate]);
 */
var Document = function(){
  // Bundle all properties we don't want to enumerate through under _
  Object.defineProperty(this, '_', {value: {
    doc: {}, // The hash/json representation of the document
    pres: {}, // A hash mapping method/task names to the lists of functions that should be executed before those methods are invoked
    posts: {}, // A hash mapping method names to the lists of functions that should be executed before those methods are invoked
    arrays: {},
    dbrefs: {},
    dbrefArrays: {},
    dbreffedArrays: {},
    dirty: {}, // Keeps track of which property paths have been assigned a new value
    hydrated: {}, // properties that have been hydrated, only set when hydrate flag = true
    errors: [],
    fields: this._getFields(arguments[2]) // todo fails if callback is pass as well.
  }});
  Object.defineProperty(this, '_getters', {value: {}, enumerable: false});
  var idx = (typeof arguments[0] == 'function') ? 1 : 0;
  this.isNew = !arguments[idx+1];
  this.init((idx) ? arguments[0] : null, arguments[idx], this.isNew);
};

sys.inherits(Document, EventEmitter);

Object.defineProperty(Document.prototype, 'isNew',{
  get: function(){ return this._.isNew; },
  set: function(val){ this._.isNew = val; }
});

Document.prototype._getFields = function(partial){
  
  if(partial == undefined) return;
  
  var fields = {}
    , partials = Object.keys(partial)
    , include = partial[partials[0]];

  if(include){
    for(var i = 0, l = partials.length; i < l; i++){
      var key = partials[i]
        , path = key.split('.');
      fields[key] = true;
      while(path.pop() && path.length) fields[ path.join('.') ] = true;
    }
  } else {
    var paths = Object.keys(this._schema.paths)
      , exclude = [];
    for(var i = 0, l = paths.length; i < l; i++){
      var key = paths[i]
        , path = key.split('.')
        , k = 0;
      while(k < path.length){
        var part = path.slice(0, ++k).join('.');
        if(typeof partial[part] === 'undefined') fields[part] = true;
        else k = path.length;
      }
    }
  }
  return fields;
};

Document.prototype.hydrated = function(path){
  return !!this._.hydrated[path];
};

// TODO Does this work when path points to an EmbeddedArray?
Document.prototype.isDirty = function(path){
  return !!this._.dirty[path];
};

Document.prototype._getDirty = function(){
  var obj = {}
    , _dirty = Object.keys(this._.dirty);
    
  for(var i=0,l=_dirty.length; i<l; i++){
    obj[_dirty[i]] = this._get(_dirty[i]);
  }
  return obj;
};

Document.prototype.inspect = function(){
  return '[' 
    + this._schema._name 
    + ' ' + sys.inspect(this._)
    + ']';
};

Document.prototype.loadedField = function(path){
  var fields = this._.fields;
  return !fields || fields[path];
};

/**
 * An important method that powers the Hook methods: init, hydrate, and merge.
 * It's also used recursively within itself (i.e., _setData calls _setData)
 * @param {Array} struct is an array of members that can be either:
 *   1. A model attribute name that define this (for cases where this is embedded in another document)
 *   2. Or an array (pair) [the attribute name, array of sub attribute names of the attribute name]

 * @param {Object} obj is the hash of data changes we want to make
 * @param {Object} val is our current JSON representation of the data
 * @param {Array} path is the array of property names that define this (for cases where this is embedded in another document)
 * @param {Boolean} override is true if we don't want hydration; false if we do want hydration. true seems to run our declared setters. false seems to skip our declared setters and assign the value directly to val (which is this._.doc)
 * @return {Array} [count, flag]
 */
Document.prototype._setData = function(struct, obj, val, path, override){
  // TODO Doc.compileEtters has a similar function format. Factor out common pattern.
  var path = path || []
    , count = flag = 0 
    , prop
    , curpath
    , schema = this._schema;
  // We only iterate through the DEFINED attributes (via struct). This means we toss out any
  // ad hoc attributes by default. This is by design, for data sanitation.
  for (var i=0, l=struct.length; i<l; i++, count++) {
    prop = struct[i];
    if (typeof prop === "string") {
      curpath = path.concat(prop).join('.');
      if (obj.hasOwnProperty(prop)) {
        flag++;
        this.set(curpath, obj[prop], override);
      } else if (override && (undefined !== schema.paths[curpath]._default)) {
        if(!this._.fields || this.loadedField(curpath)){
          var def = schema.paths[curpath]._default; // def can be a Function or anything else
          if ('function' == typeof def) def = def.call(this);
          this.set(curpath, def); 
        }
      }
    } else {
      prop = struct[i][0];
      if(obj.hasOwnProperty(prop) && !Array.isArray(obj[prop]) && typeof obj[prop] == 'object'){
        flag++;
        if (typeof val[prop] === "undefined") val[prop] = {};
        var children = this._setData(struct[i][1], obj[prop], val[prop], path.concat(prop), override);
        count += children[0];
        flag += children[1];
      }
    }
  }
  if(!override && flag == count) this._.hydrated[ (path.length) ? path.join('.') : ''] = true;
  return [count, flag];
};

/**
 * This is called every time we run a hook.
 * Standard and custom hooks are compiled into the model at runtime.
 * When we call a hook -- e.g., user.save(...) -- we are really just calling
 * a wrapper function around Document.prototype._run (See Doc.Statics.defineHook 
 * where we call _run from.)
 *
 * _run does the following:
 * - Setup:
 *   1. If the hook is 'init' and we are passing args, then add the pre and post actions of 'merge'
 *      to 'init' pre and post actions
 *      Else If the hook is 'init' and we are not passing args, then add the pre and post actions 
 *      of 'hydrate' to 'init' pre and post actions
 *   2. Adds the post actions to the hook (aka task) callback that gets run after hook invocation
 * - Invocation:
 *   1. Invoke all the pre actions
 *   2a. If the hook/task is 'save', then call _validate(fn, args)
 *   2b. If the hook/task is not 'save', then call override to invoke the function or (if no
 *       override) then just invoke the function.
 *   
 * @param {String} name is the name of the hook.
 * @param {Function} fn is the function that is invoked when we run this hook
 * @param {typeof arguments} args are the arguments that the fn will accept on invocation.
 *  The typical arguments will be of the form (callback, )
 */
Document.prototype._run = function(name, fn, args){
  var args = Array.prototype.slice.call(args),
      pres = (this._schema._pres[name] || []).concat(this._.pres[name] || []),
      posts = (this._schema._posts[name] || []).concat(this._.posts[name] || []),
      override = this._schema._overrides[name],
      self = this;
  
  if(name == 'init'){
    var dataName = (args[2]) ? 'merge' : 'hydrate';
        pres = pres.concat(this._schema._pres[dataName] || [], this._.pres[dataName] || []);
        posts = posts.concat(this._schema._posts[dataName] || [], this._.posts[dataName] || []);
  }

  var total = pres.length
    , current = -1
    , next = function(err){
        if(err) self._.errors.push(err);
        while(++current < total  && pres[current].length == 0 ){
          pres[current].call(self, next, done); 
        }
        if(current < total) pres[current].call(self, next, done);
        else done.apply(self);
      }
    , done = function(err){
        current = total;
        if(err) self._.errors.push(err);
        if(override) override.apply(self, [fn.bind(self)].concat(args));
        else fn.apply(this, args);
        
        process.nextTick(function(){
          var total = posts.length
            , current = -1
            , next = function(){
               while(++current < total  && posts[current].length == 0 ){
                 posts[current].call(self, next, done); 
               }
               if(current < total) posts[current].call(self, next, done);
              }
            , done = function(){ current = total; };
          if(total) next();
        });
        
      };
  
  if(name == 'save'){
    var compilers = this._schema._compilers;
    for(var i=0, l = compilers.length; i < l; i++){
      var path = compilers[i]
        , type = this._schema.paths[path];  
      type._compiler.call(this, path, type);
    }
    this._validate(next, args);
  } else { 
    next();
  }
};

/**
 * @param {Function} override
 * @param {Function} fn
 * @param {Array} args
 */
Document.prototype._validate = function(fn, args){
  var path, def, validators, validator, cb, v, len, self = this,
      toValidate = [],
      dirty = this._.dirty,
      grandtotal = 0,
      
  complete = function () {
    if(--grandtotal <= 0) fn();
  };
 
  for (path in dirty) { 
    def = this._schema.paths[path];
    validators = (def && typeof def.validators == 'object') ? Object.keys(def.validators) : [];
    
    if(validators.length){
      grandtotal += validators.length;
      for(v=0,len=validators.length; v<len; v++){
        validator = validators[v];
        cb = (function(v,p,t,scope){
          return function(passed,msg){
            if (!passed) {
              msg = msg || 'validation ' + v + ' failed for ' + p;
              var err = new Error(msg);
              err.type = 'validation';
              err.path = p;
              err.name = v;
              scope._.errors.push(err);
            }
            complete();
          };
        })(validator, path, def.type, self);
        toValidate.push([def.validators[validator], [this._get(path), cb]]);
      }
    }
  }
  
  for(var i=0,l=toValidate.length; i<l; i++){ 
    toValidate[i][0].apply(this, toValidate[i][1]);
  }
  if(!toValidate.length) complete();
};

/**
 * Gets the value located at path.
 * @param {String} path is the relative (to this._.doc) path of keys that locates a particular property. An example is "user.name.first"
 * @return {Object} the value located at the path
 */
Document.prototype._get = function(path){
  var parts = path.split('.'), doc = this._.doc;
  for (var i = 0, l = parts.length; i < l; i++){
    doc = doc[parts[i]];
    if (typeof doc == 'undefined'){
      return undefined;
    }
  }
  return doc;
};

/**
 * Looks up path in this._schema.paths hash and returns the appropriate value that should
 * correspond to the path in this document. What is returned depends on the type that is
 * located at the path.
 * Used from Doc.compileEtters
 * @param {String} path is string representing a chain of keys to traverse inside the document
 * @return
 */
Document.prototype.get = function(path){
  var type = this._schema.paths[path], i, l, prop, val = this._get(path);
  if(!type) return undefined;
  if(type.type == 'object'){
   // TODO
  } else {
   if(typeof type._castGet == 'function') val = type._castGet.call(this, val, path, type);
   for(i=0,l=type.getters.length; i<l; i++) val = type.getters[i].call(this, val, path, type);
   return val;
  }
};

/**
 * Sets a value at the location defined by the path in the json representation of the doc.
 * Marks the path as dirty.
 * @param {String} path is string representing a chain of keys to traverse inside the document
 * @param {Object} val is the value we want to set the value located at path to
 */
Document.prototype._set = function(path, val, isSetViaHydration){
  var parts = path.split('.'), doc = this._.doc, prev = this._.doc;
  for (var i = 0, l = parts.length-1; i < l; i++){
    doc = doc[parts[i]];
    if (typeof doc == 'undefined'){
      doc = prev = prev[parts[i]] = {};
    }
  }
  if (doc[parts[parts.length-1]] !== val) {
    doc[parts[parts.length-1]] = val;
    if (!isSetViaHydration) {
      var type = this._schema.paths[path];
      if (type.type === "array") {
        this._.dirty[path] = [];
      } else {
        this._.dirty[path] = true;
      }
    }
  }
};

/**
 * Sets a value at the location defined by the path in the document.
 * Takes into account the type that's supposed to be at path.
 * Transforms the val via setters and typecasters and then assigns that value to the
 * canonical json representation.
 *
 * How is it used?
 * Invoked by the client directly and wrapped in the getters/setters defined by compileEtters.
 *
 * @param {String} path is string representing a chain of keys to traverse inside the document
 * @param {Object} val is the value we want to set the value located at path to
 * @param {Boolean} override is true if we don't want hydration; false if we do want hydration.
 */
Document.prototype.set = function (path, val, override) {
  var type = this._schema.paths[path], i, prop,
      json = this._.doc;
      
  if(!type) return;
  if (typeof override === "undefined") override = true;
  if (override) {
    if(typeof type._init == 'function') val = type._init.call(this, val, path, false);
    var setters = type.setters;
    for (i=setters.length-1; i>=0; i--) {
      try {
        var ret = setters[i].call(this, val, path, type);
        if (Error == ret) { // TODO In 2 places (see several lines below for other TODO)
          var err = new Error('failed to cast ' + path + ' value of ' + JSON.stringify(val) + ' to ' + type.type);
          err.type = 'cercion';
          this._.errors.push(err); 
        } else {
          val = ret;
        }
      } catch (err) {
        this._.errors.push(err);
      }
    }
    if (typeof type._castSet === "function") {
      var ret = type._castSet.call(this, val, path, type);
      if (Error === ret) { // TODO In 2 places (see several lines above for other TODO)
        var err = new Error('failed to cast ' + path + ' value of ' + JSON.stringify(val) + ' to ' + type.type);
        err.type = 'cercion';
        this._.errors.push(err); 
      } else {
        val = ret;
      }
    }
    if (type.type !== "virtual") this._set(path, val);
  } else {
    if (type.type !== "virtual") {
      if(typeof type._init == 'function') val = type._init.call(this, val, path, true);
      this._set(path, val, true);
      this._.hydrated[path] = true;
      this.emit('hydrate', [path, val]); // What's the use case for hydration listeners
    }
  }
};

/**
 * Adds fn to the list of functions we'd like to invoke before we invoke the function known
 * as method.
 * @param {String} method is the name of the method that we'd like fn to run before
 * @param {Function} fn is the callback we'd like to run just before the function named method is invoked
 * @return {Document} this
 */
Document.prototype.pre = function(method, fn){
  if (!(method in this._.pres)) this._.pres[method] = [];
  this._.pres[method].push(fn);
  return this;
};

/**
 * The mirror sibling function to Document.prototype.pre.
 * Adds fn to the list of functions we'd like to invoke before we invoke the function known
 * as method.
 * @param {String} method is the name of the method that we'd like fn to run after
 * @param {Function} fn is the callback we'd like to run just after the function named method is invoked
 * @return {Document} this
 */
Document.prototype.post = function(method, fn){
  if (!(method in this._.posts)) this._.posts[method] = [];
  this._.posts[method].push(fn);
  return this;
};

Document.prototype.toObject = 
Document.prototype.toJSON = function () {
  return this._.doc;
};

/**
 * @constructor
 * @param {Array} arr is the initial array data
 * @param {String} path is the property path to the array
 * @param {Schema} subtype is the expected type of array members
 * @param {Object} scope is the parent model (Document instance)
 * @param {Boolean} hydrate
 */
var EmbeddedArray = function(arr, path, subtype, scope, hydrate){
    var self = this;
    var arr = this.arr = (Array.isArray(arr)) ? arr : [];

    Object.defineProperty(this, '_', {
      value: {
        path: path, // The path to this in the parent model
        subtype: subtype, // The expected type of array members
        scope: scope // The parent model (Document instance)
      }, enumerable: false
    });
    
    Object.defineProperty(this, 'length', {
      get: function(){
        return self.arr.length;
      }, enumerable: false
    })
    
    if(scope._schema._embedded[path]){
      this._.doc = scope._schema._embedded[path]; // The subtype (Schema instance)
    }
    
    for(var i=0,l=arr.length; i<l; i++){
      if (hydrate){
        this.arr[i] = (this._.doc) ? new this._.doc(arr[i]) : arr[i];
      } else {
        this.set(i, arr[i])
      } 
    }
}

EmbeddedArray.prototype =  {
  
  get: function(idx){
    return this.arr[idx];
  },

  set: function(idx, val){
    this.arr[idx] = val;
  },
  
  push: function(){
    for(var i=0,l=arguments.length; i<l; i++){
      this.arr.push(arguments[i]);
    }
    return this;
  },
  
  pop: function(){
    return this.arr.pop();
  },
  
  shift: function(){ // removes first item
    return this.arr.shift();
  },
  
  unshift: function(){ // adds to the beginning
    for(var i = 0, l = arguments.length; i < l; i++){ 
      this.arr.unshift(arguments[i]);
    }
    return this.arr.length;
  },
  
  forEach: function(fn, scope){
    this.arr.forEach(fn, scope);
    return this;
  },
  
  slice: function(){
    return this.arr.slice.apply(this.arr, arguments);
  },
  
  filter: function(fn, scope){
    return this.arr.filter(fn, scope);
  },
  
  map: function(){
    return this.arr.map(fn, scope);
  },
  
  at: function(idx){
    return this.arr[idx];
  },
  
  clear: function(){
    this.arr.length = 0;
    return this;
  }
  
};

var EmbeddedDocument = this.EmbeddedDocuemnt = function(){
  
};
sys.inherits(EmbeddedDocument, Document);


module.exports = {
  
  Document: Document,
  
  EmbeddedArray: EmbeddedArray,
  
  EmbeddedDocument: EmbeddedDocument,
  
  Hooks: {

    /**
     * @param {Function} fn is the callback function to call after setting the data
     * @param {Object} obj is the data we're trying to project onto this // TODO
     * @param {Boolean} isNew is true if the Document instance is not yet persisted in mongodb
     * @return {Document} this
     */
    init: function(fn, obj, isNew){
      // this._schema.struct is setup when we use the attribute factory method defined within Mongoose.prototype.type.
      // e.g., 
      // document('user')
      //  .string('username')
      // Here, 'username' would be added to this._schema._struct where this is the Document instance
      this._setData(this._schema._struct, obj || {}, this._.doc, [], isNew);
      if(fn) fn();
      return this;
    },

    /**
     * @param {Function} fn is the callback function to call after setting the data
     * @param {Object} obj is the data we're trying to project onto this // TODO
     * @return {Document} this
     */
    hydrate: function(fn, obj){
      return this.init(fn, obj, false);
    },

    /**
     * @param {Function} fn is the callback function to call after setting the data
     * @param {Object} obj is the data we're trying to project onto this // TODO
     * @return {Document} this
     */
    merge: function(fn, obj){
      return this.init(fn, obj, true);
    },

    /**
     * Saves this to mongodb.
     * If this has any validation errors, then
     * 1. Don't talk to mongodb.
     * 2. Just invoke the callback, passing the errors to it.
     *
     * Otherwise...
     * If this is new, then
     * 1. Save to the JSON representation of this to the collection.
     * 2. Flag this as being not new.
     * 3. Invoke the (optional) callback
     * If this is not new, then
     * 1. Update the dirty attributes of this via the collection.
     * 2. Invoke the (optional) callback
     *
     * @param {Function} fn is the optional callback with function profile fn(errors, record)
     * @return {Document} this
     */
    save: function(fn){
        var self = this;
        this.errors = undefined;

        if(this._.errors.length){
          var errors = this._.errors;
          this._.errors = [];
          Object.defineProperty(this, 'errors', { value: errors });
          if(fn) fn(errors[0], this);
          return;
        }
        if(this.isNew){
          this._collection.insert(this._.doc, {safe: true}, function(err){
            self.isNew = false;
            self._.dirty = {};
            if(fn) fn(err, self);
          });
        } else {
          this._collection.update({_id: this._id},{$set: this._getDirty()}, {safe: true}, function(err){
            self._dirty = {};
            if(fn) fn(err, self);
          });
        }
      return this;
    },

    /**
     * Removes this from mongodb.
     * If this is new (not persisted to the db), then just invoke the callback fn.
     * If this is not new (persisted to the db), then remove the object by delegating
     * to the mongodb collection (which is linked to the connection), passing the
     * callback fn to be called upon removal.
     * @param {Function} fn is the callback function
     * @return {Document} this
     */
    remove: function(fn){
      if (this.isNew){
        if (fn) fn();
        return this;
      }
      this._collection.remove({ _id: this._id }, fn || function(){});
      return this;
    } 

  },
 
  // Class methods to be defined on each model class 
  Statics: {

    /**
     * @param {Object} obj is the data we're trying to project onto this
     * @param {Function} fn is the callback function to call after saving the data -- i.e. = function (errors, savedInstance) {...}
     * @return {Document} this
     */
    create: function(obj, fn){
      new this(obj).save(fn);
    },

    /**
     * Returns a new Writer that finds the query
     * @param {Object} where defines the conditions of the query
     * @param {Object} subset allows you to include or exclude certain properties that you'd like in your query response from MongoDB
     * @param {Boolean} hydrate can take on 3 possible values
     *   - true - Returns a model instance (default)
     *   - null - Returns a plain object that is augmented to match the missing properties defined in the model
     *   - false - Returns the object as it's retrieved from MongoDB
     * @return {Writer}
     */
    find: function(where){
      // Shortcut for this.findById()
      if (where instanceof ObjectID) {
        return this.findById.apply(this, arguments);
      }
      var query = new this.Query(this);
      return query.find.apply(query, arguments);
    },

    /**
     * A special case of find, where we find by the primary key/id.
     * @param {ObjectID|String} id is either an ObjectID or a hex string
     * @param {Function} fn is the callback with profile fn(record)
     * @param {Boolean} hydrate
     * @return {Writer}
     */
    findById: function(id, fn, hydrate){
      id = (id instanceof ObjectID || id.toHexString) ? id : ObjectID.createFromHexString(id);
      var writer = this.find({_id: id});
      if (fn) return writer.first(fn, hydrate);
      return writer;    
    },
    
    all: function(fn, hydrate){
      return this.find().all(fn, hydrate);
    },
    
    first: function(n, fn, hydrate){
      return this.find().first(n, fn, hydrate);
    },

    /**
     * Removes records that match a particular query from mongodb.
     * @param {Object} where is the set of conditions. Anything matching these will be removed.
     * @param {Function} fn is the callback with profile fn()
     * @return {Function} the constructor model class
     */
    remove: function(where, fn){
      var self = this;
      this._collection.remove(where || {}, function(err){
        if (err) return self._connection._error(err);
        fn();
      });
      return this;
    },

    /**
     * @param {Object} where is the set of conditions. Anything matching these will be counted.
     * @param {Function} fn is the callback with profile fn(count)
     * @return {Function} the constructor model class
     */
    count: function(where, fn){
      var self = this;
      if ('function' == typeof where) fn = where, where = {};
      this._collection.count(where || {}, function(err, count){
        if (err) return fn(err);
        fn(null, count);
      });
      return this;  
    },
    
    drop: function(fn){
      var self = this;
      this._collection.drop(function(err, ok){
        if (err) return fn(err);
        fn(null, ok);
      });
    },

    indexes: function (pingDb, fn) {
      var self = this;
      if (!fn) {
        fn = pingDb;
        pingDb = false;
      }
      if (pingDb) {
        this._collection.indexInformation( function (err, collectionInfo) {
          if (err) return fn(err);
          var indexName, _indexes = [];
          for (indexName in collectionInfo) if (indexName !== '_id_' && collectionInfo.hasOwnProperty(indexName)) {
            _indexes.push(collectionInfo[indexName]);
  // self._schema._indexes.push(collectionInfo[indexName]); // TODO Remove?
          }
          fn(_indexes);
        });
      }
    }
    
  },
 
  /**
   * Adds an un-enumerable method to the constructor's prototype.
   * @param {Function} ctor is the constructor whose prototype we want to extend
   * @param {String} name is the name of the method
   * @param {Function} fn is the value of the getter
   */ 
  defineMethod: function(ctor, name, fn){
    Object.defineProperty(ctor.prototype, name, {
      value: fn
    });
  },
  
  /**
   * Adds an un-enumerable hook to the constructor's prototype.
   * This is how custom hooks as well as standard hooks (init, hydrate, merge, save, remove)
   * are compiled into the model (from Connection.prototype._compile(modelName))
   * @param {Function} ctor is the constructor whose prototype we want to extend
   * @param {String} name is the name of the method or task that we want to define the hook relative to
   * @param {Function} fn is the function we want to run
   */
  defineHook: function(ctor, name, fn){
    Object.defineProperty(ctor.prototype, name, {
      value: function(){
        return this._run(name, fn, arguments);
      }
    });
  },
 
  /**
   * Defines the getters and setters on the prototype
   * Used in Connection.prototype._compile as:
   *   Doc.compileEtters(schema._struct, model.prototype)
   * Used in EmbeddedArray constructor
   * @param {Array} struct is an array of either:
   *                1. The string names of the model's attributes
   *                2. Elements of the form [attribute name, subtype struct]
   * @param {Object} prototype is the prototype of the model we want to define etters for
   * @param {Array} path is an optional array of attributes representing an attribute chain
   * @param {Object} scope for nest objects
   */
  compileEtters: function(struct,prototype,path,scope){
    var p = path || [], prop, curpath;
    for(var i=0,l=struct.length; i<l; i++){
      prop = struct[i];
      if(typeof prop == 'string'){
        curpath = p.concat(prop).join('.');
        Object.defineProperty(prototype, prop, {
          get: (function(path,bind){
            return function(){
              if(bind) return bind.get(path);
              else return this.get(path);
            }
          })(curpath,scope),
          set: (function(path,bind){
            return function(val){
              if(bind) bind.set(path,val);
              else this.set(path,val);
            }
          })(curpath,scope),
          enumerable: true
        });
      } else {
        prop = struct[i][0],
        curpath = p.concat(prop).join('.');
        Object.defineProperty(prototype, prop, {
          get: (function(path,p,struct,scp){
            return function(){
              var scope = scp || this;
              if(!(path in scope._getters)){
                var nested = function(){};
                module.exports.compileEtters(struct, nested.prototype, p, scope);
                scope._getters[path] = new nested();
              }
              if(scope._.fields && !scope.loadedField(path)) return undefined;
              return scope._getters[path];
            }
          })(curpath,p.concat(prop),struct[i][1], scope),
          enumerable: true
        });
      }
    }
  }
  
};
