var assert = require('assert')
  , mongoose = require('mongoose').new()
  , db = mongoose.connect('mongodb://localhost/dbrefTests')
  , DBRef = require('../support/node-mongodb-native/lib/mongodb/bson/bson').DBRef;

var DogSchema = 
  mongoose.define('Dog')
    .oid('_id')
    .string('name');
var Dog = mongoose.Dog;

mongoose.define('User')
  .oid('_id')
  .string('name')
  .dbref('dog', Dog)
  .dbrefArray('puppies', Dog);
var User = mongoose.User;

mongoose.define('User2')
  .oid('_id')
  .string('name')
  .dbref('dog', DogSchema)
  .dbrefArray('puppies', DogSchema);
var User2 = mongoose.User2;

//console.log(DogSchema)

mongoose.define('User3')
  .oid('_id')
  .string('name')
  .dbref('dog', 'Dog')
  .dbrefArray('puppies', 'Dog');
var User3 = mongoose.User3;

// TODO api for refreshing/reloading data
module.exports = {
  setup: function (done) {
    Dog.remove({}, function () {
      User.remove({}, function () {
        done();
      });
    });
  },

  'setting via JSON input should allow you to access a Document instance (defined with model)': function (assert, done) {
    var user = new User({
      name: 'Charlie',
      dog: {name: 'Snoopy'}
    });
    user.dog.do( function (err, dog) {
      assert.ok((dog instanceof Dog) === true);
      done();
    });
  },

     
  'setting via JSON input should allow you to access a Document instance (defined with schema)': function (assert, done) {
    var user = new User2({
      name: 'Charlie',
      dog: {name: 'Snoopy'}
    });
    user.dog.do( function (err, dog) {
      assert.ok((dog instanceof Dog) === true);
      done();
    });
  },
 
  'setting via JSON input should allow you to access a Document instance (defined with string)': function (assert, done) {
    var user = new User3({
      name: 'Charlie',
      dog: {name: 'Snoopy'}
    });
    user.dog.do( function (err, dog) {
      assert.ok((dog instanceof Dog) === true);
      done();
    });
  },

  'setting to a new instance should allow you to access that new instance': function (assert, done) {
    var user = new User({
      name: 'Charlie',
      dog: new Dog({name: 'Snoopy'})
    });
    user.dog.do( function (err, dog) {
      assert.ok((dog instanceof Dog) === true);
      assert.ok(dog.name === 'Snoopy');
      done();
    });
  },

  'setting to a persisted instance should automatically set the dbref params': function (assert, done) {
    new Dog({
      name: 'Pluto'
    }).save( function (error, dog) {
      var user = new User({
        name: 'Mickey',
        dog: dog
      });
      assert.ok(typeof dog._.doc._id !== "undefined");
      assert.deepEqual(user._.doc.dog, new DBRef(dog._schema._collection, dog._.doc._id));
      done();
    });
  },

  'saving after setting the dbref to unpersisted data should automatically save that data to its own document': function (assert, done) {
    new User({
      name: 'Timmy',
      dog: {
        name: 'Lassie'
      }
    }).save( function (errors, user) {
      Dog.find({name: 'Lassie'}).first( function (err, dog) {
        user.dog.do( function (err, puppy) {
          assert.ok(puppy.id === dog.id);
          done();
        });
      });
    });
  },

  'a found object that has a dbref should be able to de-reference that dbref': function (assert, done) {
    User.create({
      name: 'Tintin',
      dog: { name: 'Milou' }
    }, function (err, createdUser) {
      User.first({name: 'Tintin'}, function (err, foundUser) {
        foundUser.dog.do( function (dog) {
          assert.ok((dog instanceof Dog) === true);
          done();
        });
      });
    });
  },

  'over-riding a dbref target with a different one should change the dbref params AND the de-referenced dbref': function (assert, done) {
    var user = new User({
      name: 'Charlie',
      dog: {
        name: 'Snoopy'
      }
    });
    user.dog.do( function (err, dog1) {
      var id1 = user._.doc.dog['$id'];
      user.dog = new Dog({name: 'Woodstock'});
      user.dog.do( function (err, dog2) {
        var id2 = user._.doc.dog.oid;
        assert.ok(dog1.id !== dog2.id);
        assert.ok(id1 !== id2);
        done();
      });
    });
  },

  'saving the referer after setting to a new dbref should update the dbref params': function (assert, done) {
    new User({
      name: 'Ed',
      dog: {
        name: 'Marmaduke'
      }
    }).save( function (errors, user) {
      var id1 = user._.doc.dog.oid
      user.dog = new Dog({ name: 'Droopy' });
      user.save( function (errors, user) {
        var id2 = user._.doc.dog['$id'];
        assert.ok(id1 !== id2);
        done();
      });
    });
  },

  'updating the dbref params directly should change the retrieved target on the next get': function (assert, done) {
    var user = new User({
      name: 'Lynn',
      dog: { // dog1
        name: 'Squeak'
      }
    });
    new Dog({ // dog2
      name: 'Banana Smashie'
    }).save( function (errors, dog2) {
      user.dog.do( function (dog1) { // dog1 should be Squeak
        user._.doc.dog.oid = dog2._.doc._id;
        user.dog.do( function (err, refreshedDog) {
          assert.ok(refreshedDog.name === dog2.name);
          done();
        });
      });
    });
  },

//  'saving the source after setting to a persisted instance should not update the de-referenced target': function () {
//  },

  'setting properties of the dbref target should persist when we save the referring (source) instance': function (assert, done) {
    new User({
      name: 'Turner',
      dog: {name: 'Hooch'}
    }).save( function (errors, user) {
      user.dog.do( function (err, dog) {
        dog.name = 'Hooch the 2nd';
        user.save( function (errors, user) {
          Dog.findById(dog.id, function (err, found) {
            assert.ok(found.name === 'Hooch the 2nd');
            done();
          });
        });
      })
    });
  },

  'test removing the dbref target': function (assert, done) {
    new User({
      name: 'Shaggy',
      dog: {
        name: 'Scooby'
      }
    }).save( function (errors, user) {
      user.dog.remove( function () {
        assert.ok( typeof user._.doc.dog === "undefined");
        user.dog.do( function (err, _dog) {
          assert.ok( typeof _dog === "undefined" );
          done();
        });
      });
    });
  },

//  'initializing a referring user without a dbref should set it to the default dbref': function () {
//  }
  teardown: function(){
    db.close();
  }
};
