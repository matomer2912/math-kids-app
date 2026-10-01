// decor-kits-b.js — set-dressing kits for Sky Castle (bright crisp day), Mushroom Caves (bioluminescent)
// and Pirate Cove (stormy dusk). Registers new voxel prop builders into DPROP and kits into DECOR_KITS
// (decor.js is the engine: placement, safety checks, merging into a few draw calls). Purely visual.
// Builders: (b, r, P) — b = decorBuilder (box/blade/flame/glow/light/mote/push/pop), r = per-instance
// random, P = kit palette. Coplanar overlapping faces are avoided (sizes/offsets differ by >= 0.02).
'use strict';
(() => {
  const D = DPROP, pick = dpick, jit = djit;
  const TAU = 6.283;
  // shadow casters (tall props only; the rest only receive)
  ['skyColumn', 'skyStatue', 'skyBrazier', 'pirateLantern', 'pirateMast',
    'pirateCargo', 'pirateCannon', 'pirateAnchor', 'pirateRock'].forEach(n => DECOR_CAST.add(n));

  // ======================= Sky Castle =======================
  // long royal banner hanging from the top edge of a wall face (origin = top edge, +z out of the face)
  D.skyBanner = (b, r, P) => {
    const H = b.H || 2, L = Math.min(H - 0.45, 1.2 + r() * 0.45), w = 0.72 + r() * 0.16, c = pick(P.banner, r), top = -0.2;
    b.box(P.gold, w + 0.34, 0.08, 0.08, 0, top, 0.07, { g: 0 });
    b.box(P.gold, 0.12, 0.12, 0.12, -(w + 0.34) / 2, top - 0.02, 0.07, { g: 0 });
    b.box(P.gold, 0.12, 0.12, 0.12, (w + 0.34) / 2, top - 0.02, 0.07, { g: 0 });
    const seg = 3, sl = L / seg;
    for (let k = 0; k < seg; k++) {
      const sw = 0.006 + k * 0.012;
      b.box(shade(c, 1 - k * 0.04), w, sl, 0.04 + k * 0.004, 0, top - (k + 1) * sl, 0.05, { g: 0, sw: sw + 0.012, sb: sw });
      b.box(P.gold, 0.07, sl, 0.03, -w / 2 + 0.08, top - (k + 1) * sl, 0.085, { g: 0, sw: sw + 0.012, sb: sw });
      b.box(P.gold, 0.07, sl, 0.03, w / 2 - 0.08, top - (k + 1) * sl, 0.085, { g: 0, sw: sw + 0.012, sb: sw });
    }
    // swallowtail + emblem
    const yb = top - L, swb = 0.006 + seg * 0.012;
    b.box(c, w * 0.34, 0.22, 0.044, -w * 0.33, yb - 0.22, 0.05, { g: 0, sw: swb, sb: swb + 0.012 });
    b.box(c, w * 0.34, 0.22, 0.044, w * 0.33, yb - 0.22, 0.05, { g: 0, sw: swb, sb: swb + 0.012 });
    b.box(P.gold, 0.26, 0.26, 0.03, 0, top - sl * 0.95, 0.085, { rz: 0.785, g: 0, sw: 0.012, sb: 0.012 });
    b.box(P.white, 0.12, 0.12, 0.03, 0, top - sl * 0.95 + 0.07, 0.1, { rz: 0.785, g: 0, sw: 0.012, sb: 0.012 });
    if (r() < 0.35) b.mote(1, (r() - 0.5) * w, top - L * 0.5, 0.3, pick(P.petal, r), 0.14, 0.6 + r() * 0.4);
  };
  // pennant on a pole (wall tops)
  D.skyPennant = (b, r, P) => {
    const h = 1.5 + r() * 0.5, c = pick(P.banner, r);
    b.box(shade(P.marble, 0.85), 0.3, 0.14, 0.3, 0, 0, 0, { g: 0.2 });
    b.box(P.gold, 0.07, h, 0.07, 0, 0.14, 0, { g: 0 });
    b.box(P.gold, 0.13, 0.13, 0.13, 0, 0.14 + h, 0, { g: 0 });
    for (let k = 0; k < 4; k++) {   // stepped triangle flag streaming toward +x
      const len = 0.9 - k * 0.2, sw = 0.012 + k * 0.01;
      b.box(k & 1 ? shade(c, 0.9) : c, len, 0.11, 0.03 + k * 0.004, 0.05 + len / 2, 0.14 + h - 0.16 - k * 0.11, 0, { g: 0, sw: sw + 0.02, sb: sw });
    }
  };
  // battlements along the room side of a wall top
  D.skyCrenel = (b, r, P) => {
    const st = jit(P.marble, r, 0.04);
    for (const x of [-0.52, 0.52]) {
      if (r() < 0.12) continue;
      const h = 0.42 + r() * 0.08;
      b.box(shade(st, 0.95), 0.6, h, 0.46, x, 0, 0.24, { g: 0.25 });
      b.box(st, 0.66, 0.08, 0.52, x, h, 0.24, { g: 0 });
    }
    if (r() < 0.3) b.box(P.gold, 0.18, 0.18, 0.04, 0, 0.12, 0.5, { rz: 0.785, g: 0 });
  };
  D.skyColumn = (b, r, P) => {
    const st = jit(P.marble, r, 0.03), h = 2.1 + r() * 0.9, broken = r() < 0.3;
    b.box(shade(st, 0.84), 1.06, 0.22, 1.06, 0, 0, 0, { g: 0.3 });
    b.box(shade(st, 0.93), 0.86, 0.18, 0.86, 0, 0.22, 0, { g: 0.15 });
    b.box(P.gold, 0.72, 0.07, 0.72, 0, 0.4, 0, { g: 0 });
    const sh = broken ? h * (0.45 + r() * 0.25) : h;
    b.box(st, 0.6, sh, 0.6, 0, 0.47, 0, { g: 0.25 });
    b.box(shade(st, 0.94), 0.58, sh - 0.04, 0.58, 0, 0.47, 0, { ry: 0.785, g: 0.25 });
    if (!broken) {
      b.box(P.gold, 0.72, 0.07, 0.72, 0, 0.47 + sh, 0, { g: 0 });
      b.box(shade(st, 0.94), 0.88, 0.18, 0.88, 0, 0.54 + sh, 0, { g: 0.1 });
      b.box(st, 1.06, 0.2, 1.06, 0, 0.72 + sh, 0, { g: 0.1 });
      if (r() < 0.5) { b.box(jit(pick(P.leafDark, r), r, 0.1), 0.8, 0.22, 0.7, 0.05, 0.92 + sh, 0, { g: 0.3, sw: 0.01 }); b.box(pick(P.flower, r), 0.16, 0.1, 0.16, 0.2, 1.12 + sh, 0.1, { g: 0 }); }
    } else {
      b.box(shade(st, 1.05), 0.5, 0.32, 0.5, 0.05, 0.47 + sh, 0, { rz: 0.35, ry: 0.4, g: 0 });
      for (let s = 0; s < 2; s++) b.box(shade(st, 0.95), 0.56, 0.5, 0.56, (r() - 0.5) * 1.4, 0, 0.55 + r() * 0.3, { rz: 1.5708, ry: r() * 3, g: 0.3 });
    }
    if (r() < 0.55) {   // ivy climbing the shaft
      const iv = 0.4 + r() * sh * 0.5;
      b.box(jit(pick(P.leafDark, r), r, 0.1), 0.64, iv, 0.64, 0, 0.47, 0, { g: 0.2 });
      b.box(jit(pick(P.leaf, r), r, 0.1), 0.3, 0.3, 0.12, 0.15, 0.47 + iv - 0.1, 0.32, { g: 0 });
    }
  };
  // winged guardian statue on a pedestal
  D.skyStatue = (b, r, P) => {
    const st = jit(P.marble, r, 0.03), st2 = shade(st, 0.86);
    b.box(st2, 1.04, 0.28, 1.04, 0, 0, 0, { g: 0.3 });
    b.box(st, 0.82, 0.62, 0.82, 0, 0.28, 0, { g: 0.25 });
    b.box(P.gold, 0.86, 0.08, 0.86, 0, 0.84, 0, { g: 0 });
    const y0 = 0.92;
    b.box(st, 0.52, 0.72, 0.38, 0, y0, 0, { g: 0.25 });
    b.box(shade(st, 1.04), 0.42, 0.44, 0.32, 0, y0 + 0.72, 0, { g: 0.1 });
    b.box(shade(st, 1.06), 0.28, 0.28, 0.28, 0, y0 + 1.16, 0.02, { g: 0 });
    b.box(P.gold, 0.36, 0.05, 0.36, 0, y0 + 1.52, 0.02, { g: 0 });
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) b.box(shade(st, 1.02 - k * 0.04), 0.13, 0.78 - k * 0.16, 0.08, sx * (0.24 + k * 0.13), y0 + 0.78 - k * 0.1, -0.2 - k * 0.02, { rz: -sx * (0.45 + k * 0.3), g: 0.1 });
    b.box(P.gold, 0.07, 1.4, 0.07, 0.3, y0 + 0.15, 0.16, { g: 0 });
    b.box(P.gold, 0.22, 0.06, 0.08, 0.3, y0 + 1.1, 0.16, { g: 0 });
    if (r() < 0.6) { b.push(0.42, 0, 0.5, 0, 0.6); D.skyFlowers(b, r, P); b.pop(); }
  };
  // stone planter with flowers
  D.skyFlowerBox = (b, r, P) => {
    const w = 1.0 + r() * 0.4, st = jit(P.marble, r, 0.04);
    b.box(shade(st, 0.9), w, 0.42, 0.56, 0, 0, 0, { g: 0.3 });
    b.box(P.gold, w + 0.06, 0.06, 0.62, 0, 0.42, 0, { g: 0 });
    b.box(P.soil, w - 0.1, 0.04, 0.46, 0, 0.46, 0, { g: 0 });
    const n = 4 + Math.floor(r() * 3);
    for (let s = 0; s < n; s++) {
      const x = -w / 2 + 0.15 + (s + r() * 0.5) * (w - 0.3) / n, z = (r() - 0.5) * 0.25, hh = 0.18 + r() * 0.3;
      b.box(jit(pick(P.leaf, r), r, 0.1), 0.22, hh, 0.2, x, 0.48, z, { ry: r(), g: 0.3, sw: 0.02 });
      b.box(jit(pick(P.flower, r), r, 0.08), 0.15, 0.12, 0.15, x + 0.04, 0.48 + hh, z + 0.03, { ry: r(), g: 0, sw: 0.025, sb: 0.02 });
    }
    b.box(jit(pick(P.leafDark, r), r, 0.1), w * 0.5, 0.22, 0.08, (r() - 0.5) * w * 0.4, 0.22, 0.3, { g: 0.1 });   // trailing leaves
    if (r() < 0.4) b.mote(1, 0, 0.9, 0, pick(P.petal, r), 0.13, 0.6 + r() * 0.5);
  };
  // little flower clump (floor edges, overlay rings)
  D.skyFlowers = (b, r, P) => {
    const n = 3 + Math.floor(r() * 4);
    for (let s = 0; s < n; s++) {
      const x = (r() - 0.5) * 0.7, z = (r() - 0.5) * 0.5, h = 0.12 + r() * 0.22;
      b.blade(jit(pick(P.leaf, r), r, 0.1), 0.1, h + 0.1, 0.08, x, 0, z, r() * TAU, 0.2 + r() * 0.4, { sw: 0.03, g: 0.4 });
      if (r() < 0.7) b.box(jit(pick(P.flower, r), r, 0.08), 0.12, 0.08, 0.12, x, h, z, { ry: r(), sw: 0.03, sb: 0.03, g: 0 });
    }
  };
  // gold-trimmed urn with a round topiary
  D.skyUrn = (b, r, P) => {
    const st = jit(P.marble, r, 0.04);
    b.box(shade(st, 0.85), 0.5, 0.14, 0.5, 0, 0, 0, { g: 0.3 });
    b.box(st, 0.36, 0.2, 0.36, 0, 0.14, 0, { g: 0.2 });
    b.box(st, 0.62, 0.42, 0.62, 0, 0.34, 0, { g: 0.2 });
    b.box(P.gold, 0.68, 0.07, 0.68, 0, 0.74, 0, { g: 0 });
    const lc = jit(pick(P.leafDark, r), r, 0.08);
    b.box(lc, 0.66, 0.5, 0.66, 0, 0.81, 0, { g: 0.3, sw: 0.008 });
    b.box(shade(lc, 1.12), 0.5, 0.25, 0.5, 0.03, 1.31, -0.02, { g: 0.1, sw: 0.012, sb: 0.008 });
    if (r() < 0.6) b.box(pick(P.flower, r), 0.14, 0.1, 0.14, 0.18, 1.14, 0.3, { g: 0 });
  };
  // golden fire bowl on a slim pedestal: warm light spot
  D.skyBrazier = (b, r, P) => {
    const st = jit(P.marble, r, 0.03), h = 0.95 + r() * 0.2;
    b.box(shade(st, 0.86), 0.66, 0.18, 0.66, 0, 0, 0, { g: 0.3 });
    b.box(st, 0.34, h, 0.34, 0, 0.18, 0, { g: 0.3 });
    b.box(P.gold, 0.4, 0.08, 0.4, 0, 0.18 + h * 0.5, 0, { g: 0 });
    b.box(P.gold, 0.74, 0.22, 0.74, 0, 0.18 + h, 0, { g: 0.2 });
    b.box(P.ember, 0.58, 0.04, 0.58, 0, 0.4 + h, 0, { e: 1 });
    const y = 0.42 + h;
    b.flame(0, y + 0.16, 0, 0.32, 0.38, P.fire, P.fire2); b.flame(0.12, y + 0.1, 0.06, 0.18, 0.24, P.fire, P.fire2);
    b.glow(0, 0, 0.05, 0.3, 4.6, 4.0, P.fire, 0.3, 0.1);
    b.glow(2, 0, y + 0.3, 0.3, 2.0, 2.0, P.fire, 0.5, 0.15);
    b.light(0, y + 0.8, 0.5, P.fire, 1.2, 9);
    b.mote(2, 0, y + 0.2, 0, P.fire, 0.1, 1 + r());
  };
  // soft cloud tuft (void around the walls, under pit holes)
  D.skyCloud = (b, r, P) => {
    const n = 5 + Math.floor(r() * 4), s = 0.8 + r() * 0.5;
    b.push(0, -r() * 1.4, 0, r() * TAU, s);
    b.box(P.cloudLo, 1.7, 0.34, 1.1, 0, 0, 0, { g: 0.2 });
    for (let k = 0; k < n; k++) {
      const w = 0.45 + r() * 0.6, x = (r() - 0.5) * 2.2, z = (r() - 0.5) * 1.1, y = 0.18 + r() * 0.3 - Math.abs(x) * 0.12;
      b.box(k & 1 ? P.cloud : P.cloud2, w, w * (0.5 + r() * 0.3), w * (0.8 + r() * 0.3), x, y, z, { ry: r() * 0.6, g: 0.22 });
    }
    b.glow(2, 0, 0.35, 0.2, 4.2, 2.6, P.cloud, 0.22, 0);
    b.glow(2, (r() - 0.5) * 1.5, 0.2, 0.3, 2.6, 1.8, P.cloud, 0.18, 0);
    b.pop();
  };
  D.skyPitCloud = (b, r, P) => { b.push(0, 25.5 + r() * 1.5, 0, 0, 0.8 + r() * 0.4); D.skyCloud(b, r, P); b.pop(); };
  // floating rock island in the sky beyond the walls
  D.skyIsland = (b, r, P) => {
    const s = 0.5 + r() * 0.45;
    b.push(0, -3.2 - r() * 3.5, 0, r() * TAU, s);
    const rk = jit(P.rock, r, 0.06);
    const tiers = [[2.4, 0.5], [1.8, 0.5], [1.2, 0.55], [0.6, 0.5]];
    let y = 0;
    tiers.forEach(([w, h], k) => { y -= h; b.box(shade(rk, 1 - k * 0.1), w * (0.9 + r() * 0.2), h, w * (0.85 + r() * 0.2), (r() - 0.5) * 0.3, y, (r() - 0.5) * 0.3, { ry: r() * 0.4, g: 0.15 }); });
    b.box(jit(P.grass, r, 0.06), 2.3, 0.14, 2.1, 0, 0, 0, { g: 0.1 });
    b.box(jit(pick(P.leafDark, r), r, 0.06), 0.9, 0.26, 0.6, 0.6, 0.16, -0.5, { g: 0.2 });
    const what = r();
    if (what < 0.35) {      // little tree
      b.box(P.bark, 0.22, 0.9, 0.22, -0.4, 0.16, 0.2, { g: 0.2 });
      b.box(jit(pick(P.leaf, r), r, 0.08), 1.0, 0.7, 0.9, -0.4, 1.0, 0.2, { g: 0.3, sw: 0.01 });
      b.box(jit(pick(P.leaf, r), r, 0.08), 0.6, 0.36, 0.56, -0.35, 1.7, 0.18, { g: 0.1, sw: 0.015 });
    } else if (what < 0.65) { // broken column
      b.box(P.marble, 0.5, 0.8 + r() * 0.8, 0.5, 0.2, 0.16, 0, { g: 0.2 });
      b.box(shade(P.marble, 0.9), 0.7, 0.16, 0.7, 0.2, 0.16, 0, { g: 0.1 });
    } else if (what < 0.8) {  // glowing sky crystal
      b.box(P.crystal, 0.26, 0.9, 0.26, 0, 0.16, 0, { rz: 0.15, e: 1 });
      b.box(P.crystal2, 0.18, 0.55, 0.18, 0.2, 0.16, 0.1, { rz: -0.3, e: 1 });
      b.glow(2, 0, 0.7, 0.2, 1.8, 1.8, P.crystal, 0.3, 0.02);
    }
    b.box(shade(rk, 0.7), 0.3, 0.9, 0.3, 0.2, y - 0.7, 0, { g: 0 });   // hanging stalactite / root
    b.pop();
  };
  // grassy tuft + a few flowers on wall tops (hanging gardens)
  D.skyGarden = (b, r, P) => {
    const x = (r() - 0.5) * 0.9, z = (r() - 0.5) * 0.9, w = 0.45 + r() * 0.35, lc = jit(pick(P.leafDark, r), r, 0.1);
    b.box(lc, w, 0.26 + r() * 0.16, w * (0.8 + r() * 0.3), x, 0, z, { ry: r(), g: 0.35, sw: 0.008 });
    b.box(shade(lc, 1.18), w * 0.6, 0.14, w * 0.55, x + 0.04, 0.3, z - 0.02, { ry: r(), g: 0.1, sw: 0.012, sb: 0.008 });
    if (r() < 0.7) for (let k = 0; k < 2; k++) b.box(pick(P.flower, r), 0.11, 0.08, 0.11, x + (r() - 0.5) * w * 0.6, 0.38 + r() * 0.06, z + (r() - 0.5) * w * 0.5, { g: 0 });
  };
  D.skyIvy = (b, r, P) => {     // ivy + little blossoms hanging down a wall face (origin = top edge)
    const H = b.H || 2, n = 1 + Math.floor(r() * 3);
    for (let s = 0; s < n; s++) {
      const x = (r() - 0.5) * 1.6, len = 0.5 + r() * Math.min(1.3, H - 0.4), seg = Math.max(2, Math.round(len / 0.32));
      for (let k = 0; k < seg; k++) {
        const y = -0.02 - (k + 1) * (len / seg), sw = 0.006 + k * 0.01;
        b.box(P.vine, 0.08, len / seg, 0.05, x + Math.sin(k * 1.3 + s) * 0.04, y, 0.04, { g: 0, sw, sb: sw + 0.01 });
        b.box(jit(pick(k & 1 ? P.leaf : P.leafDark, r), r, 0.1), 0.26, 0.2, 0.06, x + (k & 1 ? 0.11 : -0.11), y, 0.07, { rz: k & 1 ? -0.4 : 0.4, g: 0, sw: sw + 0.01, sb: sw + 0.01 });
        if (r() < 0.3) b.box(pick(P.flower, r), 0.09, 0.09, 0.05, x + (k & 1 ? -0.1 : 0.1), y + 0.05, 0.1, { g: 0, sw, sb: sw });
      }
    }
  };
  D.skyPetals = (b, r, P) => {   // petals strewn on the floor
    const n = 3 + Math.floor(r() * 4);
    for (let s = 0; s < n; s++) b.box(pick(P.petal, r), 0.12, 0.012, 0.09, (r() - 0.5) * 1.4, 0, (r() - 0.5) * 1.0, { ry: r() * 3, g: 0 });
  };
  D.skyRing = (b, r, P) => {     // around columns / statues
    for (let s = 0; s < 4; s++) {
      if (r() < 0.35) continue;
      const a = s * 1.571 + 0.785 + (r() - 0.5) * 0.3;
      b.push(Math.cos(a) * 0.82, 0, Math.sin(a) * 0.82, r() * 3, 0.7);
      (r() < 0.4 ? D.skyUrn : D.skyFlowers)(b, r, P); b.pop();
    }
  };
  D.skyTufts = (b, r, P) => { for (let s = 0; s < 2; s++) { const a = r() * TAU; b.push(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7, r() * 3, 0.8); D.skyFlowers(b, r, P); b.pop(); } };

  // ======================= Mushroom Caves =======================
  // tall glowing mushroom out of the void (silhouette + light spot)
  const capOf = (P, r) => { const i = Math.floor(r() * P.cap.length); return [P.cap[i], P.capGlow[i], P.spot[i]]; };
  function shroom(b, r, P, h, cw, x0, z0, floorPool) {
    const [cap, glow, spot] = capOf(P, r), stem = jit(P.stem, r, 0.06), sw = 0.16 + cw * 0.14;
    let x = x0, z = z0, y = 0;
    const bx = (r() - 0.5) * cw * 0.12, bz = cw * (0.04 + r() * 0.05), seg = h > 1.2 ? 3 : 1, small = cw < 0.5;
    if (!small) b.box(shade(stem, 0.75), sw * 1.6, Math.min(0.5, h * 0.25), sw * 1.6, x, 0, z, { g: 0.4 });
    for (let k = 0; k < seg; k++) { const hh = h / seg; b.box(shade(stem, 0.88 + k * 0.07), sw * (1 - k * 0.12), hh + 0.02, sw * (1 - k * 0.12), x, y, z, { g: 0.3 }); x += bx; z += bz; y += hh; }
    b.box(glow, cw * 1.04, 0.08, cw * 1.04, x, y - 0.1, z, { e: 1 });                      // glowing gill rim
    b.box(cap, cw, cw * 0.18, cw, x, y - 0.03, z, { g: 0.35 });
    b.box(shade(cap, 1.12), cw * 0.84, cw * 0.13, cw * 0.84, x, y - 0.03 + cw * 0.18, z, { g: 0.15 });
    if (!small) b.box(shade(cap, 1.24), cw * 0.56, cw * 0.07, cw * 0.56, x, y - 0.03 + cw * 0.31, z, { g: 0 });
    const ns = cw > 1.2 ? 6 : small ? 1 : 3;
    for (let s = 0; s < ns; s++) {
      const a = r() * TAU, inner = (s & 1) && !small, d = inner ? cw * (0.05 + r() * 0.18) : cw * (0.3 + r() * 0.1), ss = cw * (0.07 + r() * 0.05);
      b.box(spot, ss, 0.04, ss, x + Math.cos(a) * d, y - 0.03 + cw * (inner ? 0.38 : 0.31), z + Math.sin(a) * d, { e: 1 });
    }
    b.glow(2, x, y + cw * 0.1, z + 0.3, cw * 1.9, cw * 1.4, glow, 0.32, 0.03);
    if (floorPool) b.glow(0, x0, 0.04, z0 + 0.2, cw * 3.2, cw * 3.0, glow, 0.32, 0.03);
    return [x, y, z, glow];
  }
  D.shroomGiant = (b, r, P) => {
    const [x, y, z, gl] = shroom(b, r, P, 2.8 + r() * 1.8, 2.0 + r() * 0.9, 0, 0, false);
    b.light(x, y - 0.3, z + 1.2, gl, 1.3, 10);
    for (let s = 0; s < 2; s++) b.mote(2, x + (r() - 0.5) * 1.6, y - 0.4, z + (r() - 0.5) * 1.2, gl, 0.13, 0.5 + r() * 0.4);
    b.mote(0, x, y - 0.8, z + 0.8, P.firefly, 0.18, 0.3 + r() * 0.3);
    if (r() < 0.6) shroom(b, r, P, 0.6 + r() * 0.7, 0.6 + r() * 0.4, 0.9, 0.5, false);
  };
  D.shroomTall = (b, r, P) => {
    const [x, y, z, gl] = shroom(b, r, P, 1.3 + r() * 0.8, 1.1 + r() * 0.5, 0, 0, true);
    for (let s = 0; s < 2; s++) shroom(b, r, P, 0.25 + r() * 0.35, 0.3 + r() * 0.25, (r() - 0.5) * 1.1, 0.35 + r() * 0.3, false);
    if (r() < 0.7) b.light(x, y + 0.3, z + 0.8, gl, 1.2, 8);
    b.mote(2, x, y, z, gl, 0.12, 0.6 + r() * 0.4);
  };
  D.shroomCluster = (b, r, P) => {
    const n = 2 + Math.floor(r() * 4); let gl = null;
    for (let s = 0; s < n; s++) { const res = shroom(b, r, P, 0.12 + r() * 0.3, 0.18 + r() * 0.2, (r() - 0.5) * 0.7, (r() - 0.5) * 0.5, false); gl = gl || res[3]; }
    b.glow(0, 0, 0.04, 0, 2.6, 2.4, gl, 0.3, 0.03);
    if (r() < 0.08) b.light(0, 0.8, 0.5, gl, 0.9, 6);
    if (r() < 0.5) b.mote(2, 0, 0.3, 0, gl, 0.1, 0.5 + r() * 0.5);
  };
  // bracket fungi on a wall face (origin = top edge, +z out of the face)
  D.shroomShelf = (b, r, P) => {
    const H = b.H || 2, n = 2 + Math.floor(r() * 3), [cap, glow] = capOf(P, r);
    for (let s = 0; s < n; s++) {
      const x = (r() - 0.5) * 1.3, y = -0.35 - r() * (H - 0.8), w = 0.35 + r() * 0.35;
      b.box(shade(cap, 0.8), w, 0.1, w * 0.62, x, y, w * 0.31, { g: 0.2 });
      b.box(glow, w * 1.06, 0.04, w * 0.66, x, y - 0.03, w * 0.32, { e: 1 });
      b.box(shade(cap, 1.1), w * 0.7, 0.08, w * 0.42, x, y + 0.1, w * 0.21, { g: 0 });
    }
    b.glow(2, 0, -H * 0.45, 0.35, 1.6, 1.4, glow, 0.28, 0.03);
  };
  // glowing tendrils / glow-berries hanging from the top edge of a wall face
  D.shroomVines = (b, r, P) => {
    const H = b.H || 2, n = 2 + Math.floor(r() * 3);
    for (let s = 0; s < n; s++) {
      const x = (r() - 0.5) * 1.5, len = 0.5 + r() * Math.min(1.4, H - 0.4), seg = Math.max(2, Math.round(len / 0.35));
      for (let k = 0; k < seg; k++) {
        const y = -0.03 - (k + 1) * (len / seg), sw = 0.008 + k * 0.01;
        b.box(P.vine, 0.07, len / seg, 0.06, x + Math.sin(k + s) * 0.03, y, 0.05, { g: 0, sw, sb: sw + 0.01 });
        if (k & 1) b.box(pick(P.berry, r), 0.1, 0.1, 0.1, x + 0.06, y, 0.1, { e: 1, sw, sb: sw });
      }
    }
    b.box(jit(P.mossTop, r, 0.1), 1.6, 0.1, 0.5, (r() - 0.5) * 0.3, 0, -0.25, { g: 0 });
  };
  // luminous moss patch
  D.shroomMoss = (b, r, P) => {
    const w = 0.6 + r() * 0.9;
    b.box(jit(P.moss, r, 0.12), w, 0.03, w * (0.6 + r() * 0.4), (r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5, { ry: r() * 3, g: 0 });
    const n = 2 + Math.floor(r() * 4);
    for (let s = 0; s < n; s++) b.box(pick(P.dot, r), 0.06, 0.04, 0.06, (r() - 0.5) * w * 0.8, 0.01, (r() - 0.5) * w * 0.5, { e: 1 });
  };
  // rock spire cluster (void / wall tops), sometimes crystal tipped
  D.shroomStalag = (b, r, P) => {
    const n = 1 + Math.floor(r() * 3), rk = jit(P.rock, r, 0.08);
    for (let s = 0; s < n; s++) {
      const x = (r() - 0.5) * 1.2, z = (r() - 0.5) * 1.0, h = (s ? 0.8 : 1.6) + r() * (s ? 0.8 : 1.8), w = s ? 0.4 : 0.62;
      b.box(shade(rk, 0.9), w, h * 0.5, w, x, 0, z, { g: 0.35 });
      b.box(rk, w * 0.66, h * 0.32, w * 0.66, x + 0.03, h * 0.5, z, { g: 0.15 });
      b.box(shade(rk, 1.1), w * 0.36, h * 0.24, w * 0.36, x + 0.05, h * 0.82, z, { g: 0 });
      if (!s && r() < 0.45) { b.box(P.crystal, 0.16, 0.5, 0.16, x + 0.05, h * 1.04, z, { rz: 0.2, e: 1 }); b.glow(2, x, h * 1.15, z + 0.2, 1.4, 1.4, P.crystal, 0.3, 0.02); }
      if (r() < 0.5) b.box(jit(P.moss, r, 0.1), w * 1.04, 0.1, w * 1.04, x, h * 0.5 - 0.06, z, { g: 0 });
    }
  };
  // bubbles on the glowing goo pools
  D.shroomBubbles = (b, r, P) => {
    const n = 2 + Math.floor(r() * 3);
    for (let s = 0; s < n; s++) { const w = 0.12 + r() * 0.2; b.box(P.bubble, w, w * 0.6, w, (r() - 0.5) * 1.4, 0, (r() - 0.5) * 1.4, { e: 1 }); }
    if (r() < 0.5) shroom(b, r, P, 0.2, 0.3, (r() - 0.5) * 1.2, (r() - 0.5) * 1.2, false);
    b.mote(2, (r() - 0.5), 0.1, (r() - 0.5), P.bubble, 0.14, 0.5 + r() * 0.5);
  };
  D.shroomRing = (b, r, P) => {
    for (let s = 0; s < 4; s++) {
      if (r() < 0.3) continue;
      const a = s * 1.571 + 0.785 + (r() - 0.5) * 0.4;
      b.push(Math.cos(a) * 0.82, 0, Math.sin(a) * 0.82, r() * 3, 0.8); (s & 1 ? D.shroomCluster : D.shroomMoss)(b, r, P); b.pop();
    }
  };
  D.shroomMossRing = (b, r, P) => { for (let s = 0; s < 2; s++) { const a = r() * TAU; b.push(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7, r() * 3, 0.8); D.shroomMoss(b, r, P); b.pop(); } };

  // ======================= Pirate Cove =======================
  function barrel(b, r, P, x, y, z, side) {
    const wd = jit(pick(P.wood, r), r, 0.06), s = 0.85 + r() * 0.2, h = 0.82 * s, w = 0.62 * s;
    if (side) {   // lying on its side: axis along local z, centred at height w/2
      b.push(x, y + w / 2, z, r() * 3, 1);
      b.box(wd, w, h, w, 0, 0, -h / 2, { rx: 1.5708, g: 0.15 });
      for (const d of [-h * 0.3, h * 0.3]) b.box(P.iron, w + 0.04, 0.07, w + 0.04, 0, 0, d - 0.035, { rx: 1.5708, g: 0 });
    } else {
      b.push(x, y, z, r() * 0.8, 1);
      b.box(wd, w, h, w, 0, 0, 0, { g: 0.3 });
      b.box(shade(wd, 0.92), w * 0.94, h - 0.04, w * 0.94, 0, 0.02, 0, { ry: 0.785, g: 0.3 });
      b.box(P.iron, w + 0.04, 0.07, w + 0.04, 0, h * 0.18, 0, { g: 0 });
      b.box(P.iron, w + 0.04, 0.07, w + 0.04, 0, h * 0.72, 0, { g: 0 });
      b.box(shade(wd, 0.7), w * 0.7, 0.02, w * 0.7, 0, h, 0, { g: 0 });
    }
    b.pop();
    return h;
  }
  function crate(b, r, P, x, y, z, s, ry) {
    const wd = jit(pick(P.wood, r), r, 0.07), w = 0.72 * s;
    b.push(x, y, z, ry, 1);
    b.box(wd, w, w, w, 0, 0, 0, { g: 0.3 });
    const fr = shade(wd, 0.7);
    for (const [fx, fz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) b.box(fr, 0.1, w + 0.02, 0.1, fx * (w / 2 - 0.03), -0.01, fz * (w / 2 - 0.03), { g: 0.1 });
    b.box(fr, w + 0.04, 0.09, 0.06, 0, w * 0.45, w / 2, { rz: 0.72, g: 0 });   // diagonal brace on the front
    b.box(fr, w + 0.03, 0.06, w + 0.03, 0, w - 0.05, 0, { g: 0 });
    b.pop();
    return w;
  }
  // barrels + crates stacked against a wall
  D.pirateCargo = (b, r, P) => {
    const k = r();
    if (k < 0.4) {
      const h = crate(b, r, P, -0.25, 0, 0, 1, r() * 0.4);
      if (r() < 0.7) crate(b, r, P, -0.2, h + 0.02, 0.02, 0.8, r() * 0.8);
      barrel(b, r, P, 0.5, 0, 0.15, false);
    } else if (k < 0.75) {
      barrel(b, r, P, -0.35, 0, 0, false); barrel(b, r, P, 0.35, 0, -0.05, false);
      if (r() < 0.6) barrel(b, r, P, 0.0, 0, 0.55, true);
    } else {
      crate(b, r, P, 0, 0, 0, 1.1, r() * 0.3);
      if (r() < 0.6) { b.box(P.sack, 0.5, 0.36, 0.42, 0.65, 0, 0.2, { ry: r(), g: 0.3 }); b.box(shade(P.sack, 0.9), 0.14, 0.12, 0.14, 0.65, 0.36, 0.2, { g: 0 }); }
    }
    if (r() < 0.35) D.pirateRope(b, r, P, 0.2, 0.55);
  };
  // rope coil
  D.pirateRope = (b, r, P, x0, z0) => {
    x0 = x0 || 0; z0 = z0 || 0;
    const R = 0.22 + r() * 0.08;
    for (let ly = 0; ly < 2; ly++) for (let s = 0; s < 8; s++) {
      const a = s * 0.785 + ly * 0.39, rr = R - ly * 0.06;
      b.box(shade(P.rope, 1 - ly * 0.08 - (s & 1) * 0.06), 0.2, 0.08, 0.09, x0 + Math.cos(a) * rr, ly * 0.075, z0 + Math.sin(a) * rr, { ry: -a + 1.5708, g: 0.2 });
    }
    b.box(P.rope, 0.5, 0.06, 0.08, x0 + R + 0.15, 0, z0 + 0.1, { ry: 0.5, g: 0.2 });
  };
  // lamp post with a hanging lantern: warm light spot
  D.pirateLantern = (b, r, P) => {
    const wd = jit(P.post, r, 0.06), h = 1.7 + r() * 0.3;
    b.box(shade(wd, 0.8), 0.36, 0.14, 0.36, 0, 0, 0, { g: 0.3 });
    b.box(wd, 0.18, h, 0.18, 0, 0.14, 0, { g: 0.3 });
    b.box(wd, 0.12, 0.12, 0.6, 0, h - 0.05, 0.26, { g: 0 });
    b.box(P.rope, 0.2, 0.08, 0.2, 0, h * 0.4, 0, { g: 0 });
    lantern(b, r, P, 0, h - 0.62, 0.48);
  };
  function lantern(b, r, P, x, y, z, noPool) {
    b.box(P.iron, 0.03, 0.18, 0.03, x, y + 0.42, z, { g: 0, sw: 0.006, sb: 0.004 });
    b.box(P.iron, 0.28, 0.06, 0.28, x, y + 0.36, z, { g: 0, sw: 0.006, sb: 0.006 });
    b.box(P.glass, 0.2, 0.3, 0.2, x, y + 0.06, z, { e: 1 });
    b.box(P.iron, 0.26, 0.06, 0.26, x, y, z, { g: 0 });
    for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(P.iron, 0.035, 0.32, 0.035, x + fx * 0.115, y + 0.05, z + fz * 0.115, { g: 0 });
    b.flame(x, y + 0.2, z, 0.08, 0.13, P.fire, P.fire2);
    b.glow(2, x, y + 0.2, z + 0.15, 1.9, 1.9, P.fire, 0.55, 0.12);
    if (!noPool) b.glow(0, x, 0.05, z + 0.25, 5.0, 4.4, P.fire, 0.4, 0.1);
    b.light(x, y + 0.5, z + 0.5, P.fire, 1.6, 10);
  }
  // lantern on an iron bracket on a wall face (origin = top edge, +z out of the face)
  D.pirateWallLantern = (b, r, P) => {
    const H = b.H || 2, y = -Math.min(0.9, H * 0.45);
    b.box(P.iron, 0.1, 0.24, 0.06, 0, y - 0.05, 0.03, { g: 0 });
    b.box(P.iron, 0.06, 0.06, 0.44, 0, y + 0.12, 0.22, { g: 0 });
    lantern(b, r, P, 0, y - 0.48, 0.42, true);
    b.glow(0, 0, -H + 0.05, 1.3, 4.8, 4.0, P.fire, 0.38, 0.1);
    if (r() < 0.4) b.mote(2, 0, y - 0.2, 0.42, P.fire, 0.08, 1.2);
  };
  // fishing net draped over a wall face, with floats
  D.pirateNet = (b, r, P) => {
    const H = b.H || 2, w = 1.3 + r() * 0.3, h = Math.min(H - 0.3, 1.0 + r() * 0.5);
    for (let s = 0; s <= 5; s++) b.box(P.net, 0.035, h, 0.03, -w / 2 + s * w / 5, -0.15 - h, 0.04, { g: 0, sw: 0.004, sb: 0.012 });
    for (let s = 0; s <= 4; s++) b.box(P.net, w, 0.035, 0.03, 0, -0.15 - s * h / 4, 0.06, { g: 0, sw: 0.004 + s * 0.003, sb: 0.004 + s * 0.003 });
    for (let s = 0; s < 3; s++) b.box(pick(P.float, r), 0.16, 0.12, 0.12, -w / 2 + 0.2 + r() * (w - 0.4), -0.15 - (0.2 + r() * 0.7) * h, 0.11, { g: 0.1 });
    b.box(P.wood[0], w + 0.2, 0.1, 0.1, 0, -0.18, 0.06, { g: 0 });
    if (r() < 0.5) b.box(P.kelp, 0.1, h * 0.6, 0.04, (r() - 0.5) * w * 0.6, -0.15 - h * 0.8, 0.1, { g: 0, sw: 0.01 });
  };
  // big iron anchor leaning on the wall (edge site: origin on the floor, -z toward the wall)
  D.pirateAnchor = (b, r, P) => {
    b.push(0, 0, -0.15, 0, 1);
    const ir = jit(P.iron, r, 0.1), lean = -0.22;
    b.box(ir, 0.14, 1.5, 0.14, 0, 0.12, 0, { rx: lean, g: 0.2 });
    const ty = 1.5 * Math.cos(lean), tz = 1.5 * Math.sin(lean);
    b.box(ir, 0.9, 0.12, 0.12, 0, ty - 0.12, tz + 0.02, { g: 0 });
    b.box(ir, 0.3, 0.3, 0.06, 0, ty + 0.06, tz, { g: 0 });
    for (const sx of [-1, 1]) { b.box(ir, 0.55, 0.13, 0.13, sx * 0.25, 0.1, 0.03, { rz: sx * 0.5, g: 0.1 }); b.box(ir, 0.2, 0.24, 0.16, sx * 0.5, 0.22, 0.03, { rz: sx * 0.7, g: 0 }); }
    b.box(P.rope, 0.1, 0.9, 0.1, 0.12, 0.6, 0.1, { rz: 0.6, rx: lean, g: 0.1 });
    b.pop();
  };
  // cannon on its carriage (+ a pyramid of cannonballs)
  D.pirateCannon = (b, r, P) => {
    const wd = jit(P.wood[1], r, 0.05);
    b.box(wd, 0.72, 0.3, 0.95, 0, 0.12, 0, { g: 0.3 });
    for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(P.ironDark, 0.1, 0.3, 0.3, fx * 0.4, 0, fz * 0.32, { g: 0.1 });
    b.box(P.iron, 0.36, 0.36, 1.3, 0, 0.36, 0.12, { rx: -0.12, g: 0.15 });
    b.box(P.ironDark, 0.44, 0.44, 0.1, 0, 0.32, 0.76, { rx: -0.12, g: 0 });
    b.box(P.ironDark, 0.4, 0.4, 0.08, 0, 0.36, -0.5, { g: 0 });
    if (r() < 0.6) for (let s = 0; s < 4; s++) b.box(P.ironDark, 0.2, 0.2, 0.2, 0.62 + (s % 2) * 0.22 + (s === 3 ? -0.11 : 0), s === 3 ? 0.19 : 0, -0.25 + (s > 1 ? 0.22 : 0) - (s === 3 ? 0.11 : 0), { g: 0.2 });
  };
  // ship rail along a wall top
  D.pirateRail = (b, r, P) => {
    const h = 0.62 + r() * 0.1, wd = jit(P.post, r, 0.06);
    for (let s = 0; s < 4; s++) { if (r() < 0.1) continue; b.box(shade(wd, 0.9), 0.12, h, 0.12, -0.75 + s * 0.5, 0, 0, { rz: (r() - 0.5) * 0.08, g: 0.2 }); }
    b.box(wd, 2.02, 0.1, 0.16, 0, h, 0, { g: 0 });
    b.box(shade(wd, 0.85), 2.0, 0.07, 0.08, 0, h * 0.45, 0.02, { g: 0 });
    if (r() < 0.35) b.box(P.rope, 0.6, 0.06, 0.06, (r() - 0.5) * 1.0, h * 0.75, 0.09, { rz: 0.3, g: 0 });
  };
  // broken mast with a torn sail and rigging rising out of the void
  D.pirateMast = (b, r, P) => {
    const h = 5.2 + r() * 2, wd = jit(P.post, r, 0.06), base = -2.5;
    b.box(wd, 0.36, h - base, 0.36, 0, base, 0, { rz: (r() - 0.5) * 0.12, g: 0.4 });
    const yy = h - 1.2;
    b.box(shade(wd, 0.9), 2.8, 0.16, 0.16, 0, yy, 0.1, { rz: (r() - 0.5) * 0.25, g: 0 });
    const sw = 0.03;
    for (let k = 0; k < 4; k++) {     // tattered sail strips hanging from the yard
      if (r() < 0.25) continue;
      const len = 1.0 + r() * 1.4;
      b.box(jit(P.sail, r, 0.08), 0.6, len, 0.04 + k * 0.004, -0.95 + k * 0.62, yy - len, 0.2, { g: 0.1, sw: sw + 0.03, sb: sw });
    }
    for (const sx of [-1, 1]) b.box(P.rope, 0.05, 3.6, 0.05, sx * 0.8, yy - 3.3, -0.2, { rz: sx * 0.32, g: 0 });
    if (r() < 0.5) { b.box(shade(wd, 0.8), 0.8, 0.3, 0.8, 0, h - 0.1, 0, { g: 0.2 }); }
    if (r() < 0.5) { lantern(b, r, P, 0.9, yy - 0.75, 0.12, true); }
  };
  // dark wet sea stack
  D.pirateRock = (b, r, P) => {
    const rk = jit(P.rock, r, 0.06), h = 1.2 + r() * 2.2;
    b.box(shade(rk, 0.85), 1.6, h * 0.55, 1.4, 0, -1.5, 0, { ry: r(), g: 0.4 });
    b.box(rk, 1.1, h * 0.5, 1.0, 0.1, -1.5 + h * 0.55, 0.05, { ry: r(), g: 0.2 });
    b.box(shade(rk, 1.1), 0.6, h * 0.35, 0.55, 0.15, -1.5 + h * 1.05, 0.05, { ry: r(), g: 0 });
    b.box(jit(P.kelp, r, 0.1), 1.14, 0.18, 1.04, 0.1, -1.5 + h * 0.55 + h * 0.5 - 0.15, 0.05, { g: 0 });
  };
  // wooden pilings standing in the water, with a ring of foam
  D.piratePiling = (b, r, P) => {
    const n = 1 + Math.floor(r() * 2);
    for (let s = 0; s < n; s++) {
      const x = (r() - 0.5) * 1.0, z = (r() - 0.5) * 1.0, h = 1.2 + r() * 0.6;
      b.box(jit(P.post, r, 0.08), 0.26, h, 0.26, x, -0.2, z, { rz: (r() - 0.5) * 0.12, g: 0.5 });
      b.box(P.rope, 0.3, 0.1, 0.3, x, h - 0.6, z, { g: 0 });
      b.box(P.kelp, 0.3, 0.2, 0.3, x, 0.0, z, { g: 0 });
      b.box(P.foam, 0.62, 0.02, 0.62, x, 0.02, z, { ry: 0.4, g: 0 });
    }
  };
  // foam streaks / wave crests on the water
  D.pirateFoam = (b, r, P) => {
    const n = 2 + Math.floor(r() * 3);
    for (let s = 0; s < n; s++) { const L = 0.5 + r() * 1.2; b.box(s & 1 ? P.foam : P.foam2, L, 0.025, 0.08 + r() * 0.08, (r() - 0.5) * 1.3, 0.01 * s, (r() - 0.5) * 1.3, { ry: (r() - 0.5) * 0.6, g: 0 }); }
    if (r() < 0.4) b.mote(2, 0, 0.1, 0, P.spray, 0.14, 0.7 + r() * 0.5);
  };
  // kelp / seaweed strands
  D.pirateKelp = (b, r, P) => {
    const n = 3 + Math.floor(r() * 3);
    for (let s = 0; s < n; s++) b.blade(jit(pick([P.kelp, P.kelp2], r), r, 0.1), 0.12, 0.35 + r() * 0.5, 0.06, (r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.4, r() * TAU, 0.15 + r() * 0.5, { sw: 0.05, g: 0.4 });
  };
  // shells and starfish strewn on the planks
  D.pirateShells = (b, r, P) => {
    if (r() < 0.5) { const c = pick(P.star, r), x = (r() - 0.5) * 0.8, z = (r() - 0.5) * 0.6; for (let s = 0; s < 5; s++) { const a = s * 1.2566 + r() * 0.2; b.box(c, 0.08, 0.04, 0.22, x + Math.sin(a) * 0.1, 0, z + Math.cos(a) * 0.1, { ry: a, g: 0 }); } }
    for (let s = 0; s < 2; s++) b.box(P.shell, 0.14, 0.06, 0.12, (r() - 0.5) * 1.0, 0, (r() - 0.5) * 0.8, { ry: r() * 3, g: 0.2 });
  };
  // a little spilled treasure: coins + a glint
  D.pirateGold = (b, r, P) => {
    const n = 5 + Math.floor(r() * 5);
    for (let s = 0; s < n; s++) { const a = r() * TAU, d = r() * 0.4; b.box(jit(P.gold, r, 0.08), 0.13, 0.03 + (s < 3 ? 0.06 : 0), 0.13, Math.cos(a) * d, 0, Math.sin(a) * d, { ry: r(), g: 0.1 }); }
    b.box(P.glint, 0.05, 0.05, 0.05, 0.05, 0.1, 0.02, { e: 1 });
    b.glow(0, 0, 0.04, 0, 1.4, 1.4, P.gold, 0.2, 0.05);
  };
  D.pirateRing = (b, r, P) => {    // around cannons / columns
    for (let s = 0; s < 4; s++) {
      if (r() < 0.4) continue;
      const a = s * 1.571 + 0.785 + (r() - 0.5) * 0.3;
      b.push(Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8, r() * 3, 0.75);
      if (s & 1) D.pirateRope(b, r, P); else for (let k = 0; k < 3; k++) b.box(P.ironDark, 0.2, 0.2, 0.2, (k % 2) * 0.22 - (k === 2 ? 0.11 : 0), k === 2 ? 0.19 : 0, k === 2 ? 0.11 : 0, { g: 0.2 });
      b.pop();
    }
  };
  D.pirateClutter = (b, r, P) => { const a = r() * TAU; b.push(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7, r() * 3, 0.85); (r() < 0.5 ? D.pirateShells : D.pirateRope)(b, r, P); b.pop(); };

  // ======================= kits =======================
  Object.assign(DECOR_KITS, {
    sky: {
      pal: {
        marble: 0xf2ede2, white: 0xffffff, gold: 0xe8b83a, banner: [0x2a4ac0, 0x2450b8, 0x3a5ad8], soil: 0x6a5038,
        leaf: [0x4a8a3a, 0x569a40, 0x62a648], leafDark: [0x2c5e2c, 0x346a30, 0x284f2a], flower: [0xff5a6a, 0xffd03a, 0xffffff, 0xff8ab0, 0x7ab0ff],
        petal: [0xffb8d0, 0xffffff, 0xffe08a], cloud: 0xffffff, cloud2: 0xeef3fc, cloudLo: 0xd2dcee, rock: 0x8a7e72, grass: 0x6a9a50, bark: 0x6a4a30,
        crystal: 0x8fe0ff, crystal2: 0xe6faff, ember: 0xffb040, fire: 0xffc040, fire2: 0xfff4c0, vine: 0x3a7a30,
      },
      shafts: { c: 0xfff0c8, i: 0.16, per: 0.45, w: [1.8, 2.8] },
      rules: [
        { p: 'skyIsland', at: 'void', d: 0.09, sp: 4, h: 0.5, rad: 1.2 },
        { p: 'skyCloud', at: 'void', d: 0.2, sp: 2, y: -0.9, h: 0.5, rad: 1.2 },
        { p: 'skyPitCloud', at: 'pit', d: 0.3, sp: 2 },
        { p: 'skyBanner', at: 'faceN', d: 0.3, sp: 2, solo: 1, minH: 1.6 },
        { p: 'skyIvy', at: 'faceN', d: 0.14, sp: 3, solo: 1 },
        { p: 'skyIvy', at: 'faceSide', d: 0.12, sp: 3, solo: 1 },
        { p: 'skyStatue', at: 'cornerN', d: 0.3, sp: 5, h: 2.7, in: 0.6, solo: 1 },
        { p: 'skyColumn', at: 'cornerN', d: 0.4, sp: 4, h: 3.4, in: 0.6, solo: 1 },
        { p: 'skyBrazier', at: 'cornerN', d: 0.35, sp: 5, h: 1.7, in: 0.5, solo: 1 },
        { p: 'skyUrn', at: 'cornerS', d: 0.35, in: 0.45, s: [0.75, 0.9], solo: 1 },
        { p: 'skyColumn', at: 'edgeN', d: 0.05, sp: 6, h: 3.4, in: 0.55, solo: 1 },
        { p: 'skyFlowerBox', at: 'edgeN', d: 0.14, sp: 3, in: 0.35, solo: 1 },
        { p: 'skyFlowerBox', at: 'edgeE', d: 0.06, sp: 4, in: 0.35, solo: 1 },
        { p: 'skyFlowerBox', at: 'edgeW', d: 0.06, sp: 4, in: 0.35, solo: 1 },
        { p: 'skyUrn', at: 'edgeN', d: 0.06, sp: 4, in: 0.4, solo: 1 },
        { p: 'skyFlowers', at: 'edge', d: 0.1, in: 0.3 },
        { p: 'skyPetals', at: 'floor', d: 0.05 },
        { p: 'skyPetals', at: 'edge', d: 0.06, in: 0.5 },
        { p: 'skyCrenel', at: 'wallTopN', d: 0.6, h: 0.6, rad: 0.3, solo: 1, rot0: 1, snap: 1, s: [1, 1] },
        { p: 'skyCrenel', at: 'wallTopSide', d: 0.4, h: 0.6, rad: 0.3, solo: 1, s: [1, 1] },
        { p: 'skyPennant', at: 'wallTopN', d: 0.12, sp: 4, h: 2.2, rad: 0.5 },
        { p: 'skyGarden', at: 'wallTop', d: 0.16 },
        { p: 'skyStatue', at: 'wallTopN', d: 0.03, sp: 8, h: 2.6, solo: 1 },
        { p: 'skyFlowers', at: 'pitEdge', d: 0.15, in: 0.35 },
      ],
      solids: { column: 'skyRing', obelisk: 'skyRing' },
      overlay: 'skyTufts',
    },
    mushroom: {
      pal: {
        cap: [0x4e2488, 0x10605e, 0x7a1c5c, 0x26347a], capGlow: [0xc070ff, 0x3affd8, 0xff5ac8, 0x6a9aff], spot: [0xf0c8ff, 0xc8fff0, 0xffd0f0, 0xd0e0ff],
        stem: 0xb8aac8, vine: 0x2a3a4a, berry: [0x5affd8, 0xd07aff, 0xffd060], moss: 0x1e5a5a, mossTop: 0x24504e, dot: [0x5affd8, 0x9a7aff],
        rock: 0x3a3450, stones: [0x3a3450, 0x463e5c, 0x302a42], crystal: 0xb06aff, crystal2: 0x6affe8, stone: 0x3a3450, root: 0x2e2638, bubble: 0xb8ffe8, firefly: 0xc8ff9a,
      },
      mist: { n: 30, c: 0x5a2ab0, i: 0.26, y: 0.3, s: [5, 9] },
      wisps: { c: 0x7affd8, n: 0.35 },
      rules: [
        { p: 'shroomGiant', at: 'void', d: 0.3, sp: 3, h: 5.2, rad: 1.3, y: -0.5 },
        { p: 'shroomStalag', at: 'void', d: 0.22, h: 3.6, rad: 0.7, y: -0.3 },
        { p: 'shroomShelf', at: 'faceN', d: 0.22, sp: 2, solo: 1 },
        { p: 'shroomVines', at: 'faceN', d: 0.25, sp: 2, solo: 1 },
        { p: 'deadRoots', at: 'faceN', d: 0.08, sp: 3, solo: 1 },
        { p: 'shroomShelf', at: 'faceSide', d: 0.16, sp: 2, solo: 1 },
        { p: 'shroomVines', at: 'faceSide', d: 0.12, sp: 2, solo: 1 },
        { p: 'shroomTall', at: 'cornerN', d: 0.55, sp: 4, h: 2.6, in: 0.6, solo: 1 },
        { p: 'crystals', at: 'cornerN', d: 0.4, in: 0.35, solo: 1 },
        { p: 'shroomCluster', at: 'cornerS', d: 0.5, in: 0.4, s: [0.8, 1] },
        { p: 'shroomTall', at: 'edgeN', d: 0.05, sp: 6, h: 2.6, in: 0.5, solo: 1 },
        { p: 'shroomCluster', at: 'edgeN', d: 0.14, sp: 2, in: 0.35 },
        { p: 'shroomCluster', at: 'edge', d: 0.05, in: 0.3 },
        { p: 'crystals', at: 'edge', d: 0.03, sp: 6, in: 0.3, solo: 1 },
        { p: 'shroomMoss', at: 'edge', d: 0.3, in: 0.5 },
        { p: 'rubble', at: 'edge', d: 0.08, in: 0.3 },
        { p: 'shroomMoss', at: 'floor', d: 0.06 },
        { p: 'shroomCluster', at: 'floor', d: 0.015 },
        { p: 'shroomCluster', at: 'wallTop', d: 0.07, h: 0.6 },
        { p: 'shroomStalag', at: 'wallTopN', d: 0.08, sp: 3, h: 2.0, rad: 0.5, s: [0.6, 0.8] },
        { p: 'shroomMoss', at: 'wallTop', d: 0.3 },
        { p: 'rubble', at: 'wallTop', d: 0.1 },
        { p: 'shroomCluster', at: 'pitEdge', d: 0.18, in: 0.35 },
        { p: 'shroomBubbles', at: 'pit', d: 0.25 },
      ],
      solids: { shroom: 'shroomRing', column: 'shroomRing' },
      overlay: 'shroomMossRing',
    },
    pirate: {
      pal: {
        wood: [0x6e4c30, 0x5c3e28, 0x80593a], post: 0x4e3826, iron: 0x3a3a3e, ironDark: 0x222226, rope: 0xb8a070, sack: 0xb8a27a,
        glass: 0xffc860, fire: 0xffa63a, fire2: 0xfff0b0, net: 0x9a8a62, float: [0xd8572a, 0xe8dcc0], kelp: 0x2e5a3a, kelp2: 0x4a6a2e,
        sail: 0xc8c0a8, rock: 0x3a4446, foam: 0xe8f4f6, foam2: 0xb8d4dc, spray: 0xcfeef6, star: [0xe0702a, 0xd84a3a], shell: 0xe8dcc8,
        gold: 0xf0c040, glint: 0xfff6c0, stones: [0x4a5052, 0x5a6062, 0x3e4446],
      },
      mist: { n: 26, c: 0x4a7080, i: 0.22, y: 0.35, s: [5, 9] },
      wisps: { c: 0xcfeef6, n: 0.25 },
      shafts: { c: 0x9ec8d8, i: 0.14, per: 0.3, w: [1.6, 2.4] },
      rules: [
        { p: 'pirateMast', at: 'void', d: 0.1, sp: 5, h: 7.2, rad: 0.9 },
        { p: 'pirateRock', at: 'void', d: 0.16, sp: 2, h: 2.2, rad: 0.9 },
        { p: 'pirateWallLantern', at: 'faceN', d: 0.24, sp: 3, solo: 1, minH: 1.6 },
        { p: 'pirateWallLantern', at: 'faceSide', d: 0.08, sp: 4, solo: 1, minH: 1.6 },
        { p: 'pirateNet', at: 'faceN', d: 0.16, sp: 3, solo: 1 },
        { p: 'pirateNet', at: 'faceSide', d: 0.08, sp: 3, solo: 1 },
        { p: 'pirateLantern', at: 'cornerN', d: 0.5, sp: 5, h: 2.1, in: 0.45, solo: 1 },
        { p: 'pirateCargo', at: 'cornerN', d: 0.55, in: 0.55, solo: 1 },
        { p: 'pirateCargo', at: 'cornerS', d: 0.3, in: 0.5, s: [0.75, 0.9], solo: 1 },
        { p: 'pirateAnchor', at: 'edgeN', d: 0.05, sp: 6, in: 0.3, solo: 1 },
        { p: 'pirateCargo', at: 'edgeN', d: 0.1, sp: 3, in: 0.5, solo: 1 },
        { p: 'pirateLantern', at: 'edgeN', d: 0.07, sp: 5, h: 2.1, in: 0.4, solo: 1 },
        { p: 'pirateCargo', at: 'edgeE', d: 0.05, sp: 4, in: 0.5, solo: 1 },
        { p: 'pirateCargo', at: 'edgeW', d: 0.05, sp: 4, in: 0.5, solo: 1 },
        { p: 'pirateRope', at: 'edge', d: 0.06, in: 0.5 },
        { p: 'pirateShells', at: 'edge', d: 0.08, in: 0.45 },
        { p: 'pirateKelp', at: 'edge', d: 0.06, in: 0.3 },
        { p: 'pirateGold', at: 'cornerS', d: 0.12, in: 0.6 },
        { p: 'pirateShells', at: 'floor', d: 0.03 },
        { p: 'pirateRail', at: 'wallTopN', d: 0.45, h: 0.9, rad: 0.3, solo: 1, rot0: 1, snap: 1, s: [1, 1] },
        { p: 'pirateCannon', at: 'wallTopN', d: 0.05, sp: 6, h: 0.9, solo: 1 },
        { p: 'pirateCargo', at: 'wallTopN', d: 0.04, sp: 5, h: 1.6, s: [0.7, 0.85] },
        { p: 'rubble', at: 'wallTop', d: 0.14 },
        { p: 'pirateKelp', at: 'wallTop', d: 0.12 },
        { p: 'pirateKelp', at: 'pitEdge', d: 0.25, in: 0.3 },
        { p: 'piratePiling', at: 'pit', d: 0.14, sp: 3 },
        { p: 'pirateFoam', at: 'pit', d: 0.5 },
      ],
      solids: { cannon: 'pirateRing', column: 'pirateRing' },
      overlay: 'pirateClutter',
    },
  });
})();
