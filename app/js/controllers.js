'use strict';

var ballgameApp = angular.module('ballgameApp', []);

var NEW_PLAYER_MSG = 'single.new-player';
var BALL_MSG = 'ball';
var SCORED_MSG = 'single.score';
var AGGREGATED_SCORES = 'aggregated.scores';

function clearPlayfield(playfield) {
    for (var rowName in playfield) {
        var row = playfield[rowName];
        for (var rounName in row) {
            row[rounName] = '';
        }
    }
}

function generateLogEvent(msg) {
    var d = new Date();
    return {date: d.getHours()+':'+d.getMinutes()+':'+d.getSeconds(), txt: msg};
}

function addBallGameEventToLog(scope, gameEvent){
    var event = generateLogEvent('Ballgame event: ' + gameEvent);
    scope.events.unshift(event);
}

function updateAggregatedScores(scope, msg) {
    scope.aggregatedScores = msg.value.scores;
}

function generateMessageObjectToSend(type, name, value) {
    return {type: type, name: name, value: value, ts: new Date().toString()};
}

function generateNewPlayerMessage(name) {
    return generateMessageObjectToSend(NEW_PLAYER_MSG, name, {player: name});
}

function generateBallMessage(ball, name) {
    return generateMessageObjectToSend(BALL_MSG, name, {ball: ball});
}

function generateScoredMessage(name) {
    return generateMessageObjectToSend(SCORED_MSG, name, {player: name});
}

function parseBallMessage(ballStr) {
    var ball = JSON.parse(ballStr);
    return ball.value.ball;
}

function generateBall(name) {
    return {player: name, ballStr: "[" + name + "]"};
}

function generateRandomPosition() {
    var row = Math.floor(Math.random() * 4);
    var column = Math.floor(Math.random() * 4);
    return [row, column];
}

function putBall(playfield, ball, position) {
    if (!position) {
        position = generateRandomPosition();
    }
    var row = position[0];
    var column = position[1];
    if (!playfield[row][column]) {
        playfield[row][column] = ball;
    } else {
        putBall(playfield, ball);
    }
    console.log('PutBall in [', row, '][', column, ']:', playfield[row][column]);
}

function parsePosition(positionTxt) {
    // position expected in the form: "row-column"
    var lengthOk = positionTxt.length === 3;
    var separatorOk = positionTxt.charAt(1) === '-';
    var row = parseInt(positionTxt.charAt(0), 10);
    var rowOk = row < 4;
    var column = parseInt(positionTxt.charAt(2), 10);
    var columnOk = column < 4;

    if (lengthOk && separatorOk && rowOk && columnOk) {
        var position = [row, column];
        console.log('parsed position: ', position);
        return position;
    } else {
        console.log('could not parse position:', positionTxt);
        return null;
    }
}

function pickBall(playfield, position) {
    var row = position[0];
    var column = position[1];
    var ball = playfield[row][column];
    if (ball) {
        playfield[row][column] = '';
    }
    console.log('picked ball at position column[', column, '] row [', row, '] = ', ball);
    return ball;
}

function publishBallGameEvent(client, msg) {
    client.send('/topic/ballgame', {"content-type": "text/plain"}, JSON.stringify(msg));
}

function sendBall(client, ball) {
    client.send('/queue/balls', {"content-type": "text/plain"}, JSON.stringify(ball));
}

function setupPostal(scope){

    var channel = postal.channel();

    var aggSubscription = channel.subscribe( AGGREGATED_SCORES, function( msg ) {
        console.log('€€€€€€ aggSubscription', msg);
        updateAggregatedScores(scope, msg);
        scope.$apply();
    } );

    var singleSubscription = channel.subscribe( 'single.*', function( msg ) {
        console.log('****** singleSubscription', msg);
        addBallGameEventToLog(scope, JSON.stringify(msg));
        scope.$apply();
    } );

// And someone publishes a name change:

    scope.postalChannel = channel;
}

function connectToRabbit(scope) {
    var ws = new SockJS('http://' + window.location.hostname + ':15674/stomp');
    var client = Stomp.over(ws);

    scope.ws = ws;
    scope.client = client;

    // SockJS does not support heart-beat: disable heart-beats
    client.heartbeat.outgoing = 0;
    client.heartbeat.incoming = 0;

    var on_connect = function () {
        client.subscribe("/topic/ballgame", function (d) {
            var msg = JSON.parse(d.body);

            scope.postalChannel.publish( msg.type, msg );
            scope.$apply();
        });

        client.subscribe("/queue/balls", function (d) {
            var ball = parseBallMessage(d.body);
            addBallGameEventToLog(scope, 'Pong! received: ' + JSON.stringify(ball));
            putBall(scope.playfield, ball);
            scope.$apply();
        });

        publishBallGameEvent(client, generateNewPlayerMessage(scope.name));
    };

    var on_error = function (err) {
        console.log('error connecting to RabbitMQ:', err);
    };

    client.connect('guest', 'guest', on_connect, on_error, '/');
}

ballgameApp.controller('BallgameController', function ($scope) {
    $scope.playfield = [
        ['0-0', '0-1', '0-2', '0-3'],
        ['1-0', '1-1', '1-2', '1-3'],
        ['2-0', '2-1', '2-2', '2-3'],
        ['3-0', '3-1', '3-2', '3-3']
    ];
    $scope.events = [generateLogEvent('Ballgame loaded')];
    $scope.buttonText = 'Start!';
    $scope.playing = false;
    $scope.ballsPlayed = 0;
    $scope.positionToPingTxt = '';
    $scope.name = '';
    $scope.nameIsInvalid = true;

    $scope.nameChanged = function () {
        var name = $scope.name;
        if (name && name.length >= 3) {
            $scope.nameIsInvalid = false;
        } else {
            $scope.nameIsInvalid = true;
        }
    };

    $scope.ping = function () {
        var position = parsePosition($scope.positionToPingTxt);
        if (!position) {
            addBallGameEventToLog($scope, 'Fail! Pinged to invalid position: "' + $scope.positionToPingTxt + '"');
            return;
        }
        addBallGameEventToLog($scope, 'Ping! position: "' + $scope.positionToPingTxt + '"');
        var ball = pickBall($scope.playfield, position);
        if (ball) {
            addBallGameEventToLog($scope, 'Picked ball "' + ball + '".');

            sendBall($scope.client, generateBallMessage(ball, $scope.name));
            publishBallGameEvent($scope.client, generateScoredMessage($scope.name));
        } else {
            addBallGameEventToLog($scope, 'Fail! no ball at: "' + position + '"');
        }
    };

    $scope.buttonClicked = function () {
        if ($scope.playing) {
            $scope.ping();
        } else if (!$scope.nameIsInvalid) {
            $scope.startPlaying();
        }
    };

    $scope.startPlaying = function () {
        clearPlayfield($scope.playfield);
        setupPostal($scope);
        connectToRabbit($scope);
        $scope.buttonText = 'Ping!';
        $scope.playing = true;
        addBallGameEventToLog($scope, 'Starting to play a Ballgame');
        var ball = generateBall($scope.name);
        putBall($scope.playfield, ball.ballStr);
        $scope.putBallTs = Date.now();
    };
});
