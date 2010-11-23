/**
 * Module dependencies.
 */
var lingo = require('../../support/lingo')
  , en = lingo.en
  , DBRef = require('../../support/node-mongodb-native/lib/mongodb/bson/bson').DBRef;

module.exports.loadTypes = function(instance){

  var mongoose = require('./')
    , Doc = require("./document")
    , EmbeddedArray = Doc.EmbeddedArray
    , Document = Doc.Document
    , ObjectID = mongoose.ObjectID
    , type = instance.type;

  // String
  type('string')
    .set(function(val, path){
      switch (typeof val) {
        case 'string':
          return val;
        case 'number':
          return String(val);
        default:
          return Error;
      }
    })
    .setStrict(function(val, path){
      return 'string' == typeof val
        ? val
        : Error;
    });

  // Array  
  type('array')
    .init(function (val, path, hydrate){
      var subtype = this._schema.paths[path].subtype;
      this._.arrays[path] = new EmbeddedArray(val, path, subtype, this, hydrate || false);
      this._.dirty[path] = []; // Keeps track of dirty indexes
      return this._.arrays[path].arr;
    })
    .get(function(val, path, type){
      return this._.arrays[path];
    })
    .set(function(val){
      if(val instanceof EmbeddedArray) return val.arr;
      if(val instanceof Array) return val;
      else return [val];
    })
    .setStrict(function(val){
      return Array.isArray(val)
        ? val
        : Error;
    })
    .addedTo(function(schema, key){
      var singular = en.isSingular(key) ? key : en.singularize(key)
        , plural = en.isPlural(key) ? key : en.pluralize(key);

      singular = lingo.capitalize(singular);
      plural = lingo.capitalize(plural);

      function withCallback(val){
        var obj = {};
        if (!Array.isArray(val)) val = [val];
        obj[key] = { $all: val };
        return this.find(obj);
      }

      function withoutCallback(val){
        var obj = {};
        if (!Array.isArray(val)) val = [val];
        obj[key] = { $nin: val };
        return this.find(obj);
      }

      schema.static('with' + singular, withCallback);
      schema.static('with' + plural, withCallback);
      schema.static('without' + singular, withoutCallback);
      schema.static('without' + plural, withoutCallback);
    });

  // Object
  var toString = Object.prototype.toString;
  type('object')
    .set(function (val, path) {
      for (prop in val) {
        this.set(path + '.' + prop, val[prop]);
      }
      return val;
    })
    .set(function(val){
      return (typeof val == 'object') ? val : {};
    })
    .setStrict(function(val){
      return '[object Object]' == toString.call(val)
        ? val
        : Error;
    });

  // OID
  type('oid')
    .default(function(){
      return new ObjectID();
    })
    .setup(function(key,path){
      if (key.charAt(0) == '_'){
        this.virtual(key.substr(1))
          .get(function(){
            return this.get(path).toHexString();
          })
          .set(function(val){
            return this.set(path, val);
          });
      }
    })
    .set(function(val){
      return val
        ? ((val instanceof ObjectID || val.toHexString) 
          ? val
          : ObjectID.createFromHexString(val))
        : new ObjectID();
    });

  // Number
  type('number')
    .default(0)
    .set(function(val){
      if ('number' == typeof val) return val;
      val = parseFloat(String(val));
      return isNaN(val)
        ? Error
        : val;
    })
    .setStrict(function(val){
      return 'number' == typeof val
        ? val
        : Error;
    });

  // Boolean
  type('boolean', 'bool')
    .default(false)
    .set(function(val){
      return !!val;
    })
    .setStrict(function(val){
      return (true === val || false === val)
        ? val
        : Error;
    })
    .addedTo(function(schema, key){
      var not = 'not' + lingo.capitalize(key);
      schema.staticGetter(key, function(){
        return this.find(key, true);
      });
      schema.staticGetter(not, function(){
        return this.find(key, false);
      });
    });

  // Date
  type('date')
    .set(function(val){
      if (val instanceof Date) return val;
      if(typeof val == 'string') val = Date.parse(val);
      if(isNaN(val)) return Error;
      val = new Date(val);
      return isNaN(val)
        ? Error
        : new Date(val);
    })
    .setStrict(function(val){
      return val instanceof Date
        ? val
        : Error;
    });

  // Virtual  
  type('virtual');

  // Raw
  type('raw');

type('dbref')
  .setup(function(key,path){ /** @scope is Schema instance **/
    // Add pre-save function to save dbrefs
    this.pre('save', function (next) { /** @scope is Document instance **/
      var dbref = this._.dbrefs[path]
        , self = this;
      if(!dbref) next();
      else {
        dbref.save( function (error, record) {
          if(error){
            var err = new Error(msg);
            err.type = 'validation';
            err.path = path;
            err.name = key;
            self._.errors.push(err);
          } else {
            self.set(record, path); // Sets the DBRef {$ref: ..., $id: ...} (see set fn below)
          }
          next();
        });
      }
    });
  })

  /**
   * @param {Object|Document} val could be a hash or a Document or a DBRef instance
   * @param {String} path is the path to the DBRef
   */
   
  .set( function (val, path) {
    var schema = this._schema
      , context
      , type = schema.paths[path]; // this can either be a document or schema

    if (val.namespace && val.oid) { // replaces instanceof DBRef, which doesn't seem to work
      this._.doc[path] = val;
      return val;
    } else {
      if (!(val instanceof Document) && typeof val === "object") {
        val = new type.subtype(val);
      }
      if (val instanceof Document) {
        this._.dbrefs[path] = val;
        if (typeof val._id !== "undefined") {
          return new DBRef(val._schema._collection, val._id);
        }
      }
    }
    return val;
  })
  .setStrict(function(val){
    return val instanceof DBRef
      ? val
      : Error;
  })
  .get( function (val, path) {
    var self = this;
    var promise = {
      do: function (fn) {
        if (self._.dbrefs[path]) {
          if (self._.dbrefs[path]._id.toHexString() === self._.doc[path].oid.toHexString()) { 
            fn(null, self._.dbrefs[path]);
          } else {
            self._schema.paths[path].subtype.findById(self._.doc[path].oid, function (err, record) {
              fn(err, record);
            });
          }
        } else if (typeof val === "object") {
          // If we have set a dbref hash {'$ref': ..., '$id': ...} directly on this._.doc
          self._schema.paths[path].subtype.findById(self._.doc[path].oid.toHexString(), function (err, record) {
            if (err) throw err;
            self.set(record);
            fn(err, record);
          });
        } else if (typeof val === "undefined") { // If we have not assigned anything to the dbref attribute
          fn(null);
        } else {
          fn(new Error("Argument error - " + val));
        }
      },

      remove: function (fn) {
        var referer = self; // The Document instance containing the dbref
        Doc.Hooks.remove.call(self._.dbrefs[path], function () {
          delete referer._.doc[path];
          delete referer._.dbrefs[path];
          referer._.dirty[path] = true;
          if (fn) fn();
        });
      }
    };
    return promise;
  });

/**
 * @constructor
 * @param {Array} array is an optional list of members we'd like to populate the promise array with.
 */
function PromiseArray (array) {
  this.arr = array;
  this.callbacks = [];
}

PromiseArray.prototype = {
  /**
   * Adds callbacks to the promise that are triggered when the Promise Array has
   * members assigned to it.
   * @param {Function} fn is the callback function
   * @param {Array} args is the Array of arguments we'd like to pass to the callback when it's invoked.
   */
  callback: function (fn, args) {
    if (!(this.arr && this.arr.length)) { // TODO Do we need the length check?
      this.callbacks.push([fn, args]);
    } else {
      fn.apply(this, args);
    }
  },

  /**
   * Assigns members to the Promise Array and triggers all registered callbacks to date.
   * @param {Array} arr is the Array of members we're successfully assigning to this Promise Array
   */
  succeed: function (arr) {
    this.arr = arr;
    var cb, callbacks = this.callbacks;
    while (cb = callbacks.shift()) {
      cb[0].apply(this, cb[1]);
    }
  },

  /**
   * When we have members, then we pass these members to the callback function, fn.
   * @param {Function} fn = function (arrayOfMembers) {...}
   */
  all: function (fn) {
    this.callback(this._all, arguments);
    return this;
  },

  /**
   * This invokes fn, passing it the members associated with this PromiseArray
   * @param {Function} fn = function (arrayOfMembers) {...}
   */
  _all: function (fn) {
    fn(this.arr);
  },
  forEach: function (fn) {
    this.callback(this._forEach, arguments);
    return this;
  },
  _forEach: function (fn) {
    var arr = this.arr;
    for (var i = 0, l = arr.length; i < l; i++) {
      fn(arr[i], i);
    }
  },
  slice: function (start, num, fn) {
    var newPromiseArray = new PromiseArray();
    newPromiseArray.callback(newPromiseArray._slice, arguments);
    this.callback(newPromiseArray.succeed.bind(newPromiseArray));
    return newPromiseArray;
  },
  _slice: function (start, end, fn) {
    var slice = this.arr.slice(start, end);
    fn(slice);
  },
  splice: function () {
    // TODO
    return this;
  },
  _splice: function () {
    // TODO
  },
  filter: function (fn) {
    var newPromiseArray = new PromiseArray();
    newPromiseArray.callback(newPromiseArray._filter, arguments);
    this.callback(newPromiseArray.succeed.bind(newPromiseArray));
    return newPromiseArray;
  },
  _filter: function (fn) {
    var arr = this.arr;
    this.arr = arr.filter(fn);
  },
  map: function (fn) {
    var newPromiseArray = new PromiseArray();
    newPromiseArray.callback(newPromiseArray._map, arguments);
    this.callback(newPromiseArray.succeed.bind(newPromiseArray));
    return newPromiseArray;
  },
  _map: function (fn) {
    var arr = this.arr;
    this.arr = arr.map(fn);
  },
  toJSON: function (fn) {
    var newPromiseArray = new PromiseArray();
    newPromiseArray.callback(newPromiseArray._toJSON, arguments);
    this.callback(newPromiseArray.succeed.bind(newPromiseArray));
    return newPromiseArray;
  },
  _toJSON: function (fn) {
    this.arr = this.arr.map( function (member) {
      var json = member.toJSON();
      if (fn) json = fn(json);
      return json;
    });
  },
  at: function (index, fn) {
    this.callback(this._at, arguments);
    return this;
  },
  _at: function (index, fn) {
    fn(this.arr[index]);
  },
  clear: function () {
    this.arr.length = 0;
    return this;
  }
};

/**
 * @constructor
 * @param {Array} docs is the Array of members we'd like to initialize the underlying data to
 * @param {Document} parent is the Document instance that owns the array of dbrefs
 * @param {String} path is the property path to the dbref array
 * @param {Boolean|null} hydrate
 */
function DBRefArray (docs, parent, path, hydrate) {
  this.parent = parent;
  this.path = path;
  var memberType = this.memberType = parent._schema.paths[path].subtype, // The dfref array's members' type
      arr = this.arr = [];
  var i, l;
  if (docs) {
    if (hydrate) {
      if (memberType) {
        for (i = 0, l = docs.length; i < l; i++) arr[i] = new memberType(docs[i]);
      } else {
        for (i = 0, l = docs.length; i < l; i++) arr[i] = docs[i];
      }
    } else {
      for (i = 0, l = docs.length; i < l; i++) this.set(i, docs[i]);
    }
  }
  this.callbacks = [];
}

DBRefArray.prototype = {
  // TODO Handling hydration/non-hydration scenarios properly?
  set: function (index, member) {
    var memberType = this.memberType,
        arr = this.arr;
    if (memberType) {
      if (member instanceof memberType) {
        arr[index] = member;
      } else {
        arr[index] = new memberType(member);
      }
    } else {
      arr[index] = member;
    }
    return this;
  },

  push: function () {
    for (var i = 0, l = arguments.length; i < l; i++) this.set(this.length, arguments[i]);
    return this;
  },

  _whatToFetch: function () {
    var parent = this.parent,
        baseArr = parent._.doc[this.path],
        surfaceArr = this.arr,
        i, ii, j, jj, baseId, anymatch, toFetch = [];
    for (i = 0, ii = baseArr.length; i < ii; i++) {
      baseId = baseArr[i].oid.toHexString();
      if (surfaceArr[i] && surfaceArr[i].id === baseId) {
        continue;
      } else {
        anymatch = false;
        for (j = 0, jj = surfaceArr.length; j < jj; j++) {
          if (baseId === surfaceArr[j].id) {
            anymatch = true;
            surfaceArr[i] = surfaceArr[j];
          }
        }
        if (!anymatch) toFetch.push([i, baseId]);
      }
    }
    return toFetch;
  },

  _fetch: function () {
    this.state = 'isFetching';
    var toFetch = this._whatToFetch(),
        memberType = this.memberType,
        index, id, count = 0,
        self = this;
    for (var i = 0, l = toFetch.length; i < l; i++) {
      index = toFetch[i][0];
      id = toFetch[i][1];
      memberType.findById(id, function (_index) {
        return function (err, member) {
          if (err) throw err;
          var cb;
          self.arr[_index] = member;
          if (++count === l) {
            self.state = 'fetched';
            while (cb = self.callbacks.shift()) {
              cb[0].apply(self, cb[1] || [self.arr]); // Pass in the array if we didn't specify args
            }
          }
        };
      }(index));
    }
  },
  
  callback: function (fn, args) {
    var toFetch = this._whatToFetch();
    if (toFetch.length) {
      this.state = 'unfetched';
    } else {
      this.state = 'fetched';
    }
    if (this.state === 'fetched') {
      // Either call the fn immediately
      fn.apply(this, args || [this.arr]);
    } else {
      // Or push it onto the stack
      this.callbacks.push([fn, args]);
      if (this.state !== 'isFetching') {
        // And start the member fetching process if we haven't already
        this._fetch();
      }
    }
  },

  at: function (index, fn) {
    var parent = this.parent,
        baseArr = parent._.doc[this.path],
        surfaceArr = this.arr,
        memberType = this.memberType,
        baseId = baseArr[index].oid.toHexString(),
        j, jj, baseId, anymatch;
    if (surfaceArr[index] && surfaceArr[index].id === baseId) {
      fn(surfaceArr[index]);
    } else {
      anymatch = false;
      for (j = 0, jj = surfaceArr.length; j < jj; j++) {
        if (baseId === surfaceArr[j].id) {
          anymatch = true;
          surfaceArr[index] = surfaceArr[j];
          break;
        }
      }
      if (!anymatch) {
        memberType.findById(baseId, function (err, record) {
          if (err) throw err;
          surfaceArr[index] = record;
          fn(record);
        });
      } else {
        fn(surfaceArr[index]);
      }
    }
    return this;
  },
  clear: function () {
    this.arr.length = 0;
    this.parent._.doc[this.path].length = 0;
  }
};

Object.defineProperty(DBRefArray.prototype, 'length', {
  get: function () {
    return this.arr.length;
  }
});

// TODO Make more efficient by only checking for specified range 
// TODO splice, _splice
['at', 'all', 'forEach', 'slice', 'splice', 'filter', 'map', 'toJSON'].forEach( function (name) {
  DBRefArray.prototype[name] = PromiseArray.prototype[name];
  DBRefArray.prototype['_' + name] = PromiseArray.prototype['_' + name];
});


// TODO Dirty attributes?
type('dbrefArray')
  .setup(function(key,path){ /** @scope is Schema instance **/
    // Add pre-save function to save the array of dbref members
    this.pre('save', function (complete) { /** @scope is Document instance **/
      var dbrefs = this._.dbrefArrays[path],
          self = this,
          i, l, dbref, count;
      if (dbrefs) {
        count = 0;
        dbrefs.forEach( function (dbref) {
          if (!dbref.isDirty) {
            count++;
            return;
          }
          dbref.save( function (errors, record) {
            if (errors) {
              // TODO Add errors to parent object
            } else {
              // TODO Any code needed here?
            }
            if (++count === dbrefs.length) complete();
          });
        });
      } else {
        complete();
      }
    });
  })
  /**
   * @param {Array} val is an array of members that are JSON objects or Document instances
   * @param {String} path is the path to the Array of DBRefs
   */
  .set( function (val, path) {
    if (!(val instanceof Array)) throw new Error("You must pass in an array.");
    var type = this._schema.paths[path],
        subtype = type.subtype,
        member;
    for (var i = 0, len = val.length; i < len; i++) {
      member = val[i];
      if (!(member instanceof Document) && typeof member === "object") {
        // Convert member objects to Document instances
        member = new subtype(member);
      }
      if (member instanceof Document) {
        if (typeof member.id !== "undefined") {
          val[i] = member;
        } else {
          throw new Error("The member type for a DBRef collection must have an oid");
        }
      } else {
        throw new Error("Argument error");
      }
    }
    this._.dbrefArrays[path] = new DBRefArray(val, this, path);
    return val.map( function (el, idx) {
      return new DBRef(el._schema._collection, el._.doc._id);
    });
  })
  .get( function (val, path) {
    if (!this._.dbrefArrays[path]) {
      this._.dbrefArrays[path] = new DBRefArray(null, this, path);
    }
    return this._.dbrefArrays[path];
  });

function DBReffedArray (docs, parent, path, hydrate) {
  DBRefArray.apply(this, arguments);
  this.memberType = parent._schema.paths[path].subtype;
  this.parentReferredAs = parent._schema.paths[path].options.as;
}
// TODO Add in element removal
DBReffedArray.prototype.set = DBRefArray.prototype.set;

DBReffedArray.prototype.page = function (options) {
  this.state = 'unfetched'; // So the system knows to make a DB roundtrip // TODO Test this resetting after a first fetch
  this.limit = options.limit;
  this.skip = options.skip;
  return this;
};
// TODO set
DBReffedArray.prototype.build = function (attrs) {
  attrs[this.parentReferredAs] = this.parent;
  this.arr.push(new this.memberType(attrs));
  return this;
};
DBReffedArray.prototype.create = function (attrs, fn) {
  attrs[this.parentReferredAs] = this.parent;
  var self = this;
  new this.memberType(attrs).save( function (errors, member) {
    if (errors) throw errors;
    self.arr.push(member);
    if (fn) fn(errors, member);
  });
  return this;
};
DBReffedArray.prototype.callback = function (fn, args) {
  if (this.state === 'fetched') {
    fn.apply(this, args || [this.arr]);
  } else {
    this.callbacks.push([fn, args]);
    if (this.state !== 'isFetching') {
      this._fetch();
    }
  }
};
DBReffedArray.prototype._fetch = function (fn) {
  // TODO Add in pagination/limit/offset - make it as an option in the type schema helper
  var conditions = {}, self = this;
//  conditions[this.parentReferredAs] = new DBRef(this.parent._schema._collection, this.parent._.doc._id);
  conditions[this.parentReferredAs + ".$ref"] = this.parent._schema._collection;
  conditions[this.parentReferredAs + ".$id"] = this.parent._.doc._id;
  var query = this.memberType.find(conditions);
  if (this.limit) query.limit(this.limit);
  if (this.skip) query.skip(this.skip);
  query.all( function (err, members) {
    if (err) throw err;
    self.arr = self.arr.concat(members);
    var cb;
    while (cb = self.callbacks.shift()) {
      cb[0].apply(self, cb[1] || [self.arr]); // Pass in the array if we didn't specify args
    }
  });
};

['at', 'all', 'forEach', 'slice', 'splice', 'filter', 'map', 'toJSON'].forEach( function (name) {
  DBReffedArray.prototype[name] = PromiseArray.prototype[name];
  DBReffedArray.prototype['_' + name] = PromiseArray.prototype['_' + name];
});

type('dbreffedArray')
    // TODO Do we need the post-saves in setup? The only time this should be the case ...
    // TODO ... is if we have removed an element from dbreffedArray. Then we should remove
    // TODO ... our reference to "this" in the document we "removed" from our dbreffedArray
//  .setup( function (key, path) {
//    // Save the documents that refer to the parent document
//    // after the parent document is saved
//    this.post('save', function () { /** this is a Document instance **/
//      referringMemeber = '';
//      if (Object.keys(referringMember._getDirty).length) { // So we don't do an infinite amount of saving back and forth between parent and member
//        referringMember.save( function (errors, savedMember) {
//          if (errors) throw new Error("Something went wrong");
//        });
//      }
//    });
//  })
  // Same as dbrefArray's set
  // TODO Eliminate duplication?
  .set( function (val, path) {
    if (!(val instanceof Array)) throw new Error("You must pass in an array.");
    var type = this._schema.paths[path],
        subtype = type.subtype,
        member;
    for (var i = 0, len = val.length; i < len; i++) {
      member = val[i];
      if (!(member instanceof Document) && typeof member === "object") {
        // Convert member objects to Document instances
        member = new subtype(member);
      }
      if (member instanceof Document) {
        if (typeof member.id !== "undefined") {
          val[i] = member;
        } else {
          throw new Error("The member type for a DBRef collection must have an oid");
        }
      } else {
        throw new Error("Argument error");
      }
      member.set(type.parentReferredAs, this); // Part 1 that is different from dbrefArray's set
    }
    this._.dbreffedArrays[path] = new DBReffedArray(val, this, path); // Part 2 that is different from dbrefArray's set
    return val.map( function (el, idx) {
      return new DBRef(el._schema._collection, el._.doc._id);
    });
  })
  .get( function (val, path) {
    if (!this._.dbreffedArrays[path]) {
      this._.dbreffedArrays[path] = new DBReffedArray(null, this, path);
    }
    return this._.dbreffedArrays[path];
  });

};
