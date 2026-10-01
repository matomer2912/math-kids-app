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
function buildEnemyModel(skin, theme, size) {
  let mdl;
  const T = theme;
  switch (skin) {
    case 'mummy': mdl = humanoid({ skin: 0xe8dcc0, shirt: 0xd9cba8, pants: 0xcbbd98, eye: 0x39ff9a, stripes: 0xb8a782 }); break;
    case 'skeleton': mdl = humanoid({ skin: T.bone, shirt: T.bone, pants: 0x8e8e86, eye: 0x111111, bulk: 0.75 }); setWeapon(mdl, 'sword', 0); break;
    case 'zombie': mdl = humanoid({ skin: T.deco === 'ice' ? 0x9fd6e8 : (T.deco === 'lava' ? 0x5a4a40 : 0x6aa84f), shirt: T.deco === 'ice' ? 0x4a6d8c : 0x2e7d8c, pants: 0x3b3b6d, eye: T.deco === 'lava' ? 0xffa000 : 0x111111 }); break;
    case 'skelArcher': mdl = humanoid({ skin: T.bone, shirt: T.bone, pants: 0x7a6a50, eye: 0xff3030, bulk: 0.75, hood: T.accent }); setWeapon(mdl, 'bow', 0); break;
    case 'imp': mdl = humanoid({ skin: 0xd8381e, shirt: 0xa82410, pants: 0x5a1a10, eye: 0xffe000, bulk: 0.8 }); break;
    case 'golem': mdl = humanoid({ skin: T.golem, shirt: T.golem, pants: new THREE.Color(T.golem).multiplyScalar(0.8).getHex(), eye: T.deco === 'lava' ? 0xff6a00 : 0x6ff7ff, bulk: 1.35 }); break;
    case 'priest': mdl = humanoid({ skin: 0x9a6b3a, shirt: 0xf3e2a0, robe: true, eye: 0x3dffd0, hood: 0xe0b44a, sleeve: 0xf3e2a0 }); setWeapon(mdl, 'staff', 2); break;
    case 'necro': mdl = humanoid({ skin: 0xc8c8b8, shirt: T.accent, robe: true, eye: 0xff3030, hood: new THREE.Color(T.accent).multiplyScalar(0.5).getHex(), sleeve: T.accent }); setWeapon(mdl, 'staff', 2); break;
    case 'scorpion': case 'spider': {
      const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
      const isSc = skin === 'scorpion';
      const col = isSc ? 0xb5651d : (T.deco === 'ice' ? 0xe8f4ff : 0x2b2b30);
      const mm = lam(col); const mats = [mm];
      bx(body, 0.8, 0.35, 1.0, 0, 0.4, 0, mm);
      bx(body, 0.5, 0.3, 0.4, 0, 0.42, 0.62, mm);
      const eye = new THREE.MeshBasicMaterial({ color: 0xff2020 });
      bx(body, 0.1, 0.08, 0.04, -0.12, 0.5, 0.83, eye); bx(body, 0.1, 0.08, 0.04, 0.12, 0.5, 0.83, eye);
      const legs = [];
      for (let s = -1; s <= 1; s += 2) for (let n = 0; n < (isSc ? 3 : 4); n++) {
        const lg = new THREE.Group(); lg.position.set(0.4 * s, 0.4, 0.35 - n * 0.3); body.add(lg);
        const seg = bx(lg, 0.6, 0.08, 0.08, 0.3 * s, -0.15, 0, mm); seg.rotation.z = -0.6 * s;
        legs.push(lg);
      }
      if (isSc) {
        let y = 0.55, z = -0.55;
        for (let n = 0; n < 4; n++) { bx(body, 0.22, 0.22, 0.3, 0, y, z, mm); y += 0.22; z -= 0.12 - n * 0.08; }
        bx(body, 0.16, 0.16, 0.3, 0, y + 0.05, z + 0.25, lam(0x222222));
        bx(body, 0.25, 0.15, 0.35, -0.45, 0.4, 0.85, mm); bx(body, 0.25, 0.15, 0.35, 0.45, 0.4, 0.85, mm);
      }
      addShadow(root, 0.7);
      mdl = { root, body, legs, mats, kind: 'q', walk: 0 };
      break;
    }
    case 'cube': {
      const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
      const mm = lam(T.cube); const mats = [mm];
      bx(body, 0.75, 1.1, 0.75, 0, 0.95, 0, mm);
      const dark = new THREE.MeshBasicMaterial({ color: 0x111111 });
      bx(body, 0.16, 0.16, 0.02, -0.16, 1.25, 0.38, dark); bx(body, 0.16, 0.16, 0.02, 0.16, 1.25, 0.38, dark);
      bx(body, 0.16, 0.26, 0.02, 0, 1.03, 0.38, dark);
      const legs = [];
      for (const [lx, lz] of [[-0.2, 0.2], [0.2, 0.2], [-0.2, -0.2], [0.2, -0.2]]) {
        const lg = new THREE.Group(); lg.position.set(lx, 0.4, lz); body.add(lg); bx(lg, 0.3, 0.4, 0.3, 0, -0.2, 0, mm); legs.push(lg);
      }
      addShadow(root, 0.55);
      mdl = { root, body, legs, mats, kind: 'c', walk: 0 };
      break;
    }
    case 'boss': {
      const B = T.boss;
      mdl = humanoid({ skin: B.skin, shirt: B.body, pants: new THREE.Color(B.body).multiplyScalar(0.7).getHex(), eye: B.eye, bulk: 1.3, sleeve: B.body, belt: B.accent });
      const acc = lam(B.accent);
      if (T.deco === 'desert') { // nemes headdress
        bx(mdl.head, 0.7, 0.3, 0.6, 0, 0.55, -0.05, lam(0xffc72c)); bx(mdl.head, 0.7, 0.6, 0.12, 0, 0.2, -0.3, acc);
        bx(mdl.head, 0.12, 0.5, 0.3, -0.33, 0.1, 0, acc); bx(mdl.head, 0.12, 0.5, 0.3, 0.33, 0.1, 0, acc);
      } else if (T.deco === 'crypt') { // crown
        const gold = lam(0xffc72c);
        bx(mdl.head, 0.56, 0.12, 0.56, 0, 0.55, 0, gold);
        for (const [cx, cz] of [[-0.22, 0.22], [0.22, 0.22], [-0.22, -0.22], [0.22, -0.22], [0, 0.22]]) bx(mdl.head, 0.1, 0.2, 0.1, cx, 0.7, cz, gold);
      } else if (T.deco === 'lava') {
        const lava = new THREE.MeshBasicMaterial({ color: 0xff6a00 });
        bx(mdl.body, 0.66 * 1.3, 0.08, 0.4 * 1.3, 0, 1.2, 0.01, lava); bx(mdl.body, 0.08, 0.6, 0.4 * 1.3 + 0.01, 0.15, 1.1, 0, lava);
        bx(mdl.head, 0.2, 0.3, 0.2, -0.2, 0.6, 0, lava); bx(mdl.head, 0.2, 0.3, 0.2, 0.2, 0.6, 0, lava);
      } else {
        bx(mdl.head, 0.5, 0.3, 0.1, 0, 0.0, 0.27, lam(0xffffff)); // beard
        bx(mdl.head, 0.56, 0.2, 0.56, 0, 0.58, 0, lam(0xe8f8ff));
      }
      // giant club
      const club = new THREE.Group();
      bx(club, 0.18, 1.2, 0.18, 0, 0.4, 0, lam(0x5a3a1a));
      bx(club, 0.45, 0.6, 0.45, 0, 1.1, 0, acc);
      club.rotation.x = 1.0; mdl.hand.add(club);
      break;
    }
    case 'chest': {
      const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
      const wood = lam(0x8b5a2b), gold = lam(0xffc107);
      bx(body, 1.3, 0.7, 0.85, 0, 0.35, 0, wood);
      bx(body, 1.36, 0.3, 0.9, 0, 0.82, 0, lam(0xa0522d));
      bx(body, 0.2, 0.25, 0.05, 0, 0.6, 0.45, gold);
      bx(body, 1.38, 0.08, 0.92, 0, 0.7, 0, gold);
      addShadow(root, 0.8);
      mdl = { root, body, mats: [wood], kind: 'p' };
      break;
    }
    case 'pot': {
      const root = new THREE.Group(); const body = new THREE.Group(); root.add(body);
      const col = T.deco === 'desert' ? 0xc0703a : T.deco === 'crypt' ? 0x7a6a5a : T.deco === 'lava' ? 0x5a3a2a : 0x8ab4d0;
      const mm = lam(col);
      bx(body, 0.55, 0.55, 0.55, 0, 0.3, 0, mm); bx(body, 0.35, 0.18, 0.35, 0, 0.66, 0, mm);
      addShadow(root, 0.4);
      mdl = { root, body, mats: [mm], kind: 'p' };
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
    mdl.armR.rotation.x = ar;
    mdl.body.position.y = Math.abs(Math.sin(mdl.walk)) * 0.06 * Math.min(1, speed / 3);
  } else if (mdl.kind === 'q' || mdl.kind === 'c') {
    if (speed > 0.4) mdl.walk += dt * 16; else mdl.walk *= 0.85;
    const s = Math.sin(mdl.walk) * 0.5;
    mdl.legs.forEach((l, i) => { if (mdl.kind === 'q') l.rotation.y = (i % 2 ? s : -s); else l.rotation.x = (i % 2 ? s : -s); });
    mdl.body.position.y = Math.abs(Math.sin(mdl.walk)) * 0.05;
    if (wind > 0 && mdl.kind === 'c') mdl.body.scale.setScalar(1 + 0.12 * Math.abs(Math.sin(t * 20)));
    else mdl.body.scale.setScalar(1);
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

const PROJ_KINDS = ['arrow', 'orb', 'bone', 'eorb', 'fire', 'earrow'];
function buildProjModel(k, color) {
  const g = new THREE.Group();
  if (k === 'arrow' || k === 'earrow') {
    bx(g, 0.07, 0.07, 0.9, 0, 0, 0, new THREE.MeshBasicMaterial({ color: k === 'arrow' ? (color || 0xfff3c4) : 0xff5050 }));
    bx(g, 0.15, 0.15, 0.15, 0, 0, 0.45, new THREE.MeshBasicMaterial({ color: 0xcccccc }));
  } else if (k === 'bone') {
    bx(g, 0.18, 0.18, 0.6, 0, 0, 0, lam(0xf1e6c8, 0x444444));
  } else {
    const col = k === 'orb' ? (color || 0xb388ff) : k === 'fire' ? 0xff7a00 : 0x7dff4a;
    const s = new THREE.Mesh(SPHG, new THREE.MeshBasicMaterial({ color: col })); s.scale.setScalar(k === 'fire' ? 0.5 : 0.32); g.add(s);
    const halo = new THREE.Mesh(SPHG, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false })); halo.scale.setScalar(k === 'fire' ? 0.85 : 0.55); g.add(halo);
  }
  g.position.y = 1.0;
  return g;
}
