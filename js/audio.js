// Tiny square-wave synth in the spirit of the Atari POKEY.
(function () {
  'use strict';

  var ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem('jumpabout.muted') === '1'; } catch (e) { /* storage blocked */ }

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.18;
    master.connect(ctx.destination);
    return true;
  }

  // play a list of [freq, durationSec] notes starting at offset t0
  function seq(notes, type, vol, t0) {
    if (!ensure() || muted) return;
    var t = ctx.currentTime + (t0 || 0);
    notes.forEach(function (n) {
      if (n[0] > 0) tone(n[0], t, n[1], type, vol, n[2]);
      t += n[1];
    });
  }

  function tone(freq, t, dur, type, vol, slideTo) {
    var o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, t + dur);
    gn.gain.setValueAtTime(vol || 0.5, t);
    gn.gain.setValueAtTime(vol || 0.5, t + dur * 0.8);
    gn.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(gn); gn.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol) {
    if (!ensure() || muted) return;
    var len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(), gn = ctx.createGain();
    src.buffer = buf; gn.gain.value = vol || 0.3;
    src.connect(gn); gn.connect(master); src.start();
  }

  var lastStep = 0;
  var SFX = {
    step: function () {
      if (!ensure() || muted) return;
      var now = ctx.currentTime;
      if (now - lastStep < 0.07) return;
      lastStep = now;
      tone(lastStep * 10 % 2 < 1 ? 220 : 196, now, 0.025, 'square', 0.18);
    },
    climb: function () {
      if (!ensure() || muted) return;
      var now = ctx.currentTime;
      if (now - lastStep < 0.09) return;
      lastStep = now;
      tone(330 + Math.random() * 40, now, 0.02, 'square', 0.12);
    },
    jump: function () { seq([[260, 0.16, 720]], 'square', 0.3); },
    bomb: function () { seq([[784, 0.05], [1047, 0.05], [1319, 0.05], [1568, 0.09]], 'square', 0.35); },
    hit: function () { noise(0.25, 0.5); seq([[880, 0.3, 110]], 'sawtooth', 0.35); },
    fall: function () { seq([[700, 0.9, 120]], 'triangle', 0.4); },
    death: function () {
      seq([[392, 0.15], [370, 0.15], [349, 0.15], [330, 0.15], [311, 0.15], [294, 0.3], [0, 0.05], [196, 0.45]], 'square', 0.35);
    },
    level: function () {
      seq([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.2], [0, 0.05], [784, 0.1], [1047, 0.35]], 'square', 0.35);
    },
    extra: function () { seq([[1047, 0.07], [1319, 0.07], [1568, 0.07], [2093, 0.15]], 'square', 0.3); },
    zap: function () { seq([[1600, 0.06, 400]], 'square', 0.18); },
    teleport: function () { seq([[300, 0.2, 1800]], 'sine', 0.35); },
    hatch: function () { seq([[200, 0.06], [0, 0.03], [240, 0.06], [0, 0.03], [320, 0.1]], 'square', 0.3); },
    bounce: function () { seq([[140, 0.05, 90]], 'square', 0.2); },
    letter: function () { seq([[660, 0.06], [990, 0.12]], 'triangle', 0.35); },
    menu: function () { seq([[880, 0.04]], 'square', 0.2); },
    select: function () { seq([[660, 0.05], [1320, 0.08]], 'square', 0.25); },
    tally: function () { seq([[1200, 0.02]], 'square', 0.12); },
    // closing fanfare for the "WELL DONE" screen
    win: function () {
      seq([[523, 0.12], [523, 0.12], [523, 0.12], [698, 0.36], [0, 0.04], [659, 0.12], [698, 0.12],
           [784, 0.12], [1047, 0.5]], 'square', 0.35);
    },
    gameover: function () {
      seq([[330, 0.25], [294, 0.25], [262, 0.25], [196, 0.6]], 'square', 0.35);
    }
  };

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('jumpabout.muted', m ? '1' : '0'); } catch (e) { /* storage blocked */ }
    if (master) master.gain.value = m ? 0 : 0.18;
  }

  window.JA = window.JA || {};
  window.JA.audio = {
    sfx: SFX, unlock: ensure,
    toggleMute: function () { setMuted(!muted); return muted; },
    isMuted: function () { return muted; }
  };
})();
