'use strict';

(function () {
  // ── State ───────────────────────────────────────────────────────────────────
  const state = {
    role: null,
    gameCode: null,
    playerName: null,
    isAuthor: false,
    hasVoted: false,
    selectedVote: null,
    currentRound: 0,
    totalRounds: 0
  };

  // ── Utilities ────────────────────────────────────────────────────────────────

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function $(id) { return document.getElementById(id); }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.toggle('hidden', s.id !== id);
    });
    const screen = $(id);
    const heading = screen && screen.querySelector('h2, h3, .round-badge');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
  }

  function notify(msg, type = 'error') {
    const el = $('notification');
    el.textContent = msg;
    el.className = 'notification notification--' + type;
    el.classList.remove('hidden');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), 6000);
  }

  function setDisabled(btn, disabled) {
    btn.disabled = disabled;
    btn.setAttribute('aria-disabled', String(disabled));
  }

  // ── Lazy socket management ───────────────────────────────────────────────────
  // socket.io.js is only available when served by the Node.js server.
  // Delaying connection means navigation always works, and a clear error
  // is shown when a game action is attempted without the backend.

  let socket = null;

  function ensureSocket() {
    if (socket) return true;

    // When opened via Live Server or any port other than the Node.js server,
    // connect explicitly to port 3000 on the same hostname.
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const serverUrl = isLocal
      ? `${window.location.protocol}//${window.location.hostname}:3000`
      : window.location.origin;

    socket = io(serverUrl);
    attachSocketHandlers();
    return true;
  }

  // ── Socket event handlers (attached once, on first game action) ──────────────

  function attachSocketHandlers() {
    socket.on('connect_error', () => {
      notify('Cannot connect to game server. Make sure "npm start" is running.', 'error');
    });

    socket.on('player-joined', ({ players }) => {
      if (state.role === 'host') {
        renderPlayers('host-player-list', players, true);
        const submitted = players.filter(p => p.hasSubmitted).length;
        updateStartButton(submitted, players.length);
      } else {
        renderPlayers('player-list', players, true);
      }
    });

    socket.on('statement-submitted', ({ submittedCount, totalCount, players }) => {
      if (state.role === 'host') {
        renderPlayers('host-player-list', players, true);
        updateStartButton(submittedCount, totalCount);
      } else {
        renderPlayers('player-list', players, true);
        $('waiting-others').textContent =
          `${submittedCount} of ${totalCount} players have submitted.`;
      }
    });

    socket.on('round-started', ({ statement, roundIndex, totalRounds, players, eligibleVoterCount }) => {
      state.currentRound = roundIndex;
      state.totalRounds = totalRounds;
      state.isAuthor = false;
      state.hasVoted = false;
      state.selectedVote = null;

      if (state.role === 'host') {
        $('host-round-label').textContent = `Round ${roundIndex} of ${totalRounds}`;
        $('host-statement-text').textContent = statement;
        $('host-vote-status').textContent = 'Waiting for votes…';
        setProgress(0, eligibleVoterCount);
        showScreen('screen-host-voting');
      } else {
        $('player-round-label').textContent = `Round ${roundIndex} of ${totalRounds}`;
        $('player-statement-text').textContent = statement;
        $('vote-form-card').classList.remove('hidden');
        $('author-card').classList.add('hidden');
        $('form-vote').classList.remove('hidden');
        $('voted-card').classList.add('hidden');
        setDisabled($('btn-cast-vote'), true);
        renderVoteOptions(players);
        showScreen('screen-player-voting');
      }
    });

    socket.on('is-author', () => {
      state.isAuthor = true;
      $('vote-form-card').classList.add('hidden');
      $('author-card').classList.remove('hidden');
      $('author-vote-count').textContent = 'Waiting for others to vote…';
    });

    socket.on('vote-received', ({ votedCount, totalCount }) => {
      if (state.role === 'host') {
        setProgress(votedCount, totalCount);
      } else if (state.isAuthor) {
        $('author-vote-count').textContent = `${votedCount} of ${totalCount} voted`;
      } else if (state.hasVoted) {
        $('voted-status').textContent =
          `Vote submitted! ${votedCount} of ${totalCount} voted.`;
      }
    });

    socket.on('round-ended', ({ roundIndex, totalRounds, statement, actualPlayerName, votes, correctCount, totalVoters }) => {
      $('results-round-label').textContent = `Round ${roundIndex} of ${totalRounds}`;
      $('result-author-name').textContent = actualPlayerName;
      $('result-statement').textContent = statement;

      const countText =
        correctCount === 0         ? 'Nobody guessed correctly!' :
        correctCount === totalVoters ? 'Everyone guessed correctly!' :
        `${correctCount} out of ${totalVoters} guessed correctly`;
      $('correct-count-text').textContent = countText;

      renderGuesses(votes);

      if (state.role === 'host') {
        $('host-next-btn').classList.remove('hidden');
        $('player-wait-msg').classList.add('hidden');
        $('btn-next-round').textContent = roundIndex < totalRounds
          ? 'Next Statement →'
          : 'See Final Results →';
      } else {
        $('host-next-btn').classList.add('hidden');
        $('player-wait-msg').classList.remove('hidden');
      }

      showScreen('screen-round-results');
    });

    socket.on('game-ended', ({ results, totalStatements }) => {
      renderFinalResults(results, totalStatements);
      showScreen('screen-game-over');
    });

    socket.on('player-left', ({ players }) => {
      if (state.role === 'host') renderPlayers('host-player-list', players, true);
      else renderPlayers('player-list', players, true);
    });
  }

  // ── Player list rendering ────────────────────────────────────────────────────

  function renderPlayers(listId, players, showStatus) {
    const ul = $(listId);
    ul.innerHTML = '';
    players.forEach(p => {
      const li = document.createElement('li');
      li.className = 'player-item';
      if (showStatus) {
        li.innerHTML =
          `<span class="player-name">${esc(p.name)}</span>
           <span class="badge ${p.hasSubmitted ? 'badge-ready' : 'badge-waiting'}">
             ${p.hasSubmitted ? '&#x2713; Ready' : 'Waiting…'}
           </span>`;
      } else {
        li.innerHTML = `<span class="player-name">${esc(p.name)}</span>`;
      }
      ul.appendChild(li);
    });
  }

  // ── Home ─────────────────────────────────────────────────────────────────────

  $('btn-go-create').addEventListener('click', () => {
    showScreen('screen-create');
    $('create-password').focus();
  });

  $('btn-go-join').addEventListener('click', () => {
    showScreen('screen-join');
    $('join-code').focus();
  });

  $('btn-back-from-create').addEventListener('click', () => showScreen('screen-home'));
  $('btn-back-from-join').addEventListener('click', () => showScreen('screen-home'));

  // ── Create Game ───────────────────────────────────────────────────────────────

  $('form-create').addEventListener('submit', e => {
    e.preventDefault();
    if (!ensureSocket()) return;

    const password = $('create-password').value.trim();
    if (password.length < 3) return notify('Password must be at least 3 characters.');

    socket.emit('create-game', { password }, res => {
      if (res.error) return notify(res.error);
      state.gameCode = res.gameCode;
      state.role = 'host';
      $('display-game-code').textContent = res.gameCode;
      $('host-password-reminder').textContent = `Password: ${password}`;
      renderPlayers('host-player-list', [], true);
      updateStartButton(0, 0);
      showScreen('screen-host-lobby');
    });
  });

  // ── Join Game ─────────────────────────────────────────────────────────────────

  $('join-code').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  $('form-join').addEventListener('submit', e => {
    e.preventDefault();
    if (!ensureSocket()) return;

    const code = $('join-code').value.trim().toUpperCase();
    const password = $('join-password').value;
    const name = $('join-name').value.trim();

    if (!code || !password || !name) return notify('Please fill in all fields.');

    socket.emit('join-game', { gameCode: code, password, playerName: name }, res => {
      if (res.error) return notify(res.error);
      state.gameCode = code;
      state.playerName = name;
      state.role = 'player';

      $('player-lobby-heading').textContent = `Lobby — welcome, ${esc(name)}!`;
      renderPlayers('player-list', res.players, true);
      updateWaiting(res.players);
      showScreen('screen-player-lobby');
    });
  });

  // ── Submit Statement ──────────────────────────────────────────────────────────

  $('form-statement').addEventListener('submit', e => {
    e.preventDefault();
    const statement = $('personal-statement').value.trim();
    if (statement.length < 10)
      return notify('Please enter a longer personal statement (min 10 characters).');

    socket.emit('submit-statement', { statement }, res => {
      if (res.error) return notify(res.error);
      $('statement-form-card').classList.add('hidden');
      $('statement-done-card').classList.remove('hidden');
    });
  });

  // ── Start Game (Host) ─────────────────────────────────────────────────────────

  $('btn-start-game').addEventListener('click', () => {
    socket.emit('start-game', res => {
      if (res.error) notify(res.error);
    });
  });

  // ── Cast Vote ─────────────────────────────────────────────────────────────────

  $('form-vote').addEventListener('submit', e => {
    e.preventDefault();
    if (!state.selectedVote) return;

    socket.emit('cast-vote', { guessedPlayerId: state.selectedVote }, res => {
      if (res.error) return notify(res.error);
      state.hasVoted = true;
      $('form-vote').classList.add('hidden');
      $('voted-card').classList.remove('hidden');
      $('voted-status').textContent = 'Vote submitted! Waiting for others…';
    });
  });

  // ── Next Round (Host) ─────────────────────────────────────────────────────────

  $('btn-next-round').addEventListener('click', () => {
    socket.emit('next-round', res => {
      if (res.error) notify(res.error);
    });
  });

  $('btn-new-game').addEventListener('click', () => window.location.reload());

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function updateStartButton(submitted, total) {
    const canStart = submitted >= 2;
    setDisabled($('btn-start-game'), !canStart);
    $('start-hint').textContent = canStart
      ? `${submitted} of ${total} submitted — ready to start!`
      : `Waiting for at least 2 statements… (${submitted}/${total} submitted)`;
    $('host-lobby-count').textContent =
      `(${total} player${total !== 1 ? 's' : ''})`;
  }

  function updateWaiting(players) {
    const submitted = players.filter(p => p.hasSubmitted).length;
    $('waiting-others').textContent =
      `${submitted} of ${players.length} players have submitted.`;
  }

  function setProgress(voted, total) {
    const pct = total > 0 ? Math.round((voted / total) * 100) : 0;
    $('host-progress-fill').style.width = pct + '%';
    $('host-progress-bar').setAttribute('aria-valuenow', pct);
    $('host-vote-status').textContent = total > 0
      ? `${voted} of ${total} voted`
      : 'Waiting for votes…';
  }

  function renderVoteOptions(players) {
    const ul = $('vote-options');
    ul.innerHTML = '';
    players.forEach(player => {
      const li = document.createElement('li');
      li.className = 'vote-option';
      const id = 'vote-' + player.id;
      li.innerHTML =
        `<label for="${id}">
           <input type="radio" name="vote" id="${id}" value="${esc(player.id)}">
           <span>${esc(player.name)}</span>
         </label>`;
      li.querySelector('input').addEventListener('change', () => {
        state.selectedVote = player.id;
        setDisabled($('btn-cast-vote'), false);
      });
      ul.appendChild(li);
    });
  }

  function renderGuesses(votes) {
    const ul = $('guesses-list');
    ul.innerHTML = '';
    votes.forEach(v => {
      const li = document.createElement('li');
      li.className = 'guess-item ' + (v.isCorrect ? 'guess-correct' : 'guess-wrong');
      li.innerHTML =
        `<span class="guess-guesser">${esc(v.voterName)}</span>
         <span class="guess-arrow">&#x2192;</span>
         <span class="guess-target">${esc(v.guessedName)}</span>
         <span class="guess-icon">${v.isCorrect ? '&#x2713;' : '&#x2717;'}</span>`;
      ul.appendChild(li);
    });
  }

  function renderFinalResults(results, totalStatements) {
    const tbody = $('final-results-body');
    tbody.innerHTML = '';
    let personalCount = 0;

    results.forEach(r => {
      const pct = r.totalVoters > 0
        ? Math.round((r.correctCount / r.totalVoters) * 100) : 0;
      const isPersonal = pct > 50;
      if (isPersonal) personalCount++;
      const excerpt = r.statement.length > 80
        ? r.statement.slice(0, 80) + '…' : r.statement;

      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${esc(r.actualPlayerName)}</td>
         <td class="statement-excerpt">${esc(excerpt)}</td>
         <td>${r.correctCount}/${r.totalVoters} (${pct}%)</td>
         <td class="${isPersonal ? 'verdict-personal' : 'verdict-generic'}">
           ${isPersonal ? '&#x2713; Personal' : '&#x26A0; Generic'}
         </td>`;
      tbody.appendChild(tr);
    });

    $('game-summary').textContent =
      `${personalCount} out of ${totalStatements} statements were personal enough to identify.`;
  }

  // ── Boot ──────────────────────────────────────────────────────────────────────
  showScreen('screen-home');
})();
