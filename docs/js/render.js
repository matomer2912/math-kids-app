// render.js — syncing 3D visuals with game state, effects, camera
'use strict';

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
// ---------- GPU resource cleanup ----------
// Models clone materials (and some geometries) per instance; fx create materials/geometries per event.
// Removed objects are queued here; gpuCollect() disposes every geometry/material/texture of them that
// is no longer used by anything in the scene and is not one of the shared module-level resources.
const gpuTrash = [];
function trashObj(obj) { if (obj) { if (obj.parent) obj.parent.remove(obj); gpuTrash.push(obj); } }
function sharedGpu() {
  const s = new Set();
  const add = (...a) => { for (const x of a) if (x) s.add(x); };
  add(typeof BOXG !== 'undefined' && BOXG, typeof SPHG !== 'undefined' && SPHG, typeof SHADOW_GEO !== 'undefined' && SHADOW_GEO,
    typeof SHADOW_MAT !== 'undefined' && SHADOW_MAT, PLANE, HPBAR_BG, HPBAR_FG, ringGeo, discGeo);
  for (const k in sectorCache) add(sectorCache[k]);
  for (const k in partMats) add(partMats[k]);
  return s;
}
function gpuResources(n, fn) {
  if (n.geometry) fn(n.geometry);
  if (!n.material) return;
  for (const m of (Array.isArray(n.material) ? n.material : [n.material])) {
    fn(m);
    for (const k in m) { const t = m[k]; if (t && t.isTexture) fn(t); }
  }
}
function gpuCollect() {
  if (!gpuTrash.length) return 0;
  const cand = new Set();
  for (const o of gpuTrash) o.traverse(n => { gpuResources(n, r => cand.add(r)); if (n.isInstancedMesh && n.dispose) n.dispose(); });
  gpuTrash.length = 0;
  scene.traverse(n => gpuResources(n, r => cand.delete(r))); // still in use somewhere
  const keep = sharedGpu();
  let n = 0;
  for (const r of cand) if (!keep.has(r) && !(r.userData && r.userData.shared) && r.dispose) { r.dispose(); n++; }
  return n;
}
function removeVis(key) {
  const o = vis.get(key); if (!o) return;
  trashObj(o.obj); if (o.bar) scene.remove(o.bar);
  vis.delete(key);
}

let visFrame = 0;
const VIS_GRACE = 0.5; // guest: keep a player/enemy visual this long when it is missing from the view
// Follow an interpolated target exactly during normal motion, but blend corrections (after an
// extrapolation guessed wrong) over ~100 ms instead of snapping; real teleports still snap.
function followPos(o, tx, tz, dt) {
  const dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz);
  if (d > 6 || d <= 12 * dt + 0.02) { o.x = tx; o.z = tz; return; }
  const k = Math.min(0.5, dt * 12);
  o.x += dx * k; o.z += dz * k;
}
function syncVisuals(dt) {
  const v = G.view; if (!v) return;
  visFrame++;
  const guest = G.role === 'guest';
  const T = G.time;
  // Positions in G.view are already smooth (host: sim state + interpolated remote players;
  // guest: interpolated snapshots), so visuals follow them directly.
  // players
  for (const p of v.players) {
    const key = 'p' + p.id;
    let o = vis.get(key);
    if (o && o.color !== p.color) { removeVis(key); o = null; }
    if (!o) {
      const model = buildPlayerModel(p.color);
      o = { obj: model.root, model, x: p.x, z: p.z, f: p.f, px: p.x, pz: p.z, color: p.color };
      scene.add(o.obj); vis.set(key, o);
    }
    o.seen = visFrame; o.seenT = T;
    const mine = p.id === G.myId;
    o.px = o.x; o.pz = o.z;
    if (mine) { o.x = me.x; o.z = me.z; } else followPos(o, p.x, p.z, dt);
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
      if (e.fl & 16) { // elite glow ring (geometry/material are freed by gpuCollect when removed)
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.05, 20), new THREE.MeshBasicMaterial({ color: 0xffb300, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; model.root.add(ring);
      }
      scene.add(o.obj); vis.set(key, o);
      if (e.sk !== 'boss' && e.sk !== 'chest' && e.sk !== 'pot') { o.bar = makeBar(); o.bar.visible = false; scene.add(o.bar); }
    }
    o.seen = visFrame; o.seenT = T;
    o.px = o.x; o.pz = o.z;
    if (guest) followPos(o, e.x, e.z, dt); else { o.x = e.x; o.z = e.z; }
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
      o = { obj: model, x: j.x, z: j.z };
      scene.add(o.obj); vis.set(key, o);
    }
    o.seen = visFrame; o.seenT = T;
    o.x = j.x; o.z = j.z;
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
    o.seen = visFrame; o.seenT = T;
    o.x = l.x; o.z = l.z;
    o.obj.position.set(o.x, 0, o.z);
    const inner = o.obj.userData.inner;
    inner.rotation.y += dt * 2.5;
    inner.position.y = 0.15 + Math.sin(T * 3 + l.id) * 0.12;
  }
  // Remove visuals that left the view. Host: immediately (the view is the sim itself).
  // Guest: projectiles/loot immediately (gone = hit/picked), players/enemies after a short grace
  // (out of interest range, trimmed from a big snapshot); explicit despawns use removeVis() directly.
  for (const [k, o] of vis) {
    if (o.seen === visFrame) continue;
    const c = k.charCodeAt(0); // 'p' players, 'e' enemies, 'j' projectiles, 'l' loot
    if (!guest || c === 106 || c === 108 || T - (o.seenT || 0) > VIS_GRACE) removeVis(k);
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
function clearFx() { for (const f of fxList) trashObj(f.obj); fxList.length = 0; $('fx').innerHTML = ''; }
function updateFx(dt) {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i]; f.t += dt;
    const k = f.t / f.life;
    if (k >= 1) { if (f.keep) scene.remove(f.obj); else trashObj(f.obj); fxList.splice(i, 1); continue; } // freed by gpuCollect
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

