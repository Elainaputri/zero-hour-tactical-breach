import * as THREE from 'three';
"use strict";
/* The entire game is defined inside __gameMain() and invoked only once the
   global THREE build is present. Top-level statements in here reference
   THREE (the Player vectors, shared shell/impact geometries, the bullet-hole
   material), so executing this script before the CDN chain above resolves
   would throw "THREE is not defined", abort the whole script before its boot
   handler is even registered, and the title-screen flythrough render loop
   would never start. */
function __gameMain() {
/* =====================================================================
   ZERO HOUR: TACTICAL BREACH
   Modules: AudioEngine · TextureGenerator · MapBuilder · WeaponSystem
            UtilitySystem · BotAI · HUDManager · GameLoop
   All assets procedural: CanvasTexture PBR maps + WebAudio synthesis.
   ===================================================================== */

// AudioEngine — modul suara WebAudio untuk game FPS Three.js.
// Semua suara dirutekan lewat satu gain master; tiap suara memakai
// envelope attack/decay sendiri dan berhenti otomatis setelah berbunyi.

var AudioEngine = {
  ctx: null,
  master: null,
  volume: 0.8,

  init: function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') { this.ctx.resume(); }
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  },

  setVolume: function (v) {
    this.volume = v;
    if (this.master) { this.master.gain.value = v; }
  },

  now: function () {
    return this.ctx ? this.ctx.currentTime : 0;
  },

  noiseBuffer: function (dur) {
    var len = Math.floor(this.ctx.sampleRate * dur);
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var data = buf.getChannelData(0);
    var i;
    for (i = 0; i < len; i++) { data[i] = Math.random() * 2 - 1; }
    return buf;
  },

  env: function (node, t0, a, peak, dec) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
  },

  _makeGain: function () {
    var g = this.ctx.createGain();
    g.connect(this.master);
    return g;
  },

  _makeOsc: function (type, freq) {
    var o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  },

  _noiseSrc: function (dur) {
    var s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuffer(dur);
    return s;
  },

  _makeFilter: function (type, freq, q) {
    var f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q) { f.Q.value = q; }
    return f;
  },

  _scheduleBeeps: function (plan) {
    var self = this;
    plan.forEach(function (entry) {
      setTimeout(function () { self.beep(entry.fast); }, entry.at);
    });
  },

  shot: function (kind, dist) {
    if (!this.ctx) { return; }
    var d = dist || 0;
    var vol = Math.max(0.04, 1 - d / 55);
    var t = this.now();
    var table = {
      smg: { type: 'lowpass', freq: 1400, q: 0, dur: 0.3, peak: 0.6 },
      sniper: { type: 'lowpass', freq: 3200, q: 0, dur: 0.5, peak: 0.95 },
      pistol: { type: 'bandpass', freq: 1900, q: 0.6, dur: 0.22, peak: 0.6 }
    };
    var cfg = table[kind] || { type: 'bandpass', freq: 2400, q: 0.6, dur: 0.3, peak: 0.6 };
    var isSniper = kind === 'sniper';
    var src = this._noiseSrc(0.4);
    var flt = this._makeFilter(cfg.type, cfg.freq, cfg.q);
    var g = this._makeGain();
    src.connect(flt);
    flt.connect(g);
    this.env(g, t, 0.004, cfg.peak * vol, cfg.dur);
    src.start(t);
    src.stop(t + cfg.dur + 0.1);
    var thump = this._makeOsc('sine', isSniper ? 120 : 150);
    thump.frequency.setValueAtTime(isSniper ? 120 : 150, t);
    thump.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    var tg = this._makeGain();
    thump.connect(tg);
    this.env(tg, t, 0.003, isSniper ? 0.9 * vol : 0.45 * vol, isSniper ? 0.42 : 0.2);
    thump.start(t);
    thump.stop(t + 0.6);
  },

  dryFire: function () {
    this.click(1800, 0.08, 0.15);
  },

  click: function (freq, dur, vol) {
    if (!this.ctx) { return; }
    var t = this.now();
    var f = freq || 1200;
    var d = dur || 0.05;
    var v = vol || 0.12;
    var g = this._makeGain();
    var o = this._makeOsc('square', f);
    o.connect(g);
    this.env(g, t, 0.002, v, d);
    o.start(t);
    o.stop(t + d + 0.05);
  },

  uiClick: function () {
    this.click(950, 0.045, 0.1);
  },

  reload: function (stage) {
    if (!this.ctx) { return; }
    var base = this.now() + stage * 0.28;
    var offsets = [0, 0.12];
    var i;
    for (i = 0; i < offsets.length; i++) {
      var tapT = base + offsets[i];
      var src = this._noiseSrc(0.06);
      var flt = this._makeFilter('highpass', 2200, 0);
      var g = this._makeGain();
      src.connect(flt);
      flt.connect(g);
      this.env(g, tapT, 0.002, 0.22, 0.05);
      src.start(tapT);
      src.stop(tapT + 0.1);
    }
    this.click(700 + stage * 150, 0.05, 0.14);
  },

  footstep: function (run, dist) {
    if (!this.ctx) { return; }
    var d = dist || 0;
    var vol = Math.max(0.02, (run ? 0.16 : 0.07) * (1 - d / 22));
    if (vol <= 0.021) { return; }
    var t = this.now();
    var src = this._noiseSrc(0.09);
    var flt = this._makeFilter('lowpass', run ? 700 : 480, 0);
    var g = this._makeGain();
    src.connect(flt);
    flt.connect(g);
    this.env(g, t, 0.004, vol, 0.07);
    src.start(t);
    src.stop(t + 0.14);
  },

  hitmarker: function (head) {
    if (!this.ctx) { return; }
    var t = this.now();
    var g = this._makeGain();
    var o = this._makeOsc('triangle', head ? 3400 : 1900);
    o.connect(g);
    this.env(g, t, 0.001, head ? 0.34 : 0.2, head ? 0.14 : 0.07);
    o.start(t);
    o.stop(t + 0.2);
    if (head) {
      this.click(4600, 0.06, 0.16);
      var src = this._noiseSrc(0.07);
      var flt = this._makeFilter('highpass', 3200, 0);
      var g2 = this._makeGain();
      src.connect(flt);
      flt.connect(g2);
      this.env(g2, t, 0.001, 0.3, 0.06);
      src.start(t);
      src.stop(t + 0.1);
    }
  },

  killConfirm: function (head) {
    if (!this.ctx) { return; }
    var self = this;
    this.click(head ? 1750 : 1250, 0.09, 0.2);
    setTimeout(function () { self.click(head ? 2350 : 1650, 0.13, 0.18); }, 70);
  },

  hurt: function () {
    this.click(220, 0.12, 0.22);
  },

  tinnitus: function (strength) {
    if (!this.ctx || strength <= 0.02) { return; }
    var t = this.now();
    var dur = 0.6 + strength * 2.4;
    var g = this._makeGain();
    var o = this._makeOsc('sine', 5900);
    o.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * strength + 0.02, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.1);
  },

  hiss: function (dur) {
    if (!this.ctx) { return; }
    var t = this.now();
    var src = this._noiseSrc(dur);
    var flt = this._makeFilter('highpass', 3800, 0);
    var g = this._makeGain();
    src.connect(flt);
    flt.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.15);
    g.gain.setValueAtTime(0.16, t + Math.max(0.2, dur - 0.5));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.start(t);
    src.stop(t + dur + 0.05);
  },

  explosion: function (dist) {
    if (!this.ctx) { return; }
    var d = dist || 0;
    var vol = Math.max(0.1, 1 - d / 45);
    var t = this.now();
    var src = this._noiseSrc(0.9);
    var flt = this._makeFilter('lowpass', 2600, 0);
    flt.frequency.setValueAtTime(2600, t);
    flt.frequency.exponentialRampToValueAtTime(90, t + 0.7);
    var g = this._makeGain();
    src.connect(flt);
    flt.connect(g);
    this.env(g, t, 0.005, 0.95 * vol, 0.8);
    src.start(t);
    src.stop(t + 1);
    var o = this._makeOsc('sine', 90);
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    var g2 = this._makeGain();
    o.connect(g2);
    this.env(g2, t, 0.004, 0.8 * vol, 0.65);
    o.start(t);
    o.stop(t + 0.8);
  },

  beep: function (fast) {
    if (!this.ctx) { return; }
    var t = this.now();
    var g = this._makeGain();
    var o = this._makeOsc('square', fast ? 1560 : 1180);
    o.connect(g);
    this.env(g, t, 0.002, 0.14, 0.07);
    o.start(t);
    o.stop(t + 0.12);
  },

  plantDone: function () {
    this._scheduleBeeps([
      { at: 0, fast: false },
      { at: 140, fast: false },
      { at: 280, fast: true }
    ]);
  },

  defuseTick: function () {
    if (!this.ctx) { return; }
    var t = this.now();
    var g = this._makeGain();
    var o = this._makeOsc('sawtooth', 210);
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.16);
    o.connect(g);
    this.env(g, t, 0.01, 0.05, 0.16);
    o.start(t);
    o.stop(t + 0.22);
    this.click(2600, 0.03, 0.07);
  },

  defuseDone: function () {
    this._scheduleBeeps([
      { at: 0, fast: false },
      { at: 120, fast: false },
      { at: 240, fast: true },
      { at: 400, fast: true }
    ]);
  },

  roundSting: function (playerWon) {
    if (!this.ctx) { return; }
    var self = this;
    var first = playerWon ? 880 : 660;
    var second = playerWon ? 1318 : 440;
    this.click(first, 0.16, 0.16);
    setTimeout(function () { self.click(second, 0.16, 0.16); }, 150);
  },

  throwWhoosh: function () {
    if (!this.ctx) { return; }
    var t = this.now();
    var src = this._noiseSrc(0.25);
    var flt = this._makeFilter('bandpass', 500, 2);
    flt.frequency.setValueAtTime(500, t);
    flt.frequency.exponentialRampToValueAtTime(2100, t + 0.22);
    var g = this._makeGain();
    src.connect(flt);
    flt.connect(g);
    this.env(g, t, 0.01, 0.1, 0.22);
    src.start(t);
    src.stop(t + 0.3);
  }
};

// TextureGenerator — pembuat tekstur kanvas prosedural untuk ZERO HOUR.
// Semua tekstur digambar di canvas 2D lalu dibungkus THREE.CanvasTexture.
// Warna dan angka di bawah mengikuti spek perilaku modul ini.
var TextureGenerator = {
  // Buat elemen canvas kosong berukuran w x h.
  _canvas: function (w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  },

  // Isi seluruh kanvas s x s dengan satu warna.
  _fill: function (ctx, s, color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
  },

  // Garis tepi persegi dengan inset tertentu (0 = tepi kanvas).
  _frame: function (ctx, s, color, width, inset) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(inset, inset, s - inset * 2, s - inset * 2);
  },

  // Gradien radial dari tabel stop [offset, warna]; kembalikan gradiennya.
  _radial: function (ctx, x, y, r0, r1, stops) {
    var g = ctx.createRadialGradient(x, y, r0, x, y, r1);
    var i;
    for (i = 0; i < stops.length; i++) {
      g.addColorStop(stops[i][0], stops[i][1]);
    }
    return g;
  },

  // Satu persegi kecil berisi warna pada posisi tertentu.
  _dot: function (ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  },

  // Buat tekstur dari fungsi gambar; repeat opsional berupa [x, y].
  make: function (size, draw, repeat) {
    if (!size || typeof draw !== 'function') { return null; }
    var c = this._canvas(size, size);
    var ctx = c.getContext('2d');
    draw(ctx, size);
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (repeat) {
      tex.repeat.set(repeat[0], repeat[1]);
    }
    tex.anisotropy = 4;
    return tex;
  },

  // Tabur n bintik acak dari daftar warna dengan alpha acak sampai aMax.
  speckle: function (ctx, s, n, colors, aMax) {
    if (!ctx || n <= 0 || !colors || !colors.length) { return; }
    var i;
    var w;
    for (i = 0; i < n; i++) {
      ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
      ctx.globalAlpha = Math.random() * aMax;
      w = 1 + Math.random() * 3;
      ctx.fillRect(Math.random() * s, Math.random() * s, w, w);
    }
    ctx.globalAlpha = 1;
  },

  // Lantai beton abu-abu dengan bintik dan dua garis tepi.
  concrete: function (rep) {
    return this.make(256, function (ctx, s) {
      TextureGenerator._fill(ctx, s, '#8a8d90');
      TextureGenerator.speckle(ctx, s, 2600, ['#6f7276', '#9ea1a4', '#7c7f83', '#a8abae'], 0.5);
      TextureGenerator._frame(ctx, s, 'rgba(40,42,45,0.55)', 3, 0);
      TextureGenerator._frame(ctx, s, 'rgba(255,255,255,0.08)', 1, 3);
    }, rep);
  },

  // Peta bump beton: abu-abu netral dengan bintik kontras.
  concreteBump: function (rep) {
    return this.make(256, function (ctx, s) {
      TextureGenerator._fill(ctx, s, '#808080');
      TextureGenerator.speckle(ctx, s, 3000, ['#5a5a5a', '#a5a5a5', '#6e6e6e'], 0.6);
    }, rep);
  },

  // Lantai grid gelap dengan garis silang cyan dan titik sudut terang.
  gridFloor: function (rep) {
    return this.make(256, function (ctx, s) {
      TextureGenerator._fill(ctx, s, '#3c4147');
      TextureGenerator.speckle(ctx, s, 1500, ['#31363c', '#484e55', '#2b3036'], 0.5);
      TextureGenerator._frame(ctx, s, '#22262b', 5, 0);
      ctx.strokeStyle = 'rgba(140,220,255,0.20)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, s / 2);
      ctx.lineTo(s, s / 2);
      ctx.moveTo(s / 2, 0);
      ctx.lineTo(s / 2, s);
      ctx.stroke();
      var glow = 'rgba(140,220,255,0.35)';
      TextureGenerator._dot(ctx, 10, 10, 4, 4, glow);
      TextureGenerator._dot(ctx, s - 14, 10, 4, 4, glow);
      TextureGenerator._dot(ctx, 10, s - 14, 4, 4, glow);
      TextureGenerator._dot(ctx, s - 14, s - 14, 4, 4, glow);
    }, rep);
  },

  // Peti logam dengan bingkai ganda, baut sudut, dan diagonal.
  metalCrate: function (rep) {
    return this.make(256, function (ctx, s) {
      TextureGenerator._fill(ctx, s, '#5d6a72');
      TextureGenerator.speckle(ctx, s, 900, ['#4c585f', '#6e7c84', '#55616a'], 0.45);
      TextureGenerator._frame(ctx, s, '#39434a', 14, 0);
      TextureGenerator._frame(ctx, s, '#7d8b93', 3, 12);
      TextureGenerator._dot(ctx, 22, 22, 8, 8, '#39434a');
      TextureGenerator._dot(ctx, s - 30, 22, 8, 8, '#39434a');
      TextureGenerator._dot(ctx, 22, s - 30, 8, 8, '#39434a');
      TextureGenerator._dot(ctx, s - 30, s - 30, 8, 8, '#39434a');
      ctx.strokeStyle = 'rgba(30,36,40,0.5)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(20, s - 20);
      ctx.lineTo(s - 20, 20);
      ctx.stroke();
    }, rep);
  },

  // Pola hazard kuning-hitam dengan garis diagonal.
  hazard: function (rep) {
    return this.make(256, function (ctx, s) {
      TextureGenerator._fill(ctx, s, '#c9a227');
      ctx.fillStyle = '#191919';
      var i;
      for (i = -2; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 64, s);
        ctx.lineTo(i * 64 + 64, s);
        ctx.lineTo(i * 64 + 64 + s, 0);
        ctx.lineTo(i * 64 + s, 0);
        ctx.closePath();
        ctx.fill();
      }
      TextureGenerator.speckle(ctx, s, 500, ['#000000', '#ffffff'], 0.16);
    }, rep);
  },

  // Panel dinding dengan pita bawah dan rivet atas-bawah.
  wallPanel: function (rep) {
    return this.make(256, function (ctx, s) {
      TextureGenerator._fill(ctx, s, '#767c84');
      TextureGenerator.speckle(ctx, s, 1300, ['#656b72', '#878d94', '#596066'], 0.4);
      ctx.fillStyle = '#5b6167';
      ctx.fillRect(0, s * 0.62, s, s - s * 0.62);
      TextureGenerator._frame(ctx, s, '#454b51', 4, 0);
      ctx.fillStyle = '#4a5057';
      var x;
      for (x = 16; x < s; x += 48) {
        ctx.beginPath();
        ctx.arc(x, 18, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, s - 18, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }, rep);
  },

  // Rak server: baris panel dengan lampu status dan slot gelap.
  serverRack: function (rep) {
    return this.make(256, function (ctx, s) {
      TextureGenerator._fill(ctx, s, '#22262c');
      var y;
      var x;
      for (y = 8; y < s - 16; y += 30) {
        ctx.fillStyle = '#31363e';
        ctx.fillRect(10, y, s - 20, 24);
        TextureGenerator._dot(ctx, 18, y + 9, 5, 5, Math.random() < 0.5 ? '#39d98a' : '#ffb02e');
        TextureGenerator._dot(ctx, 30, y + 9, 5, 5, '#57b6ff');
        ctx.fillStyle = '#14171b';
        for (x = 48; x < s - 24; x += 9) {
          ctx.fillRect(x, y + 6, 5, 12);
        }
      }
    }, rep);
  },

  // Decal situs: huruf di dalam dua lingkaran sepusat.
  siteDecal: function (letter, color) {
    var c = this._canvas(256, 256);
    var ctx = c.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(128, 128, 108, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(128, 128, 88, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = '900 150px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 128, 136);
    return new THREE.CanvasTexture(c);
  },

  // Cincin hologram: busur putus, lingkaran dalam, dan 12 titik.
  holoRing: function (color) {
    var c = this._canvas(256, 256);
    var ctx = c.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    var a;
    for (a = 0; a < Math.PI * 2; a += Math.PI / 5) {
      ctx.beginPath();
      ctx.arc(128, 128, 112, a, a + Math.PI / 7);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(128, 128, 94, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    var i;
    var ang;
    for (i = 0; i < 12; i++) {
      ang = (i / 12) * Math.PI * 2;
      TextureGenerator._dot(ctx, 128 + Math.cos(ang) * 103 - 3, 128 + Math.sin(ang) * 103 - 3, 6, 6, color);
    }
    return new THREE.CanvasTexture(c);
  },

  // Lubang peluru: noda radial gelap dengan 5 retakan.
  bulletHole: function () {
    var c = this._canvas(64, 64);
    var ctx = c.getContext('2d');
    ctx.fillStyle = this._radial(ctx, 32, 32, 1, 30, [
      [0, 'rgba(5,5,5,0.95)'],
      [0.35, 'rgba(10,10,10,0.85)'],
      [0.7, 'rgba(20,20,20,0.35)'],
      [1, 'rgba(0,0,0,0)']
    ]);
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(15,15,15,0.5)';
    ctx.lineWidth = 1.5;
    var i;
    var ang;
    var len;
    for (i = 0; i < 5; i++) {
      ang = Math.random() * Math.PI * 2;
      len = 14 + Math.random() * 14;
      ctx.beginPath();
      ctx.moveTo(32, 32);
      ctx.lineTo(32 + Math.cos(ang) * len, 32 + Math.sin(ang) * len);
      ctx.stroke();
    }
    return new THREE.CanvasTexture(c);
  },

  // Sprite asap: gumpalan radial abu-abu lembut.
  smokeSprite: function () {
    var c = this._canvas(128, 128);
    var ctx = c.getContext('2d');
    ctx.fillStyle = this._radial(ctx, 64, 64, 4, 62, [
      [0, 'rgba(235,238,242,0.85)'],
      [0.55, 'rgba(210,214,220,0.55)'],
      [1, 'rgba(200,205,212,0)']
    ]);
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  },

  // Sprite kilat moncong: cahaya radial kuning-oranye.
  muzzleSprite: function () {
    var c = this._canvas(128, 128);
    var ctx = c.getContext('2d');
    ctx.fillStyle = this._radial(ctx, 64, 64, 2, 62, [
      [0, 'rgba(255,255,230,1)'],
      [0.3, 'rgba(255,190,60,0.9)'],
      [1, 'rgba(255,120,20,0)']
    ]);
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
};

/* ============================ MapBuilder ============================= */
const WORLD = 64;              // playable square is WORLD x WORLD, centered on 0
const HALF = WORLD / 2;
const colliders = [];          // {minX,maxX,minZ,maxZ,h} static AABBs (y from 0)
const wallMeshes = [];         // meshes for bullet raycasts
const sites = {
  A: { x: -19, z: -19, r: 6.5, name: "SITE A — SERVER VAULT" },
  B: { x: 19, z: -19, r: 6.5, name: "SITE B — REACTOR CORE" }
};
let navNodes = [];             // {x,z,cover,site}
let navEdges = [];

function addCollider(x, z, w, d, h) {
  colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h: h });
}
function segHitsAABB(ax, ay, az, bx, by, bz, c, pad) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let tmin = 0, tmax = 1;
  const mins = [c.minX - (pad || 0), 0, c.minZ - (pad || 0)];
  const maxs = [c.maxX + (pad || 0), c.h, c.maxZ + (pad || 0)];
  const a = [ax, ay, az], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) { if (a[i] < mins[i] || a[i] > maxs[i]) return false; }
    else {
      let t1 = (mins[i] - a[i]) / d[i], t2 = (maxs[i] - a[i]) / d[i];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}
// Line of sight: blocked by any collider taller than the sight line, and by smoke
const smokes = [];             // {pos:Vector3, r, until}
function losBlocked(a, b) {
  for (let i = 0; i < colliders.length; i++) {
    if (colliders[i].h < 1.0) continue; // low cover doesn't block standing sightlines fully
    if (segHitsAABB(a.x, a.y, a.z, b.x, b.y, b.z, colliders[i], 0)) return true;
  }
  for (let i = 0; i < smokes.length; i++) {
    const s = smokes[i];
    // segment-sphere test
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz || 1;
    let t = ((s.pos.x - a.x) * abx + (s.pos.y - a.y) * aby + (s.pos.z - a.z) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + abx * t - s.pos.x, py = a.y + aby * t - s.pos.y, pz = a.z + abz * t - s.pos.z;
    if (px * px + py * py + pz * pz < s.r * s.r) return true;
  }
  return false;
}
function collideMove(pos, radius, height) {
  // resolve circle vs AABBs in XZ, only for colliders taller than step height
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.h < 0.55 && height > 0) { /* low walls still block walking */ }
    const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      } else {
        // inside: push out along smallest penetration axis
        const pl = pos.x - c.minX, pr = c.maxX - pos.x, pt = pos.z - c.minZ, pb = c.maxZ - pos.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) pos.x = c.minX - radius; else if (m === pr) pos.x = c.maxX + radius;
        else if (m === pt) pos.z = c.minZ - radius; else pos.z = c.maxZ + radius;
      }
    }
  }
  pos.x = Math.max(-HALF + 1, Math.min(HALF - 1, pos.x));
  pos.z = Math.max(-HALF + 1, Math.min(HALF - 1, pos.z));
}

const MapBuilder = {
  mats: null,
  build(scene) {
    const T = TextureGenerator;
    const conc = T.concrete([2, 2]), concB = T.concreteBump([2, 2]);
    const panel = T.wallPanel([2, 1]), crate = T.metalCrate([1, 1]);
    const haz = T.hazard([3, 1]), floorT = T.gridFloor([16, 16]);
    const rack = T.serverRack([1, 2]);
    const M = {
      wall: new THREE.MeshStandardMaterial({ map: panel, bumpMap: concB, bumpScale: 0.4, roughness: 0.85, metalness: 0.15 }),
      concrete: new THREE.MeshStandardMaterial({ map: conc, bumpMap: concB, bumpScale: 0.5, roughness: 0.95, metalness: 0.02 }),
      crate: new THREE.MeshStandardMaterial({ map: crate, roughness: 0.55, metalness: 0.55 }),
      crateOrange: new THREE.MeshStandardMaterial({ map: crate, color: 0xd98a4a, roughness: 0.55, metalness: 0.5 }),
      hazard: new THREE.MeshStandardMaterial({ map: haz, roughness: 0.7, metalness: 0.2 }),
      rack: new THREE.MeshStandardMaterial({ map: rack, roughness: 0.4, metalness: 0.6, emissive: 0x0a1410 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6, metalness: 0.6 }),
      glowA: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff7a1a, emissiveIntensity: 1.6 }),
      glowB: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x35c4ff, emissiveIntensity: 1.6 }),
      reactor: new THREE.MeshStandardMaterial({ color: 0x39424c, roughness: 0.3, metalness: 0.8, emissive: 0x0d3a4d, emissiveIntensity: 0.7 })
    };
    this.mats = M;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(WORLD + 30, WORLD + 30),
      new THREE.MeshStandardMaterial({ map: floorT, roughness: 0.9, metalness: 0.25 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);

    const box = (x, z, w, d, h, mat, noCollide) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, h / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.wall = true;
      scene.add(m); wallMeshes.push(m);
      if (!noCollide) addCollider(x, z, w, d, h);
      return m;
    };
    this.box = box;

    // ---- Perimeter ----
    box(0, -HALF - 1, WORLD + 4, 2, 6, M.wall); box(0, HALF + 1, WORLD + 4, 2, 6, M.wall);
    box(-HALF - 1, 0, 2, WORLD + 4, 6, M.wall); box(HALF + 1, 0, 2, WORLD + 4, 6, M.wall);

    // ---- Site A: Server Vault (NW) — south wall as two segments with a doorway at x=-19 ----
    box(-26, -11.5, 12, 1.4, 4.6, M.wall);
    box(-12, -11.5, 12, 1.4, 4.6, M.wall);
    box(-8.5, -20, 1.4, 18, 4.6, M.wall);             // east wall of A
    // server racks
    box(-24, -24, 1.6, 7, 2.6, M.rack); box(-24, -15.5, 1.6, 4, 2.6, M.rack);
    box(-15, -25, 1.6, 6, 2.6, M.rack); box(-15, -16.5, 1.6, 3, 2.6, M.rack);
    box(-19.5, -20.5, 3.4, 3.4, 1.15, M.crate);       // head-glitch crate stack center A
    box(-28, -28, 2.2, 2.2, 2.2, M.crateOrange);
    box(-10.5, -27.5, 2.2, 2.2, 1.15, M.crate);       // low cover

    // ---- Site B: Reactor Core (NE) ----
    box(12, -11.5, 12, 1.4, 4.6, M.wall);
    box(26, -11.5, 12, 1.4, 4.6, M.wall);
    box(8.5, -20, 1.4, 18, 4.6, M.wall);              // west wall of B
    const reactor = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 5.2, 20), M.reactor);
    reactor.position.set(19, 2.6, -21); reactor.castShadow = true; reactor.userData.wall = true;
    scene.add(reactor); wallMeshes.push(reactor);
    addCollider(19, -21, 5.2, 5.2, 5.2); // AABB fully contains the r=2.6 reactor cylinder mesh
    const coreGlow = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 5.4, 12), M.glowB);
    coreGlow.position.set(19, 2.7, -21); scene.add(coreGlow);
    box(14.5, -14.5, 3.2, 3.2, 1.15, M.crate);        // low cover B
    box(24.5, -27, 2.4, 2.4, 2.3, M.crate);
    box(27.5, -14, 2.2, 2.2, 1.15, M.crateOrange);
    box(13, -27.5, 2.2, 2.2, 2.2, M.crate);

    // ---- Mid corridor ----
    box(-6, -2, 1.4, 15, 4.6, M.wall);                // mid west wall
    box(6, 3, 1.4, 13, 4.6, M.wall);                  // mid east wall (staggered)
    box(0, -6, 2.6, 2.6, 1.15, M.crate);              // mid low box (head-glitch)
    box(-2.8, 6.5, 2.4, 2.4, 2.3, M.crateOrange);
    box(3.2, -1.5, 2.2, 2.2, 1.15, M.crate);
    box(-13, -4, 5.5, 1.2, 1.15, M.concrete);         // low wall west lane
    box(13, -4, 5.5, 1.2, 1.15, M.concrete);          // low wall east lane
    box(-13, -7.5, 2.4, 2.4, 2.3, M.crate);
    box(13, 0.5, 2.4, 2.4, 2.3, M.crate);

    // ---- South lanes / attacker approach ----
    box(-6, 14, 1.4, 12, 4.6, M.wall);
    box(6, 14, 1.4, 12, 4.6, M.wall);
    box(-16, 10, 2.4, 2.4, 2.3, M.crate); box(16, 10, 2.4, 2.4, 2.3, M.crateOrange);
    box(-19, 19, 3.4, 1.2, 1.15, M.concrete);         // low walls south
    box(19, 19, 3.4, 1.2, 1.15, M.concrete);
    box(0, 22, 4.5, 2.2, 1.15, M.crate);              // spawn cover
    box(-25, 24, 2.4, 2.4, 2.3, M.crate); box(25, 24, 2.4, 2.4, 2.3, M.crate);

    // ---- North defender approach cover ----
    box(0, -14.5, 3.2, 3.2, 1.15, M.crate);
    box(-4, -26, 2.4, 2.4, 2.3, M.crate); box(4, -26, 2.4, 2.4, 2.3, M.crateOrange);
    box(0, -20, 1.4, 9, 4.6, M.wall);                 // divider between sites (defender side)

    // ---- Hazard stripe accents at site doors ----
    const hzA = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.1), M.hazard);
    hzA.rotation.x = -Math.PI / 2; hzA.position.set(-19, 0.02, -11.5); hzA.receiveShadow = true; scene.add(hzA);
    const hzB = hzA.clone(); hzB.position.set(19, 0.02, -11.5); scene.add(hzB);

    // ---- Site holographic decals ----
    const mkDecal = (site, letter, color) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(site.r, 40),
        new THREE.MeshBasicMaterial({ map: TextureGenerator.siteDecal(letter, color), transparent: true, opacity: 0.85, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(site.x, 0.03, site.z);
      scene.add(m); return m;
    };
    this.decalA = mkDecal(sites.A, "A", "#ff7a1a");
    this.decalB = mkDecal(sites.B, "B", "#35c4ff");

    // ---- Site marker pillars of light ----
    const pillar = (site, mat) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 9, 0.35), mat);
      p.position.set(site.x, 4.5, site.z); scene.add(p);
    };
    pillar(sites.A, M.glowA); pillar(sites.B, M.glowB);

    // ---- Holographic rotating site rings + emergency beacons ----
    this.rings = [];
    const mkRing = (site, color) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(site.r * 2 + 3.6, site.r * 2 + 3.6),
        new THREE.MeshBasicMaterial({ map: TextureGenerator.holoRing(color), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.set(site.x, 0.06, site.z);
      scene.add(m); this.rings.push(m);
    };
    mkRing(sites.A, "#ff7a1a"); mkRing(sites.B, "#35c4ff");
    this.beacons = [];
    const beaconAt = (x, z, phase, y) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0xff2d20, emissiveIntensity: 2 });
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), mat);
      s.position.set(x, y || 6.15, z); scene.add(s);
      this.beacons.push({ mat, phase });
    };
    beaconAt(-HALF - 1, -HALF - 1, 0); beaconAt(HALF + 1, -HALF - 1, 1.6);
    beaconAt(-HALF - 1, HALF + 1, 3.1); beaconAt(HALF + 1, HALF + 1, 4.7);
    // site-door beacons on the site walls (4.6 high): close to the title
    // camera's sweep, so a blinking beacon reads clearly in frame
    beaconAt(-19, -11.5, 2.2, 4.95); beaconAt(19, -11.5, 5.3, 4.95);
    const beaconLight = new THREE.PointLight(0xff3524, 0, 20);
    beaconLight.position.set(0, 6.4, -HALF - 1); scene.add(beaconLight);
    this.beaconLight = beaconLight;

    this.buildNav();
  },
  buildNav() {
    const P = (x, z, cover, site) => ({ x, z, cover: !!cover, site: site || null });
    navNodes = [
      P(0, 27), P(-8, 25), P(8, 25),                       // attacker spawn 0-2
      P(-13, 15), P(0, 16), P(13, 15),                     // south lanes 3-5
      P(-13, 3, true), P(0, 1), P(13, 3, true),            // mid south 6-8
      P(-13, -8.5), P(0, -9.5), P(13, -8.5),               // mid north 9-11
      P(-19, -8), P(19, -8),                               // site doors 12-13
      P(-19, -19, false, "A"), P(-25, -20, true, "A"), P(-13.5, -20, true, "A"), P(-19, -26.5, true, "A"), // A 14-17
      P(19, -19, false, "B"), P(25, -20, true, "B"), P(13.5, -20, true, "B"), P(19, -26.5, true, "B"),     // B 18-21
      P(-4.5, -18), P(-4, -28), P(4, -28), P(0, -27),         // defender spawn 22-25
      P(-4.5, -13.5, true), P(4.5, -13.5, true)            // defender mid cover 26-27
    ];
    navEdges = navNodes.map(() => []);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < navNodes.length; i++) for (let j = i + 1; j < navNodes.length; j++) {
      const dx = navNodes[i].x - navNodes[j].x, dz = navNodes[i].z - navNodes[j].z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 17) continue;
      a.set(navNodes[i].x, 1.2, navNodes[i].z); b.set(navNodes[j].x, 1.2, navNodes[j].z);
      let blocked = false;
      for (let k = 0; k < colliders.length; k++) {
        if (colliders[k].h < 1.3) continue;
        if (segHitsAABB(a.x, a.y, a.z, b.x, b.y, b.z, colliders[k], -0.4)) { blocked = true; break; }
      }
      if (!blocked) { navEdges[i].push(j); navEdges[j].push(i); }
    }
  },
  nearestNode(x, z) {
    let best = 0, bd = 1e9;
    for (let i = 0; i < navNodes.length; i++) {
      const dx = navNodes[i].x - x, dz = navNodes[i].z - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  },
  findPath(sx, sz, tx, tz) {
    const s = this.nearestNode(sx, sz), t = this.nearestNode(tx, tz);
    if (s === t) return [t];
    const prev = new Array(navNodes.length).fill(-1);
    const seen = new Array(navNodes.length).fill(false);
    const q = [s]; seen[s] = true;
    while (q.length) {
      const cur = q.shift();
      if (cur === t) break;
      for (const nb of navEdges[cur]) if (!seen[nb]) { seen[nb] = true; prev[nb] = cur; q.push(nb); }
    }
    if (!seen[t]) return [t];
    const path = []; let cur = t;
    while (cur !== -1) { path.unshift(cur); cur = prev[cur]; }
    return path;
  }
};

/* ====================== Character models (bots) ====================== */
// ===== Blok 1: buildCharacterMesh — model karakter bot (tim atk / def) =====
function buildCharacterMesh(team) {
  var isAtk = team === 'atk';
  var suitMat = new THREE.MeshStandardMaterial({
    color: isAtk ? 0x3a3f45 : 0x2e3a4a, roughness: 0.8, metalness: 0.2
  });
  var accentMat = new THREE.MeshStandardMaterial({
    color: isAtk ? 0xff7a1a : 0x35c4ff, roughness: 0.5, metalness: 0.3,
    emissive: isAtk ? 0x903c00 : 0x0d4d6e, emissiveIntensity: 0.7
  });
  var darkMat = new THREE.MeshStandardMaterial({
    color: 0x1c1f24, roughness: 0.7, metalness: 0.4
  });

  var group = new THREE.Group();

  function addBox(w, h, d, mat, x, y, z, part) {
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    if (part) mesh.userData.part = part;
    group.add(mesh);
    return mesh;
  }

  var legL = addBox(0.21, 0.78, 0.24, darkMat, -0.14, 0.39, 0);
  var legR = addBox(0.21, 0.78, 0.24, darkMat, 0.14, 0.39, 0);
  var torso = addBox(0.56, 0.66, 0.32, suitMat, 0, 1.11, 0, 'body');
  addBox(0.58, 0.14, 0.34, accentMat, 0, 1.32, 0);
  var head = addBox(0.3, 0.3, 0.3, darkMat, 0, 1.62, 0, 'head');
  addBox(0.32, 0.09, 0.05, accentMat, 0, 1.64, 0.16);
  addBox(0.13, 0.5, 0.13, suitMat, -0.36, 1.14, 0.05);
  addBox(0.13, 0.5, 0.13, suitMat, 0.36, 1.14, 0.05);
  var gun = addBox(0.09, 0.16, 0.72, darkMat, 0.18, 1.18, 0.34);

  group.userData.parts = { legL: legL, legR: legR, torso: torso, head: head, gun: gun };
  return group;
}

/* ============================ Weapon data ============================ */
const WEAPONS = {
  vandal: { name: "VANDAL-X", mode: "FULL-AUTO", price: 2900, dmg: 38, headMult: 150 / 38, rpm: 600, mag: 25, reserve: 75,
    spreadHip: 0.011, spreadMove: 0.05, spreadAds: 0.0012, recoil: 0.0115, auto: true, snd: "rifle", zoom: 1.35, tracer: 0xffd9a0 },
  spectre: { name: "SPECTRE-S", mode: "FULL-AUTO · SUPPRESSED", price: 1600, dmg: 26, headMult: 3, rpm: 800, mag: 30, reserve: 90,
    spreadHip: 0.014, spreadMove: 0.026, spreadAds: 0.002, recoil: 0.005, auto: true, snd: "smg", zoom: 1.3, tracer: 0xbfe3ff, suppressed: true },
  operator: { name: "OPERATOR-50", mode: "BOLT-ACTION", price: 4700, dmg: 120, headMult: 2, rpm: 40, mag: 5, reserve: 15,
    spreadHip: 0.09, spreadMove: 0.12, spreadAds: 0.0001, recoil: 0.055, auto: false, snd: "sniper", zoom: 4.2, sniper: true, tracer: 0xfff2c8 },
  pistol: { name: "P226-TAC", mode: "SEMI-AUTO", price: 0, dmg: 34, headMult: 3, rpm: 380, mag: 12, reserve: 48,
    spreadHip: 0.012, spreadMove: 0.045, spreadAds: 0.002, recoil: 0.007, auto: false, snd: "pistol", zoom: 1.25, tracer: 0xffe1b0 },
  knife: { name: "TACTICAL KNIFE", mode: "MELEE", price: 0, dmg: 55, headMult: 1, rpm: 90, mag: Infinity, reserve: Infinity,
    spreadHip: 0, spreadMove: 0, spreadAds: 0, recoil: 0, auto: false, snd: "knife", zoom: 1, melee: true }
};
const BUY_ITEMS = [
  { id: "vandal", key: "1", name: "VANDAL-X", desc: "Assault rifle. 150 dmg headshot — one-tap. 25-round mag, full-auto.", price: 2900 },
  { id: "spectre", key: "2", name: "SPECTRE-S", desc: "Suppressed SMG. Quiet, fast, accurate on the move. 30-round mag.", price: 1600 },
  { id: "operator", key: "3", name: "OPERATOR-50", desc: "Bolt-action sniper. One hit to head or chest. 4.2x scope.", price: 4700 },
  { id: "armor", key: "4", name: "KEVLAR VEST", desc: "+50 armor. Absorbs half of all incoming damage while it lasts.", price: 1000 },
  { id: "flash", key: "5", name: "FLASHBANG [Q]", desc: "Blinds anyone looking at the detonation. Bounces off walls.", price: 200 },
  { id: "smoke", key: "6", name: "SMOKE GRENADE [E]", desc: "14s smoke wall. Physically blocks enemy line of sight.", price: 300 },
  { id: "frag", key: "7", name: "FRAG GRENADE [G]", desc: "High-explosive. Heavy area damage after a 2.2s fuse.", price: 300 }
];

/* ======================== Weapon viewmodels ========================== */
// ===== Blok 2: buildViewmodel — model senjata first person =====
function buildViewmodel(kind) {
  var gunMat = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.42, metalness: 0.75 });
  var gripMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.8, metalness: 0.3 });
  var accMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, metalness: 0.4 });
  var accBMat = new THREE.MeshStandardMaterial({ color: 0x35c4ff, roughness: 0.5, metalness: 0.4 });

  var group = new THREE.Group();
  var muzzleZ = -0.6;

  function addBox(w, h, d, mat, x, y, z, rotX) {
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    if (rotX) mesh.rotation.x = rotX;
    group.add(mesh);
    return mesh;
  }

  function addCylinder(r, h, mat, x, y, z, segments) {
    var mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }

  if (kind === 'vandal') {
    addBox(0.075, 0.11, 0.52, gunMat, 0, 0, -0.18);
    addBox(0.05, 0.05, 0.3, gunMat, 0, 0.01, -0.55);
    addBox(0.06, 0.16, 0.09, gripMat, 0, -0.12, -0.02, 0.25);
    addBox(0.055, 0.1, 0.07, gripMat, 0, -0.09, 0.14, -0.3);
    addBox(0.02, 0.07, 0.02, accMat, 0, 0.1, -0.42);
    addBox(0.07, 0.05, 0.12, gunMat, 0, 0.1, 0.02);
    addBox(0.078, 0.03, 0.2, accMat, 0, -0.045, -0.3);
    muzzleZ = -0.72;
  } else if (kind === 'spectre') {
    addBox(0.07, 0.1, 0.4, gunMat, 0, 0, -0.1);
    addCylinder(0.035, 0.24, gripMat, 0, 0.005, -0.42, 10);
    addBox(0.055, 0.17, 0.08, gripMat, 0, -0.12, 0, 0.12);
    addBox(0.05, 0.09, 0.06, gripMat, 0, -0.085, 0.13, -0.3);
    addBox(0.06, 0.045, 0.1, accBMat, 0, 0.09, -0.02);
    muzzleZ = -0.55;
  } else if (kind === 'operator') {
    addBox(0.06, 0.09, 0.78, gunMat, 0, 0, -0.3);
    addBox(0.028, 0.028, 0.3, gunMat, 0, 0.015, -0.8);
    addCylinder(0.032, 0.22, gripMat, 0, 0.1, -0.12, 12);
    addBox(0.05, 0.05, 0.05, gunMat, 0, 0.05, -0.12);
    addBox(0.055, 0.15, 0.08, gripMat, 0, -0.11, 0.12, 0.2);
    addBox(0.05, 0.09, 0.16, gripMat, 0, -0.06, 0.3, -0.15);
    addBox(0.062, 0.025, 0.3, accMat, 0, -0.05, -0.45);
    muzzleZ = -0.97;
  } else if (kind === 'pistol') {
    addBox(0.055, 0.08, 0.24, gunMat, 0, 0.02, -0.08);
    addBox(0.05, 0.13, 0.07, gripMat, 0, -0.08, 0.05, -0.25);
    addBox(0.015, 0.04, 0.015, accMat, 0, 0.085, -0.19);
    muzzleZ = -0.22;
  } else {
    var bladeMat = new THREE.MeshStandardMaterial({ color: 0xb9c4cc, roughness: 0.25, metalness: 0.9 });
    var blade = addBox(0.012, 0.045, 0.3, bladeMat, 0, 0.01, -0.22);
    blade.rotation.x = 0.1;
    addBox(0.035, 0.035, 0.13, gripMat, 0, -0.01, 0.02);
    group.rotation.z = -0.25;
  }

  group.userData.muzzleZ = muzzleZ;
  return group;
}

// ===== PLAYER =====
// Gerakan, damage, dan settings pemain.
// Ditulis ulang dari spek perilaku; nama publik dan angka dipertahankan persis.

const Player = {
  pos: new THREE.Vector3(0, 0, 27),
  vel: new THREE.Vector3(0, 0, 0),
  yaw: Math.PI,
  pitch: 0,
  hp: 100,
  armor: 0,
  alive: true,
  crouch: false,
  onGround: true,
  eyeHeight: 1.62,
  credits: 1500,
  primaryId: null,
  util: { flash: 0, smoke: 0, frag: 0 },
  hasBomb: false,
  blindT: 0,
  shake: 0,
  stepT: 0,
  walkCycle: 0,
  recentHitters: {},
  lastAttacker: null,

  speed: function () {
    var base = this.crouch ? 2.4 : 4.6;
    if (keys['ShiftLeft'] || keys['ShiftRight']) { base = 2.6; }
    if (WeaponSystem.current === 'knife') { base *= 1.12; }
    if (WeaponSystem.adsAmt > 0.5) { base *= 0.55; }
    return base;
  },

  reset: function (spawn) {
    this.pos.copy(spawn);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.hp = 100;
    this.alive = true;
    this.crouch = false;
    this.blindT = 0;
    this.shake = 0;
    this.recentHitters = {};
    this.lastAttacker = null;
  },

  damage: function (amount, fromPos, attackerName) {
    if (!this.alive) { return; }
    if (G.phase !== 'live') { return; }
    if (attackerName) {
      this.recentHitters[attackerName] = G.time;
      this.lastAttacker = attackerName;
    }
    if (this.armor > 0) {
      var absorbed = Math.min(this.armor, amount * 0.5);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.hp -= amount;
    HUD.damageFrom(fromPos);
    AudioEngine.hurt();
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(fromPos);
    }
    HUD.updateVitals();
  },

  die: function (killerPos) {
    this.alive = false;
    G.stats.deaths += 1;
    for (var name in this.recentHitters) {
      if (name === this.lastAttacker) { continue; }
      if (G.time - this.recentHitters[name] > 6) { continue; }
      if (G.botStats[name]) { G.botStats[name].assists += 1; }
    }
    document.getElementById('death-overlay').style.display = 'flex';
    if (this.hasBomb) {
      Game.dropBomb(this.pos);
      this.hasBomb = false;
    }
  },

  update: function (dt) {
    if (!this.alive) { return; }
    var f = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    var r = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
    if (typeof TouchInput !== 'undefined' && TouchInput.joyActive) {
      f += -TouchInput.joyY;
      r += TouchInput.joyX;
    }
    var mag = Math.min(1, Math.hypot(f, r));
    var hasInput = mag > 0.06;
    var sinYaw = Math.sin(this.yaw);
    var cosYaw = Math.cos(this.yaw);
    var wishX = -sinYaw * f + cosYaw * r;
    var wishZ = -cosYaw * f - sinYaw * r;
    var wishLen = Math.hypot(wishX, wishZ) || 1;
    var targetSpeed = this.speed() * mag;
    var accel = this.onGround ? 14 : 2.5;
    var blend = Math.min(1, accel * dt) * (hasInput ? 1 : 0.92);
    this.vel.x += ((wishX / wishLen) * targetSpeed - this.vel.x) * blend;
    this.vel.z += ((wishZ / wishLen) * targetSpeed - this.vel.z) * blend;
    if (keys['Space'] && this.onGround && !this.crouch) {
      this.vel.y = 4.6;
      this.onGround = false;
    }
    this.vel.y -= 13.5 * dt;
    this.pos.x += this.vel.x * dt;
    collideMove(this.pos, 0.38, 1.8);
    this.pos.z += this.vel.z * dt;
    collideMove(this.pos, 0.38, 1.8);
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vel.y = 0;
      this.onGround = true;
    }
    this.crouch = !!(keys['ControlLeft'] || keys['ControlRight'] || keys['KeyC']);
    var targetEye = this.crouch ? 1.12 : 1.62;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 11);
    var hSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.moving = hSpeed > 0.6 && this.onGround;
    var moving = this.moving;
    if (moving) {
      this.walkCycle += dt * hSpeed * 1.6;
      this.stepT -= dt;
      var silent = !!(keys['ShiftLeft'] || keys['ShiftRight'] || this.crouch);
      if (this.stepT <= 0) {
        this.stepT = silent ? 0.52 : 0.36;
        AudioEngine.footstep(!silent, 0);
        if (!silent) { Game.emitNoise(this.pos, 9.5, 'step'); }
      }
    }
    if (this.blindT > 0) { this.blindT -= dt; }
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 2.2); }
  },

  eye: function () {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  },

  lookDir: function () {
    var cosPitch = Math.cos(this.pitch);
    return new THREE.Vector3(
      -Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch
    );
  }
};

const keys = {};

const Settings = {
  sens: 1,
  fov: 78,
  mode: 'squad',
  diff: 'veteran',
  side: 'atk',
  startSide: 'atk',

  diffReaction: function () {
    var table = { rookie: 1.7, elite: 0.65 };
    return table[this.diff] || 1;
  },

  diffAccuracy: function () {
    var table = { rookie: 0.68, elite: 1.18 };
    return table[this.diff] || 1;
  }
};

/* =========================== WeaponSystem ============================ */
const WeaponSystem = {
  current: "pistol",
  state: {},           // per-weapon {mag, reserve}
  viewmodels: {},
  group: null, muzzle: null, flashLight: null, flashSprite: null,
  lastShot: 0, reloading: false, reloadEnd: 0, boltEnd: 0,
  recoilPitch: 0, recoilYaw: 0, fovPunch: 0, shotIndex: 0, adsAmt: 0, adsHeld: false,
  swayX: 0, swayY: 0, kickZ: 0, shells: [], tracers: [],
  laserOn: false, laserLine: null, laserDot: null, inspectT: 0,
  init(camera, scene) {
    this.group = new THREE.Group();
    camera.add(this.group);
    for (const id in WEAPONS) {
      const vm = buildViewmodel(id);
      vm.visible = false;
      vm.position.set(0.24, -0.22, -0.45);
      this.viewmodels[id] = vm;
      this.group.add(vm);
      this.state[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    }
    this.flashLight = new THREE.PointLight(0xffb35c, 0, 9, 2);
    scene.add(this.flashLight);
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TextureGenerator.muzzleSprite(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.flashSprite.scale.set(0.55, 0.55, 1);
    scene.add(this.flashSprite);
    // tactical laser sight: line + impact dot, re-aimed every frame at the raycast hit point
    const lgeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.laserLine = new THREE.Line(lgeo, new THREE.LineBasicMaterial({ color: 0x39ff6a, transparent: true, opacity: 0.85 }));
    this.laserLine.visible = false; this.laserLine.frustumCulled = false;
    scene.add(this.laserLine);
    this.laserDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: TextureGenerator.muzzleSprite(), color: 0x39ff6a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.laserDot.scale.set(0.09, 0.09, 1); this.laserDot.visible = false;
    scene.add(this.laserDot);
    this.equip("pistol");
  },
  equip(id) {
    if (!WEAPONS[id] || this.reloading) return;
    if (id === "primary-slot") id = Player.primaryId || "pistol";
    for (const k in this.viewmodels) this.viewmodels[k].visible = (k === id);
    this.current = id;
    this.adsAmt = 0;
    this.inspectT = 0;
    HUD.updateWeapon();
    AudioEngine.click(500, 0.05, 0.12);
  },
  def() { return WEAPONS[this.current]; },
  st() { return this.state[this.current]; },
  currentSpread() {
    const d = this.def();
    if (d.melee) return 0;
    const hSpeed = Math.hypot(Player.vel.x, Player.vel.z);
    let s = d.spreadHip;
    const moveFrac = Math.min(1, hSpeed / 4.6);
    s += (d.spreadMove - d.spreadHip) * moveFrac;
    if (!Player.onGround) s += 0.055;
    if (Player.crouch) s *= 0.55;
    s = s * (1 - this.adsAmt * 0.92) + d.spreadAds * this.adsAmt;
    s += Math.min(0.02, this.shotIndex * 0.0016) * (1 - this.adsAmt * 0.7);
    return s;
  },
  tryFire(now) {
    const d = this.def(), st = this.st();
    if (this.reloading || now < this.boltEnd || !Player.alive || G.phase !== "live") return;
    if (d.melee) {
      if (now - this.lastShot < 60 / d.rpm * 1000) return;
      this.lastShot = now;
      this.kickZ = 0.16;
      AudioEngine.throwWhoosh();
      const eye = Player.eye(), dir = Player.lookDir();
      const hit = Game.raycastShoot(eye, dir, 1.7, "player");
      if (hit && hit.bot) Game.applyDamage(hit.bot, d.dmg, false, "YOU", "knife");
      return;
    }
    if (st.mag <= 0) { AudioEngine.dryFire(); this.lastShot = now; this.startReload(); return; }
    if (now - this.lastShot < 60 / d.rpm * 1000) return;
    this.lastShot = now;
    st.mag--;
    this.shotIndex++;
    // direction with spread
    const spread = this.currentSpread();
    const dir = Player.lookDir();
    dir.x += (Math.random() - 0.5) * 2 * spread;
    dir.y += (Math.random() - 0.5) * 2 * spread;
    dir.z += (Math.random() - 0.5) * 2 * spread;
    dir.normalize();
    const eye = Player.eye();
    const hit = Game.raycastShoot(eye, dir, 120, "player");
    const end = hit ? hit.point : eye.clone().add(dir.clone().multiplyScalar(120));
    // recoil: vertical then horizontal pattern
    const pattern = [0, 0.1, -0.12, 0.16, -0.2, 0.14, -0.1, 0.22, -0.18, 0.1];
    const hKick = pattern[Math.min(this.shotIndex - 1, pattern.length - 1)] * d.recoil * 2.4;
    // visual recoil only: the kick lives in recoilPitch/recoilYaw + fovPunch,
    // is applied to the camera in animate(), and recovers in update() — the
    // player's aim point (Player.pitch/yaw) is never permanently moved
    this.recoilPitch += d.recoil * (d.sniper ? 3.4 : 1.35);
    this.recoilYaw += hKick * 1.6;
    this.fovPunch = Math.min(2.8, this.fovPunch + (d.sniper ? 2.4 : 0.5));
    this.kickZ = Math.min(0.14, this.kickZ + 0.05 + d.recoil);
    Player.shake = Math.min(0.6, Player.shake + (d.sniper ? 0.3 : 0.06)); // camera micro-shake per shot
    this.inspectT = 0;
    // muzzle world position
    const muzzlePos = this.muzzleWorld();
    this.spawnTracer(muzzlePos, end, d.tracer);
    this.spawnShell();
    if (!d.suppressed) {
      this.flashLight.position.copy(muzzlePos);
      this.flashLight.intensity = 2.6;
      this.flashSprite.position.copy(muzzlePos);
      this.flashSprite.material.opacity = 0.95;
      this.flashSprite.material.rotation = Math.random() * 6.28;
    } else {
      this.flashSprite.position.copy(muzzlePos);
      this.flashSprite.material.opacity = 0.25;
      this.flashSprite.scale.set(0.25, 0.25, 1);
    }
    AudioEngine.shot(d.snd === "rifle" ? "rifle" : d.snd, 0);
    Game.emitNoise(Player.pos, d.suppressed ? 6 : 42, "shot");
    if (hit && hit.bot) {
      const dmg = hit.part === "head" ? d.dmg * d.headMult : d.dmg;
      Game.applyDamage(hit.bot, dmg, hit.part === "head", "YOU", this.current);
    } else if (hit) {
      Game.spawnImpact(hit.point, hit.normal);
    }
    HUD.updateWeapon();
    if (st.mag === 0) this.startReload();
  },
  muzzleWorld() {
    const vm = this.viewmodels[this.current];
    const local = new THREE.Vector3(0, 0.02, vm.userData.muzzleZ || -0.6);
    vm.updateWorldMatrix(true, false);
    return vm.localToWorld(local.clone());
  },
  toggleLaser() {
    this.laserOn = !this.laserOn;
    AudioEngine.click(this.laserOn ? 1500 : 900, 0.05, 0.12);
    if (!this.laserOn && this.laserLine) { this.laserLine.visible = false; this.laserDot.visible = false; }
  },
  startInspect() {
    if (this.reloading || this.def().melee || this.inspectT > 0 || !Player.alive) return;
    this.inspectT = 1.7;
    AudioEngine.click(650, 0.05, 0.1);
  },
  clearFx() {
    for (const s of this.shells) scene.remove(s.m);
    this.shells = [];
    for (const t of this.tracers) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); }
    this.tracers = [];
    if (this.laserLine) this.laserLine.visible = false;
    if (this.laserDot) this.laserDot.visible = false;
  },
  startReload() {
    const d = this.def(), st = this.st();
    if (d.melee || this.reloading || st.mag >= d.mag || st.reserve <= 0) return;
    this.reloading = true;
    this.reloadEnd = performance.now() + (d.sniper ? 2600 : 2100);
    AudioEngine.reload(0);
    setTimeout(() => AudioEngine.reload(1), 700);
    setTimeout(() => AudioEngine.reload(2), 1400);
    HUD.setReloadHint("RELOADING…");
  },
  finishReload() {
    const d = this.def(), st = this.st();
    const need = d.mag - st.mag, take = Math.min(need, st.reserve);
    st.mag += take; st.reserve -= take;
    this.reloading = false;
    HUD.setReloadHint("");
    HUD.updateWeapon();
  },
  spawnTracer(a, b, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color: color || 0xffd9a0, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    this.tracers.push({ line, until: performance.now() + 55 });
  },
  spawnShell() {
    const m = new THREE.Mesh(shellGeo, shellMat);
    const p = this.muzzleWorld(); p.y -= 0.06; p.x += 0.05;
    m.position.copy(p);
    scene.add(m);
    this.shells.push({ m, vx: (Math.random() - 0.2) * 1.4, vy: 1.6 + Math.random(), vz: (Math.random() - 0.5), life: 0.9, rot: Math.random() * 9 });
  },
  update(dt, now) {
    // fire input
    if (mouseDown && Player.alive && G.phase === "live" && inputActive()) {
      if (this.def().auto || !this._semiLatch) { this.tryFire(now); this._semiLatch = true; }
    }
    if (!mouseDown) { this._semiLatch = false; this.shotIndex = Math.max(0, this.shotIndex - dt * 14); }
    if (this.reloading && now >= this.reloadEnd) this.finishReload();
    // ADS
    const targetAds = (this.adsHeld && Player.alive && !this.def().melee) ? 1 : 0;
    this.adsAmt += (targetAds - this.adsAmt) * Math.min(1, dt * 13);
    const d = this.def();
    const targetFov = Settings.fov / (1 + (d.zoom - 1) * this.adsAmt) + this.fovPunch;
    if (Math.abs(camera.fov - targetFov) > 0.1) { camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix(); }
    document.getElementById("scope-overlay").style.display = (d.sniper && this.adsAmt > 0.75) ? "block" : "none";
    document.getElementById("crosshair").style.opacity = (d.sniper && this.adsAmt > 0.75) ? "0" : "1";
    // viewmodel position: hip -> ADS center, plus sway & bob
    const vm = this.viewmodels[this.current];
    const bobA = Player.moving ? Math.min(1, Math.hypot(Player.vel.x, Player.vel.z) / 4.6) : 0;
    const bobY = Math.sin(Player.walkCycle * 2) * 0.011 * bobA;
    const bobX = Math.cos(Player.walkCycle) * 0.008 * bobA;
    this.swayX += ((mouseDX * -0.0016) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += ((mouseDY * 0.0016) - this.swayY) * Math.min(1, dt * 10);
    this.kickZ = Math.max(0, this.kickZ - dt * 0.55);
    const hip = { x: 0.24, y: -0.22, z: -0.45 }, ads = { x: 0, y: -0.148, z: -0.35 };
    if (d.sniper && this.adsAmt > 0.75) vm.visible = false; else if (!this.viewmodels[this.current].visible) vm.visible = true;
    // weapon inspect envelope: present & tilt the model, then settle back
    let insEnv = 0;
    if (this.inspectT > 0) { this.inspectT -= dt; insEnv = Math.sin(Math.min(1, Math.max(0, 1 - this.inspectT / 1.7)) * Math.PI); }
    vm.position.set(
      hip.x + (ads.x - hip.x) * this.adsAmt + this.swayX + bobX - insEnv * 0.13,
      hip.y + (ads.y - hip.y) * this.adsAmt + this.swayY + bobY - (this.reloading ? 0.09 : 0) + insEnv * 0.05,
      hip.z + (ads.z - hip.z) * this.adsAmt + this.kickZ + insEnv * 0.06);
    vm.rotation.x = (this.reloading ? -0.5 : 0) + this.kickZ * 0.9 + insEnv * 0.38;
    vm.rotation.y = insEnv * -1.15;
    vm.rotation.z = (this.current === "knife" ? -0.25 : 0) + insEnv * 0.3;
    // laser sight: from the barrel to the exact raycast hit point
    const laserActive = this.laserOn && Player.alive && G.phase === "live" && !d.melee;
    this.laserLine.visible = laserActive; this.laserDot.visible = laserActive;
    if (laserActive) {
      const eye = Player.eye(), dir = Player.lookDir();
      const hit = Game.raycastShoot(eye, dir, 120, "player");
      const endP = hit ? hit.point : eye.clone().add(dir.clone().multiplyScalar(120));
      const posAttr = this.laserLine.geometry.attributes.position;
      const mp = this.muzzleWorld();
      posAttr.setXYZ(0, mp.x, mp.y, mp.z);
      posAttr.setXYZ(1, endP.x, endP.y, endP.z);
      posAttr.needsUpdate = true;
      this.laserDot.position.copy(endP);
    }
    // camera recoil recovery: while the trigger is held the kick mostly holds
    // (fresh kicks keep stacking); once firing stops it settles smoothly back
    // to the player's aim point
    const sinceShot = now - this.lastShot;
    const recF = Math.exp(-(sinceShot < 110 ? 2.0 : 9.0) * dt);
    this.recoilPitch *= recF; this.recoilYaw *= recF;
    if (Math.abs(this.recoilPitch) < 0.0004) this.recoilPitch = 0;
    if (Math.abs(this.recoilYaw) < 0.0004) this.recoilYaw = 0;
    this.fovPunch *= Math.exp(-10 * dt);
    if (this.fovPunch < 0.01) this.fovPunch = 0;
    // muzzle flash decay
    this.flashLight.intensity *= Math.pow(0.000001, dt * 3);
    if (this.flashSprite.material.opacity > 0) this.flashSprite.material.opacity = Math.max(0, this.flashSprite.material.opacity - dt * 14);
    // shells
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.vy -= 9.8 * dt; s.life -= dt;
      s.m.position.x += s.vx * dt; s.m.position.y += s.vy * dt; s.m.position.z += s.vz * dt;
      if (s.m.position.y < 0.02) { s.m.position.y = 0.02; s.vy = Math.abs(s.vy) > 0.7 ? -s.vy * 0.35 : 0; s.vx *= 0.6; s.vz *= 0.6; }
      s.m.rotation.x += s.rot * dt; s.m.rotation.z += s.rot * 0.7 * dt;
      if (s.life <= 0) { scene.remove(s.m); this.shells.splice(i, 1); }
    }
    // tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      if (now > this.tracers[i].until) {
        scene.remove(this.tracers[i].line);
        this.tracers[i].line.geometry.dispose(); this.tracers[i].line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    HUD.updateCrosshair(this.currentSpread());
  }
};
let mouseDown = false, mouseDX = 0, mouseDY = 0;
const shellGeo = new THREE.BoxGeometry(0.012, 0.012, 0.03);
const shellMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.3, metalness: 0.9 });
const impactGeo = new THREE.SphereGeometry(0.035, 6, 5);
const sparkGeo = new THREE.BoxGeometry(0.02, 0.02, 0.09);
const holeGeo = new THREE.PlaneGeometry(0.11, 0.11);
const holeMat = new THREE.MeshBasicMaterial({ map: TextureGenerator.bulletHole(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

/* ================================ Bots =============================== */
/* Wall avoidance: ONE shared raycaster with 3 whisker sensors (front 0°,
   left -35°, right +35° at chest height y + 0.9, 1.65u range) raycast
   against wallMeshes — the same meshes bullets use, so steering matches
   the visual geometry exactly. Called from Bot.stepToward before the
   bot's position is moved. */
const botNavRaycaster = new THREE.Raycaster();
const _whiskerOrigin = new THREE.Vector3();
const _whiskerDir = new THREE.Vector3();
function whiskerClearance(bot, angleOffset) {
  const y = bot.yaw + angleOffset;
  _whiskerDir.set(-Math.sin(y), 0, -Math.cos(y));
  _whiskerOrigin.set(bot.pos.x, bot.pos.y + 0.9, bot.pos.z);
  botNavRaycaster.set(_whiskerOrigin, _whiskerDir);
  botNavRaycaster.near = 0; botNavRaycaster.far = 1.65;
  const hits = botNavRaycaster.intersectObjects(wallMeshes, false);
  return hits.length ? hits[0].distance : 1.65;
}
function steerBotAroundWalls(bot, dx, dz) {
  if (!wallMeshes.length) return { x: dx, z: dz };
  if (whiskerClearance(bot, 0) >= 1.65) return { x: dx, z: dz };
  // front sensor is blocked: veer toward whichever side sensor sees further
  const left = whiskerClearance(bot, -35 * Math.PI / 180);
  const right = whiskerClearance(bot, 35 * Math.PI / 180);
  const off = (left >= right ? -1 : 1) * (55 * Math.PI / 180);
  const hy = Math.atan2(-dx, -dz) + off;
  let sx = -Math.sin(hy) * 0.65 + dx * 0.35;
  let sz = -Math.cos(hy) * 0.65 + dz * 0.35;
  const l = Math.hypot(sx, sz) || 1;
  return { x: sx / l, z: sz / l };
}
let botIdSeq = 0;
class Bot {
  constructor(name, team, spawn, role) {
    this.id = botIdSeq++;
    this.name = name; this.team = team; this.role = role; // role: 'A' | 'B' | 'mid' | 'push'
    if (!G.botStats[name]) G.botStats[name] = { team, kills: 0, deaths: 0, assists: 0, hits: 0, headshots: 0, damage: 0, plants: 0, defuses: 0 };
    this.recentHitters = {}; // attackerName -> G.time, for assist credit on death
    this.pos = spawn.clone(); this.vel = new THREE.Vector3();
    this.yaw = team === "atk" ? Math.PI : 0;
    this.hp = 100; this.armor = 0; this.alive = true;
    this.mesh = buildCharacterMesh(team);
    this.mesh.position.copy(this.pos);
    this.mesh.traverse(o => { o.userData.botRef = this; });
    scene.add(this.mesh);
    this.weaponId = Math.random() < 0.6 ? "vandal" : "spectre";
    this.state = "HOLD_ANGLE";
    this.path = []; this.pathIdx = 0; this.targetPos = null;
    this.repathT = 0; this.thinkT = Math.random() * 0.15;
    this.seeT = 0; this.lastSeenPos = null; this.lastSeenT = -99;
    this.investigatePos = null; this.investigateT = -99;
    this.reactionT = 0; this.burstLeft = 0; this.burstWait = 0; this.nextShotT = 0;
    this.strafeDir = 1; this.strafeT = 0; this.blindT = 0;
    this.channelT = 0; this.holdPos = null; this.patrolT = 0;
    this.stepT = 0; this.walkPhase = Math.random() * 6;
    this.kills = 0; this.roundKills = 0; this.spottedT = 0;
    this.crouching = false;
    // anti-stuck: position sampled every 0.45s while the bot is trying to move
    this.stuckPos = spawn.clone(); this.stuckTimer = 0; this.stuckCount = 0;
    this.evadeT = 0; this.evadeDir = 1; this.onGround = true;
  }
  eye() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.55, this.pos.z); }
  chest() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.15, this.pos.z); }
  headPos() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.62, this.pos.z); }
  damage(amount, head, attackerName, weaponId) {
    if (!this.alive || G.phase !== "live") return;
    if (attackerName) this.recentHitters[attackerName] = G.time;
    let dmg = amount;
    if (this.armor > 0) { const ab = Math.min(this.armor, dmg * 0.5); this.armor -= ab; dmg -= ab; }
    this.hp -= dmg;
    if (attackerName === "YOU") {
      HUD.showHitmarker(head, this.hp <= 0);
      G.stats.damage += dmg; G.stats.hits++; if (head) G.stats.headshots++;
    } else {
      const rec = G.botStats[attackerName];
      if (rec) { rec.damage += dmg; rec.hits++; if (head) rec.headshots++; }
    }
    if (this.hp <= 0) { this.die(attackerName, head, weaponId); }
    else if (this.state !== "ENGAGE_COVER") {
      // getting shot: turn toward attacker roughly & engage
      this.lastSeenT = G.time; this.state = "ENGAGE_COVER";
    }
  }
  die(attackerName, head, weaponId) {
    this.alive = false; this.hp = 0;
    const rec = G.botStats[this.name]; if (rec) rec.deaths++;
    // assists: anyone else who damaged this bot in the last 6s shares the play
    for (const n in this.recentHitters) {
      if (n === attackerName || G.time - this.recentHitters[n] > 6) continue;
      if (n === "YOU") G.stats.assists++;
      else { const arec = G.botStats[n]; if (arec) arec.assists++; }
    }
    if (attackerName === "YOU") { G.stats.kills++; HUD.killConfirm(this.name, head); }
    else { const arec = G.botStats[attackerName]; if (arec) arec.kills++; }
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.25;
    Game.onKill(attackerName, this, head, weaponId);
  }
  setPathTo(x, z) {
    this.path = MapBuilder.findPath(this.pos.x, this.pos.z, x, z);
    this.pathIdx = 0;
    this.targetPos = { x, z };
  }
  moveAlong(dt, speedMul) {
    if (this.pathIdx >= this.path.length) {
      // final approach to exact target
      if (this.targetPos) {
        const dx = this.targetPos.x - this.pos.x, dz = this.targetPos.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.4) { this.stepToward(dx / d, dz / d, dt, speedMul); return true; }
      }
      return false;
    }
    const node = navNodes[this.path[this.pathIdx]];
    const dx = node.x - this.pos.x, dz = node.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.8) { this.pathIdx++; return this.moveAlong(dt, speedMul); }
    this.stepToward(dx / d, dz / d, dt, speedMul);
    return true;
  }
  stepToward(dx, dz, dt, speedMul) {
    const steered = steerBotAroundWalls(this, dx, dz);
    dx = steered.x; dz = steered.z;
    const sp = 3.9 * (speedMul || 1);
    this.pos.x += dx * sp * dt;
    this.pos.z += dz * sp * dt;
    const targetYaw = Math.atan2(-dx, -dz);
    this.yaw = turnToward(this.yaw, targetYaw, dt * 7);
    collideMove(this.pos, 0.38, 1.8);
    this.walkPhase += dt * 7;
    this.stepT -= dt;
    if (this.stepT <= 0) { this.stepT = 0.38; AudioEngine.footstep(true, this.pos.distanceTo(Player.pos)); Game.emitNoise(this.pos, 8, "step", this); }
  }
  faceToward(x, z, dt, rate) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    this.yaw = turnToward(this.yaw, Math.atan2(-dx, -dz), dt * (rate || 5));
  }
  syncMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    if (this.alive) {
      const p = this.mesh.userData.parts;
      const sw = Math.sin(this.walkPhase) * 0.4;
      const moving = this.pathIdx < this.path.length || this.state === "ENGAGE_COVER";
      p.legL.rotation.x = moving ? sw : 0;
      p.legR.rotation.x = moving ? -sw : 0;
      const targetY = this.crouching ? -0.35 : 0;
      this.mesh.position.y = this.pos.y + targetY * 0.6;
      p.torso.position.y = 1.11 + targetY;
      p.head.position.y = 1.62 + targetY;
    }
  }
}
function turnToward(cur, target, maxStep) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

/* Attacker Spike priority (adapted to this build's state: G.bombPlanted,
   G.bombCarrierBot, Player.hasBomb, G.bombDropped, sites[G.targetSite]):
   1) Spike dropped on the ground -> the closest alive attacker is sent to
      pick it up (everyone else keeps their normal hunt/patrol logic).
   2) This bot carries the Spike -> straight to the target site to plant.
   Returns null to continue normal hunt/patrol logic. */
function getAttackerObjective(bot) {
  // 1. If the Spike is dropped on the ground (not held by anyone and not planted)
  if (!G.bombPlanted && !G.bombCarrierBot && !Player.hasBomb && G.bombDropped) {
    // Find the alive attacker closest to the dropped Spike
    let closestBot = null;
    let minDist = Infinity;
    for (const mate of Game.bots) {
      if (!mate.alive || mate.team !== "atk") continue;
      const d = mate.pos.distanceTo(G.bombDropped);
      if (d < minDist) {
        minDist = d;
        closestBot = mate;
      }
    }
    // Force the closest bot to walk to the dropped Spike point (ignore normal patrol)
    if (closestBot === bot) {
      return { action: "PICKUP_SPIKE", targetPos: G.bombDropped };
    }
  }

  // 2. If this bot is carrying the Spike -> go straight to the target Site and plant
  if (!G.bombPlanted && G.bombCarrierBot === bot) {
    const s = sites[G.targetSite];
    const targetPos = new THREE.Vector3(s.x, 0, s.z);
    const distToSite = bot.pos.distanceTo(targetPos);
    if (distToSite < 2.2) {
      return { action: "PLANT_SPIKE", targetPos };
    }
    return { action: "GO_SITE", targetPos };
  }

  return null; // Continue to normal hunt/patrol logic
}

/* Separation steering so same-team bots do not bunch up or block each
   other in corridors (called once per bot per tick from BotAI.update). */
function applyBotSeparation(bot, allBots, dt) {
  const minSpace = 1.4;
  let pushX = 0;
  let pushZ = 0;

  for (const other of allBots) {
    if (other === bot || !other.alive || other.team !== bot.team) continue;
    const dx = bot.pos.x - other.pos.x;
    const dz = bot.pos.z - other.pos.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.001 && dist < minSpace) {
      const strength = (minSpace - dist) / minSpace;
      pushX += (dx / dist) * strength;
      pushZ += (dz / dist) * strength;
    }
  }

  bot.pos.x += pushX * 3.2 * dt;
  bot.pos.z += pushZ * 3.2 * dt;
}

// BotAI — kecerdasan bot FPS (mesin state).
// Ditulis ulang dari spek perilaku: perceive, update, doHold, doPatrol,
// assignObjective, doChannel, doEngage, fireBot, plus dtSafe.
var BotAI = {
  // Jarak 3D antara dua titik {x, y, z}.
  _dist: function (a, b) {
    var dx = a.x - b.x;
    var dy = (a.y || 0) - (b.y || 0);
    var dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  },

  // Salinan posisi (hindari alias ke objek posisi orang lain).
  _copyPos: function (p) {
    return { x: p.x, y: p.y, z: p.z };
  },

  // Titik mata bot: posisi + 1.3 ke atas.
  _eye: function (bot) {
    return { x: bot.pos.x, y: bot.pos.y + 1.3, z: bot.pos.z };
  },

  // Titik dada sebuah entitas (pemain atau bot lain).
  _chestOf: function (ent) {
    if (typeof ent.chest === 'function') return ent.chest();
    if (ent.chest) return ent.chest;
    return { x: ent.pos.x, y: ent.pos.y + 1.15, z: ent.pos.z };
  },

  // Arah hadap bot di bidang datar, dari yaw-nya.
  _forward: function (bot) {
    var yaw = bot.yaw || 0;
    return { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
  },

  // Vektor kanan dari sebuah arah hadap datar.
  _rightOf: function (fwd) {
    return { x: -fwd.z, y: 0, z: fwd.x };
  },

  // Kecepatan pemain (magnitudo vektor vel, 0 bila tidak ada).
  _playerSpeed: function () {
    if (!Player.vel) return 0;
    var v = Player.vel;
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  },

  // Apakah ada bot lain yang sedang membawa bom (tim penyerang).
  _botCarrierExists: function () {
    var i, b;
    for (i = 0; i < Game.bots.length; i++) {
      b = Game.bots[i];
      if (b.team === 'atk' && b.carriesBomb) return true;
    }
    return false;
  },

  // Kumpulkan penyerang hidup (pemain bila atk + semua bot atk).
  _liveAttackers: function () {
    var out = [];
    var i, b;
    if (Player.alive && Settings.side === 'atk') out.push(Player);
    for (i = 0; i < Game.bots.length; i++) {
      b = Game.bots[i];
      if (b.team === 'atk' && b.alive) out.push(b);
    }
    return out;
  },

  // Cari simpul nav cover terdekat dari bot, atau null.
  _nearestCoverNode: function (bot) {
    var best = null;
    var bestD = Infinity;
    var i, n, d;
    for (i = 0; i < navNodes.length; i++) {
      n = navNodes[i];
      if (!n.cover) continue;
      d = this._dist(bot.pos, n);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  },

  // Pilih simpul nav acak yang cocok dengan role bot untuk patroli.
  _pickPatrolNode: function (bot) {
    var pool = [];
    var i, n, ok;
    for (i = 0; i < navNodes.length; i++) {
      n = navNodes[i];
      ok = false;
      if (bot.role === 'A') {
        ok = n.site === 'A' || (n.x < -6 && n.z < -6 && n.z > -14);
      } else if (bot.role === 'B') {
        ok = n.site === 'B' || (n.x > 6 && n.z < -6 && n.z > -14);
      } else {
        ok = n.z < 2 && n.z > -16;
      }
      if (ok) pool.push(n);
    }
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  },

  // Lihat sekeliling: kembalikan musuh yang terlihat (Player / bot) atau null.
  perceive: function (bot, dt) {
    if (bot.blindT > 0) {
      bot.blindT -= dt;
      return null;
    }
    var eye = this._eye(bot);
    var best = null;
    var bestD = 40;
    var cands = [];
    var i, b, cand, d, fwd, to, len, dot;
    if (bot.team !== Settings.side && Player.alive) {
      cands.push({
        ref: Player,
        pos: Player.pos,
        chest: { x: Player.pos.x, y: Player.pos.y + 1.15, z: Player.pos.z },
        isPlayer: true
      });
    }
    for (i = 0; i < Game.bots.length; i++) {
      b = Game.bots[i];
      if (b === bot) continue;
      if (b.team === bot.team) continue;
      if (!b.alive) continue;
      cands.push({ ref: b, pos: b.pos, chest: this._chestOf(b), isPlayer: false });
    }
    fwd = this._forward(bot);
    for (i = 0; i < cands.length; i++) {
      cand = cands[i];
      d = this._dist(eye, cand.chest);
      if (d > bestD) continue;
      to = { x: cand.chest.x - eye.x, y: cand.chest.y - eye.y, z: cand.chest.z - eye.z };
      len = Math.sqrt(to.x * to.x + to.y * to.y + to.z * to.z) || 1;
      dot = (fwd.x * to.x + fwd.y * to.y + fwd.z * to.z) / len;
      if (d > 3.5 && dot < 0.42) continue;
      if (losBlocked(eye, cand.chest)) continue;
      best = cand;
      bestD = d;
    }
    if (!best) return null;
    bot.lastSeenPos = this._copyPos(best.pos);
    bot.lastSeenT = G.time;
    bot.lastSeenWho = best.ref;
    if (best.isPlayer) {
      G.playerSpottedT = 1.2;
    } else {
      best.ref.spottedT = 1.6;
    }
    return best.ref;
  },

  // Tick utama bot: anti-macet, fisika, persepsi, dan dispatch state.
  update: function (bot, dt) {
    if (!bot.alive) return;
    bot.thinkT -= dt;

    // --- Anti macet ---
    var wantsMove = (bot.path && bot.path.length > 0) ||
      bot.state === 'FLANK' ||
      bot.state === 'INVESTIGATE_SOUND' ||
      bot.state === 'PATROL_SITE' ||
      bot.evadeT > 0;
    bot.stuckTimer += dt;
    if (bot.stuckTimer >= 0.45) {
      if (!bot.stuckPos) bot.stuckPos = this._copyPos(bot.pos);
      var moved = this._dist(bot.pos, bot.stuckPos);
      if (wantsMove && moved < 0.35 && bot.state !== 'PLANT_OR_DEFUSE') {
        if (bot.stuckCount >= 1) bot.evadeDir = -bot.evadeDir;
        bot.stuckCount += 1;
        bot.evadeT = 0.9;
        if (bot.onGround) {
          bot.vel.y = 6.5;
          bot.onGround = false;
        }
        if (bot.targetPos) bot.setPathTo(bot.targetPos.x, bot.targetPos.z);
      }
      if (moved >= 0.35) bot.stuckCount = 0;
      bot.stuckPos = this._copyPos(bot.pos);
      bot.stuckTimer = 0;
    }

    // --- Gerak menghindar (evade) ---
    if (bot.evadeT > 0) {
      bot.evadeT -= dt;
      var fwd = this._forward(bot);
      var side = this._rightOf(fwd);
      var step = 3.4 * dt;
      bot.pos.x += (side.x * 0.85 * bot.evadeDir + fwd.x * -0.15) * step;
      bot.pos.z += (side.z * 0.85 * bot.evadeDir + fwd.z * -0.15) * step;
      collideMove(bot.pos, 0.38, 1.8);
    }

    // --- Fisika vertikal ---
    if (!bot.onGround || bot.vel.y !== 0) {
      bot.vel.y -= 16 * dt;
      bot.pos.y += bot.vel.y * dt;
      if (bot.pos.y <= 0) {
        bot.pos.y = 0;
        bot.vel.y = 0;
        bot.onGround = true;
      }
    }

    // --- Persepsi + transisi ke ENGAGE_COVER ---
    var vis = this.perceive(bot, dt);
    if (vis && bot.state !== 'ENGAGE_COVER' && bot.state !== 'PLANT_OR_DEFUSE') {
      bot.state = 'ENGAGE_COVER';
      bot.reactionT = (0.22 + Math.random() * 0.2) * Settings.diffReaction();
    }

    // --- Dispatch state ---
    if (bot.state === 'ENGAGE_COVER') {
      this.doEngage(bot, dt, vis);
    } else if (bot.state === 'PLANT_OR_DEFUSE') {
      this.doChannel(bot, dt);
    } else if (bot.state === 'INVESTIGATE_SOUND') {
      if (!bot.investigatePos || G.time - bot.investigateT > 6) {
        bot.state = bot.team === 'def' ? 'HOLD_ANGLE' : 'PATROL_SITE';
        return;
      }
      if (!bot.moveAlong(dt, 1)) {
        bot.state = 'HOLD_ANGLE';
        bot.patrolT = 2;
      }
      if (bot.lastSeenPos) bot.faceToward(bot.investigatePos.x, bot.investigatePos.z, dt, 2);
    } else if (bot.state === 'HOLD_ANGLE') {
      this.doHold(bot, dt);
    } else if (bot.state === 'PATROL_SITE') {
      this.doPatrol(bot, dt);
    } else if (bot.state === 'FLANK') {
      if (!bot.moveAlong(dt, 1)) bot.state = 'HOLD_ANGLE';
    } else {
      bot.state = 'HOLD_ANGLE';
    }

    // --- Separasi, tabrakan, sinkron mesh ---
    applyBotSeparation(bot, Game.bots, dt);
    collideMove(bot.pos, 0.38, 1.8);
    bot.syncMesh();
  },

  // Tahan sudut: jaga bom / tunggu lalu patroli.
  doHold: function (bot, dt) {
    bot.patrolT -= dt;
    if (bot.team === 'atk' && G.bombPlanted) {
      var gx = G.bombPos.x + (0 - G.bombPos.x) * 0.45;
      var gz = G.bombPos.z + (-30 - G.bombPos.z) * 0.45;
      bot.faceToward(gx, gz, dt, 1.6);
      return;
    }
    if (bot.team === 'atk') {
      bot.state = 'PATROL_SITE';
      return;
    }
    if (G.bombPlanted) {
      this.assignObjective(bot);
      return;
    }
    if (bot.patrolT <= 0) {
      bot.patrolT = 5 + Math.random() * 5;
      bot.state = 'PATROL_SITE';
    }
    var aim;
    if (bot.role === 'A') {
      aim = { x: sites.A.x, y: 0, z: sites.A.z + 14 };
    } else if (bot.role === 'B') {
      aim = { x: sites.B.x, y: 0, z: sites.B.z + 14 };
    } else {
      aim = { x: 0, y: 0, z: 4 + 14 };
    }
    bot.faceToward(aim.x, aim.z, dt, 1.2);
  },

  // Patroli simpul nav sesuai role.
  doPatrol: function (bot, dt) {
    if (G.bombPlanted ||
      (bot.team === 'atk' && !G.bombCarrierBot && !Player.hasBomb && !G.bombDropped)) {
      this.assignObjective(bot);
      return;
    }
    if (bot.team === 'atk') {
      this.assignObjective(bot);
      return;
    }
    if (!bot.holdPos || !bot.moveAlong(dt, 1)) {
      var node = this._pickPatrolNode(bot);
      if (!node) return;
      bot.holdPos = node;
      bot.setPathTo(node.x, node.z);
      bot.patrolT = 3 + Math.random() * 3;
    }
    if (bot.patrolT > 0) {
      bot.patrolT -= dt;
      if (bot.patrolT <= 0) bot.state = 'HOLD_ANGLE';
    }
  },

  // Tentukan objektif bot berdasarkan tim dan status bom.
  assignObjective: function (bot) {
    var i, b;
    if (bot.team === 'atk') {
      if (G.bombPlanted) {
        var angle = (bot.id % 6) * Math.PI * 2 / 6 + 0.6;
        var guard = {
          x: G.bombPos.x + Math.cos(angle) * 4.6,
          y: 0,
          z: G.bombPos.z + Math.sin(angle) * 4.6
        };
        if (this._dist(bot.pos, guard) > 1.3) {
          if (!bot.targetPos || this._dist(bot.targetPos, guard) > 1.5) bot.setPathTo(guard.x, guard.z);
          bot.state = 'FLANK';
          bot.moveAlong(dtSafe, 1);
        } else {
          bot.state = 'HOLD_ANGLE';
        }
        return;
      }
      var obj = getAttackerObjective(bot);
      if (obj) {
        if (obj.action === 'PLANT_SPIKE') {
          bot.state = 'PLANT_OR_DEFUSE';
          bot.channelT = 0;
          return;
        }
        var repath = obj.action === 'PICKUP_SPIKE' ? 1.5 : 2;
        if (!bot.targetPos || this._dist(bot.targetPos, obj.targetPos) > repath) bot.setPathTo(obj.targetPos.x, obj.targetPos.z);
        bot.state = 'FLANK';
        bot.moveAlong(dtSafe, 1);
        if (obj.action === 'PICKUP_SPIKE' && G.bombDropped &&
          this._dist(bot.pos, G.bombDropped) < 1.3) {
          Game.pickupBomb(bot);
        }
        return;
      }
      var site = sites[G.targetSite];
      if (this._dist(bot.pos, site) > 7) {
        if (!bot.targetPos || this._dist(bot.targetPos, site) > 3) {
          bot.setPathTo(site.x + (Math.random() - 0.5) * 6, site.z + (Math.random() - 0.5) * 6);
        }
        bot.state = 'FLANK';
        bot.moveAlong(dtSafe, 1);
      } else {
        bot.state = 'HOLD_ANGLE';
      }
      return;
    }

    // Tim def.
    if (G.bombPlanted) {
      var bombPos = G.bombPos;
      var dBomb = this._dist(bot.pos, bombPos);
      var otherChannel = false;
      for (i = 0; i < Game.bots.length; i++) {
        b = Game.bots[i];
        if (b !== bot && b.team === 'def' && b.state === 'PLANT_OR_DEFUSE') otherChannel = true;
      }
      var threat = null;
      var threatD = Infinity;
      var attackers = this._liveAttackers();
      var bombEye = { x: bombPos.x, y: bombPos.y + 1.3, z: bombPos.z };
      var a, aPos, ad;
      for (i = 0; i < attackers.length; i++) {
        a = attackers[i];
        aPos = { x: a.pos.x, y: a.pos.y + 1.3, z: a.pos.z };
        ad = this._dist(a.pos, bombPos);
        if (ad < 11 && ad < threatD && !losBlocked(aPos, bombEye)) {
          threat = a;
          threatD = ad;
        }
      }
      var safe = !threat;
      if (dBomb < 1.6 && !otherChannel && (safe || G.bombT < 7)) {
        bot.state = 'PLANT_OR_DEFUSE';
        bot.channelT = 0;
        return;
      }
      if (!safe && dBomb < 11 && G.bombT >= 7) {
        if (!bot.targetPos || this._dist(bot.targetPos, threat.pos) > 2) bot.setPathTo(threat.pos.x, threat.pos.z);
        bot.state = 'FLANK';
        bot.moveAlong(dtSafe, 1.05);
        return;
      }
      if (!bot.targetPos || this._dist(bot.targetPos, bombPos) > 2) {
        bot.setPathTo(bombPos.x + (Math.random() - 0.5) * 2, bombPos.z + (Math.random() - 0.5) * 2);
      }
      bot.state = 'FLANK';
      bot.moveAlong(dtSafe, 1.05);
      return;
    }
    bot.state = 'HOLD_ANGLE';
  },

  // Channel plant (atk) atau defuse (def) bom.
  doChannel: function (bot, dt) {
    bot.crouching = true;
    var isPlant = bot.team === 'atk';
    var need = isPlant ? 3.5 : 4.0;
    if (!isPlant && G.bombT > 8) {
      var pushed = false;
      var attackers = this._liveAttackers();
      var i, a, aPos;
      for (i = 0; i < attackers.length; i++) {
        a = attackers[i];
        if (this._dist(a.pos, bot.pos) >= 5.5) continue;
        aPos = { x: a.pos.x, y: a.pos.y + 1.3, z: a.pos.z };
        if (!losBlocked(aPos, this._chestOf(bot))) pushed = true;
      }
      if (pushed) {
        bot.crouching = false;
        bot.channelT = 0;
        bot.state = 'ENGAGE_COVER';
        bot.reactionT = 0.15;
        return;
      }
    }
    bot.channelT += dt;
    if (isPlant) {
      bot.faceToward(bot.pos.x + Math.sin(G.time), bot.pos.z - 5, dt, 2);
    }
    if (bot.channelT >= need) {
      bot.crouching = false;
      bot.channelT = 0;
      if (isPlant) Game.plantBomb(bot);
      else Game.defuseBomb(bot);
      bot.state = 'HOLD_ANGLE';
    }
  },

  // Bertarung: kejar / strafe / tembak target yang terlihat atau diingat.
  doEngage: function (bot, dt, vis) {
    bot.crouching = false;
    var tgtPos = null;
    if (vis) {
      tgtPos = vis.pos;
    } else if (bot.lastSeenPos && G.time - bot.lastSeenT < 2.5) {
      tgtPos = bot.lastSeenPos;
    }
    if (!tgtPos) {
      bot.state = (bot.team === 'def' && !G.bombPlanted) ? 'HOLD_ANGLE' : 'PATROL_SITE';
      if (bot.team === 'atk' || G.bombPlanted) this.assignObjective(bot);
      return;
    }
    bot.faceToward(tgtPos.x, tgtPos.z, dt, 9);
    var dist = this._dist(bot.pos, tgtPos);
    if (bot.hp < 35 && dist > 4) {
      var cover = this._nearestCoverNode(bot);
      if (cover && this._dist(bot.pos, cover) > 1.5) {
        if (!bot.targetPos || bot.targetPos.x !== cover.x) bot.setPathTo(cover.x, cover.z);
        bot.moveAlong(dt, 1.1);
      }
    } else {
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) {
        bot.strafeT = 0.35 + Math.random() * 0.55;
        bot.strafeDir = -bot.strafeDir;
      }
      if (dist > 16) {
        bot.setPathTo(tgtPos.x, tgtPos.z);
        bot.moveAlong(dt, 1);
        bot.path = [];
        bot.pathIdx = 0;
        bot.targetPos = null;
      } else if (dist > 3) {
        var fwd = this._forward(bot);
        var side = this._rightOf(fwd);
        var step = 1.7 * dt * bot.strafeDir;
        bot.pos.x += side.x * step;
        bot.pos.z += side.z * step;
        collideMove(bot.pos, 0.38, 1.8);
      }
    }

    // --- Tembak ---
    if (!vis) return;
    if (bot.reactionT > 0) {
      bot.reactionT -= dt;
      return;
    }
    if (bot.burstWait > 0) {
      bot.burstWait -= dt;
      return;
    }
    if (performance.now() < bot.nextShotT) return;
    var wd = WEAPONS[bot.weaponId];
    bot.nextShotT = performance.now() + 60000 / wd.rpm;
    bot.burstLeft -= 1;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = Math.floor(3 + Math.random() * 3);
      bot.burstWait = 0.45 + Math.random() * 0.5;
    }
    this.fireBot(bot, vis, wd);
  },

  // Satu tembakan bot ke vis (Player atau bot lain).
  fireBot: function (bot, vis, wd) {
    var muzzle = { x: bot.pos.x, y: bot.pos.y + 1.3, z: bot.pos.z };
    var isPlayer = vis === Player;
    var tgtPos;
    if (isPlayer) {
      tgtPos = { x: Player.pos.x, y: Player.pos.y + 1.25, z: Player.pos.z };
    } else {
      var chest = this._chestOf(vis);
      tgtPos = { x: chest.x, y: chest.y + 0.15, z: chest.z };
    }
    var dPlayer = this._dist(bot.pos, Player.pos);
    AudioEngine.shot(wd.snd, dPlayer);
    if (!wd.suppressed) Game.emitNoise(bot.pos, 42, 'shot', bot);
    WeaponSystem.spawnTracer(muzzle, tgtPos, wd.tracer);
    var dist = this._dist(bot.pos, tgtPos);
    var p = 0.62 - dist * 0.011;
    if (isPlayer) {
      p -= this._playerSpeed() * 0.045;
      if (!Player.onGround) p -= 0.22;
      if (Player.crouch) p -= 0.07;
    } else {
      p -= 0.08;
    }
    p = Math.min(0.85, Math.max(0.06, p * Settings.diffAccuracy()));
    if (Math.random() > p) {
      Game.spawnImpact({
        x: tgtPos.x + (Math.random() - 0.5) * 1.6,
        y: tgtPos.y + (Math.random() - 0.5) * 1.2,
        z: tgtPos.z + (Math.random() - 0.5) * 1.6
      });
      return;
    }
    var head = Math.random() < 0.16;
    var dmg = head
      ? wd.dmg * wd.headMult * 0.8
      : wd.dmg * (0.75 + Math.random() * 0.3);
    if (isPlayer) {
      if (!G.botStats) G.botStats = {};
      if (!G.botStats[bot.name]) G.botStats[bot.name] = { hits: 0, headshots: 0, damage: 0, kills: 0 };
      var stats = G.botStats[bot.name];
      stats.hits += 1;
      if (head) stats.headshots += 1;
      stats.damage += dmg;
      Player.damage(dmg, bot.pos, bot.name);
      if (!Player.alive) {
        bot.roundKills = (bot.roundKills || 0) + 1;
        bot.kills = (bot.kills || 0) + 1;
        stats.kills += 1;
        HUD.killfeed(bot.name, 'YOU', head, bot.weaponId);
        Game.checkRoundEnd();
      }
    } else {
      vis.damage(dmg, head, bot.name, bot.weaponId);
    }
  }
};
var dtSafe = 0.016;

// UtilitySystem — granat flash / smoke / frag
// Modul mandiri: proyektil granat, partikel, decal hangus, dan asap.

const UtilitySystem = {
  projectiles: [],
  particles: [],
  decals: [],

  throwNade: function (kind) {
    if (Player.util[kind] <= 0 || !Player.alive || G.phase !== "live") { return; }
    Player.util[kind]--;
    HUD.updateVitals();
    AudioEngine.throwWhoosh();
    var dir = Player.lookDir();
    var start = Player.eye().add(dir.clone().multiplyScalar(0.5));
    var mats = { flash: nadeMatFlash, smoke: nadeMatSmoke, frag: nadeMatFrag };
    var fuses = { flash: 1.5, frag: 2.2, smoke: 1.1 };
    var mesh = new THREE.Mesh(nadeGeo, mats[kind] || nadeMatFrag);
    mesh.position.copy(start);
    scene.add(mesh);
    UtilitySystem.projectiles.push({
      kind: kind,
      mesh: mesh,
      vel: dir.clone().multiplyScalar(15).add(new THREE.Vector3(0, 2.2, 0)),
      fuse: fuses[kind] || 1.1,
      resting: false
    });
  },

  update: function (dt) {
    var now = G.time;
    var i, j, p, mp, c;
    for (i = UtilitySystem.projectiles.length - 1; i >= 0; i--) {
      p = UtilitySystem.projectiles[i];
      p.fuse -= dt;
      if (!p.resting) {
        p.vel.y -= 16 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        mp = p.mesh.position;
        if (mp.y < 0.12) {
          mp.y = 0.12;
          p.vel.y *= -0.42;
          p.vel.x *= 0.7;
          p.vel.z *= 0.7;
          if (Math.abs(p.vel.y) < 0.8) {
            p.vel.y = 0;
            if (p.kind === "smoke") { p.resting = true; }
          }
        }
        for (j = 0; j < colliders.length; j++) {
          c = colliders[j];
          if (mp.x > c.minX - 0.1 && mp.x < c.maxX + 0.1 && mp.z > c.minZ - 0.1 && mp.z < c.maxZ + 0.1 && mp.y < c.h) {
            var distL = mp.x - c.minX;
            var distR = c.maxX - mp.x;
            var distB = mp.z - c.minZ;
            var distF = c.maxZ - mp.z;
            var nearest = Math.min(distL, distR, distB, distF);
            if (nearest === distL || nearest === distR) {
              p.vel.x *= -0.5;
            } else {
              p.vel.z *= -0.5;
            }
            mp.x = Math.max(c.minX - 0.11, Math.min(mp.x, c.maxX + 0.11));
            mp.z = Math.max(c.minZ - 0.11, Math.min(mp.z, c.maxZ + 0.11));
            break;
          }
        }
        p.mesh.rotation.x += dt * 7;
        p.mesh.rotation.z += dt * 5;
      }
      if (p.fuse <= 0) {
        UtilitySystem.detonate(p);
        scene.remove(p.mesh);
        UtilitySystem.projectiles.splice(i, 1);
      }
    }
    for (i = smokes.length - 1; i >= 0; i--) {
      var s = smokes[i];
      if (now > s.until) {
        for (j = 0; j < s.sprites.length; j++) {
          scene.remove(s.sprites[j]);
          s.sprites[j].material.dispose();
        }
        smokes.splice(i, 1);
      } else {
        var grow = Math.min(1, (14 - (s.until - now)) / 1.2 + 0.25);
        for (j = 0; j < s.sprites.length; j++) {
          var sprite = s.sprites[j];
          var size = sprite.userData.base * grow;
          sprite.scale.set(size, size, 1);
        }
        s.r = 3.1 * grow;
      }
    }
    for (i = UtilitySystem.particles.length - 1; i >= 0; i--) {
      var part = UtilitySystem.particles[i];
      part.life -= dt;
      part.vel.y -= 6 * dt;
      part.mesh.position.addScaledVector(part.vel, dt);
      if (part.mesh.position.y < 0.03) { part.mesh.position.y = 0.03; }
      part.mesh.material.opacity = Math.max(0, part.life / part.maxLife);
      if (part.life <= 0) {
        scene.remove(part.mesh);
        part.mesh.material.dispose();
        UtilitySystem.particles.splice(i, 1);
      }
    }
  },

  detonate: function (p) {
    var pos = p.mesh.position.clone();
    if (p.kind === "flash") {
      UtilitySystem.flash(pos);
    } else if (p.kind === "smoke") {
      UtilitySystem.smoke(pos);
    } else {
      UtilitySystem.frag(pos);
    }
  },

  flash: function (pos) {
    var eye = Player.eye();
    var d = eye.distanceTo(pos);
    if (Player.alive && d < 26) {
      var toFlash = pos.clone().sub(eye).normalize();
      var dot = Player.lookDir().dot(toFlash);
      if (!losBlockedNoSmoke(eye, pos)) {
        var facing = Math.max(0, (dot - 0.15) / 0.85);
        var strength = Math.min(1, facing * 1.3) * Math.max(0.25, 1 - d / 30);
        if (strength > 0.05) {
          Player.blindT = Math.max(Player.blindT, 0.8 + strength * 2.6);
          flashEl.style.transition = "none";
          flashEl.style.opacity = Math.min(1, strength + 0.25);
          requestAnimationFrame(function () {
            flashEl.style.transition = "opacity 2.6s";
            flashEl.style.opacity = 0;
          });
          AudioEngine.tinnitus(strength);
        }
      }
    }
    var i, b, be, bd, fwd, to;
    for (i = 0; i < Game.bots.length; i++) {
      b = Game.bots[i];
      if (!b.alive) { continue; }
      be = b.eye();
      bd = be.distanceTo(pos);
      if (bd > 24) { continue; }
      fwd = new THREE.Vector3(-Math.sin(b.yaw), 0, -Math.cos(b.yaw));
      to = pos.clone().sub(be).normalize();
      if (fwd.dot(to) > 0.25 && !losBlockedNoSmoke(be, pos)) {
        b.blindT = Math.max(b.blindT, 1.2 + (1 - bd / 24) * 2.4);
      }
    }
    var spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TextureGenerator.muzzleSprite(),
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false
    }));
    spr.position.copy(pos);
    spr.scale.set(3.4, 3.4, 1);
    scene.add(spr);
    UtilitySystem.particles.push({ mesh: spr, vel: new THREE.Vector3(), life: 0.16, maxLife: 0.16 });
    AudioEngine.explosion(eye.distanceTo(pos) * 0.4);
  },

  smoke: function (pos) {
    var sprites = [];
    var tex = TextureGenerator.smokeSprite();
    var i, a, rr, size;
    for (i = 0; i < 15; i++) {
      a = (i / 15) * Math.PI * 2;
      rr = Math.random() * 1.9;
      size = 2.6 + Math.random() * 2.1;
      var mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        color: 0xd6dbe2
      });
      var puff = new THREE.Sprite(mat);
      puff.position.set(pos.x + Math.cos(a) * rr, 0.7 + Math.random() * 1.7, pos.z + Math.sin(a) * rr);
      puff.userData.base = size;
      puff.scale.set(0.4, 0.4, 1);
      scene.add(puff);
      sprites.push(puff);
    }
    smokes.push({ pos: new THREE.Vector3(pos.x, 1.3, pos.z), r: 0.6, until: G.time + 14, sprites: sprites });
    AudioEngine.hiss(1.6);
  },

  frag: function (pos) {
    var dP = Player.pos.distanceTo(pos);
    AudioEngine.explosion(dP);
    if (dP < 7) {
      Player.shake = Math.min(1.2, Player.shake + (1 - dP / 7) * 1.1);
    }
    var dmgAt = function (target, isPlayer) {
      var d = target.distanceTo(pos);
      if (d > 5.2) { return undefined; }
      var from = new THREE.Vector3(target.x, target.y + 1, target.z);
      if (losBlockedNoSmoke(from, pos)) { return undefined; }
      var dmg = 105 * (1 - d / 5.6);
      if (isPlayer) { Player.damage(dmg, pos); }
      return dmg;
    };
    dmgAt(Player.pos, true);
    var i, b, dd;
    for (i = 0; i < Game.bots.length; i++) {
      b = Game.bots[i];
      if (!b.alive) { continue; }
      dd = dmgAt(b.pos, false);
      if (dd) { b.damage(dd, false, "YOU", "frag"); }
    }
    for (i = 0; i < 26; i++) {
      var m = new THREE.Mesh(shardGeo, new THREE.MeshBasicMaterial({
        color: (i % 3 === 0) ? 0x555c64 : 0xffa63e,
        transparent: true
      }));
      m.position.copy(pos).add(new THREE.Vector3(0, 0.25, 0));
      scene.add(m);
      var heading = Math.random() * Math.PI * 2;
      var speed = 3 + Math.random() * 8;
      UtilitySystem.particles.push({
        mesh: m,
        vel: new THREE.Vector3(Math.cos(heading) * speed, 2.5 + Math.random() * 5, Math.sin(heading) * speed),
        life: 0.5 + Math.random() * 0.5,
        maxLife: 1
      });
    }
    var sc = new THREE.Mesh(
      new THREE.CircleGeometry(1.7, 20),
      new THREE.MeshBasicMaterial({ color: 0x060606, transparent: true, opacity: 0.75, depthWrite: false })
    );
    sc.rotation.x = -Math.PI / 2;
    sc.position.set(pos.x, 0.04, pos.z);
    scene.add(sc);
    UtilitySystem.decals.push(sc);
    WeaponSystem.flashLight.position.copy(pos).add(new THREE.Vector3(0, 0.8, 0));
    WeaponSystem.flashLight.intensity = 5;
  },

  clearRound: function () {
    var i, j;
    for (i = 0; i < UtilitySystem.projectiles.length; i++) {
      scene.remove(UtilitySystem.projectiles[i].mesh);
    }
    UtilitySystem.projectiles = [];
    for (i = 0; i < smokes.length; i++) {
      for (j = 0; j < smokes[i].sprites.length; j++) {
        scene.remove(smokes[i].sprites[j]);
        smokes[i].sprites[j].material.dispose();
      }
    }
    smokes.length = 0;
    for (i = 0; i < UtilitySystem.particles.length; i++) {
      scene.remove(UtilitySystem.particles[i].mesh);
    }
    UtilitySystem.particles = [];
    for (i = 0; i < UtilitySystem.decals.length; i++) {
      scene.remove(UtilitySystem.decals[i]);
      UtilitySystem.decals[i].material.dispose();
    }
    UtilitySystem.decals = [];
  }
};

function losBlockedNoSmoke(a, b) {
  var i;
  for (i = 0; i < colliders.length; i++) {
    if (colliders[i].h < 1.0) { continue; }
    if (segHitsAABB(a.x, a.y, a.z, b.x, b.y, b.z, colliders[i], 0)) { return true; }
  }
  return false;
}

const nadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const nadeMatFlash = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.35, metalness: 0.7 });
const nadeMatSmoke = new THREE.MeshStandardMaterial({ color: 0x4c9455, roughness: 0.5, metalness: 0.4 });
const nadeMatFrag = new THREE.MeshStandardMaterial({ color: 0x39492e, roughness: 0.6, metalness: 0.4 });
const shardGeo = new THREE.BoxGeometry(0.05, 0.05, 0.16);
const flashEl = document.getElementById("flash-overlay");

// HUDManager — tampilan HUD, killfeed, radar, banner.
// Ditulis ulang dari spek perilaku (hud.md). Semua id DOM, teks, warna,
// dan angka mengikuti spek persis.

var HUD = {
  el: {},
  radar: null,
  _killBannerTimer: null,
  _hitTimer: null,
  _dmgTimer: null,

  init: function () {
    var ids = ['hud', 'hp-num', 'hp-fill', 'armor-fill', 'armor-num', 'weapon-name', 'weapon-mode', 'ammo-mag', 'ammo-res', 'credits', 'reload-hint', 'score-atk', 'score-def', 'round-timer', 'round-label', 'team-status', 'killfeed', 'prompt-text', 'progress-track', 'progress-fill', 'bomb-alert', 'util-q', 'util-e', 'util-g', 'util-q-c', 'util-e-c', 'util-g-c', 'dmg-arc', 'dmg-vignette', 'hitmarker'];
    var i;
    for (i = 0; i < ids.length; i++) {
      this.el[ids[i]] = document.getElementById(ids[i]);
    }
    var canvas = document.getElementById('radar');
    this.radar = canvas ? canvas.getContext('2d') : null;
  },

  _setText: function (el, text) {
    if (el) el.textContent = text;
  },

  _setClass: function (el, cls) {
    if (el) el.className = cls;
  },

  updateVitals: function () {
    var hp = Player.hp;
    var hpLow = hp <= 30;
    this._setText(this.el['hp-num'], Math.ceil(hp));
    this._setClass(this.el['hp-num'], hpLow ? 'low' : '');
    if (this.el['hp-fill']) {
      this.el['hp-fill'].style.transform = 'scaleX(' + Math.max(0, hp / 100) + ')';
      this.el['hp-fill'].style.background = hpLow ? '#ff5147' : '#3ddc84';
    }
    if (this.el['armor-fill']) {
      this.el['armor-fill'].style.transform = 'scaleX(' + Math.max(0, Player.armor / 50) + ')';
    }
    this._setText(this.el['armor-num'], Math.ceil(Player.armor));
    this._setText(this.el['credits'], '$' + Player.credits.toLocaleString());
    var slots = [
      { slot: 'util-q', count: 'util-q-c', n: Player.util.flash },
      { slot: 'util-e', count: 'util-e-c', n: Player.util.smoke },
      { slot: 'util-g', count: 'util-g-c', n: Player.util.frag }
    ];
    var i;
    for (i = 0; i < slots.length; i++) {
      this._setText(this.el[slots[i].count], slots[i].n);
      this._setClass(this.el[slots[i].slot], 'util-slot' + (slots[i].n <= 0 ? ' empty' : ''));
    }
  },

  updateWeapon: function () {
    var st = WeaponSystem.st();
    var def = WeaponSystem.def();
    var melee = !!def.melee;
    this._setText(this.el['weapon-name'], def.name);
    this._setText(this.el['weapon-mode'], def.mode);
    this._setText(this.el['ammo-mag'], melee ? '—' : st.mag);
    this._setClass(this.el['ammo-mag'], (!melee && st.mag <= Math.ceil(def.mag / 4)) ? 'low' : '');
    this._setText(this.el['ammo-res'], melee ? '' : '/ ' + st.reserve);
  },

  setReloadHint: function (t) {
    this._setText(this.el['reload-hint'], t);
  },

  updateScore: function () {
    this._setText(this.el['score-atk'], G.score.atk);
    this._setText(this.el['score-def'], G.score.def);
    var label;
    if (Settings.side === 'def') {
      label = G.bombPlanted ? 'DEFEND SPIKE PLANTED' : 'DEFEND';
    } else {
      label = (Player.hasBomb || Game.carrier() === 'player') ? 'YOU HAVE THE SPIKE' : 'ATTACK';
    }
    this._setText(this.el['round-label'], 'ROUND ' + G.round + ' · FIRST TO 5 · ' + label);
    var html = '<span class="agent-chip atk' + (!Player.alive ? ' dead' : '') + '">YOU</span>';
    var i;
    for (i = 0; i < Game.bots.length; i++) {
      var bot = Game.bots[i];
      html += '<span class="agent-chip ' + bot.team + (!bot.alive ? ' dead' : '') + '">' + bot.name.slice(0, 2) + '</span>';
    }
    if (this.el['team-status']) this.el['team-status'].innerHTML = html;
  },

  updateTimer: function () {
    var t;
    if (G.phase === 'buy') {
      t = G.phaseT;
    } else if (G.bombPlanted) {
      t = G.bombT;
    } else {
      t = G.roundT;
    }
    t = Math.max(0, t);
    var mins = Math.floor(t / 60);
    var secs = Math.floor(t % 60);
    var secsText = secs < 10 ? '0' + secs : '' + secs;
    this._setText(this.el['round-timer'], mins + ':' + secsText);
    this._setClass(this.el['round-timer'], (t < 11 || G.bombPlanted) ? 'danger' : '');
    if (this.el['bomb-alert']) {
      this.el['bomb-alert'].style.display = (G.bombPlanted && G.phase === 'live') ? 'block' : 'none';
    }
  },

  killfeed: function (killer, victim, head, weaponId) {
    var row = document.createElement('div');
    row.className = 'kf-row';
    var wname = WEAPONS[weaponId] ? WEAPONS[weaponId].name : 'FRAG';
    var hs = head ? '<span class="hs">◉ HEADSHOT</span> ' : '';
    row.innerHTML = '<span class="kil">' + killer + '</span> <span style="color:#9fb4c4">[' + wname + ']</span> ' + hs + '<span class="vic">' + victim + '</span>';
    var feed = this.el['killfeed'];
    if (!feed) return;
    feed.insertBefore(row, feed.firstChild);
    while (feed.children.length > 5) {
      feed.removeChild(feed.lastChild);
    }
    setTimeout(function () {
      row.style.transition = 'opacity 0.5s';
      row.style.opacity = '0';
      setTimeout(function () {
        if (row.parentNode) row.parentNode.removeChild(row);
      }, 520);
    }, 4200);
  },

  killConfirm: function (name, head) {
    AudioEngine.killConfirm(head);
    var bannerEl = document.getElementById('kill-banner');
    if (!bannerEl) return;
    bannerEl.textContent = '✕ ELIMINATED ' + name + (head ? ' — HEADSHOT' : '');
    bannerEl.classList.remove('pop');
    void bannerEl.offsetWidth;
    bannerEl.classList.add('pop');
    if (this._killBannerTimer) clearTimeout(this._killBannerTimer);
    this._killBannerTimer = setTimeout(function () {
      bannerEl.classList.remove('pop');
    }, 1550);
  },

  showHitmarker: function (head, kill) {
    AudioEngine.hitmarker(head);
    var hm = this.el['hitmarker'];
    if (!hm) return;
    hm.className = kill ? 'kill' : (head ? 'gold' : '');
    hm.style.opacity = '1';
    if (this._hitTimer) clearTimeout(this._hitTimer);
    var self = this;
    this._hitTimer = setTimeout(function () {
      hm.style.opacity = '0';
    }, 130);
  },

  damageFrom: function (fromPos) {
    if (!fromPos) return;
    var ang = Math.atan2(fromPos.x - Player.pos.x, fromPos.z - Player.pos.z) - Player.yaw + Math.PI;
    var deg = ang * 180 / Math.PI + 180;
    var arc = this.el['dmg-arc'];
    var vig = this.el['dmg-vignette'];
    if (arc) {
      arc.style.transform = 'rotate(' + deg + 'deg)';
      arc.style.opacity = '1';
    }
    if (vig) vig.style.opacity = '1';
    if (this._dmgTimer) clearTimeout(this._dmgTimer);
    this._dmgTimer = setTimeout(function () {
      if (arc) arc.style.opacity = '0';
      if (vig) vig.style.opacity = '0.35';
      setTimeout(function () {
        if (Player.hp > 30 && vig) vig.style.opacity = '0';
      }, 1400);
    }, 350);
  },

  updateCrosshair: function (spread) {
    var gap = 7 + spread * 900;
    var top = document.getElementById('ch-t');
    var bottom = document.getElementById('ch-b');
    var left = document.getElementById('ch-l');
    var right = document.getElementById('ch-r');
    if (top) top.style.top = (-gap - 9) + 'px';
    if (bottom) bottom.style.top = gap + 'px';
    if (left) left.style.left = (-gap - 9) + 'px';
    if (right) right.style.left = gap + 'px';
  },

  setPrompt: function (text, progress) {
    this._setText(this.el['prompt-text'], text || '');
    var track = this.el['progress-track'];
    if (progress !== null && progress !== undefined) {
      if (track) track.style.display = 'block';
      if (this.el['progress-fill']) {
        this.el['progress-fill'].style.width = Math.min(100, progress * 100) + '%';
      }
    } else {
      if (track) track.style.display = 'none';
    }
  },

  drawRadar: function () {
    var ctx = this.radar;
    if (!ctx) return;
    var size = 168;
    var scale = size / (WORLD + 6);
    var now = G.time || 0;
    var rx = function (x) { return (x + HALF + 3) * scale; };
    var ry = function (z) { return (z + HALF + 3) * scale; };
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0a0f14';
    ctx.fillRect(0, 0, size, size);
    var i;
    for (i = 0; i < colliders.length; i++) {
      var c = colliders[i];
      var w = Math.max(1.5, (c.maxX - c.minX) * scale);
      var h = Math.max(1.5, (c.maxZ - c.minZ) * scale);
      ctx.fillStyle = '#232a31';
      ctx.fillRect(rx(c.minX), ry(c.minZ), w, h);
    }
    var siteDefs = [
      { key: 'A', color: '#ff7a1a', label: 'SITE A', labelColor: 'rgba(255,160,90,0.9)' },
      { key: 'B', color: '#35c4ff', label: 'SITE B', labelColor: 'rgba(120,205,255,0.9)' }
    ];
    for (i = 0; i < siteDefs.length; i++) {
      var sd = siteDefs[i];
      var s = sites[sd.key];
      var sx = rx(s.x);
      var sy = ry(s.z);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = sd.color;
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = sd.color;
      ctx.font = 'bold 11px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(sd.key, sx, sy + 4);
    }
    ctx.font = '700 7.5px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,160,90,0.9)';
    ctx.fillText('SITE A', rx(sites.A.x), ry(sites.A.z) - 9.5);
    ctx.fillStyle = 'rgba(120,205,255,0.9)';
    ctx.fillText('SITE B', rx(sites.B.x), ry(sites.B.z) - 9.5);
    ctx.fillStyle = 'rgba(205,220,232,0.55)';
    ctx.fillText('MID', rx(0), ry(3));
    ctx.fillStyle = 'rgba(255,179,92,0.8)';
    ctx.fillText('ATK', rx(0), ry(31));
    ctx.fillStyle = 'rgba(124,196,255,0.8)';
    ctx.fillText('DEF', rx(0), ry(-31));
    if (G.bombDropped || G.bombPlanted) {
      var blink = Math.sin(now * 6) > 0;
      var bp = G.bombPlanted ? G.bombPos : G.bombDropped;
      var bx = rx(bp.x);
      var by = ry(bp.z);
      ctx.fillStyle = blink ? '#ff3524' : '#7a1408';
      ctx.fillRect(bx - 3, by - 3, 6, 6);
      if (G.bombPlanted) {
        ctx.strokeStyle = '#ff3524';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(bx, by, 6.5 + Math.sin(now * 6) * 1.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (i = 0; i < Game.bots.length; i++) {
      var bot = Game.bots[i];
      if (!bot.alive) continue;
      var dot = null;
      if (bot.team === Settings.side) {
        dot = bot.team === 'atk' ? '#ffb35c' : '#7cc4ff';
      } else if (bot.spottedT > 0) {
        dot = '#ff5147';
      }
      if (!dot) continue;
      ctx.fillStyle = dot;
      ctx.beginPath();
      ctx.arc(rx(bot.pos.x), ry(bot.pos.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    var carrier = Game.carrier();
    if (carrier && !G.bombPlanted) {
      var cp = carrier === 'player' ? Player.pos : carrier.pos;
      var cx = rx(cp.x);
      var cy = ry(cp.z);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffd23e';
      ctx.strokeStyle = '#14100b';
      ctx.lineWidth = 1;
      ctx.fillRect(-3.2, -3.2, 6.4, 6.4);
      ctx.strokeRect(-3.2, -3.2, 6.4, 6.4);
      ctx.restore();
    }
    var px = rx(Player.pos.x);
    var py = ry(Player.pos.z);
    var face = Math.atan2(-Math.cos(Player.yaw), -Math.sin(Player.yaw));
    ctx.fillStyle = 'rgba(89,255,160,0.18)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, 30, face - 0.5, face + 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#59ffa0';
    ctx.beginPath();
    ctx.arc(px, py, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,200,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  },

  banner: function (title, sub, mvp, atkWin) {
    var el = document.getElementById('banner');
    if (!el) return;
    var titleEl = document.getElementById('banner-title');
    var subEl = document.getElementById('banner-sub');
    var mvpEl = document.getElementById('banner-mvp');
    if (titleEl) {
      titleEl.textContent = title;
      titleEl.style.color = atkWin ? '#ff9435' : '#57b6ff';
    }
    if (subEl) subEl.textContent = sub;
    if (mvpEl) mvpEl.textContent = mvp ? 'ROUND MVP ' + mvp : '';
    el.style.display = 'flex';
    setTimeout(function () {
      el.style.display = 'none';
    }, 2900);
  }
};

/* ================================ Game =============================== */
const G = {
  phase: "idle", // idle | buy | live | roundEnd | over
  time: 0, round: 1, phaseT: 0, roundT: 90, bombT: 40,
  score: { atk: 0, def: 0 },
  bombPlanted: false, plantedSite: null, bombPos: new THREE.Vector3(),
  targetSite: "A", bombCarrierBot: null, playerSpottedT: 0,
  noises: [], lastBeep: 0, started: false,
  stats: { kills: 0, deaths: 0, assists: 0, hits: 0, headshots: 0, damage: 0, plants: 0, defuses: 0 },
  botStats: {},
  loseStreak: { atk: 0, def: 0 }, // consecutive round losses per team (economy bonus)
  halftimeDone: false, lastDefuseSnd: 0
};
const ATK_SPAWNS = [new THREE.Vector3(0, 0, 27), new THREE.Vector3(-3.5, 0, 28), new THREE.Vector3(3.5, 0, 28), new THREE.Vector3(-7, 0, 26), new THREE.Vector3(7, 0, 26)];
const DEF_SPAWNS = [new THREE.Vector3(-3, 0, -28), new THREE.Vector3(3, 0, -28), new THREE.Vector3(0, 0, -25), new THREE.Vector3(-6.5, 0, -26), new THREE.Vector3(6.5, 0, -26)];
const TEAM_NAMES = { atk: ["VIPER", "HAVOC", "JACKAL", "BRUTE"], def: ["GHOST", "RAZOR", "ONYX", "WRAITH"] };

/* Dispose a bot character mesh's per-bot geometries/materials when its
   round ends, so multi-round matches do not leak GPU memory. Only used on
   character meshes — their materials/geometries are created per bot. */
function disposeMesh(root) {
  if (!root) return;
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
  });
}
const Game = {
  bots: [], bombMesh: null, impactPool: [], holeDecals: [],
  carrier() {
    if (Player.hasBomb) return "player";
    if (G.bombCarrierBot && G.bombCarrierBot.alive) return G.bombCarrierBot;
    return null;
  },
  emitNoise(pos, radius, type, sourceBot) {
    // bots on opposing team investigate loud noises
    for (const b of this.bots) {
      if (!b.alive || b.blindT > 0) continue;
      if (sourceBot && b.team === sourceBot.team) continue;
      if (!sourceBot && b.team === Settings.side) continue; // player noise: only the opposing team reacts
      if (sourceBot && sourceBot === b) continue;
      const d = b.pos.distanceTo(pos);
      if (d < radius && b.state !== "ENGAGE_COVER" && b.state !== "PLANT_OR_DEFUSE") {
        if (type === "shot" || G.time - b.investigateT > 2) {
          b.investigatePos = pos.clone(); b.investigateT = G.time;
          b.setPathTo(pos.x, pos.z);
          b.state = "INVESTIGATE_SOUND";
        }
      }
    }
  },
  raycastShoot(origin, dir, maxDist, shooter) {
    // returns {bot, part, point, normal} or {point, normal} for wall hit
    const ray = new THREE.Raycaster(origin, dir, 0, maxDist);
    ray.params.Line = { threshold: 0 };
    const hitMeshes = [];
    for (const b of this.bots) {
      if (!b.alive) continue;
      hitMeshes.push(b.mesh.userData.parts.torso, b.mesh.userData.parts.head);
    }
    const all = wallMeshes.concat(hitMeshes);
    const hits = ray.intersectObjects(all, false);
    if (!hits.length) return null;
    const h = hits[0];
    if (h.object.userData.part) {
      return { bot: h.object.userData.botRef, part: h.object.userData.part, point: h.point, normal: h.face ? h.face.normal : new THREE.Vector3(0, 1, 0) };
    }
    return { point: h.point, normal: h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0) };
  },
  applyDamage(bot, dmg, head, attackerName, weaponId) {
    bot.damage(dmg, head, attackerName, weaponId);
  },
  onKill(attackerName, victim, head, weaponId) {
    HUD.killfeed(attackerName, victim.name === undefined ? victim : victim.name, head, weaponId);
    if (attackerName === "YOU") {
      Player.credits += 300;
      G.playerRoundKills++;
      HUD.updateVitals();
    } else {
      for (const b of this.bots) if (b.name === attackerName) { b.roundKills++; }
    }
    if (victim === "player") { /* handled in Player.die */ }
    if (victim.isBotObj) { /* noop */ }
    // bomb drop if carrier bot died
    if (G.bombCarrierBot === victim) { G.bombCarrierBot = null; this.dropBomb(victim.pos); }
    HUD.updateScore();
    this.checkRoundEnd();
  },
  dropBomb(pos) {
    G.bombDropped = pos.clone(); G.bombDropped.y = 0;
    if (this.bombMesh) { this.bombMesh.visible = true; this.bombMesh.position.set(pos.x, 0.25, pos.z); }
  },
  pickupBomb(bot) {
    G.bombDropped = null; G.bombCarrierBot = bot;
    if (this.bombMesh) this.bombMesh.visible = false;
    if (bot === "player") { Player.hasBomb = true; }
  },
  plantBomb(byBot) {
    G.bombPlanted = true;
    G.plantedSite = G.targetSite;
    const s = sites[G.plantedSite];
    G.bombPos.set(byBot ? byBot.pos.x : Player.pos.x, 0, byBot ? byBot.pos.z : Player.pos.z);
    if (this.bombMesh) {
      this.bombMesh.visible = true;
      this.bombMesh.position.set(G.bombPos.x, 0.25, G.bombPos.z);
    }
    if (this.bombFx) {
      this.bombFx.ring.visible = true;
      this.bombFx.ring.position.set(G.bombPos.x, 0.07, G.bombPos.z);
      this.bombFx.light.visible = true;
      this.bombFx.light.position.set(G.bombPos.x, 0.8, G.bombPos.z);
    }
    if (byBot) { G.bombCarrierBot = null; const rec = G.botStats[byBot.name]; if (rec) rec.plants++; }
    else { Player.hasBomb = false; G.stats.plants++; }
    G.bombT = 40; G.lastBeep = 0;
    AudioEngine.plantDone();
    HUD.updateScore();
  },
  defuseBomb(byBot) {
    if (byBot) { const rec = G.botStats[byBot.name]; if (rec) rec.defuses++; }
    else G.stats.defuses++;
    AudioEngine.defuseDone();
    this.endRound(false, "SPIKE DEFUSED");
  },
  hideBombFx() {
    if (!this.bombFx) return;
    this.bombFx.ring.visible = false;
    this.bombFx.light.visible = false;
    this.bombFx.light.intensity = 0;
  },
  spawnImpact(point, normal) {
    let p = this.impactPool.pop();
    if (!p) {
      p = new THREE.Mesh(impactGeo, new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true }));
      scene.add(p);
    }
    p.visible = true; p.material.opacity = 1;
    p.position.copy(point);
    p.userData.life = 0.09;
    this.impacts = this.impacts || [];
    this.impacts.push(p);
    // spark burst ricocheting along the surface normal
    const n = normal || new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffc46b : 0xfff3c4, transparent: true }));
      m.position.copy(point);
      scene.add(m);
      const vel = n.clone().multiplyScalar(1.2 + Math.random() * 2.2);
      vel.x += (Math.random() - 0.5) * 2.4; vel.y += Math.random() * 1.8; vel.z += (Math.random() - 0.5) * 2.4;
      UtilitySystem.particles.push({ mesh: m, vel, life: 0.22 + Math.random() * 0.18, maxLife: 0.4 });
    }
    // dark bullet-hole decal on walls/crates (capped pool, wiped on round reset)
    if (Math.abs(n.y) < 0.92) {
      const hole = new THREE.Mesh(holeGeo, holeMat);
      hole.position.copy(point).add(n.clone().multiplyScalar(0.012));
      hole.lookAt(point.clone().add(n));
      scene.add(hole);
      this.holeDecals.push(hole);
      if (this.holeDecals.length > 80) { const old = this.holeDecals.shift(); scene.remove(old); }
    }
  },
  updateImpacts(dt) {
    if (!this.impacts) return;
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const p = this.impacts[i];
      p.userData.life -= dt;
      p.material.opacity = Math.max(0, p.userData.life / 0.09);
      if (p.userData.life <= 0) { p.visible = false; this.impacts.splice(i, 1); this.impactPool.push(p); }
    }
  },
  clearFx() {
    // full FX wipe on round reset: decals, impact flashes, shells, tracers, laser
    for (const h of this.holeDecals) scene.remove(h);
    this.holeDecals = [];
    if (this.impacts) for (const p of this.impacts) { p.visible = false; this.impactPool.push(p); }
    this.impacts = [];
    WeaponSystem.clearFx();
    if (WeaponSystem.flashLight) WeaponSystem.flashLight.intensity = 0;
    if (WeaponSystem.flashSprite) WeaponSystem.flashSprite.visible = false;
  },
  checkRoundEnd() {
    if (G.phase !== "live") return;
    const playerAtk = Settings.side === "atk";
    const atkAlive = (playerAtk && Player.alive ? 1 : 0) + this.bots.filter(b => b.team === "atk" && b.alive).length;
    const defAlive = (!playerAtk && Player.alive ? 1 : 0) + this.bots.filter(b => b.team === "def" && b.alive).length;
    if (G.bombPlanted) {
      // Planted Spike: eliminating every attacker does NOT end the round.
      // Play continues until the defenders defuse it or bombT reaches 0.
      if (defAlive === 0) this.endRound(true, "ELIMINATION");
      return;
    }
    if (defAlive === 0) this.endRound(true, "ELIMINATION");
    else if (atkAlive === 0) this.endRound(false, "ELIMINATION");
  },
  endRound(atkWin, reason) {
    if (G.phase !== "live") return;
    G.phase = "roundEnd"; G.phaseT = 3;
    if (atkWin) G.score.atk++; else G.score.def++;
    // economy for the next round's Buy Phase: win +$3,000, loss +$1,900
    // plus a lose-streak bonus (+$500 per consecutive loss past the first,
    // capped at +$1,500). Streaks are tracked per team.
    const winTeam = atkWin ? "atk" : "def", loseTeam = atkWin ? "def" : "atk";
    G.loseStreak[winTeam] = 0;
    G.loseStreak[loseTeam]++;
    const playerWon = (Settings.side === "atk") === atkWin;
    if (playerWon) Player.credits += 3000;
    else Player.credits += 1900 + Math.min(1500, Math.max(0, G.loseStreak[Settings.side] - 1) * 500);
    // Spike plant bonus for the attacking team, win or lose the round
    if (G.bombPlanted && Settings.side === "atk") Player.credits += 300;
    this.hideBombFx();
    const dpEl = document.getElementById("defuse-progress"); if (dpEl) dpEl.style.display = "none";
    const daEl2 = document.getElementById("defuse-alert"); if (daEl2) daEl2.style.display = "none";
    // MVP
    let mvp = "—", best = -1;
    if (G.playerRoundKills > best) { best = G.playerRoundKills; mvp = "YOU"; }
    for (const b of this.bots) if (b.roundKills > best) { best = b.roundKills; mvp = b.name; }
    HUD.banner(atkWin ? "ATTACKERS WIN" : "DEFENDERS WIN", reason + (playerWon ? " — YOUR TEAM TAKES THE ROUND" : ""), best > 0 ? mvp : null, atkWin);
    HUD.updateScore(); HUD.updateVitals();
    AudioEngine.roundSting(playerWon);
  },
  startMatch() {
    // clean slate: restore the side picked on the start screen (halftime may
    // have swapped it), reset score, streaks, stats and pistol-round economy
    Settings.startSide = Settings.startSide || Settings.side;
    Settings.side = Settings.startSide;
    for (const x of document.querySelectorAll("#seg-side .seg-btn")) x.classList.toggle("sel", x.dataset.side === Settings.side);
    G.score.atk = 0; G.score.def = 0; G.round = 1;
    G.stats = { kills: 0, deaths: 0, assists: 0, hits: 0, headshots: 0, damage: 0, plants: 0, defuses: 0 };
    G.botStats = {};
    G.loseStreak = { atk: 0, def: 0 }; G.halftimeDone = false;
    Player.credits = 800; Player.primaryId = null;
    Player.armor = 0; Player.util = { flash: 0, smoke: 0, frag: 0 };
    for (const id in WeaponSystem.state) WeaponSystem.state[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    G.started = true;
    this.startRound();
  },
  startRound() {
    // clear old bots (including last round's corpses/ragdolls) and dispose
    // their per-bot geometries/materials so memory stays flat across rounds
    for (const b of this.bots) { scene.remove(b.mesh); disposeMesh(b.mesh); }
    this.bots = [];
    UtilitySystem.clearRound();
    this.clearFx();
    if (this.bombMesh) this.bombMesh.visible = false;
    this.hideBombFx();
    G.bombPlanted = false; G.plantedSite = null; G.bombDropped = null; G.bombCarrierBot = null; G.defuseChannel = 0;
    G.roundT = 90; G.bombT = 40; G.playerRoundKills = 0; G.playerSpottedT = 0;
    G.targetSite = Math.random() < 0.5 ? "A" : "B";
    // player — spawn, facing and Spike assignment depend on the picked side
    const playerDied = !Player.alive;
    const side = Settings.side;
    Player.reset(side === "def" ? DEF_SPAWNS[2] : ATK_SPAWNS[0]);
    Player.yaw = side === "def" ? Math.PI : 0; // face mid: defenders look south, attackers north
    if (playerDied) { Player.primaryId = null; Player.util = { flash: 0, smoke: 0, frag: 0 }; Player.armor = 0; }
    Player.hasBomb = side === "atk";
    document.getElementById("death-overlay").style.display = "none";
    document.getElementById("death-sub").textContent = "SPECTATING — ROUND IN PROGRESS";
    Spectate.bot = null; Spectate.idx = 0; Spectate.init = false; Spectate.label = null;
    WeaponSystem.equip(Player.primaryId || "pistol");
    for (const id in WeaponSystem.state) { const d = WEAPONS[id]; WeaponSystem.state[id].mag = d.mag; WeaponSystem.state[id].reserve = d.reserve; }
    // bots — mode: 3v3 squad (2 teammates + 3 enemies), or 1v4 lone wolf
    const solo = Settings.mode === "solo";
    const defRoles = ["A", "B", "mid", "B", "A"];
    if (side === "atk") {
      if (!solo) TEAM_NAMES.atk.slice(0, 2).forEach((n, i) => { const b = new Bot(n, "atk", ATK_SPAWNS[i + 1], "push"); b.roundKills = 0; this.bots.push(b); });
      const defCount = solo ? 4 : 3;
      for (let i = 0; i < defCount; i++) { const b = new Bot(TEAM_NAMES.def[i], "def", DEF_SPAWNS[i], defRoles[i]); b.holdPos = null; this.bots.push(b); }
    } else {
      // player defends: defender teammates hold the sites; attacker bots push and one carries the Spike
      if (!solo) TEAM_NAMES.def.slice(0, 2).forEach((n, i) => { const b = new Bot(n, "def", DEF_SPAWNS[i], defRoles[i]); b.holdPos = null; b.roundKills = 0; this.bots.push(b); });
      const atkCount = solo ? 4 : 3;
      let carrierBot = null;
      for (let i = 0; i < atkCount; i++) { const b = new Bot(TEAM_NAMES.atk[i], "atk", ATK_SPAWNS[i + 1], "push"); b.roundKills = 0; this.bots.push(b); if (!carrierBot) carrierBot = b; }
      G.bombCarrierBot = carrierBot;
    }
    // bot loadouts scale with round
    for (const b of this.bots) {
      b.weaponId = Math.random() < 0.55 ? "vandal" : "spectre";
      b.armor = 50;
    }
    G.phase = "buy"; G.phaseT = 6;
    HUD.updateScore(); HUD.updateVitals(); HUD.updateWeapon();
    BuyMenu.open();
  },
  doHalftime() {
    // Halfway point (4 rounds played, round 5 next): the squads swap sides.
    // The score follows each squad — the atk/def totals swap with them, so
    // win counts and the first-to-5 check stay attached to the right team.
    G.halftimeDone = true;
    Settings.side = Settings.side === "atk" ? "def" : "atk";
    const s = G.score.atk; G.score.atk = G.score.def; G.score.def = s;
    G.loseStreak = { atk: 0, def: 0 };
    // pistol-round reset for the second half
    Player.credits = 800; Player.primaryId = null; Player.armor = 0;
    Player.util = { flash: 0, smoke: 0, frag: 0 };
    for (const id in WeaponSystem.state) WeaponSystem.state[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    G.phase = "halftime"; G.phaseT = 3;
    this.hideBombFx();
    HUD.banner("HALFTIME — SWITCHING SIDES", "YOU ARE NOW " + (Settings.side === "atk" ? "ATTACKING" : "DEFENDING") + " · CREDITS RESET TO $800", null, Settings.side === "atk");
    HUD.updateScore(); HUD.updateVitals();
    AudioEngine.roundSting(true);
  },
  toMainMenu() {
    // back to the title screen with a clean world: bots, FX and match
    // state are wiped so the flythrough and the next match start fresh
    G.phase = "idle"; G.started = false;
    Settings.side = Settings.startSide || "atk";
    for (const x of document.querySelectorAll("#seg-side .seg-btn")) x.classList.toggle("sel", x.dataset.side === Settings.side);
    for (const b of this.bots) { scene.remove(b.mesh); disposeMesh(b.mesh); }
    this.bots = [];
    UtilitySystem.clearRound();
    this.clearFx();
    if (this.bombMesh) this.bombMesh.visible = false;
    this.hideBombFx();
    G.bombPlanted = false; G.plantedSite = null; G.bombDropped = null; G.bombCarrierBot = null;
    Player.alive = true;
    document.getElementById("hud").style.display = "none";
    document.getElementById("death-overlay").style.display = "none";
    document.getElementById("buy-screen").classList.add("hidden");
    document.getElementById("banner").style.display = "none";
    document.getElementById("start-screen").classList.remove("hidden");
    if (document.exitPointerLock) document.exitPointerLock();
  },
  update(dt) {
    G.time += dt;
    dtSafe = dt;
    if (G.phase === "buy") {
      G.phaseT -= dt;
      BuyMenu.tick();
      if (G.phaseT <= 0) BuyMenu.close(true);
    } else if (G.phase === "live") {
      if (G.bombPlanted) {
        G.bombT -= dt;
        // countdown beeps accelerate as detonation nears: 1s -> 0.5s -> 0.25s -> 0.15s
        const interval = G.bombT < 5 ? 0.15 : G.bombT < 10 ? 0.25 : G.bombT < 20 ? 0.5 : 1;
        if (G.time - G.lastBeep > interval) { G.lastBeep = G.time; AudioEngine.beep(G.bombT < 10); }
        if (this.bombMesh) { const led = this.bombMesh.userData.led; if (led) led.material.emissiveIntensity = (Math.sin(G.time * (G.bombT < 10 ? 18 : 6)) > 0) ? 3 : 0.2; }
        // shockwave ring + vertical light pulses, phase-locked to the beep rate
        if (this.bombFx && this.bombFx.ring.visible) {
          const ph = (G.time / interval) % 1;
          const sc = 0.6 + ph * 5.4;
          this.bombFx.ring.scale.set(sc, sc, sc);
          this.bombFx.ring.material.opacity = (1 - ph) * 0.6;
          this.bombFx.light.position.set(G.bombPos.x, 0.6 + ph * 2.4, G.bombPos.z);
          this.bombFx.light.intensity = (1 - ph) * 1.7;
        }
        if (G.bombT <= 0) { this.detonateBomb(); return; }
      } else {
        G.roundT -= dt;
        if (G.roundT <= 0) { this.endRound(false, "TIME EXPIRED"); return; }
      }
      // player plant / defuse interaction
      this.updatePlayerObjective(dt);
      // bomb pickup by bots handled in AI; player pickup:
      if (G.bombDropped && Player.alive && Settings.side === "atk" && !Player.hasBomb && Player.pos.distanceTo(G.bombDropped) < 1.4) {
        Player.hasBomb = true; G.bombDropped = null;
        if (this.bombMesh) this.bombMesh.visible = false;
        HUD.updateScore();
      }
      // bots
      for (const b of this.bots) {
        if (b.spottedT > 0) b.spottedT -= dt;
        BotAI.update(b, dt);
      }
      // warning banner while an enemy bot is defusing the planted Spike
      const enemyDefusing = G.bombPlanted && this.bots.some(b => b.alive && b.team !== Settings.side && b.state === "PLANT_OR_DEFUSE");
      const daEl = document.getElementById("defuse-alert");
      if (daEl) { const want = enemyDefusing ? "block" : "none"; if (daEl.style.display !== want) daEl.style.display = want; }
      // bot defuse progress bar + working sound (any defender channeling the
      // planted Spike, friend or foe), plus the player's own defuse channel
      const defuser = G.bombPlanted ? this.bots.find(b => b.alive && b.team === "def" && b.state === "PLANT_OR_DEFUSE") : null;
      const dpEl = document.getElementById("defuse-progress");
      if (dpEl) {
        if (defuser) {
          dpEl.style.display = "block";
          document.getElementById("defuse-progress-fill").style.width = Math.min(100, defuser.channelT / 4.0 * 100) + "%";
        } else dpEl.style.display = "none";
      }
      const playerDefusing = Settings.side === "def" && G.bombPlanted && (G.defuseChannel || 0) > 0;
      if ((defuser || playerDefusing) && G.time - G.lastDefuseSnd > 0.28) { G.lastDefuseSnd = G.time; AudioEngine.defuseTick(); }
      // check end conditions periodically
      this.checkRoundEnd();
    } else if (G.phase === "roundEnd") {
      G.phaseT -= dt;
      for (const b of this.bots) BotAI.update(b, Math.min(dt, 0.001)); // freeze-ish
      if (G.phaseT <= 0) {
        if (G.score.atk >= 5 || G.score.def >= 5) this.endMatch();
        else {
          G.round++;
          // after 4 rounds played the match hits halftime before round 5
          if (!G.halftimeDone && G.round >= 5) this.doHalftime();
          else this.startRound();
        }
      }
    } else if (G.phase === "halftime") {
      // HALFTIME banner holds for its phaseT, then the swapped pistol round begins
      G.phaseT -= dt;
      for (const b of this.bots) BotAI.update(b, Math.min(dt, 0.001)); // freeze-ish
      if (G.phaseT <= 0) this.startRound();
    }
    if (G.playerSpottedT > 0) G.playerSpottedT -= dt;
    UtilitySystem.update(dt);
    this.updateImpacts(dt);
    // decal pulse
    if (MapBuilder.decalA) { MapBuilder.decalA.material.opacity = 0.65 + Math.sin(G.time * 2.4) * 0.2; MapBuilder.decalB.material.opacity = 0.65 + Math.cos(G.time * 2.4) * 0.2; }
    HUD.updateTimer();
    if (G.phase === "live" || G.phase === "buy") HUD.drawRadar();
  },
  updatePlayerObjective(dt) {
    if (!Player.alive) { HUD.setPrompt(""); return; }
    if (Settings.side === "def") {
      // defender: hold [F] near the planted Spike for 4.0s to defuse it
      if (!G.bombPlanted) { G.defuseChannel = 0; HUD.setPrompt(""); return; }
      const dBomb = Player.pos.distanceTo(G.bombPos);
      if (dBomb < 2.3) {
        if (keys["KeyF"]) {
          G.defuseChannel = (G.defuseChannel || 0) + dt;
          HUD.setPrompt("DEFUSING SPIKE…", G.defuseChannel / 4.0);
          if (G.defuseChannel >= 4.0) {
            G.defuseChannel = 0;
            Player.credits += 300;
            HUD.setPrompt("");
            this.defuseBomb(null);
          }
          return;
        }
        G.defuseChannel = 0;
        HUD.setPrompt("HOLD [F] TO DEFUSE THE SPIKE", null);
        return;
      }
      G.defuseChannel = 0;
      HUD.setPrompt("SPIKE PLANTED — RETAKE AND DEFUSE", null);
      return;
    }
    if (Player.hasBomb && !G.bombPlanted) {
      const sA = sites.A, sB = sites.B;
      const inA = Math.hypot(Player.pos.x - sA.x, Player.pos.z - sA.z) < sA.r;
      const inB = Math.hypot(Player.pos.x - sB.x, Player.pos.z - sB.z) < sB.r;
      if ((inA || inB) && keys["KeyF"]) {
        G.plantChannel = (G.plantChannel || 0) + dt;
        HUD.setPrompt("PLANTING SPIKE…", G.plantChannel / 3.5);
        if (G.plantChannel >= 3.5) {
          G.targetSite = inA ? "A" : "B";
          G.plantChannel = 0;
          Player.credits += 300;
          this.plantBomb(null);
          HUD.setPrompt("");
        }
        return;
      }
      G.plantChannel = 0;
      HUD.setPrompt(inA || inB ? "HOLD [F] TO PLANT THE SPIKE" : "CARRY THE SPIKE TO SITE A OR B", null);
      return;
    }
    HUD.setPrompt("");
  },
  detonateBomb() {
    const pos = G.bombPos.clone(); pos.y = 1;
    UtilitySystem.frag(pos);
    Player.shake = 1.4;
    this.endRound(true, "SPIKE DETONATED");
  },
  endMatch() {
    G.phase = "over";
    document.exitPointerLock && document.exitPointerLock();
    const playerScore = Settings.side === "atk" ? G.score.atk : G.score.def;
    const win = playerScore >= 5;
    document.getElementById("end-title").textContent = win ? "VICTORY" : "DEFEAT";
    document.getElementById("end-title").style.color = Settings.side === "atk" ? "#ff9435" : "#57b6ff";
    document.getElementById("end-sub").textContent = "Final score — Attackers " + G.score.atk + " : " + G.score.def + " Defenders. " + (win ? "The facility is yours." : "The facility holds against you. Regroup and retry.");
    // end-of-match scoreboard: K / D / A, Plants / Defuses, HS% and Damage
    // for every agent; the top fragger (kills, damage tiebreak) wears the MVP badge
    const rows = [{ name: "YOU", team: Settings.side, kills: G.stats.kills, deaths: G.stats.deaths, assists: G.stats.assists, hits: G.stats.hits, headshots: G.stats.headshots, damage: G.stats.damage, plants: G.stats.plants, defuses: G.stats.defuses, me: true }];
    for (const n in G.botStats) { const r = G.botStats[n]; rows.push({ name: n, team: r.team, kills: r.kills, deaths: r.deaths, assists: r.assists || 0, hits: r.hits, headshots: r.headshots, damage: r.damage, plants: r.plants || 0, defuses: r.defuses || 0 }); }
    rows.sort((a, b) => (b.kills - a.kills) || (b.damage - a.damage));
    const mvpRow = rows.length && (rows[0].kills > 0 || rows[0].damage > 0) ? rows[0] : null;
    let html = "<table><tr><th>AGENT</th><th>K</th><th>D</th><th>A</th><th>PLANT</th><th>DEFUSE</th><th>HS%</th><th>DAMAGE</th></tr>";
    for (const r of rows) {
      const hs = r.hits > 0 ? Math.round(r.headshots / r.hits * 100) : 0;
      const badge = r === mvpRow ? '<span class="mvp-badge">★ MVP</span>' : "";
      html += "<tr" + (r.me ? ' class="me"' : "") + "><td>" + r.name + ' <span class="tm-' + r.team + '">' + (r.team === "atk" ? "ATK" : "DEF") + "</span>" + badge + "</td><td>" + r.kills + "</td><td>" + r.deaths + "</td><td>" + r.assists + "</td><td>" + r.plants + "</td><td>" + r.defuses + "</td><td>" + hs + "%</td><td>" + Math.round(r.damage) + "</td></tr>";
    }
    html += "</table>";
    if (mvpRow) document.getElementById("end-sub").textContent += " Match MVP — " + mvpRow.name + ".";
    document.getElementById("end-stats").innerHTML = html;
    document.getElementById("end-screen").classList.remove("hidden");
  }
};
G.playerRoundKills = 0; G.bombDropped = null; G.plantChannel = 0; G.defuseChannel = 0;

// ===== Blok 3: BuyMenu — menu beli senjata, armor, dan util =====
var BuyMenu = {
  open: function () {
    var screen = document.getElementById('buy-screen');
    screen.classList.remove('hidden');
    BuyMenu.render();
    document.getElementById('hud').style.display = 'block';
  },

  render: function () {
    var wrap = document.getElementById('buy-items');
    wrap.innerHTML = '';
    document.getElementById('buy-credits').textContent = '$' + Player.credits.toLocaleString();
    function ownedLabel(item) {
      if (item.id === Player.primaryId) return 'EQUIPPED';
      if (item.id === 'armor' && Player.armor >= 50) return 'EQUIPPED';
      if (item.id === 'flash') return 'OWNED × ' + Player.util.flash;
      if (item.id === 'smoke') return 'OWNED × ' + Player.util.smoke;
      if (item.id === 'frag') return 'OWNED × ' + Player.util.frag;
      return '';
    }
    BUY_ITEMS.forEach(function (item) {
      var label = ownedLabel(item);
      var btn = document.createElement('button');
      btn.className = 'buy-card';
      btn.innerHTML = '<div class="bn">[' + item.key + '] ' + item.name + '</div>' +
        '<div class="bd">' + item.desc + '</div>' +
        '<div class="bp">$' + item.price.toLocaleString() + '</div>' +
        (label ? '<div class="owned">' + label + '</div>' : '');
      btn.disabled = Player.credits < item.price || label === 'EQUIPPED';
      btn.addEventListener('click', function () { BuyMenu.buy(item.id); });
      wrap.appendChild(btn);
    });
  },

  buy: function (id) {
    var item = null;
    for (var i = 0; i < BUY_ITEMS.length; i++) {
      if (BUY_ITEMS[i].id === id) { item = BUY_ITEMS[i]; break; }
    }
    if (!item || Player.credits < item.price) return;
    if (id === 'vandal' || id === 'spectre' || id === 'operator') {
      Player.primaryId = id;
      WeaponSystem.state[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      WeaponSystem.equip(id);
    } else if (id === 'armor') {
      if (Player.armor >= 50) return;
      Player.armor = 50;
    } else if (id === 'flash' || id === 'smoke' || id === 'frag') {
      Player.util[id] = Math.min(2, Player.util[id] + 1);
    }
    Player.credits -= item.price;
    AudioEngine.uiClick();
    HUD.updateVitals();
    BuyMenu.render();
  },

  tick: function () {
    var el = document.getElementById('buy-timer');
    el.textContent = Math.max(0, G.phaseT).toFixed(1);
  },

  close: function (startLive) {
    var screen = document.getElementById('buy-screen');
    screen.classList.add('hidden');
    if (startLive && G.phase === 'buy') {
      G.phase = 'live';
      lockPointer();
    }
  }
};

/* ============================ Input & boot =========================== */
let scene, camera, renderer;
/* Pointer lock with sandbox resilience: if the iframe/browser refuses the
   lock (rejected promise, pointerlockerror, or still unlocked after 700ms),
   fall back to click-and-drag mouse look so aiming always works. */
const FallbackLook = { active: false, dragging: false, lastLockTry: 0 };
/* Touch input state: multi-touch tracked by Touch.identifier so the left
   joystick, right-side look swipe and the FIRE/SPIKE buttons all work at
   the same time. Touch devices never need pointer lock to play. */
const TouchInput = {
  enabled: ("ontouchstart" in window) && navigator.maxTouchPoints > 0 &&
    !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches),
  joyId: null, joyOX: 0, joyOY: 0, joyX: 0, joyY: 0, joyActive: false,
  lookId: null, lookLX: 0, lookLY: 0, lookSX: 0, lookSY: 0, lookT0: 0,
  lastTouchT: 0
};
if (TouchInput.enabled) document.body.classList.add("touch-mode");
function inputActive() { return !!document.pointerLockElement || FallbackLook.active || TouchInput.enabled; }
function enableFallbackLook() {
  if (document.pointerLockElement) return;
  FallbackLook.active = true;
  document.getElementById("click-resume").style.display = "none";
}
function lockPointer() {
  // Touch devices play without pointer lock: DEPLOY and the buy-phase exit
  // must start gameplay instantly and never wait on (or be blocked by) it.
  if (TouchInput.enabled) return;
  const c = document.getElementById("game-canvas");
  FallbackLook.lastLockTry = performance.now();
  if (!c.requestPointerLock) { enableFallbackLook(); return; }
  try {
    const r = c.requestPointerLock();
    if (r && typeof r.catch === "function") r.catch(() => { setTimeout(() => { if (!document.pointerLockElement) enableFallbackLook(); }, 60); });
  } catch (e) { enableFallbackLook(); return; }
  setTimeout(() => { if (!document.pointerLockElement && G.phase === "live") enableFallbackLook(); }, 700);
}
function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d141c);
  scene.fog = new THREE.Fog(0x0d141c, 42, 118);
  camera = new THREE.PerspectiveCamera(Settings.fov, innerWidth / innerHeight, 0.05, 220);
  camera.position.set(0, 1.62, 27);
  scene.add(camera);
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("game-canvas"), antialias: true, powerPreference: "high-performance" });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // capped for stable FPS on Android phones
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  // lights
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.55);
  sun.position.set(28, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120; sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbdd8ee, 0x2a2620, 0.55));
  const siteLightA = new THREE.PointLight(0xff7a1a, 0.7, 16); siteLightA.position.set(sites.A.x, 3.4, sites.A.z); scene.add(siteLightA);
  const siteLightB = new THREE.PointLight(0x35c4ff, 0.7, 16); siteLightB.position.set(sites.B.x, 3.4, sites.B.z); scene.add(siteLightB);
  MapBuilder.build(scene);
  WeaponSystem.init(camera, scene);
  // bomb mesh
  const bomb = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.4, metalness: 0.7 }));
  body.position.y = 0.05; bomb.add(body);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.1), new THREE.MeshStandardMaterial({ color: 0x110000, emissive: 0xff2010, emissiveIntensity: 2 }));
  led.position.set(0, 0.23, 0); bomb.add(led);
  bomb.userData.led = led;
  bomb.visible = false;
  scene.add(bomb);
  Game.bombMesh = bomb;
  // planted-Spike FX: expanding holographic shockwave ring + rising light pulses
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0xff3524, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  shock.rotation.x = -Math.PI / 2; shock.visible = false;
  scene.add(shock);
  const pulseLight = new THREE.PointLight(0xff4030, 0, 12);
  pulseLight.visible = false;
  scene.add(pulseLight);
  Game.bombFx = { ring: shock, light: pulseLight };
  window.addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function setupInput() {
  const canvas = document.getElementById("game-canvas");
  document.addEventListener("keydown", e => {
    keys[e.code] = true;
    if (["Space", "ControlLeft", "ControlRight", "Tab"].includes(e.code)) e.preventDefault();
    if (e.code === "Escape" && FallbackLook.active && G.phase === "live" && G.started) {
      // no pointer lock to release in fallback mode: ESC toggles pause directly
      document.getElementById("pause-screen").classList.toggle("hidden");
      return;
    }
    if (G.phase === "buy") {
      const item = BUY_ITEMS.find(i => i.key === e.key);
      if (item) BuyMenu.buy(item.id);
      if (e.code === "KeyB" || e.code === "Enter") BuyMenu.close(true);
      return;
    }
    if (G.phase === "live" && !Player.alive && e.code === "Space") { cycleSpectate(); return; }
    if (G.phase !== "live") return;
    if (e.code === "Digit1") WeaponSystem.equip(Player.primaryId || "pistol");
    if (e.code === "Digit2") WeaponSystem.equip("pistol");
    if (e.code === "Digit3") WeaponSystem.equip("knife");
    if (e.code === "KeyR") WeaponSystem.startReload();
    if (e.code === "KeyN") WeaponSystem.toggleLaser();
    if (e.code === "KeyI") WeaponSystem.startInspect();
    if (e.code === "KeyQ") UtilitySystem.throwNade("flash");
    if (e.code === "KeyE") UtilitySystem.throwNade("smoke");
    if (e.code === "KeyG") UtilitySystem.throwNade("frag");
  });
  document.addEventListener("keyup", e => { keys[e.code] = false; });
  document.addEventListener("mousemove", e => {
    if (G.phase !== "live") return;
    const dragLook = FallbackLook.active && FallbackLook.dragging && document.getElementById("pause-screen").classList.contains("hidden");
    if (!document.pointerLockElement && !dragLook) return;
    mouseDX = e.movementX; mouseDY = e.movementY;
    Player.yaw -= e.movementX * 0.0021 * Settings.sens;
    Player.pitch -= e.movementY * 0.0021 * Settings.sens;
    Player.pitch = Math.max(-1.45, Math.min(1.45, Player.pitch));
  });
  document.addEventListener("mousedown", e => {
    AudioEngine.init(); // resume the context on any real gesture (autoplay policy)
    if (e.button === 0 && !Player.alive && G.phase === "live" && G.started && performance.now() - TouchInput.lastTouchT > 600 && !(e.target && e.target.closest && e.target.closest("button"))) cycleSpectate();
    if (e.button === 0) {
      mouseDown = true;
      if (e.target && e.target.id === "game-canvas") {
        FallbackLook.dragging = true;
        // throttled retry: recover real pointer lock if the environment allows it again
        if (FallbackLook.active && performance.now() - FallbackLook.lastLockTry > 1600 && G.phase === "live") lockPointer();
      }
    }
    if (e.button === 2) WeaponSystem.adsHeld = true;
  });
  document.addEventListener("mouseup", e => {
    if (e.button === 0) { mouseDown = false; FallbackLook.dragging = false; }
    if (e.button === 2) WeaponSystem.adsHeld = false;
  });
  document.addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("pointerlockchange", () => {
    const locked = !!document.pointerLockElement;
    const pauseScr = document.getElementById("pause-screen");
    const resumeScr = document.getElementById("click-resume");
    if (locked) {
      FallbackLook.active = false;
      pauseScr.classList.add("hidden");
      resumeScr.style.display = "none";
    } else if (!locked && G.phase === "live" && G.started && !FallbackLook.active) {
      pauseScr.classList.remove("hidden");
    }
  });
  document.addEventListener("pointerlockerror", () => { enableFallbackLook(); });
  document.getElementById("click-resume").addEventListener("click", lockPointer);
  // buttons
  document.getElementById("btn-start").addEventListener("click", () => {
    AudioEngine.init();
    AudioEngine.uiClick();
    Settings.startSide = Settings.side; // remembered so PLAY AGAIN / halftime restore the picked side correctly
    document.getElementById("start-screen").classList.add("hidden");
    Game.startMatch();
  });
  document.getElementById("btn-deploy").addEventListener("click", () => { AudioEngine.uiClick(); BuyMenu.close(true); });
  document.getElementById("btn-buy-close").addEventListener("click", () => { AudioEngine.uiClick(); BuyMenu.close(true); });
  document.getElementById("btn-resume").addEventListener("click", () => {
    AudioEngine.uiClick();
    document.getElementById("pause-screen").classList.add("hidden");
    lockPointer();
  });
  document.getElementById("btn-restart").addEventListener("click", () => {
    AudioEngine.uiClick();
    document.getElementById("pause-screen").classList.add("hidden");
    Game.startMatch();
  });
  document.getElementById("btn-again").addEventListener("click", () => {
    AudioEngine.uiClick();
    document.getElementById("end-screen").classList.add("hidden");
    Game.startMatch();
  });
  document.getElementById("btn-menu").addEventListener("click", () => {
    AudioEngine.uiClick();
    document.getElementById("end-screen").classList.add("hidden");
    Game.toMainMenu();
  });
  // title screen mode / difficulty selectors
  document.getElementById("seg-mode").addEventListener("click", e => {
    const b = e.target.closest("[data-mode]"); if (!b) return;
    Settings.mode = b.dataset.mode;
    for (const x of document.querySelectorAll("#seg-mode .seg-btn")) x.classList.toggle("sel", x === b);
    AudioEngine.init(); AudioEngine.uiClick();
  });
  document.getElementById("seg-side").addEventListener("click", e => {
    const b = e.target.closest("[data-side]"); if (!b) return;
    Settings.side = b.dataset.side;
    for (const x of document.querySelectorAll("#seg-side .seg-btn")) x.classList.toggle("sel", x === b);
    AudioEngine.init(); AudioEngine.uiClick();
  });
  document.getElementById("seg-diff").addEventListener("click", e => {
    const b = e.target.closest("[data-diff]"); if (!b) return;
    Settings.diff = b.dataset.diff;
    for (const x of document.querySelectorAll("#seg-diff .seg-btn")) x.classList.toggle("sel", x === b);
    AudioEngine.init(); AudioEngine.uiClick();
  });
  // settings sliders
  const sens = document.getElementById("set-sens"), vol = document.getElementById("set-vol"), fov = document.getElementById("set-fov");
  sens.addEventListener("input", () => { Settings.sens = parseFloat(sens.value); document.getElementById("set-sens-val").textContent = Settings.sens.toFixed(2); });
  vol.addEventListener("input", () => { AudioEngine.setVolume(parseFloat(vol.value)); document.getElementById("set-vol-val").textContent = Math.round(vol.value * 100) + "%"; });
  fov.addEventListener("input", () => { Settings.fov = parseInt(fov.value); document.getElementById("set-fov-val").textContent = Settings.fov + "°"; });
}

// ============================================================
// BLOK 1 — Spectate, touchAimAssist, cycleSpectate
// ============================================================

// ---- Spectate: state kamera penonton ----
const Spectate = { bot: null, idx: 0, init: false, label: null };

// ---- Helper: apakah titik bidik berada dalam sudut + LOS jelas ----
// `point` tidak boleh rusak: arah dihitung dari salinan, lalu LOS
// dicek terhadap titik aslinya.
function aimOnTarget(dir, eye, point, maxAngle) {
  const to = point.clone().sub(eye).normalize();
  if (dir.angleTo(to) >= maxAngle) return false;
  return !losBlocked(eye, point);
}

// ---- touchAimAssist: bantuan bidik sentuh ----
// Kembalikan 0.72 bila ada musuh dekat garis bidik dan terlihat,
// 1 bila tidak ada (tanpa bantuan).
function touchAimAssist() {
  if (!Player.alive || G.phase !== 'live') return 1;
  const eye = Player.eye();
  const dir = Player.lookDir();
  for (const b of Game.bots) {
    if (!b.alive || b.team === Settings.side) continue;
    if (eye.distanceTo(b.chest()) > 42) continue;
    if (aimOnTarget(dir, eye, b.chest(), 0.055)) return 0.72;
    if (aimOnTarget(dir, eye, b.headPos(), 0.04)) return 0.72;
  }
  return 1;
}

// ---- cycleSpectate: pindah ke rekan setim berikutnya ----
function cycleSpectate() {
  const mates = Game.bots.filter(function (b) {
    return b.alive && b.team === Settings.side;
  });
  if (mates.length === 0) return;
  Spectate.idx = (Spectate.idx + 1) % mates.length;
  Spectate.bot = mates[Spectate.idx];
  Spectate.init = false;
  Spectate.label = null;
}

// ============================================================
// BLOK 2 — setupTouchControls
// ============================================================

// ---- setupTouchControls: kontrol sentuh + tombol layar ----
function setupTouchControls() {
  const joyBase = document.getElementById('joy-base');
  const joyKnob = document.getElementById('joy-knob');
  const JOY_R = 52;

  // ---- Helper: apakah target termasuk elemen UI ----
  function isUI(target) {
    if (!target || !target.closest) return false;
    return !!target.closest('button, .panel, .screen, input, select, a, .util-slot, #rotate-hint');
  }

  // ---- Helper: posisi knob joystick ----
  function setKnob(dx, dy) {
    if (!joyKnob) return;
    joyKnob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
  }

  // ---- Helper: lepas joystick ----
  function endJoy() {
    TouchInput.joyId = null;
    TouchInput.joyActive = false;
    TouchInput.joyX = 0;
    TouchInput.joyY = 0;
    if (joyBase) joyBase.style.display = 'none';
    setKnob(0, 0);
  }

  // ---- Helper: tombol tahan (touch + mouse) ----
  function holdBtn(id, down, up) {
    const el = document.getElementById(id);
    if (!el) return;
    function press(e) {
      e.preventDefault();
      AudioEngine.init();
      el.classList.add('pressed');
      down();
    }
    function release() {
      el.classList.remove('pressed');
      if (up) up();
    }
    el.addEventListener('touchstart', press, { passive: false });
    el.addEventListener('mousedown', press);
    el.addEventListener('touchend', release);
    el.addEventListener('touchcancel', release);
    el.addEventListener('mouseup', release);
    el.addEventListener('mouseleave', release);
  }

  // ---- touchstart ----
  document.addEventListener('touchstart', function (e) {
    TouchInput.lastTouchT = performance.now();
    if (!TouchInput.enabled) {
      TouchInput.enabled = true;
      document.body.classList.add('touch-mode');
    }
    AudioEngine.init();
    if (!G.started || (G.phase !== 'live' && G.phase !== 'buy')) return;
    const half = innerWidth / 2;
    for (const t of e.changedTouches) {
      if (isUI(t.target)) continue;
      if (t.clientX < half && TouchInput.joyId === null) {
        TouchInput.joyId = t.identifier;
        TouchInput.joyOX = t.clientX;
        TouchInput.joyOY = t.clientY;
        TouchInput.joyX = 0;
        TouchInput.joyY = 0;
        TouchInput.joyActive = true;
        if (joyBase) {
          joyBase.style.left = t.clientX + 'px';
          joyBase.style.top = t.clientY + 'px';
          joyBase.style.display = 'block';
        }
        setKnob(0, 0);
        e.preventDefault();
      } else if (t.clientX >= half && TouchInput.lookId === null) {
        TouchInput.lookId = t.identifier;
        TouchInput.lookLX = t.clientX;
        TouchInput.lookLY = t.clientY;
        TouchInput.lookSX = t.clientX;
        TouchInput.lookSY = t.clientY;
        TouchInput.lookT0 = performance.now();
        e.preventDefault();
      }
    }
  }, { passive: false });

  // ---- touchmove ----
  document.addEventListener('touchmove', function (e) {
    if (!G.started) return;
    for (const t of e.changedTouches) {
      if (t.identifier === TouchInput.joyId) {
        let dx = t.clientX - TouchInput.joyOX;
        let dy = t.clientY - TouchInput.joyOY;
        const d = Math.hypot(dx, dy);
        if (d > JOY_R) {
          dx = dx / d * JOY_R;
          dy = dy / d * JOY_R;
        }
        TouchInput.joyX = dx / JOY_R;
        TouchInput.joyY = dy / JOY_R;
        setKnob(dx, dy);
        e.preventDefault();
      } else if (t.identifier === TouchInput.lookId) {
        const dx = t.clientX - TouchInput.lookLX;
        const dy = t.clientY - TouchInput.lookLY;
        TouchInput.lookLX = t.clientX;
        TouchInput.lookLY = t.clientY;
        if (Player.alive && (G.phase === 'live' || G.phase === 'buy')) {
          const assist = touchAimAssist();
          Player.yaw -= dx * 0.0042 * Settings.sens * assist;
          Player.pitch -= dy * 0.0042 * Settings.sens * assist;
          Player.pitch = Math.max(-1.45, Math.min(1.45, Player.pitch));
          mouseDX = dx;
          mouseDY = dy;
        }
        e.preventDefault();
      }
    }
  }, { passive: false });

  // ---- touchend / touchcancel ----
  function onTouchEnd(e) {
    TouchInput.lastTouchT = performance.now();
    for (const t of e.changedTouches) {
      if (t.identifier === TouchInput.joyId) endJoy();
      if (t.identifier === TouchInput.lookId) {
        const quick = performance.now() - TouchInput.lookT0 < 260;
        const moved = Math.hypot(t.clientX - TouchInput.lookSX, t.clientY - TouchInput.lookSY);
        TouchInput.lookId = null;
        if (quick && moved < 12 && !Player.alive && G.phase === 'live') cycleSpectate();
      }
    }
  }
  document.addEventListener('touchend', onTouchEnd);
  document.addEventListener('touchcancel', onTouchEnd);

  // ---- gesturestart ----
  document.addEventListener('gesturestart', function (e) {
    e.preventDefault();
  });

  // ---- Tombol aksi ----
  holdBtn('btn-fire', function () { mouseDown = true; }, function () { mouseDown = false; });
  holdBtn('btn-spike', function () { keys.KeyF = true; }, function () { keys.KeyF = false; });
  holdBtn('btn-jump', function () { keys.Space = true; }, function () { keys.Space = false; });
  holdBtn('btn-reload-t', function () {
    if (G.phase === 'live') WeaponSystem.startReload();
  });
  holdBtn('btn-swap-t', function () {
    if (G.phase !== 'live') return;
    if (WeaponSystem.current === 'pistol' && Player.primaryId) {
      WeaponSystem.equip(Player.primaryId);
    } else {
      WeaponSystem.equip('pistol');
    }
  });
  holdBtn('btn-buy-t', function () {
    if (G.phase !== 'buy') return;
    const buyScreen = document.getElementById('buy-screen');
    if (buyScreen && buyScreen.classList.contains('hidden')) {
      BuyMenu.open();
    } else {
      BuyMenu.close(true);
    }
  });
  holdBtn('btn-nextcam', function () {
    if (!Player.alive && G.phase === 'live') cycleSpectate();
  });

  // ---- Slot skill yang bisa diklik ----
  const nadeSlots = [
    ['util-q', 'flash'],
    ['util-e', 'smoke'],
    ['util-g', 'frag']
  ];
  for (const pair of nadeSlots) {
    const slot = document.getElementById(pair[0]);
    if (!slot) continue;
    slot.addEventListener('click', function () {
      AudioEngine.init();
      UtilitySystem.throwNade(pair[1]);
    });
  }

  // ---- Tombol tutup rotate-hint ----
  const rotateDismiss = document.getElementById('rotate-dismiss');
  if (rotateDismiss) {
    rotateDismiss.addEventListener('click', function () {
      const hint = document.getElementById('rotate-hint');
      if (hint) hint.classList.add('dismissed');
    });
  }

  // ---- Indikator mode penonton ----
  setInterval(function () {
    document.body.classList.toggle(
      'spectating',
      !!G.started && !Player.alive && G.phase === 'live'
    );
  }, 250);
}

/* ============================== Main loop ============================ */
const clockHolder = { clock: null };
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clockHolder.clock.getDelta());
  const paused = !document.getElementById("pause-screen").classList.contains("hidden");
  if (G.started && !paused) {
    if (WeaponSystem.group) WeaponSystem.group.visible = Player.alive;
    if (G.phase === "live" && inputActive()) Player.update(dt);
    else if (G.phase === "live" && !Player.alive) Player.update(0);
    Game.update(dt);
    WeaponSystem.update(dt, performance.now());
    // camera transform
    const shakeX = Player.shake ? (Math.random() - 0.5) * 0.05 * Player.shake : 0;
    const shakeY = Player.shake ? (Math.random() - 0.5) * 0.05 * Player.shake : 0;
    if (!Player.alive) {
      // spectator cam: smooth third-person over-the-shoulder follow of a
      // living teammate (camera clamped out of walls/crates); falls back to
      // the sink-and-tilt death cam when no teammate is alive
      const mates = (G.phase === "live" || G.phase === "roundEnd") ? Game.bots.filter(b => b.alive && b.team === Settings.side) : [];
      if (mates.length) {
        if (!Spectate.bot || !Spectate.bot.alive || Spectate.bot.team !== Settings.side) {
          Spectate.idx = Math.max(0, Math.min(Spectate.idx, mates.length - 1));
          Spectate.bot = mates[Spectate.idx]; Spectate.init = false; Spectate.label = null;
        }
        const bot = Spectate.bot;
        const bfx = -Math.sin(bot.yaw), bfz = -Math.cos(bot.yaw);
        const desired = new THREE.Vector3(bot.pos.x - bfx * 3.4, bot.pos.y + 2.05, bot.pos.z - bfz * 3.4);
        collideMove(desired, 0.35, 2);
        desired.y = Math.max(0.6, desired.y);
        if (!Spectate.init) { camera.position.copy(desired); Spectate.init = true; }
        else camera.position.lerp(desired, Math.min(1, dt * 5));
        camera.rotation.order = "YXZ";
        camera.lookAt(bot.pos.x + bfx * 3, bot.pos.y + 1.35, bot.pos.z + bfz * 3);
        // shortened spectate label so it never truncates with an ellipsis in portrait
        const lbl = `SPECTATING: ${bot.name.toUpperCase()} · ${Math.ceil(bot.hp)} HP`;
        if (Spectate.label !== lbl) { Spectate.label = lbl; document.getElementById("death-sub").textContent = lbl; }
      } else {
        Spectate.init = false;
        camera.position.set(Player.pos.x, Math.max(0.5, camera.position.y - dt * 0.4), Player.pos.z);
        camera.rotation.z += (0.6 - camera.rotation.z) * dt * 2;
      }
    } else {
      camera.position.set(Player.pos.x + shakeX, Player.pos.y + Player.eyeHeight + shakeY, Player.pos.z);
      camera.rotation.order = "YXZ";
      camera.rotation.set(Player.pitch + WeaponSystem.recoilPitch + shakeY * 2, Player.yaw + WeaponSystem.recoilYaw, 0);
    }
    mouseDX *= 0.6; mouseDY *= 0.6;
  }
  if (!G.started) {
    // title-screen flythrough: slow cinematic orbit sweeping the facility
    if (WeaponSystem.group) WeaponSystem.group.visible = false;
    const t = performance.now() * 0.001;
    // high southern sweep: the camera drones over the attacker half at
    // h≈16, panning between the two sites. That height matters — the sight
    // line to a site center clears the 4.6u site walls (≈5u at the wall),
    // so the holographic floor rings, light pillars and corner beacons
    // stay visible on the open right-hand side of the title screen
    const sweep = Math.sin(t * 0.06);
    camera.position.set(sweep * 21, 16 + Math.sin(t * 0.11) * 1.2, -2 + Math.sin(t * 0.12) * 7);
    camera.lookAt(sweep * 14, 0.6, -16);
  }
  // ambient map life in menu and match: holo rings spin, emergency beacons blink
  if (MapBuilder.rings) for (let i = 0; i < MapBuilder.rings.length; i++) MapBuilder.rings[i].rotation.z += dt * (i ? -0.25 : 0.25);
  if (MapBuilder.beacons) {
    const bt = performance.now() * 0.001;
    for (const b of MapBuilder.beacons) b.mat.emissiveIntensity = (Math.sin(bt * 2.6 + b.phase) > 0.15) ? 3.2 : 0.25;
    if (MapBuilder.beaconLight) MapBuilder.beaconLight.intensity = (Math.sin(bt * 2.6) > 0.15) ? 1.4 : 0;
  }
  // Fallback: if pointer lock was rejected (e.g. buy timer expired without a
  // click), offer a click target to re-engage it.
  if (G.started && G.phase === "live" && !TouchInput.enabled && !document.pointerLockElement && !FallbackLook.active &&
      document.getElementById("pause-screen").classList.contains("hidden") &&
      document.getElementById("end-screen").classList.contains("hidden")) {
    document.getElementById("click-resume").style.display = "flex";
  }
  renderer.render(scene, camera);
}

function bootGame() {
  HUD.init();
  initThree(); setupInput(); setupTouchControls(); clockHolder.clock = new THREE.Clock(); animate();
}
if (document.readyState === "complete") bootGame();
else window.addEventListener("load", bootGame);
// Debug hook for screenshot driving (entry tooling only): exposes live state.
window.__ZH = { G, Game, Player, HUD, Settings, get scene() { return scene; }, get camera() { return camera; }, get renderer() { return renderer; } };
} // __gameMain
__gameMain();
