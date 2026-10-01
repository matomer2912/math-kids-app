// models.js — blocky voxel models (players, enemies, bosses, loot, projectiles) + animation
'use strict';

const BOXG = new THREE.BoxGeometry(1, 1, 1);
const SPHG = new THREE.SphereGeometry(1, 8, 6);
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
const SHADOW_GEO = new THREE.CircleGeometry(1, 12);

function lam(color, emissive) { return new THREE.MeshLambertMaterial({ color, emissive: emissive || 0 }); }
function bx(parent, w, h, d, x, y, z, m) {
  const me = new THREE.Mesh(BOXG, m); me.scale.set(w, h, d); me.position.set(x, y, z); parent.add(me); return me;
}
function addShadow(root, r) {
  const s = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT); s.rotation.x = -Math.PI / 2; s.position.y = 0.02; s.scale.setScalar(r); root.add(s);
}

// ---------- weapons ----------
function buildWeaponMesh(w, rar) {
  const g = new THREE.Group();
  const glow = rar >= 2 ? RAR[rar].hex : 0;
  const metal = lam(rar === 3 ? 0xffd54f : 0xd5dde2, rar >= 2 ? glow : 0);
  if (rar >= 2) metal.emissiveIntensity = 0.45;
  const wood = lam(0x7a4e2a);
  const gold = lam(0xffc107);
  if (w === 'sword') {
    bx(g, 0.1, 0.25, 0.1, 0, 0.05, 0, wood);
    bx(g, 0.42, 0.08, 0.12, 0, 0.2, 0, gold);
    bx(g, 0.14, 1.0, 0.05, 0, 0.72, 0, metal);
  } else if (w === 'hammer') {
    bx(g, 0.1, 1.0, 0.1, 0, 0.4, 0, wood);
    bx(g, 0.55, 0.38, 0.38, 0, 0.95, 0, metal);
  } else if (w === 'daggers') {
    bx(g, 0.08, 0.18, 0.08, 0, 0.05, 0, wood);
    bx(g, 0.22, 0.06, 0.08, 0, 0.16, 0, gold);
    bx(g, 0.1, 0.5, 0.04, 0, 0.42, 0, metal);
  } else if (w === 'bow') {
    bx(g, 0.08, 0.5, 0.08, 0, 0.0, 0.18, wood);
    bx(g, 0.08, 0.45, 0.08, 0, 0.42, 0.08, wood);
    bx(g, 0.08, 0.45, 0.08, 0, -0.42, 0.08, wood);
    bx(g, 0.02, 1.2, 0.02, 0, 0, -0.04, lam(0xffffff, rar >= 1 ? RAR[rar].hex : 0));
  } else if (w === 'staff') {
    bx(g, 0.09, 1.5, 0.09, 0, 0.5, 0, wood);
    const gem = new THREE.Mesh(SPHG, new THREE.MeshBasicMaterial({ color: rar >= 1 ? RAR[rar].hex : 0x9c7cff }));
    gem.scale.setScalar(0.17); gem.position.y = 1.32; g.add(gem);
  }
  return g;
}

// ---------- humanoid ----------
function humanoid(o) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const mats = [];
  const m = (c, e) => { const mm = lam(c, e); mats.push(mm); return mm; };
  const skinM = m(o.skin), shirtM = m(o.shirt), pantsM = m(o.pants || o.shirt);
  const eyeM = new THREE.MeshBasicMaterial({ color: o.eye || 0x222222 });
  const bulk = o.bulk || 1;
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.17 * bulk, 0.75, 0); legR.position.set(0.17 * bulk, 0.75, 0);
  body.add(legL, legR);
  if (!o.robe) {
    bx(legL, 0.28 * bulk, 0.75, 0.3 * bulk, 0, -0.375, 0, pantsM);
    bx(legR, 0.28 * bulk, 0.75, 0.3 * bulk, 0, -0.375, 0, pantsM);
  } else {
    bx(body, 0.66 * bulk, 0.8, 0.44, 0, 0.4, 0, shirtM);
  }
  bx(body, 0.64 * bulk, 0.75, 0.38 * bulk, 0, 1.125, 0, shirtM);
  if (o.belt) bx(body, 0.66 * bulk, 0.1, 0.4 * bulk, 0, 0.8, 0, m(o.belt));
  const head = new THREE.Group(); head.position.set(0, 1.5, 0); body.add(head);
  bx(head, 0.5, 0.5, 0.5, 0, 0.25, 0, skinM);
  bx(head, 0.1, 0.08, 0.02, -0.12, 0.28, 0.26, eyeM);
  bx(head, 0.1, 0.08, 0.02, 0.12, 0.28, 0.26, eyeM);
  if (o.hair) bx(head, 0.54, 0.14, 0.54, 0, 0.52, -0.02, m(o.hair));
  if (o.hood) { bx(head, 0.58, 0.58, 0.2, 0, 0.27, -0.2, m(o.hood)); bx(head, 0.58, 0.14, 0.58, 0, 0.55, 0, m(o.hood)); }
  if (o.stripes) { const sm = m(o.stripes); bx(head, 0.52, 0.06, 0.52, 0, 0.12, 0, sm); bx(body, 0.66 * bulk, 0.06, 0.4 * bulk, 0, 1.3, 0, sm); bx(body, 0.66 * bulk, 0.06, 0.4 * bulk, 0, 0.95, 0, sm); }
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.44 * bulk, 1.45, 0); armR.position.set(0.44 * bulk, 1.45, 0);
  body.add(armL, armR);
  const armM = o.sleeve ? m(o.sleeve) : skinM;
  bx(armL, 0.22 * bulk, 0.7, 0.26 * bulk, 0, -0.3, 0, armM);
  bx(armR, 0.22 * bulk, 0.7, 0.26 * bulk, 0, -0.3, 0, armM);
  const hand = new THREE.Group(); hand.position.set(0, -0.62, 0.05); armR.add(hand);
  const handL = new THREE.Group(); handL.position.set(0, -0.62, 0.05); armL.add(handL);
  addShadow(root, 0.55 * bulk);
  return { root, body, legL, legR, armL, armR, head, hand, handL, mats, kind: 'h', walk: 0, scale: 1 };
}

function setWeapon(model, w, rar) {
  if (model.wkey === w + rar) return;
  model.wkey = w + rar;
  if (model.wmesh) { model.hand.remove(model.wmesh); model.wmesh = null; }
  if (model.wmesh2) { model.handL.remove(model.wmesh2); model.wmesh2 = null; }
  if (!w) return;
  const wm = buildWeaponMesh(w, rar);
  if (w === 'bow') { wm.rotation.set(0, Math.PI / 2, 0); wm.position.z = 0.1; }
  else wm.rotation.x = w === 'staff' ? 0.15 : 1.25;
  model.hand.add(wm); model.wmesh = wm;
  if (w === 'daggers') {
    const w2 = buildWeaponMesh(w, rar); w2.rotation.x = 1.25; model.handL.add(w2); model.wmesh2 = w2;
  }
  model.wtype = w;
}

function buildPlayerModel(colorHex) {
  const c = new THREE.Color(colorHex).getHex();
  const mdl = humanoid({ skin: 0xf1c27d, shirt: c, pants: 0x3a3f58, hair: 0x5a3a1a, belt: 0x5a3a1a, sleeve: c });
  // hero cape
  const cape = bx(mdl.body, 0.6, 0.9, 0.06, 0, 1.0, -0.24, lam(new THREE.Color(colorHex).multiplyScalar(0.6).getHex()));
  cape.rotation.x = 0.12;
  // colored ring under player for easy identification
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 20), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; mdl.root.add(ring);
  mdl.ring = ring;
  return mdl;
}

// ---------- enemies ----------
// a blank model shell for non-humanoid builds
function shell(kind, shadowR) {
  const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
  if (shadowR) addShadow(root, shadowR);
  return { root, body, mats: [], kind, walk: 0 };
}
// tracked material (so hit-flash and burn/slow tints affect it)
function tm(mdl, color, emissive) { const m = lam(color, emissive); mdl.mats.push(m); return m; }
const glowM = c => new THREE.MeshBasicMaterial({ color: c });

function buildBossModel(T) {
  const B = T.boss, kind = B.kind || 'pharaoh';
  let mdl;
  if (kind === 'spider') { // Spider Queen: huge abdomen, crown, 8 legs
    mdl = shell('q', 1.0);
    const b = tm(mdl, B.body), acc = tm(mdl, B.accent);
    bx(mdl.body, 1.3, 1.0, 1.5, 0, 0.8, -0.85, b);
    bx(mdl.body, 0.5, 0.5, 0.06, 0, 0.95, -1.61, acc); // hourglass mark
    bx(mdl.body, 0.9, 0.7, 0.9, 0, 0.75, 0.3, b);
    bx(mdl.body, 0.6, 0.55, 0.5, 0, 0.85, 0.9, b);
    const eye = glowM(B.eye);
    for (const [ex, ey] of [[-0.15, 0.95], [0.15, 0.95], [-0.08, 1.05], [0.08, 1.05], [-0.22, 0.85], [0.22, 0.85]]) bx(mdl.body, 0.08, 0.08, 0.03, ex, ey, 1.16, eye);
    bx(mdl.body, 0.1, 0.25, 0.1, -0.12, 0.6, 1.15, acc); bx(mdl.body, 0.1, 0.25, 0.1, 0.12, 0.6, 1.15, acc); // fangs
    const gold = tm(mdl, 0xffc72c);
    bx(mdl.body, 0.55, 0.1, 0.45, 0, 1.15, 0.9, gold);
    for (const cx of [-0.2, 0, 0.2]) bx(mdl.body, 0.08, 0.2, 0.08, cx, 1.28, 0.95, gold);
    mdl.legs = [];
    for (let s = -1; s <= 1; s += 2) for (let n = 0; n < 4; n++) {
      const lg = new THREE.Group(); lg.position.set(0.4 * s, 0.85, 0.55 - n * 0.32); mdl.body.add(lg);
      const a = bx(lg, 0.8, 0.1, 0.1, 0.4 * s, 0.15, 0, b); a.rotation.z = 0.5 * s;
      const c = bx(lg, 0.1, 0.9, 0.1, 0.8 * s, -0.25, 0, b); c.rotation.z = -0.25 * s;
      mdl.legs.push(lg);
    }
  } else if (kind === 'dragon') { // Storm Dragon: long neck, wings, tail
    mdl = shell('dragon', 1.1);
    const b = tm(mdl, B.body), belly = tm(mdl, 0xbfd4ff), acc = tm(mdl, B.accent);
    bx(mdl.body, 1.0, 0.8, 1.6, 0, 0.95, 0, b);
    bx(mdl.body, 0.8, 0.3, 1.4, 0, 0.6, 0, belly);
    const neck = new THREE.Group(); neck.position.set(0, 1.2, 0.7); mdl.body.add(neck);
    const n1 = bx(neck, 0.4, 0.4, 0.9, 0, 0.3, 0.3, b); n1.rotation.x = -0.7;
    const head = new THREE.Group(); head.position.set(0, 0.75, 0.65); neck.add(head);
    bx(head, 0.55, 0.45, 0.7, 0, 0, 0.1, b); bx(head, 0.45, 0.2, 0.45, 0, -0.1, 0.55, b);
    bx(head, 0.1, 0.08, 0.03, -0.18, 0.08, 0.45, glowM(B.eye)); bx(head, 0.1, 0.08, 0.03, 0.18, 0.08, 0.45, glowM(B.eye));
    const h1 = bx(head, 0.08, 0.4, 0.08, -0.18, 0.35, -0.15, acc); h1.rotation.x = -0.6;
    const h2 = bx(head, 0.08, 0.4, 0.08, 0.18, 0.35, -0.15, acc); h2.rotation.x = -0.6;
    mdl.head = head;
    mdl.wings = [];
    for (let s = -1; s <= 1; s += 2) {
      const wg = new THREE.Group(); wg.position.set(0.45 * s, 1.3, 0.1); mdl.body.add(wg);
      bx(wg, 1.4, 0.06, 0.9, 0.7 * s, 0, 0, tm(mdl, shade(B.body, 0.75)));
      bx(wg, 1.5, 0.1, 0.1, 0.75 * s, 0.03, 0.45, acc);
      mdl.wings.push(wg);
    }
    mdl.tail = new THREE.Group(); mdl.tail.position.set(0, 0.9, -0.8); mdl.body.add(mdl.tail);
    bx(mdl.tail, 0.35, 0.3, 0.8, 0, 0, -0.4, b); bx(mdl.tail, 0.25, 0.2, 0.7, 0, -0.05, -1.1, b); bx(mdl.tail, 0.4, 0.06, 0.3, 0, -0.05, -1.5, acc);
    mdl.legs = [];
    for (const [lx, lz] of [[-0.4, 0.5], [0.4, 0.5], [-0.4, -0.5], [0.4, -0.5]]) { const lg = new THREE.Group(); lg.position.set(lx, 0.6, lz); mdl.body.add(lg); bx(lg, 0.28, 0.6, 0.3, 0, -0.3, 0, b); mdl.legs.push(lg); }
  } else {
    const bulk = kind === 'mushroom' ? 1.5 : 1.3;
    mdl = humanoid({ skin: B.skin, shirt: B.body, pants: shade(B.body, 0.7), eye: B.eye, bulk, sleeve: B.body, belt: B.accent });
    const acc = tm(mdl, B.accent), gold = tm(mdl, 0xffc72c);
    let weapon = 'club';
    if (kind === 'pharaoh') { // nemes headdress
      bx(mdl.head, 0.7, 0.3, 0.6, 0, 0.55, -0.05, gold); bx(mdl.head, 0.7, 0.6, 0.12, 0, 0.2, -0.3, acc);
      bx(mdl.head, 0.12, 0.5, 0.3, -0.33, 0.1, 0, acc); bx(mdl.head, 0.12, 0.5, 0.3, 0.33, 0.1, 0, acc);
      bx(mdl.head, 0.12, 0.3, 0.12, 0, -0.1, 0.27, gold);
      weapon = 'crook';
    } else if (kind === 'skelking') { // crown + cape
      bx(mdl.head, 0.56, 0.12, 0.56, 0, 0.55, 0, gold);
      for (const [cx, cz] of [[-0.22, 0.22], [0.22, 0.22], [-0.22, -0.22], [0.22, -0.22], [0, 0.22]]) bx(mdl.head, 0.1, 0.2, 0.1, cx, 0.7, cz, gold);
      const cape = bx(mdl.body, 0.9, 1.2, 0.06, 0, 0.9, -0.3, acc); cape.rotation.x = 0.15;
      weapon = 'sword';
    } else if (kind === 'titan') {
      const lava = glowM(0xff6a00);
      bx(mdl.body, 0.66 * bulk, 0.08, 0.4 * bulk, 0, 1.2, 0.01, lava); bx(mdl.body, 0.08, 0.6, 0.4 * bulk + 0.01, 0.15, 1.1, 0, lava);
      bx(mdl.head, 0.2, 0.3, 0.2, -0.2, 0.6, 0, lava); bx(mdl.head, 0.2, 0.3, 0.2, 0.2, 0.6, 0, lava);
      bx(mdl.armL, 0.3, 0.3, 0.32, 0, -0.1, 0, tm(mdl, 0x3a2a26)); bx(mdl.armR, 0.3, 0.3, 0.32, 0, -0.1, 0, tm(mdl, 0x3a2a26));
    } else if (kind === 'giant') {
      bx(mdl.head, 0.5, 0.3, 0.1, 0, 0.0, 0.27, tm(mdl, 0xffffff)); // beard
      bx(mdl.head, 0.56, 0.2, 0.56, 0, 0.58, 0, tm(mdl, 0xe8f8ff));
      for (const sx of [-0.45, 0.45]) bx(mdl.body, 0.3, 0.25, 0.4, sx * bulk, 1.55, 0, tm(mdl, 0xdff6ff)); // icy shoulders
      weapon = 'icicle';
    } else if (kind === 'mushroom') { // giant cap with spots
      const cap = tm(mdl, B.body), spot = tm(mdl, 0xffffff);
      bx(mdl.head, 1.5, 0.45, 1.5, 0, 0.62, 0, cap); bx(mdl.head, 1.1, 0.25, 1.1, 0, 0.95, 0, cap);
      for (const [sx, sz] of [[-0.45, 0.4], [0.4, 0.3], [0, -0.45], [0.5, -0.4], [-0.5, -0.2]]) bx(mdl.head, 0.25, 0.08, 0.25, sx, 0.88, sz, spot);
      bx(mdl.head, 0.3, 0.06, 0.3, 0.1, 1.09, 0.1, spot);
      for (const cx of [-0.2, 0, 0.2]) bx(mdl.head, 0.08, 0.2, 0.08, cx, 1.18, 0, gold);
      weapon = 'staff';
    } else if (kind === 'captain') { // tricorn hat, red coat, beard, anchor
      const hat = tm(mdl, 0x1a1a22);
      bx(mdl.head, 0.8, 0.12, 0.7, 0, 0.55, 0, hat); bx(mdl.head, 0.5, 0.3, 0.45, 0, 0.72, 0, hat);
      bx(mdl.head, 0.2, 0.15, 0.04, 0, 0.72, 0.23, tm(mdl, 0xffffff));
      bx(mdl.head, 0.45, 0.25, 0.1, 0, 0.0, 0.27, tm(mdl, 0x3a2a1a)); // beard
      bx(mdl.head, 0.14, 0.1, 0.03, -0.12, 0.28, 0.27, glowM(0x111111)); // eye patch
      bx(mdl.body, 0.7 * bulk, 0.6, 0.42 * bulk, 0, 0.55, 0, acc); // coat tails
      weapon = 'anchor';
    }
    const w = new THREE.Group();
    if (weapon === 'anchor') {
      bx(w, 0.14, 1.4, 0.14, 0, 0.6, 0, tm(mdl, 0x5a5a62)); bx(w, 0.9, 0.14, 0.14, 0, 0.0, 0, tm(mdl, 0x5a5a62));
      bx(w, 0.14, 0.35, 0.14, -0.42, 0.12, 0, tm(mdl, 0x5a5a62)); bx(w, 0.14, 0.35, 0.14, 0.42, 0.12, 0, tm(mdl, 0x5a5a62));
      bx(w, 0.4, 0.12, 0.12, 0, 1.25, 0, tm(mdl, 0x5a5a62));
    } else if (weapon === 'sword') { bx(w, 0.12, 0.3, 0.12, 0, 0.1, 0, gold); bx(w, 0.5, 0.1, 0.14, 0, 0.3, 0, gold); bx(w, 0.18, 1.5, 0.06, 0, 1.05, 0, tm(mdl, 0xb0b8c8)); }
    else if (weapon === 'crook') { bx(w, 0.12, 1.4, 0.12, 0, 0.5, 0, gold); bx(w, 0.4, 0.12, 0.12, 0.15, 1.2, 0, acc); bx(w, 0.12, 0.3, 0.12, 0.32, 1.05, 0, acc); }
    else if (weapon === 'icicle') { bx(w, 0.18, 0.5, 0.18, 0, 0.2, 0, tm(mdl, 0x5a7a9a)); bx(w, 0.4, 1.3, 0.4, 0, 1.1, 0, glowM(0xbff6ff)); }
    else if (weapon === 'staff') { bx(w, 0.12, 1.6, 0.12, 0, 0.6, 0, tm(mdl, 0x6a4a2a)); bx(w, 0.35, 0.35, 0.35, 0, 1.45, 0, glowM(0x7dff4a)); }
    else { bx(w, 0.18, 1.2, 0.18, 0, 0.4, 0, tm(mdl, 0x5a3a1a)); bx(w, 0.45, 0.6, 0.45, 0, 1.1, 0, acc); }
    w.rotation.x = 1.0; mdl.hand.add(w);
  }
  return mdl;
}

function buildEnemyModel(skin, theme, size) {
  let mdl;
  const T = theme;
  const D = T.deco;
  switch (skin) {
    case 'mummy': mdl = humanoid({ skin: 0xe8dcc0, shirt: 0xd9cba8, pants: 0xcbbd98, eye: 0x39ff9a, stripes: 0xb8a782 }); break;
    case 'skeleton': mdl = humanoid({ skin: T.bone, shirt: T.bone, pants: 0x8e8e86, eye: 0x111111, bulk: 0.75 }); setWeapon(mdl, 'sword', 0); break;
    case 'zombie': mdl = humanoid({ skin: D === 'ice' ? 0x9fd6e8 : (D === 'lava' ? 0x5a4a40 : 0x6aa84f), shirt: D === 'ice' ? 0x4a6d8c : 0x2e7d8c, pants: 0x3b3b6d, eye: D === 'lava' ? 0xffa000 : 0x111111 }); break;
    case 'skelArcher': mdl = humanoid({ skin: T.bone, shirt: T.bone, pants: 0x7a6a50, eye: 0xff3030, bulk: 0.75, hood: T.accent }); setWeapon(mdl, 'bow', 0); break;
    case 'imp': mdl = humanoid({ skin: 0xd8381e, shirt: 0xa82410, pants: 0x5a1a10, eye: 0xffe000, bulk: 0.8 }); break;
    case 'golem': mdl = humanoid({ skin: T.golem, shirt: T.golem, pants: new THREE.Color(T.golem).multiplyScalar(0.8).getHex(), eye: D === 'lava' ? 0xff6a00 : 0x6ff7ff, bulk: 1.35 });
      if (D === 'jungle') bx(mdl.head, 0.56, 0.12, 0.56, 0, 0.52, 0, tm(mdl, 0x3f8a2a));
      if (D === 'mushroom') { bx(mdl.head, 0.9, 0.25, 0.9, 0, 0.6, 0, tm(mdl, 0xd05aff)); }
      if (D === 'pirate') { bx(mdl.body, 0.3, 0.3, 0.1, 0.2, 1.3, 0.2, tm(mdl, 0xff8a7a)); bx(mdl.head, 0.2, 0.3, 0.2, -0.15, 0.6, 0, tm(mdl, 0xff8a7a)); }
      break;
    case 'priest': mdl = humanoid({ skin: 0x9a6b3a, shirt: 0xf3e2a0, robe: true, eye: 0x3dffd0, hood: 0xe0b44a, sleeve: 0xf3e2a0 }); setWeapon(mdl, 'staff', 2); break;
    case 'necro': mdl = humanoid({ skin: 0xc8c8b8, shirt: T.accent, robe: true, eye: 0xff3030, hood: new THREE.Color(T.accent).multiplyScalar(0.5).getHex(), sleeve: T.accent }); setWeapon(mdl, 'staff', 2); break;
    case 'lizard': // jungle lizardman with snout, tail and spear
      mdl = humanoid({ skin: 0x5aa83a, shirt: 0x8a6a3a, pants: 0x4a8a2a, eye: 0xffe14a, belt: 0xd0a040 });
      bx(mdl.head, 0.36, 0.22, 0.3, 0, 0.18, 0.36, tm(mdl, 0x5aa83a));
      bx(mdl.head, 0.1, 0.2, 0.3, 0, 0.55, -0.05, tm(mdl, 0xff7a2a));
      { const tail = bx(mdl.body, 0.2, 0.2, 0.8, 0, 0.8, -0.5, tm(mdl, 0x5aa83a)); tail.rotation.x = 0.5; }
      { const sp = new THREE.Group(); bx(sp, 0.07, 1.6, 0.07, 0, 0.3, 0, tm(mdl, 0x6a4a2a)); bx(sp, 0.14, 0.3, 0.06, 0, 1.2, 0, tm(mdl, 0xd0d0d0)); sp.rotation.x = 1.3; mdl.hand.add(sp); }
      break;
    case 'knight': // sky castle armored knight with plume
      mdl = humanoid({ skin: 0xc8d0dc, shirt: 0xb8c0cc, pants: 0x8a92a0, eye: 0x111111, sleeve: 0xb8c0cc, belt: 0xffc72c });
      bx(mdl.head, 0.56, 0.56, 0.56, 0, 0.27, 0, tm(mdl, 0xc8d0dc)); bx(mdl.head, 0.4, 0.06, 0.03, 0, 0.3, 0.29, glowM(0x111111));
      bx(mdl.head, 0.1, 0.3, 0.45, 0, 0.65, -0.05, tm(mdl, T.accent));
      bx(mdl.body, 0.68, 0.3, 0.42, 0, 1.4, 0, tm(mdl, T.accent));
      setWeapon(mdl, 'sword', 0);
      break;
    case 'shroom': // little mushroom-man with a big cap
      mdl = humanoid({ skin: 0xf0e0c0, shirt: 0xe8d8b8, pants: 0xc8b898, eye: 0x111111, bulk: 0.85 });
      bx(mdl.head, 0.95, 0.35, 0.95, 0, 0.6, 0, tm(mdl, T.cube)); bx(mdl.head, 0.65, 0.2, 0.65, 0, 0.85, 0, tm(mdl, T.cube));
      for (const [sx, sz] of [[-0.25, 0.3], [0.3, 0.2], [0, -0.3]]) bx(mdl.head, 0.16, 0.06, 0.16, sx, 0.79, sz, glowM(0xffffff));
      break;
    case 'pirate': // skeleton pirate with bandana and cutlass
      mdl = humanoid({ skin: T.bone, shirt: 0xc0302a, pants: 0x2a2a3a, eye: 0x3dffd0, bulk: 0.8, belt: 0x1a1a1a });
      bx(mdl.head, 0.54, 0.16, 0.54, 0, 0.47, 0, tm(mdl, 0xc0302a)); bx(mdl.head, 0.12, 0.12, 0.2, 0.2, 0.42, -0.3, tm(mdl, 0xc0302a));
      bx(mdl.body, 0.68, 0.06, 0.42, 0, 1.1, 0, tm(mdl, 0xffffff));
      setWeapon(mdl, 'sword', 0);
      break;
    case 'guard': { // shield-bearer: big tower shield in front
      const C = T.guard || [0x777777, 0xffc72c];
      mdl = humanoid({ skin: D === 'desert' ? 0x1a1a1a : C[0], shirt: C[0], pants: shade(C[0], 0.75), eye: D === 'desert' ? 0xffc72c : 0xff3030, bulk: 1.1, sleeve: C[0], belt: C[1] });
      if (D === 'desert') { // jackal head
        bx(mdl.head, 0.28, 0.24, 0.35, 0, 0.18, 0.38, tm(mdl, 0x1a1a1a));
        bx(mdl.head, 0.12, 0.35, 0.1, -0.16, 0.65, 0, tm(mdl, 0x1a1a1a)); bx(mdl.head, 0.12, 0.35, 0.1, 0.16, 0.65, 0, tm(mdl, 0x1a1a1a));
        bx(mdl.body, 0.7, 0.12, 0.44, 0, 1.45, 0, tm(mdl, C[1]));
      } else { bx(mdl.head, 0.58, 0.3, 0.58, 0, 0.5, 0, tm(mdl, shade(C[0], 0.9))); bx(mdl.head, 0.1, 0.25, 0.4, 0, 0.75, 0, tm(mdl, C[1])); }
      const sh = new THREE.Group(); sh.position.set(-0.05, 1.05, 0.45); mdl.body.add(sh);
      bx(sh, 0.95, 1.25, 0.12, 0, 0, 0, tm(mdl, C[1])); bx(sh, 0.8, 1.1, 0.13, 0, 0, 0.01, tm(mdl, shade(C[0], 1.15)));
      bx(sh, 0.3, 0.3, 0.14, 0, 0.05, 0.02, tm(mdl, C[1]));
      mdl.shield = sh;
      { const sp = new THREE.Group(); bx(sp, 0.07, 1.5, 0.07, 0, 0.3, 0, tm(mdl, 0x6a4a2a)); bx(sp, 0.14, 0.32, 0.06, 0, 1.1, 0, tm(mdl, 0xd0d0d0)); sp.rotation.x = 1.3; mdl.hand.add(sp); }
      break;
    }
    case 'bomber': { // bomb thrower with a satchel and a lit bomb
      const sh = D === 'crypt' ? 0x5a6a5a : D === 'ice' ? 0xe8f0ff : D === 'pirate' ? 0x2a4a8a : D === 'lava' ? 0x8a2a1a : 0x9a6a3a;
      mdl = humanoid({ skin: D === 'crypt' ? 0x9ab08a : D === 'lava' ? 0xd8381e : 0xe0b080, shirt: sh, pants: 0x3a3a3a, eye: 0x111111, bulk: 0.85, belt: 0x5a3a1a });
      bx(mdl.head, 0.56, 0.12, 0.2, 0, 0.3, 0.2, tm(mdl, 0x3a2a1a)); // goggles strap
      bx(mdl.head, 0.14, 0.12, 0.04, -0.12, 0.3, 0.3, glowM(0x7ad0ff)); bx(mdl.head, 0.14, 0.12, 0.04, 0.12, 0.3, 0.3, glowM(0x7ad0ff));
      bx(mdl.body, 0.4, 0.4, 0.25, 0.25, 0.9, -0.3, tm(mdl, 0x6a4a2a));
      const bomb = new THREE.Group(); bomb.position.set(0, -0.15, 0.1); mdl.hand.add(bomb);
      bx(bomb, 0.38, 0.38, 0.38, 0, 0, 0, tm(mdl, 0x222222)); bx(bomb, 0.06, 0.18, 0.06, 0, 0.26, 0, tm(mdl, 0x8a6a3a)); bx(bomb, 0.1, 0.1, 0.1, 0, 0.38, 0, glowM(0xffd23a));
      break;
    }
    case 'mage': { // teleporting wizard with a pointy hat
      const C = T.mage || [0x2a4ac0, 0xffe14a];
      mdl = humanoid({ skin: 0xd8c8b0, shirt: C[0], robe: true, eye: C[1], sleeve: C[0] });
      bx(mdl.head, 0.75, 0.08, 0.75, 0, 0.52, 0, tm(mdl, C[0])); bx(mdl.head, 0.45, 0.35, 0.45, 0, 0.72, 0, tm(mdl, C[0])); bx(mdl.head, 0.22, 0.3, 0.22, 0.04, 1.0, -0.04, tm(mdl, C[0]));
      bx(mdl.head, 0.47, 0.08, 0.47, 0, 0.6, 0, tm(mdl, C[1]));
      bx(mdl.head, 0.4, 0.3, 0.1, 0, 0.0, 0.26, tm(mdl, 0xf0f0f0)); // beard
      setWeapon(mdl, 'staff', 3);
      break;
    }
    case 'scorpion': case 'spider': case 'crab': {
      const isSc = skin === 'scorpion', isCrab = skin === 'crab';
      mdl = shell('q', 0.7);
      const col = isSc ? 0xb5651d : isCrab ? 0xd8482a : (D === 'ice' ? 0xe8f4ff : D === 'jungle' ? 0x1f3a1a : D === 'mushroom' ? 0x5a2a7a : D === 'sky' ? 0x4a4a6a : 0x2b2b30);
      const mm = tm(mdl, col);
      bx(mdl.body, isCrab ? 1.1 : 0.8, isCrab ? 0.4 : 0.35, isCrab ? 0.8 : 1.0, 0, 0.4, 0, mm);
      if (!isCrab) bx(mdl.body, 0.5, 0.3, 0.4, 0, 0.42, 0.62, mm);
      const eye = glowM(isCrab ? 0x111111 : 0xff2020);
      bx(mdl.body, 0.1, isCrab ? 0.2 : 0.08, 0.04, -0.12, isCrab ? 0.7 : 0.5, isCrab ? 0.42 : 0.83, eye); bx(mdl.body, 0.1, isCrab ? 0.2 : 0.08, 0.04, 0.12, isCrab ? 0.7 : 0.5, isCrab ? 0.42 : 0.83, eye);
      if (D === 'jungle' && !isSc && !isCrab) bx(mdl.body, 0.5, 0.06, 0.6, 0, 0.58, -0.05, tm(mdl, 0xffd23a));
      mdl.legs = [];
      for (let s = -1; s <= 1; s += 2) for (let n = 0; n < (isSc || isCrab ? 3 : 4); n++) {
        const lg = new THREE.Group(); lg.position.set(0.4 * s, 0.4, 0.35 - n * 0.3); mdl.body.add(lg);
        const seg = bx(lg, 0.6, 0.08, 0.08, 0.3 * s, -0.15, 0, mm); seg.rotation.z = -0.6 * s;
        mdl.legs.push(lg);
      }
      if (isSc) {
        let y = 0.55, z = -0.55;
        for (let n = 0; n < 4; n++) { bx(mdl.body, 0.22, 0.22, 0.3, 0, y, z, mm); y += 0.22; z -= 0.12 - n * 0.08; }
        bx(mdl.body, 0.16, 0.16, 0.3, 0, y + 0.05, z + 0.25, lam(0x222222));
      }
      if (isSc || isCrab) { const cw = isCrab ? 0.38 : 0.25; bx(mdl.body, cw, 0.2, 0.35, -0.5, 0.45, 0.6, mm); bx(mdl.body, cw, 0.2, 0.35, 0.5, 0.45, 0.6, mm); }
      break;
    }
    case 'bat': { // flying runner
      mdl = shell('bat', 0.45);
      const col = D === 'sky' ? 0x5a5a7a : 0x3a2a3a;
      const mm = tm(mdl, col);
      bx(mdl.body, 0.45, 0.45, 0.45, 0, 1.3, 0, mm);
      bx(mdl.body, 0.12, 0.2, 0.08, -0.14, 1.6, 0, mm); bx(mdl.body, 0.12, 0.2, 0.08, 0.14, 1.6, 0, mm);
      bx(mdl.body, 0.09, 0.07, 0.03, -0.1, 1.36, 0.23, glowM(0xffe14a)); bx(mdl.body, 0.09, 0.07, 0.03, 0.1, 1.36, 0.23, glowM(0xffe14a));
      mdl.wings = [];
      for (let s = -1; s <= 1; s += 2) { const wg = new THREE.Group(); wg.position.set(0.2 * s, 1.35, 0); mdl.body.add(wg); bx(wg, 0.8, 0.05, 0.45, 0.4 * s, 0, 0, tm(mdl, shade(col, 0.8))); mdl.wings.push(wg); }
      break;
    }
    case 'slime': { // bouncy cube slime with a darker core
      mdl = shell('slime', 0.6);
      const col = T.slime || 0x6ad83a;
      const jelly = tm(mdl, col); jelly.transparent = true; jelly.opacity = 0.62;
      bx(mdl.body, 0.5, 0.45, 0.5, 0, 0.45, 0, tm(mdl, shade(col, 0.45))); // solid core seen through the jelly
      bx(mdl.body, 1.0, 0.95, 1.0, 0, 0.48, 0, jelly);
      const eye = glowM(0x111111), shine = glowM(0xffffff);
      bx(mdl.body, 0.2, 0.22, 0.04, -0.22, 0.7, 0.5, eye); bx(mdl.body, 0.2, 0.22, 0.04, 0.22, 0.7, 0.5, eye);
      bx(mdl.body, 0.07, 0.07, 0.05, -0.17, 0.76, 0.51, shine); bx(mdl.body, 0.07, 0.07, 0.05, 0.27, 0.76, 0.51, shine);
      bx(mdl.body, 0.36, 0.07, 0.04, 0, 0.45, 0.5, eye);
      bx(mdl.body, 0.25, 0.04, 0.25, 0.25, 0.96, -0.2, shine); // glossy highlight on top
      break;
    }
    case 'charger': { // armored beetle / boar with a big horn
      mdl = shell('c', 0.75);
      const col = T.charger || 0x6a4a2a, mm = tm(mdl, col), dark = tm(mdl, shade(col, 0.6));
      bx(mdl.body, 0.95, 0.65, 1.3, 0, 0.75, 0, mm);
      bx(mdl.body, 1.0, 0.1, 1.2, 0, 1.1, -0.05, dark);
      bx(mdl.body, 0.6, 0.5, 0.45, 0, 0.7, 0.8, dark);
      const horn = bx(mdl.body, 0.16, 0.6, 0.16, 0, 1.0, 1.05, tm(mdl, 0xf0e6c8)); horn.rotation.x = 0.6;
      bx(mdl.body, 0.1, 0.08, 0.03, -0.2, 0.8, 1.03, glowM(0xff3020)); bx(mdl.body, 0.1, 0.08, 0.03, 0.2, 0.8, 1.03, glowM(0xff3020));
      mdl.legs = [];
      for (const [lx, lz] of [[-0.38, 0.4], [0.38, 0.4], [-0.38, -0.4], [0.38, -0.4]]) { const lg = new THREE.Group(); lg.position.set(lx, 0.45, lz); mdl.body.add(lg); bx(lg, 0.22, 0.45, 0.22, 0, -0.22, 0, dark); mdl.legs.push(lg); }
      break;
    }
    case 'totem': { // spawner totem: stacked carved faces with glowing eyes
      mdl = shell('totem', 0.65);
      const col = T.totem || 0x9a6a3a;
      for (let n = 0; n < 3; n++) {
        const y = 0.4 + n * 0.75, c = shade(col, 1 - n * 0.12);
        bx(mdl.body, 0.9 - n * 0.08, 0.7, 0.9 - n * 0.08, 0, y, 0, tm(mdl, c));
        bx(mdl.body, 0.16, 0.12, 0.02, -0.18, y + 0.1, 0.46 - n * 0.04, glowM(T.accent)); bx(mdl.body, 0.16, 0.12, 0.02, 0.18, y + 0.1, 0.46 - n * 0.04, glowM(T.accent));
        bx(mdl.body, 0.4, 0.08, 0.02, 0, y - 0.15, 0.46 - n * 0.04, glowM(0x111111));
      }
      bx(mdl.body, 1.3, 0.12, 0.25, 0, 2.0, 0, tm(mdl, shade(col, 0.8)));
      const orb = bx(mdl.body, 0.35, 0.35, 0.35, 0, 2.6, 0, glowM(T.accent)); mdl.orb = orb;
      break;
    }
    case 'egg': { // spider egg sac that pulses before hatching
      mdl = shell('egg', 0.6);
      bx(mdl.body, 0.9, 0.9, 0.9, 0, 0.45, 0, tm(mdl, 0xf0e8e0)); bx(mdl.body, 0.7, 0.3, 0.7, 0, 0.95, 0, tm(mdl, 0xf0e8e0));
      bx(mdl.body, 0.92, 0.06, 0.1, 0, 0.5, 0.42, glowM(0xff4a8a)); bx(mdl.body, 0.1, 0.7, 0.92, 0.42, 0.5, 0, glowM(0xff4a8a));
      break;
    }
    case 'cube': {
      mdl = shell('c', 0.55);
      const mm = tm(mdl, T.cube);
      bx(mdl.body, 0.75, 1.1, 0.75, 0, 0.95, 0, mm);
      const dark = new THREE.MeshBasicMaterial({ color: 0x111111 });
      bx(mdl.body, 0.16, 0.16, 0.02, -0.16, 1.25, 0.38, dark); bx(mdl.body, 0.16, 0.16, 0.02, 0.16, 1.25, 0.38, dark);
      bx(mdl.body, 0.16, 0.26, 0.02, 0, 1.03, 0.38, dark);
      mdl.legs = [];
      for (const [lx, lz] of [[-0.2, 0.2], [0.2, 0.2], [-0.2, -0.2], [0.2, -0.2]]) {
        const lg = new THREE.Group(); lg.position.set(lx, 0.4, lz); mdl.body.add(lg); bx(lg, 0.3, 0.4, 0.3, 0, -0.2, 0, mm); mdl.legs.push(lg);
      }
      break;
    }
    case 'boss': mdl = buildBossModel(T); break;
    case 'chest': {
      mdl = shell('p', 0.8);
      const wood = tm(mdl, 0x8b5a2b), gold = lam(0xffc107);
      bx(mdl.body, 1.3, 0.7, 0.85, 0, 0.35, 0, wood);
      bx(mdl.body, 1.36, 0.3, 0.9, 0, 0.82, 0, lam(0xa0522d));
      bx(mdl.body, 0.2, 0.25, 0.05, 0, 0.6, 0.45, gold);
      bx(mdl.body, 1.38, 0.08, 0.92, 0, 0.7, 0, gold);
      break;
    }
    case 'pot': {
      mdl = shell('p', 0.4);
      const col = { desert: 0xc0703a, crypt: 0x7a6a5a, lava: 0x5a3a2a, ice: 0x8ab4d0, jungle: 0x9a5a3a, sky: 0x4a7ad0, mushroom: 0x8a4aa0, pirate: 0x7a8a6a }[D] || 0xc0703a;
      const mm = tm(mdl, col);
      bx(mdl.body, 0.55, 0.55, 0.55, 0, 0.3, 0, mm); bx(mdl.body, 0.35, 0.18, 0.35, 0, 0.66, 0, mm);
      bx(mdl.body, 0.57, 0.08, 0.57, 0, 0.4, 0, tm(mdl, D === 'sky' ? 0xffc72c : shade(col, 0.7)));
      break;
    }
    case 'crate': {
      mdl = shell('p', 0.55);
      const wood = tm(mdl, 0xa8743a), dark = tm(mdl, 0x6a4520);
      bx(mdl.body, 0.9, 0.9, 0.9, 0, 0.45, 0, wood);
      for (const y of [0.05, 0.85]) { bx(mdl.body, 0.94, 0.1, 0.94, 0, y, 0, dark); }
      bx(mdl.body, 0.94, 0.9, 0.1, 0, 0.45, 0, dark); bx(mdl.body, 0.1, 0.9, 0.94, 0, 0.45, 0, dark);
      break;
    }
    case 'barrel': case 'xbarrel': {
      const x = skin === 'xbarrel';
      mdl = shell('p', 0.5);
      const col = x ? 0xd0281e : 0x9a6a3a, mm = tm(mdl, col), band = tm(mdl, x ? 0xffd23a : 0x4a4a4a);
      bx(mdl.body, 0.7, 1.0, 0.7, 0, 0.5, 0, mm); bx(mdl.body, 0.8, 0.8, 0.8, 0, 0.5, 0, mm);
      bx(mdl.body, 0.84, 0.08, 0.84, 0, 0.25, 0, band); bx(mdl.body, 0.84, 0.08, 0.84, 0, 0.75, 0, band);
      if (x) { // skull mark + fuse
        bx(mdl.body, 0.3, 0.26, 0.04, 0, 0.5, 0.42, glowM(0xffffff)); bx(mdl.body, 0.07, 0.07, 0.02, -0.07, 0.53, 0.445, glowM(0x111111)); bx(mdl.body, 0.07, 0.07, 0.02, 0.07, 0.53, 0.445, glowM(0x111111));
        bx(mdl.body, 0.06, 0.3, 0.06, 0.15, 1.15, 0, lam(0x3a3a3a)); bx(mdl.body, 0.12, 0.12, 0.12, 0.15, 1.33, 0, glowM(0xffb000));
      }
      break;
    }
    default: mdl = humanoid({ skin: 0xff00ff, shirt: 0xff00ff });
  }
  mdl.root.scale.setScalar(size || 1);
  mdl.scale = size || 1;
  return mdl;
}

function flashModel(mdl, on) {
  for (const m of mdl.mats) {
    if (on) { if (m.userData.e === undefined) m.userData.e = m.emissive.getHex(); m.emissive.setHex(0xaaaaaa); }
    else if (m.userData.e !== undefined) m.emissive.setHex(m.userData.e);
  }
}

// a: attack phase 0..1 (1 = just started), moving speed, t time
function animateModel(mdl, dt, speed, atk, wind, t) {
  if (mdl.kind === 'h') {
    if (speed > 0.4) mdl.walk += dt * Math.min(14, 4 + speed * 1.6); else mdl.walk *= 0.85;
    const s = Math.sin(mdl.walk) * Math.min(1, speed / 3) * 0.8;
    mdl.legL.rotation.x = s; mdl.legR.rotation.x = -s;
    mdl.armL.rotation.x = -s * 0.8;
    let ar = s * 0.8;
    if (wind > 0) { ar = -2.6; mdl.armL.rotation.x = -2.6; }
    if (atk > 0) {
      if (mdl.wtype === 'bow' || mdl.wtype === 'staff') { ar = -1.5; mdl.armL.rotation.x = mdl.wtype === 'bow' ? -1.4 : mdl.armL.rotation.x; }
      else ar = atk > 0.55 ? -2.4 * (1 - atk) / 0.45 : -2.4 + 3.0 * (0.55 - atk) / 0.55;
      if (mdl.wtype === 'daggers') mdl.armL.rotation.x = atk < 0.5 ? -2.0 * atk * 2 : -2.0 * (1 - atk) * 2;
    }
    if (mdl.shield) mdl.armL.rotation.x = -1.2; // shield arm stays up
    mdl.armR.rotation.x = ar;
    mdl.body.position.y = Math.abs(Math.sin(mdl.walk)) * 0.06 * Math.min(1, speed / 3);
  } else if (mdl.kind === 'q' || mdl.kind === 'c') {
    if (speed > 0.4) mdl.walk += dt * 16; else mdl.walk *= 0.85;
    const s = Math.sin(mdl.walk) * 0.5;
    mdl.legs.forEach((l, i) => { if (mdl.kind === 'q') l.rotation.y = (i % 2 ? s : -s); else l.rotation.x = (i % 2 ? s : -s); });
    mdl.body.position.y = Math.abs(Math.sin(mdl.walk)) * 0.05;
    if (wind > 0 && mdl.kind === 'c') { mdl.body.scale.setScalar(1 + 0.12 * Math.abs(Math.sin(t * 20))); mdl.body.rotation.x = -0.15; }
    else { mdl.body.scale.setScalar(1); mdl.body.rotation.x = 0; }
  } else if (mdl.kind === 'slime') {
    if (speed > 0.4) mdl.walk += dt * 9; else mdl.walk += dt * 3;
    const h = Math.abs(Math.sin(mdl.walk));
    const sq = wind > 0 ? 0.7 + 0.1 * Math.sin(t * 30) : 1 - 0.18 * (1 - h);
    mdl.body.scale.set(1 + (1 - sq) * 0.6, sq, 1 + (1 - sq) * 0.6);
    mdl.body.position.y = speed > 0.4 ? h * 0.5 : 0;
  } else if (mdl.kind === 'bat') {
    mdl.walk += dt * 22;
    const f = Math.sin(mdl.walk) * 0.7;
    mdl.wings[0].rotation.z = f; mdl.wings[1].rotation.z = -f;
    mdl.body.position.y = 0.15 * Math.sin(t * 4 + mdl.walk * 0.05);
  } else if (mdl.kind === 'dragon') {
    if (speed > 0.4) mdl.walk += dt * 10; else mdl.walk *= 0.9;
    const f = Math.sin(t * (wind > 0 ? 9 : 3)) * (wind > 0 ? 0.6 : 0.3);
    mdl.wings[0].rotation.z = 0.3 + f; mdl.wings[1].rotation.z = -0.3 - f;
    mdl.tail.rotation.y = Math.sin(t * 2) * 0.4;
    const s = Math.sin(mdl.walk) * 0.5;
    mdl.legs.forEach((l, i) => l.rotation.x = (i % 2 ? s : -s));
    mdl.head.rotation.x = wind > 0 ? -0.4 : 0.1 * Math.sin(t * 1.5);
  } else if (mdl.kind === 'totem') {
    if (mdl.orb) { mdl.orb.rotation.y = t * 2; mdl.orb.position.y = 2.6 + 0.12 * Math.sin(t * 3); }
  } else if (mdl.kind === 'egg') {
    const s = 1 + 0.06 * Math.sin(t * 6);
    mdl.body.scale.set(s, 2 - s, s);
  }
}
// ---------- loot / projectiles ----------
function buildLootModel(kind, rar, w) {
  const g = new THREE.Group();
  const inner = new THREE.Group(); g.add(inner);
  if (kind === 'item') {
    const wm = buildWeaponMesh(w, rar); wm.rotation.z = 0.6; wm.position.y = 0.4; inner.add(wm);
    const beam = new THREE.Mesh(BOXG, new THREE.MeshBasicMaterial({ color: RAR[rar].hex, transparent: true, opacity: 0.35, depthWrite: false }));
    beam.scale.set(0.35, 7, 0.35); beam.position.y = 3.5; g.add(beam);
    const base = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 16), new THREE.MeshBasicMaterial({ color: RAR[rar].hex, side: THREE.DoubleSide }));
    base.rotation.x = -Math.PI / 2; base.position.y = 0.05; g.add(base);
  } else if (kind === 'coin') {
    bx(inner, 0.35, 0.35, 0.1, 0, 0.5, 0, new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x664400 }));
  } else if (kind === 'heart') {
    const m = new THREE.MeshLambertMaterial({ color: 0xff2a4a, emissive: 0x550010 });
    bx(inner, 0.25, 0.25, 0.2, -0.12, 0.62, 0, m); bx(inner, 0.25, 0.25, 0.2, 0.12, 0.62, 0, m); bx(inner, 0.3, 0.3, 0.2, 0, 0.45, 0, m);
  }
  g.userData.inner = inner;
  return g;
}

// the INDEX is sent over the network: only ever append
const PROJ_KINDS = ['arrow', 'orb', 'bone', 'eorb', 'fire', 'earrow', 'bomb', 'web', 'shard', 'spore', 'sand'];
function buildProjModel(k, color) {
  const g = new THREE.Group();
  if (k === 'bomb') { // lobbed bomb / cannonball (its landing spot is marked on the floor)
    bx(g, 0.5, 0.5, 0.5, 0, 0.6, 0, lam(0x222222)); bx(g, 0.08, 0.2, 0.08, 0, 0.95, 0, lam(0x8a6a3a)); bx(g, 0.14, 0.14, 0.14, 0, 1.1, 0, new THREE.MeshBasicMaterial({ color: 0xffb000 }));
    g.position.y = 1.0; return g;
  }
  if (k === 'web') { const m = new THREE.MeshBasicMaterial({ color: 0xf4f4ff }); bx(g, 0.7, 0.06, 0.06, 0, 0, 0, m); bx(g, 0.06, 0.06, 0.7, 0, 0, 0, m); const d = bx(g, 0.5, 0.06, 0.06, 0, 0, 0, m); d.rotation.y = 0.785; const d2 = bx(g, 0.5, 0.06, 0.06, 0, 0, 0, m); d2.rotation.y = -0.785; g.position.y = 1.0; return g; }
  if (k === 'shard') { bx(g, 0.18, 0.18, 0.8, 0, 0, 0, new THREE.MeshBasicMaterial({ color: 0xbff6ff })); bx(g, 0.1, 0.1, 0.3, 0, 0, 0.5, new THREE.MeshBasicMaterial({ color: 0xffffff })); g.position.y = 1.0; return g; }
  if (k === 'arrow' || k === 'earrow') {
    bx(g, 0.07, 0.07, 0.9, 0, 0, 0, new THREE.MeshBasicMaterial({ color: k === 'arrow' ? (color || 0xfff3c4) : 0xff5050 }));
    bx(g, 0.15, 0.15, 0.15, 0, 0, 0.45, new THREE.MeshBasicMaterial({ color: 0xcccccc }));
  } else if (k === 'bone') {
    bx(g, 0.18, 0.18, 0.6, 0, 0, 0, lam(0xf1e6c8, 0x444444));
  } else {
    const col = k === 'orb' ? (color || 0xb388ff) : k === 'fire' ? 0xff7a00 : k === 'spore' ? 0xc86aff : k === 'sand' ? 0xffc040 : 0x7dff4a;
    const s = new THREE.Mesh(SPHG, new THREE.MeshBasicMaterial({ color: col })); s.scale.setScalar(k === 'fire' ? 0.5 : 0.32); g.add(s);
    const halo = new THREE.Mesh(SPHG, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false })); halo.scale.setScalar(k === 'fire' ? 0.85 : 0.55); g.add(halo);
  }
  g.position.y = 1.0;
  return g;
}
