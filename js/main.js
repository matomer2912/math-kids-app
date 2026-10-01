// main.js — level loading, host/guest game flow, networking glue (snapshots, interpolation,
// room-code joining, reconnect), progression, input, main loop
'use strict';

// ---------- level loading ----------
const vis = new Map();
function clearVisuals() { for (const k of [...vis.keys()]) removeVis(k); vis.clear(); }

function loadFloor(floor, seed, sx, sz) {
  G.floor = floor; G.seed = seed;
  G.map = G.role === 'guest' ? genDungeon(seed, floor) : Sim.S.map;
  G.theme = themeFor(floor);
  if (G.level) trashObj(G.level);
  G.level = buildLevel(G.map, G.theme);
  scene.add(G.level);
  // merchant stall (static scenery, deterministic from the seed so every device has it)
  G.merchant = G.map.merchant ? buildMerchantModel(G.theme, G.map.merchant) : null;
  if (G.merchant) G.level.add(G.merchant);
  shopFloorReset();
  scene.background = new THREE.Color(G.theme.voidc);
  scene.fog = new THREE.Fog(G.theme.voidc, 20, 40);
  hemi.color.setHex(G.theme.hemi); hemi.groundColor.setHex(G.theme.ground);
  clearVisuals(); clearFx();
  netFloorReset();
  gpuCollect();
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
  ['menu', 'lobby', 'wait', 'join'].forEach(id => $(id) && $(id).classList.add('hidden'));
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
  stopRejoin();
  try { Net.disconnect(); } catch (e) { }
  Sim.S.players.clear(); Sim.S.map = null;
  netG.clear(); hostPI.clear();
  clearVisuals(); clearFx();
  if (G.level) { trashObj(G.level); G.level = null; }
  gpuCollect();
  document.body.classList.remove('ingame');
  $('hud').classList.add('hidden'); $('pause').classList.add('hidden'); $('inv').classList.add('hidden');
  ['lobby', 'wait', 'join'].forEach(id => $(id) && $(id).classList.add('hidden'));
  $('menu').classList.remove('hidden');
  saveProfile();
  refreshMenu();
}

// =====================================================================
// Networking: snapshots + interpolation
//   Host -> guest: {t:'s', q:seq, tm:hostMs, fl, p, e, j, l, b, po, pn, k, x?:[despawned enemy ids], ev?}
//   at 20 Hz on the unreliable channel (see Sim.snapshot for the entity encoding). Important one-shot
//   events go reliably as {t:'ev', fl, ev}; overflow events as {t:'v', fl, ev} (unreliable).
//   Guest -> host: {t:'in', fl, x, z, f, mv, atk, an, pn, dn, ts:guestMs, ak:last snapshot seq, rs?}
//   Remote entities are rendered ~100-280 ms in the past (adaptive to jitter), lerping between the
//   two surrounding snapshots, extrapolating at most 200 ms when the buffer runs dry.
// =====================================================================
const NET_HZ = 20, SEND_MS = 1000 / NET_HZ;
const SNAP_BUDGET = 1100;           // bytes: one SCTP/DTLS packet (fragments of unreliable msgs get lost)
const INTERP_MIN = 100, INTERP_MAX = 320, EXTRAP_MAX = 200;
const EV_IMPORTANT = new Set(['die', 'msg', 'bossdead', 'down', 'revived', 'phoenix', 'buff']);
const EV_POS = new Set(['dmg', 'boom', 'ring', 'tele', 'teleline', 'zap', 'die', 'dashfx', 'lanes', 'shock', 'bolt', 'cloud', 'spikeline', 'block']); // a[1], a[2] = x, z
const EV_OWN = new Set(['hurt', 'pick']);                                                     // a[1] = player id
const netStats = { sent: 0, sentBytes: 0, sentMax: 0, evOverflow: 0, trimmed: 0, recv: 0, recvBytes: 0, recvMax: 0, extrapT: 0, frames: 0, log: [] };

// Estimates the remote->local clock relation from timestamped packets and picks a render delay
// that covers the observed jitter.
class TimeSync {
  constructor() { this.reset(); }
  reset() { this.base = null; this.lastNow = 0; this.jit = []; this.delay = INTERP_MIN; this.target = INTERP_MIN; this.p90 = 0; }
  sample(tm, now) {
    const lat = now - tm; // one-way delay + clock offset
    if (this.base !== null && Math.abs(lat - this.base) > 5000) this.reset(); // remote clock restarted
    if (this.base === null) this.base = lat;
    else { this.base += (now - this.lastNow) * 0.004; if (lat < this.base) this.base = lat; } // creep up 4 ms/s
    this.lastNow = now;
    this.jit.push(lat - this.base); if (this.jit.length > 40) this.jit.shift();
    const s = this.jit.slice().sort((a, b) => a - b);
    this.p90 = s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
    this.target = Math.min(INTERP_MAX, Math.max(INTERP_MIN, SEND_MS + this.p90 + 20));
  }
  renderTime(now, dt) {
    this.delay += (this.target - this.delay) * Math.min(1, dt * 2);
    return now - this.base - this.delay;
  }
}

// Finds the samples around render time rt in a buffer sorted by .tm.
// -> {a, b, t} (lerp a->b by t) or {a, p, ext} (extrapolate from p->a by ext ms) or {a} (hold)
function bracket(buf, rt) {
  let i = buf.length - 1;
  while (i >= 0 && buf[i].tm > rt) i--;
  if (i < 0) return { a: buf[0], i: 0 };
  const a = buf[i], b = buf[i + 1];
  if (b) return { a, b, t: (rt - a.tm) / Math.max(1, b.tm - a.tm), i };
  return { a, p: buf[i - 1] || null, ext: Math.min(rt - a.tm, EXTRAP_MAX), i };
}
function lerpPos(o, a, b, t) { // writes x,z,f into o; snaps on teleports
  if (Math.abs(b.x - a.x) + Math.abs(b.z - a.z) > 10) { const s = t < 0.5 ? a : b; o.x = s.x; o.z = s.z; o.f = s.f; return; }
  o.x = a.x + (b.x - a.x) * t; o.z = a.z + (b.z - a.z) * t; o.f = lerpAngle(a.f, b.f, t);
}
function extrapPos(o, p, a, ext) {
  o.x = a.x; o.z = a.z; o.f = a.f;
  if (!p || ext <= 0 || a.tm === p.tm) return;
  const k = ext / (a.tm - p.tm), dx = (a.x - p.x) * k, dz = (a.z - p.z) * k;
  if (Math.abs(dx) + Math.abs(dz) < 6) { o.x += dx; o.z += dz; }
}

// ---------- host: per-guest state, remote player smoothing, sending ----------
const netG = new Map();   // guest id -> {ack, known, sig, inc, st}
function netGuest(id) {
  let g = netG.get(id);
  if (!g) { g = { ack: -1, known: new Map(), sig: new Map(), inc: [], st: [] }; netG.set(id, g); }
  return g;
}
const hostPI = new Map(); // guest id -> {sync, buf:[{tm,x,z,f}]} from input packets
const hostPV = new Map(); // guest id -> {x,z,f} smoothed display position (this frame)
let snapSeq = 0, netTick = 0, prevEnemyIds = new Set();
const goneList = [];      // [{id, q, t}] enemies that died/despawned (sent until acked)

function hostOnInput(from, m) {
  const g = netG.get(from);
  if (g && typeof m.ak === 'number' && m.ak > g.ack && m.ak <= snapSeq) g.ack = m.ak;
  if (g && m.rs) { g.known.clear(); g.sig.clear(); }
  if (m.fl === Sim.S.floor && typeof m.ts === 'number' && isFinite(m.x) && isFinite(m.z)) {
    let h = hostPI.get(from);
    if (!h) { h = { sync: new TimeSync(), buf: [] }; hostPI.set(from, h); }
    const last = h.buf[h.buf.length - 1];
    if (!last || m.ts > last.tm) {
      h.buf.push({ tm: m.ts, x: m.x, z: m.z, f: m.f || 0 });
      if (h.buf.length > 30) h.buf.shift();
      h.sync.sample(m.ts, performance.now());
    }
  }
  Sim.setInput(from, m);
}
function updateHostInterp(now, dt) {
  hostPV.clear();
  for (const [id, h] of hostPI) {
    const p = Sim.S.players.get(id);
    if (!p || !h.buf.length) continue;
    if (p.downed) { hostPV.set(id, { x: p.x, z: p.z, f: p.f }); continue; }
    const r = bracket(h.buf, h.sync.renderTime(now, dt)), o = {};
    if (r.b) lerpPos(o, r.a, r.b, r.t); else extrapPos(o, r.p, r.a, r.ext);
    hostPV.set(id, o);
  }
}

function evFor(a, id, sp) {
  if (EV_OWN.has(a[0])) return a[1] === id;
  if (sp && EV_POS.has(a[0]) && typeof a[1] === 'number' && typeof a[2] === 'number') {
    const dx = a[1] - sp.x, dz = a[2] - sp.z; return dx * dx + dz * dz < 34 * 34;
  }
  return true;
}
function commitSnap(g, seq) {
  for (const key of g.st) if (!g.known.has(key)) g.known.set(key, seq);
  if (g.known.size) { const inc = new Set(g.inc); for (const key of g.known.keys()) if (!inc.has(key)) g.known.delete(key); }
}
function sendEvChunks(id, list) {
  let chunk = [], len = 0, n = 0;
  for (const a of list) {
    const l = JSON.stringify(a).length + 1;
    if (len + l > 1000 && chunk.length) { if (n++ < 2) Net.send(id, { t: 'v', fl: G.floor, ev: chunk }, false); chunk = []; len = 0; }
    chunk.push(a); len += l;
  }
  if (chunk.length && n < 2) Net.send(id, { t: 'v', fl: G.floor, ev: chunk }, false);
  netStats.evOverflow++;
}
function hostSendSnaps(now) {
  const evs = Sim.S.events.splice(0);
  const cur = new Set();
  for (const e of Sim.S.enemies) if (e.hp > 0) cur.add(e.id);
  for (const id of prevEnemyIds) if (!cur.has(id)) goneList.push({ id, q: snapSeq + 1, t: now });
  prevEnemyIds = cur;
  while (goneList.length && now - goneList[0].t > 3000) goneList.shift();
  const ids = Net.peerIds();
  if (!ids.length) return;
  snapSeq++;
  const tm = Math.round(now);
  for (const id of ids) {
    const g = netGuest(id), sp = Sim.S.players.get(id);
    let maxE = 48, maxJ = 48, s, str;
    for (let tries = 0; ; tries++) {
      s = Sim.snapshot(id, g, maxE, maxJ, hostPV);
      s.q = snapSeq; s.tm = tm;
      const x = goneList.filter(d => d.q > g.ack).map(d => d.id);
      if (x.length) s.x = x.slice(-40);
      str = JSON.stringify(s);
      if (str.length <= SNAP_BUDGET || tries >= 6) break;
      // too big: keep the nearest entities (lists are sorted by distance)
      maxE = Math.floor(Math.min(maxE, s.e.length) * 0.75); maxJ = Math.floor(Math.min(maxJ, s.j.length) * 0.7);
      netStats.trimmed++;
    }
    commitSnap(g, snapSeq);
    const mine = evs.filter(a => evFor(a, id, sp));
    const imp = mine.filter(a => EV_IMPORTANT.has(a[0])), rest = mine.filter(a => !EV_IMPORTANT.has(a[0]));
    if (imp.length) Net.send(id, { t: 'ev', fl: G.floor, ev: imp }, true);
    if (rest.length) {
      const es = JSON.stringify(rest);
      if (str.length + es.length + 6 <= SNAP_BUDGET) str = str.slice(0, -1) + ',"ev":' + es + '}';
      else sendEvChunks(id, rest);
    }
    Net.sendRaw(id, str, false);
    netStats.sent++; netStats.sentBytes += str.length; netStats.sentMax = Math.max(netStats.sentMax, str.length);
  }
}

// Host (and solo) render straight from the sim state: no encode/decode per frame.
function hostView() {
  const S = Sim.S, V = { fl: S.floor, players: [], enemies: [], projs: [], loot: [], boss: 0, po: S.portalOpen ? 1 : 0, pn: S.portalNear || 0, pt: Sim.portalTenths(), k: 0 };
  for (const p of S.players.values()) {
    const pv = p.id === G.myId ? me : hostPV.get(p.id) || p;
    V.players.push({ id: p.id, x: pv.x, z: pv.z, f: pv.f, hp: Math.round(p.hp), maxHp: p.maxHp, downed: p.downed, atk: p.atkAnim > 0, w: p.wpn.w, r: p.wpn.r, color: p.color, lvl: p.lvl, name: p.name, rev: p.revive, aim: p.aim || p.f, skin: p.skin || '', bf: Sim.pflags(p) >> 7 });
  }
  for (const e of S.enemies) {
    if (e.hp <= 0) continue;
    if (!e.d.prop) V.k++;
    V.enemies.push({ id: e.id, sk: SKINS[e.sk], x: e.x, z: e.z, f: e.f, hp: Math.round(100 * e.hp / e.maxHp), fl: Sim.eflags(e), size: e.size });
  }
  for (const j of S.projs) V.projs.push({ id: j.id, k: j.k, x: j.x, z: j.z, vx: j.vx, vz: j.vz, col: j.col || 0 });
  for (const l of S.loot) if (l.owner === -1 || l.owner === G.myId) V.loot.push({ id: l.id, kind: l.kind, x: l.x, z: l.z, r: l.item ? l.item.r : 0, w: l.item ? l.item.w : '' });
  if (S.boss) V.boss = [S.boss.name, Math.round(1000 * S.boss.hp / S.boss.maxHp)];
  return V;
}

// ---------- guest: snapshot buffer + interpolated view ----------
const snapBuf = [];               // decoded snapshots, sorted by host time
const snapSync = new TimeSync();
const statCache = new Map();      // static entity data received so far this floor ('p1', 'e12', 'j7', 'l9')
const goneE = new Set();          // enemy ids explicitly despawned this floor
let lastSnapQ = -1, needResync = false, cacheSweepT = 0;

function decodeSnap(m) {
  const Q = Sim.QP, A = Sim.QA, V = Sim.QV;
  const s = { q: m.q, tm: m.tm, fl: m.fl, b: m.b, po: m.po, pn: m.pn, pt: m.pt || 0, k: m.k, P: new Map(), E: new Map(), J: new Map(), L: new Map() };
  for (const a of m.p || []) {
    const key = 'p' + a[0];
    if (a.length > 7) statCache.set(key, { maxHp: a[7], w: a[8], r: a[9], color: a[10], lvl: a[11], name: a[12], skin: a[13] || '' });
    const st = statCache.get(key); if (!st) { needResync = true; continue; }
    s.P.set(a[0], { id: a[0], x: a[1] / Q, z: a[2] / Q, f: a[3] / A, hp: a[4], maxHp: st.maxHp, downed: !!(a[5] & 1), atk: !!(a[5] & 2), rev: ((a[5] >> 2) & 31) / 10, bf: (a[5] >> 7) & 7, aim: a[6] / A, w: st.w, r: st.r, color: st.color, lvl: st.lvl, name: st.name, skin: st.skin });
  }
  for (const a of m.e || []) {
    const key = 'e' + a[0];
    if (a.length > 6) statCache.set(key, { sk: SKINS[a[6]], size: a[7] / 20 });
    const st = statCache.get(key); if (!st) { needResync = true; continue; }
    s.E.set(a[0], { id: a[0], sk: st.sk, x: a[1] / Q, z: a[2] / Q, f: a[3] / A, hp: a[4], fl: a[5], size: st.size });
  }
  for (const a of m.j || []) {
    const key = 'j' + a[0];
    if (a.length > 3) statCache.set(key, { k: PROJ_KINDS[a[3]], vx: a[4] / V, vz: a[5] / V, col: a[6] });
    const st = statCache.get(key); if (!st) { needResync = true; continue; }
    s.J.set(a[0], { id: a[0], k: st.k, x: a[1] / Q, z: a[2] / Q, vx: st.vx, vz: st.vz, col: st.col, f: 0 });
  }
  for (const a of m.l || []) {
    const key = 'l' + a[0];
    if (a.length > 3) statCache.set(key, { kind: a[3], r: a[4], w: a[5] });
    const st = statCache.get(key); if (!st) { needResync = true; continue; }
    s.L.set(a[0], { id: a[0], kind: st.kind, x: a[1] / Q, z: a[2] / Q, r: st.r, w: st.w, f: 0 });
  }
  return s;
}

function guestOnSnap(m) {
  if (typeof m.q !== 'number' || typeof m.tm !== 'number') return;
  for (const s of snapBuf) if (s.q === m.q) return;                 // duplicate
  if (snapBuf.length >= 3 && m.tm < snapBuf[0].tm) return;           // too old to matter
  const now = performance.now();
  const s = decodeSnap(m);
  snapSync.sample(m.tm, now);
  let i = snapBuf.length;
  while (i > 0 && snapBuf[i - 1].tm > s.tm) i--;                     // late packets slot in by time
  snapBuf.splice(i, 0, s);
  if (snapBuf.length > 40) snapBuf.shift();
  if (m.q > lastSnapQ) { lastSnapQ = m.q; G.snap = s; }
  if (m.x) for (const id of m.x) { if (!goneE.has(id)) { goneE.add(id); removeVis('e' + id); } }
  const len = JSON.stringify(m).length;
  netStats.recv++; netStats.recvBytes += len; netStats.recvMax = Math.max(netStats.recvMax, len);
}

function guestView(now, dt) {
  const latest = G.snap;
  if (!latest || !snapBuf.length) return null;
  const r = bracket(snapBuf, snapSync.renderTime(now, dt));
  if (r.i > 4) snapBuf.splice(0, r.i - 4);
  if (!r.b && r.ext > 0) netStats.extrapT += dt;
  const A = r.a, B = r.b;
  const V = { fl: latest.fl, players: [], enemies: [], projs: [], loot: [], boss: latest.b, po: latest.po, pn: latest.pn, pt: latest.pt, k: latest.k };
  const mix = (key, out, mode) => {
    for (const [id, a] of A[key]) {
      if (key === 'E' && goneE.has(id)) continue;
      if (key === 'P' && id === G.myId) continue;
      const b = B && B[key].get(id);
      const o = Object.assign({}, b && r.t > 0.5 ? b : a);
      if (b) lerpPos(o, a, b, r.t);
      else if (mode === 'vel' && r.ext > 0) { o.x = a.x + a.vx * r.ext / 1000; o.z = a.z + a.vz * r.ext / 1000; }
      else if (mode === 'pos' && r.p) { const pa = r.p[key].get(id); if (pa) extrapPos(o, Object.assign({ tm: r.p.tm }, pa), Object.assign({ tm: A.tm }, a), r.ext); }
      out.push(o);
    }
  };
  mix('P', V.players, 'pos');
  mix('E', V.enemies, 'pos');
  mix('J', V.projs, 'vel');
  mix('L', V.loot, 'hold');
  const mine = latest.P.get(G.myId);
  if (mine) V.players.push(Object.assign({}, mine, { x: me.x, z: me.z, f: me.f }));
  // forget static data of entities that are no longer in any buffered snapshot (host re-sends it)
  cacheSweepT -= dt;
  if (cacheSweepT <= 0 && snapBuf.length) {
    cacheSweepT = 5;
    const live = new Set();
    for (const s of snapBuf) for (const [c, M] of [['e', s.E], ['j', s.J], ['l', s.L]]) for (const id of M.keys()) live.add(c + id);
    for (const key of statCache.keys()) if (key[0] !== 'p' && !live.has(key)) statCache.delete(key);
  }
  return V;
}

function netFloorReset() {
  snapBuf.length = 0; statCache.clear(); goneE.clear(); G.snap = null; needResync = false;
  hostPI.clear(); hostPV.clear();
  for (const g of netG.values()) { g.known.clear(); g.sig.clear(); }
  goneList.length = 0; prevEnemyIds = new Set();
}

// ---------- networking glue ----------
Net.onMessage = (from, m) => {
  if (!m || !m.t) return;
  if (Social.onNet(from, m)) return; // gifts + dropped weapons (social.js)
  if (Net.isHost) {
    if (m.t === 'in') hostOnInput(from, m);
    else if (m.t === 'hello') {
      if (!m.st) return;
      if (!Sim.S.players.has(from)) Sim.addPlayer(from, m.st); else Sim.setStats(from, m.st);
      netGuest(from);
      refreshLobby();
      toast('👋 ' + esc(m.st.name || 'Player') + ' joined!');
      if (G.inGame) {
        const hp = Sim.S.players.get(0);
        const p = Sim.S.players.get(from);
        p.x = hp.x; p.z = hp.z; p.floor = G.floor; p.init = false;
        Net.send(from, { t: 'floor', f: G.floor, seed: G.seed, sx: hp.x, sz: hp.z, go: 1 });
      }
    } else if (m.t === 'stats') Sim.setStats(from, m.st);
    else if (m.t === 'buff') Sim.buff(from, m.k); // battle potion drunk on a guest's phone
  } else {
    if (m.t === 's') {
      if (m.fl !== G.floor || !G.inGame) return;
      guestOnSnap(m);
      if (m.ev) for (const a of m.ev) handleEvent(a);
    } else if (m.t === 'ev' || m.t === 'v') {
      if (m.fl === G.floor && G.inGame && m.ev) for (const a of m.ev) handleEvent(a);
    } else if (m.t === 'floor') {
      if (!G.inGame) startGame('guest');
      loadFloor(m.f, m.seed, m.sx, m.sz);
    } else if (m.t === 'grant') applyGrant(m.g);
    else if (m.t === 'msg') { showBanner(m.m); }
  }
};
Net.onPeerJoin = id => {
  refreshLobby();
  netG.delete(id); netGuest(id); // fresh per-guest state (a rejoining device starts from scratch)
  if (addPanelOpen) { addPanelOpen = false; Net.hidePanel(); }
};
Net.onPeerLeave = id => {
  if (Net.isHost || G.role === 'host') {
    const p = Sim.S.players.get(id);
    if (p) toast('👋 ' + esc(p.name) + ' left the game');
    Sim.removePlayer(id);
    netG.delete(id); hostPI.delete(id);
    refreshLobby();
  } else if (G.role === 'guest' && Net.roomCode) {
    startRejoin(Net.roomCode);
  } else {
    toast('📡 Lost connection to the host');
    showBanner('📡 Connection lost', 'Ask the host to tap ➕ and join again');
    setTimeout(() => { if (G.role === 'guest') quitToMenu(); }, 3500);
  }
};

// =====================================================================
// Joining: room code (online) + offline QR fallback + auto-rejoin
// =====================================================================
(function injectNetCss() {
  const st = document.createElement('style');
  st.textContent = [
    '.roomcode{font:900 64px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:10px;color:var(--gold,#fc3);text-shadow:0 3px 0 #8a4b10;margin:6px 0 8px;text-align:center}',
    '.roomqr{background:#fff;border-radius:10px;image-rendering:pixelated;display:block;margin:0 auto}',
    '#codeIn{font:900 44px ui-monospace,Menlo,Consolas,monospace;text-align:center;letter-spacing:12px;text-transform:uppercase;padding:8px 6px}',
    '#netBadge{position:fixed;right:calc(12px + env(safe-area-inset-right));top:68px;z-index:60;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.35);border-radius:10px;padding:3px 8px;font:700 12px system-ui,sans-serif;color:#fff;pointer-events:auto;touch-action:manipulation}',
    '#netInfo{position:fixed;right:calc(12px + env(safe-area-inset-right));top:94px;z-index:60;max-width:min(380px,80vw);background:rgba(10,10,20,.92);border:1px solid rgba(255,255,255,.3);border-radius:10px;padding:8px 10px;font:11px/1.35 ui-monospace,Menlo,monospace;color:#dfe;white-space:pre-wrap;pointer-events:none}',
    '#reconn{position:fixed;left:50%;top:34%;transform:translate(-50%,-50%);z-index:70;background:rgba(0,0,0,.72);padding:12px 18px;border-radius:14px;font-weight:900;font-size:20px;color:#fff;text-align:center;pointer-events:none}',
  ].join('');
  document.head.appendChild(st);
})();

function joinUrl(code) { return location.href.split('#')[0] + '#join=' + code; }
function drawQRCanvas(cv, text, size) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), dpr = window.devicePixelRatio || 1;
  const cell = Math.max(1, Math.floor(size * dpr / (n + 8)));
  cv.width = cv.height = cell * (n + 8);
  cv.style.width = cv.style.height = Math.round(cv.width / dpr) + 'px';
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + 4) * cell, (r + 4) * cell, cell, cell);
}
const ROOM_STATUS_TEXT = {
  open: '🟢 Online — kids can join with the code',
  connecting: '⏳ Opening the online lobby…',
  offline: '📵 No signal for codes right now (retrying). Use the QR button.',
};

// ---------- host lobby ----------
let roomQRFor = null;
function renderRoomInfo() {
  const code = Net.roomCode;
  if ($('roomCode')) $('roomCode').textContent = code || '····';
  if ($('roomStatus')) $('roomStatus').textContent = ROOM_STATUS_TEXT[Net.roomStatus()] || '';
  if (code && $('roomQR') && roomQRFor !== code) {
    roomQRFor = code;
    drawQRCanvas($('roomQR'), joinUrl(code), Math.max(110, Math.min(190, innerHeight * 0.4, innerWidth * 0.22)));
  }
}
Net.onRoomStatus = () => { renderRoomInfo(); if (addPanelOpen) showAddPlayerPanel(); };
function openLobby() {
  audioInit(); goFullscreen();
  Net.hostStart();
  G.role = 'host'; G.myId = 0;
  Sim.S.players.clear();
  Sim.addPlayer(0, myStats());
  $('menu').classList.add('hidden'); $('lobby').classList.remove('hidden');
  Net.hostOpenRoom();
  roomQRFor = null;
  renderRoomInfo();
  refreshLobby();
}
$('hostBtn').onclick = openLobby;

// in-game "➕": show the code + QR, with the offline QR flow as a fallback
let addPanelOpen = false;
function showAddPlayerPanel() {
  const code = Net.roomCode || Net.hostOpenRoom();
  addPanelOpen = true;
  Net.showPanel({
    title: 'Join code: ' + code,
    msg: 'On the other phone: Join Co-op → type ' + code + ' (or scan this with the camera).',
    hint: ROOM_STATUS_TEXT[Net.roomStatus()] || '',
    qr: joinUrl(code),
    buttons: [
      { label: '📷 No signal? QR pairing', fn: () => { addPanelOpen = false; Net.hostAddPlayer().then(id => toast('✅ Player ' + (id + 1) + ' connected!')).catch(() => { }); } },
      { label: 'Close', cls: 'net-go', fn: () => { addPanelOpen = false; Net.hidePanel(); } },
    ],
  });
}
$('addBtn').onclick = showAddPlayerPanel;

// ---------- guest join screen ----------
let joinBusy = false;
function setJoinStatus(t) { if ($('joinStatus')) $('joinStatus').textContent = t; }
function openJoin(prefill) {
  audioInit(); goFullscreen();
  ['menu', 'wait'].forEach(id => $(id).classList.add('hidden'));
  $('join').classList.remove('hidden');
  $('codeIn').value = prefill || '';
  setJoinStatus('');
}
const JOIN_ERR = {
  noroom: code => 'No game with code ' + code + '. Check the code on the host\'s screen.',
  full: () => 'That game is full (4 players max).',
  nosignal: () => 'No internet signal. Try again, or use the offline QR join.',
  badcode: () => 'Type the 4 letters from the host\'s screen.',
};
function joinByCode(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) { setJoinStatus(JOIN_ERR.badcode()); return; }
  if (joinBusy) return;
  joinBusy = true;
  try { $('codeIn').blur(); } catch (e) { }
  G.role = 'guest';
  setJoinStatus('⏳ Connecting to ' + code + '…');
  Net.joinRoom(code).then(id => {
    joinBusy = false;
    setJoinStatus('');
    onGuestConnected(id);
  }).catch(err => {
    joinBusy = false;
    if (!G.inGame && G.role === 'guest') G.role = null;
    const f = JOIN_ERR[err && err.message];
    setJoinStatus('❌ ' + (f ? f(code) : 'Couldn\'t connect. Try again — or everyone on Dad\'s hotspot.'));
  });
}
function onGuestConnected(id) {
  G.myId = id;
  // fresh snapshot state: the host may be a new session (seq, clock and entity ids restart)
  snapBuf.length = 0; statCache.clear(); goneE.clear(); lastSnapQ = -1; snapSync.reset(); G.snap = null;
  Net.send(0, { t: 'hello', st: myStats() });
  if (!G.inGame) {
    ['menu', 'join'].forEach(i => $(i).classList.add('hidden'));
    $('wait').classList.remove('hidden');
    if ($('waitMsg')) $('waitMsg').textContent = 'Waiting for the host to start the adventure…';
  }
}
$('joinBtn').onclick = () => openJoin('');
$('codeIn').addEventListener('input', e => {
  const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (e.target.value !== v) e.target.value = v;
  if (v.length === 4) joinByCode(v);
});
$('codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') joinByCode(e.target.value); });
$('codeGoBtn').onclick = () => joinByCode($('codeIn').value);
$('scanCodeBtn').onclick = () => {
  Net.scanCode().then(code => { $('codeIn').value = code; joinByCode(code); }).catch(() => { });
};
$('offlineJoinBtn').onclick = () => {
  G.role = 'guest';
  Net.joinGame().then(id => onGuestConnected(id)).catch(() => { if (!G.inGame) G.role = null; });
};
$('joinBack').onclick = () => { joinBusy = false; quitToMenu(); };
$('waitBack').onclick = () => quitToMenu();

// ---------- guest auto-rejoin ----------
const REJOIN_TRIES = 8;
let rejoin = null;
function showReconn(t) {
  if (!G.inGame) { if ($('waitMsg')) $('waitMsg').textContent = t; return; }
  let el = $('reconn');
  if (!el) { el = document.createElement('div'); el.id = 'reconn'; document.body.appendChild(el); }
  el.textContent = t; el.classList.remove('hidden');
}
function hideReconn() { const el = $('reconn'); if (el) el.classList.add('hidden'); }
function stopRejoin() { if (rejoin) { clearTimeout(rejoin.timer); rejoin = null; } hideReconn(); }
function startRejoin(code) {
  if (rejoin) return;
  rejoin = { code, n: 0, timer: null };
  showReconn('📡 Connection lost — reconnecting…');
  rejoin.timer = setTimeout(rejoinTry, 300);
}
function rejoinTry() {
  const r = rejoin;
  if (!r || G.role !== 'guest') { rejoin = null; return; }
  r.n++;
  showReconn('📡 Reconnecting… (try ' + r.n + ' of ' + REJOIN_TRIES + ')');
  Net.joinRoom(r.code).then(id => {
    if (rejoin !== r) return;
    rejoin = null; hideReconn();
    toast('✅ Reconnected!');
    onGuestConnected(id);
  }).catch(err => {
    if (rejoin !== r) return;
    if (r.n >= REJOIN_TRIES || (err && err.message === 'full')) {
      rejoin = null; hideReconn();
      showBanner('📡 Connection lost', 'Join again with the code ' + r.code);
      setTimeout(() => { if (G.role === 'guest' && !rejoin && Net.myId == null) quitToMenu(); }, 3500);
      return;
    }
    r.timer = setTimeout(rejoinTry, Math.min(1000 + 1500 * r.n, 6000));
  });
}

// ---------- deep link: game URL + #join=CODE (from the lobby QR) ----------
function checkJoinLink() {
  const code = Net.codeFromText(location.hash);
  if (!code || G.inGame || G.role === 'host') return;
  try { history.replaceState(null, '', location.href.split('#')[0]); } catch (e) { }
  openJoin(code);
  joinByCode(code);
}
addEventListener('hashchange', checkJoinLink);

// =====================================================================
// Connection quality badge (tap for details)
// =====================================================================
const netBadge = document.createElement('div'); netBadge.id = 'netBadge'; netBadge.className = 'hidden';
const netInfo = document.createElement('div'); netInfo.id = 'netInfo'; netInfo.className = 'hidden';
document.body.appendChild(netBadge); document.body.appendChild(netInfo);
netBadge.addEventListener('click', () => { netInfo.classList.toggle('hidden'); updateBadge(); }); // tap again to close
let badgeBusy = false, lastStatsT = performance.now(), lastStats = { sent: 0, sentBytes: 0, recv: 0, recvBytes: 0, extrapT: 0 };
function rttDot(s) { return !s || s.rtt == null ? '🔴' : s.rtt < 120 ? '🟢' : s.rtt < 250 ? '🟡' : '🔴'; }
function updateBadge() {
  const coop = G.inGame && (G.role === 'guest' || (G.role === 'host' && Net.peerIds().length > 0));
  netBadge.classList.toggle('hidden', !coop);
  if (!coop) { netInfo.classList.add('hidden'); return; }
  if (badgeBusy) return;
  if (G.role === 'guest' && (rejoin || Net.myId == null)) { netBadge.textContent = '🔴 reconnecting'; return; }
  badgeBusy = true;
  const ids = G.role === 'guest' ? [0] : Net.peerIds();
  Promise.all(ids.map(id => Net.getStats(id))).then(list => {
    badgeBusy = false;
    let worst = null;
    for (const s of list) if (!worst || !s || s.rtt == null || (worst.rtt != null && s.rtt > worst.rtt)) worst = s;
    netBadge.textContent = rttDot(worst) + ' ' + (worst && worst.rtt != null ? worst.rtt + 'ms' : '—') + (worst ? (worst.relay ? ' relay' : ' direct') : '');
    if (netInfo.classList.contains('hidden')) return;
    const now = performance.now(), sec = Math.max(0.5, (now - lastStatsT) / 1000), d = {};
    for (const k in lastStats) d[k] = netStats[k] - lastStats[k];
    for (const k in lastStats) lastStats[k] = netStats[k];
    lastStatsT = now;
    const lines = [];
    list.forEach((s, i) => {
      const id = ids[i], p = G.role === 'host' ? Sim.S.players.get(id) : null;
      const name = G.role === 'host' ? (p ? p.name : 'P' + (id + 1)) : 'Host';
      if (!s) { lines.push(name + ': no stats'); return; }
      lines.push(rttDot(s) + ' ' + name + ': ' + (s.rtt == null ? '?' : s.rtt + ' ms') + ' · ' + (s.relay ? 'RELAY (TURN)' : 'direct') + ' · via ' + s.via);
      lines.push('   ' + s.local + ' ↔ ' + s.remote + ' · ' + s.state);
    });
    if (G.role === 'host') {
      lines.push('snapshots: ' + (d.sent / sec).toFixed(1) + '/s · avg ' + Math.round(d.sentBytes / Math.max(1, d.sent)) + ' B · max ' + netStats.sentMax + ' B');
      lines.push('up: ' + (d.sentBytes / sec / 1024).toFixed(1) + ' kB/s total · trimmed ' + netStats.trimmed + ' · ev overflow ' + netStats.evOverflow);
    } else {
      lines.push('snapshots: ' + (d.recv / sec).toFixed(1) + '/s · avg ' + Math.round(d.recvBytes / Math.max(1, d.recv)) + ' B · max ' + netStats.recvMax + ' B');
      lines.push('delay ' + Math.round(snapSync.delay) + ' ms · jitter p90 ' + Math.round(snapSync.p90) + ' ms · extrapolating ' + Math.round(100 * d.extrapT / sec) + '%');
    }
    lines.push('frame ' + perfMon.avg.toFixed(1) + ' ms · pixel ratio ' + renderer.getPixelRatio().toFixed(2) + (lowPower ? ' · battery saver' : ''));
    netInfo.textContent = lines.join('\n');
  }, () => { badgeBusy = false; });
}
setInterval(updateBadge, 1500);

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
  me.dodgeCd = rollCooldown(Profile.boosts); me.dodgeT = 0.22;
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
    const isProp = isPropSkin(e.sk);
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
  const spd = 7.2 * (input.atk && W.kind !== 'melee' ? 0.7 : 1) * (myBuffLeft('swift') > 0 ? 1.3 : 1);
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
  const m = { t: 'in', fl: G.floor, x: Math.round(me.x * 100) / 100, z: Math.round(me.z * 100) / 100, f: Math.round(me.f * 100) / 100, mv: me.moving ? 1 : 0, atk: input.atk ? 1 : 0, an: me.an, pn: me.pn, dn: me.dn, ts: Math.round(performance.now()) };
  if (G.role === 'guest') { m.ak = lastSnapQ; if (needResync) { m.rs = 1; needResync = false; } }
  return m;
}

// ---------- performance: automatic quality step-down ----------
// If frames stay slow (> 24 ms average over 4 s), lower the pixel ratio (1.25 -> 1.0 -> 0.85).
const perfMon = { acc: 0, n: 0, t: 0, avg: 0, last: 0 };
function perfSample(now) {
  const d = now - perfMon.last; perfMon.last = now;
  if (!G.inGame || document.hidden || d <= 0 || d > 250) return;
  perfMon.acc += d; perfMon.n++; perfMon.t += d;
  if (perfMon.t < 4000) return;
  perfMon.avg = perfMon.acc / perfMon.n;
  if (!lowPower && perfMon.avg > 24 && prCap > 0.85) {
    prCap = prCap > 1 ? 1 : 0.85;
    applyPR(); resize();
  }
  perfMon.acc = perfMon.n = perfMon.t = 0;
}

// ---------- main loop ----------
let lastT = performance.now(), inT = 0, lastRender = 0, gcT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (lowPower && now - lastRender < 31) return;
  lastRender = now;
  perfSample(now);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  G.time += dt;
  if (G.inGame && G.map) {
    updateMe(dt);
    if (G.role !== 'guest') {
      Sim.setInput(G.myId, myInputMsg());
      if (!G.paused) Sim.update(dt);
      if (G.role === 'host') {
        updateHostInterp(now, dt);
        netTick -= dt;
        if (netTick <= 0) {
          netTick += 1 / NET_HZ; if (netTick < 0) netTick = 0;
          hostSendSnaps(now);
          flushGrants();
        }
      } else Sim.S.events.length = 0;
      G.view = hostView();
    } else {
      inT -= dt;
      if (inT <= 0) { inT += 1 / NET_HZ; if (inT < 0) inT = 0; Net.send(0, myInputMsg(), false); }
      G.view = guestView(now, dt) || G.view;
    }
    syncVisuals(dt);
    if (G.level) animateLevel(G.level, Date.now() / 1000);
    updateFx(dt);
    updateCamera(dt);
    updateHUD(dt);
    updateShop(dt);
    if (saveT > 0) { saveT -= dt; if (saveT <= 0) saveProfile(); }
  } else {
    // idle menu backdrop: slow orbit
    camera.position.set(Math.sin(G.time * 0.1) * 6, CAM_OFF.y, CAM_OFF.z + Math.cos(G.time * 0.1) * 6);
  }
  gcT -= dt;
  if (gcT <= 0 || gpuTrash.length > 300) { gcT = 1; gpuCollect(); }
  renderer.render(scene, camera);
}
refreshMenu();
requestAnimationFrame(loop);
checkJoinLink();

// ---------- offline support ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
