/**
 * Demonstrate query casting by:
 *  - Retrieving a document by creation date by passing a timestamp
 *  - Retrieving a document by object id by passing the hex representation
 *  - Retrieving a document by object id by passing a ObjectID
 */


 var mongoose = require('../lib/mongoose')
   , document = mongoose.define;

   document('Example')
    .oid('_id')
    .date('timestamp');

var db = mongoose.connect('mongodb://localhost/mongoose')
  , Example = mongoose.Example
  , example = new Example({ timestamp: new Date() })
  , date = +example.timestamp
  , oid = example._id
  , id = example.id;
  
  example.save(function(err, doc){
    if(err) console.log('Unexpected Error: ', err.msg);
    
    Example.find({_id: oid}).all(function(err,docs){
      if(docs.length == 1) console.log('found document using ObjectID');
      else console.log('finding document by ObjectID failed');
      
      Example.find({_id: id}).all(function(err, docs){
        if(docs.length == 1) console.log('found document using ObjectID.toHexString == '+ id);
        else console.log('finding document by ObjectID.toHexString failed');

        Example.find({timestamp: date}).all(function(err, docs){
          if(docs.length == 1) console.log('found document using Date unix timestamp == '+ (date));
          else console.log('found document using Date unix timestamp failed');   
          
          Example.drop(function(){
            db.close();
          });
        });
        
      });  
    });
  });
  
/*
  Expected Output:
  
  found document using ObjectID
  found document using ObjectID.toHexString == 4ce116efae1260ce55000001 // or something similar
  found document using Date unix timestamp == 1289819887313
  

*/
