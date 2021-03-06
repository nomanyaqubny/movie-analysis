//-----------------------------------------------------------------------------
// Copyright (c) 2015, IBM Corp.
// All rights reserved.
//
// Distributed under the terms of the BSD Simplified License.
//
// The full license is in the LICENSE file, distributed with this software.
//
// You may not use this file except in compliance with the License.
//------------------------------------------------------------------------------

"use strict"

/**********************************
This model js file is responsible for interaction with IBM Insights for Twitter service

Provides method:
    1. get count of tweets available against a query
    2. retrieve and insert tweets into database
        a. create a new table to insert tweets
        b. asynchronously retrieve, parse, encode and insert tweets
        c. load R script and calculate tweets decline rate

Author: Noman Yaqub
***********************************/

var async = require('async'),
    filereader = require('fs'),
    path = require('path'),
    request = require('request'),
    Database = require('./database'),
    config = require('nconf'),
    version = 'api:' + config.get("api:version");

var MAX_TWEETS = 500, 
    insightHOST, 
    schemaTweetMap,
    dashDB,
    db = new Database();

populateSchemaTweetMap();
getColumns();

var services = JSON.parse(process.env.VCAP_SERVICES || "{}");
    insightHOST = services["twitterinsights"] ? services["twitterinsights"][0].credentials.url : config.get(version + ':twitterInsights').url;
    dashDB = services["dashDB"] ? services["dashDB"][0].credentials : config.get(version + ':dashDB');

function TwitterInsight(searchString) {
    this.query = searchString;
    this.count = 0;
    this.progress = 0;
}

// the JavaScript prototype property allows you to add new methods to an existing prototype:
TwitterInsight.prototype = {
	getCount: function(callback) {
        var url = insightHOST + '/api/v1/messages/count';
        var self = this;
        retrieveInsight(url, this.query, function(err, data) {
            if(!err) {
                self.count = data['search']['results'];
                data.count = self.count;
            }
            callback(err, data);
        });
    },
    insert: function(movieID, movieName, tableName, callback) {
        //check if there is already an ajax running
        var self = this;
        if(self.progress == 0) {
            //create a table with the movie name to store tweets
            var url = insightHOST + '/api/v1/messages/search';
            createMovieTweetsTable(db, tableName, function(err, data) {
                if(!err) {
                    //retrieve the tweets and insert into table
                    //Twitter for Insight provides at max 500 tweets per request
                    //call the retrieve and insert function total number of tweets / max tweets per request
                    var times =  Math.ceil(self.count / MAX_TWEETS);
                    async.timesLimit(times, 25, function(n, next) {
                        retrieveInsight(url, self.query, function(err, data) {
                            if (!err && data['tweets'].length > 0) {
                                insertTweets(db, tableName, data['tweets'], function(err, result, rows) {
                                    if (!err) {
                                        self.progress += rows;
                                        process.stdout.write("\rso far: " + self.progress);
                                    }
                                    next(err, result);
                                });
                            } else if (err && !data) {
                                console.log(err)
                            } else {
                                next(err, data)
                            }
                        }, (n*MAX_TWEETS));
                    }, function (err, data) {
                        data = getData(data);
                        if(!err) {
                            calculateDeclineRate(movieID, tableName, function(err, result) {
                                data.declineRate = result;
                                callback(err, {count: self.progress, data: data});
                            });
                        } else {
                            callback(err, {count: self.progress, data: data});
                        }
                    });
                } else {
                    callback(err, {count: self.progress, data: data});
                }
            });
        }
    },
    print: function() {
        console.log("No. of Tweets found: " + count);
    }
}

function calculateDeclineRate(movieID, tableName, callback) {
    // var command = "library(ibmdbR)\ncon <- idaConnect(\"BLUDB\",\"\",\"\")\nidaInit(con)\ntweetCountsPerState <- idaQuery(\"SELECT SMAAUTHORSTATE AS STATE, DATE(MSGPOSTEDTIME) AS DATE, COUNT(*) AS CNT FROM "+tableName+" a INNER JOIN US_STATES b ON a.SMAAUTHORSTATE=b.STATE WHERE DATE(MSGPOSTEDTIME)>'2015-01-15' GROUP BY SMAAUTHORSTATE,DATE(MSGPOSTEDTIME) ORDER BY DATE\")\n#Calculate the decline of tweets between opening weekend and now\ntweetCountsPerState$CNT <- as.numeric(tweetCountsPerState$CNT)\ntweetCountsPerState <- na.omit(tweetCountsPerState)\nx <- by(tweetCountsPerState,tweetCountsPerState$STATE,function(df){df[nrow(df),\"CNT\"]/df[1,\"CNT\"]}, simplify=F)\nresult <- data.frame(MOVIE_ID="+movieID+",STATE_ISO=names(x),DECLINE_RATE=as.numeric(as.vector(x)))\n#Write this to a db table\nsqlSave(con, result, tablename = \"TWEET_ALERTS\", append = TRUE, rownames = FALSE)";    
    // console.log(command);

    var filePath = path.join(__dirname, 'rScript.R');
    var command = filereader.readFileSync(filePath, "utf8");
    
    command = command.replace(/REPLACE_TABLE_NAME/g, tableName).replace(/REPLACE_MOVIE_ID/g, movieID);
    console.log(command);

    request({
        method: "POST",
        url: dashDB.https_url + "/console/blushiftservices/BluShiftHttp.do",
        qs: {
            'profileName' : dashDB.db,
            'userid' : dashDB.username,
            'cmd' : 'RScriptRunScript',
            'command' : command
        },
        auth: {
            'user': dashDB.username,
            'pass': dashDB.password
        },
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    }, function(err, response, data) {
        console.log("calculateDeclineRate callback")
        callback(err, data);
    });
}

function getData(data) {
    if(data.length > 1) {
        for (var i = 0; i < data.length; i++) {
            if(data[i] !== null && typeof data[i] === 'object') {
                return data[i];
            }
        };
    } 
}
function retrieveInsight(url, query, callback, from) {
    var params = null;
    //send query parameters as below in order to handle special characters in values such as '#'
    if(query) {
        params = {
            q: query,
            size: MAX_TWEETS,
            from: from?from:0
        }
    }
    request({
        method: "GET",
        url: url,
        qs: params,
        // pool: pool,
        headers: {
            'Content-Type': 'application/json;charset=utf-8'
        }
    }, function(err, response, data) {
        if (err) {
            callback(err);
        } else {
            if (response.statusCode == 200) {
                try {
                    callback(null, JSON.parse(data));
                } catch(e) {
                    callback(true, {
                        message: { 
                            description: e.message
                        },
                        status_code: response.statusCode
                    });
                }
            } else {
                callback(true, {
                    message: {
                        description: data 
                    },
                    status_code: response.statusCode
                });
            }
        }
    });
}

function createMovieTweetsTable (db, tableName, callback) {
    var createTableQuery = 'CREATE TABLE '
        + tableName
        + '(GENERATORDISPLAYNAME VARCHAR(1024),'
        + 'ID INT NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1),'
        + 'MSGBODY VARCHAR(2048),'
        + 'MSGHASHTAGS VARCHAR(2048),'
        + 'MSGID VARCHAR(128),'
        + 'MSGPOSTEDTIME TIMESTAMP,'
        + 'MSGTYPE VARCHAR(128),'
        + 'MSGSENTIMENT VARCHAR(128) NOT NULL WITH DEFAULT \'NEUTRAL\','
        + 'SMAAUTHORCITY VARCHAR(1024),'
        + 'SMAAUTHORCOUNTRY VARCHAR(1024),'
        + 'SMAAUTHORGENDER VARCHAR(1024),'
        + 'SMAAUTHORSTATE VARCHAR(1024),'
        + 'USERDISPLAYNAME VARCHAR(1024),'
        + 'USERFOLLOWERSCOUNT INT,'
        + 'USERFRIENDSCOUNT INT,'
        + 'USERID VARCHAR(128),'
        + 'USERLANGUAGE VARCHAR(128),'
        + 'USERLINK VARCHAR(1024),'
        + 'USERLISTEDCOUNT INT,'
        + 'USERLOCATION VARCHAR(1024),'
        + 'USERPREFERREDUSERNAME VARCHAR(1024),'
        + 'USERSTATUSESCOUNT INT,'
        + 'USERUTCOFFSET VARCHAR(1024),'
        + 'USERVERIFIED VARCHAR(1024),'
        + 'PRIMARY KEY(ID)'
        + ') ORGANIZE BY ROW';

    // db.checkTableExist(tableName, function(found) {
        // db.executeQuery(dropFirst, function(result) {
        // console.log(result);
        // if(!found) {
            db.executeQuery(createTableQuery, function(err, result) {
                if(err) console.log("Error in creating tweet table for the movie");
                callback(err, {message:"New table "+ tableName +" created"});
            });
        // } else {
            //TODO: dro table if exist logic ot beimpl
            // console.log("Table exists already");
            // callback(false, {message:"Table exists already."});
        // }
    // });
    // });
}

function insertTweets(db, tableName, tweets, callback) {
    try {
        var insertQuery = "INSERT INTO " + tableName + " (" + getColumns() + ") VALUES ";
        for (var i = 0; i < tweets.length; i++) {
            insertQuery += "("+ getColumnsValues(tweets[i]) + "),";
        }
        insertQuery = insertQuery.slice(0,-1);
        db.executeQuery(insertQuery, function(err, result) {
            if( !err ) {
                // console.log("db insert: success")
                result.message = result.message + " IN TWEETS INSERTION";
                callback(err, result, i);
            } else {
                // console.log(insertQuery)
                // console.log(result)
                console.log("db insert: failure")
                result.message = result.message + " IN TWEETS INSERTION.";
                callback(err, result, i);
            }
        });
    } catch(e) {
        console.log('catch')
        // console.log(insertQuery)
        console.log(result)
        console.log(e)
        callback(true, e)
    }
}

function populateSchemaTweetMap() {
    schemaTweetMap = {
        'GENERATORDISPLAYNAME':{
            'type':'VARCHAR',
            'mapping':'message.generator.displayName'
        },
        'MSGBODY':{
            'type':'VARCHAR',
            'mapping':'message.body'
        },
        'MSGHASHTAGS':{
            'type':'VARCHAR',
            'mapping':'message.twitter_entities.hashtags'
        },
        'MSGID':{
            'type':'VARCHAR',
            'mapping':'message.id'
        },
        'MSGPOSTEDTIME':{
            'type':'TIMESTAMP',
            'mapping':'message.postedTime'
        },
        'MSGTYPE':{
            'type':'VARCHAR',
            'mapping':'message.verb'
        },
        'MSGSENTIMENT':{
            'type':'VARCHAR',
            'mapping':'cde.content.sentiment.polarity',
            'default':'NEUTRAL'
        },
        'SMAAUTHORCITY':{
            'type':'VARCHAR',
            'mapping':'cde.author.location.city'
        },
        'SMAAUTHORCOUNTRY':{
            'type':'VARCHAR',
            'mapping':'cde.author.location.country'
        },
        'SMAAUTHORGENDER':{
            'type':'VARCHAR',
            'mapping':'cde.author.gender'
        },
        'SMAAUTHORSTATE':{
            'type':'VARCHAR',
            'mapping':'cde.author.location.state'
        },
        'USERDISPLAYNAME':{
            'type':'VARCHAR',
            'mapping':'message.actor.displayName'
        },
        'USERFOLLOWERSCOUNT':{
            'type':'INT',
            'mapping':'message.actor.followersCount'
        },
        'USERFRIENDSCOUNT':{
            'type':'INT',
            'mapping':'message.actor.friendsCount'
        },
        'USERID':{
            'type':'VARCHAR',
            'mapping':'message.actor.id'
        },
        'USERLANGUAGE':{
            'type':'VARCHAR',
            'mapping':'message.actor.languages'
        },
        'USERLINK':{
            'type':'VARCHAR',
            'mapping':'message.actor.links.href'
        },
        'USERLISTEDCOUNT':{
            'type':'INT',
            'mapping':'message.actor.listedCount'
        },
        'USERLOCATION':{
            'type':'VARCHAR',
            'mapping':'message.actor.location.displayName'
        },
        'USERPREFERREDUSERNAME':{
            'type':'VARCHAR',
            'mapping':'message.actor.preferredUsername'
        },
        'USERSTATUSESCOUNT':{
            'type':'INT',
            'mapping':'message.actor.statusesCount'
        },
        'USERUTCOFFSET':{
            'type':'VARCHAR',
            'mapping':'message.actor.utcOffset'
        },
        'USERVERIFIED':{
            'type':'VARCHAR',
            'mapping':'message.actor.verified'
        }
    }
}

function getColumns() {
    var keys = '';
    for(var key in schemaTweetMap) {
        keys += key + ',';
    }
    return keys.slice(0,-1);
}

function getColumnsValues(tweet) {
    var index, value = '', values = '';
    for(var key in schemaTweetMap) {
        index = schemaTweetMap[key].mapping;
        value = getObjectValue(tweet, index);
        if (!value) {
            value = (schemaTweetMap[key].default)? "'"+schemaTweetMap[key].default+"'" : null;
        } else if (schemaTweetMap[key].type === "VARCHAR") {
            value = "'" + value.replace(/\'/g,"''") + "'";
        } else if (schemaTweetMap[key].type === "INT") {
            value = parseInt(value) ;
        } else if (schemaTweetMap[key].type === "TIMESTAMP") {
            value = "'" + value.substring(0,10) + " " + value.substring(11,19) + "'";
        }
        values += value + ", ";
    }
    return values.slice(0,-2);
}

function getObjectValue(tweet, stringMultipleIndexes) {
    var index = stringMultipleIndexes.split('.');
    var value = tweet;
    for(var i = 0; i < index.length; i++) {

        if (value[index[i]] != null && value[index[i]] != undefined) {
            value = value[index[i]];
        } else {
            return null;
        }
    }
    return String(value);
}

module.exports = TwitterInsight;