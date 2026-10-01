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
  // merchant extras (older saves don't have them)
  if (!p.boosts || typeof p.boosts !== 'object') p.boosts = {};
  if (!p.pots || typeof p.pots !== 'object') p.pots = {};
  for (const k of BOOST_KEYS) p.boosts[k] = boostRank(p.boosts, k);
  for (const k of POTION_KEYS) p.pots[k] = Math.max(0, Math.min(POTION_MAX, p.pots[k] | 0));
  if (!Array.isArray(p.skins)) p.skins = [];
  if (typeof p.skin !== 'string' || (p.skin && !p.skins.includes(p.skin))) p.skin = '';
  return p;
})();
let saveT = 0;
function saveProfile() { try { localStorage.setItem('dd_profile', JSON.stringify(Profile)); } catch (e) { } }
function equipped() { return Profile.inv[Profile.eq] || Profile.inv[0]; }
function myStats() { return { lvl: Profile.lvl, wpn: equipped(), name: Profile.name || 'Hero', color: Profile.color, boosts: Profile.boosts, skin: Profile.skin || '', ph: Profile.pots.phoenix > 0 ? 1 : 0 }; }

// ---------- renderer ----------
// Linear colour pipeline: hex colours are sRGB and get converted to linear, lighting is done in linear
// space, then ACES filmic tone mapping (per-world exposure) + sRGB output, all inside the material
// shaders (no extra passes). Glowing things use toneMapped:false materials so they pop like bloom.
THREE.ColorManagement.legacyMode = false;
{ // cheaper PCF: 4 taps instead of three's 17 (the shadow map is sampled for every floor/wall pixel)
  const c = THREE.ShaderChunk.shadowmap_pars_fragment, end = '( 1.0 / 17.0 );';
  const a = c.indexOf('vec2 texelSize = vec2( 1.0 ) / shadowMapSize;'), b = c.indexOf(end, a);
  if (a > 0 && b > a) THREE.ShaderChunk.shadowmap_pars_fragment = c.slice(0, a) + `vec2 o = vec2( 0.7 ) / shadowMapSize;
			shadow = 0.25 * ( texture2DCompare( shadowMap, shadowCoord.xy + vec2( - o.x, - o.y ), shadowCoord.z ) + texture2DCompare( shadowMap, shadowCoord.xy + vec2( o.x, - o.y ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( - o.x, o.y ), shadowCoord.z ) + texture2DCompare( shadowMap, shadowCoord.xy + vec2( o.x, o.y ), shadowCoord.z ) );` + c.slice(b + end.length);
}
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFShadowMap;
let lowPower = localStorage.getItem('dd_low') === '1';
let soundOn = localStorage.getItem('dd_snd') !== '0';
// Pixel ratio: capped at 1.25 (sharp enough on phones, much cheaper than 2-3x); the main loop
// steps prCap down automatically if frames are slow. Battery saver: 1.0 and a 30 fps cap.
let prCap = 1.25;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c130a);
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 140);
// Camera: fixed orientation (pitch ~58°), only translates. CAM_OFF is the camera position relative to
// the local hero; its z is recomputed in resize() so the hero sits near the middle of the visible ground
// (with a perspective camera the ground below the look point is much shorter than above it).
const CAM_H = 16.8, CAM_D = 10.5;                       // ~14% further than the old (14.5, 9.5)
const CAM_OFF = new THREE.Vector3(0, CAM_H, CAM_D);
camera.position.set(0, CAM_H, CAM_D); camera.lookAt(0, 0, 0);
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.82); scene.add(hemi);
// "sun / moon": the only shadow caster; follows the hero with a tight orthographic frustum
const sun = new THREE.DirectionalLight(0xffffff, 0.5); sun.position.set(-10, 25, 12); scene.add(sun); scene.add(sun.target);
// Light from the west, a little from the camera side, ~45° up: shadows fall to the right where they are
// visible (not hidden behind the characters) and fronts still catch some light.
const SUN_OFF = new THREE.Vector3(-15, 17, 4);
// light-space basis (d: towards the sun, r/u: shadow-map axes); updated with the per-world sun direction
const SUN_BASIS = { d: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };
function aimSun(dir) { // size the orthographic shadow box to cover ~44 x 26 world units of floor around the view focus
  if (dir) SUN_OFF.set(dir[0], dir[1], dir[2]).setLength(Math.hypot(15, 17, 4));
  const d = SUN_BASIS.d.copy(SUN_OFF).normalize(), r = SUN_BASIS.r.crossVectors(new THREE.Vector3(0, 1, 0), d).normalize(), u = SUN_BASIS.u.crossVectors(d, r);
  const hx = 22, hz = 13, hy = 3;
  const sr = Math.abs(r.x) * hx + Math.abs(r.z) * hz + Math.abs(r.y) * hy, su = Math.abs(u.x) * hx + Math.abs(u.z) * hz + Math.abs(u.y) * hy;
  Object.assign(sun.shadow.camera, { left: -sr, right: sr, top: su, bottom: -su, near: 2, far: 70 });
  sun.shadow.camera.updateProjectionMatrix();
}
aimSun();
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
// soft light that follows the local hero (High only; lower tiers get a fake glow pool)
const heroLight = new THREE.PointLight(0xffe6c8, 0.55, 10, 1.5); heroLight.position.set(0, 3.2, 0);
// fixed pool of point lights moved to the torches / lava / crystals nearest the hero (count per tier is
// constant, so moving between torches never changes the shader light count = no recompiles)
const pointPool = [];

// ---------- graphics quality tiers ----------
const GFX_TIERS = {
  high:   { shadow: 1024, soft: false, lights: 3, hero: true,  parts: 120, glow: 0.9 },
  medium: { shadow: 512,  soft: false, lights: 1, hero: false, parts: 70,  glow: 1 },
  low:    { shadow: 0,    soft: false, lights: 0, hero: false, parts: 0,   glow: 1.1 },
};
const GFX_ORDER = ['high', 'medium', 'low'];
const GFX_LABEL = { high: 'High', medium: 'Medium', low: 'Low', auto: 'Auto' };
const GFX = (() => {
  let pref = 'auto';
  try { pref = localStorage.getItem('dd_gfx') || 'auto'; } catch (e) { }
  if (!GFX_LABEL[pref]) pref = 'auto';
  const cores = navigator.hardwareConcurrency || 8, mem = navigator.deviceMemory || 8;
  const lowEnd = cores <= 4 || mem <= 3 || Math.min(screen.width, screen.height) * (devicePixelRatio || 1) < 600;
  return { pref, auto: lowEnd ? 'medium' : 'high', q: null, T: GFX_TIERS.low, ver: 0, steps: 0 };
})();
function gfxTier() { return lowPower ? 'low' : GFX.pref === 'auto' ? GFX.auto : GFX.pref; }
function gfxApply(force) {
  const q = gfxTier();
  if (q === GFX.q && !force) return;
  const T = GFX.T = GFX_TIERS[q];
  GFX.q = q; GFX.ver++;
  renderer.shadowMap.enabled = T.shadow > 0;
  renderer.shadowMap.type = T.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  sun.castShadow = T.shadow > 0;
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  if (T.shadow) sun.shadow.mapSize.set(T.shadow, T.shadow);
  if (typeof SHADOW_MAT !== 'undefined') SHADOW_MAT.visible = !T.shadow; // blob shadows only without real ones
  while (pointPool.length > T.lights) { const p = pointPool.pop(); scene.remove(p.light); }
  while (pointPool.length < T.lights) { const l = new THREE.PointLight(0xffaa55, 0, 9, 2); l.position.set(0, -50, 0); scene.add(l); pointPool.push({ light: l, c: null, k: 0, out: false }); }
  if (T.hero) scene.add(heroLight); else scene.remove(heroLight);
  scene.traverse(o => { if (o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) m.needsUpdate = true; });
  if (typeof onGfxChange === 'function') onGfxChange();
  gfxLabel();
}
function gfxLabel() {
  const b = $('gfxBtn'); if (!b) return;
  const auto = GFX.pref === 'auto' && !lowPower;
  b.querySelector('.tl').innerHTML = 'Graphics<br><b>' + (lowPower ? 'Low (battery)' : GFX_LABEL[GFX.pref] + (auto ? ' · ' + GFX_LABEL[GFX.q] : '')) + '</b>';
}
// pause-menu button cycles Auto -> High -> Medium -> Low
if ($('gfxBtn')) $('gfxBtn').onclick = () => {
  const order = ['auto', 'high', 'medium', 'low'];
  GFX.pref = order[(order.indexOf(GFX.pref) + 1) % order.length];
  if (GFX.pref === 'auto') { GFX.auto = 'high'; GFX.steps = 0; }
  try { localStorage.setItem('dd_gfx', GFX.pref); } catch (e) { }
  gfxApply(); gfxLabel();
};
// Called by the main loop's perf monitor with the average frame time over ~4 s. In Auto mode, step the
// quality tier down first (High -> Medium -> Low), then the pixel ratio (1.25 -> 1.0 -> 0.85).
function gfxPerf(avg) {
  if (lowPower || avg <= 22) return;
  if (GFX.pref === 'auto' && GFX.auto !== 'low') { GFX.auto = GFX_ORDER[GFX_ORDER.indexOf(GFX.auto) + 1]; GFX.steps++; gfxApply(); return; }
  if (avg > 24 && prCap > 0.85) { prCap = prCap > 1 ? 1 : 0.85; applyPR(); resize(); }
}
function applyPR() { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? Math.min(1, prCap) : prCap)); gfxApply(); }
applyPR();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep a similar horizontal view on narrow screens
  camera.fov = w / h < 1.3 ? 60 : 45;
  camera.updateProjectionMatrix();
  // put the hero ~75% of the way to the middle of the visible ground strip (more view towards the bottom:
  // ~11 units above / ~9.7 below the hero at 45° fov, was 11.8 / 6.8)
  const p = Math.atan2(CAM_H, CAM_D), v = THREE.MathUtils.degToRad(camera.fov / 2);
  const far = CAM_H / Math.tan(Math.max(0.2, p - v)), near = CAM_H / Math.tan(Math.min(1.5, p + v));
  CAM_OFF.z = CAM_D + 0.75 * ((far + near) / 2 - CAM_D);
  if (typeof onResizeGfx === 'function') onResizeGfx();
}
addEventListener('resize', resize); resize();

// per-world lighting / mood: exposure, light colours + sun direction, fog + haze, ground mist, dappled sun,
// character rim light, CSS vignette. All values come from theme.gfx (data.js), so a world's mood is data.
// "Sunny" mode (pause menu) lifts exposure, ambient fill and shadows for playing in bright sunlight while
// keeping each world's colours.
const GFX_DEF = { exp: 1.0, hemi: 0.8, sun: [0xfff2dd, 1.0], fog: [26, 50], amb: 'dust', vig: 'rgba(0,0,0,.5)', sunDir: [-15, 17, 4], mist: [0, -1.5, 0.8, 0x808080],
  dapple: 0, rim: [0xc8d8ff, 0.3, 0.06], heroPool: 0.2 };
let sunny = false;
try { sunny = localStorage.getItem('dd_sunny') === '1'; } catch (e) { }
const SUNNY = { exp: 1.32, hemi: 1.75, sun: 1.15, fog: 1.25, mist: 0.55, vig: 0.45, rim: 1.2 };
function applyThemeLighting(T) {
  const L = Object.assign({}, GFX_DEF, T.gfx || {});
  const S = sunny ? SUNNY : null;
  scene.background = new THREE.Color(L.bg !== undefined ? L.bg : T.voidc);
  if (S) scene.background.lerp(new THREE.Color(L.fogc !== undefined ? L.fogc : T.voidc), 0.5);
  const fog = S ? [L.fog[0] * S.fog, L.fog[1] * S.fog] : L.fog;
  scene.fog = new THREE.Fog(L.fogc !== undefined ? L.fogc : T.voidc, fog[0], fog[1]);
  hemi.color.setHex(L.sky !== undefined ? L.sky : T.hemi); hemi.groundColor.setHex(L.gnd !== undefined ? L.gnd : T.ground); hemi.intensity = L.hemi * (S ? S.hemi : 1);
  if (S) hemi.groundColor.lerp(hemi.color, 0.3);
  sun.color.setHex(L.sun[0]); sun.intensity = L.sun[1] * (S ? S.sun : 1);
  aimSun(L.sunDir);
  heroLight.color.setHex(L.hero || 0xffe6c8);
  renderer.toneMappingExposure = L.exp * (S ? S.exp : 1);
  const vig = S ? L.vig.replace(/,\s*([\d.]+)\)$/, (m, a) => ',' + (+a * S.vig).toFixed(2) + ')') : L.vig;
  document.documentElement.style.setProperty('--vig', vig);
  if (typeof LOOK_U !== 'undefined') { // look.js shared uniforms (level materials + characters)
    const LK = typeof lookOf === 'function' ? lookOf(T) : {};
    LOOK_U.uLkMist.value.set(L.mist[0] * (S ? S.mist : 1), L.mist[1], L.mist[2], 0); LOOK_U.uLkMistC.value.setHex(L.mist[3]);
    LOOK_U.uLkCookie.value.set(L.dapple * (S ? 0.7 : 1), 0.055, 0.6, 0);
    LOOK_U.uLkAO.value.set((LK.ao || 0.5) * (S ? 0.75 : 1), LK.aoR || 0.42, LK.side || 0.86, LK.base || 0.62);
    LOOK_U.uLkRim.value.set(L.rim[1] * (S ? S.rim : 1), L.rim[2], 0, 0); LOOK_U.uLkRimC.value.setHex(L.rim[0]);
  }
  GFX.L = Object.assign(L, { fog });
  if (typeof onGfxChange === 'function') onGfxChange();
}
function setSunny(on) {
  sunny = !!on;
  try { localStorage.setItem('dd_sunny', sunny ? '1' : '0'); } catch (e) { }
  if (G.theme) applyThemeLighting(G.theme);
  sunLabel();
}
function sunLabel() { const b = $('sunBtn'); if (b) b.classList.toggle('on', sunny); }
if ($('sunBtn')) { $('sunBtn').onclick = () => setSunny(!sunny); sunLabel(); }

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
  tick: () => tone(880, 0.07, 'square', 0.05),
  tock: () => { tone(1320, 0.12, 'square', 0.06); tone(1760, 0.18, 'triangle', 0.05, 0, 0.08); },
  buy: () => { tone(1047, 0.06, 'square', 0.05); tone(1568, 0.1, 'square', 0.05, 0, 0.06); tone(2093, 0.14, 'triangle', 0.05, 0, 0.13); },
  shake: () => noise(0.12, 0.1, 900, 'bandpass'),
  drink: () => { tone(400, 0.12, 'sine', 0.08, 300); tone(700, 0.2, 'triangle', 0.06, 500, 0.1); },
};
function sfx(name) {
  if (!soundOn || !AC.ctx) return;
  const now = performance.now();
  if (AC.last[name] && now - AC.last[name] < 45) return;
  AC.last[name] = now;
  try { SFX[name] && SFX[name](); } catch (e) { }
}
function vibrate(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } }

