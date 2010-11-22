var clone = require('./util').clone;

/**
 * @param {String} name is the name of the type
 * @param {String} key
 * @param {String|TypeSchema|Schema} subtype
 * @param {Schema} schema is a reference to the Schema instance that this type is associated with
 */

var TypeSchema = module.exports = function(name, key, subtype, schema){
  this.type = name;
  this.key = key;

  // Instead of a direct assignment this.subtype = subtype, we opt for the following implementation
  // of using subtypes in types, so we can avoid situations such as:
  // // file: lib/models/user.js
  // mongoose.define('User').
  //   dbreffedArray('pets', mongoose.Animal); // mongoose.Animal evaluates to undefined!!!!
  //
  // // file: lib/models/animal.js
  // mongoose.define('Animal')
  //   dbref('owner', mongoose.Animal); // mongoose.Animal evaluates to undefined!!!!
  // )
  //
  // Even requiring either file beforehand will cause a circular require or will still resolve one of the model
  // constructors to undefined.
  //
  // The solution is to instead have an api like:
  // mongoose.define('User')
  //   .dbref('pets', 'Animal'); // We use 'Animal' to later retrieve the actual model constructor once it is defined
  this._subtype = (subtype && subtype._name) ? subtype._name : subtype;
 // this._subtype = subtype;
  var self = this;
  Object.defineProperty(this, 'subtype', {
    get: function () {
      if (typeof self._subtype === "string") {
        var val = schema.mongoose[self._subtype] || schema.mongoose._types[self._subtype];
        if (val) return self._subtype = val;
      } 
      return self._subtype;
    }
  });

  this.schema = schema;
  this.setups = this.setups ? clone(this.setups) : [];
  this.getters = this.getters ? clone(this.getters) : [];
  this.setters = this.setters ? clone(this.setters) : [];
  this.strictSetters = this.strictSetters ? clone(this.strictSetters) : [];
  this.validators = this.validators ? clone(this.validators) : {};
  this._doc = [];
  return this;
};

/**
 * Adds another setup function.
 * @param {Function} fn is the setup function we want to add with profile (...TODO)
 * @return {TypeSchema} this
 */
TypeSchema.prototype.setup = function(fn){
  this.setups.push(fn);
  return this;
};

/**
 * Declare this type to inherit from a parent type.
 * @param {String} parent is the names of the type from which this type should inherit
 * @return {TypeSchema} this
 */
TypeSchema.prototype.extend = function(parent){
  if (typeof parent === "string") {
    parent = require('./').type(parent); // require inline because of the circular reference with type
  } else if (!(parent instanceof TypeSchema)){
    throw new Error("parent must be either a TypeSchema instance or the name referencing the TypeSchema instance");
  }
  this.parent = parent.type;
  this.setups = parent.setups.concat(this.setups);
  this.getters = parent.getters.concat(this.getters);
  this.setters = parent.setters.concat(this.setters);
  for (var i in parent.validators){
    if(!this.validators[i]) 
      this.validators[i] = parent.validators[i];
  }
  if(!this.index) this.index = parent.index;
  if(!this.default) this.default = parent.default;
  return this;
};

TypeSchema.prototype.init = function(fn){
  this._init = fn;
  return this;
}

TypeSchema.prototype.get = function(fn){
  this.getters.push(fn);
  return this;
};

TypeSchema.prototype.set = function(fn){
  this.setters.push(fn);
  return this;
};

TypeSchema.prototype.setStrict = function(fn){
  this.strictSetters.push(fn);
  return this;
};

TypeSchema.prototype.castGet = function(fn){
  this._castGet = fn;
  return this;
};

/**
 * castSet is never used internally in the code-base. It is merely exposed to end-users of this
 * library who want to throw a set at the very front of the setters chain (e.g., for input
 * sanitation, etc.)
 * @param {Function} fn(val, path)
 * @return {TypeSchema} this for chaining
 */
TypeSchema.prototype.castSet = function(fn){
  this._castSet = fn;
  return this;
};

TypeSchema.prototype.validate = function(name,fn){
  this.validators[name] = fn;
  return this;
};

TypeSchema.prototype.required = function(bool){
  this._required = undefined === bool ? true : bool; // TODO Incorporate this into validation
  return this;
};

TypeSchema.prototype.strict = function(bool){
  this._strict = undefined === bool ? true : bool;
  return this;
};

TypeSchema.prototype.index = function(order){
  this.index = order || 1;
  // Add index to the schema's list of indexes
  // TODO Check for index duplication
  var index = [this.key, this.index];
  this.schema._indexes.push([[index]]); // [[index]] because we'll use it in ensureIndex.apply(_, [[index]]);
  return this;
};

TypeSchema.prototype.atomic = function(bool){
  this._atomic = bool;
  return this;
}

TypeSchema.prototype.default = function(val){
  this._default = val;
  return this;
};

TypeSchema.prototype.doc = function(markdown){
  this._doc.push(markdown);
  return this;
};

TypeSchema.prototype.addedTo = function(fn){
  this._addedTo = fn;
  return this;
};

TypeSchema.prototype.compile = function(fn){
  this._compiler = fn;
  return this;
};
