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

/* ============================ AudioEngine ============================ */
const AudioEngine = {
  ctx: null, master: null, volume: 0.8,
  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  },
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; },
  now() { return this.ctx ? this.ctx.currentTime : 0; },
  noiseBuffer(dur) {
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  },
  // Positional-ish: volume falls off with distance, slight pan by sign
  env(node, t0, a, peak, dec) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
  },
  shot(kind, dist) {
    if (!this.ctx) return;
    const t = this.now(), vol = Math.max(0.04, 1 - (dist || 0) / 55);
    const g = this.ctx.createGain(); g.connect(this.master);
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.4);
    const f = this.ctx.createBiquadFilter();
    if (kind === "smg") { f.type = "lowpass"; f.frequency.value = 1400; }
    else if (kind === "sniper") { f.type = "lowpass"; f.frequency.value = 3200; }
    else { f.type = "bandpass"; f.frequency.value = kind === "pistol" ? 1900 : 2400; f.Q.value = 0.6; }
    src.connect(f); f.connect(g);
    const dur = kind === "sniper" ? 0.5 : kind === "pistol" ? 0.22 : 0.3;
    this.env(g, t, 0.004, (kind === "sniper" ? 0.95 : 0.6) * vol, dur);
    src.start(t); src.stop(t + dur + 0.1);
    // low thump
    const o = this.ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(kind === "sniper" ? 120 : 150, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    const og = this.ctx.createGain(); o.connect(og); og.connect(this.master);
    this.env(og, t, 0.003, (kind === "sniper" ? 0.9 : 0.45) * vol, kind === "sniper" ? 0.42 : 0.2);
    o.start(t); o.stop(t + 0.6);
  },
  dryFire() { this.click(1800, 0.08, 0.15); },
  click(freq, dur, vol) {
    if (!this.ctx) return;
    const t = this.now(), o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "square"; o.frequency.value = freq || 1200;
    o.connect(g); g.connect(this.master);
    this.env(g, t, 0.002, vol || 0.12, dur || 0.05);
    o.start(t); o.stop(t + (dur || 0.05) + 0.05);
  },
  uiClick() { this.click(950, 0.045, 0.1); },
  reload(stage) {
    if (!this.ctx) return;
    const base = this.now() + stage * 0.28;
    [0, 1].forEach(i => {
      const t = base + i * 0.12;
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.06);
      const f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 2200;
      const g = this.ctx.createGain(); src.connect(f); f.connect(g); g.connect(this.master);
      this.env(g, t, 0.002, 0.22, 0.05); src.start(t); src.stop(t + 0.1);
    });
    this.click(700 + stage * 150, 0.05, 0.14);
  },
  footstep(run, dist) {
    if (!this.ctx) return;
    const t = this.now(), vol = Math.max(0.02, (run ? 0.16 : 0.07) * (1 - (dist || 0) / 22));
    if (vol <= 0.021) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.09);
    const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = run ? 700 : 480;
    const g = this.ctx.createGain(); src.connect(f); f.connect(g); g.connect(this.master);
    this.env(g, t, 0.004, vol, 0.07); src.start(t); src.stop(t + 0.14);
  },
  hitmarker(head) {
    if (!this.ctx) return;
    const t = this.now(), o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "triangle"; o.frequency.value = head ? 3400 : 1900;
    o.connect(g); g.connect(this.master);
    this.env(g, t, 0.001, head ? 0.34 : 0.2, head ? 0.14 : 0.07);
    o.start(t); o.stop(t + 0.2);
    if (head) {
      this.click(4600, 0.06, 0.16); // metallic dink
      // sharper headshot crunch: a tight high-passed noise snap under the dink
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.07);
      const f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 3200;
      const ng = this.ctx.createGain(); src.connect(f); f.connect(ng); ng.connect(this.master);
      this.env(ng, t, 0.001, 0.3, 0.06); src.start(t); src.stop(t + 0.1);
    }
  },
  // kill confirmation: firm two-tone blip, brighter on a headshot kill
  killConfirm(head) {
    if (!this.ctx) return;
    this.click(head ? 1750 : 1250, 0.09, 0.2);
    setTimeout(() => this.click(head ? 2350 : 1650, 0.13, 0.18), 70);
  },
  hurt() { this.click(220, 0.12, 0.22); },
  tinnitus(strength) {
    if (!this.ctx || strength <= 0.02) return;
    const t = this.now(), o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "sine"; o.frequency.value = 5900;
    o.connect(g); g.connect(this.master);
    const dur = 0.6 + strength * 2.4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * strength + 0.02, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.1);
  },
  hiss(dur) {
    if (!this.ctx) return;
    const t = this.now(), src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(dur);
    const f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 3800;
    const g = this.ctx.createGain(); src.connect(f); f.connect(g); g.connect(this.master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.15);
    g.gain.setValueAtTime(0.16, t + Math.max(0.2, dur - 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.start(t); src.stop(t + dur + 0.05);
  },
  explosion(dist) {
    if (!this.ctx) return;
    const t = this.now(), vol = Math.max(0.1, 1 - dist / 45);
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.9);
    const f = this.ctx.createBiquadFilter(); f.type = "lowpass";
    f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(90, t + 0.7);
    const g = this.ctx.createGain(); src.connect(f); f.connect(g); g.connect(this.master);
    this.env(g, t, 0.005, 0.95 * vol, 0.8); src.start(t); src.stop(t + 1);
    const o = this.ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    const og = this.ctx.createGain(); o.connect(og); og.connect(this.master);
    this.env(og, t, 0.004, 0.8 * vol, 0.65); o.start(t); o.stop(t + 0.8);
  },
  beep(fast) {
    if (!this.ctx) return;
    const t = this.now(), o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "square"; o.frequency.value = fast ? 1560 : 1180;
    o.connect(g); g.connect(this.master);
    this.env(g, t, 0.002, 0.14, 0.07); o.start(t); o.stop(t + 0.12);
  },
  plantDone() { [0, 0.14, 0.28].forEach((d, i) => setTimeout(() => this.beep(i === 2), d * 1000)); },
  // defuse kit working sound: short servo whir + latch click, looped by the caller
  defuseTick() {
    if (!this.ctx) return;
    const t = this.now();
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.16);
    o.connect(g); g.connect(this.master);
    this.env(g, t, 0.01, 0.05, 0.16); o.start(t); o.stop(t + 0.22);
    this.click(2600, 0.03, 0.07);
  },
  defuseDone() { [0, 0.12, 0.24, 0.4].forEach((d, i) => setTimeout(() => this.beep(i >= 2), d * 1000)); },
  // round-end sting: rising pair on a win, falling pair on a loss
  roundSting(playerWon) {
    if (!this.ctx) return;
    const notes = playerWon ? [880, 1318] : [660, 440];
    notes.forEach((f, i) => setTimeout(() => this.click(f, 0.16, 0.16), i * 150));
  },
  throwWhoosh() {
    if (!this.ctx) return;
    const t = this.now(), src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.25);
    const f = this.ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 2;
    f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2100, t + 0.22);
    const g = this.ctx.createGain(); src.connect(f); f.connect(g); g.connect(this.master);
    this.env(g, t, 0.01, 0.1, 0.22); src.start(t); src.stop(t + 0.3);
  }
};

/* ========================== TextureGenerator ========================= */
const TextureGenerator = {
  make(size, draw, repeat) {
    const c = document.createElement("canvas"); c.width = c.height = size;
    draw(c.getContext("2d"), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 4;
    return t;
  },
  speckle(ctx, s, n, colors, aMax) {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
      ctx.globalAlpha = Math.random() * aMax;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    ctx.globalAlpha = 1;
  },
  concrete(rep) {
    return this.make(256, (ctx, s) => {
      ctx.fillStyle = "#8a8d90"; ctx.fillRect(0, 0, s, s);
      this.speckle(ctx, s, 2600, ["#6f7276", "#9ea1a4", "#7c7f83", "#a8abae"], 0.5);
      ctx.strokeStyle = "rgba(40,42,45,.55)"; ctx.lineWidth = 3; ctx.strokeRect(0, 0, s, s);
      ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.lineWidth = 1; ctx.strokeRect(3, 3, s - 6, s - 6);
    }, rep);
  },
  concreteBump(rep) {
    return this.make(256, (ctx, s) => {
      ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, s, s);
      this.speckle(ctx, s, 3000, ["#5a5a5a", "#a5a5a5", "#6e6e6e"], 0.6);
    }, rep);
  },
  gridFloor(rep) {
    return this.make(256, (ctx, s) => {
      ctx.fillStyle = "#3c4147"; ctx.fillRect(0, 0, s, s);
      this.speckle(ctx, s, 1500, ["#31363c", "#484e55", "#2b3036"], 0.5);
      ctx.strokeStyle = "#22262b"; ctx.lineWidth = 5; ctx.strokeRect(0, 0, s, s);
      ctx.strokeStyle = "rgba(140,220,255,.20)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s); ctx.stroke();
      ctx.fillStyle = "rgba(140,220,255,.35)";
      [[10, 10], [s - 14, 10], [10, s - 14], [s - 14, s - 14]].forEach(p => ctx.fillRect(p[0], p[1], 4, 4));
    }, rep);
  },
  metalCrate(rep) {
    return this.make(256, (ctx, s) => {
      ctx.fillStyle = "#5d6a72"; ctx.fillRect(0, 0, s, s);
      this.speckle(ctx, s, 900, ["#4c585f", "#6e7c84", "#55616a"], 0.45);
      ctx.strokeStyle = "#39434a"; ctx.lineWidth = 14; ctx.strokeRect(0, 0, s, s);
      ctx.strokeStyle = "#7d8b93"; ctx.lineWidth = 3; ctx.strokeRect(12, 12, s - 24, s - 24);
      ctx.fillStyle = "#39434a";
      [[22, 22], [s - 30, 22], [22, s - 30], [s - 30, s - 30]].forEach(p => ctx.fillRect(p[0], p[1], 8, 8));
      ctx.strokeStyle = "rgba(30,36,40,.5)"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(20, s - 20); ctx.lineTo(s - 20, 20); ctx.stroke();
    }, rep);
  },
  hazard(rep) {
    return this.make(256, (ctx, s) => {
      ctx.fillStyle = "#c9a227"; ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = "#191919";
      for (let i = -2; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 64, s); ctx.lineTo(i * 64 + 64, s); ctx.lineTo(i * 64 + 64 + s, 0); ctx.lineTo(i * 64 + s, 0);
        ctx.closePath(); ctx.fill();
      }
      this.speckle(ctx, s, 500, ["#000000", "#ffffff"], 0.16);
    }, rep);
  },
  wallPanel(rep) {
    return this.make(256, (ctx, s) => {
      ctx.fillStyle = "#767c84"; ctx.fillRect(0, 0, s, s);
      this.speckle(ctx, s, 1300, ["#656b72", "#878d94", "#596066"], 0.4);
      ctx.fillStyle = "#5b6167"; ctx.fillRect(0, s * 0.62, s, s * 0.38);
      ctx.strokeStyle = "#454b51"; ctx.lineWidth = 4; ctx.strokeRect(0, 0, s, s);
      ctx.fillStyle = "#4a5057";
      for (let x = 16; x < s; x += 48) { ctx.beginPath(); ctx.arc(x, 18, 4, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(x, s - 18, 4, 0, 7); ctx.fill(); }
    }, rep);
  },
  serverRack(rep) {
    return this.make(256, (ctx, s) => {
      ctx.fillStyle = "#22262c"; ctx.fillRect(0, 0, s, s);
      for (let y = 8; y < s - 16; y += 30) {
        ctx.fillStyle = "#31363e"; ctx.fillRect(10, y, s - 20, 24);
        ctx.fillStyle = Math.random() > 0.4 ? "#39d98a" : "#ffb02e";
        ctx.fillRect(18, y + 9, 5, 5);
        ctx.fillStyle = "#57b6ff"; ctx.fillRect(30, y + 9, 5, 5);
        ctx.fillStyle = "#14171b";
        for (let x = 48; x < s - 24; x += 9) ctx.fillRect(x, y + 6, 5, 12);
      }
    }, rep);
  },
  siteDecal(letter, color) {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const ctx = c.getContext("2d");
    ctx.strokeStyle = color; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(128, 128, 108, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(128, 128, 88, 0, Math.PI * 2); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = color; ctx.font = "900 150px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(letter, 128, 136);
    const t = new THREE.CanvasTexture(c); return t;
  },
  holoRing(color) {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const ctx = c.getContext("2d");
    ctx.strokeStyle = color; ctx.lineWidth = 5;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 5) {
      ctx.beginPath(); ctx.arc(128, 128, 112, a, a + Math.PI / 7); ctx.stroke();
    }
    ctx.lineWidth = 3; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(128, 128, 94, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = color;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      ctx.fillRect(128 + Math.cos(a) * 103 - 3, 128 + Math.sin(a) * 103 - 3, 6, 6);
    }
    return new THREE.CanvasTexture(c);
  },
  bulletHole() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
    g.addColorStop(0, "rgba(5,5,5,0.95)");
    g.addColorStop(0.35, "rgba(10,10,10,0.85)");
    g.addColorStop(0.7, "rgba(20,20,20,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = "rgba(15,15,15,0.5)"; ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(32, 32);
      ctx.lineTo(32 + Math.cos(a) * (14 + Math.random() * 14), 32 + Math.sin(a) * (14 + Math.random() * 14)); ctx.stroke();
    }
    return new THREE.CanvasTexture(c);
  },
  smokeSprite() {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, "rgba(235,238,242,0.85)");
    g.addColorStop(0.55, "rgba(210,214,220,0.55)");
    g.addColorStop(1, "rgba(200,205,212,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  },
  muzzleSprite() {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    g.addColorStop(0, "rgba(255,255,230,1)");
    g.addColorStop(0.3, "rgba(255,190,60,0.9)");
    g.addColorStop(1, "rgba(255,120,20,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
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
function buildCharacterMesh(team) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: team === "atk" ? 0x3a3f45 : 0x2e3a4a, roughness: 0.8, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color: team === "atk" ? 0xff7a1a : 0x35c4ff, roughness: 0.5, metalness: 0.3, emissive: team === "atk" ? 0x903c00 : 0x0d4d6e, emissiveIntensity: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.7, metalness: 0.4 });
  const mk = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const legL = mk(new THREE.BoxGeometry(0.21, 0.78, 0.24), dark, -0.14, 0.39, 0);
  const legR = mk(new THREE.BoxGeometry(0.21, 0.78, 0.24), dark, 0.14, 0.39, 0);
  const torso = mk(new THREE.BoxGeometry(0.56, 0.66, 0.32), suit, 0, 1.11, 0);
  torso.userData.part = "body";
  mk(new THREE.BoxGeometry(0.58, 0.14, 0.34), accent, 0, 1.32, 0);       // chest rig stripe
  const head = mk(new THREE.BoxGeometry(0.3, 0.3, 0.3), dark, 0, 1.62, 0);
  head.userData.part = "head";
  mk(new THREE.BoxGeometry(0.32, 0.09, 0.05), accent, 0, 1.64, 0.16);    // visor
  mk(new THREE.BoxGeometry(0.13, 0.5, 0.13), suit, -0.36, 1.14, 0.05);   // arms
  mk(new THREE.BoxGeometry(0.13, 0.5, 0.13), suit, 0.36, 1.14, 0.05);
  const gun = mk(new THREE.BoxGeometry(0.09, 0.16, 0.72), dark, 0.18, 1.18, 0.34);
  g.userData.parts = { legL, legR, torso, head, gun };
  return g;
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
function buildViewmodel(kind) {
  const g = new THREE.Group();
  const gun = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.42, metalness: 0.75 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.8, metalness: 0.3 });
  const acc = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, metalness: 0.4 });
  const accB = new THREE.MeshStandardMaterial({ color: 0x35c4ff, roughness: 0.5, metalness: 0.4 });
  const mk = (w, h, d, mat, x, y, z, rx) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); if (rx) m.rotation.x = rx; g.add(m); return m;
  };
  let muzzleZ = -0.6;
  if (kind === "vandal") {
    mk(0.075, 0.11, 0.52, gun, 0, 0, -0.18);
    mk(0.05, 0.05, 0.3, gun, 0, 0.01, -0.55);
    mk(0.06, 0.16, 0.09, grip, 0, -0.12, -0.02, 0.25);            // mag
    mk(0.055, 0.1, 0.07, grip, 0, -0.09, 0.14, -0.3);             // grip
    mk(0.02, 0.07, 0.02, acc, 0, 0.1, -0.42);                    // front sight
    mk(0.07, 0.05, 0.12, gun, 0, 0.1, 0.02);                     // rear sight
    mk(0.078, 0.03, 0.2, acc, 0, -0.045, -0.3);                  // accent rail
    muzzleZ = -0.72;
  } else if (kind === "spectre") {
    mk(0.07, 0.1, 0.4, gun, 0, 0, -0.1);
    const sup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 10), grip);
    sup.rotation.x = Math.PI / 2; sup.position.set(0, 0.005, -0.42); g.add(sup);
    mk(0.055, 0.17, 0.08, grip, 0, -0.12, 0.0, 0.12);
    mk(0.05, 0.09, 0.06, grip, 0, -0.085, 0.13, -0.3);
    mk(0.06, 0.045, 0.1, accB, 0, 0.09, -0.02);
    muzzleZ = -0.55;
  } else if (kind === "operator") {
    mk(0.06, 0.09, 0.78, gun, 0, 0, -0.3);
    mk(0.028, 0.028, 0.3, gun, 0, 0.015, -0.8);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.22, 12), grip);
    scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.1, -0.12); g.add(scope);
    mk(0.05, 0.05, 0.05, gun, 0, 0.05, -0.12);
    mk(0.055, 0.15, 0.08, grip, 0, -0.11, 0.12, 0.2);
    mk(0.05, 0.09, 0.16, grip, 0, -0.06, 0.3, -0.15);            // stock
    mk(0.062, 0.025, 0.3, acc, 0, -0.05, -0.45);
    muzzleZ = -0.97;
  } else if (kind === "pistol") {
    mk(0.055, 0.08, 0.24, gun, 0, 0.02, -0.08);
    mk(0.05, 0.13, 0.07, grip, 0, -0.08, 0.05, -0.25);
    mk(0.015, 0.04, 0.015, acc, 0, 0.085, -0.19);
    muzzleZ = -0.22;
  } else { // knife
    const blade = mk(0.012, 0.045, 0.3, new THREE.MeshStandardMaterial({ color: 0xb9c4cc, roughness: 0.25, metalness: 0.9 }), 0, 0.01, -0.22);
    blade.rotation.x = 0.1;
    mk(0.035, 0.035, 0.13, grip, 0, -0.01, 0.02);
    g.rotation.z = -0.25;
  }
  g.userData.muzzleZ = muzzleZ;
  return g;
}

/* ============================== Player =============================== */
const Player = {
  pos: new THREE.Vector3(0, 0, 27), vel: new THREE.Vector3(),
  yaw: Math.PI, pitch: 0, hp: 100, armor: 0, alive: true,
  crouch: false, onGround: true, eyeHeight: 1.62,
  credits: 1500, primaryId: null, util: { flash: 0, smoke: 0, frag: 0 },
  hasBomb: false, blindT: 0, shake: 0, stepT: 0, walkCycle: 0,
  recentHitters: {}, lastAttacker: null, // bot name -> G.time, for assist credit
  speed() {
    let s = this.crouch ? 2.4 : 4.6;
    if (keys["ShiftLeft"] || keys["ShiftRight"]) s = 2.6;
    if (WeaponSystem.current === "knife") s *= 1.12;
    if (WeaponSystem.adsAmt > 0.5) s *= 0.55;
    return s;
  },
  reset(spawn) {
    this.pos.copy(spawn); this.vel.set(0, 0, 0);
    this.yaw = Math.PI; this.pitch = 0;
    this.hp = 100; this.alive = true; this.crouch = false; this.blindT = 0; this.shake = 0;
    this.recentHitters = {}; this.lastAttacker = null;
  },
  damage(amount, fromPos, attackerName) {
    if (!this.alive || G.phase !== "live") return;
    if (attackerName) { this.recentHitters[attackerName] = G.time; this.lastAttacker = attackerName; }
    let dmg = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.5);
      this.armor -= absorbed; dmg -= absorbed;
    }
    this.hp -= dmg;
    HUD.damageFrom(fromPos);
    AudioEngine.hurt();
    if (this.hp <= 0) { this.hp = 0; this.die(fromPos); }
    HUD.updateVitals();
  },
  die(killerPos) {
    this.alive = false;
    G.stats.deaths++;
    // assists: bots other than the killer who damaged the player in the last 6s
    for (const n in this.recentHitters) {
      if (n === this.lastAttacker || G.time - this.recentHitters[n] > 6) continue;
      const arec = G.botStats[n]; if (arec) arec.assists++;
    }
    document.getElementById("death-overlay").style.display = "flex";
    if (this.hasBomb) { Game.dropBomb(this.pos); this.hasBomb = false; }
  },
  update(dt) {
    if (!this.alive) return;
    const sens = Settings.sens;
    // movement input in yaw space: WASD keys + virtual analog joystick
    let f = (keys["KeyW"] ? 1 : 0) - (keys["KeyS"] ? 1 : 0);
    let r = (keys["KeyD"] ? 1 : 0) - (keys["KeyA"] ? 1 : 0);
    if (typeof TouchInput !== "undefined" && TouchInput.joyActive) { f += -TouchInput.joyY; r += TouchInput.joyX; }
    const mag = Math.min(1, Math.hypot(f, r));
    const hasInput = mag > 0.06;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = (-sin * f + cos * r), wishZ = (-cos * f - sin * r);
    const wl = Math.hypot(wishX, wishZ) || 1;
    const sp = this.speed() * mag;
    const accel = this.onGround ? 14 : 2.5;
    this.vel.x += (wishX / wl * sp * (hasInput ? 1 : 0) - this.vel.x) * Math.min(1, accel * dt) * (hasInput ? 1 : 0.92);
    this.vel.z += (wishZ / wl * sp * (hasInput ? 1 : 0) - this.vel.z) * Math.min(1, accel * dt) * (hasInput ? 1 : 0.92);
    if ((keys["Space"]) && this.onGround && !this.crouch) { this.vel.y = 4.6; this.onGround = false; }
    this.vel.y -= 13.5 * dt;
    this.pos.x += this.vel.x * dt; collideMove(this.pos, 0.38, 1.8);
    this.pos.z += this.vel.z * dt; collideMove(this.pos, 0.38, 1.8);
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }
    this.crouch = !!(keys["ControlLeft"] || keys["ControlRight"] || keys["KeyC"]);
    const targetEye = this.crouch ? 1.12 : 1.62;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 11);
    // footsteps + noise
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.moving = hSpeed > 0.6 && this.onGround;
    if (this.moving) {
      this.walkCycle += dt * hSpeed * 1.6;
      this.stepT -= dt;
      const silent = keys["ShiftLeft"] || keys["ShiftRight"] || this.crouch;
      if (this.stepT <= 0) {
        this.stepT = silent ? 0.52 : 0.36;
        AudioEngine.footstep(!silent, 0);
        if (!silent) Game.emitNoise(this.pos, 9.5, "step");
      }
    }
    if (this.blindT > 0) this.blindT -= dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.2);
  },
  eye() { return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z); },
  lookDir() {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch));
  }
};
const keys = {};
const Settings = { sens: 1, fov: 78, mode: "squad", diff: "veteran", side: "atk", startSide: "atk",
  diffReaction() { return this.diff === "rookie" ? 1.7 : this.diff === "elite" ? 0.65 : 1; },
  diffAccuracy() { return this.diff === "rookie" ? 0.68 : this.diff === "elite" ? 1.18 : 1; } };

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

/* ============================= BotAI (FSM) =========================== */
const BotAI = {
  perceive(bot, dt) {
    // returns visible enemy object {who:'player'|bot, pos, ref} or null
    if (bot.blindT > 0) { bot.blindT -= dt; return null; }
    const eye = bot.eye();
    let best = null, bestD = 40;
    const candidates = [];
    if (bot.team === "def" || true) {
      // enemies: opposing team
    }
    if (bot.team !== Settings.side && Player.alive) candidates.push({ who: "player", ref: null, pos: Player.pos, chest: new THREE.Vector3(Player.pos.x, Player.pos.y + 1.15, Player.pos.z) });
    for (const o of Game.bots) {
      if (o.team !== bot.team && o.alive) candidates.push({ who: "bot", ref: o, pos: o.pos, chest: o.chest() });
    }
    for (const c of candidates) {
      const d = eye.distanceTo(c.chest);
      if (d > bestD) continue;
      // vision cone: 100° unless very close
      const fwd = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      const to = new THREE.Vector3(c.pos.x - bot.pos.x, 0, c.pos.z - bot.pos.z).normalize();
      const dot = fwd.dot(to);
      if (d > 3.5 && dot < 0.42) continue;
      if (losBlocked(eye, c.chest)) continue;
      best = c; bestD = d;
    }
    if (best) {
      bot.lastSeenPos = best.pos.clone();
      bot.lastSeenT = G.time;
      if (best.who === "bot") best.ref.spottedT = 1.6;
      if (best.who === "player") G.playerSpottedT = 1.2;
    }
    return best;
  },
  update(bot, dt) {
    if (!bot.alive) return;
    bot.thinkT -= dt;
    // ---- anti-stuck: checked every 0.45s — moving but <0.35u displaced ->
    // 0.9s evade mode: forced strafe perpendicular to facing (85% sideways +
    // 15% slight back-step) plus a small hop to clear collider corners/steps.
    // Still stuck at the next check -> the strafe direction flips. ----
    const wantsMove = bot.pathIdx < bot.path.length || bot.state === "FLANK" || bot.state === "INVESTIGATE_SOUND" || bot.state === "PATROL_SITE" || bot.evadeT > 0;
    bot.stuckTimer += dt;
    if (bot.stuckTimer >= 0.45) {
      const moved = Math.hypot(bot.pos.x - bot.stuckPos.x, bot.pos.z - bot.stuckPos.z);
      if (wantsMove && moved < 0.35 && bot.state !== "PLANT_OR_DEFUSE") {
        if (bot.stuckCount >= 1) bot.evadeDir *= -1; // still stuck: flip strafe side
        bot.stuckCount++;
        bot.evadeT = 0.9;
        if (bot.onGround) { bot.vel.y = 6.5; bot.onGround = false; }
        if (bot.targetPos) bot.setPathTo(bot.targetPos.x, bot.targetPos.z);
      } else if (moved >= 0.35) bot.stuckCount = 0;
      bot.stuckPos.copy(bot.pos); bot.stuckTimer = 0;
    }
    if (bot.evadeT > 0) {
      bot.evadeT -= dt;
      const fwdX = -Math.sin(bot.yaw), fwdZ = -Math.cos(bot.yaw);
      const sideX = -Math.cos(bot.yaw) * bot.evadeDir, sideZ = Math.sin(bot.yaw) * bot.evadeDir;
      const mx = sideX * 0.85 - fwdX * 0.15, mz = sideZ * 0.85 - fwdZ * 0.15;
      bot.pos.x += mx * 3.4 * dt; bot.pos.z += mz * 3.4 * dt;
      collideMove(bot.pos, 0.38, 1.8);
    }
    // vertical physics for the anti-stuck hop (simple gravity, ground at y=0)
    if (!bot.onGround || bot.vel.y !== 0) {
      bot.vel.y -= 16 * dt;
      bot.pos.y += bot.vel.y * dt;
      if (bot.pos.y <= 0) { bot.pos.y = 0; bot.vel.y = 0; bot.onGround = true; }
    }
    const vis = this.perceive(bot, dt);
    const seesEnemy = !!vis;
    if (seesEnemy && bot.state !== "ENGAGE_COVER" && bot.state !== "PLANT_OR_DEFUSE") {
      bot.state = "ENGAGE_COVER";
      bot.reactionT = (0.22 + Math.random() * 0.2) * Settings.diffReaction();
    }
    switch (bot.state) {
      case "ENGAGE_COVER": this.doEngage(bot, dt, vis); break;
      case "PLANT_OR_DEFUSE": this.doChannel(bot, dt); break;
      case "INVESTIGATE_SOUND": {
        if (!bot.investigatePos || G.time - bot.investigateT > 6) { bot.state = bot.team === "def" ? "HOLD_ANGLE" : "PATROL_SITE"; break; }
        if (!bot.moveAlong(dt, 1)) { bot.state = "HOLD_ANGLE"; bot.patrolT = 2; }
        if (bot.lastSeenPos) bot.faceToward(bot.investigatePos.x, bot.investigatePos.z, dt);
        break;
      }
      case "HOLD_ANGLE": this.doHold(bot, dt); break;
      case "PATROL_SITE": this.doPatrol(bot, dt); break;
      case "FLANK": {
        if (!bot.moveAlong(dt, 1.05)) bot.state = "HOLD_ANGLE";
        break;
      }
      default: bot.state = "HOLD_ANGLE";
    }
    // separation steering: keep same-team bots from bunching/blocking in
    // corridors, then re-resolve collision so the push never enters a wall
    applyBotSeparation(bot, Game.bots, dt);
    collideMove(bot.pos, 0.38, 1.8);
    bot.syncMesh();
  },
  doHold(bot, dt) {
    bot.patrolT -= dt;
    // post-plant attackers stay on their guard spot and watch the defender
    // approaches (toward defender spawn / mid) instead of wandering off
    if (bot.team === "atk" && G.bombPlanted) {
      const inc = G.bombPos.clone().lerp(new THREE.Vector3(0, 0, -30), 0.45);
      bot.faceToward(inc.x, inc.z, dt, 1.6);
      return;
    }
    // defenders hold their site angle; attackers (shouldn't idle) push
    if (bot.team === "atk") { bot.state = "PATROL_SITE"; return; }
    if (G.bombPlanted) { this.assignObjective(bot); return; }
    if (bot.patrolT <= 0) {
      bot.patrolT = 5 + Math.random() * 5;
      bot.state = "PATROL_SITE";
    }
    // face likely entry
    const face = bot.role === "A" ? sites.A : bot.role === "B" ? sites.B : { x: 0, z: 4 };
    bot.faceToward(face.x, face.z + 14, dt, 1.2);
  },
  doPatrol(bot, dt) {
    if (G.bombPlanted || (bot.team === "atk" && !G.bombCarrierBot && !Player.hasBomb && !G.bombDropped)) { this.assignObjective(bot); return; }
    if (bot.team === "atk") { this.assignObjective(bot); return; }
    // defender patrol between two nodes near its site
    if (!bot.holdPos || bot.moveAlong(dt, 0.75) === false) {
      const pool = navNodes.map((n, i) => i).filter(i => {
        const n = navNodes[i];
        if (bot.role === "A") return n.site === "A" || (n.x < -6 && n.z < -6 && n.z > -14);
        if (bot.role === "B") return n.site === "B" || (n.x > 6 && n.z < -6 && n.z > -14);
        return n.z < 2 && n.z > -16;
      });
      const pick = pool[(Math.random() * pool.length) | 0];
      bot.holdPos = navNodes[pick];
      bot.setPathTo(bot.holdPos.x, bot.holdPos.z);
      bot.patrolT = 3 + Math.random() * 3;
    }
    if (bot.patrolT > 0) { bot.patrolT -= dt; if (bot.patrolT <= 0) bot.state = "HOLD_ANGLE"; }
  },
  assignObjective(bot) {
    // attackers: converge on target site; carrier plants. defenders: retake & defuse.
    if (bot.team === "atk") {
      if (G.bombPlanted) { // post-plant: take a guard spot around the Spike and hold the angle
        const bp = G.bombPos;
        const ang = (bot.id % 6) * (Math.PI * 2 / 6) + 0.6;
        const gx = bp.x + Math.cos(ang) * 4.6, gz = bp.z + Math.sin(ang) * 4.6;
        const dGuard = Math.hypot(bot.pos.x - gx, bot.pos.z - gz);
        if (dGuard > 1.3) {
          if (!bot.targetPos || Math.hypot(bot.targetPos.x - gx, bot.targetPos.z - gz) > 1.5) bot.setPathTo(gx, gz);
          bot.state = "FLANK"; bot.moveAlong(dtSafe, 1);
        } else bot.state = "HOLD_ANGLE"; // doHold keeps post-plant guards in place, watching the approaches
        return;
      }
      // Spike priority via getAttackerObjective: the closest attacker
      // retrieves a dropped Spike; the carrier goes straight to the site.
      // Non-designated attackers fall through to the escort logic below.
      const obj = getAttackerObjective(bot);
      if (obj) {
        if (obj.action === "PLANT_SPIKE") { bot.state = "PLANT_OR_DEFUSE"; bot.channelT = 0; return; }
        const repathGap = obj.action === "PICKUP_SPIKE" ? 1.5 : 2;
        if (!bot.targetPos || Math.hypot(bot.targetPos.x - obj.targetPos.x, bot.targetPos.z - obj.targetPos.z) > repathGap) bot.setPathTo(obj.targetPos.x, obj.targetPos.z);
        bot.state = "FLANK"; bot.moveAlong(dtSafe, 1);
        if (obj.action === "PICKUP_SPIKE" && G.bombDropped && bot.pos.distanceTo(G.bombDropped) < 1.3) Game.pickupBomb(bot);
        return;
      }
      // escort toward target site
      const s = sites[G.targetSite];
      const d = Math.hypot(bot.pos.x - s.x, bot.pos.z - s.z);
      if (d > 7) { if (!bot.targetPos || Math.hypot(bot.targetPos.x - s.x, bot.targetPos.z - s.z) > 3) bot.setPathTo(s.x + (Math.random() - 0.5) * 6, s.z + (Math.random() - 0.5) * 6); bot.state = "FLANK"; bot.moveAlong(dtSafe, 1); }
      else bot.state = "HOLD_ANGLE";
    } else {
      // defender
      if (G.bombPlanted) {
        const s = sites[G.plantedSite];
        const bp = G.bombPos;
        const d = Math.hypot(bot.pos.x - bp.x, bot.pos.z - bp.z);
        const otherDefusing = Game.bots.some(o => o !== bot && o.alive && o.team === "def" && o.state === "PLANT_OR_DEFUSE");
        // clear-the-area check: an attacker counts as a threat if they are
        // alive near the Spike with line of sight onto it (guarding the plant)
        const bombEye = new THREE.Vector3(bp.x, 1.0, bp.z);
        let threat = null, threatD = Infinity;
        const threats = [[Player.alive && Settings.side === "atk" ? Player : null, Player.pos]];
        for (const o of Game.bots) if (o.alive && o.team === "atk") threats.push([o, o.pos]);
        for (const [who, pos] of threats) {
          if (!who) continue;
          const dd = Math.hypot(pos.x - bp.x, pos.z - bp.z);
          if (dd < 11 && dd < threatD && !losBlocked(new THREE.Vector3(pos.x, 1.3, pos.z), bombEye)) { threat = pos; threatD = dd; }
        }
        const areaSafe = !threat;
        // defuse only once the area is clear — unless the clock forces a
        // desperate attempt in the final seconds
        if (d < 1.6 && !otherDefusing && (areaSafe || G.bombT < 7)) { bot.state = "PLANT_OR_DEFUSE"; bot.channelT = 0; return; }
        if (!areaSafe && d < 11 && G.bombT >= 7) {
          // clear first: push the guarding attacker; perception flips this
          // bot into ENGAGE_COVER as soon as the threat is visible
          if (!bot.targetPos || Math.hypot(bot.targetPos.x - threat.x, bot.targetPos.z - threat.z) > 2) bot.setPathTo(threat.x, threat.z);
          bot.state = "FLANK"; bot.moveAlong(dtSafe, 1.05);
          return;
        }
        if (!bot.targetPos || Math.hypot(bot.targetPos.x - bp.x, bot.targetPos.z - bp.z) > 2) bot.setPathTo(bp.x + (Math.random() - 0.5) * 2, bp.z + (Math.random() - 0.5) * 2);
        bot.state = "FLANK"; bot.moveAlong(dtSafe, 1.05);
      } else {
        bot.state = "HOLD_ANGLE";
      }
    }
  },
  doChannel(bot, dt) {
    // planting (atk carrier) or defusing (def)
    bot.crouching = true;
    const isPlant = bot.team === "atk";
    const need = isPlant ? 3.5 : 4.0;
    if (!isPlant && G.bombT > 8) {
      // a defuse in the open is abandoned if a guarding attacker pushes in
      // close with line of sight — the bot breaks off to clear the area first
      let pushed = false;
      const foes = [];
      if (Player.alive && Settings.side === "atk") foes.push(Player.pos);
      for (const o of Game.bots) if (o.alive && o.team === "atk") foes.push(o.pos);
      for (const fp of foes) {
        if (Math.hypot(fp.x - bot.pos.x, fp.z - bot.pos.z) < 5.5 && !losBlocked(new THREE.Vector3(fp.x, 1.3, fp.z), bot.chest())) { pushed = true; break; }
      }
      if (pushed) { bot.crouching = false; bot.channelT = 0; bot.state = "ENGAGE_COVER"; bot.reactionT = 0.15; return; }
    }
    bot.channelT += dt;
    if (isPlant) bot.faceToward(bot.pos.x + Math.sin(G.time), bot.pos.z - 5, dt, 2);
    if (bot.channelT >= need) {
      bot.crouching = false; bot.channelT = 0;
      if (isPlant) Game.plantBomb(bot);
      else Game.defuseBomb(bot);
      bot.state = "HOLD_ANGLE";
    }
  },
  doEngage(bot, dt, vis) {
    bot.crouching = false;
    const target = vis || (bot.lastSeenPos && G.time - bot.lastSeenT < 2.5 ? { who: "memory", pos: bot.lastSeenPos } : null);
    if (!target) {
      // lost them: low HP -> seek cover/hold; else re-acquire via objective
      bot.state = bot.team === "def" && !G.bombPlanted ? "HOLD_ANGLE" : "PATROL_SITE";
      if (bot.team === "atk" || G.bombPlanted) this.assignObjective(bot);
      return;
    }
    const tp = target.pos;
    bot.faceToward(tp.x, tp.z, dt, 9);
    const dist = bot.pos.distanceTo(tp);
    // low HP: fall back to nearest cover node
    if (bot.hp < 35 && dist > 4) {
      let bestNode = null, bd = 1e9;
      for (const n of navNodes) { if (!n.cover) continue; const d = Math.hypot(n.x - bot.pos.x, n.z - bot.pos.z); if (d < bd) { bd = d; bestNode = n; } }
      if (bestNode && bd > 1.5) { if (!bot.targetPos || bot.targetPos.x !== bestNode.x) bot.setPathTo(bestNode.x, bestNode.z); bot.moveAlong(dt, 1.1); }
    } else {
      // counter-strafe while in effective range; close distance if far
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) { bot.strafeT = 0.35 + Math.random() * 0.55; bot.strafeDir *= -1; }
      if (dist > 16) { bot.setPathTo(tp.x, tp.z); bot.moveAlong(dt, 1); bot.path = []; bot.pathIdx = 0; bot.targetPos = null; }
      else if (dist > 3) {
        const px = -Math.cos(bot.yaw) * bot.strafeDir, pz = Math.sin(bot.yaw) * bot.strafeDir;
        bot.pos.x += px * 1.7 * dt; bot.pos.z += pz * 1.7 * dt;
        collideMove(bot.pos, 0.38, 1.8);
      }
    }
    // burst fire
    if (!vis) return;
    if (bot.reactionT > 0) { bot.reactionT -= dt; return; }
    const now = performance.now();
    if (bot.burstWait > 0) { bot.burstWait -= dt; return; }
    if (now < bot.nextShotT) return;
    const wd = WEAPONS[bot.weaponId];
    bot.nextShotT = now + 60000 / wd.rpm;
    bot.burstLeft--;
    if (bot.burstLeft <= 0) { bot.burstLeft = 3 + (Math.random() * 3 | 0); bot.burstWait = 0.45 + Math.random() * 0.5; }
    this.fireBot(bot, vis, wd);
  },
  fireBot(bot, vis, wd) {
    const from = new THREE.Vector3(bot.pos.x, bot.pos.y + 1.3, bot.pos.z);
    const targetPos = vis.who === "player"
      ? new THREE.Vector3(Player.pos.x, Player.pos.y + 1.25, Player.pos.z)
      : vis.ref.chest().add(new THREE.Vector3(0, 0.15, 0));
    AudioEngine.shot(wd.snd, bot.pos.distanceTo(Player.pos));
    if (!wd.suppressed) Game.emitNoise(bot.pos, 42, "shot", bot);
    WeaponSystem.spawnTracer(from, targetPos, wd.tracer);
    // hit resolution: accuracy model
    const dist = bot.pos.distanceTo(vis.who === "player" ? Player.pos : vis.ref.pos);
    let pHit = 0.62 - dist * 0.011;
    if (vis.who === "player") {
      const pSpeed = Math.hypot(Player.vel.x, Player.vel.z);
      pHit -= pSpeed * 0.045;
      if (!Player.onGround) pHit -= 0.22;
      if (Player.crouch) pHit -= 0.07;
    } else {
      pHit -= 0.08;
    }
    pHit = Math.max(0.06, Math.min(0.85, pHit * Settings.diffAccuracy()));
    if (Math.random() > pHit) {
      // near miss impact near target
      const miss = targetPos.clone(); miss.x += (Math.random() - 0.5) * 1.6; miss.y += (Math.random() - 0.5) * 1.2; miss.z += (Math.random() - 0.5) * 1.6;
      Game.spawnImpact(miss, new THREE.Vector3(0, 1, 0));
      return;
    }
    const head = Math.random() < 0.16;
    const dmg = head ? wd.dmg * wd.headMult * 0.8 : wd.dmg * (0.75 + Math.random() * 0.3);
    if (vis.who === "player") {
      const rec = G.botStats[bot.name]; if (rec) { rec.hits++; if (head) rec.headshots++; rec.damage += dmg; }
      Player.damage(dmg, bot.pos, bot.name);
      if (!Player.alive) { bot.roundKills++; bot.kills++; const krec = G.botStats[bot.name]; if (krec) krec.kills++; HUD.killfeed(bot.name, "YOU", head, bot.weaponId); Game.checkRoundEnd(); }
    } else {
      vis.ref.damage(dmg, head, bot.name, bot.weaponId);
    }
  }
};
let dtSafe = 0.016;

/* =========================== UtilitySystem =========================== */
const UtilitySystem = {
  projectiles: [], particles: [], decals: [],
  throwNade(kind) {
    if (Player.util[kind] <= 0 || !Player.alive || G.phase !== "live") return;
    Player.util[kind]--;
    HUD.updateVitals();
    AudioEngine.throwWhoosh();
    const dir = Player.lookDir();
    const start = Player.eye().add(dir.clone().multiplyScalar(0.5));
    const mesh = new THREE.Mesh(nadeGeo, kind === "flash" ? nadeMatFlash : kind === "smoke" ? nadeMatSmoke : nadeMatFrag);
    mesh.position.copy(start);
    scene.add(mesh);
    this.projectiles.push({
      kind, mesh,
      vel: dir.clone().multiplyScalar(15).add(new THREE.Vector3(0, 2.2, 0)),
      fuse: kind === "flash" ? 1.5 : kind === "frag" ? 2.2 : 1.1,
      resting: false
    });
  },
  update(dt) {
    const now = G.time;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.fuse -= dt;
      if (!p.resting) {
        p.vel.y -= 16 * dt;
        p.mesh.position.add(p.vel.clone().multiplyScalar(dt));
        const mp = p.mesh.position;
        if (mp.y < 0.12) { mp.y = 0.12; p.vel.y *= -0.42; p.vel.x *= 0.7; p.vel.z *= 0.7; if (Math.abs(p.vel.y) < 0.8) { p.vel.y = 0; if (p.kind === "smoke") p.resting = true; } }
        // wall bounce (AABB)
        for (const c of colliders) {
          if (mp.x > c.minX - 0.1 && mp.x < c.maxX + 0.1 && mp.z > c.minZ - 0.1 && mp.z < c.maxZ + 0.1 && mp.y < c.h) {
            const pl = mp.x - c.minX, pr = c.maxX - mp.x, pt = mp.z - c.minZ, pb = c.maxZ - mp.z;
            const m = Math.min(pl, pr, pt, pb);
            if (m === pl || m === pr) p.vel.x *= -0.5; else p.vel.z *= -0.5;
            mp.x = Math.max(c.minX - 0.11, Math.min(mp.x, c.maxX + 0.11));
            mp.z = Math.max(c.minZ - 0.11, Math.min(mp.z, c.maxZ + 0.11));
            break;
          }
        }
        p.mesh.rotation.x += dt * 7; p.mesh.rotation.z += dt * 5;
      }
      if (p.fuse <= 0) {
        this.detonate(p);
        scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
    // smoke expiry
    for (let i = smokes.length - 1; i >= 0; i--) {
      if (now > smokes[i].until) {
        for (const s of smokes[i].sprites) { scene.remove(s); s.material.dispose(); }
        smokes.splice(i, 1);
      } else {
        const grow = Math.min(1, (14 - (smokes[i].until - now)) / 1.2 + 0.25);
        for (const s of smokes[i].sprites) { const base = s.userData.base; s.scale.set(base * grow, base * grow, 1); }
        smokes[i].r = 3.1 * grow;
      }
    }
    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      pt.vel.y -= 6 * dt;
      pt.mesh.position.add(pt.vel.clone().multiplyScalar(dt));
      if (pt.mesh.position.y < 0.03) pt.mesh.position.y = 0.03;
      pt.mesh.material.opacity = Math.max(0, pt.life / pt.maxLife);
      if (pt.life <= 0) { scene.remove(pt.mesh); pt.mesh.material.dispose(); this.particles.splice(i, 1); }
    }
  },
  detonate(p) {
    const pos = p.mesh.position.clone();
    if (p.kind === "flash") this.flash(pos);
    else if (p.kind === "smoke") this.smoke(pos);
    else this.frag(pos);
  },
  flash(pos) {
    // player effect by view angle + distance + LOS
    const eye = Player.eye();
    const d = eye.distanceTo(pos);
    if (Player.alive && d < 26) {
      const toFlash = pos.clone().sub(eye).normalize();
      const dot = Player.lookDir().dot(toFlash);
      const blocked = losBlockedNoSmoke(eye, pos);
      if (!blocked) {
        const facing = Math.max(0, (dot - 0.15) / 0.85);
        const strength = Math.min(1, facing * 1.3) * Math.max(0.25, 1 - d / 30);
        if (strength > 0.05) {
          Player.blindT = Math.max(Player.blindT, 0.8 + strength * 2.6);
          flashEl.style.transition = "none";
          flashEl.style.opacity = Math.min(1, strength + 0.25);
          requestAnimationFrame(() => { flashEl.style.transition = "opacity 2.6s"; flashEl.style.opacity = 0; });
          AudioEngine.tinnitus(strength);
        }
      }
    }
    // bots
    for (const b of Game.bots) {
      if (!b.alive) continue;
      const be = b.eye(), bd = be.distanceTo(pos);
      if (bd > 24) continue;
      const fwd = new THREE.Vector3(-Math.sin(b.yaw), 0, -Math.cos(b.yaw));
      const to = pos.clone().sub(be).normalize();
      if (fwd.dot(to) > 0.25 && !losBlockedNoSmoke(be, pos)) b.blindT = Math.max(b.blindT, 1.2 + (1 - bd / 24) * 2.4);
    }
    // flash visual pop
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: TextureGenerator.muzzleSprite(), color: 0xffffff, transparent: true, opacity: 1, depthWrite: false }));
    spr.position.copy(pos); spr.scale.set(3.4, 3.4, 1); scene.add(spr);
    this.particles.push({ mesh: spr, vel: new THREE.Vector3(), life: 0.16, maxLife: 0.16 });
    AudioEngine.explosion(eye.distanceTo(pos) * 0.4);
  },
  smoke(pos) {
    const sprites = [];
    const tex = TextureGenerator.smokeSprite();
    for (let i = 0; i < 15; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.52, depthWrite: false, color: 0xd6dbe2 });
      const s = new THREE.Sprite(mat);
      const a = (i / 15) * Math.PI * 2, rr = Math.random() * 1.9;
      s.position.set(pos.x + Math.cos(a) * rr, 0.7 + Math.random() * 1.7, pos.z + Math.sin(a) * rr);
      s.userData.base = 2.6 + Math.random() * 2.1;
      s.scale.set(0.4, 0.4, 1);
      scene.add(s); sprites.push(s);
    }
    smokes.push({ pos: new THREE.Vector3(pos.x, 1.3, pos.z), r: 0.6, until: G.time + 14, sprites });
    AudioEngine.hiss(1.6);
  },
  frag(pos) {
    const dP = Player.pos.distanceTo(pos);
    AudioEngine.explosion(dP);
    if (dP < 7) Player.shake = Math.min(1.2, Player.shake + (1 - dP / 7) * 1.1);
    const dmgAt = (target, isPlayer) => {
      const d = target.distanceTo(pos);
      if (d > 5.2) return;
      if (losBlockedNoSmoke(new THREE.Vector3(target.x, target.y + 1, target.z), pos)) return;
      const dmg = 105 * (1 - d / 5.6);
      if (isPlayer) Player.damage(dmg, pos);
      return dmg;
    };
    dmgAt(Player.pos, true);
    for (const b of Game.bots) if (b.alive) { const dd = dmgAt(b.pos, false); if (dd) b.damage(dd, false, "YOU", "frag"); }
    // shrapnel particles
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(shardGeo, new THREE.MeshBasicMaterial({ color: i % 3 ? 0xffa63e : 0x555c64, transparent: true }));
      m.position.copy(pos).add(new THREE.Vector3(0, 0.25, 0));
      scene.add(m);
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 8;
      this.particles.push({ mesh: m, vel: new THREE.Vector3(Math.cos(a) * sp, 2.5 + Math.random() * 5, Math.sin(a) * sp), life: 0.5 + Math.random() * 0.5, maxLife: 1 });
    }
    // scorch decal
    const sc = new THREE.Mesh(new THREE.CircleGeometry(1.7, 20), new THREE.MeshBasicMaterial({ color: 0x060606, transparent: true, opacity: 0.75, depthWrite: false }));
    sc.rotation.x = -Math.PI / 2; sc.position.set(pos.x, 0.04, pos.z);
    scene.add(sc); this.decals.push(sc);
    // light flash
    WeaponSystem.flashLight.position.copy(pos).add(new THREE.Vector3(0, 0.8, 0));
    WeaponSystem.flashLight.intensity = 5;
  },
  clearRound() {
    for (const p of this.projectiles) scene.remove(p.mesh);
    this.projectiles = [];
    for (const s of smokes) for (const spr of s.sprites) { scene.remove(spr); spr.material.dispose(); }
    smokes.length = 0;
    for (const pt of this.particles) { scene.remove(pt.mesh); }
    this.particles = [];
    for (const d of this.decals) { scene.remove(d); d.material.dispose(); }
    this.decals = [];
  }
};
function losBlockedNoSmoke(a, b) {
  for (let i = 0; i < colliders.length; i++) {
    if (colliders[i].h < 1.0) continue;
    if (segHitsAABB(a.x, a.y, a.z, b.x, b.y, b.z, colliders[i], 0)) return true;
  }
  return false;
}
const nadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const nadeMatFlash = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.35, metalness: 0.7 });
const nadeMatSmoke = new THREE.MeshStandardMaterial({ color: 0x4c9455, roughness: 0.5, metalness: 0.4 });
const nadeMatFrag = new THREE.MeshStandardMaterial({ color: 0x39492e, roughness: 0.6, metalness: 0.4 });
const shardGeo = new THREE.BoxGeometry(0.05, 0.05, 0.16);
const flashEl = document.getElementById("flash-overlay");

/* ============================= HUDManager ============================ */
const HUD = {
  el: {},
  init() {
    const ids = ["hud", "hp-num", "hp-fill", "armor-fill", "armor-num", "weapon-name", "weapon-mode", "ammo-mag", "ammo-res",
      "credits", "reload-hint", "score-atk", "score-def", "round-timer", "round-label", "team-status", "killfeed",
      "prompt-text", "progress-track", "progress-fill", "bomb-alert", "util-q", "util-e", "util-g", "util-q-c", "util-e-c", "util-g-c", "dmg-arc", "dmg-vignette", "hitmarker"];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this.radar = document.getElementById("radar").getContext("2d");
  },
  updateVitals() {
    this.el["hp-num"].textContent = Math.ceil(Player.hp);
    this.el["hp-num"].className = Player.hp <= 30 ? "low" : "";
    this.el["hp-num"].id = "hp-num";
    this.el["hp-fill"].style.transform = "scaleX(" + Math.max(0, Player.hp / 100) + ")";
    this.el["hp-fill"].style.background = Player.hp <= 30 ? "#ff5147" : "#3ddc84";
    this.el["armor-fill"].style.transform = "scaleX(" + Math.max(0, Player.armor / 50) + ")";
    this.el["armor-num"].textContent = Math.ceil(Player.armor);
    this.el["credits"].textContent = "$" + Player.credits.toLocaleString();
    const u = [["util-q", "util-q-c", Player.util.flash], ["util-e", "util-e-c", Player.util.smoke], ["util-g", "util-g-c", Player.util.frag]];
    for (const [slot, cnt, v] of u) {
      this.el[cnt].textContent = v;
      this.el[slot].className = "util-slot" + (v <= 0 ? " empty" : "");
    }
  },
  updateWeapon() {
    const d = WeaponSystem.def(), st = WeaponSystem.st();
    this.el["weapon-name"].textContent = d.name;
    this.el["weapon-mode"].textContent = d.mode;
    this.el["ammo-mag"].textContent = d.melee ? "—" : st.mag;
    this.el["ammo-mag"].className = (!d.melee && st.mag <= Math.ceil(d.mag * 0.25)) ? "low" : "";
    this.el["ammo-mag"].id = "ammo-mag";
    this.el["ammo-res"].textContent = d.melee ? "" : "/ " + st.reserve;
  },
  setReloadHint(t) { this.el["reload-hint"].textContent = t; },
  updateScore() {
    this.el["score-atk"].textContent = G.score.atk;
    this.el["score-def"].textContent = G.score.def;
    const tag = Settings.side === "def" ? (G.bombPlanted ? "DEFEND — SPIKE PLANTED" : "DEFEND") : (Player.hasBomb || Game.carrier() === "player" ? "YOU HAVE THE SPIKE" : "ATTACK");
    this.el["round-label"].textContent = "ROUND " + G.round + " — FIRST TO 5 · " + tag;
    let html = "";
    html += '<div class="agent-chip atk' + (Player.alive ? "" : " dead") + '">YOU</div>';
    for (const b of Game.bots) html += '<div class="agent-chip ' + b.team + (b.alive ? "" : " dead") + '">' + b.name.slice(0, 2) + "</div>";
    this.el["team-status"].innerHTML = html;
  },
  updateTimer() {
    let t;
    if (G.phase === "buy") t = Math.max(0, G.phaseT);
    else if (G.bombPlanted) t = Math.max(0, G.bombT);
    else t = Math.max(0, G.roundT);
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    this.el["round-timer"].textContent = m + ":" + (s < 10 ? "0" : "") + s;
    this.el["round-timer"].className = (t < 11 || G.bombPlanted) ? "danger" : "";
    this.el["round-timer"].id = "round-timer";
    this.el["bomb-alert"].style.display = G.bombPlanted && G.phase === "live" ? "block" : "none";
  },
  killfeed(killer, victim, head, weaponId) {
    const row = document.createElement("div");
    row.className = "kf-row";
    const wname = WEAPONS[weaponId] ? WEAPONS[weaponId].name : "FRAG";
    row.innerHTML = '<span class="kil">' + killer + '</span><span style="color:#9fb4c4">[' + wname + ']</span>' +
      (head ? '<span class="hs">◎ HEADSHOT</span>' : '') + '<span class="vic">' + victim + "</span>";
    const kf = this.el["killfeed"];
    kf.prepend(row);
    while (kf.children.length > 5) kf.removeChild(kf.lastChild);
    setTimeout(() => { row.style.transition = "opacity .5s"; row.style.opacity = "0"; setTimeout(() => row.remove(), 520); }, 4200);
  },
  _kbT: null,
  killConfirm(name, head) {
    AudioEngine.killConfirm(head);
    const kb = document.getElementById("kill-banner");
    if (!kb) return;
    kb.textContent = "✕ ELIMINATED — " + name + (head ? " · HEADSHOT" : "");
    kb.classList.remove("pop");
    void kb.offsetWidth; // restart the pop animation
    kb.classList.add("pop");
    clearTimeout(this._kbT);
    this._kbT = setTimeout(() => kb.classList.remove("pop"), 1550);
  },
  _hmT: null,
  showHitmarker(head, kill) {
    AudioEngine.hitmarker(head);
    const hm = this.el["hitmarker"];
    hm.className = kill ? "kill" : head ? "gold" : "";
    hm.id = "hitmarker";
    hm.style.opacity = "1";
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => { hm.style.opacity = "0"; }, 130);
  },
  damageFrom(fromPos) {
    if (!fromPos) return;
    const dx = fromPos.x - Player.pos.x, dz = fromPos.z - Player.pos.z;
    const ang = Math.atan2(dx, dz) - (Player.yaw + Math.PI);
    this.el["dmg-arc"].style.transform = "rotate(" + (ang * 180 / Math.PI + 180) + "deg)";
    this.el["dmg-arc"].style.opacity = "1";
    this.el["dmg-vignette"].style.opacity = "1";
    clearTimeout(this._dmgT);
    this._dmgT = setTimeout(() => { this.el["dmg-arc"].style.opacity = "0"; this.el["dmg-vignette"].style.opacity = "0.35"; }, 350);
    setTimeout(() => { if (Player.hp > 30) this.el["dmg-vignette"].style.opacity = "0"; }, 1400);
  },
  updateCrosshair(spread) {
    const gap = 7 + spread * 900;
    const t = document.getElementById("ch-t"), b = document.getElementById("ch-b"), l = document.getElementById("ch-l"), r = document.getElementById("ch-r");
    t.style.top = (-gap - 9) + "px"; b.style.top = gap + "px";
    l.style.left = (-gap - 9) + "px"; r.style.left = gap + "px";
  },
  setPrompt(text, progress) {
    this.el["prompt-text"].textContent = text || "";
    if (progress !== null && progress !== undefined) {
      this.el["progress-track"].style.display = "block";
      this.el["progress-fill"].style.width = Math.min(100, progress * 100) + "%";
    } else this.el["progress-track"].style.display = "none";
  },
  drawRadar() {
    const ctx = this.radar, S = 168, scale = S / (WORLD + 6);
    const w2r = (x, z) => [(x + HALF + 3) * scale, (z + HALF + 3) * scale];
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "#0a0f14"; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = "#232a31";
    for (const c of colliders) {
      const [x1, y1] = w2r(c.minX, c.minZ), [x2, y2] = w2r(c.maxX, c.maxZ);
      ctx.fillRect(x1, y1, Math.max(1.5, x2 - x1), Math.max(1.5, y2 - y1));
    }
    // sites
    for (const [key, s, col] of [["A", sites.A, "#ff7a1a"], ["B", sites.B, "#35c4ff"]]) {
      const [x, y] = w2r(s.x, s.z);
      ctx.fillStyle = col; ctx.font = "bold 11px Arial"; ctx.textAlign = "center";
      ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillText(key, x, y + 4);
    }
    // map callouts
    ctx.font = "700 7.5px Arial"; ctx.textAlign = "center";
    const callout = (wx, wz, txt, col) => { const [x, y] = w2r(wx, wz); ctx.fillStyle = col; ctx.fillText(txt, x, y); };
    callout(sites.A.x, sites.A.z - 9.5, "SITE A", "rgba(255,160,90,.9)");
    callout(sites.B.x, sites.B.z - 9.5, "SITE B", "rgba(120,205,255,.9)");
    callout(0, 3, "MID", "rgba(205,220,232,.55)");
    callout(0, 31, "ATK", "rgba(255,179,92,.8)");
    callout(0, -31, "DEF", "rgba(124,196,255,.8)");
    // dropped / planted Spike icon: blinking square, ringed once planted
    if (G.bombDropped || G.bombPlanted) {
      const bp = G.bombPlanted ? G.bombPos : G.bombDropped;
      const [x, y] = w2r(bp.x, bp.z);
      ctx.fillStyle = (Math.sin(G.time * 6) > 0) ? "#ff3524" : "#7a1408";
      ctx.fillRect(x - 3, y - 3, 6, 6);
      if (G.bombPlanted) {
        ctx.strokeStyle = "#ff3524"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(x, y, 6.5 + Math.sin(G.time * 6) * 1.2, 0, 7); ctx.stroke();
      }
    }
    // bots: teammates always shown in team color, enemies only when spotted
    for (const b of Game.bots) {
      if (!b.alive) continue;
      const [x, y] = w2r(b.pos.x, b.pos.z);
      if (b.team === Settings.side) { ctx.fillStyle = b.team === "atk" ? "#ffb35c" : "#7cc4ff"; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); }
      else if (b.spottedT > 0) { ctx.fillStyle = "#ff5147"; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); }
    }
    // gold diamond marker on the current Spike carrier (bot or player)
    const carrier = Game.carrier();
    if (carrier && !G.bombPlanted) {
      const cp = carrier === "player" ? Player.pos : carrier.pos;
      const [x, y] = w2r(cp.x, cp.z);
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#ffd23e"; ctx.fillRect(-3.2, -3.2, 6.4, 6.4);
      ctx.strokeStyle = "#14100b"; ctx.lineWidth = 1; ctx.strokeRect(-3.2, -3.2, 6.4, 6.4);
      ctx.restore();
    }
    // player + view cone
    const [px, py] = w2r(Player.pos.x, Player.pos.z);
    const fx = -Math.sin(Player.yaw), fz = -Math.cos(Player.yaw);
    ctx.fillStyle = "rgba(89,255,160,.18)";
    ctx.beginPath(); ctx.moveTo(px, py);
    ctx.arc(px, py, 30, Math.atan2(fz, fx) - 0.5, Math.atan2(fz, fx) + 0.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#59ffa0";
    ctx.beginPath(); ctx.arc(px, py, 3.6, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(120,200,255,.35)"; ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  },
  banner(title, sub, mvp, atkWin) {
    const b = document.getElementById("banner");
    document.getElementById("banner-title").textContent = title;
    document.getElementById("banner-title").style.color = atkWin ? "#ff9435" : "#57b6ff";
    document.getElementById("banner-sub").textContent = sub;
    document.getElementById("banner-mvp").textContent = mvp ? "ROUND MVP — " + mvp : "";
    b.style.display = "flex";
    setTimeout(() => { b.style.display = "none"; }, 2900);
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

/* =============================== BuyMenu ============================= */
const BuyMenu = {
  open() {
    const scr = document.getElementById("buy-screen");
    scr.classList.remove("hidden");
    this.render();
    document.getElementById("hud").style.display = "block";
  },
  render() {
    const wrap = document.getElementById("buy-items");
    wrap.innerHTML = "";
    document.getElementById("buy-credits").textContent = "$" + Player.credits.toLocaleString();
    for (const item of BUY_ITEMS) {
      const btn = document.createElement("button");
      btn.className = "buy-card";
      let owned = "";
      if (item.id === Player.primaryId) owned = "EQUIPPED";
      if (item.id === "armor" && Player.armor >= 50) owned = "EQUIPPED";
      if (item.id === "flash") owned = "OWNED × " + Player.util.flash;
      if (item.id === "smoke") owned = "OWNED × " + Player.util.smoke;
      if (item.id === "frag") owned = "OWNED × " + Player.util.frag;
      btn.innerHTML = '<div class="bn">[' + item.key + '] ' + item.name + '</div><div class="bd">' + item.desc + '</div>' +
        '<div class="bp">$' + item.price.toLocaleString() + '</div>' + (owned ? '<div class="owned">' + owned + "</div>" : "");
      btn.disabled = Player.credits < item.price || owned === "EQUIPPED";
      btn.addEventListener("click", () => { this.buy(item.id); });
      wrap.appendChild(btn);
    }
  },
  buy(id) {
    const item = BUY_ITEMS.find(i => i.id === id);
    if (!item || Player.credits < item.price) return;
    if (id === "vandal" || id === "spectre" || id === "operator") {
      Player.primaryId = id;
      WeaponSystem.state[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      WeaponSystem.equip(id);
    } else if (id === "armor") { if (Player.armor >= 50) return; Player.armor = 50; }
    else if (id === "flash") Player.util.flash = Math.min(2, Player.util.flash + 1);
    else if (id === "smoke") Player.util.smoke = Math.min(2, Player.util.smoke + 1);
    else if (id === "frag") Player.util.frag = Math.min(2, Player.util.frag + 1);
    Player.credits -= item.price;
    AudioEngine.uiClick();
    HUD.updateVitals();
    this.render();
  },
  tick() {
    document.getElementById("buy-timer").textContent = Math.max(0, G.phaseT).toFixed(1);
  },
  close(startLive) {
    document.getElementById("buy-screen").classList.add("hidden");
    if (startLive && G.phase === "buy") {
      G.phase = "live";
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

/* ========================== Spectator camera ========================= */
const Spectate = { bot: null, idx: 0, init: false, label: null };
/* Subtle touch aim assist: while the crosshair sits almost exactly on an
   enemy hitbox (chest ~3.2°, head ~2.3°, line of sight clear), the look-drag
   sensitivity eases to 72% — a 28% slowdown — so fine aim on a phone screen
   feels precise instead of skating past the target. Returns 1 (no assist)
   the moment the crosshair leaves the hitbox. */
function touchAimAssist() {
  if (!Player.alive || G.phase !== "live") return 1;
  const eye = Player.eye(), dir = Player.lookDir();
  for (const b of Game.bots) {
    if (!b.alive || b.team === Settings.side) continue;
    if (eye.distanceTo(b.chest()) > 42) continue;
    const toChest = b.chest().sub(eye).normalize();
    if (dir.angleTo(toChest) < 0.055 && !losBlocked(eye, b.chest())) return 0.72;
    const toHead = b.headPos().sub(eye).normalize();
    if (dir.angleTo(toHead) < 0.04 && !losBlocked(eye, b.headPos())) return 0.72;
  }
  return 1;
}
function cycleSpectate() {
  const mates = Game.bots.filter(b => b.alive && b.team === Settings.side);
  if (!mates.length) return;
  Spectate.idx = ((Spectate.idx || 0) + 1) % mates.length;
  Spectate.bot = mates[Spectate.idx];
  Spectate.init = false; Spectate.label = null;
}

/* ====================== Touch controls (Android) ======================
   Multi-touch by Touch.identifier: left half = virtual analog joystick,
   right half = camera look swipe, on-screen buttons = FIRE / SPIKE (hold)
   / JUMP / RELOAD / SWAP / BUY / NEXT CAM. Runs alongside mouse input and
   never touches pointer lock, so DEPLOY stays instant and non-blocking. */
function setupTouchControls() {
  const joyBase = document.getElementById("joy-base");
  const joyKnob = document.getElementById("joy-knob");
  const JOY_R = 52;
  const isUiTarget = t => !!(t && t.closest && t.closest("button, .panel, .screen, input, select, a, .util-slot, #rotate-hint"));
  const setKnob = (dx, dy) => { joyKnob.style.transform = "translate(calc(-50% + " + dx + "px), calc(-50% + " + dy + "px))"; };
  const endJoy = () => { TouchInput.joyId = null; TouchInput.joyActive = false; TouchInput.joyX = 0; TouchInput.joyY = 0; joyBase.style.display = "none"; setKnob(0, 0); };

  document.addEventListener("touchstart", e => {
    TouchInput.lastTouchT = performance.now();
    if (!TouchInput.enabled) { TouchInput.enabled = true; document.body.classList.add("touch-mode"); }
    AudioEngine.init();
    if (!G.started || (G.phase !== "live" && G.phase !== "buy")) return;
    for (const t of e.changedTouches) {
      if (isUiTarget(t.target)) continue;
      if (t.clientX < innerWidth / 2 && TouchInput.joyId === null) {
        TouchInput.joyId = t.identifier; TouchInput.joyOX = t.clientX; TouchInput.joyOY = t.clientY;
        TouchInput.joyX = 0; TouchInput.joyY = 0; TouchInput.joyActive = true;
        joyBase.style.left = t.clientX + "px"; joyBase.style.top = t.clientY + "px";
        joyBase.style.display = "block"; setKnob(0, 0);
        e.preventDefault();
      } else if (t.clientX >= innerWidth / 2 && TouchInput.lookId === null) {
        TouchInput.lookId = t.identifier; TouchInput.lookLX = t.clientX; TouchInput.lookLY = t.clientY;
        TouchInput.lookSX = t.clientX; TouchInput.lookSY = t.clientY; TouchInput.lookT0 = performance.now();
        e.preventDefault();
      }
    }
  }, { passive: false });
  document.addEventListener("touchmove", e => {
    if (!G.started) return;
    for (const t of e.changedTouches) {
      if (t.identifier === TouchInput.joyId) {
        let dx = t.clientX - TouchInput.joyOX, dy = t.clientY - TouchInput.joyOY;
        const d = Math.hypot(dx, dy);
        if (d > JOY_R) { dx = dx / d * JOY_R; dy = dy / d * JOY_R; }
        TouchInput.joyX = dx / JOY_R; TouchInput.joyY = dy / JOY_R;
        setKnob(dx, dy);
        e.preventDefault();
      } else if (t.identifier === TouchInput.lookId) {
        const dx = t.clientX - TouchInput.lookLX, dy = t.clientY - TouchInput.lookLY;
        TouchInput.lookLX = t.clientX; TouchInput.lookLY = t.clientY;
        if (Player.alive && (G.phase === "live" || G.phase === "buy")) {
          const aa = touchAimAssist(); // 0.72 while the crosshair is on an enemy hitbox
          Player.yaw -= dx * 0.0042 * Settings.sens * aa;
          Player.pitch -= dy * 0.0042 * Settings.sens * aa;
          Player.pitch = Math.max(-1.45, Math.min(1.45, Player.pitch));
          mouseDX = dx; mouseDY = dy; // feeds viewmodel sway
        }
        e.preventDefault();
      }
    }
  }, { passive: false });
  const endTouch = e => {
    TouchInput.lastTouchT = performance.now();
    for (const t of e.changedTouches) {
      if (t.identifier === TouchInput.joyId) endJoy();
      if (t.identifier === TouchInput.lookId) {
        const quick = performance.now() - TouchInput.lookT0 < 260;
        const moved = Math.hypot(t.clientX - TouchInput.lookSX, t.clientY - TouchInput.lookSY);
        TouchInput.lookId = null;
        // spectator mode: a plain tap anywhere cycles the teammate camera
        if (quick && moved < 12 && !Player.alive && G.phase === "live") cycleSpectate();
      }
    }
  };
  document.addEventListener("touchend", endTouch);
  document.addEventListener("touchcancel", endTouch);
  document.addEventListener("gesturestart", e => e.preventDefault());

  const holdBtn = (id, down, up) => {
    const el = document.getElementById(id);
    if (!el) return;
    const on = e => { e.preventDefault(); AudioEngine.init(); el.classList.add("pressed"); down(); };
    const off = () => { el.classList.remove("pressed"); if (up) up(); };
    el.addEventListener("touchstart", on, { passive: false });
    el.addEventListener("touchend", off);
    el.addEventListener("touchcancel", off);
    el.addEventListener("mousedown", on);
    el.addEventListener("mouseup", off);
    el.addEventListener("mouseleave", off);
  };
  // FIRE: tap = one semi-auto shot (P226-TAC), hold = full-auto on rifles
  holdBtn("btn-fire", () => { mouseDown = true; }, () => { mouseDown = false; });
  // SPIKE / USE: press-and-hold drives keys["KeyF"] -> 3.5s plant / 4.0s defuse progress bar
  holdBtn("btn-spike", () => { keys["KeyF"] = true; }, () => { keys["KeyF"] = false; });
  holdBtn("btn-jump", () => { keys["Space"] = true; }, () => { keys["Space"] = false; });
  holdBtn("btn-reload-t", () => { if (G.phase === "live") WeaponSystem.startReload(); });
  holdBtn("btn-swap-t", () => {
    if (G.phase !== "live") return;
    if (WeaponSystem.current === "pistol") { if (Player.primaryId) WeaponSystem.equip(Player.primaryId); }
    else WeaponSystem.equip("pistol");
  });
  holdBtn("btn-buy-t", () => {
    if (G.phase !== "buy") return;
    const scr = document.getElementById("buy-screen");
    if (scr.classList.contains("hidden")) BuyMenu.open(); else BuyMenu.close(true);
  });
  holdBtn("btn-nextcam", () => { if (!Player.alive && G.phase === "live") cycleSpectate(); });
  // clickable SKILL Q / E / G HUD slots
  const slot = (id, kind) => { const el = document.getElementById(id); if (el) el.addEventListener("click", () => { AudioEngine.init(); UtilitySystem.throwNade(kind); }); };
  slot("util-q", "flash"); slot("util-e", "smoke"); slot("util-g", "frag");
  // dismissible landscape hint (portrait only, never blocks controls)
  const rd = document.getElementById("rotate-dismiss");
  if (rd) rd.addEventListener("click", () => document.getElementById("rotate-hint").classList.add("dismissed"));
  // NEXT CAM button only while spectating
  setInterval(() => { document.body.classList.toggle("spectating", !!G.started && !Player.alive && G.phase === "live"); }, 250);
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
