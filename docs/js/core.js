// core.js — shared globals: DOM helper, profile/save, renderer, game state, audio
'use strict';

const $ = id => document.getElementById(id);

// ---------- profile (each device owns its own hero) ----------
const Profile = (() => {
  let p = null;
  try { p = JSON.parse(localStorage.getItem('dd_profile') || 'null'); } catch (e) { p = null; }
  if (!p || !p.inv || !p.inv.length) {
    const s = makeItem(1, 0, 'sword'); s.n = 'Trusty Sword';
    const b = makeItem(1, 0, 'bow'); b.n = 'Hunting Bow';
    p = { name: '', color: PLAYER_COLORS[Math.floor(Math.random() * 3)], lvl: 1, xp: 0, coins: 0, inv: [s, b], eq: 0, best: 1 };
  }
  return p;
})();
let saveT = 0;
function saveProfile() { try { localStorage.setItem('dd_profile', JSON.stringify(Profile)); } catch (e) { } }
function equipped() { return Profile.inv[Profile.eq] || Profile.inv[0]; }
function myStats() { return { lvl: Profile.lvl, wpn: equipped(), name: Profile.name || 'Hero', color: Profile.color }; }

// ---------- renderer ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let lowPower = localStorage.getItem('dd_low') === '1';
let soundOn = localStorage.getItem('dd_snd') !== '0';
function applyPR() { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.6)); }
applyPR();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c130a);
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 140);
const CAM_OFF = new THREE.Vector3(0, 14.5, 9.5);
camera.position.copy(CAM_OFF); camera.lookAt(0, 0, 0);
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.82); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.5); sun.position.set(-10, 25, 12); scene.add(sun);
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep a similar horizontal view on narrow screens
  camera.fov = w / h < 1.3 ? 60 : 45;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------- game state ----------
const G = { role: null, inGame: false, floor: 1, seed: 0, map: null, level: null, theme: THEMES[0], myId: 0, view: null, snap: null, paused: false, time: 0, shake: 0, startFloor: 1, banner: 0 };
const me = { x: 0, z: 0, f: 0, moving: false, dodgeT: 0, dodgeA: 0, dodgeCd: 0, dashT: 0, dashA: 0, an: 0, pn: 0, dn: 0, spCd: 0, potCd: 0, downed: false, mx: 0, mz: 0, atkFaceT: 0 };
const input = { jx: 0, jz: 0, atk: false, keys: {} };

// ---------- audio ----------
const AC = { ctx: null, noise: null, last: {} };
function audioInit() {
  if (!AC.ctx) {
    try {
      AC.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const len = AC.ctx.sampleRate;
      AC.noise = AC.ctx.createBuffer(1, len, AC.ctx.sampleRate);
      const d = AC.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { }
  }
  if (AC.ctx && AC.ctx.state === 'suspended') AC.ctx.resume();
}
function tone(freq, dur, type, vol, slide, delay) {
  const c = AC.ctx; if (!c) return;
  const t = c.currentTime + (delay || 0);
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, freq, type) {
  const c = AC.ctx; if (!c) return;
  const t = c.currentTime;
  const s = c.createBufferSource(); s.buffer = AC.noise;
  const f = c.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
  const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(c.destination); s.start(t, Math.random() * 0.5); s.stop(t + dur);
}
const SFX = {
  swing: () => noise(0.09, 0.12, 2500, 'highpass'),
  hit: () => tone(160 + Math.random() * 40, 0.07, 'square', 0.05, -80),
  boom: () => { noise(0.45, 0.35, 500); tone(80, 0.35, 'sine', 0.25, -40); },
  bow: () => tone(700, 0.08, 'triangle', 0.06, -400),
  magic: () => tone(500, 0.18, 'sine', 0.07, 600),
  zap: () => noise(0.12, 0.12, 4000, 'bandpass'),
  hurt: () => tone(140, 0.18, 'sawtooth', 0.12, -60),
  coin: () => { tone(988, 0.06, 'square', 0.04); tone(1319, 0.12, 'square', 0.04, 0, 0.06); },
  item: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'triangle', 0.08, 0, i * 0.07)),
  lvl: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, 'square', 0.06, 0, i * 0.09)),
  heal: () => tone(600, 0.25, 'sine', 0.08, 500),
  portal: () => tone(200, 0.6, 'sine', 0.12, 800),
  roar: () => { tone(90, 0.7, 'sawtooth', 0.15, -40); noise(0.6, 0.15, 300); },
  chest: () => [392, 523, 659, 784].forEach((f, i) => tone(f, 0.15, 'triangle', 0.08, 0, i * 0.06)),
  fuse: () => noise(0.9, 0.06, 6000, 'highpass'),
  special: () => { noise(0.25, 0.15, 1200, 'bandpass'); tone(300, 0.25, 'sawtooth', 0.06, 300); },
  fanfare: () => [523, 523, 523, 698, 880, 1047].forEach((f, i) => tone(f, 0.22, 'square', 0.07, 0, i * 0.13)),
  down: () => tone(300, 0.6, 'triangle', 0.12, -250),
};
function sfx(name) {
  if (!soundOn || !AC.ctx) return;
  const now = performance.now();
  if (AC.last[name] && now - AC.last[name] < 45) return;
  AC.last[name] = now;
  try { SFX[name] && SFX[name](); } catch (e) { }
}
function vibrate(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } }

