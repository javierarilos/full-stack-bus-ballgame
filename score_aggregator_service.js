#!/usr/bin/env node
'use strict';


var amqp = require('amqp');
var _ = require('underscore');

var SCORED_MSG = 'single.score';
var AGGREGATED_SCORES = 'aggregated.scores';

var connection = amqp.createConnection({ host: '127.0.0.1' });

var scores = {};

connection.once('ready', function () {
    // Implicitly uses the default 'amq.topic' exchange
    connection.queue('score_aggregator_service', function (q) {
        // Subscribe to ballgame messages
        q.bind('ballgame');
        q.subscribe(function (messageTxt) {
            console.log('received:', messageTxt.data.toString());
            var message = JSON.parse(messageTxt.data.toString());
            if (message.type === SCORED_MSG) {
                var player = message.name;
                console.log("* score received for:", player);
                if (scores[player]) {
                    scores[player] += 1;
                } else {
                    scores[player] = 1;
                }
            } else {
                console.log("* discarding non score message");
            }
        });
    });
    console.log('declaring exchange');
    var exchange = connection.exchange('amq.topic', {durable: true}, function (exchange) {
        console.log('exchange OK');
        setInterval(function(){
            var sortedScores = _.chain(scores).pairs().sortBy(function(score){return - score[1]}).value();
            var sortedScoresMsg = {type: AGGREGATED_SCORES, value: {scores: sortedScores}};
            exchange.publish('ballgame', JSON.stringify(sortedScoresMsg));
        }, 5000);
    });
    exchange.on('error', function (err) {
       console.log('Exchange error:', err);
    });
});

connection.on('error', function (err) {
    console.log('Connection error:', err);
});
