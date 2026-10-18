// Jumpabout shell: screens, HUD, players, high scores and input.
(function () {
  'use strict';

  var JA = window.JA;
  var font = JA.font, audio = JA.audio, sfx = audio.sfx;
  var LEVELS = JA.LEVELS;

  var MARGIN = JA.MARGIN, W = 320 + MARGIN * 2, H = 248, PF_H = JA.PF_H;
  var BORDER = 10;   // C64-style coloured border around the screen
  var canvas = document.getElementById('screen');
  var ctx = canvas.getContext('2d');
  canvas.width = W + BORDER * 2; canvas.height = H + BORDER * 2;

  var PURPLE = '#9a3aa8', TEAL = '#7fe0d0', YELLOW = '#f0e060', WHITE = '#ffffff', DIM = '#8a8aa0';
  var HS_KEY = 'jumpabout.highscores';
  var EXTRA_LIFE = 7500;

  // ---- scaling ---------------------------------------------------------------
  function resize() {
    var cw = canvas.width, ch = canvas.height;
    var k = Math.max(1, Math.floor(Math.min((window.innerWidth - 24) / cw, (window.innerHeight - 60) / ch)));
    canvas.style.width = cw * k + 'px';
    canvas.style.height = ch * k + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- high scores (localStorage) -------------------------------------------------
  function loadScores() {
    try {
      var v = JSON.parse(localStorage.getItem(HS_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function saveScores(list) {
    try { localStorage.setItem(HS_KEY, JSON.stringify(list)); } catch (e) { /* storage blocked */ }
  }
  function qualifies(score) {
    if (score <= 0) return false;
    var list = loadScores();
    return list.length < 10 || score > list[list.length - 1].score;
  }
  function addScore(entry) {
    var list = loadScores();
    list.push(entry);
    list.sort(function (a, b) { return b.score - a.score; });
    list = list.slice(0, 10);
    saveScores(list);
    return list.indexOf(entry);
  }
  function topScore() { var l = loadScores(); return l.length ? l[0].score : 0; }

  // ---- global leaderboard (Cloudflare Worker + D1) ---------------------------------
  var API = '/api/scores';
  var board = { tab: 'global', list: null, status: 'idle', msg: '', myId: null };

  function fetchGlobal() {
    if (location.protocol === 'file:') { board.status = 'offline'; return; }
    board.status = 'loading';
    fetch(API).then(function (r) { return r.json(); }).then(function (d) {
      board.list = d.top || []; board.status = 'ok';
    }).catch(function () { board.status = 'offline'; });
  }

  function postGlobal(entry) {
    if (location.protocol === 'file:') { board.status = 'offline'; return; }
    board.status = 'posting'; board.msg = '';
    fetch(API, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: entry.name, score: entry.score, level: entry.level, speed: entry.speed })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); }).then(function (res) {
      if (res.ok) { board.list = res.d.top; board.myId = res.d.id; board.status = 'ok'; board.msg = 'GLOBAL RANK #' + res.d.rank; }
      else { board.status = 'ok'; board.msg = 'NOT POSTED: ' + String(res.d.error || 'ERROR').toUpperCase(); fetchGlobal(); }
    }).catch(function () { board.status = 'offline'; board.msg = 'NOT POSTED: OFFLINE'; });
  }

  function savedInitials() {
    try {
      var v = localStorage.getItem('jumpabout.initials') || '';
      if (v.length === 3) return v.split('').map(function (ch) { return Math.max(0, ALPHA.indexOf(ch)); });
    } catch (e) { /* storage blocked */ }
    return [0, 0, 0];
  }

  // ---- input --------------------------------------------------------------
  var keys = {};
  var jumpQueued = 0, jumpPressMode = null;
  var debugOn = false, recording = [];
  var KEYMAP = {
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', Space: 'jump'
  };
  window.addEventListener('keydown', function (e) {
    audio.unlock();
    var k = KEYMAP[e.code];
    if (k || e.code === 'Enter' || e.code === 'Escape') e.preventDefault();
    if (k) {
      if (k === 'jump' && !keys.jump) {
        jumpQueued = performance.now();
        jumpPressMode = world && state === 'play' ? world.player.mode : null;
      }
      keys[k] = true;
    }
    if (!e.repeat) onKey(e);
  });
  window.addEventListener('keyup', function (e) { var k = KEYMAP[e.code]; if (k) keys[k] = false; });
  window.addEventListener('blur', function () {
    keys = {};
    if (state === 'play') setState('pause');
  });

  function gameInput() {
    var age = performance.now() - jumpQueued;
    var jump = jumpQueued && age < 220;
    var inp = { left: !!keys.left, right: !!keys.right, up: !!keys.up, down: !!keys.down, jump: !!jump };
    // a press made in mid-air only turns into a jump on landing if it was very recent;
    // older ones were meant for something else (catching a ladder, say)
    inp.fresh = !(jumpPressMode === 'air' && age > 90);
    return inp;
  }

  // ---- game state -----------------------------------------------------------
  var state = 'title', stateT = 0;
  var menu = { idx: 0, players: 1, speed: 4, level: 1 };
  var SETTINGS_KEY = 'jumpabout.settings';

  // players and speed persist between visits (the starting level does not)
  function loadSettings() {
    try {
      var v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (v.players >= 1 && v.players <= 4) menu.players = v.players | 0;
      if (v.speed >= 1 && v.speed <= 8) menu.speed = v.speed | 0;
    } catch (e) { /* storage blocked or corrupt: keep defaults */ }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ players: menu.players, speed: menu.speed })); } catch (e) { /* storage blocked */ }
  }
  loadSettings();
  var MENU_ITEMS = ['START GAME', 'PLAYERS', 'SPEED', 'START LEVEL', 'HIGH SCORES', 'HOW TO PLAY'];
  var players = [], cur = 0;
  var world = null, acc = 0;
  var tally = null, nameEntry = null, lastRank = -1;
  var preview = null, idleT = 0, helpPage = 0;

  function setState(s) { state = s; stateT = 0; }

  function newGame() {
    players = [];
    for (var i = 0; i < menu.players; i++) {
      players.push({
        num: i + 1, score: 0, lives: 4, done: 0, levelIndex: menu.level - 1, nextExtra: EXTRA_LIFE,
        out: false, won: false, speed: menu.speed
      });
    }
    cur = 0;
    beginTurn();
  }

  function beginTurn() {
    var pl = players[cur];
    world = new JA.World(pl.levelIndex, { speed: pl.speed });
    acc = 0;
    setState(players.length > 1 ? 'prompt' : 'intro');
  }

  function addPoints(pl, n) {
    pl.score += n;
    while (pl.score >= pl.nextExtra) {
      pl.nextExtra += EXTRA_LIFE;
      pl.lives++;
      sfx.extra();
    }
  }

  function nextActive(from) {
    for (var i = 1; i <= players.length; i++) {
      var j = (from + i) % players.length;
      if (!players[j].out) return j;
    }
    return -1;
  }

  function endTurn() {
    var n = nextActive(cur);
    if (n < 0) { finishGame(); return; }
    cur = n;
    beginTurn();
  }

  function advanceLevel(pl) {
    pl.done++;
    if (pl.levelIndex === LEVELS.length - 1 && !pl.won) pl.won = true;
    if (pl.done < LEVELS.length && !pl.won) pl.levelIndex = (pl.levelIndex + 1) % LEVELS.length;
    else {
      // after the twelve, levels are drawn at random until the Jumpmen run out
      var nx;
      do { nx = Math.floor(Math.random() * LEVELS.length); } while (nx === pl.levelIndex && LEVELS.length > 1);
      pl.levelIndex = nx;
    }
  }

  function finishGame() {
    var pending = players.filter(function (p) { return p.score > 0; });
    if (pending.length) {
      nameEntry = { queue: pending, chars: savedInitials(), pos: 0 };
      setState('name');
    } else {
      lastRank = -1;
      setState('scores');
    }
  }

  // ---- world events -------------------------------------------------------------
  function handleEvents() {
    var pl = players[cur];
    while (world.events.length) {
      var ev = world.events.shift();
      if (ev.type === 'bomb') addPoints(pl, 100);
      else if (ev.type === 'complete') startTally();
      else if (ev.type === 'died') {
        pl.lives--;
        if (world.bombsLeft() === 0 && pl.lives > 0) { startTally(); }
        else if (pl.lives <= 0) { pl.out = true; sfx.gameover(); setState('gameover'); }
        else { world.spawnPlayer(); }
      }
    }
  }

  function startTally() {
    var pl = players[cur];
    var lvl = world.index + 1;
    tally = {
      bonus: Math.max(0, world.bonus), perLife: 25 * lvl, lives: pl.lives,
      spell: world.special === 'spell' && world.spellOk ? 1000 : 0, phase: 0, t: 0
    };
    sfx.level();
    setState('tally');
  }

  // ---- keyboard for menus ----------------------------------------------------------------
  function onKey(e) {
    idleT = 0;
    var c = e.code;
    if (c === 'KeyM') { audio.toggleMute(); return; }
    if (c === 'Backquote') { debugOn = !debugOn; return; }
    if (c === 'F9') { e.preventDefault(); downloadRecording(); return; }

    if (state === 'title') {
      if (c === 'KeyW' || c === 'ArrowUp') { menu.idx = (menu.idx + MENU_ITEMS.length - 1) % MENU_ITEMS.length; sfx.menu(); }
      else if (c === 'KeyS' || c === 'ArrowDown') { menu.idx = (menu.idx + 1) % MENU_ITEMS.length; sfx.menu(); }
      else if (c === 'KeyA' || c === 'ArrowLeft' || c === 'KeyD' || c === 'ArrowRight') {
        var d = (c === 'KeyA' || c === 'ArrowLeft') ? -1 : 1;
        if (menu.idx === 1) menu.players = 1 + (menu.players - 1 + d + 4) % 4;
        else if (menu.idx === 2) menu.speed = 1 + (menu.speed - 1 + d + 8) % 8;
        else if (menu.idx === 3) menu.level = 1 + (menu.level - 1 + d + 12) % 12;
        else return;
        if (menu.idx !== 3) saveSettings();
        sfx.menu();
      } else if (/^Digit[1-8]$/.test(c) && menu.idx === 2) {
        menu.speed = +c.slice(5); saveSettings(); sfx.menu();
      } else if (c === 'Space' || c === 'Enter') {
        sfx.select();
        if (menu.idx <= 3) newGame();
        else if (menu.idx === 4) { lastRank = -1; board.myId = null; board.msg = ''; board.tab = 'global'; fetchGlobal(); setState('scores'); }
        else { helpPage = 0; setState('help'); }
      }
      return;
    }
    if (state === 'preview') { setState('title'); return; }
    if (state === 'help') {
      if (c === 'Escape') { setState('title'); return; }
      if (c === 'KeyA' || c === 'ArrowLeft') helpPage = Math.max(0, helpPage - 1);
      else if (++helpPage > 2) setState('title');
      sfx.menu();
      return;
    }
    if (state === 'scores') {
      if (c === 'KeyA' || c === 'ArrowLeft' || c === 'KeyD' || c === 'ArrowRight') {
        board.tab = board.tab === 'global' ? 'local' : 'global';
        if (board.tab === 'global' && board.status !== 'loading' && board.status !== 'posting') fetchGlobal();
        sfx.menu();
      } else if (stateT > 20) setState('title');
      return;
    }
    if (state === 'play') {
      if (c === 'Escape' || c === 'KeyP') { setState('pause'); return; }
    } else if (state === 'pause') {
      if (c === 'Escape' || c === 'KeyP' || c === 'Space' || c === 'Enter') { setState('play'); keys = {}; jumpQueued = 0; }
      else if (c === 'KeyQ') { players.forEach(function (p) { p.out = true; }); finishGame(); }
      return;
    } else if (state === 'name') {
      nameKey(e);
      return;
    } else if (state === 'gameover' || state === 'welldone') {
      if (stateT > 60 && (c === 'Space' || c === 'Enter')) stateT = 1e6;
      return;
    } else if (state === 'tally') {
      if (c === 'Space' || c === 'Enter') tally.skip = true;
    }
  }

  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-!';
  function nameKey(e) {
    var n = nameEntry, c = e.code;
    if (c === 'KeyW' || c === 'ArrowUp') { n.chars[n.pos] = (n.chars[n.pos] + 1) % ALPHA.length; sfx.menu(); }
    else if (c === 'KeyS' || c === 'ArrowDown') { n.chars[n.pos] = (n.chars[n.pos] + ALPHA.length - 1) % ALPHA.length; sfx.menu(); }
    else if (c === 'KeyA' || c === 'ArrowLeft' || c === 'Backspace') { n.pos = Math.max(0, n.pos - 1); sfx.menu(); }
    else if (c === 'KeyD' || c === 'ArrowRight') { n.pos = Math.min(2, n.pos + 1); sfx.menu(); }
    else if (c === 'Escape') {
      // skip: nothing saved or posted for this player
      n.queue.shift();
      if (n.queue.length) { n.chars = savedInitials(); n.pos = 0; } else { lastRank = -1; board.msg = ''; setState('scores'); }
    }
    else if (c === 'Space' || c === 'Enter') {
      if (n.pos < 2 && c === 'Space') { n.pos++; sfx.menu(); return; }
      var pl = n.queue.shift();
      var name = n.chars.map(function (i) { return ALPHA[i]; }).join('');
      var entry = { name: name, score: pl.score, level: pl.done + 1, speed: pl.speed, date: Date.now() };
      lastRank = qualifies(entry.score) ? addScore(entry) : -1;
      try { localStorage.setItem('jumpabout.initials', name); } catch (err) { /* storage blocked */ }
      postGlobal(entry);
      sfx.select();
      if (n.queue.length) { n.chars = savedInitials(); n.pos = 0; }
      else { board.tab = 'global'; setState('scores'); }
    } else if (/^Key[A-Z]$/.test(c) && c !== 'KeyW' && c !== 'KeyA' && c !== 'KeyS' && c !== 'KeyD') {
      n.chars[n.pos] = ALPHA.indexOf(c.slice(3));
      n.pos = Math.min(2, n.pos + 1);
      sfx.menu();
    }
  }

  // ---- update ------------------------------------------------------------------
  function update(dt) {
    stateT++;
    switch (state) {
      case 'title':
        if (++idleT > 60 * 25) { startPreview(); }
        break;
      case 'preview':
        preview.t++;
        if (preview.t > 170) {
          preview.i++;
          if (preview.i >= LEVELS.length) { setState('title'); idleT = 0; break; }
          preview.world = new JA.World(preview.i, { preview: true });
          preview.t = 0;
        }
        break;
      case 'prompt':
        if (stateT > 100) setState('intro');
        break;
      case 'intro':
        if (stateT > 150) { setState('play'); jumpQueued = 0; }
        break;
      case 'play':
        acc += dt * world.tickRate();
        var steps = 0;
        while (acc >= 1 && steps < 8) {
          var inp = gameInput();
          // a jump press stays buffered until Jumpman can actually use it,
          // e.g. pressed just before catching a ladder
          world.jumpUsed = false;
          world.tick(inp);
          if (world.jumpUsed) jumpQueued = 0;
          recordTick(inp);
          handleEvents();
          acc -= 1; steps++;
          if (state !== 'play') break;
        }
        if (acc > 4) acc = 0;
        break;
      case 'tally':
        updateTally();
        break;
      case 'gameover':
        if (stateT > 200) endTurn();
        break;
      case 'welldone':
        if (stateT > 420) endTurn();
        break;
    }
  }

  function updateTally() {
    var tl = tally, pl = players[cur];
    tl.t++;
    if (tl.t < 40) return;
    var rate = tl.skip ? 1000 : 25;
    if (tl.phase === 0) {
      // time bonus pours into the score
      var n = Math.min(rate, tl.bonus);
      tl.bonus -= n; addPoints(pl, n);
      world.bonus = tl.bonus;
      if (n && tl.t % 3 === 0) sfx.tally();
      if (tl.bonus <= 0) { tl.phase = 1; tl.t = 20; }
    } else if (tl.phase === 1) {
      if (tl.t % (tl.skip ? 1 : 18) === 0) {
        if (tl.lives > 0) { tl.lives--; addPoints(pl, tl.perLife); sfx.tally(); }
        else { tl.phase = 2; tl.t = 0; }
      }
    } else if (tl.phase === 2) {
      if (tl.spell) { addPoints(pl, tl.spell); tl.spellPaid = tl.spell; tl.spell = 0; sfx.extra(); }
      if (tl.t > (tl.skip ? 10 : 70)) {
        var finishedTwelve = pl.levelIndex === LEVELS.length - 1 && !pl.won;
        advanceLevel(pl);
        if (finishedTwelve) { sfx.win(); setState('welldone'); }
        else endTurn();
      }
    }
  }

  function startPreview() {
    preview = { i: 0, t: 0, world: new JA.World(0, { preview: true }) };
    setState('preview');
  }

  // ---- drawing -----------------------------------------------------------------
  function clear() { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }

  function txt(s, x, y, c, o) { return font.text(ctx, s, x, y, c, o); }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

  // C64 status panel: three boxed columns across two rows
  var HUD_BG = [['#d8e47c', '#70c4d4', '#d8e47c'], ['#f2f2f2', '#7ccc5c', '#f2f2f2']];
  var HUD_X = [0, 118, 236], HUD_W = [116, 116, 116];

  function drawHud(w, pl, nameOverride) {
    var y0 = PF_H + 2;
    ctx.fillStyle = '#9a9a9a'; ctx.fillRect(0, PF_H, W, 2);
    if (nameOverride) {
      // level title bar shown while the board is being drawn
      ctx.fillStyle = w.border || '#7a3cb4'; ctx.fillRect(W / 2 - 100, y0 + 2, 200, 12);
      txt(nameOverride + '.', W / 2, y0 + 5, WHITE, { align: 'center' });
      return;
    }
    var lvlNo = pl && pl.won ? Math.min(pl.done + 1, 99) : w.index + 1;
    var cells = [
      ['JUMPMEN = ' + pad(pl ? Math.min(pl.lives, 99) : 4, 2), 'LEVEL ' + pad(lvlNo, 2), 'RUN SPEED ' + pad(pl ? pl.speed : 2, 2)],
      ['SCORE', 'PLAYER ' + (pl ? pl.num : 1), 'BONUS']
    ];
    if (state === 'tally' && tally) cells[0][1] = 'EACH JUMPMAN =', cells[0][2] = '';
    for (var r = 0; r < 2; r++) {
      for (var c = 0; c < 3; c++) {
        var x = HUD_X[c], y = y0 + r * 15;
        ctx.fillStyle = HUD_BG[r][c]; ctx.fillRect(x, y, HUD_W[c], 14);
        txt(cells[r][c], x + 4, y + 4, '#101010');
      }
    }
    if (state === 'tally' && tally) txt(String(tally.perLife), W - 4, y0 + 4, '#101010', { align: 'right' });
    txt(String(pl ? pl.score : 0), HUD_X[1] - 4, y0 + 19, '#101010', { align: 'right' });
    txt(String(Math.max(0, w.bonus)), W - 4, y0 + 19, '#101010', { align: 'right' });
    if (audio.isMuted()) txt('M', HUD_X[2] - 10, y0 + 19, '#101010');
  }

  // ---- control diagnostics: ` toggles an overlay, F9 saves the last 10s ----------
  function recordTick(inp) {
    var p = world.player;
    recording.push({
      t: world.t, lv: world.index + 1, keys: (inp.left ? 'L' : '') + (inp.right ? 'R' : '') + (inp.up ? 'U' : '') +
        (inp.down ? 'D' : '') + (inp.jump ? 'J' : '') + (inp.jump && !inp.fresh ? '(stale)' : ''),
      mode: p.mode, x: +p.x.toFixed(1), y: +p.y.toFixed(1), vx: +(p.vx || 0).toFixed(2), vy: +(p.vy || 0).toFixed(2),
      note: world.notes && world.notes.length && world.notes[world.notes.length - 1].t === world.t ? world.notes[world.notes.length - 1].msg : undefined
    });
    if (recording.length > 600) recording.shift();
  }

  function downloadRecording() {
    var blob = new Blob([JSON.stringify(recording, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jumpabout-controls-' + Date.now() + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function drawDebug() {
    if (!debugOn || !world) return;
    var p = world.player, r = recording[recording.length - 1];
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, 170, 76);
    txt((p.mode + '        ').slice(0, 8) + ' ' + Math.round(p.x) + ',' + Math.round(p.y), 2, 2, YELLOW);
    txt('KEYS ' + (r ? r.keys || '-' : '-'), 2, 11, WHITE);
    var notes = world.notes || [];
    for (var i = 0; i < Math.min(6, notes.length); i++) {
      var n = notes[notes.length - 1 - i];
      txt(n.msg.toUpperCase().slice(0, 27), 2, 21 + i * 9, i ? DIM : TEAL);
    }
  }

  function renderWorld(w, opts) {
    ctx.save();
    ctx.translate(MARGIN, 0);
    w.render(ctx, opts);
    ctx.restore();
  }

  function borderColor() {
    if (world && ['prompt', 'intro', 'play', 'pause', 'tally', 'gameover'].indexOf(state) >= 0) return world.border;
    if (state === 'preview' && preview) return preview.world.border;
    return '#50a014';
  }

  function render() {
    ctx.fillStyle = borderColor();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(BORDER, BORDER);
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    clear();
    renderScreen();
    ctx.restore();
  }

  function renderScreen() {
    switch (state) {
      case 'title': drawTitle(); break;
      case 'preview':
        renderWorld(preview.world, { progress: Math.min(1, preview.t / 90), showAll: true, noFx: true });
        drawHud(preview.world, null, preview.world.def.name);
        txt('PRESS ANY KEY', W / 2, 236, WHITE, { align: 'center' });
        break;
      case 'help': drawHelp(); break;
      case 'scores': drawScores(); break;
      case 'prompt':
        drawHud(world, players[cur]);
        txt('PLAYER ' + players[cur].num, W / 2, 88, YELLOW, { align: 'center', scale: 2, shadow: '#503010' });
        txt('GET READY', W / 2, 112, WHITE, { align: 'center' });
        break;
      case 'intro': {
        var pr = Math.min(1, stateT / 110);
        renderWorld(world, { progress: pr, showAll: true, noFx: true });
        drawHud(world, players[cur], world.def.name);
        break;
      }
      case 'play':
      case 'pause':
        renderWorld(world, {});
        drawHud(world, players[cur]);
        drawDebug();
        if (state === 'pause') {
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, PF_H);
          txt('PAUSED', W / 2, 84, WHITE, { align: 'center', scale: 2 });
          txt('SPACE / P  RESUME', W / 2, 112, TEAL, { align: 'center' });
          txt('Q  QUIT GAME', W / 2, 124, TEAL, { align: 'center' });
          txt('M  SOUND ' + (audio.isMuted() ? 'OFF' : 'ON'), W / 2, 136, TEAL, { align: 'center' });
        }
        break;
      case 'tally': drawTally(); break;
      case 'gameover':
        renderWorld(world, {});
        drawHud(world, players[cur]);
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 70, W, 70);
        txt('GAME OVER', W / 2, 86, '#ff6060', { align: 'center', scale: 2 });
        if (players.length > 1) txt('PLAYER ' + players[cur].num, W / 2, 110, WHITE, { align: 'center' });
        txt('SCORE ' + players[cur].score, W / 2, 124, YELLOW, { align: 'center' });
        break;
      case 'welldone': drawWellDone(); break;
      case 'name': drawNameEntry(); break;
    }
  }

  // little running Jumpmen for the title
  function drawRunner(x, y, t, c) {
    var spr = (t >> 3) % 2 ? JA.SPR.run1 : JA.SPR.run2;
    JA.drawSprite(ctx, spr, x, y, c || WHITE, false);
  }

  function drawLogoBox(y) {
    // green brickwork frame, as on the original title screen
    ctx.fillStyle = '#2f8a2a'; ctx.fillRect(14, y, W - 28, 44);
    ctx.fillStyle = '#58c048';
    for (var r = 0; r < 44; r += 4) {
      var off = (r / 4) % 2 ? 0 : 4;
      for (var c = 14 + off; c < W - 14; c += 8) { ctx.fillRect(c, y + r, 6, 3); }
    }
    ctx.fillStyle = '#000'; ctx.fillRect(28, y + 8, W - 56, 28);
    txt('JUMPABOUT', W / 2, y + 11, '#c8c8c8', { align: 'center', scale: 3, shadow: '#5a5a5a' });
  }

  function drawTitle() {
    var t = stateT;
    txt('THE JUPITER SUBSTATION NEEDS YOU', W / 2, 8, '#e070d0', { align: 'center' });
    for (var i = 0; i < 4; i++) drawRunner(((t * 0.8 + i * 80) % 380) - 30, 26, t + i * 5, i === 0 ? YELLOW : WHITE);
    drawLogoBox(42);

    var y0 = 102;
    for (var m = 0; m < MENU_ITEMS.length; m++) {
      var sel = m === menu.idx;
      var label = MENU_ITEMS[m];
      if (m === 1) label += '  < ' + menu.players + ' >';
      if (m === 2) label += '  < ' + menu.speed + ' >';
      if (m === 3) label += '  < ' + pad(menu.level, 2) + ' >';
      txt(label, MARGIN + 84, y0 + m * 13, sel ? YELLOW : DIM);
      if (sel && (t >> 4) % 2 === 0) drawRunner(MARGIN + 66, y0 + m * 13 - 5, t, YELLOW);
    }
    var sp = ['TURBO', 'C64 STANDARD', 'STEADY', 'RELAXED', 'SLOW', 'SLOWER', 'VERY SLOW', 'SLOWEST'][menu.speed - 1];
    if (menu.idx === 2) txt('SPEED ' + menu.speed + ' = ' + sp, W / 2, 184, TEAL, { align: 'center' });
    if (menu.idx === 3) txt(LEVELS[menu.level - 1].name, W / 2, 184, TEAL, { align: 'center' });

    var best = board.list && board.list[0];
    txt(best ? 'WORLD BEST ' + best.name + ' ' + pad(best.score, 6) + '   YOURS ' + pad(topScore(), 6)
             : 'HIGH SCORE ' + pad(topScore(), 6), W / 2, 200, WHITE, { align: 'center' });
    ctx.fillStyle = '#2050c0'; ctx.fillRect(0, 216, W, 32);
    txt('WASD MOVE / CLIMB   SPACE JUMP', W / 2, 221, WHITE, { align: 'center' });
    txt('P PAUSE   M SOUND   A TRIBUTE TO 1983', W / 2, 233, '#c0d8ff', { align: 'center' });
  }

  var HELP = [
    ['THE MISSION', [
      'THE ALIENATORS HAVE PLANTED BOMBS',
      'ALL OVER THE JUPITER SUBSTATION.',
      '',
      'TOUCH EVERY BOMB ON A LEVEL TO',
      'DEFUSE IT. 12 LEVELS, EACH WITH',
      'ITS OWN DIRTY TRICK.',
      '',
      'BOMB ............. 100 POINTS',
      'TIME BONUS ....... COUNTS DOWN',
      'JUMPMAN BONUS .... 25 X LEVEL',
      '                   PER LIFE LEFT',
      'EXTRA JUMPMAN .... EVERY 7500'
    ]],
    ['MOVING', [
      'A / D ......... WALK',
      'W / S ......... CLIMB LADDERS',
      'SPACE ......... JUMP STRAIGHT UP',
      'SPACE + A / D . LEAP LEFT / RIGHT',
      '',
      'ROPES ONLY GO ONE WAY. HOLD W ON',
      'AN UP ROPE (GIRDER COLOUR) OR S ON',
      'A DOWN ROPE (LADDER COLOUR).',
      'SPACE + A / D LEAPS OFF A LADDER',
      'OR ROPE AT ANY HEIGHT.',
      'JUMP INTO A LADDER OR ROPE AND',
      'YOU CATCH IT AUTOMATICALLY.'
    ]],
    ['DANGER', [
      'BULLETS DRIFT ALONG THE EDGE OF',
      'THE SCREEN UNTIL THEY LINE UP',
      'WITH YOU - THEN THEY FIRE.',
      '',
      'FALL TOO FAR, MISS A LEAP OR',
      'JUMP OFF THE SCREEN AND YOU',
      'TUMBLE TO THE BOTTOM. A FALLING',
      'JUMPMAN STILL DEFUSES BOMBS!',
      '',
      'SPEED 1 IS FASTEST, 8 SLOWEST.',
      'UP TO 4 PLAYERS TAKE TURNS.'
    ]]
  ];

  function drawHelp() {
    var pg = HELP[helpPage];
    txt(pg[0], W / 2, 14, YELLOW, { align: 'center', scale: 2 });
    pg[1].forEach(function (line, i) { txt(line, MARGIN + 28, 44 + i * 12, i % 2 ? WHITE : '#d8d8f0'); });
    ctx.fillStyle = PURPLE; ctx.fillRect(0, 216, W, 32);
    txt('PAGE ' + (helpPage + 1) + '/3   ANY KEY: NEXT   ESC: MENU', W / 2, 228, WHITE, { align: 'center' });
  }

  function drawScores() {
    var global = board.tab === 'global';
    txt('HIGH SCORES', W / 2, 10, TEAL, { align: 'center', scale: 2 });
    txt('LOCAL', W / 2 - 40, 30, global ? DIM : YELLOW, { align: 'center' });
    txt('GLOBAL', W / 2 + 40, 30, global ? YELLOW : DIM, { align: 'center' });
    ctx.fillStyle = YELLOW; ctx.fillRect(global ? W / 2 + 22 : W / 2 - 55, 39, global ? 36 : 30, 1);
    txt('RANK  NAME  SCORE   LEVEL  SPEED', MARGIN + 40, 46, DIM);

    var list = global ? (board.list || []) : loadScores();
    if (global && !board.list) {
      var m = board.status === 'offline' ? 'GLOBAL SCORES UNAVAILABLE OFFLINE' : 'LOADING...';
      txt(m, W / 2, 120, DIM, { align: 'center' });
    } else {
      for (var i = 0; i < 10; i++) {
        var e = list[i], y = 60 + i * 14;
        var mine = global ? e && e.id === board.myId : i === lastRank;
        var hl = mine && (stateT >> 4) % 2 === 0;
        var c = hl ? YELLOW : i === 0 ? '#ffd070' : WHITE;
        txt(pad(i + 1, 2) + '.', MARGIN + 46, y, c);
        if (e) {
          txt(e.name, MARGIN + 76, y, c);
          txt(pad(e.score, 6), MARGIN + 112, y, c);
          txt(pad(e.level, 2), MARGIN + 172, y, c);
          txt(String(e.speed), MARGIN + 220, y, c);
        } else txt('---   ------    --     -', MARGIN + 76, y, '#404050');
      }
    }
    if (board.status === 'posting') txt('POSTING SCORE...', W / 2, 204, TEAL, { align: 'center' });
    else if (board.msg) txt(board.msg, W / 2, 204, board.msg.indexOf('NOT') === 0 ? '#ff7070' : TEAL, { align: 'center' });
    ctx.fillStyle = PURPLE; ctx.fillRect(0, 216, W, 32);
    txt('A/D: LOCAL / GLOBAL    ANY KEY: MENU', W / 2, 228, WHITE, { align: 'center' });
  }

  function drawTally() {
    var tl = tally, pl = players[cur];
    renderWorld(world, {});
    drawHud(world, pl);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(MARGIN + 40, 60, 240, 96);
    ctx.strokeStyle = PURPLE; ctx.strokeRect(MARGIN + 40.5, 60.5, 239, 95);
    txt('LEVEL COMPLETE', W / 2, 70, YELLOW, { align: 'center', scale: 2 });
    txt('TIME BONUS', MARGIN + 60, 98, TEAL); txt(String(tl.bonus), MARGIN + 260, 98, WHITE, { align: 'right' });
    txt('JUMPMEN  ' + tl.lives + ' X ' + tl.perLife, MARGIN + 60, 112, TEAL);
    if (tl.spellPaid) txt('SPELLBOUND BONUS ' + tl.spellPaid, W / 2, 128, '#60d0ff', { align: 'center' });
    else if (world.special === 'spell' && !world.spellOk) txt('LETTERS OUT OF ORDER', W / 2, 128, '#ff7070', { align: 'center' });
    txt('SCORE ' + pl.score, W / 2, 142, WHITE, { align: 'center' });
  }

  function drawWellDone() {
    var t = stateT;
    var drop = Math.min(1, t / 120);
    txt('WELL', W / 2, 20 + 40 * drop - 40, '#78a8e8', { align: 'center', scale: 6 });
    txt('DONE', W / 2, 80 + 40 * drop - 40, '#78a8e8', { align: 'center', scale: 6 });
    if (t > 60) for (var i = 0; i < 5; i++) drawRunner(((t * 1.2 + i * 70) % 380) - 30, 150, t + i * 3, i % 2 ? YELLOW : WHITE);
    txt('ALL 12 LEVELS DEFUSED!', W / 2, 172, YELLOW, { align: 'center' });
    txt('TOTAL SCORE ' + players[cur].score, W / 2, 186, WHITE, { align: 'center' });
    txt('THE SUBSTATION KEEPS FIGHTING...', W / 2, 200, DIM, { align: 'center' });
    ctx.fillStyle = PURPLE; ctx.fillRect(0, 216, W, 32);
  }

  function drawNameEntry() {
    var n = nameEntry, pl = n.queue[0];
    txt(qualifies(pl.score) ? 'NEW HIGH SCORE' : 'FINAL SCORE', W / 2, 30, YELLOW, { align: 'center', scale: 2 });
    if (players.length > 1) txt('PLAYER ' + pl.num, W / 2, 56, WHITE, { align: 'center' });
    txt(String(pl.score), W / 2, 72, WHITE, { align: 'center', scale: 2 });
    txt('ENTER YOUR INITIALS', W / 2, 104, TEAL, { align: 'center' });
    for (var i = 0; i < 3; i++) {
      var x = W / 2 - 40 + i * 30, sel = i === n.pos;
      txt(ALPHA[n.chars[i]], x, 126, sel ? YELLOW : WHITE, { scale: 3 });
      if (sel && (stateT >> 3) % 2) { ctx.fillStyle = YELLOW; ctx.fillRect(x, 150, 14, 2); }
    }
    txt('W/S LETTER  A/D MOVE  OR TYPE', W / 2, 168, DIM, { align: 'center' });
    txt('ENTER: SAVE + POST TO GLOBAL BOARD', W / 2, 180, DIM, { align: 'center' });
    txt('ESC: SKIP', W / 2, 192, DIM, { align: 'center' });
    ctx.fillStyle = PURPLE; ctx.fillRect(0, 216, W, 32);
  }

  // ---- main loop -------------------------------------------------------------------
  var last = performance.now(), uiAcc = 0, debugFrozen = false;
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    uiAcc += dt * 60;
    var n = 0;
    // UI/state logic runs at 60Hz; gameplay ticks scale with the speed setting
    while (uiAcc >= 1 && n < 6) { if (!debugFrozen) update(1 / 60); uiAcc -= 1; n++; }
    if (uiAcc > 6) uiAcc = 0;
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  fetchGlobal();

  // exposed for automated testing
  JA.debug = {
    startPreview: startPreview, setHelp: function (n) { helpPage = n; setState('help'); },
    get state() { return state; }, get world() { return world; }, get players() { return players; },
    newGame: function (opts) { Object.assign(menu, opts || {}); newGame(); },
    freeze: function (f) { debugFrozen = !!f; },
    setState: setState, keys: function () { return keys; }
  };
})();
