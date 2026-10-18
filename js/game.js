// Jumpabout core: one World per attempt at a level. Physics run in fixed
// "ticks"; the chosen speed (1 fastest .. 8 slowest) scales the tick rate,
// which slows Jumpman and every creature alike, as on the cartridge.
(function () {
  'use strict';

  var JA = window.JA;
  var LEVELS = JA.LEVELS;
  var font = JA.font;
  var sfx = JA.audio.sfx;

  var W = 320, PF_H = 216;
  // empty space drawn either side of the board, so the walls aren't flush with the screen edge
  var MARGIN = 16;
  var FLOOR = 207;

  // tuned against frame-by-frame footage of the original (speed 1, 60 ticks/s)
  var P = {
    WALK: 2.0, LADDER: 1.25, ROPE_UP: 0.85, ROPE_DOWN: 1.3,
    JUMP_VY: -2.2, GRAV: 0.13, JUMP_VX: 1.45, MAXFALL: 2.6,
    FATAL: 24,            // how far below the take-off point Jumpman can land (matches footage)
    STEP: 7,              // max step up/down while walking
    EDGE: 3,              // how far past a girder end feet still find footing
    LEDGE: 3,             // landing tolerance when feet are just below a girder top
    BODY_H: 14,
    COYOTE: 9,            // ticks after leaving a ledge during which a jump still counts
    DIR_GRACE: 4          // ticks into a straight-up jump during which A/D still turns it into a leap
  };

  // C64 "run speed" setting -> tick rate multiplier. Speed 2 matches the
  // C64 longplay the physics were measured from.
  var SPEED_FACTOR = [1.15, 1.0, 0.88, 0.77, 0.67, 0.58, 0.5, 0.43];

  // Commodore 64 palette used on every board
  var PAL = {
    girder: '#64a83c', girderHi: '#9ad46e', girderLo: '#2c5418', hole: '#0e2a06',
    ladder: '#3a3ad2', slider: '#74d4e4', bomb: '#a86e3c', bombHi: '#e0a060',
    body: '#b65ad2', head: '#ffffff'
  };

  // ---- sprites -------------------------------------------------------------
  var SPR = {
    stand: ['....##....', '....##....', '...####...', '..#.##.#..', '.#..##..#.', '.#..##..#.', '....##....',
            '....##....', '...#..#...', '...#..#...', '..#....#..', '..#....#..', '.##....##.'],
    run1: ['.....##...', '.....##...', '....####..', '...#.##.#.', '..#..##..#', '.....##...', '.....##...',
           '....#..#..', '...#....#.', '..#.....#.', '.#.......#', '#........#', '#.........'],
    run2: ['.....##...', '.....##...', '....###...', '....###...', '...#.##...', '..#..##...', '.....##...',
           '.....##...', '.....#.#..', '....#..#..', '....#..#..', '...#...#..', '...##..##.'],
    climb1: ['.#........', '.#..##....', '..#.##....', '...####...', '....##.#..', '....##..#.', '....##....',
             '....##....', '...#..#...', '...#..#...', '...#...#..', '..##...#..', '.......##.'],
    jump: ['..........', '..........', '#........#', '.#..##..#.', '..#.##.#..', '...####...', '....##....',
           '....##....', '...#..#...', '..#....#..', '.#......#.', '#........#', '..........'],
    bomb: ['...##...', '....#...', '..####..', '.#....#.', '#..##..#', '#..##..#', '.#....#.', '..####..'],
    bird1: ['#.....#', '.#...#.', '..###..', '.#####.', '..#.#..'],
    bird2: ['.......', '##...##', '..###..', '.#####.', '..#.#..'],
    egg: ['..#..', '.###.', '#####', '#####', '.###.'],
    life: ['.##.', '.##.', '####', '.##.', '#..#']
  };
  SPR.climb2 = SPR.climb1.map(function (r) { return r.split('').reverse().join(''); });
  SPR.fall = SPR.stand.slice().reverse();

  function drawSprite(ctx, rows, x, y, color, flip) {
    ctx.fillStyle = color;
    var w = rows[0].length;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var c = 0; c < w; c++) {
        if (row[c] === '#') ctx.fillRect(x + (flip ? w - 1 - c : c), y + r, 1, 1);
      }
    }
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function rndi(a, b) { return Math.floor(rnd(a, b + 1)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---- geometry ------------------------------------------------------------
  function segsFromPoly(def) {
    var out = [], p = def.pts;
    for (var i = 0; i + 3 < p.length; i += 2) {
      var x1 = p[i], y1 = p[i + 1], x2 = p[i + 2], y2 = p[i + 3];
      if (x2 < x1) { var t = x1; x1 = x2; x2 = t; t = y1; y1 = y2; y2 = t; }
      out.push({ x1: x1, y1: y1, x2: x2, y2: y2, seen: false, flash: 0 });
    }
    return out;
  }

  function surfaceY(s, x) {
    if (s.x2 === s.x1) return s.y1;
    var cx = clamp(x, s.x1, s.x2);
    return s.y1 + (s.y2 - s.y1) * (cx - s.x1) / (s.x2 - s.x1);
  }

  // ---- World ---------------------------------------------------------------
  function World(levelIndex, opts) {
    opts = opts || {};
    this.index = levelIndex;
    this.def = LEVELS[levelIndex];
    this.speed = opts.speed || 2;
    this.preview = !!opts.preview;
    var d = this.def;
    this.colors = PAL;
    this.border = d.border;
    this.special = d.special || null;

    var self = this;
    this.girders = [];
    d.girders.forEach(function (gd) { self.girders = self.girders.concat(segsFromPoly(gd)); });
    this.ladders = d.ladders.map(function (l) { return { x: l[0], top: l[1], bot: l[2], seen: false, flash: 0 }; });
    this.ropes = [];
    (d.up || []).forEach(function (r) { self.ropes.push({ x: r[0], top: r[1], bot: r[2], up: true, seen: false, flash: 0 }); });
    (d.down || []).forEach(function (r) { self.ropes.push({ x: r[0], top: r[1], bot: r[2], up: false, seen: false, flash: 0 }); });

    var bombDefs = d.bombs;
    if (d.bombSpots) {
      var spots = d.bombSpots.slice();
      for (var i = spots.length - 1; i > 0; i--) { var j = rndi(0, i); var t = spots[i]; spots[i] = spots[j]; spots[j] = t; }
      bombDefs = spots.slice(0, d.bombCount);
    }
    this.bombs = bombDefs.map(function (b) { return { x: b[0], y: b[1], letter: b[2] || null, alive: true }; });
    this.collected = 0;

    this.t = 0;
    this.bonus = d.bonus;
    this.bonusTick = 0;
    this.events = [];
    this.particles = [];
    this.bullets = [];
    this.fires = [];
    this.sliders = [];
    this.stones = [];
    this.eggs = [];
    this.birds = [];
    this.walls = [];
    this.wallDir = 1;
    this.letters = [];
    this.spellOk = true;
    this.wind = 0;
    this.debris = [];
    this.teleSq = null;
    this.completeT = -1;
    this.revealT = 0;

    for (var b = 0; b < d.bullets; b++) this.bullets.push(this.newBullet(120 + b * 90));
    if (this.special === 'hellstones') for (var s2 = 0; s2 < 3; s2++) this.stones.push({ state: 'wait', wait: 60 + s2 * 70 });
    if (this.special === 'sreddal') this.initSliders();
    if (this.special === 'teleport') this.moveTeleSquare();
    if (this.special === 'spell') this.letters = d.spell.split('').map(function () { return null; });

    this.player = null;
    this.spawnPlayer();
  }

  World.prototype.spawnPlayer = function () {
    var st = this.def.start, respawn = !!this.player;
    this.player = {
      x: st[0], y: st[1], vx: 0, vy: 0, mode: 'ground', face: 1, anim: 0,
      jumpStartY: st[1], support: null, ladder: null, rope: null,
      ropeCool: 0, lastRope: null, dyingT: 0, plummetT: 0, deadT: 0,
      invuln: respawn ? 90 : 0
    };
    if (!this.attachSupport()) {
      // some boards start Jumpman hanging on a ladder (e.g. Hellstones)
      var l = this.findLadder(st[0], st[1], -1) || this.findLadder(st[0], st[1], 1);
      if (l) { this.player.mode = 'ladder'; this.player.ladder = l; this.player.x = l.x; }
    }
    // clear lingering creatures so a fresh life isn't ambushed
    var self = this;
    this.bullets.forEach(function (bl, i) { self.resetBullet(bl, 90 + i * 60); });
    this.stones.forEach(function (s, i) { s.state = 'wait'; s.wait = 60 + i * 50; });
    this.birds = [];
    this.eggs = [];
    this.fires = [];
  };

  World.prototype.tickRate = function () { return 60 * SPEED_FACTOR[this.speed - 1]; };

  World.prototype.emit = function (type, data) { this.events.push({ type: type, data: data }); };

  World.prototype.surfaces = function () { return this.girders; };

  // nearest surface under x within [y - up, y + down]
  World.prototype.findSurface = function (x, y, up, down) {
    var best = null, bestD = 1e9, list = this.surfaces();
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (x < s.x1 - P.EDGE || x > s.x2 + P.EDGE) continue;
      var sy = surfaceY(s, x);
      if (sy < y - up || sy > y + down) continue;
      var dd = Math.abs(sy - y);
      if (dd < bestD) { bestD = dd; best = { s: s, y: sy }; }
    }
    return best;
  };

  World.prototype.attachSupport = function () {
    var p = this.player;
    var f = this.findSurface(p.x, p.y, 4, 4);
    if (f) { p.y = f.y; p.support = f.s; p.mode = 'ground'; return true; }
    return false;
  };

  // ---- Sreddal's sliding ladders ----------------------------------------------
  World.prototype.initSliders = function () {
    var self = this;
    this.sliderDir = 1;
    this.def.sliders.forEach(function (sd) {
      var l = { x: sd.x, top: sd.top, bot: sd.top + sd.len, len: sd.len, slider: true, seen: false, flash: 0 };
      self.sliders.push(l); self.ladders.push(l);
    });
  };

  World.prototype.reverseSliders = function () { this.sliderDir = -this.sliderDir; };

  // the pair moves in mirror image: as one rises the other sinks
  World.prototype.updateSliders = function () {
    var a = this.sliders[0], b = this.sliders[1], p = this.player;
    if (!a) return;
    var MIN = -20, MAX = 177, SPEED = 0.87;
    var nt = a.top + this.sliderDir * SPEED;
    if (nt <= MIN || nt >= MAX) { nt = clamp(nt, MIN, MAX); this.sliderDir = -this.sliderDir; }
    [[a, nt], [b, MIN + MAX - nt]].forEach(function (pair) {
      var l = pair[0], dy = pair[1] - l.top;
      l.top = pair[1]; l.bot = l.top + l.len;
      // Jumpman rides along when holding on
      if (p.mode === 'ladder' && p.ladder === l) p.y = clamp(p.y + dy, Math.max(l.top, 14), l.bot);
    });
  };

  // ---- fires -----------------------------------------------------------------
  // each defused bomb sets the girder beside it alight for a few seconds
  World.prototype.lightFires = function (b) {
    var base = this.findSurface(b.x, b.y + 4, 2, 10);
    if (!base) return;
    for (var dir = -1; dir <= 1; dir += 2) {
      var fx = b.x + dir * 26;
      var f = this.findSurface(fx, base.y, 6, 6);
      if (f && fx > 4 && fx < W - 4) this.fires.push({ x: fx, y: f.y, t: 0, life: 260 });
    }
  };

    // ---- bullets ---------------------------------------------------------------
  World.prototype.newBullet = function (wait) {
    return { state: 'wait', wait: wait, x: 0, y: 0, side: 'L', vx: 0, vy: 0, t: 0, base: 0 };
  };

  World.prototype.resetBullet = function (b, wait) { b.state = 'wait'; b.wait = wait; };

  // Bullets behave like the cartridge's "smart" shots (traced from footage):
  // one enters at a random point on a screen edge and drifts slowly straight
  // across. The moment it crosses Jumpman's column (or row) it turns 90 degrees
  // and fires at him. If it never lines up it simply leaves the far side.
  var DRIFT_H = 1.0, DRIFT_V = 0.6, FIRE_H = 3.0, FIRE_V = 1.9;

  World.prototype.updateBullet = function (b) {
    var p = this.player, py = p.y - 6;
    if (b.state === 'wait') {
      if (--b.wait > 0) return;
      b.side = 'LRTB'[rndi(0, 3)];
      b.state = 'drift'; b.t = 0; b.base = 0;
      if (b.side === 'L') { b.x = -2; b.y = rnd(10, 200); b.vx = DRIFT_H; b.vy = 0; }
      else if (b.side === 'R') { b.x = W + 2; b.y = rnd(10, 200); b.vx = -DRIFT_H; b.vy = 0; }
      else if (b.side === 'T') { b.y = -2; b.x = rnd(10, 310); b.vx = 0; b.vy = DRIFT_V; }
      else { b.y = PF_H + 2; b.x = rnd(10, 310); b.vx = 0; b.vy = -DRIFT_V; }
      return;
    }
    b.t++;
    if (b.state === 'drift') {
      var ox = b.x, oy = b.y;
      b.x += b.vx; b.y += b.vy;
      // crossed Jumpman's column / row this tick?
      var crossed = b.vx ? (ox - p.x) * (b.x - p.x) <= 0 : (oy - py) * (b.y - py) <= 0;
      if (crossed && this.alive()) {
        if (b.vx) { b.x = p.x; b.vx = 0; b.vy = py > b.y ? FIRE_V : -FIRE_V; }
        else { b.y = py; b.vy = 0; b.vx = p.x > b.x ? FIRE_H : -FIRE_H; }
        this.fireBullet(b);
      }
    } else if (this.special === 'zigzag') {
      // Zig-Zag shots weave as they fly
      b.base += 1;
      var w = Math.cos(b.base / 7) * 2.0;
      b.x += b.vx + (b.vx ? 0 : w);
      b.y += b.vy + (b.vy ? 0 : w);
    } else {
      b.x += b.vx; b.y += b.vy;
    }
    if (b.x < -8 || b.x > W + 8 || b.y < -8 || b.y > PF_H + 8) this.resetBullet(b, rndi(20, 90));
  };

  World.prototype.fireBullet = function (b) {
    b.state = 'fire'; b.base = 0;
    if (!this.preview) sfx.zap();
  };

  // ---- hellstones --------------------------------------------------------------
  World.prototype.updateStone = function (s) {
    var p = this.player;
    if (s.state === 'wait') {
      if (--s.wait > 0) return;
      s.state = 'live'; s.x = rnd(20, 300); s.y = -4; s.vx = 0; s.vy = 0.4; s.bounces = 0;
      return;
    }
    var oy = s.y;
    s.vy = Math.min(s.vy + 0.07, 2.6);
    s.x += s.vx; s.y += s.vy;
    if (s.vy > 0) {
      var list = this.girders;
      for (var i = 0; i < list.length; i++) {
        var g = list[i];
        if (s.x < g.x1 || s.x > g.x2) continue;
        var sy = surfaceY(g, s.x);
        if (oy <= sy && s.y >= sy) {
          s.y = sy; s.vy = -2.0; s.bounces++;
          s.vx = clamp((p.x - s.x) * 0.02, -0.8, 0.8);
          if (!this.preview && Math.abs(s.x - p.x) < 140) sfx.bounce();
          break;
        }
      }
    }
    if (s.y > PF_H + 4 || s.x < -4 || s.x > W + 4 || s.bounces > 8) { s.state = 'wait'; s.wait = rndi(30, 110); }
  };

  // ---- hatchlings ----------------------------------------------------------------
  World.prototype.updateHatch = function () {
    var p = this.player, self = this;
    this.eggs = this.eggs.filter(function (e) {
      if (++e.t < 80) return true;
      self.birds.push({ x: e.x, y: e.y, vx: 0, vy: -0.5, t: 0 });
      if (self.birds.length > 3) self.birds.shift();
      if (!self.preview) sfx.hatch();
      return false;
    });
    this.birds.forEach(function (b) {
      b.t++;
      var dx = p.x - b.x, dy = (p.y - 7) - b.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      var sp = 0.75;
      b.vx += (dx / d * sp - b.vx) * 0.04;
      b.vy += (dy / d * sp - b.vy) * 0.04;
      b.x += b.vx; b.y += b.vy + Math.sin(b.t / 6) * 0.25;
    });
  };

  // ---- walls ----------------------------------------------------------------
  World.prototype.spawnWall = function () {
    var dir = this.wallDir; this.wallDir = -dir;
    var cols = ['#e86ad0', '#f0a040', '#60d0f0', '#f0f060', '#a080ff'];
    this.walls.push({ x: dir > 0 ? -2 : W + 2, y: rnd(6, 172), h: 34, dir: dir, col: cols[this.walls.length % cols.length] });
  };

  World.prototype.updateWalls = function () {
    var p = this.player;
    this.walls.forEach(function (w) {
      w.x += w.dir * 0.55;
      if (w.x > W + 4) w.x = -4; else if (w.x < -4) w.x = W + 4;
      var alive = p.mode === 'ground' || p.mode === 'air';
      if (alive && Math.abs(p.x - w.x) < 5 && p.y > w.y && p.y - P.BODY_H < w.y + w.h) {
        p.x = clamp(p.x + w.dir * 1.1, 4, W - 4);
        p.pushed = true;
      }
    });
  };

  // ---- teleport square ---------------------------------------------------------------
  World.prototype.moveTeleSquare = function () {
    var cands = this.girders.filter(function (g) { return g.x2 - g.x1 >= 14; });
    var g = cands[rndi(0, cands.length - 1)];
    var x = rnd(g.x1 + 5, g.x2 - 5);
    this.teleSq = { x: x, y: surfaceY(g, x), t: 0 };
  };

  // ---- board changes triggered by bombs -----------------------------------------
  World.prototype.applyChanges = function (b) {
    var list = this.def.changes, self = this;
    if (!list) return;
    list.forEach(function (c) {
      if (Math.abs(c.bomb[0] - b.x) > 2 || Math.abs(c.bomb[1] - b.y) > 2) return;
      c.ops.forEach(function (op) {
        if (op.cut) self.cutGirders(op.cut[0], op.cut[1], op.cut[2]);
        else if (op.cutLadder) self.cutLadder(op.cutLadder[0], op.cutLadder[1], op.cutLadder[2]);
        else if (op.girder) segsFromPoly({ pts: op.girder }).forEach(function (s) { s.flash = 40; self.girders.push(s); });
        else if (op.ladder) self.ladders.push({ x: op.ladder[0], top: op.ladder[1], bot: op.ladder[2], flash: 40, seen: false });
      });
    });
  };

  World.prototype.cutGirders = function (x1, x2, y) {
    var out = [], p = this.player, self = this;
    this.girders.forEach(function (s) {
      if (s.x2 <= x1 || s.x1 >= x2 || Math.abs(surfaceY(s, (x1 + x2) / 2) - y) > 8) { out.push(s); return; }
      if (s.x1 < x1 - 1) out.push({ x1: s.x1, y1: s.y1, x2: x1, y2: surfaceY(s, x1), seen: s.seen, flash: 0 });
      if (s.x2 > x2 + 1) out.push({ x1: x2, y1: surfaceY(s, x2), x2: s.x2, y2: s.y2, seen: s.seen, flash: 0 });
      if (p.support === s) p.support = null;
      for (var x = Math.max(x1, s.x1); x < Math.min(x2, s.x2); x += 3) {
        self.particles.push({ x: x, y: surfaceY(s, x) + 2, vx: rnd(-0.4, 0.4), vy: rnd(0.2, 1.2), t: rndi(10, 22), c: PAL.girderHi });
      }
    });
    this.girders = out;
  };

  World.prototype.cutLadder = function (x, y1, y2) {
    var out = [], p = this.player;
    this.ladders.forEach(function (l) {
      if (Math.abs(l.x - x) > 3 || l.bot <= y1 || l.top >= y2) { out.push(l); return; }
      var parts = [];
      if (y1 - l.top >= 4) parts.push({ x: l.x, top: l.top, bot: y1, seen: l.seen, flash: 0 });
      if (l.bot - y2 >= 4) parts.push({ x: l.x, top: y2, bot: l.bot, seen: l.seen, flash: 0 });
      out = out.concat(parts);
      if (p.ladder === l) {
        p.ladder = parts.filter(function (q) { return p.y >= q.top && p.y <= q.bot; })[0] || null;
        if (!p.ladder) p.mode = 'ladder-lost';
      }
    });
    this.ladders = out;
    if (p.mode === 'ladder-lost') this.startFall();
  };

    // ---- player ---------------------------------------------------------------
  World.prototype.alive = function () {
    var m = this.player.mode;
    return m === 'ground' || m === 'air' || m === 'ladder' || m === 'rope';
  };

  World.prototype.startJump = function (dir) {
    var p = this.player;
    p.mode = 'air'; p.vy = P.JUMP_VY; p.vx = dir * P.JUMP_VX; p.coyote = 0;
    p.jumpStartY = p.y; p.support = null; p.airT = 0;
    p.dirGrace = dir ? 0 : P.DIR_GRACE;
    this.note('jump ' + (dir < 0 ? 'left' : dir > 0 ? 'right' : 'up') + ' from ' + (p.ladder ? 'ladder' : p.rope ? 'rope' : 'ground'));
    if (p.ladder) { p.lastLadder = p.ladder; p.ladder = null; }
    this.jumpUsed = true;
    if (p.rope) { p.lastRope = p.rope; p.rope = null; p.ropeCool = 14; }
    if (dir) p.face = dir;
    sfx.jump();
  };

  World.prototype.startFall = function () {
    var p = this.player;
    p.mode = 'air'; p.vy = 0; p.vx = 0;
    p.jumpStartY = p.y; p.support = null; p.ladder = null;
    p.coyote = 0;
  };

  // walked (or was pushed) off a ledge: allow a late jump for a few ticks
  World.prototype.leaveLedge = function (vx) {
    var p = this.player, ledgeY = p.y;
    this.startFall();
    p.vx = vx; p.coyote = P.COYOTE; p.coyoteY = ledgeY;
    this.note('walked off a ledge');
  };

  World.prototype.kill = function (why) {
    var p = this.player;
    if (!this.alive() || p.invuln > 0 && why !== 'fall') return;
    p.mode = 'dying'; p.dyingT = 0; p.why = why;
    this.note('DIED: ' + why);
    p.ladder = null; p.rope = null; p.support = null;
    sfx.hit();
  };

  World.prototype.findLadder = function (x, y, dir) {
    for (var i = 0; i < this.ladders.length; i++) {
      var l = this.ladders[i];
      if (Math.abs(x - l.x) > 6) continue;
      if (dir < 0 && l.top < y - 1 && l.bot >= y - 3) return l;
      if (dir > 0 && l.bot > y + 1 && l.top <= y + 3) return l;
    }
    return null;
  };

  // Jumpman only takes hold of a rope when touching it and pushing the way
  // that rope travels (up for up-ropes, down for down-ropes).
  World.prototype.checkRopeGrab = function (inp, airborne) {
    var p = this.player;
    if (p.ropeCool > 0) { p.ropeCool--; return false; }
    if (!airborne && !inp.up && !inp.down) return false;
    for (var i = 0; i < this.ropes.length; i++) {
      var r = this.ropes[i];
      if (r === p.lastRope) continue;
      if (!airborne && (r.up ? !inp.up : !inp.down)) continue;
      if (Math.abs(p.x - r.x) > 3.5) continue;
      var touching = r.up ? (r.bot >= p.y - 18 && r.top < p.y - 4) : (r.top <= p.y + 8 && r.bot > p.y + 2);
      if (!touching) continue;
      p.mode = 'rope'; p.rope = r; p.x = r.x; p.support = null; p.ladder = null; p.vx = 0; p.vy = 0;
      this.note('grabbed ' + (r.up ? 'up' : 'down') + '-rope');
      if (!r.up && p.y < r.top) p.y = r.top;
      return true;
    }
    return false;
  };

  World.prototype.updatePlayer = function (inp) {
    var p = this.player;
    if (p.invuln > 0) p.invuln--;
    p.pushed = false; p.moving = false;
    var dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);

    if (p.mode === 'dying') {
      if (++p.dyingT > 24) { p.mode = 'plummet'; p.plummetT = 0; sfx.fall(); }
      return;
    }
    if (p.mode === 'plummet') {
      // tumbles to the bottom of the screen, still able to touch bombs
      p.plummetT++;
      p.y += 1.8;
      if (p.plummetT % 5 === 0) p.x = clamp(p.x + rndi(-3, 3), 6, W - 6);
      if (p.y >= FLOOR) { p.y = FLOOR; p.mode = 'dead'; p.deadT = 0; sfx.death(); }
      return;
    }
    if (p.mode === 'dead') {
      if (++p.deadT === 90) this.emit('died');
      return;
    }

    if (p.mode === 'ground') {
      var s = p.support;
      p.lastLadder = null; p.lastRope = null;
      if (this.special === 'hurricane') p.x += this.wind * 0.55;
      p.x = clamp(p.x, 4, W - 4);

      if (inp.jump && inp.fresh !== false) { this.startJump(dir); return; }
      if (inp.jump) this.note('stale jump press ignored after landing', true);
      if (this.checkRopeGrab(inp)) return;
      if (inp.up) {
        var lu = this.findLadder(p.x, p.y, -1);
        if (lu) { p.mode = 'ladder'; p.ladder = lu; p.x = lu.x; p.support = null; return; }
      } else if (inp.down) {
        var ld = this.findLadder(p.x, p.y, 1);
        if (ld) { p.mode = 'ladder'; p.ladder = ld; p.x = ld.x; p.support = null; return; }
      }
      if (dir) {
        p.face = dir;
        var sp = P.WALK;
        var nx = clamp(p.x + dir * sp, 4, W - 4);
        var f = this.findSurface(nx, p.y, P.STEP, P.STEP);
        p.x = nx;
        if (f) { p.y = f.y; p.support = f.s; p.anim += sp; p.moving = true; if (!this.preview) sfx.step(); }
        else this.leaveLedge(dir * 0.35);
      } else {
        var f2 = this.findSurface(p.x, p.y, 3, 3);
        if (f2) { p.y = f2.y; p.support = f2.s; } else this.leaveLedge(0);
      }
      return;
    }

    if (p.mode === 'ladder') {
      var L = p.ladder;
      p.x = L.x;
      if (inp.jump && dir) { this.startJump(dir); return; }
      if (inp.jump) this.note('Space on ladder needs A/D to leap', true);
      var minY = Math.max(L.top, 14);
      if (inp.up && !inp.down) {
        var oy = p.y;
        p.y = Math.max(p.y - P.LADDER, minY);
        p.anim += 1;
        if (!this.preview) sfx.climb();
        // reached a girder where the ladder ends: step onto it
        var top = this.findSurface(p.x, p.y, 1, oy - p.y + 1);
        if (top && Math.abs(top.y - L.top) < 2.5) { p.y = top.y; p.support = top.s; p.mode = 'ground'; p.ladder = null; return; }
      } else if (inp.down && !inp.up) {
        p.y = Math.min(p.y + P.LADDER, L.bot);
        p.anim += 1;
        if (!this.preview) sfx.climb();
        if (p.y >= L.bot) {
          var bot = this.findSurface(p.x, p.y, 3, 3);
          if (bot) { p.y = bot.y; p.support = bot.s; p.mode = 'ground'; p.ladder = null; return; }
        }
      }
      if (dir) {
        var off = this.findSurface(p.x + dir * 2, p.y, 4, 4);
        if (off) { p.face = dir; p.y = off.y; p.support = off.s; p.mode = 'ground'; p.ladder = null; }
      }
      return;
    }

    if (p.mode === 'rope') {
      var R = p.rope;
      p.x = R.x;
      if (inp.jump && dir) { this.startJump(dir); return; }
      if (dir && !inp.up && !inp.down) {
        var step = this.findSurface(p.x + dir * 2, p.y, 4, 4);
        if (step) { p.face = dir; p.y = step.y; p.support = step.s; p.mode = 'ground'; p.rope = null; p.ropeCool = 12; }
        return;
      }
      if (R.up ? !inp.up : !inp.down) return;
      p.anim += 1;
      if (R.up) {
        p.y -= P.ROPE_UP;
        if (!this.preview && this.t % 6 === 0) sfx.climb();
        if (p.y <= R.top + 2) {
          p.y = R.top + 2;
          var land = this.findSurface(p.x, p.y, 8, 14);
          if (land) { p.y = land.y; p.support = land.s; p.mode = 'ground'; p.rope = null; p.ropeCool = 12; }
        }
      } else {
        p.y += P.ROPE_DOWN;
        if (!this.preview && this.t % 6 === 0) sfx.climb();
        if (p.y >= R.bot) {
          p.rope = null; p.ropeCool = 20;
          var under = this.findSurface(p.x, p.y, 2, 3);
          if (under) { p.y = under.y; p.support = under.s; p.mode = 'ground'; }
          else this.startFall();
        }
      }
      return;
    }

    if (p.mode === 'air') {
      if (p.lastLadder && Math.abs(p.x - p.lastLadder.x) > 6) p.lastLadder = null;
      if (p.lastRope && Math.abs(p.x - p.lastRope.x) > 5) p.lastRope = null;
      p.airT = (p.airT || 0) + 1;
      // A/D pressed a moment after Space still turns a straight-up jump into a leap
      if (p.dirGrace > 0) {
        p.dirGrace--;
        if (dir) {
          p.vx = dir * P.JUMP_VX; p.face = dir; p.dirGrace = 0;
          p.x = clamp(p.x + dir * P.JUMP_VX * p.airT, 1, W - 1);
          this.note('late A/D: turned into a ' + (dir < 0 ? 'left' : 'right') + ' leap');
        }
      }
      // late jump just after stepping off a ledge: jump as if still standing on it
      if (p.coyote > 0) {
        p.coyote--;
        if (inp.jump) { p.y = p.coyoteY; p.coyote = 0; this.startJump(dir); this.note('late jump off ledge (grace)'); return; }
      }
      // touching a ladder or rope with a direction held: jump pushes off it
      if (inp.jump && dir && this.touchingClimbable()) { this.startJump(dir); return; }
      p.vy = Math.min(p.vy + P.GRAV, P.MAXFALL);
      var vx = p.vx + (this.special === 'hurricane' ? this.wind : 0);
      var nx2 = p.x + vx, ny = p.y + p.vy;
      // the sides of the board are solid: a leap into them stops dead and he drops
      if (nx2 < 4 || nx2 > W - 4) {
        nx2 = clamp(nx2, 4, W - 4); p.vx = 0;
        if (this.special !== 'hurricane') p.dirGrace = 0;
        this.note('hit the side wall', true);
      }
      if (ny > PF_H - 2) { p.x = nx2; p.y = ny; this.kill('fall'); return; }
      // touching a ladder in mid-air catches it automatically
      {
        for (var i = 0; i < this.ladders.length; i++) {
          var l = this.ladders[i];
          if (l === p.lastLadder) continue;
          if (Math.abs(nx2 - l.x) <= 4 && ny > l.top + 2 && ny - 4 < l.bot) {
            p.mode = 'ladder'; p.ladder = l; p.x = l.x; p.y = clamp(ny, Math.max(l.top, 14), l.bot);
            p.lastLadder = null; p.vx = 0; p.vy = 0;
            this.note('caught ladder mid-air');
            return;
          }
        }
      }
      // girders only block from above: rising through one from below is allowed (as on the C64)
      if (p.vy > 0) {
        var list = this.surfaces(), best = null;
        for (var k = 0; k < list.length; k++) {
          var sg = list[k];
          if (nx2 < sg.x1 - P.EDGE || nx2 > sg.x2 + P.EDGE) continue;
          var sy = surfaceY(sg, nx2);
          var prevSy = sy;
          // feet clipping a girder's top edge by a couple of pixels still count as a landing
          if (p.y <= prevSy + P.LEDGE && ny >= sy && (!best || sy < best.y)) best = { s: sg, y: sy };
        }
        if (best) {
          p.x = nx2; p.y = best.y; p.support = best.s; p.mode = 'ground'; p.vx = 0; p.vy = 0;
          this.note('landed (dropped ' + Math.round(best.y - p.jumpStartY) + ')');
          // dropped too far below the take-off point: KABAM on impact
          if (best.y - p.jumpStartY > P.FATAL) this.kill('fall');
          return;
        }
      }
      p.x = nx2; p.y = ny;
      this.checkRopeGrab(inp, true);
    }
  };

  // short log of control decisions, shown by the debug overlay (` key)
  World.prototype.note = function (msg, once) {
    var n = this.notes || (this.notes = []);
    if (once && n.length && n[n.length - 1].msg === msg) return;
    n.push({ t: this.t, msg: msg });
    if (n.length > 8) n.shift();
  };

  World.prototype.touchingClimbable = function () {
    var p = this.player, i;
    for (i = 0; i < this.ladders.length; i++) {
      var l = this.ladders[i];
      if (l !== p.lastLadder && Math.abs(p.x - l.x) <= 4 && p.y > l.top + 2 && p.y - 4 < l.bot) { p.lastLadder = l; return true; }
    }
    for (i = 0; i < this.ropes.length; i++) {
      var r = this.ropes[i];
      if (r !== p.lastRope && Math.abs(p.x - r.x) <= 3.5 && r.bot >= p.y - 14 && r.top <= p.y) { p.lastRope = r; return true; }
    }
    return false;
  };


  // ---- bombs ---------------------------------------------------------------
  World.prototype.checkBombs = function () {
    var p = this.player;
    if (p.mode === 'dying' || p.mode === 'dead') return;
    for (var i = 0; i < this.bombs.length; i++) {
      var b = this.bombs[i];
      if (!b.alive) continue;
      if (Math.abs(p.x - b.x) < 8 && p.y - P.BODY_H < b.y + 4 && p.y > b.y - 4) this.collectBomb(b);
    }
  };

  World.prototype.collectBomb = function (b) {
    b.alive = false;
    this.collected++;
    var k = this.collected - 1;
    this.emit('bomb', { x: b.x, y: b.y });
    sfx.bomb();
    for (var i = 0; i < 12; i++) {
      var a = Math.random() * Math.PI * 2, s = rnd(0.5, 1.8);
      this.particles.push({ x: b.x, y: b.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: rndi(12, 24), c: PAL.bombHi });
    }
    var remaining = this.bombsLeft();
    this.applyChanges(b);
    switch (this.special) {
      case 'fire': if (remaining) this.lightFires(b); break;
      case 'sreddal': this.reverseSliders(); break;
      case 'walls': if (remaining) this.spawnWall(); break;
      case 'hatch': if (remaining) this.eggs.push({ x: b.x, y: b.y, t: 0 }); break;
      case 'spell': {
        var slot = this.letters.length - 1 - k;
        if (slot >= 0) {
          this.letters[slot] = b.letter;
          if (b.letter !== this.def.spell[slot]) this.spellOk = false;
          sfx.letter();
        }
        break;
      }
      case 'teleport':
        if (remaining && this.alive()) this.teleport();
        break;
    }
  };

  World.prototype.teleport = function () {
    var p = this.player, sq = this.teleSq;
    if (!sq) return;
    p.x = sq.x; p.y = sq.y;
    p.ladder = null; p.rope = null; p.lastRope = null;
    if (p.mode === 'air') { p.jumpStartY = p.y; }
    else if (!this.attachSupport()) this.startFall();
    sfx.teleport();
    for (var i = 0; i < 16; i++) this.particles.push({ x: p.x, y: p.y - 7, vx: rnd(-2, 2), vy: rnd(-2, 2), t: 18, c: '#ffffff' });
    this.moveTeleSquare();
  };

  World.prototype.bombsLeft = function () {
    var n = 0;
    for (var i = 0; i < this.bombs.length; i++) if (this.bombs[i].alive) n++;
    return n;
  };

  // ---- hazards collision ---------------------------------------------------
  World.prototype.checkHazards = function () {
    var p = this.player;
    if (!this.alive() || p.invuln > 0) return;
    var x1 = p.x - 3, x2 = p.x + 3, y1 = p.y - 13, y2 = p.y;
    function hit(x, y, r) { return x + r > x1 && x - r < x2 && y + r > y1 && y - r < y2; }
    for (var i = 0; i < this.bullets.length; i++) {
      var b = this.bullets[i];
      if (b.state !== 'wait' && hit(b.x, b.y, 1.5)) { this.kill('bullet'); return; }
    }
    for (var j = 0; j < this.stones.length; j++) {
      var s = this.stones[j];
      if (s.state === 'live' && hit(s.x, s.y - 2, 2.5)) { this.kill('stone'); return; }
    }
    for (var f = 0; f < this.fires.length; f++) {
      var fi = this.fires[f];
      if (fi.t > 12 && hit(fi.x, fi.y - 4, 3)) { this.kill('fire'); return; }
    }
    for (var k = 0; k < this.birds.length; k++) {
      var bd = this.birds[k];
      if (hit(bd.x, bd.y, 2.5)) { this.kill('bird'); return; }
    }
  };

  // ---- main tick -------------------------------------------------------------
  World.prototype.tick = function (inp) {
    this.t++;
    var p = this.player;
    if (this.special === 'sreddal' && this.alive()) this.updateSliders();

    if (this.special === 'hurricane') {
      this.wind = 0.55 + 0.4 * Math.sin(this.t / 85) + 0.15 * Math.sin(this.t / 13);
      if (Math.random() < 0.35) this.debris.push({ x: -4, y: rnd(0, PF_H), v: rnd(2.5, 4.5), len: rndi(3, 7) });
      var wnd = this.wind;
      this.debris = this.debris.filter(function (d) { d.x += d.v * (0.6 + wnd); return d.x < W + 8; });
    }

    this.updatePlayer(inp);

    if (this.special === 'walls') this.updateWalls();
    if (this.special === 'hatch' && this.alive()) this.updateHatch();
    if (this.special === 'teleport' && this.teleSq && ++this.teleSq.t > 110) this.moveTeleSquare();
    if (this.special === 'blackout') this.reveal();

    var self = this;
    if (this.alive() && this.completeT < 0) {
      this.bullets.forEach(function (b) { self.updateBullet(b); });
      this.stones.forEach(function (s) { self.updateStone(s); });
    }

    this.checkBombs();
    this.checkHazards();

    if (this.alive()) this.fires = this.fires.filter(function (f) { return ++f.t < f.life; });

    this.particles = this.particles.filter(function (pt) { pt.x += pt.vx; pt.y += pt.vy; return --pt.t > 0; });
    [this.girders, this.ladders, this.ropes].forEach(function (list) { list.forEach(function (e) { if (e.flash > 0) e.flash--; }); });

    // bonus counts down 100 points every ~5.5 seconds of game time
    if (this.alive() && this.bonus > 0 && ++this.bonusTick >= 330) { this.bonusTick = 0; this.bonus -= 100; }

    if (this.completeT < 0 && this.bombsLeft() === 0 && this.alive()) this.completeT = 0;
    if (this.completeT >= 0 && ++this.completeT === 30) this.emit('complete');
  };

  World.prototype.reveal = function () {
    var p = this.player, cx = p.x, cy = p.y - 7, R = 34;
    this.girders.forEach(function (g) {
      if (g.seen) return;
      var x = clamp(cx, g.x1, g.x2), y = surfaceY(g, x);
      if (Math.abs(x - cx) < R && Math.abs(y - cy) < R) g.seen = true;
    });
    this.ladders.concat(this.ropes).forEach(function (l) {
      if (l.seen) return;
      var y = clamp(cy, l.top, l.bot);
      if (Math.abs(l.x - cx) < R && Math.abs(y - cy) < R) l.seen = true;
    });
  };

  // ---- rendering ---------------------------------------------------------------
  function drawGirder(ctx, s, col) {
    var c = col;
    if (s.flash > 0 && (s.flash >> 2) % 2) c = { girder: '#ffffff', girderHi: '#ffffff', girderLo: '#bbbbbb', hole: '#888888' };
    // drawn in 2-unit columns so slopes come out as little stair steps
    for (var xx = s.x1; xx < s.x2; xx += 2) {
      var x = Math.round(xx), y = Math.round(surfaceY(s, xx));
      ctx.fillStyle = c.girder; ctx.fillRect(x, y, 2, 5);
      ctx.fillStyle = c.girderHi; ctx.fillRect(x, y, 2, 1);
      ctx.fillStyle = c.girderLo; ctx.fillRect(x, y + 4, 2, 1);
      if (((xx - s.x1) >> 1) % 2) { ctx.fillStyle = c.hole; ctx.fillRect(x, y + 2, 2, 1); }
    }
  }

  function drawLadder(ctx, l, color) {
    var c = l.flash > 0 && (l.flash >> 2) % 2 ? '#ffffff' : color;
    var top = Math.round(l.top), h = Math.round(l.bot - l.top);
    ctx.fillStyle = c;
    ctx.fillRect(l.x - 7, top, 2, h);
    ctx.fillRect(l.x + 5, top, 2, h);
    for (var y = top + 2; y < l.bot; y += 6) ctx.fillRect(l.x - 5, y, 10, 1);
  }

  function drawRope(ctx, r, col) {
    var c = r.flash > 0 && (r.flash >> 2) % 2 ? '#ffffff' : (r.up ? col.girder : col.ladder);
    ctx.fillStyle = c;
    for (var y = Math.round(r.top); y < r.bot; y += 2) {
      var k = ((y - Math.round(r.top)) >> 1) % 4;
      var off = k === 0 ? -1 : k === 2 ? 1 : 0;
      ctx.fillRect(r.x + off - 1, y, 2, 2);
    }
  }

  World.prototype.render = function (ctx, opts) {
    opts = opts || {};
    var col = this.colors, t = this.t, p = this.player;
    var progress = opts.progress == null ? 1 : opts.progress;
    var blackout = this.special === 'blackout' && !opts.showAll;

    ctx.save();
    ctx.beginPath(); ctx.rect(-MARGIN, 0, W + MARGIN * 2, PF_H); ctx.clip();

    // the board assembles itself during the level intro: ladders and ropes, then girders
    var nLad = this.ladders.length + this.ropes.length, nG = this.girders.length;
    var total = nLad + nG + this.bombs.length;
    var shown = Math.floor(progress * total);

    if (blackout && this.alive()) {
      var grd = ctx.createRadialGradient(p.x, p.y - 7, 4, p.x, p.y - 7, 38);
      grd.addColorStop(0, 'rgba(70,70,110,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd; ctx.fillRect(p.x - 40, p.y - 47, 80, 80);
    }

    var idx = 0;
    this.ropes.forEach(function (r) { if (idx++ < shown && (!blackout || r.seen)) drawRope(ctx, r, col); });
    this.ladders.forEach(function (l) { if (idx++ < shown && (!blackout || l.seen)) drawLadder(ctx, l, l.slider ? col.slider : col.ladder); });
    this.girders.forEach(function (g) {
      if (idx++ >= shown || (blackout && !g.seen)) return;
      drawGirder(ctx, g, col);
    });
    this.bombs.forEach(function (b) {
      if (idx++ >= shown || !b.alive) return;
      drawSprite(ctx, SPR.bomb, Math.round(b.x - 4), Math.round(b.y - 4), col.bomb, false);
      ctx.fillStyle = col.bombHi; ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 4, 2, 1);
    });

    if (progress >= 1) this.renderActors(ctx, opts);
    ctx.restore();
  };

  World.prototype.renderActors = function (ctx, opts) {
    var t = this.t, p = this.player, col = this.colors;

    this.fires.forEach(function (f) {
      // flickering flame, shrinking as it burns out
      var h = f.life - f.t < 40 ? 4 : 8, x = Math.round(f.x), y = Math.round(f.y);
      var fl = (t >> 1) % 3;
      ctx.fillStyle = '#d83020'; ctx.fillRect(x - 3, y - h + 2, 7, h - 2);
      ctx.fillStyle = fl ? '#f8d040' : '#ff8030'; ctx.fillRect(x - 2 + (fl === 2 ? 1 : 0), y - h, 3, h - 1);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1 + (fl % 2), y - h + 1, 1, 2);
    });

    if (this.special === 'spell') {
      var spell = this.def.spell, lt = this.letters;
      for (var s = 0; s < lt.length; s++) {
        if (!lt[s] || lt[s] === ' ') continue;
        var c = lt[s] === spell[s] ? '#60d0ff' : '#ff7070';
        font.text(ctx, lt[s], 157, 30 + s * 14.5, c);
      }
    }

    if (this.teleSq && (t >> 3) % 2) {
      var sq = this.teleSq;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(sq.x - 4) + 0.5, Math.round(sq.y - 9) + 0.5, 8, 8);
    }

    this.walls.forEach(function (w) {
      ctx.fillStyle = w.col;
      ctx.fillRect(Math.round(w.x) - 1, Math.round(w.y), 2, w.h);
    });

    this.debris.forEach(function (d) {
      ctx.fillStyle = '#8a8a8a';
      ctx.fillRect(Math.round(d.x), Math.round(d.y), d.len, 1);
    });

    this.eggs.forEach(function (e) {
      var wob = e.t > 40 ? ((e.t >> 2) % 2 ? 1 : -1) : 0;
      drawSprite(ctx, SPR.egg, Math.round(e.x - 2 + wob), Math.round(e.y - 2), '#c0ff80', false);
    });
    this.birds.forEach(function (b) {
      drawSprite(ctx, (b.t >> 3) % 2 ? SPR.bird1 : SPR.bird2, Math.round(b.x - 3), Math.round(b.y - 2), (b.t >> 2) % 2 ? '#c070ff' : '#70e070', b.vx < 0);
    });

    this.stones.forEach(function (s) {
      if (s.state !== 'live') return;
      ctx.fillStyle = (t >> 1) % 2 ? '#ff6a2a' : '#ffd040';
      ctx.fillRect(Math.round(s.x - 2), Math.round(s.y - 4), 4, 4);
    });

    this.bullets.forEach(function (b) {
      if (b.state === 'wait') return;
      var bx = Math.round(b.x), by = Math.round(b.y);
      ctx.fillStyle = '#ffffff';
      // C64 shot: a short white dash
      ctx.fillRect(bx - 2, by - 1, 4, 2);
    });

    this.particles.forEach(function (pt) {
      ctx.fillStyle = pt.c;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), 1, 1);
    });

    this.drawPlayer(ctx);
  };

  World.prototype.drawPlayer = function (ctx) {
    var p = this.player, t = this.t;
    if (p.invuln > 0 && (t >> 2) % 2 && p.mode === 'ground') return;
    var spr = SPR.stand, flip = p.face < 0;
    switch (p.mode) {
      case 'ground': spr = p.moving ? ((p.anim >> 3) % 2 ? SPR.run1 : SPR.run2) : SPR.stand; break;
      case 'ladder': case 'rope': spr = (p.anim >> 3) % 2 ? SPR.climb1 : SPR.climb2; flip = false; break;
      case 'air': spr = SPR.jump; break;
      case 'dying': spr = (p.dyingT >> 2) % 2 ? SPR.stand : SPR.fall; break;
      case 'plummet': case 'dead': spr = (p.plummetT >> 3) % 2 && p.mode === 'plummet' ? SPR.fall : SPR.jump; break;
    }
    var body = PAL.body, head = PAL.head;
    if (p.mode === 'dying') body = head = (p.dyingT >> 1) % 2 ? '#ff4040' : '#ffff40';
    if (p.mode === 'dead') { body = (p.deadT >> 3) % 2 ? PAL.body : '#ff6060'; spr = SPR.fall; }
    var x = Math.round(p.x - 5), y = Math.round(p.y - 13);
    // C64 Jumpman: white head and arms, purple suit
    drawSprite(ctx, spr, x, y, body, flip);
    drawSprite(ctx, spr.slice(0, 3), x, y, head, flip);
  };

  World.prototype.drawLifeIcon = function (ctx, x, y, c) { drawSprite(ctx, SPR.life, x, y, c, false); };

  JA.World = World;
  JA.SPR = SPR;
  JA.drawSprite = drawSprite;
  JA.PHYS = P;
  JA.SPEED_FACTOR = SPEED_FACTOR;
  JA.PF_H = PF_H;
  JA.PAL = PAL;
  JA.MARGIN = MARGIN;
})();
