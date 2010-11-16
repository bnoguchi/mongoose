
/**
 * Module dependencies.
 */

var util = require('./util');

/**
 * Initialize a new `Query`.
 *
 * An additional `query` can be passed, to copy its state for expanding
 * upon an already executed query.
 *
 * @param {Function} model is the constructor
 * @param {Query} query
 * @api private
 */

var Query = module.exports = function Query(model, query){
  query = query || {};
  this._query = query._query || {};
  this._hydrate = query._hydrate || false;
  this._options = query._options || {};
  this._fields = query._fields || {};
  this._model = model;
};

/**
 * Extend the current query with the additional `query` conditions.
 *
 * For example an object can be passed to apply several conditions:
 *
 *    find({ 'name.first': 'TJ', 'name.last': 'Holowaychuk' })
 *
 * Alternatively a single key/value can be passed:
 *
 *    find('name.first', 'TJ').find('name.last', 'Holowaychuk')
 *
 * When _only_ the key is passed, a value of `true` is assumed for boolean
 * attribute types:
 *
 *    find('blocked')
 *
 * @param {String|Object} key | query
 * @param {Mixed|Object} val | fields
 * @return {Query} for chaining
 * @api public
 */

Query.prototype.where = 
Query.prototype.find = function(query, val){
  switch (typeof query) {
    case 'object':
      // query
      for (var key in query) {
        this._query[key] = query[key];
      }
      
      // fields
      switch (typeof val) {
        case 'object':
          var include = undefined;
          for (var key in val) {
            if(include == undefined) include = val[key]; // first one wins
            if(val[key] == include) this._fields[key] = val[key]; // exclude anything that will create a query error.
          }
          break;
        case 'string':
          this._fields[val] = true;
          break;
      }
      break;
    case 'string':
      // Boolean / key/val support
      this._query[query] = undefined === val
        ? true
        : val;
      break;
  }
  return this;
};

/**
 * Execute and pass the first doc to `fn`.
 *
 * @param {Function} fn
 * @param {Boolean} hydrate
 * @return {Query}
 * @api public
 */

Query.prototype.one = function(fn, hydrate){
  return this.exec(function(err, docs){
    fn(err, (docs && docs.length) ? docs[0] : null);
  }, hydrate);
};

/**
 * Execute the query invoking `fn`, returning a new `Query`
 * which can be used to extend the query without
 * mutating the previous.
 *
 * @param {Function} fn
 * @param {Boolean} hydrate
 * @return {Query}
 * @api public
 */

Query.prototype.all =
Query.prototype.exec = function(fn, hydrate){
  var self = this
    , model = this._model
    , schema = model._schema
    , query = this._query
    , fields = Object.keys(this._fields).length ? this._fields : null
    , done;

  // Perform query type casting
  util.walk(schema, query, function(path, fullpath, prop, val){
    var type = schema.paths[fullpath]
      , setters;
    if (!type || !type.setters.length) return; // This will be the case if path is "dbref.$ref" or "dbref.$id"

    for (var i = 0, l = fullpath.length - 1; i < l; i++) {
      query = query[fullpath[i]]
    }
    setters = type._strict ? type.strictSetters : type.setters;
    for (var i = setters.length-1; i >= 0; i--) {
      try {
        // Attempt type coercion
        var ret = setters[i].call(schema, val, path, type);
        // Coercion failure
        if (Error == ret) {
          var err = new Error('failed to cast ' + path + ' value of ' + JSON.stringify(val) + ' to ' + type.type);
          err.type = 'cercion';
          return fn(err, null);
        } else {
          val = ret;
        }
      } catch (err) {
        return fn(err, null);
      }
    }

    if (typeof type._castSet === "function"){
      val = type._castSet(val);
    }
    query[fullpath[l]] = val;
  });
  
  model._collection.find(query, this._fields, this._options, function(err, cursor){
    if (err) return fn(err);
    var results = [];
    cursor.each(function(err, doc){
      if (done) return;
      if (err) {
        done = true;
        return fn(err);
      } else if (null == doc) {
        done = true;
        return fn(null, results);
      } else if (doc.$err) {
        done = true;
        return fn(new Error(doc.$err));
      } else {
        results.push(new model(doc, (hydrate != false) ? true : false, fields));
      }
    });
  });
  return new this.constructor(model, this);
};

/**
 * Limit the query to the first `n` documents, defaulting to 1.
 * A function may be passed as the first argument, in which case
 * the first doc is passed, or combined with `first(n, callback)`
 * which essentially aliases `first(n).all(callback)`.
 *
 *
 * @param {Number|Function} n
 * @param {Function} fn
 * @param {Boolean} hydrate
 * @return {Query} for chaining
 * @api public
 */

Query.prototype.first = function(n, fn, hydrate){
  if ('function' == typeof n) fn = n, n = 1;
  this.limit(n || 1);
  if (fn) {
    if (n > 1) {
      this.all(fn, hydrate);
    } else {
      this.all(function(err, docs){
        fn(err, docs[0]);
      }, hydrate);
    }
  }
  return this;
};

/**
 * Iterate documents, and call `done(err)` on query error,
 * an exception thrown within `fn(doc)` or `done(null)` when
 * all documents have be been passed to `fn(doc)`.
 *
 * Examples:
 *
 *    User.find('name.last', 'Holowaychuk').forEach(function(user){
 *      console.log('%s', user.name.first);
 *    });
 *
 *    User.find('name.last', 'Holowaychuk').forEach(function(user){
 *      console.log('%s', user.name.first);
 *    }).done(function(err){
 *      if (err) throw err;
 *      console.log('done');
 *      process.exit(0);
 *    });
 *
 * @param {Function} fn
 * @param {Mixed} scope
 * @return {Query} for chaining
 * @api public
 */

Query.prototype.forEach = function(fn, scope){
  var self = this;
  this.all(function(err, docs){
    var done = self._done;
    if (err) return done(err);
    for (var i = 0, len = docs.length; i < len; ++i) {
      try {
        fn.call(scope, docs[i]);
      } catch (err) {
        if (done) return done(err);
      } 
    }
    if (done) done();
  });
  return this;
};

/**
 * Callback used in conjunction with `Query#forEach()`.
 *
 * @param {Function} fn
 * @return {Query} for chaining
 * @api public
 */

Query.prototype.done = function(fn){
  this._done = fn;
  return this;
};

/**
 * Alter the partial-select fields with the given `obj`.
 * You may also pass one or more strings indicating that
 * those fields should be included.
 *
 * @param {Object|String} obj ...
 * @return {Query} for chaining
 * @api public
 */

Query.prototype.fields = function(obj){
  for (var i = 0, len = arguments.length; i < len; ++i) {
    var obj = arguments[i];
    switch (typeof obj) {
      case 'object':
        for (var key in obj) {
          this._fields[key] = obj[key];
        }
        break;
      case 'string':
        this._fields[obj] = true;
        break;
    }
  }
  return this;
};

// Modifiers

['sort', 'limit', 'skip', 'snapshot', 'group'].forEach(function(option){
  Query.prototype[option] = function(obj){
    this._options[option] = obj;
    return this;
  };
});
