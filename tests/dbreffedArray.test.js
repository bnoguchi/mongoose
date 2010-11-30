var assert = require('assert')
  , mongoose = require('mongoose').new()
  , db = mongoose.connect('mongodb://localhost/dbreffedArrayTests');

mongoose.define('Thought')
  .oid('_id')
  .string('descr')
  .number('rank')
  .dbref('thinker', 'CoolUser');

mongoose.define('CoolUser')
  .oid('_id')
  .string('name')
  .dbreffedArray('thoughts', 'Thought', {as: 'thinker'})
    .sort({rank: 1});
//    .page({limit: 10}); // TODO Add in this default pagination syntax
                          // TODO Implement the accompanying schemaType page method variation
                          // TODO ... .page(3), equiv to .page({limit: 10, skip: 20})

var Thought = mongoose.Thought;
var User = mongoose.CoolUser;

// TODO Test forEach, slice, splice, filter, map
module.exports = {
  setup: function (done) {
    Thought.remove({}, function () {
      User.remove({}, function () {
        done();
      });
    });
  },
  'setting an array upon initialization': function (assert, done) {
    User.create({
      name: 'Sid',
      thoughts: [
        {descr: 'Hello'},
        {descr: 'World'}
      ]
    }, function (err, user) {
      user.thoughts.all( function (_thoughts) {
        assert.equal(_thoughts.length, 2);
        assert.equal(_thoughts[0].descr, 'Hello');
        assert.equal(_thoughts[1].descr, 'World');
        done();
      });
    });
  },
  'building a new member of the array': function (assert, done) {
    var user = new User({name: 'Brian'});
    user.thoughts.build({
      descr: 'Thought 1'
    });
    user.thoughts.at(0, function (thought) {
      // should be able to reference the new but unsaved member
      assert.equal(thought.descr, 'Thought 1');
      thought.save( function (errors, thought) {
        // should automatically save the parent object
        User.find({name: 'Brian'}).first( function (err, foundUser) {
          thought.thinker.do( function (err, _author) {
            assert.equal(_author.name, foundUser.name);
            done();
          });
        });
      });
    });
  },
  'creating a new member for the array': function (assert, done) {
    var user = new User({name: 'Nathan'});
    user.thoughts.create({
      descr: 'Thought 2'
    }, function (_, _) {
      user.thoughts.at(0, function (thought) {
        // should be able to reference the new but unsaved member
        assert.equal(thought.descr, 'Thought 2');
        // should automatically save the parent object
        User.find({name: 'Nathan'}).first( function (err, foundUser) {
          thought.thinker.do( function (err, _author) {
            assert.equal(_author.name, foundUser.name);
            // should automatically save the thought
            Thought.findById(thought.id, function (err, foundThought) {
              assert.equal(foundThought.name, thought.name);
              done();
            });
          });
        });
      });
    });
  },
  'retrieving previously saved referring members via index': function (assert, done) {
    new User({name: 'Ryan Dahl'}).save( function (errors, user) {
      new Thought({ thinker: user, descr: 'Thought 3' }).save( function (_, _1) {
        new Thought({ thinker: user, descr: 'Thought 4' }).save( function (_, _2) {
          User.findById(user.id, function (err, foundUser) {
            foundUser.thoughts.at(0, function (thought0) {
              assert.equal(thought0.descr, 'Thought 3');
              foundUser.thoughts.at(1, function (thought1) {
                assert.equal(thought1.descr, 'Thought 4');
                done();
              });
            });
          });
        });
      });
    });
  },
  'retrieving previously saved referring members via all': function (assert, done) {
    new User({name: 'Tom Waits'}).save( function (errors, user) {
      new Thought({ thinker: user, descr: 'Thought 5' }).save( function (_, _1) {
        new Thought({ thinker: user, descr: 'Thought 6' }).save( function (_, _2) {
          User.findById(user.id, function (err, foundUser) {
            foundUser.thoughts.all(function (allThoughts) {
              assert.equal(allThoughts.length, 2);
              assert.equal(allThoughts[0].descr, 'Thought 5');
              assert.equal(allThoughts[1].descr, 'Thought 6');
              done();
            });
          });
        });
      });
    });
  },
  'retrieving previously saved referring members via pagination': function (assert, done) {
    new User({name: 'Dhali Lama'}).save( function (errors, user) {
      new Thought({ thinker: user, descr: '1' }).save( function (_, _) {
        new Thought({ thinker: user, descr: '2' }).save( function (_, _) {
          new Thought({ thinker: user, descr: '3' }).save( function (_, _) {
            new Thought({ thinker: user, descr: '4' }).save( function (_, _) {
              new Thought({ thinker: user, descr: '5' }).save( function (_, _) {
                User.findById(user.id, function (err, foundUser) {
                  foundUser.thoughts.page({limit: 2, skip: 1}).all(function (allThoughts) {
                    assert.equal(allThoughts.length, 2);
                    assert.equal(allThoughts[0].descr, '2');
                    assert.equal(allThoughts[1].descr, '3');
                    done();
                  });
                });
              });
            });
          });
        });
      });
    });
  },

  'retrieving previously saved referring members as JSON via toJSON': function (assert, done) {
    User.create({name: 'Popeye'}, function (err, user) {
      Thought.create({ thinker: user, descr: 'Spinach'}, function (_, thought1) {
        Thought.create({ thinker: user, descr: 'Olive Oyle' }, function (_, thought2) {
          User.findById(user.id, function (err, foundUser) {
            foundUser.thoughts.toJSON().all(function (allThoughts) {
              assert.equal(allThoughts.length, 2);
              assert.ok((allThoughts[0] instanceof Thought) === false);
              assert.equal(allThoughts[0]._id, thought1.id);
              assert.equal(allThoughts[0].descr, 'Spinach');
              assert.equal(allThoughts[0].thinker.namespace, 'CoolUsers');
              assert.equal(allThoughts[0].thinker.oid, user.id);
              done();
            });
          });
        });
      });
    });
  },

  'retrieving the dbreffedArray in sorted order': function (assert, done) {
    User.create({name: 'sorter'}, function (err, user) {
      user.thoughts.create({name: 'thought4', rank: 4}, function (err, thought4) {
        user.thoughts.create({name: 'thought10', rank: 10}, function (err, thought10) {
          user.thoughts.create({name: 'thought2', rank: 2}, function (err, thought2) {
            user.thoughts.map( function (el) {
              return el.rank;
            }).all( function (defaultSortedRanks) {
              // Assert default order
              assert.deepEqual([2,4,10], defaultSortedRanks);
              // TODO Assert over-ride order
              done();
            });
          });
        });
      });
    });
  },

  teardown: function(){
    db.close();
  }
};
