'use strict';

const GameManager = require('../gameManager');

let manager;

beforeEach(() => { manager = new GameManager(); });
afterEach(() => {
  for (const code of manager.games.keys()) manager.deleteGame(code);
});

// ── createGame ───────────────────────────────────────────────────────────────

describe('createGame', () => {
  test('returns a 6-character code', () => {
    expect(manager.createGame('pass')).toHaveLength(6);
  });

  test('creates game in lobby state', () => {
    const code = manager.createGame('pass');
    expect(manager.getGame(code).state).toBe('lobby');
  });

  test('generates unique codes across multiple games', () => {
    const codes = Array.from({ length: 20 }, () => manager.createGame('pass'));
    expect(new Set(codes).size).toBe(20);
  });
});

// ── setHost / joinGame ───────────────────────────────────────────────────────

describe('joinGame', () => {
  let code;
  beforeEach(() => {
    code = manager.createGame('secret');
    manager.setHost(code, 'host');
  });

  test('succeeds with correct credentials', () => {
    expect(manager.joinGame(code, 'secret', 's1', 'Alice').success).toBe(true);
  });

  test('rejects wrong password', () => {
    expect(manager.joinGame(code, 'wrong', 's1', 'Alice').error).toBeTruthy();
  });

  test('rejects unknown game code', () => {
    expect(manager.joinGame('XXXXXX', 'secret', 's1', 'Alice').error).toBeTruthy();
  });

  test('rejects duplicate name (case-insensitive)', () => {
    manager.joinGame(code, 'secret', 's1', 'Alice');
    expect(manager.joinGame(code, 'secret', 's2', 'alice').error).toBeTruthy();
  });

  test('rejects empty name', () => {
    expect(manager.joinGame(code, 'secret', 's1', '').error).toBeTruthy();
  });

  test('rejects joining a started game', () => {
    manager.joinGame(code, 'secret', 's1', 'Alice');
    manager.joinGame(code, 'secret', 's2', 'Bob');
    manager.submitStatement(code, 's1', 'Alice personal statement text.');
    manager.submitStatement(code, 's2', 'Bob personal statement text here.');
    manager.startGame(code, 'host');
    expect(manager.joinGame(code, 'secret', 's3', 'Charlie').error).toBeTruthy();
  });
});

// ── submitStatement ──────────────────────────────────────────────────────────

describe('submitStatement', () => {
  let code;
  beforeEach(() => {
    code = manager.createGame('secret');
    manager.setHost(code, 'host');
    manager.joinGame(code, 'secret', 's1', 'Alice');
  });

  test('marks player as submitted', () => {
    manager.submitStatement(code, 's1', 'My personal statement here.');
    expect(manager.getGame(code).players.get('s1').hasSubmitted).toBe(true);
  });

  test('rejects duplicate submission', () => {
    manager.submitStatement(code, 's1', 'First statement text here.');
    expect(manager.submitStatement(code, 's1', 'Second attempt').error).toBeTruthy();
  });

  test('rejects submission from non-player', () => {
    expect(manager.submitStatement(code, 'unknown', 'Statement text.').error).toBeTruthy();
  });
});

// ── startGame ────────────────────────────────────────────────────────────────

describe('startGame', () => {
  let code;
  beforeEach(() => {
    code = manager.createGame('secret');
    manager.setHost(code, 'host');
    manager.joinGame(code, 'secret', 's1', 'Alice');
    manager.joinGame(code, 'secret', 's2', 'Bob');
  });

  test('transitions to voting state', () => {
    manager.submitStatement(code, 's1', 'Alice personal statement text here.');
    manager.submitStatement(code, 's2', 'Bob personal statement text here.');
    manager.startGame(code, 'host');
    expect(manager.getGame(code).state).toBe('voting');
  });

  test('rejects start from non-host', () => {
    manager.submitStatement(code, 's1', 'Alice statement text here.');
    manager.submitStatement(code, 's2', 'Bob statement text here.');
    expect(manager.startGame(code, 's1').error).toBeTruthy();
  });

  test('rejects start with fewer than 2 submissions', () => {
    manager.submitStatement(code, 's1', 'Only one statement here.');
    expect(manager.startGame(code, 'host').error).toBeTruthy();
  });

  test('shuffles and includes only submitted players', () => {
    manager.joinGame(code, 'secret', 's3', 'Charlie'); // no submission
    manager.submitStatement(code, 's1', 'Alice statement text here.');
    manager.submitStatement(code, 's2', 'Bob statement text here.');
    manager.startGame(code, 'host');
    const game = manager.getGame(code);
    expect(game.statements).toHaveLength(2);
    expect(game.statements.every(s => s.playerName !== 'Charlie')).toBe(true);
  });
});

// ── castVote + getRoundResult ────────────────────────────────────────────────

describe('voting', () => {
  let code, authorId;
  beforeEach(() => {
    code = manager.createGame('secret');
    manager.setHost(code, 'host');
    manager.joinGame(code, 'secret', 's1', 'Alice');
    manager.joinGame(code, 'secret', 's2', 'Bob');
    manager.joinGame(code, 'secret', 's3', 'Charlie');
    manager.submitStatement(code, 's1', 'Alice loves coding.');
    manager.submitStatement(code, 's2', 'Bob enjoys problems.');
    manager.submitStatement(code, 's3', 'Charlie builds things.');
    manager.startGame(code, 'host');
    authorId = manager.getGame(code).statements[0].playerId;
  });

  function nonAuthors() {
    return ['s1', 's2', 's3'].filter(id => id !== authorId);
  }

  test('accepts valid vote', () => {
    expect(manager.castVote(code, nonAuthors()[0], authorId).success).toBe(true);
  });

  test('rejects author voting on own statement', () => {
    expect(manager.castVote(code, authorId, nonAuthors()[0]).error).toBeTruthy();
  });

  test('rejects duplicate vote', () => {
    const [v] = nonAuthors();
    manager.castVote(code, v, authorId);
    expect(manager.castVote(code, v, authorId).error).toBeTruthy();
  });

  test('reports allVoted when all eligible players have voted', () => {
    const [v1, v2] = nonAuthors();
    manager.castVote(code, v1, authorId);
    const result = manager.castVote(code, v2, authorId);
    expect(result.allVoted).toBe(true);
  });

  test('getRoundResult counts correct guesses', () => {
    const [v1, v2] = nonAuthors();
    manager.castVote(code, v1, authorId);     // correct
    manager.castVote(code, v2, nonAuthors()[1]); // wrong (voted for the other non-author)
    const result = manager.getRoundResult(code);
    expect(result.correctCount).toBe(1);
    expect(result.actualPlayerId).toBe(authorId);
  });

  test('getRoundResult transitions state to round-results', () => {
    nonAuthors().forEach(v => manager.castVote(code, v, authorId));
    manager.getRoundResult(code);
    expect(manager.getGame(code).state).toBe('round-results');
  });
});

// ── nextRound ────────────────────────────────────────────────────────────────

describe('nextRound', () => {
  let code;
  beforeEach(() => {
    code = manager.createGame('secret');
    manager.setHost(code, 'host');
    manager.joinGame(code, 'secret', 's1', 'Alice');
    manager.joinGame(code, 'secret', 's2', 'Bob');
    manager.submitStatement(code, 's1', 'Alice statement text.');
    manager.submitStatement(code, 's2', 'Bob statement text.');
    manager.startGame(code, 'host');
  });

  function completeCurrentRound() {
    const game = manager.getGame(code);
    const authorId = game.statements[game.currentRound].playerId;
    const voters = ['s1', 's2'].filter(id => id !== authorId);
    voters.forEach(v => manager.castVote(code, v, authorId));
    manager.getRoundResult(code);
  }

  test('rejects advance from non-host', () => {
    completeCurrentRound();
    expect(manager.nextRound(code, 's1').error).toBeTruthy();
  });

  test('rejects advance when not in round-results state', () => {
    expect(manager.nextRound(code, 'host').error).toBeTruthy();
  });

  test('advances to the next round', () => {
    completeCurrentRound();
    const result = manager.nextRound(code, 'host');
    expect(result.gameOver).toBe(false);
    expect(manager.getGame(code).currentRound).toBe(1);
  });

  test('detects game over after final round', () => {
    completeCurrentRound();
    manager.nextRound(code, 'host');
    completeCurrentRound();
    const result = manager.nextRound(code, 'host');
    expect(result.gameOver).toBe(true);
    expect(manager.getGame(code).state).toBe('game-over');
  });
});

// ── getFinalResults ──────────────────────────────────────────────────────────

describe('getFinalResults', () => {
  test('returns all round results', () => {
    const code = manager.createGame('secret');
    manager.setHost(code, 'host');
    manager.joinGame(code, 'secret', 's1', 'Alice');
    manager.joinGame(code, 'secret', 's2', 'Bob');
    manager.submitStatement(code, 's1', 'Alice statement text.');
    manager.submitStatement(code, 's2', 'Bob statement text.');
    manager.startGame(code, 'host');

    for (let i = 0; i < 2; i++) {
      const game = manager.getGame(code);
      const authorId = game.statements[i].playerId;
      ['s1', 's2'].filter(id => id !== authorId).forEach(v => manager.castVote(code, v, authorId));
      manager.getRoundResult(code);
      if (i < 1) manager.nextRound(code, 'host');
    }
    manager.nextRound(code, 'host');

    const results = manager.getFinalResults(code);
    expect(results.results).toHaveLength(2);
    expect(results.totalStatements).toBe(2);
  });
});

// ── deleteGame ───────────────────────────────────────────────────────────────

describe('deleteGame', () => {
  test('removes game from storage', () => {
    const code = manager.createGame('pass');
    manager.deleteGame(code);
    expect(manager.getGame(code)).toBeNull();
  });
});
