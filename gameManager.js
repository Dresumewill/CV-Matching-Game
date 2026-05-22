'use strict';

const GAME_TTL_MS = 24 * 60 * 60 * 1000;

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class GameManager {
  constructor() {
    this.games = new Map();
  }

  createGame(password) {
    let code;
    do { code = generateCode(); } while (this.games.has(code));

    const game = {
      code,
      password,
      hostSocketId: null,
      state: 'lobby',
      players: new Map(),
      statements: [],
      currentRound: 0,
      votes: new Map(),
      roundResults: [],
      cleanupTimer: setTimeout(() => this.deleteGame(code), GAME_TTL_MS)
    };

    this.games.set(code, game);
    return code;
  }

  setHost(code, socketId) {
    const game = this.games.get(code);
    if (!game) return { error: 'Game not found' };
    game.hostSocketId = socketId;
    return { success: true };
  }

  joinGame(code, password, socketId, playerName) {
    const game = this.games.get(code);
    if (!game) return { error: 'Game not found. Check your game code.' };
    if (game.password !== password) return { error: 'Incorrect password.' };
    if (game.state !== 'lobby') return { error: 'This game has already started.' };
    if (!playerName) return { error: 'Name is required.' };
    if (playerName.length > 50) return { error: 'Name must be 50 characters or fewer.' };

    for (const p of game.players.values()) {
      if (p.name.toLowerCase() === playerName.toLowerCase()) {
        return { error: `"${playerName}" is already taken. Choose a different name.` };
      }
    }

    game.players.set(socketId, { id: socketId, name: playerName, hasSubmitted: false, statement: null });
    return { success: true };
  }

  submitStatement(code, socketId, statement) {
    const game = this.games.get(code);
    if (!game) return { error: 'Game not found' };
    if (game.state !== 'lobby') return { error: 'Game has already started' };
    const player = game.players.get(socketId);
    if (!player) return { error: 'You are not in this game' };
    if (player.hasSubmitted) return { error: 'You have already submitted your statement' };

    player.statement = statement;
    player.hasSubmitted = true;
    return { success: true };
  }

  startGame(code, socketId) {
    const game = this.games.get(code);
    if (!game) return { error: 'Game not found' };
    if (game.hostSocketId !== socketId) return { error: 'Only the host can start the game' };
    if (game.state !== 'lobby') return { error: 'Game has already started' };

    const submitted = Array.from(game.players.values()).filter(p => p.hasSubmitted);
    if (submitted.length < 2) return { error: 'At least 2 players must submit statements to start' };

    game.statements = shuffle(submitted.map(p => ({
      playerId: p.id,
      playerName: p.name,
      text: p.statement
    })));
    game.currentRound = 0;
    game.state = 'voting';
    game.votes = new Map();
    return { success: true };
  }

  castVote(code, voterSocketId, guessedPlayerId) {
    const game = this.games.get(code);
    if (!game) return { error: 'Game not found' };
    if (game.state !== 'voting') return { error: 'Not currently in voting phase' };

    const voter = game.players.get(voterSocketId);
    if (!voter) return { error: 'You are not a player in this game' };

    const round = game.statements[game.currentRound];
    if (voterSocketId === round.playerId) return { error: 'You cannot vote on your own statement' };
    if (game.votes.has(voterSocketId)) return { error: 'You have already voted' };
    // Validate against statement authors, not just currently-connected players,
    // so votes for someone who disconnected mid-game are still accepted.
    const validIds = new Set(game.statements.map(s => s.playerId));
    if (!validIds.has(guessedPlayerId)) return { error: 'Invalid vote' };

    game.votes.set(voterSocketId, guessedPlayerId);

    const eligibleVoters = Array.from(game.players.values()).filter(p => p.id !== round.playerId);
    const allVoted = eligibleVoters.length > 0 && eligibleVoters.every(p => game.votes.has(p.id));

    return { success: true, allVoted, votedCount: game.votes.size, totalEligible: eligibleVoters.length };
  }

  getRoundResult(code) {
    const game = this.games.get(code);
    if (!game) return null;

    const round = game.statements[game.currentRound];
    const eligibleVoters = Array.from(game.players.values()).filter(p => p.id !== round.playerId);

    const votes = eligibleVoters.map(voter => {
      const guessedId = game.votes.get(voter.id);
      const guessedPlayer = game.players.get(guessedId);
      return {
        voterId: voter.id,
        voterName: voter.name,
        guessedId,
        guessedName: guessedPlayer?.name ?? '(no vote)',
        isCorrect: guessedId === round.playerId
      };
    });

    const result = {
      roundIndex: game.currentRound + 1,
      totalRounds: game.statements.length,
      statement: round.text,
      actualPlayerId: round.playerId,
      actualPlayerName: round.playerName,
      votes,
      correctCount: votes.filter(v => v.isCorrect).length,
      totalVoters: votes.length
    };

    game.roundResults.push(result);
    game.state = 'round-results';
    return result;
  }

  nextRound(code, socketId) {
    const game = this.games.get(code);
    if (!game) return { error: 'Game not found' };
    if (game.hostSocketId !== socketId) return { error: 'Only the host can advance the game' };
    if (game.state !== 'round-results') return { error: 'Cannot advance now' };

    game.currentRound++;

    if (game.currentRound >= game.statements.length) {
      game.state = 'game-over';
      this.scheduleCleanup(code, 30 * 60 * 1000);
      return { success: true, gameOver: true };
    }

    game.votes = new Map();
    game.state = 'voting';
    return { success: true, gameOver: false };
  }

  getFinalResults(code) {
    const game = this.games.get(code);
    if (!game) return null;
    return { results: game.roundResults, totalStatements: game.statements.length };
  }

  scheduleCleanup(code, delayMs) {
    const game = this.games.get(code);
    if (!game) return;
    if (game.cleanupTimer) clearTimeout(game.cleanupTimer);
    game.cleanupTimer = setTimeout(() => this.deleteGame(code), delayMs);
  }

  deleteGame(code) {
    const game = this.games.get(code);
    if (game?.cleanupTimer) clearTimeout(game.cleanupTimer);
    this.games.delete(code);
  }

  getGame(code) {
    return this.games.get(code) ?? null;
  }
}

module.exports = GameManager;
