var assert = require('assert')
  , mongoose = require('mongoose').new()
  , db = mongoose.connect('mongodb://localhost/dbrefArrays')
  , DBRef = require('../support/node-mongodb-native/lib/mongodb/bson/bson').DBRef;

mongoose.define('Restaurant')
  .oid('_id')
  .string('name');
var Restaurant = mongoose.Restaurant;

mongoose.define('Cuisine')
  .oid('_id')
  .string('name')
  .dbrefArray('restaurants', Restaurant);
var Cuisine = mongoose.Cuisine;


var ResturantSchema = mongoose.define('Restaurant2')
  .oid('_id')
  .string('name');
var Restaurant2 = mongoose.Restaurant2;

var CuisineSchema = mongoose.define('Cuisine2')
  .oid('_id')
  .string('name')
  .dbrefArray('restaurants', ResturantSchema);
var Cuisine2 = mongoose.Cuisine2;

// TODO Show only send dirty members
// TODO Test chaining
module.exports = {
  setup: function (done) {
    Restaurant.remove({}, function () {
      Cuisine.remove({}, function () {
        done();
      });
    });
  },

  'setting via JSON input should allow you to access an array of Document instances (defined with model)': function (assert, done) {
    var cuisine = new Cuisine({
      name: 'Thai',
      restaurants: [
        { name: 'Osha Thai' },
        { name: 'Thai Stick' }
      ]
    });
    var count = 0;
    cuisine.restaurants.forEach( function (diner) {
      assert.ok(diner instanceof Restaurant);
      if (++count === 2) done();
    });
  },
  
  'setting via JSON input should allow you to access an array of Document instances (defined with schema)': function (assert, done) {
    var cuisine = new Cuisine2({
      name: 'Thai',
      restaurants: [
        { name: 'Osha Thai' },
        { name: 'Thai Stick' }
      ]
    });
    var count = 0;
    cuisine.restaurants.forEach( function (diner) {
      assert.ok(diner instanceof Restaurant2);
      if (++count === 2) done();
    });
  },

  'setting to an array of new Document instances should allow you to access an array of Document instances AND set the dbref params': function (assert, done) {
    var cuisine = new Cuisine({
      name: 'Thai',
      restaurants: [
        new Restaurant({name: 'Osha Thai'}),
        new Restaurant({name: 'Thai Stick'})
      ]
    });
    var count = 0;
    cuisine.restaurants.forEach( function (diner) {
      assert.ok(diner instanceof Restaurant);
      assert.ok(typeof diner._.doc._id !== "undefined");
      assert.deepEqual(cuisine._.doc.restaurants[count], new DBRef(diner._schema._collection, diner._.doc._id));
      if (++count === 2) done();
    });
  },

  'saving after setting the dbref array to unpersisted data should automatically save that data to the db': function (assert, done) {
    var count = 0;
    new Cuisine({
      name: 'Burgers',
      restaurants: [
        { name: 'Burger Bar' },
        { name: "Pearl's Burgers" }
      ]
    }).save( function (errors, cuisine) {
      cuisine.restaurants.forEach( function (diner) {
        Restaurant.find({name: diner.name}).first( function (diner) {
          return function (err, found) {
            assert.ok(diner.id === found.id);
            if (++count === 2) done();
          };
        }(diner));
      });
    });
  },

  'updating the dbref params directly should change the retrieved target on the next get': function (assert, done) {
    var cuisine = new Cuisine({
      name: 'Chinese',
      restaurants: [
        { name: 'PF Changs' }
      ]
    });
    new Restaurant({ name: 'Panda Express'}).save( function (errors, diner2) {
      cuisine.restaurants.forEach( function (diner1) {
        cuisine._.doc.restaurants[0].oid = diner2._.doc._id;
        cuisine.restaurants.forEach( function (refreshedDiner) {
          assert.ok(refreshedDiner.name === diner2.name);
          done();
        });
      });
    });
  },
  
  'setting properties of the dbref targets should persist when we save the referring (source) instance': function (assert, done) {
    new Cuisine({
      name: 'Japanese',
      restaurants: [ { name: 'Katana Ya' } ]
    }).save( function (errors, cuisine) {
      cuisine.restaurants.forEach( function (diner) {
        diner.name = 'Kiss Sushi';
        cuisine.save( function (errors, cuis) {
          Restaurant.findById(diner.id, function (err, found) {
            assert.ok(found.name === 'Kiss Sushi');
            done();
          });
        });
      });
    });
  },

  'pushing onto the dbref array should update the data we can retrieve': function (assert, done) {
    var cuisine = new Cuisine({
      name: 'Breakfast',
      restaurants: [ { name: 'Stacks' }, {name: 'Farm:Table'} ]
    });
    cuisine.restaurants.push({ name: "Dottie's" }).all( function (diners) {
      assert.ok(diners.length === 3);
      assert.ok(diners[2].name === "Dottie's");
      done();
    });
  },

  'test getting a specific member of the dbref array': function (assert, done) {
    var cuisine = new Cuisine({
      name: 'Breakfast',
      restaurants: [ { name: 'Stacks' }, {name: 'Farm:Table'} ]
    });
    cuisine.restaurants.at(1, function (restaurant) {
      assert.ok(restaurant.name === 'Farm:Table');
      done();
    });
  },

  'test getting a slice of the dbref array': function (assert, done) {
    var cuisine = new Cuisine({
      name: 'Breakfast',
      restaurants: [ { name: 'Stacks' }, {name: 'Farm:Table'}, { name: "Dottie's"} ]
    });
    cuisine.restaurants.slice(1, 3, function (restaurants) {
      assert.ok(restaurants.length === 2);
      assert.ok(restaurants[0].name === 'Farm:Table');
      assert.ok(restaurants[1].name === "Dottie's");
      done();
    });
  },

  'test filtering the dbref array': function (assert, done) {
    var cuisine = new Cuisine({
      name: 'Breakfast',
      restaurants: [ { name: 'Stacks' }, {name: 'Farm:Table'}, { name: "Dottie's"} ]
    });
    cuisine.restaurants.filter( function (diner) {
      return /a/.test(diner.name);
    }).all( function (diners) {
      assert.ok(diners.length === 2);
      assert.ok(diners[0].name === 'Stacks');
      assert.ok(diners[1].name === 'Farm:Table');
      done();
    });
  },

  'test mapping the dbref array': function (assert, done) {
    var cuisine = new Cuisine({
      name: 'Breakfast',
      restaurants: [ { name: 'Stacks' }, {name: 'Farm:Table'}, { name: "Dottie's"} ]
    });
    cuisine.restaurants.map( function (diner) {
      diner.name = diner.name + " - SF";
      return diner;
    }).all( function (diners) {
      assert.ok(diners.length === 3);
      assert.ok(diners[0].name === 'Stacks - SF');
      assert.ok(diners[1].name === 'Farm:Table - SF');
      assert.ok(diners[2].name === "Dottie's - SF");
      done();
    });
  },

  'test setting a specific member of the dbref array': function (assert, done) {
    var cuisine = new Cuisine({
      name: 'Breakfast',
      restaurants: [ { name: 'Stacks' } ]
    });
    cuisine.restaurants[0] = new Restaurant({name: "Dottie's True Blue Cafe"});
    cuisine.restaurants.forEach( function (diner) {
      assert.ok(diner.name, "Dottie's True Blue Cafe");
      done();
    });
  },

//  'test splicing the dbref array': function (assert, done) {
//    var cuisine = new Cuisine({
//      name: 'Breakfast',
//      restaurants: [ { name: 'Stacks' }, {name: 'Farm:Table'}, { name: "Dottie's"} ]
//    });
//    cuisine.restaurants.splice(1, 2, new Restaurant({name: 'Hobees'}), new Restaurant({name: 'Moulin Cafe'}));
//    cuisine.restaurants.map( function (diner) {
//      return diner.name;
//    }).all( function (dinerNames) {
//      assert.ok(dinerNames[0] === 'Stacks');
//      assert.ok(dinerNames[1] === 'Hobees');
//      assert.ok(dinerNames[2] === "Dottie's");
//      done();
//    });
//  },

  // TODO Add in destroyDependent flag
  'test clearing the dbref array': function (assert, done) {
    var cuisine = new Cuisine({
      name: 'Breakfast',
      restaurants: [ { name: 'Stacks' }, {name: 'Farm:Table'}, { name: "Dottie's"} ]
    });
    cuisine.restaurants.clear();
    cuisine.restaurants.all( function (diners) {
      assert.ok(diners.length === 0);
      done();
    });
  },

  'test toJSON of the dbref array': function (assert, done) {
    var cuisine = new Cuisine({
      name: 'Breakfast',
      restaurants: [ { name: 'Stacks' }, {name: 'Farm:Table'}, { name: "Dottie's"} ]
    });
    cuisine.restaurants.toJSON( function (restaurantAsJSON) {
      restaurantAsJSON.extra = "test";
      return restaurantAsJSON;
    }).all( function (jsonDiners) {
      assert.ok(jsonDiners.length === 3);
      assert.ok((jsonDiners[0] instanceof Restaurant) === false);
      assert.ok(jsonDiners[0].name === 'Stacks');
      assert.ok(jsonDiners[0].extra = "test");
      assert.ok(jsonDiners[1].name === 'Farm:Table');
      assert.ok(jsonDiners[2].name === "Dottie's");
      done();
    });
  },

  teardown: function(){
    db.close();
  }
};
