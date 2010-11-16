/**
 * Demonstrate partial hydration in
 *  - Query syntax. Query the database for a few documents, and only partially
 *  hydrate them
 *  - Error handling. Try to .get() a key that has not been hydrated. 
 *  - Hydration checking. Call .hydrated('some.path') to check if a path is
 *  hydrated or not
 */


 var mongoose = require('../lib/mongoose')
   , document = mongoose.define;

 var db = mongoose.connect('mongodb://localhost/mongoose');

 document('User')
   .oid('_id')
   .object('name',
     document()
       .string('first')
       .string('last'))
   .object('contact',
     document()
       .string('email')
       .string('phone'))
   .number('age')
   .bool('dead');
   
   
  var User = mongoose.User;
  
  var user = new User({
    name: { 
      first: 'Herman',
      last: 'Melville'
    },
    contact: {
      email: 'herman@melville.org',
      phone: '555-555-5555'
    },
    age: 91,
    dead: true
  });
  
  user.save(function(err){
    
    User.find({ 'name.last': 'Melville' }, { contact: true }).one(function(err, doc){
      console.log('-------- contact only --------');
      console.log("Name: ", doc.name);
      console.log("Age: " + doc.age);
      console.log("Contact: ", doc.contact);
      console.log('contact hydrated: ', doc.hydrated('contact'));
      console.log('contact.phone hydrated: ', doc.hydrated('contact.phone'));
      console.log('name hydrated: ', doc.hydrated('name'));
      console.log('age hydrated: ', doc.hydrated('age'));
      
      console.log('-------- age only --------');
      User.find({ dead: true }, 'age').one(function(err, doc){
        console.log("Name: " + JSON.stringify(doc.name));
        console.log("Age: " + doc.age);
        console.log("Contact: " + JSON.stringify(doc.contact));
        console.log('contact hydrated: ', doc.hydrated('contact'));
        console.log('contact.phone hydrated: ', doc.hydrated('contact.phone'));
        console.log('name hydrated: ', doc.hydrated('name'));
        console.log('age hydrated: ', doc.hydrated('age'));
      
      
        console.log('-------- not contact --------');
        User.find({}, {contact: false}).one(function(err, doc){
          console.log("Name: " + doc.name);
          console.log("Age: " + doc.age);
          console.log("Contact: " + JSON.stringify(doc.contact));
          console.log('contact hydrated: ', doc.hydrated('contact'));
          console.log('contact.phone hydrated: ', doc.hydrated('contact.phone'));
          console.log('name hydrated: ', doc.hydrated('name'));
          console.log('age hydrated: ', doc.hydrated('age'));
          
           console.log('-------- not contact, yes name --------');
           console.log('-------- positive/negative queries create errors --------');
           console.log('-------- mongoose takes first and excludes anything not matching --------');
          User.find({},{contact: false, name: true}).one(function(err, doc){
            console.log("Name: " + doc.name);
            console.log("Age: " + doc.age);
            console.log("Contact: " + JSON.stringify(doc.contact));
            console.log('contact hydrated: ', doc.hydrated('contact'));
            console.log('contact.phone hydrated: ', doc.hydrated('contact.phone'));
            console.log('name hydrated: ', doc.hydrated('name'));
            console.log('age hydrated: ', doc.hydrated('age'));
    
            User.drop(function(){
              db.close();
            });
            
          })
          
        });
      });
    });
  });
  
/*

  Expected Results:
  
  -------- contact only --------
  Name:  undefined
  Age: undefined
  Contact:  [object Object]
  contact hydrated:  true
  contact.phone hydrated:  true
  name hydrated:  false
  age hydrated:  false
  -------- age only --------
  Name: undefined
  Age: 91
  Contact: undefined
  contact hydrated:  false
  contact.phone hydrated:  false
  name hydrated:  false
  age hydrated:  true
  -------- not contact --------
  Name: [object Object]
  Age: 91
  Contact: undefined
  contact hydrated:  false
  contact.phone hydrated:  false
  name hydrated:  true
  age hydrated:  true
  -------- not contact, yes name --------
  -------- positive/negative queries create errors --------
  -------- mongoose takes first and excludes anything not matching --------
  Name: [object Object]
  Age: 91
  Contact: undefined
  contact hydrated:  false
  contact.phone hydrated:  false
  name hydrated:  true
  age hydrated:  true

*/