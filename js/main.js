// main.js — level loading, host/guest game flow, networking glue, progression, input, main loop
'use strict';

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

