'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameManager = require('./gameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const manager = new GameManager();

app.use(express.static(path.join(__dirname, 'public')));

function playersArray(game) {
  return Array.from(game.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    hasSubmitted: p.hasSubmitted
  }));
}

function emitRoundStarted(code) {
  const game = manager.getGame(code);
  if (!game) return;

  const round = game.statements[game.currentRound];

  // Use all statement authors as voting candidates, even if they've since disconnected.
  // This keeps every name available as a guess target throughout the whole game.
  const players = game.statements.map(s => ({ id: s.playerId, name: s.playerName }));
  const eligibleVoterCount = players.filter(p => p.id !== round.playerId).length;

  io.to(code).emit('round-started', {
    statement: round.text,
    roundIndex: game.currentRound + 1,
    totalRounds: game.statements.length,
    players,
    eligibleVoterCount
  });

  io.to(round.playerId).emit('is-author');
}

function checkVotingComplete(code) {
  const game = manager.getGame(code);
  if (!game || game.state !== 'voting') return;

  const round = game.statements[game.currentRound];
  const eligibleVoters = Array.from(game.players.values()).filter(p => p.id !== round.playerId);

  if (eligibleVoters.length === 0 || eligibleVoters.every(p => game.votes.has(p.id))) {
    const result = manager.getRoundResult(code);
    io.to(code).emit('round-ended', result);
  }
}

io.on('connection', (socket) => {
  let gameCode = null;

  socket.on('create-game', ({ password } = {}, callback) => {
    if (typeof callback !== 'function') return;
    if (!password || password.trim().length < 3) {
      return callback({ error: 'Password must be at least 3 characters.' });
    }

    const code = manager.createGame(password.trim());
    manager.setHost(code, socket.id);
    gameCode = code;
    socket.join(code);
    callback({ gameCode: code });
  });

  socket.on('join-game', ({ gameCode: code, password, playerName } = {}, callback) => {
    if (typeof callback !== 'function') return;

    const normalised = code?.trim().toUpperCase();
    const result = manager.joinGame(normalised, password, socket.id, playerName?.trim());
    if (result.error) return callback({ error: result.error });

    gameCode = normalised;
    socket.join(gameCode);

    const game = manager.getGame(gameCode);
    const players = playersArray(game);
    callback({ success: true, players });
    socket.to(gameCode).emit('player-joined', { players });
  });

  socket.on('submit-statement', ({ statement } = {}, callback) => {
    if (typeof callback !== 'function') return;
    if (!gameCode) return callback({ error: 'Not in a game' });

    const trimmed = statement?.trim();
    if (!trimmed || trimmed.length < 10) {
      return callback({ error: 'Statement must be at least 10 characters.' });
    }

    const result = manager.submitStatement(gameCode, socket.id, trimmed);
    if (result.error) return callback({ error: result.error });

    callback({ success: true });

    const game = manager.getGame(gameCode);
    const players = playersArray(game);
    const submittedCount = players.filter(p => p.hasSubmitted).length;
    io.to(gameCode).emit('statement-submitted', {
      submittedCount,
      totalCount: players.length,
      players
    });
  });

  socket.on('start-game', (callback) => {
    if (typeof callback !== 'function') return;
    if (!gameCode) return callback({ error: 'Not in a game' });

    const result = manager.startGame(gameCode, socket.id);
    if (result.error) return callback({ error: result.error });

    callback({ success: true });
    emitRoundStarted(gameCode);
  });

  socket.on('cast-vote', ({ guessedPlayerId } = {}, callback) => {
    if (typeof callback !== 'function') return;
    if (!gameCode) return callback({ error: 'Not in a game' });

    const result = manager.castVote(gameCode, socket.id, guessedPlayerId);
    if (result.error) return callback({ error: result.error });

    callback({ success: true });

    if (result.allVoted) {
      const roundResult = manager.getRoundResult(gameCode);
      io.to(gameCode).emit('round-ended', roundResult);
    } else {
      io.to(gameCode).emit('vote-received', {
        votedCount: result.votedCount,
        totalCount: result.totalEligible
      });
    }
  });

  socket.on('next-round', (callback) => {
    if (typeof callback !== 'function') return;
    if (!gameCode) return callback({ error: 'Not in a game' });

    const result = manager.nextRound(gameCode, socket.id);
    if (result.error) return callback({ error: result.error });

    callback({ success: true });

    if (result.gameOver) {
      io.to(gameCode).emit('game-ended', manager.getFinalResults(gameCode));
    } else {
      emitRoundStarted(gameCode);
    }
  });

  socket.on('disconnect', () => {
    if (!gameCode) return;

    const game = manager.getGame(gameCode);
    if (!game) return;

    game.players.delete(socket.id);

    if (game.players.size > 0) {
      socket.to(gameCode).emit('player-left', { players: playersArray(game) });
    }

    // If someone left during voting, check if remaining players are all voted
    checkVotingComplete(gameCode);
  });
});

const PORT = process.env.PORT ?? 3000;
server.listen(PORT, () => {
  console.log(`CV Matching Game running on http://localhost:${PORT}`);
});

module.exports = { app, server };
