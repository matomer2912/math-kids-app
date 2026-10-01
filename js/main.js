// main.js — rendering, input, local player, HUD, menus, audio, networking glue
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

// ---------- level loading ----------
const vis = new Map();
function clearVisuals() { for (const v of vis.values()) { scene.remove(v.obj); if (v.bar) scene.remove(v.bar); } vis.clear(); }

function loadFloor(floor, seed, sx, sz) {
  G.floor = floor; G.seed = seed;
  G.map = G.role === 'guest' ? genDungeon(seed, floor) : Sim.S.map;
  G.theme = themeFor(floor);
  if (G.level) { scene.remove(G.level); G.level.traverse(o => { if (o.isInstancedMesh) o.dispose && o.dispose(); }); }
  G.level = buildLevel(G.map, G.theme);
  scene.add(G.level);
  scene.background = new THREE.Color(G.theme.voidc);
  scene.fog = new THREE.Fog(G.theme.voidc, 20, 40);
  hemi.color.setHex(G.theme.hemi); hemi.groundColor.setHex(G.theme.ground);
  clearVisuals(); clearFx();
  const k = G.myId;
  if (sx !== undefined) { me.x = sx + (k % 2 ? 1 : -1); me.z = sz + 1; if (blockedCircle(G.map, me.x, me.z, 0.4)) { me.x = sx; me.z = sz; } }
  else { me.x = G.map.start.x + ((k % 2) - 0.5) * 2; me.z = G.map.start.z + (k > 1 ? 1.5 : -0.5); }
  me.dodgeT = me.dashT = 0; me.downed = false;
  camera.position.set(me.x + CAM_OFF.x, CAM_OFF.y, me.z + CAM_OFF.z);
  if (floor > Profile.best) Profile.best = floor;
  saveProfile();
  showBanner((isBossFloor(floor) ? '👑 BOSS FLOOR ' : 'Floor ') + floor, G.theme.name + (isBossFloor(floor) ? ' — ' + G.theme.boss.name : ''));
}

let bannerTimer = null;
function showBanner(big, small) {
  $('center').innerHTML = big + (small ? '<small>' + small + '</small>' : '');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { if (!me.downed) $('center').innerHTML = ''; }, 2600);
}

// ---------- host side ----------
const grantQ = new Map();
Sim.onGrant = (pid, g) => {
  if (pid === G.myId) { applyGrant(g); return; }
  if (g.item) { Net.send(pid, { t: 'grant', g: { item: g.item } }); return; }
  const q = grantQ.get(pid) || { xp: 0, coins: 0 };
  q.xp += g.xp || 0; q.coins += g.coins || 0; grantQ.set(pid, q);
};
function flushGrants() {
  for (const [pid, q] of grantQ) { if (q.xp || q.coins) Net.send(pid, { t: 'grant', g: q }); }
  grantQ.clear();
}
Sim.onEvent = a => handleEvent(a);
Sim.onExit = () => {
  sfx('portal');
  hostStartFloor(G.floor + 1);
};
Sim.onWipe = () => {
  Net.broadcast && G.role === 'host' && Net.broadcast({ t: 'msg', m: 'Defeated! Trying again…' });
  showBanner('💀 Defeated!', 'Trying this floor again…');
  setTimeout(() => hostStartFloor(G.floor), 1500);
};
function hostStartFloor(floor) {
  const seed = (Math.random() * 2147483647) | 0;
  Sim.startFloor(floor, seed);
  loadFloor(floor, seed);
  if (G.role === 'host') Net.broadcast({ t: 'floor', f: floor, seed });
}

function startGame(role) {
  audioInit();
  G.role = role;
  G.inGame = true; G.paused = false;
  document.body.classList.add('ingame');
  ['menu', 'lobby', 'wait'].forEach(id => $(id).classList.add('hidden'));
  $('hud').classList.remove('hidden');
  $('addBtn').classList.toggle('hidden', role !== 'host');
  goFullscreen();
  requestWake();
  if (role !== 'guest') {
    G.myId = 0;
    if (!Sim.S.players.has(0)) Sim.addPlayer(0, myStats()); else Sim.setStats(0, myStats());
    hostStartFloor(G.startFloor);
  }
  refreshHUDStatic();
}

function quitToMenu() {
  G.inGame = false; G.role = null; G.view = null; G.snap = null;
  try { Net.disconnect(); } catch (e) { }
  Sim.S.players.clear(); Sim.S.map = null;
  clearVisuals(); clearFx();
  if (G.level) { scene.remove(G.level); G.level = null; }
  document.body.classList.remove('ingame');
  $('hud').classList.add('hidden'); $('pause').classList.add('hidden'); $('inv').classList.add('hidden');
  $('lobby').classList.add('hidden'); $('wait').classList.add('hidden');
  $('menu').classList.remove('hidden');
  saveProfile();
  refreshMenu();
}

// ---------- networking glue ----------
Net.onMessage = (from, m) => {
  if (!m || !m.t) return;
  if (Net.isHost) {
    if (m.t === 'in') Sim.setInput(from, m);
    else if (m.t === 'hello') {
      if (!Sim.S.players.has(from)) Sim.addPlayer(from, m.st); else Sim.setStats(from, m.st);
      refreshLobby();
      toast('👋 ' + (m.st.name || 'Player') + ' joined!');
      if (G.inGame) {
        const hp = Sim.S.players.get(0);
        const p = Sim.S.players.get(from);
        p.x = hp.x; p.z = hp.z; p.floor = G.floor; p.init = false;
        Net.send(from, { t: 'floor', f: G.floor, seed: G.seed, sx: hp.x, sz: hp.z, go: 1 });
      }
    } else if (m.t === 'stats') Sim.setStats(from, m.st);
  } else {
    if (m.t === 's') {
      if (m.fl !== G.floor) return;
      G.snap = decodeSnap(m);
      if (m.ev) for (const a of m.ev) handleEvent(a);
    } else if (m.t === 'floor') {
      if (!G.inGame) startGame('guest');
      G.snap = null;
      loadFloor(m.f, m.seed, m.sx, m.sz);
    } else if (m.t === 'grant') applyGrant(m.g);
    else if (m.t === 'msg') { showBanner(m.m); }
  }
};
Net.onPeerJoin = id => { refreshLobby(); };
Net.onPeerLeave = id => {
  if (Net.isHost || G.role === 'host') {
    const p = Sim.S.players.get(id);
    if (p) toast('👋 ' + p.name + ' left the game');
    Sim.removePlayer(id);
    refreshLobby();
  } else {
    toast('📡 Lost connection to the host');
    showBanner('📡 Connection lost', 'Ask the host to tap ➕ and join again');
    setTimeout(() => { if (G.role === 'guest') quitToMenu(); }, 3500);
  }
};

function decodeSnap(s) {
  return {
    fl: s.fl,
    players: s.p.map(a => ({ id: a[0], x: a[1], z: a[2], f: a[3], hp: a[4], maxHp: a[5], downed: !!(a[6] & 1), atk: !!(a[6] & 2), w: a[7], r: a[8], color: a[9], lvl: a[10], name: a[11], rev: a[12] / 10, aim: a[13] })),
    enemies: s.e.map(a => ({ id: a[0], sk: SKINS[a[1]], x: a[2], z: a[3], f: a[4], hp: a[5], fl: a[6], size: a[7] })),
    projs: s.j.map(a => ({ id: a[0], k: PROJ_KINDS[a[1]], x: a[2], z: a[3], vx: a[4], vz: a[5], col: a[6] })),
    loot: s.l.map(a => ({ id: a[0], kind: a[1], x: a[2], z: a[3], r: a[4], w: a[5] })),
    boss: s.b, po: s.po, pn: s.pn, k: s.k,
  };
}

// ---------- grants / progression (device-local) ----------
function applyGrant(g) {
  let lvlUp = false;
  if (g.xp) {
    Profile.xp += g.xp;
    while (Profile.xp >= xpForLevel(Profile.lvl)) { Profile.xp -= xpForLevel(Profile.lvl); Profile.lvl++; lvlUp = true; }
  }
  if (g.coins) { Profile.coins += g.coins; sfx('coin'); }
  if (g.item) addItem(g.item);
  if (lvlUp) {
    sfx('lvl'); vibrate(80);
    showBanner('⭐ LEVEL UP! ⭐', 'Level ' + Profile.lvl + ' — more health & damage');
    pushStats();
  }
  saveT = 1;
  refreshHUDStatic();
}
function addItem(it) {
  Profile.inv.push(it);
  if (Profile.inv.length > 36) {
    // auto-salvage the weakest non-equipped item
    const cur = equipped();
    let wi = -1, wp = 1e9;
    Profile.inv.forEach((x, i) => { if (x !== cur && itemPower(x) < wp) { wp = itemPower(x); wi = i; } });
    if (wi >= 0) { Profile.coins += salvageValue(Profile.inv[wi]); Profile.inv.splice(wi, 1); Profile.eq = Profile.inv.indexOf(cur); }
  }
  sfx(it.r >= 2 ? 'chest' : 'item');
  const diff = itemPower(it) - itemPower(equipped());
  lootToast(it, diff);
}
function salvageValue(it) { return Math.round((it.r + 1) * (it.r + 1) * 4 * it.p); }
function upgradeCost(it) { return Math.round(15 * it.p * (it.r + 1)); }
function equipItem(it) {
  const i = Profile.inv.indexOf(it); if (i < 0) return;
  Profile.eq = i; saveProfile(); pushStats(); refreshHUDStatic(); sfx('item');
}
function pushStats() {
  if (!G.inGame) return;
  if (G.role === 'guest') Net.send(0, { t: 'stats', st: myStats() });
  else Sim.setStats(G.myId, myStats());
}

// ---------- input ----------
const joyzone = $('joyzone'), joy = $('joy'), knob = $('joyknob');
let joyId = null, joyOx = 0, joyOy = 0;
joyzone.addEventListener('pointerdown', e => {
  audioInit();
  if (joyId !== null) return;
  joyId = e.pointerId; joyOx = e.clientX; joyOy = e.clientY;
  joy.style.left = joyOx + 'px'; joy.style.top = joyOy + 'px'; joy.classList.remove('hidden');
  knob.style.transform = 'translate(0,0)';
  $('joyhint').classList.add('hidden');
  try { joyzone.setPointerCapture(e.pointerId); } catch (_) { }
  e.preventDefault();
});
joyzone.addEventListener('pointermove', e => {
  if (e.pointerId !== joyId) return;
  let dx = e.clientX - joyOx, dy = e.clientY - joyOy;
  const R0 = 55, l = Math.hypot(dx, dy);
  if (l > R0) {
    // drag the base along so the stick never "runs out"
    joyOx += dx / l * (l - R0); joyOy += dy / l * (l - R0);
    joy.style.left = joyOx + 'px'; joy.style.top = joyOy + 'px';
    dx = e.clientX - joyOx; dy = e.clientY - joyOy;
  }
  knob.style.transform = `translate(${dx}px,${dy}px)`;
  input.jx = dx / R0; input.jz = dy / R0;
  const m = Math.hypot(input.jx, input.jz);
  if (m < 0.18) { input.jx = input.jz = 0; }
});
const joyEnd = e => { if (e.pointerId !== joyId) return; joyId = null; input.jx = input.jz = 0; joy.classList.add('hidden'); };
joyzone.addEventListener('pointerup', joyEnd); joyzone.addEventListener('pointercancel', joyEnd);

function holdBtn(el, on, off) {
  el.addEventListener('pointerdown', e => { e.preventDefault(); audioInit(); try { el.setPointerCapture(e.pointerId); } catch (_) { } el.classList.add('down'); on(); });
  const up = () => { el.classList.remove('down'); off && off(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  el.addEventListener('contextmenu', e => e.preventDefault());
}
holdBtn($('atkBtn'), () => input.atk = true, () => input.atk = false);
holdBtn($('spBtn'), () => trySpecial());
holdBtn($('dgBtn'), () => tryDodge());
holdBtn($('ptBtn'), () => tryPotion());
addEventListener('keydown', e => {
  input.keys[e.code] = true;
  if (!G.inGame) return;
  if (e.code === 'Space') tryDodge();
  if (e.code === 'KeyK') trySpecial();
  if (e.code === 'KeyH' || e.code === 'KeyQ') tryPotion();
  if (e.code === 'KeyJ') input.atk = true;
  if (e.code === 'KeyI') toggleInv();
});
addEventListener('keyup', e => { input.keys[e.code] = false; if (e.code === 'KeyJ') input.atk = false; });
document.addEventListener('contextmenu', e => e.preventDefault());

function trySpecial() {
  if (me.downed || me.spCd > 0 || !G.inGame) return;
  const it = equipped(), W = WEAPONS[it.w];
  me.spCd = W.scd;
  if (W.special === 'dash') {
    const t = nearestViewEnemy(14, false);
    me.dashA = t ? Math.atan2(t.x - me.x, t.z - me.z) : me.f;
    me.f = me.dashA; me.dashT = 0.2;
  }
  me.an++;
  vibrate(25);
}
function tryDodge() {
  if (me.downed || me.dodgeCd > 0 || !G.inGame) return;
  me.dodgeCd = COOLDOWN.dodge; me.dodgeT = 0.22;
  me.dodgeA = (Math.abs(me.mx) + Math.abs(me.mz) > 0.1) ? Math.atan2(me.mx, me.mz) : me.f;
  me.dn++;
}
function tryPotion() {
  if (me.downed || me.potCd > 0 || !G.inGame) return;
  me.potCd = COOLDOWN.potion; me.pn++;
}

function nearestViewEnemy(maxD, props) {
  const v = G.view; if (!v) return null;
  let best = null, bd = maxD * maxD;
  for (const e of v.enemies) {
    const isProp = e.sk === 'chest' || e.sk === 'pot';
    if (isProp && !props) continue;
    const d = (e.x - me.x) ** 2 + (e.z - me.z) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function myViewPlayer() { const v = G.view; if (!v) return null; return v.players.find(p => p.id === G.myId) || null; }

function updateMe(dt) {
  if (!G.map) return;
  const mp = myViewPlayer();
  const wasDown = me.downed;
  me.downed = mp ? mp.downed : false;
  if (me.downed && !wasDown) { sfx('down'); vibrate(200); }
  if (!me.downed && wasDown) { $('center').innerHTML = ''; showBanner('💪 Revived!'); }
  me.spCd -= dt; me.potCd -= dt; me.dodgeCd -= dt;
  let mx = input.jx, mz = input.jz;
  const K = input.keys;
  if (K.KeyW || K.ArrowUp) mz -= 1; if (K.KeyS || K.ArrowDown) mz += 1;
  if (K.KeyA || K.ArrowLeft) mx -= 1; if (K.KeyD || K.ArrowRight) mx += 1;
  const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  if (me.downed) { mx = mz = 0; me.dodgeT = me.dashT = 0; }
  me.mx = mx; me.mz = mz;
  const it = equipped(), W = WEAPONS[it.w];
  const spd = 7.2 * (input.atk && W.kind !== 'melee' ? 0.7 : 1);
  if (me.dodgeT > 0) { me.dodgeT -= dt; moveCircle(G.map, me, Math.sin(me.dodgeA) * 21 * dt, Math.cos(me.dodgeA) * 21 * dt, 0.4); }
  else if (me.dashT > 0) { me.dashT -= dt; moveCircle(G.map, me, Math.sin(me.dashA) * 40 * dt, Math.cos(me.dashA) * 40 * dt, 0.4); }
  else moveCircle(G.map, me, mx * spd * dt, mz * spd * dt, 0.4);
  me.moving = ml > 0.1 || me.dodgeT > 0 || me.dashT > 0;
  if (input.atk && !me.downed) {
    const t = nearestViewEnemy(W.kind === 'melee' ? W.range + 2.5 : 18, false) || nearestViewEnemy(4, true);
    if (t) me.f = Math.atan2(t.x - me.x, t.z - me.z);
    else if (ml > 0.1) me.f = Math.atan2(mx, mz);
  } else if (ml > 0.1 && me.dashT <= 0) me.f = Math.atan2(mx, mz);
}
function myInputMsg() {
  return { t: 'in', fl: G.floor, x: Math.round(me.x * 100) / 100, z: Math.round(me.z * 100) / 100, f: Math.round(me.f * 100) / 100, mv: me.moving ? 1 : 0, atk: input.atk ? 1 : 0, an: me.an, pn: me.pn, dn: me.dn };
}

// ---------- visuals ----------
const HPBAR_BG = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false });
const HPBAR_FG = new THREE.MeshBasicMaterial({ color: 0xff3b3b, depthTest: false });
const PLANE = new THREE.PlaneGeometry(1, 1);
function makeBar() {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(PLANE, HPBAR_BG); bg.scale.set(1.3, 0.18, 1); bg.renderOrder = 10;
  const fg = new THREE.Mesh(PLANE, HPBAR_FG); fg.scale.set(1.24, 0.12, 1); fg.position.z = 0.01; fg.renderOrder = 11;
  g.add(bg, fg); g.userData.fg = fg;
  g.quaternion.copy(camera.quaternion);
  return g;
}
let visFrame = 0;
function syncVisuals(dt) {
  const v = G.view; if (!v) return;
  visFrame++;
  const guest = G.role === 'guest';
  const sm = guest ? Math.min(1, dt * 12) : 1;
  const T = G.time;
  // players
  for (const p of v.players) {
    const key = 'p' + p.id;
    let o = vis.get(key);
    if (!o) {
      const model = buildPlayerModel(p.color);
      o = { obj: model.root, model, x: p.x, z: p.z, f: p.f, px: p.x, pz: p.z, color: p.color };
      scene.add(o.obj); vis.set(key, o);
    }
    o.seen = visFrame;
    const mine = p.id === G.myId;
    const tx = mine ? me.x : p.x, tz = mine ? me.z : p.z;
    o.px = o.x; o.pz = o.z;
    o.x += (tx - o.x) * (mine ? 1 : sm); o.z += (tz - o.z) * (mine ? 1 : sm);
    const spd = Math.hypot(o.x - o.px, o.z - o.pz) / Math.max(dt, 0.001);
    const wpnW = mine ? equipped().w : p.w, wpnR = mine ? equipped().r : p.r;
    setWeapon(o.model, wpnW, wpnR);
    let f = mine ? me.f : (p.atk ? p.aim : p.f);
    o.f = lerpAngle(o.f, f, Math.min(1, dt * 18));
    o.obj.position.set(o.x, 0, o.z);
    o.obj.rotation.y = o.f;
    if (p.atk && !o.wasAtk) o.atkT = 0.28;
    o.wasAtk = p.atk;
    o.atkT = (o.atkT || 0) - dt;
    if (p.downed) { o.model.body.rotation.x = -Math.PI / 2; o.model.body.position.y = 0.3; }
    else {
      o.model.body.rotation.x = 0;
      const dodging = mine && me.dodgeT > 0;
      if (dodging) o.model.body.rotation.x = (1 - me.dodgeT / 0.22) * Math.PI * 2;
      animateModel(o.model, dt, dodging ? 0 : spd, o.atkT > 0 ? o.atkT / 0.28 : 0, 0, T);
    }
    o.model.ring.material.opacity = 0.6 + 0.3 * Math.sin(T * 4);
  }
  // enemies
  for (const e of v.enemies) {
    const key = 'e' + e.id;
    let o = vis.get(key);
    if (!o) {
      const model = buildEnemyModel(e.sk, G.theme, e.size);
      o = { obj: model.root, model, x: e.x, z: e.z, f: e.f, px: e.x, pz: e.z };
      if (e.fl & 16) { // elite glow ring
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.05, 20), new THREE.MeshBasicMaterial({ color: 0xffb300, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; model.root.add(ring);
      }
      scene.add(o.obj); vis.set(key, o);
      if (e.sk !== 'boss' && e.sk !== 'chest' && e.sk !== 'pot') { o.bar = makeBar(); o.bar.visible = false; scene.add(o.bar); }
    }
    o.seen = visFrame;
    o.px = o.x; o.pz = o.z;
    o.x += (e.x - o.x) * sm; o.z += (e.z - o.z) * sm;
    const spd = Math.hypot(o.x - o.px, o.z - o.pz) / Math.max(dt, 0.001);
    o.f = lerpAngle(o.f, e.f, Math.min(1, dt * 12));
    o.obj.position.set(o.x, 0, o.z);
    o.obj.rotation.y = o.f;
    const wind = e.fl & 1;
    animateModel(o.model, dt, spd, 0, wind, T);
    const flash = (e.fl & 2) || (wind && e.sk === 'cube' && Math.sin(T * 25) > 0);
    if (flash) { flashModel(o.model, true); o.flashing = true; }
    else if (o.flashing) { flashModel(o.model, false); o.flashing = false; }
    if (!flash) {
      const tint = (e.fl & 4) ? 0x662200 : (e.fl & 8) ? 0x113366 : -1;
      if (tint !== (o.tint === undefined ? -1 : o.tint)) {
        for (const m of o.model.mats) { if (m.userData.e === undefined) m.userData.e = m.emissive.getHex(); m.emissive.setHex(tint >= 0 ? tint : m.userData.e); }
        o.tint = tint;
      }
    }
    if (o.bar) {
      o.bar.visible = e.hp < 100;
      o.bar.position.set(o.x, 2.4 * (e.size || 1) + 0.3, o.z);
      o.bar.userData.fg.scale.x = 1.24 * Math.max(0, e.hp) / 100;
      o.bar.userData.fg.position.x = -0.62 * (1 - Math.max(0, e.hp) / 100);
    }
  }
  // projectiles
  for (const j of v.projs) {
    const key = 'j' + j.id;
    let o = vis.get(key);
    if (!o) {
      const model = buildProjModel(j.k, j.col ? RAR[j.col].hex : 0);
      o = { obj: model, x: j.x, z: j.z, sx: j.x, sz: j.z };
      scene.add(o.obj); vis.set(key, o);
    }
    o.seen = visFrame;
    if (guest) {
      if (o.sx !== j.x || o.sz !== j.z) { o.sx = j.x; o.sz = j.z; o.x = j.x; o.z = j.z; }
      else { o.x += j.vx * dt; o.z += j.vz * dt; }
    } else { o.x = j.x; o.z = j.z; }
    o.obj.position.set(o.x, 1.0, o.z);
    o.obj.rotation.y = Math.atan2(j.vx, j.vz);
    if (j.k === 'bone') o.obj.rotation.x += dt * 12;
  }
  // loot (only mine + shared)
  for (const l of v.loot) {
    const key = 'l' + l.id;
    let o = vis.get(key);
    if (!o) {
      const model = buildLootModel(l.kind, l.r, l.w);
      o = { obj: model, x: l.x, z: l.z, born: T };
      scene.add(o.obj); vis.set(key, o);
    }
    o.seen = visFrame;
    o.x += (l.x - o.x) * sm; o.z += (l.z - o.z) * sm;
    o.obj.position.set(o.x, 0, o.z);
    const inner = o.obj.userData.inner;
    inner.rotation.y += dt * 2.5;
    inner.position.y = 0.15 + Math.sin(T * 3 + l.id) * 0.12;
  }
  for (const [k, o] of vis) {
    if (o.seen !== visFrame) { scene.remove(o.obj); if (o.bar) scene.remove(o.bar); vis.delete(k); }
  }
  // portal
  if (G.level && G.level.userData.portal) {
    const pu = G.level.userData.portal.userData;
    const open = !!v.po;
    pu.ring.material.color.setHex(open ? 0x00e5ff : 0x555555);
    pu.disc.material.opacity = open ? 0.55 + 0.2 * Math.sin(T * 5) : 0;
    pu.ring.rotation.z += dt * (open ? 2 : 0.2);
  }
  if (G.level && G.level.userData.flame) {
    const fm = G.level.userData.flame.material;
    fm.color.setHSL(G.theme.deco === 'ice' ? 0.52 : 0.08 + 0.02 * Math.sin(T * 9), 1, 0.55 + 0.05 * Math.sin(T * 13));
  }
}
function lerpAngle(a, b, t) { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; }

// ---------- effects ----------
const fxList = [];
function addFx(obj, life, upd) { scene.add(obj); fxList.push({ obj, t: 0, life, upd }); }
function clearFx() { for (const f of fxList) scene.remove(f.obj); fxList.length = 0; $('fx').innerHTML = ''; }
function updateFx(dt) {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i]; f.t += dt;
    const k = f.t / f.life;
    if (k >= 1) { scene.remove(f.obj); if (!f.keep && f.obj.material && f.obj.material.dispose) f.obj.material.dispose(); fxList.splice(i, 1); continue; }
    f.upd && f.upd(f, k, dt);
  }
}
const ringGeo = new THREE.RingGeometry(0.86, 1, 40);
const discGeo = new THREE.CircleGeometry(1, 32);
const sectorCache = {};
function basic(color, op) { return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide }); }
function slashFx(pid, ang, range, arc, rar) {
  const key = range + '_' + arc;
  if (!sectorCache[key]) sectorCache[key] = new THREE.RingGeometry(range * 0.35, range, 16, 1, -Math.PI / 2 - arc / 2, arc);
  const o = vis.get('p' + pid);
  const px = pid === G.myId ? me.x : (o ? o.x : 0), pz = pid === G.myId ? me.z : (o ? o.z : 0);
  const grp = new THREE.Group();
  const m = new THREE.Mesh(sectorCache[key], basic(rar >= 2 ? RAR[rar].hex : 0xffffff, 0.55));
  m.rotation.x = -Math.PI / 2; grp.add(m);
  grp.position.set(px, 0.9, pz); grp.rotation.y = ang;
  grp.material = m.material;
  addFx(grp, 0.18, (f, k) => { m.material.opacity = 0.55 * (1 - k); grp.scale.setScalar(0.8 + 0.3 * k); });
  if (o && pid !== G.myId) o.atkT = 0.28;
}
function ringFx(x, z, r, color) {
  const m = new THREE.Mesh(ringGeo, basic(color, 0.8));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.15, z);
  addFx(m, 0.4, (f, k) => { m.scale.setScalar(r * (0.3 + 0.7 * k)); m.material.opacity = 0.8 * (1 - k); });
}
function boomFx(x, z, r, color) {
  const m = new THREE.Mesh(SPHG, basic(color, 0.6));
  m.position.set(x, 0.5, z);
  addFx(m, 0.35, (f, k) => { m.scale.setScalar(r * (0.4 + 0.6 * k)); m.material.opacity = 0.6 * (1 - k); });
  ringFx(x, z, r, color);
  particles(x, z, color, 8, 1);
  sfx('boom');
}
function teleFx(x, z, r, dur) {
  const grp = new THREE.Group();
  const outer = new THREE.Mesh(discGeo, basic(0xff2020, 0.22)); outer.rotation.x = -Math.PI / 2; outer.scale.setScalar(r);
  const inner = new THREE.Mesh(discGeo, basic(0xff2020, 0.35)); inner.rotation.x = -Math.PI / 2; inner.position.y = 0.01;
  const edge = new THREE.Mesh(ringGeo, basic(0xff4040, 0.9)); edge.rotation.x = -Math.PI / 2; edge.scale.setScalar(r); edge.position.y = 0.02;
  grp.add(outer, inner, edge); grp.position.set(x, 0.08, z);
  addFx(grp, dur, (f, k) => { inner.scale.setScalar(Math.max(0.01, r * k)); edge.material.opacity = 0.6 + 0.4 * Math.sin(f.t * 20); });
}
function teleLineFx(x, z, ang, len, dur) {
  const grp = new THREE.Group();
  const m = new THREE.Mesh(PLANE, basic(0xff2020, 0.3));
  m.rotation.x = -Math.PI / 2; m.scale.set(3.4, len, 1); m.position.z = len / 2;
  grp.add(m); grp.position.set(x, 0.08, z); grp.rotation.y = ang;
  addFx(grp, dur, (f, k) => { m.material.opacity = 0.2 + 0.25 * Math.abs(Math.sin(f.t * 14)); });
}
function zapFx(x1, z1, x2, z2) {
  const pts = [new THREE.Vector3(x1, 1.2, z1)];
  for (let i = 1; i < 4; i++) { const t = i / 4; pts.push(new THREE.Vector3(x1 + (x2 - x1) * t + (Math.random() - 0.5), 1.2 + (Math.random() - 0.5) * 0.6, z1 + (z2 - z1) * t + (Math.random() - 0.5))); }
  pts.push(new THREE.Vector3(x2, 1.2, z2));
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x9ff0ff }));
  addFx(l, 0.18, (f, k) => { l.material.opacity = 1 - k; });
  sfx('zap');
}
const partMats = {};
function particles(x, z, color, n, s) {
  if (fxList.length > 160) return;
  const mat = partMats[color] || (partMats[color] = new THREE.MeshBasicMaterial({ color }));
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(BOXG, mat);
    const sz = (0.12 + Math.random() * 0.15) * s; m.scale.setScalar(sz);
    m.position.set(x, 0.8, z);
    const vx = (Math.random() - 0.5) * 8, vz = (Math.random() - 0.5) * 8; let vy = 3 + Math.random() * 5;
    const fx = { obj: m, t: 0, life: 0.6, keep: true, upd: (f, k, dt) => { vy -= 20 * dt; m.position.x += vx * dt; m.position.z += vz * dt; m.position.y = Math.max(0.05, m.position.y + vy * dt); m.rotation.x += dt * 8; } };
    scene.add(m); fxList.push(fx);
  }
}
const SKIN_COLORS = { mummy: 0xe8dcc0, skeleton: 0xeeeeee, zombie: 0x6aa84f, skelArcher: 0xeeeeee, scorpion: 0xb5651d, spider: 0x333333, imp: 0xd8381e, golem: 0x9a8a70, cube: 0x7cc242, priest: 0xf3e2a0, necro: 0x7a3cc2, boss: 0xffcc33, chest: 0xffc107, pot: 0xc0703a };
function dieFx(x, z, sk, size) {
  const name = SKINS[sk];
  particles(x, z, SKIN_COLORS[name] || 0xffffff, name === 'boss' ? 30 : 7, Math.max(1, size || 1));
  if (name === 'pot' || name === 'chest') sfx('hit');
}
function dmgNumber(x, z, amt, crit, mine) {
  const layer = $('fx');
  if (layer.childElementCount > 28) return;
  const v = new THREE.Vector3(x, 2.2, z).project(camera);
  if (v.z > 1) return;
  const el = document.createElement('div');
  el.className = 'dmg' + (crit ? ' crit' : '') + (mine ? ' me' : '');
  el.textContent = (mine ? '-' : '') + amt + (crit ? '!' : '');
  el.style.left = ((v.x + 1) / 2 * innerWidth + (Math.random() - 0.5) * 20) + 'px';
  el.style.top = ((1 - v.y) / 2 * innerHeight) + 'px';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 760);
}
function playerPos(pid) {
  if (pid === G.myId) return { x: me.x, z: me.z };
  const o = vis.get('p' + pid); return o ? { x: o.x, z: o.z } : null;
}

function handleEvent(a) {
  switch (a[0]) {
    case 'dmg': dmgNumber(a[1], a[2], a[3], a[4]); sfx('hit'); break;
    case 'slash': slashFx(a[1], a[2], a[3], a[4], a[5]); sfx('swing'); break;
    case 'boom': boomFx(a[1], a[2], a[3], a[4]); break;
    case 'ring': ringFx(a[1], a[2], a[3], a[4]); break;
    case 'tele': teleFx(a[1], a[2], a[3], a[4]); break;
    case 'teleline': teleLineFx(a[1], a[2], a[3], a[4], a[5]); break;
    case 'zap': zapFx(a[1], a[2], a[3], a[4]); break;
    case 'die': dieFx(a[1], a[2], a[3], a[4]); break;
    case 'hurt': {
      const pp = playerPos(a[1]);
      if (a[1] === G.myId) {
        sfx('hurt'); vibrate(35);
        const h = $('hurt'); h.style.opacity = 1; clearTimeout(h._t); h._t = setTimeout(() => h.style.opacity = 0, 160);
        if (pp) dmgNumber(pp.x, pp.z, a[2], 0, true);
      }
      break;
    }
    case 'down':
      if (a[1] !== G.myId) { const o = (G.view && G.view.players.find(p => p.id === a[1])); toast('💀 ' + (o ? o.name : 'A teammate') + ' is down! Stand next to them to revive!'); }
      break;
    case 'revived': { const pp = playerPos(a[1]); if (pp) ringFx(pp.x, pp.z, 2.5, 0x66ff88); sfx('heal'); break; }
    case 'heal': { const pp = playerPos(a[1]); if (pp) ringFx(pp.x, pp.z, 1.8, 0x66ff88); if (a[1] === G.myId) sfx('heal'); break; }
    case 'pick': if (a[1] === G.myId && a[2] === 'heart') sfx('heal'); break;
    case 'msg': showBanner(a[1]); break;
    case 'bossdead': sfx('fanfare'); vibrate(150); break;
    case 'shake': G.shake = Math.max(G.shake, a[1]); break;
    case 'special': sfx('special'); break;
    case 'dashfx': { const m = new THREE.Mesh(PLANE, basic(0xb0e0ff, 0.5)); m.rotation.x = -Math.PI / 2; m.scale.set(1.2, 8, 1); const g = new THREE.Group(); g.add(m); m.position.z = 4; g.position.set(a[1], 0.5, a[2]); g.rotation.y = a[3]; g.material = m.material; addFx(g, 0.25, (f, k) => m.material.opacity = 0.5 * (1 - k)); break; }
    case 'sfx': sfx(a[1]); break;
  }
}

// ---------- camera ----------
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  camTarget.set(me.x + CAM_OFF.x, CAM_OFF.y, me.z + CAM_OFF.z);
  camera.position.lerp(camTarget, Math.min(1, dt * 7));
  if (G.shake > 0.01) {
    G.shake *= Math.pow(0.02, dt);
    const s = G.shake * 0.35;
    camera.position.x += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s;
  }
}

// ---------- HUD ----------
function refreshHUDStatic() {
  const it = equipped(), W = WEAPONS[it.w];
  $('invBtn').textContent = W.icon;
  $('invBtn').style.borderColor = RAR[it.r].c;
  $('spBtn').querySelector('.ic').textContent = W.sicon;
  $('atkBtn').querySelector('.ic').textContent = W.icon;
  $('xpfill').style.width = (100 * Profile.xp / xpForLevel(Profile.lvl)) + '%';
}
let hudT = 0;
function updateHUD(dt) {
  hudT -= dt; if (hudT > 0) return; hudT = 0.1;
  const v = G.view; if (!v) return;
  const mp = myViewPlayer();
  if (mp) {
    $('hpfill').style.width = (100 * Math.max(0, mp.hp) / mp.maxHp) + '%';
    $('hptext').textContent = Math.max(0, mp.hp) + ' / ' + mp.maxHp;
    if (mp.downed) {
      $('center').innerHTML = '💀 You are down!<small>A teammate can stand next to you to revive you' + (mp.rev > 0 ? ' — ' + Math.round(100 * mp.rev / 2.2) + '%' : '') + '</small>';
    }
  }
  const W = WEAPONS[equipped().w];
  $('lvlrow').textContent = 'Lv ' + Profile.lvl + ' · Floor ' + G.floor + (v.k ? ' · 👾 ' + v.k : '') + (v.po && v.pn && v.players.length > 1 ? ' · 🌀 ' + v.pn + '/' + v.players.filter(p => !p.downed).length + ' at portal' : '');
  const spK = Math.max(0, me.spCd) / W.scd;
  $('spBtn').querySelector('.cd').style.background = spK > 0 ? `conic-gradient(rgba(0,0,0,.65) ${spK * 360}deg, transparent 0)` : 'none';
  const pK = Math.max(0, me.potCd) / COOLDOWN.potion;
  $('ptBtn').querySelector('.cd').style.background = pK > 0 ? `conic-gradient(rgba(0,0,0,.65) ${pK * 360}deg, transparent 0)` : 'none';
  // boss
  if (v.boss) { $('bossbar').classList.remove('hidden'); $('bossname').textContent = v.boss[0]; $('bossfill').style.width = (v.boss[1] / 10) + '%'; }
  else $('bossbar').classList.add('hidden');
  // team
  const others = v.players.filter(p => p.id !== G.myId);
  $('team').innerHTML = others.map(p => `<div class="tm"><span class="dot" style="background:${p.color}"></span>${esc(p.name)} <span class="bar"><i style="width:${100 * Math.max(0, p.hp) / p.maxHp}%"></i></span>${p.downed ? '💀' : ''}</div>`).join('');
  // off-screen teammate arrows
  const arrows = $('arrows');
  let html = '';
  for (const p of others) {
    const o = vis.get('p' + p.id); if (!o) continue;
    const sv = new THREE.Vector3(o.x, 1, o.z).project(camera);
    if (Math.abs(sv.x) < 0.95 && Math.abs(sv.y) < 0.95 && sv.z < 1) continue;
    const ang = Math.atan2(-sv.y, sv.x);
    const cx = innerWidth / 2 + Math.cos(ang) * (innerWidth / 2 - 40), cy = innerHeight / 2 + Math.sin(ang) * (innerHeight / 2 - 40);
    html += `<div class="arw" style="left:${cx - 12}px;top:${cy - 11}px;border-bottom-color:${p.color};transform:rotate(${ang + Math.PI / 2}rad)"></div>`;
  }
  arrows.innerHTML = html;
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function toast(text, btn, onBtn, ms) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = '<span>' + text + '</span>';
  if (btn) { const b = document.createElement('button'); b.textContent = btn; b.onclick = () => { onBtn(); el.remove(); }; el.appendChild(b); }
  const box = $('toast');
  box.appendChild(el);
  while (box.childElementCount > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), ms || 3500);
}
function lootToast(it, diff) {
  const W = WEAPONS[it.w];
  const txt = `${W.icon} <span style="color:${RAR[it.r].c}">${esc(it.n)}</span> ${it.e.map(e => ENCH[e].icon).join('')} <span class="${diff > 0 ? 'up-green' : 'down-red'}">${diff > 0 ? '▲' + diff : (diff < 0 ? '▼' + (-diff) : '=')}</span>`;
  if (diff > 0) toast(txt, 'EQUIP', () => equipItem(it), 6000);
  else toast(txt, null, null, 2500);
  if (diff > 0) { const b = $('invBtn'); b.querySelector('.badge') || b.insertAdjacentHTML('beforeend', '<span class="badge">!</span>'); }
}

// ---------- inventory ----------
function toggleInv() { if ($('inv').classList.contains('hidden')) openInv(); else $('inv').classList.add('hidden'); }
function openInv() {
  $('inv').classList.remove('hidden');
  const b = $('invBtn').querySelector('.badge'); if (b) b.remove();
  renderInv();
}
function renderInv() {
  $('coinsLbl').textContent = '🪙 ' + Profile.coins;
  const cur = equipped();
  const list = Profile.inv.slice().sort((a, b) => (b === cur) - (a === cur) || itemPower(b) - itemPower(a));
  const box = $('invList'); box.innerHTML = '';
  for (const it of list) {
    const W = WEAPONS[it.w];
    const isEq = it === cur;
    const diff = itemPower(it) - itemPower(cur);
    const el = document.createElement('div');
    el.className = 'item' + (isEq ? ' eq' : '');
    el.style.borderColor = RAR[it.r].c;
    el.innerHTML = `<div class="top"><span class="ico">${W.icon}</span><div><div class="nm" style="color:${RAR[it.r].c}">${esc(it.n)}</div><div class="rr">${RAR[it.r].n} ${W.name} · Lv ${it.p}</div></div></div>
      <div class="pw">⚡ Power ${itemPower(it)} ${isEq ? '· EQUIPPED' : `<span class="${diff > 0 ? 'up-green' : 'down-red'}">(${diff >= 0 ? '+' : ''}${diff})</span>`}</div>
      <div class="en">${W.sicon} ${W.sname}${it.e.length ? '<br>' + it.e.map(e => ENCH[e].icon + ' ' + ENCH[e].desc).join('<br>') : ''}</div>
      <div class="acts"></div>`;
    const acts = el.querySelector('.acts');
    if (!isEq) {
      const eb = document.createElement('button'); eb.textContent = 'Equip'; eb.onclick = () => { equipItem(it); renderInv(); }; acts.appendChild(eb);
      const sb = document.createElement('button'); sb.className = 'sal'; sb.textContent = '♻️ +' + salvageValue(it); sb.onclick = () => { Profile.coins += salvageValue(it); Profile.inv.splice(Profile.inv.indexOf(it), 1); Profile.eq = Profile.inv.indexOf(cur); saveProfile(); sfx('coin'); renderInv(); }; acts.appendChild(sb);
    } else {
      const cost = upgradeCost(it);
      const ub = document.createElement('button'); ub.className = 'up'; ub.textContent = `⬆️ Upgrade (🪙${cost})`;
      if (Profile.coins < cost) ub.style.opacity = 0.45;
      ub.onclick = () => { if (Profile.coins < cost) { toast('Not enough coins — smash pots & salvage gear!'); return; } Profile.coins -= cost; it.p++; saveProfile(); pushStats(); sfx('lvl'); renderInv(); };
      acts.appendChild(ub);
    }
    box.appendChild(el);
  }
}
$('invBtn').onclick = () => openInv();
$('invClose').onclick = () => $('inv').classList.add('hidden');

// ---------- pause ----------
function updatePauseLabels() {
  $('lowBtn').textContent = '🔋 Battery saver: ' + (lowPower ? 'ON' : 'OFF');
  $('sndBtn').textContent = (soundOn ? '🔊' : '🔇') + ' Sound: ' + (soundOn ? 'ON' : 'OFF');
}
$('menuBtn').onclick = () => { $('pause').classList.remove('hidden'); if (G.role === 'solo') G.paused = true; updatePauseLabels(); };
const closePause = () => { $('pause').classList.add('hidden'); G.paused = false; };
$('pauseClose').onclick = closePause; $('resumeBtn').onclick = closePause;
$('lowBtn').onclick = () => { lowPower = !lowPower; localStorage.setItem('dd_low', lowPower ? '1' : '0'); applyPR(); resize(); updatePauseLabels(); };
$('sndBtn').onclick = () => { soundOn = !soundOn; localStorage.setItem('dd_snd', soundOn ? '1' : '0'); updatePauseLabels(); };
$('quitBtn').onclick = () => { closePause(); quitToMenu(); };
$('addBtn').onclick = () => {
  Net.hostAddPlayer().then(id => toast('✅ Player ' + (id + 1) + ' connected!')).catch(() => { });
};

// ---------- menus ----------
function refreshMenu() {
  $('nameIn').value = Profile.name || '';
  const sw = $('swatches'); sw.innerHTML = '';
  PLAYER_COLORS.forEach(c => {
    const b = document.createElement('button'); b.className = 'sw' + (c === Profile.color ? ' on' : ''); b.style.background = c;
    b.onclick = () => { Profile.color = c; saveProfile(); refreshMenu(); };
    sw.appendChild(b);
  });
  const it = equipped();
  $('heroStat').innerHTML = `⭐ Level ${Profile.lvl} · 🏆 Best floor ${Profile.best} · 🪙 ${Profile.coins}<br>${WEAPONS[it.w].icon} <span style="color:${RAR[it.r].c}">${esc(it.n)}</span> (Power ${itemPower(it)})`;
  // checkpoint floors: 1, 4, 7, ... up to best
  const chips = $('floorChips'); chips.innerHTML = '';
  const cps = []; for (let f = 1; f <= Profile.best; f += 3) cps.push(f);
  if (!cps.includes(G.startFloor)) G.startFloor = cps[cps.length - 1];
  if (cps.length > 1) {
    chips.insertAdjacentHTML('beforeend', '<span class="stat" style="margin:0 4px 0 0;align-self:center">Start at:</span>');
    cps.slice(-5).forEach(f => {
      const b = document.createElement('button'); b.className = 'chip' + (f === G.startFloor ? ' on' : ''); b.textContent = 'Floor ' + f;
      b.onclick = () => { G.startFloor = f; refreshMenu(); };
      chips.appendChild(b);
    });
  }
}
$('nameIn').addEventListener('input', e => { Profile.name = e.target.value.trim().slice(0, 12); saveProfile(); });
$('soloBtn').onclick = () => { audioInit(); startGame('solo'); };
$('hostBtn').onclick = () => {
  audioInit(); goFullscreen();
  Net.hostStart();
  G.role = 'host'; G.myId = 0;
  Sim.S.players.clear();
  Sim.addPlayer(0, myStats());
  $('menu').classList.add('hidden'); $('lobby').classList.remove('hidden');
  refreshLobby();
};
function refreshLobby() {
  const list = $('lobbyList');
  if (!list) return;
  const rows = [...Sim.S.players.values()].map(p => `<div class="pl"><span class="sw" style="background:${p.color};width:26px;height:26px"></span>${esc(p.name)} ${p.id === 0 ? '👑' : ''} <span style="opacity:.7;font-size:14px">Lv ${p.lvl}</span></div>`);
  list.innerHTML = rows.join('') || 'Nobody yet';
}
$('addPlayerBtn').onclick = () => { Net.hostAddPlayer().then(() => refreshLobby()).catch(() => { }); };
$('startCoopBtn').onclick = () => { startGame('host'); };
$('lobbyBack').onclick = () => { quitToMenu(); };
$('joinBtn').onclick = () => {
  audioInit(); goFullscreen();
  G.role = 'guest';
  Net.joinGame().then(id => {
    G.myId = id;
    Net.send(0, { t: 'hello', st: myStats() });
    $('menu').classList.add('hidden'); $('wait').classList.remove('hidden');
  }).catch(() => { G.role = null; });
};
$('waitBack').onclick = () => quitToMenu();
$('shareBtn').onclick = () => {
  const url = location.href.split('#')[0].split('?')[0];
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const n = qr.getModuleCount(), cv = $('shareQR');
  const size = Math.floor(Math.min(innerWidth * 0.5, innerHeight * 0.62, 420));
  const cell = Math.max(2, Math.floor(size / (n + 8)));
  cv.width = cv.height = cell * (n + 8);
  cv.style.width = cv.style.height = cv.width + 'px';
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + 4) * cell, (r + 4) * cell, cell, cell);
  $('shareUrl').textContent = url;
  $('share').classList.remove('hidden');
};
$('shareClose').onclick = () => $('share').classList.add('hidden');

function goFullscreen() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => { try { screen.orientation.lock('landscape').catch(() => { }); } catch (e) { } }).catch(() => { });
    }
  } catch (e) { }
}
let wakeLock = null;
async function requestWake() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && G.inGame) requestWake(); });

// ---------- main loop ----------
let lastT = performance.now(), netT = 0, inT = 0, lastRender = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (lowPower && now - lastRender < 31) return;
  lastRender = now;
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  G.time += dt;
  if (G.inGame && G.map) {
    updateMe(dt);
    if (G.role !== 'guest') {
      Sim.setInput(G.myId, myInputMsg());
      if (!G.paused) Sim.update(dt);
      G.view = decodeSnap(Sim.snapshot(G.myId));
      if (G.role === 'host') {
        netT -= dt;
        if (netT <= 0) {
          netT = 1 / 15;
          const evs = Sim.S.events.splice(0);
          for (const id of Net.peerIds()) { const s = Sim.snapshot(id); s.ev = evs; Net.send(id, s, false); }
          flushGrants();
        }
      } else Sim.S.events.length = 0;
    } else {
      inT -= dt;
      if (inT <= 0) { inT = 0.05; Net.send(0, myInputMsg(), false); }
      G.view = G.snap;
    }
    syncVisuals(dt);
    updateFx(dt);
    updateCamera(dt);
    updateHUD(dt);
    if (saveT > 0) { saveT -= dt; if (saveT <= 0) saveProfile(); }
  } else {
    // idle menu backdrop: slow orbit
    camera.position.set(Math.sin(G.time * 0.1) * 6, CAM_OFF.y, CAM_OFF.z + Math.cos(G.time * 0.1) * 6);
  }
  renderer.render(scene, camera);
}
refreshMenu();
requestAnimationFrame(loop);

// ---------- offline support ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
