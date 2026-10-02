// decor-kits-a.js — set-dressing kits for three worlds, registered into decor.js's DPROP / DECOR_KITS:
//   desert (Desert Tomb, golden hour): sandstone tomb ruins, hieroglyph panels, urns, obelisks, jackal statues,
//          braziers, palms and dunes beyond the walls, sand drifts and sand falls, bleached bones
//   lava   (Lava Forge): black basalt, glowing magma veins, furnaces, forge braziers, anvils, crucibles, chains,
//          cooled-lava rubble, crust floating on the magma, obsidian spires, rising embers
//   ice    (Frost Caverns, moonlit night): glowing cyan crystal clusters, icicles, snow drifts, frozen pillars,
//          snowy pines and crystal spires beyond the walls, ice floes, a few warm braziers for contrast
// Purely visual (same placement engine and safety rules as the Crypt / Jungle kits). Loaded right after decor.js.
'use strict';

// ---- shared helpers ----
// wall tiles that already carry a torch / banner (dungeon.js map.deco): face props skip those so they never overlap
const DKA = { map: null, busy: null, q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ'), v: new THREE.Vector3() };
// end point of a box of height h grown from the origin with rotation (rx, ry, rz) — where its tip piece goes
function dkaTip(h, rx, ry, rz) { DKA.q.setFromEuler(DKA.e.set(rx, ry, rz)); return DKA.v.set(0, h, 0).applyQuaternion(DKA.q); }
{
  const _bd = buildDecor;
  buildDecor = function (map, theme, group) {   // eslint-disable-line no-global-assign
    DKA.map = map; DKA.busy = null;
    return _bd(map, theme, group);
  };
}
function dkaFaceBusy(b) {
  const m = DKA.map; if (!m || !m.deco) return false;
  if (!DKA.busy) { DKA.busy = new Set(); for (const d of m.deco) if (d.t === 'torch' || d.t === 'wall') DKA.busy.add(d.j * m.W + d.i); }
  const p = b.wp(0, -0.5, -0.5), i = Math.floor(p.x / TILE), j = Math.floor(p.z / TILE);
  return DKA.busy.has(j * m.W + i);
}
// stacked boxes narrowing from w0 to w1 (spires, icicles, trunks); no overlaps -> no coplanar faces
function dkaTaper(b, c, w0, w1, h, n, x, y, z, o) {
  for (let s = 0; s < n; s++) { const t = s / n, w = w0 + (w1 - w0) * t; b.box(typeof c === 'function' ? c(s) : c, w, h / n, w * (o && o.d ? o.d : 1), x, y + h * t, z, o); }
}
// stepped voxel mound (sand / snow / ash): layers shrinking upward and leaning back toward the wall (-z)
function dkaMound(b, r, cols, w, h, x, y, z, n) {
  n = n || 3;
  const ry = (r() - 0.5) * 0.5, d = 0.55 + r() * 0.25, hh = h / n;
  for (let s = 0; s < n; s++) {
    const ww = w * (1 - s / n * 0.72);
    b.box(djit(cols[s % cols.length], r, 0.04), ww, hh + 0.02, ww * d, x + (r() - 0.5) * w * 0.1, y + s * hh, z - s * w * 0.06, { ry, g: s ? 0.12 : 0.3 });
  }
}

// ======================= Desert Tomb =======================
Object.assign(DPROP, {
  urns(b, r, P) {      // clay jars with gold bands (some tipped over)
    const n = 2 + Math.floor(r() * 3);
    for (let s = 0; s < n; s++) {
      const a = s * 2.1 + r(), d = s ? 0.3 + r() * 0.2 : 0, x = Math.cos(a) * d, z = Math.sin(a) * d * 0.7;
      const w = 0.28 + r() * 0.16, h = w * (1.3 + r() * 0.5), c = djit(dpick(P.clay, r), r, 0.07);
      if (s && r() < 0.25) {   // tipped over, spilling sand
        b.box(c, w, w, h, x, 0, z, { ry: r() * 3, g: 0.3 });
        b.box(P.sand, w * 1.4, 0.06, w * 1.1, x + 0.2, 0, z + 0.25, { ry: r() * 3, g: 0 });
        continue;
      }
      b.box(shade(c, 0.85), w * 0.7, 0.08, w * 0.7, x, 0, z, { g: 0.3 });
      b.box(c, w, h, w, x, 0.08, z, { g: 0.3 });
      b.box(P.gold, w + 0.05, 0.07, w + 0.05, x, 0.08 + h * 0.62, z, { g: 0 });
      b.box(shade(c, 0.9), w * 0.55, 0.14, w * 0.55, x, 0.08 + h, z, { g: 0.1 });
      b.box(shade(c, 1.1), w * 0.72, 0.06, w * 0.72, x, 0.22 + h, z, { g: 0 });
      if (r() < 0.3) b.box(P.lapis, w * 0.35, 0.12, 0.02, x, 0.08 + h * 0.35, z + w / 2 + 0.01, { g: 0 });
    }
  },
  brazierD(b, r, P) {  // sandstone pedestal with a gold fire bowl: warm light spot
    const st = djit(P.stone, r, 0.05), h = 0.95 + r() * 0.2;
    b.box(shade(st, 0.82), 0.82, 0.2, 0.82, 0, 0, 0, { g: 0.3 });
    b.box(st, 0.56, 0.16, 0.56, 0, 0.2, 0, { g: 0.2 });
    b.box(shade(st, 1.06), 0.42, h - 0.36, 0.42, 0, 0.36, 0, { g: 0.3 });
    b.box(P.lapis, 0.44, 0.08, 0.44, 0, 0.36 + (h - 0.36) * 0.6, 0, { g: 0 });
    b.box(P.gold2, 0.62, 0.1, 0.62, 0, h, 0, { g: 0.2 });
    b.box(P.gold, 0.8, 0.18, 0.8, 0, h + 0.1, 0, { g: 0.15 });
    b.box(P.ember, 0.62, 0.05, 0.62, 0, h + 0.27, 0, { e: 1 });
    const y = h + 0.3;
    b.flame(0, y + 0.18, 0, 0.36, 0.44, P.fire, P.fire2); b.flame(0.13, y + 0.1, 0.06, 0.2, 0.28, P.fire, P.fire2); b.flame(-0.12, y + 0.1, -0.06, 0.18, 0.26, P.fire, P.fire2);
    b.glow(0, 0, 0.05, 0.4, 6.8, 6.0, P.fire, 0.45, 0.12);
    b.glow(2, 0, y + 0.3, 0.3, 2.4, 2.4, P.fire, 0.6, 0.18);
    b.light(0, y + 0.8, 0.5, P.fire, 1.7, 11);
    for (let s = 0; s < 3; s++) b.mote(2, (r() - 0.5) * 0.3, y + 0.2, (r() - 0.5) * 0.3, P.fire, 0.11, 1 + r());
  },
  obeliskS(b, r, P) {  // small obelisk: plinth, tapering shaft with glyphs, gold pyramidion
    const st = djit(P.stone, r, 0.05), h = 1.9 + r() * 0.7;
    b.box(shade(st, 0.8), 1.0, 0.22, 1.0, 0, 0, 0, { g: 0.3 });
    b.box(shade(st, 0.9), 0.78, 0.16, 0.78, 0, 0.22, 0, { g: 0.2 });
    dkaTaper(b, st, 0.58, 0.4, h, 4, 0, 0.38, 0, { g: 0.2 });
    b.box(P.gold, 0.34, 0.34, 0.34, 0, 0.38 + h - 0.05, 0, { ry: 0.785, g: 0 });
    for (let s = 0; s < 4; s++) b.box(s === 1 ? P.lapis : P.glyph, 0.14 + r() * 0.08, 0.1, 0.03, (r() - 0.5) * 0.12, 0.7 + s * h * 0.2, 0.3 - s * 0.022, { g: 0 });
    if (r() < 0.5) b.box(P.sand, 0.9, 0.12, 0.6, 0.2, 0, 0.45, { ry: r(), g: 0.2 });
  },
  statueBroken(b, r, P) {   // toppled pharaoh statue: feet on the plinth, fallen head in a nemes headdress
    const st = djit(P.stone, r, 0.05);
    b.box(shade(st, 0.82), 1.2, 0.34, 0.9, 0, 0, 0, { g: 0.3 });
    b.box(st, 0.34, 0.75, 0.42, -0.2, 0.34, 0.05, { g: 0.25 });
    b.box(st, 0.34, 0.55, 0.42, 0.2, 0.34, 0.08, { g: 0.25 });
    b.box(shade(st, 1.08), 0.26, 0.2, 0.14, 0.05, 1.09, 0.1, { rz: 0.5, g: 0 });
    // the head, lying on its side in front
    b.push(0.55, 0, 0.75, -0.6 + r() * 0.4, 1);
    b.box(P.gold, 0.62, 0.5, 0.55, 0, 0, 0, { rz: 0.25, g: 0.2 });
    b.box(P.lapis, 0.64, 0.08, 0.57, 0, 0.14, 0, { rz: 0.25, g: 0 });
    b.box(P.lapis, 0.64, 0.08, 0.57, 0, 0.3, 0, { rz: 0.25, g: 0 });
    b.box(djit(P.stone, r, 0.04), 0.4, 0.4, 0.12, 0.02, 0.04, 0.3, { rz: 0.25, g: 0.1 });
    b.box(P.glyph, 0.08, 0.05, 0.02, -0.06, 0.24, 0.37, { rz: 0.25, g: 0 }); b.box(P.glyph, 0.08, 0.05, 0.02, 0.1, 0.28, 0.37, { rz: 0.25, g: 0 });
    b.pop();
    for (let s = 0; s < 3; s++) b.box(shade(st, 0.9), 0.22 + r() * 0.2, 0.16, 0.22, (r() - 0.5) * 1.4, 0, 0.5 + r() * 0.3, { ry: r() * 3, g: 0.3 });
    b.box(P.sand, 1.3, 0.1, 0.5, -0.1, 0, 0.52, { ry: (r() - 0.5) * 0.3, g: 0 });
  },
  sandPile(b, r, P) { dkaMound(b, r, P.sandCols, 1.3 + r() * 0.5, 0.42 + r() * 0.2, 0, 0, 0.05, 3); },
  sandDrift(b, r, P) { dkaMound(b, r, P.sandCols, 1.2 + r() * 0.6, 0.22 + r() * 0.16, (r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6, 2 + Math.floor(r() * 2)); },
  scarab(b, r, P) {    // little blue-green scarab beetle with a gold head (and a couple of friends)
    const n = 1 + Math.floor(r() * 2);
    for (let s = 0; s < n; s++) {
      b.push((r() - 0.5) * 0.8, 0, (r() - 0.5) * 0.6, r() * 6.28, 1);
      b.box(P.scarab, 0.2, 0.09, 0.26, 0, 0.02, 0, { g: 0.2 });
      b.box(shade(P.scarab, 1.5), 0.04, 0.02, 0.24, 0, 0.11, 0, { g: 0 });
      b.box(P.gold, 0.14, 0.07, 0.08, 0, 0.02, 0.16, { g: 0 });
      for (const sx of [-1, 1]) b.box(P.dark, 0.1, 0.03, 0.03, sx * 0.13, 0, 0.0, { ry: sx * 0.4, g: 0 });
      b.pop();
    }
  },
  reeds(b, r, P) {     // dry reeds / papyrus near the sandy pits
    const n = 5 + Math.floor(r() * 4);
    for (let s = 0; s < n; s++) {
      const x = (r() - 0.5) * 0.7, z = (r() - 0.5) * 0.5, h = 0.6 + r() * 0.7, yaw = r() * 6.28, p = r() * 0.3;
      b.blade(djit(r() < 0.6 ? P.reed : P.reed2, r, 0.1), 0.06, h, 0.06, x, 0, z, yaw, p, { sw: 0.06, g: 0.4 });
      if (r() < 0.5) b.box(P.reedTop, 0.1, 0.16, 0.1, x + Math.sin(yaw) * Math.sin(p) * h, Math.cos(p) * h, z + Math.cos(yaw) * Math.sin(p) * h, { sw: 0.07, sb: 0.06, g: 0 });
    }
    for (let s = 0; s < 3; s++) b.blade(djit(P.frondDry, r, 0.1), 0.18, 0.4 + r() * 0.2, 0.04, (r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.3, r() * 6.28, 1.0 + r() * 0.3, { sw: 0.03, g: 0.3 });
  },
  palm(b, r, P) {      // date palm rising out of the void, crown leaning over the wall toward the room (+z)
    const th = 4.0 + r() * 1.4, base = -2.5, seg = 7, lean = 0.9 + r() * 0.5, bark = djit(P.bark, r, 0.06);
    let x = 0, z = 0;
    for (let s = 0; s < seg; s++) {
      const t = s / seg, h = (th - base) / seg, w = 0.5 - t * 0.14, nz = lean * ((s + 1) / seg) ** 2;
      b.box(s & 1 ? bark : shade(bark, 0.86), w, h, w, x, base + h * s, z, { rx: (nz - z) / h * 0.9, g: 0.15 });
      z = nz;
    }
    const cy = th, cz = z;
    b.box(shade(bark, 0.7), 0.5, 0.35, 0.5, x, cy - 0.1, cz, { g: 0.3 });
    for (let s = 0; s < 3; s++) b.box(P.date, 0.14, 0.2, 0.14, (r() - 0.5) * 0.4, cy - 0.32, cz + (r() - 0.5) * 0.4, { g: 0.2 });
    const n = 7 + Math.floor(r() * 3);
    for (let s = 0; s < n; s++) {
      const yaw = (s / n) * 6.283 + r() * 0.4, L = 1.0 + r() * 0.5, c = djit(r() < 0.2 ? P.frondDry : dpick(P.frond, r), r, 0.08), p1 = 1.0 + r() * 0.3;
      b.blade(c, 0.36, L, 0.05, x, cy + 0.15 + s * 0.012, cz, yaw, p1, { sw: 0.04, sb: 0.01, g: 0.2 });
      const tx = x + Math.sin(yaw) * Math.sin(p1) * L, ty = cy + 0.15 + Math.cos(p1) * L, tz = cz + Math.cos(yaw) * Math.sin(p1) * L;
      b.blade(shade(c, 0.9), 0.3, L * 0.8, 0.045, tx, ty, tz, yaw, p1 + 0.75, { sw: 0.07, sb: 0.04, g: 0.1 });
    }
  },
  glyphPanel(b, r, P) {  // carved hieroglyph panel with gold trim on a wall face (origin = top edge of the face)
    if (dkaFaceBusy(b)) return;
    const H = b.H || 2, y0 = -H + 0.42, ph = Math.max(0.6, Math.min(1.22, H - 0.72)), w = 1.3;
    const st = djit(P.stone2, r, 0.05);
    b.box(shade(st, 0.72), w, ph, 0.05, 0, y0, 0.025, { g: 0 });
    b.box(P.gold, w + 0.14, 0.09, 0.09, 0, y0 + ph, 0.03, { g: 0 });
    b.box(P.gold2, w + 0.1, 0.07, 0.08, 0, y0 - 0.07, 0.03, { g: 0 });
    const cols = 4, rows = ph > 1 ? 3 : 2;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      if (r() < 0.15) continue;
      const gx = -0.46 + col * 0.31, gy = y0 + 0.1 + row * (ph - 0.12) / rows, k = r(), c = k < 0.2 ? P.lapis : k < 0.32 ? P.gold : P.glyph;
      if (k < 0.45) { b.box(c, 0.07, 0.22, 0.03, gx, gy, 0.065, { g: 0 }); b.box(c, 0.13, 0.06, 0.03, gx, gy + 0.18, 0.066, { g: 0 }); }   // standing figure
      else if (k < 0.7) { b.box(c, 0.16, 0.08, 0.03, gx, gy + 0.04, 0.065, { g: 0 }); b.box(c, 0.05, 0.12, 0.03, gx + 0.06, gy + 0.1, 0.066, { g: 0 }); }   // bird
      else if (k < 0.85) { b.box(c, 0.18, 0.05, 0.03, gx, gy + 0.08, 0.065, { g: 0 }); b.box(P.glyph, 0.06, 0.06, 0.03, gx, gy + 0.065, 0.068, { g: 0 }); }  // eye
      else b.box(c, 0.12, 0.12, 0.03, gx, gy + 0.03, 0.065, { rz: 0.785, g: 0 });   // sun disc
    }
    if (r() < 0.35) { b.box(P.gold, 0.14, 0.14, 0.03, 0, y0 + ph - 0.24, 0.07, { rz: 0.785, e: 1 }); b.glow(2, 0, y0 + ph - 0.18, 0.2, 0.8, 0.8, P.gold, 0.22, 0.04); }
  },
  sandfall(b, r, P) {    // sand trickling down a wall face from a crack, piling up at the foot
    if (dkaFaceBusy(b)) return;
    const H = b.H || 2, x = (r() - 0.5) * 0.9;
    b.box(P.glyph, 0.28, 0.12, 0.04, x, -0.32, 0.01, { g: 0 });
    for (let s = 0; s < 4; s++) { const L = (H - 0.4) / 4; b.box(s & 1 ? P.sand : P.sand2, 0.1 - s * 0.012, L, 0.06, x + Math.sin(s) * 0.012, -0.38 - L * (s + 1), 0.07 + s * 0.012, { g: 0, sw: 0.006 * (s + 1), sb: 0.006 * (s + 2) }); }
    dkaMound(b, r, P.sandCols, 1.0, 0.32, x, -H, 0.4, 3);
    b.mote(2, x, -H + 0.2, 0.4, P.sand, 0.1, 0.5);
  },
  jackal(b, r, P) {      // seated black jackal guardian with a gold collar, on a little plinth (wall tops)
    const st = djit(P.stone, r, 0.05), bk = P.jackal;
    b.box(shade(st, 0.85), 0.9, 0.22, 1.0, 0, 0, 0, { g: 0.3 });
    b.box(P.gold, 0.92, 0.06, 1.02, 0, 0.22, 0, { g: 0 });
    b.box(bk, 0.48, 0.32, 0.8, 0, 0.28, -0.05, { g: 0.2 });               // haunches
    b.box(bk, 0.36, 0.62, 0.34, 0, 0.5, 0.16, { rx: -0.12, g: 0.15 });    // chest
    b.box(P.gold, 0.38, 0.08, 0.36, 0, 0.92, 0.2, { rx: -0.12, g: 0 });   // collar
    b.box(bk, 0.3, 0.3, 0.32, 0, 1.0, 0.24, { g: 0.1 });                  // head
    b.box(bk, 0.16, 0.14, 0.24, 0, 1.06, 0.48, { g: 0 });                 // snout
    b.box(bk, 0.08, 0.26, 0.08, -0.1, 1.28, 0.18, { g: 0 }); b.box(bk, 0.08, 0.26, 0.08, 0.1, 1.28, 0.18, { g: 0 });   // ears
    b.box(P.gold, 0.06, 0.04, 0.02, -0.08, 1.15, 0.405, { e: 1 }); b.box(P.gold, 0.06, 0.04, 0.02, 0.08, 1.15, 0.405, { e: 1 });
    b.box(bk, 0.12, 0.42, 0.12, -0.12, 0.28, 0.42, { g: 0.1 }); b.box(bk, 0.12, 0.42, 0.12, 0.12, 0.28, 0.42, { g: 0.1 });   // fore legs
    b.box(bk, 0.1, 0.1, 0.5, 0.2, 0.28, -0.3, { ry: 0.3, g: 0 });          // tail
  },
  dune(b, r, P) {        // big sand dunes beyond the walls (the desert outside the tomb)
    const n = 3 + Math.floor(r() * 2);
    for (let s = 0; s < n; s++) {
      const w = 1.6 + r() * 1.4, h = 0.5 + r() * 0.8 + s * 0.04;
      b.box(djit(dpick(P.sandCols, r), r, 0.05), w, h + 0.5, w * (0.6 + r() * 0.4), (r() - 0.5) * 1.6, -0.5, (r() - 0.5) * 1.4, { ry: r() * 3, g: 0.2 });
    }
    if (r() < 0.4) b.box(djit(P.stone2, r, 0.05), 0.6, 0.5, 0.5, (r() - 0.5), 0.2, (r() - 0.5), { ry: r() * 3, rz: 0.3, g: 0.2 });
  },
  sandColumn(b, r, P) {  // tall ruined sandstone column out of the void, gold-capped (silhouette behind the walls)
    const st = djit(P.stone, r, 0.06), h = 3.2 + r() * 2.6;
    b.box(shade(st, 0.85), 1.2, 0.5, 1.2, 0, -0.3, 0, { g: 0.3 });
    for (let s = 0; s < 3; s++) b.box(s & 1 ? shade(st, 0.92) : st, 0.86 - s * 0.03, h / 3, 0.86 - s * 0.03, 0, 0.2 + s * h / 3, 0, { ry: s * 0.12, g: 0.25 });
    b.box(P.lapis, 0.9, 0.12, 0.9, 0, 0.2 + h * 0.62, 0, { g: 0 });
    if (r() < 0.65) { b.box(shade(st, 1.1), 1.24, 0.28, 1.24, 0, 0.2 + h, 0, { g: 0 }); b.box(P.gold, 0.9, 0.16, 0.9, 0, 0.48 + h, 0, { g: 0 }); }
    else b.box(shade(st, 1.06), 0.7, 0.4, 0.6, 0.15, 0.2 + h, 0.05, { rz: 0.4, g: 0 });
    if (r() < 0.35) { b.flame(0, 0.72 + h, 0, 0.22, 0.34, P.fire, P.fire2); b.glow(2, 0, 0.8 + h, 0.2, 2.2, 2.2, P.fire, 0.45, 0.12); }
  },
  goldPile(b, r, P) {    // a little treasure heap: coins, an ingot, a jewelled cup
    dkaMound(b, r, [P.gold, P.gold2, P.gold], 0.7, 0.18, 0, 0, 0, 3);
    for (let s = 0; s < 6; s++) b.box(r() < 0.5 ? P.gold : P.gold2, 0.12, 0.03, 0.12, (r() - 0.5) * 0.9, 0, (r() - 0.5) * 0.6, { ry: r() * 3, g: 0 });
    b.box(P.gold, 0.3, 0.1, 0.16, 0.3, 0, 0.15, { ry: r(), g: 0.1 });
    if (r() < 0.6) { b.box(P.gold, 0.14, 0.22, 0.14, -0.25, 0, 0.1, { g: 0.1 }); b.box(P.lapis, 0.06, 0.06, 0.02, -0.25, 0.12, 0.18, { g: 0 }); }
    b.box(P.gold, 0.06, 0.06, 0.06, 0.05, 0.22, 0.02, { e: 1 });
    b.glow(0, 0, 0.04, 0, 1.8, 1.8, P.gold, 0.2, 0.05);
  },
  columnDressD(b, r, P) {  // dungeon.js column (0.9 shaft, 1.3 base / capital): gold + lapis bands, glyph strip, sand at the foot
    b.box(P.gold, 0.97, 0.1, 0.97, 0, 2.28, 0, { g: 0 });
    b.box(P.lapis, 0.95, 0.16, 0.95, 0, 2.1, 0, { g: 0 });
    b.box(P.gold2, 0.96, 0.08, 0.96, 0, 0.62, 0, { g: 0 });
    for (let s = 0; s < 4; s++) b.box(s === 2 ? P.lapis : P.glyph, 0.12 + r() * 0.1, 0.12, 0.03, (r() - 0.5) * 0.3, 0.85 + s * 0.3, 0.465, { g: 0 });
    dkaMound(b, r, P.sandCols, 1.4, 0.36, 0.2, 0, 0.75, 3);
  },
  bonesD(b, r, P) { DPROP.bones(b, r, P); if (r() < 0.4) b.box(P.sand, 0.9, 0.06, 0.6, (r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.3, { ry: r() * 3, g: 0 }); },
  urnRing(b, r, P) {     // around obelisks / floor props: sand, an urn or two, a reed tuft
    for (let s = 0; s < 3; s++) { const a = r() * 6.283, d = 0.85; b.push(Math.cos(a) * d, 0, Math.sin(a) * d, r() * 3, 0.7); (s === 0 ? DPROP.urns : s === 1 ? DPROP.sandDrift : DPROP.rubble)(b, r, P); b.pop(); }
  },
});

// ======================= Lava Forge =======================
Object.assign(DPROP, {
  forgeBrazier(b, r, P) {   // iron fire basket on a basalt block: strong orange light spot
    const st = djit(P.basalt, r, 0.06), h = 0.75 + r() * 0.2;
    b.box(shade(st, 0.85), 0.8, 0.26, 0.8, 0, 0, 0, { g: 0.3 });
    b.box(st, 0.54, h - 0.26, 0.54, 0, 0.26, 0, { g: 0.3 });
    b.box(P.magma, 0.04, h * 0.6, 0.02, 0.12, 0.3, 0.28, { rz: 0.3, e: 1 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(P.iron, 0.08, 0.5, 0.08, sx * 0.3, h, sz * 0.3, { rx: -sz * 0.25, rz: sx * 0.25, g: 0 });
    b.box(P.iron, 0.86, 0.12, 0.86, 0, h + 0.42, 0, { g: 0.2 });
    b.box(P.hot, 0.66, 0.06, 0.66, 0, h + 0.5, 0, { e: 1 });
    const y = h + 0.55;
    b.flame(0, y + 0.2, 0, 0.4, 0.5, P.fire, P.fire2); b.flame(0.14, y + 0.12, 0.08, 0.22, 0.32, P.fire, P.fire2); b.flame(-0.14, y + 0.1, -0.06, 0.2, 0.28, P.fire, P.fire2);
    b.glow(0, 0, 0.05, 0.4, 7.0, 6.4, P.fire, 0.5, 0.12);
    b.glow(2, 0, y + 0.3, 0.3, 2.6, 2.6, P.fire, 0.65, 0.18);
    b.light(0, y + 0.8, 0.5, P.fire, 1.9, 11);
    for (let s = 0; s < 4; s++) b.mote(2, (r() - 0.5) * 0.4, y + 0.2, (r() - 0.5) * 0.4, s & 1 ? P.fire : P.hot, 0.1, 1 + r());
  },
  anvilF(b, r, P) {      // anvil on a basalt stump, a hammer, and a glowing ingot cooling on top
    const st = djit(P.basalt, r, 0.06);
    b.box(shade(st, 0.9), 0.75, 0.5, 0.65, 0, 0, 0, { g: 0.3 });
    b.box(P.iron, 0.4, 0.22, 0.36, 0, 0.5, 0, { g: 0.2 });
    b.box(P.iron2, 0.95, 0.24, 0.42, 0, 0.72, 0, { g: 0.1 });
    b.box(P.iron2, 0.3, 0.14, 0.24, 0.6, 0.8, 0, { g: 0 });
    b.box(P.hot, 0.34, 0.06, 0.14, -0.12, 0.96, 0.02, { ry: 0.3, e: 1 });
    b.glow(2, -0.1, 1.05, 0.2, 0.9, 0.6, P.magma, 0.4, 0.08);
    b.box(P.wood, 0.07, 0.07, 0.7, 0.45, 0, 0.55, { ry: 0.8, g: 0 });
    b.box(P.iron, 0.24, 0.16, 0.14, 0.2, 0, 0.8, { ry: 0.8, g: 0.1 });
    if (r() < 0.6) b.light(0, 1.2, 0.5, P.magma, 0.9, 6);
  },
  magmaVein(b, r, P) {   // glowing cracks running down a wall face (origin = top edge of the face)
    if (dkaFaceBusy(b)) return;
    const H = b.H || 2, n = 1 + Math.floor(r() * 2);
    for (let v = 0; v < n; v++) {
      let x = (r() - 0.5) * 1.2, y = -0.1 - r() * 0.3;
      const seg = 3 + Math.floor(r() * 3);
      for (let s = 0; s < seg && y > -H + 0.2; s++) {
        const L = 0.25 + r() * 0.35, a = (r() - 0.5) * 1.1;
        b.box(s & 1 ? P.magma : P.magma2, 0.07 + r() * 0.04, L, 0.03, x, y - L, 0.02, { rz: a, e: 1 });
        x += Math.sin(a) * L; y -= Math.cos(a) * L;
      }
    }
    b.glow(1, 0, -H * 0.55, 0.05, 2.2, 2.0, P.magma, 0.34, 0.06);
    b.glow(0, 0, -H + 0.04, 0.6, 2.4, 1.6, P.magma, 0.22, 0.05);
    if (r() < 0.5) b.mote(2, 0, -H + 0.3, 0.3, P.ember, 0.1, 0.8);
  },
  furnace(b, r, P) {     // forge furnace mouth set into the wall: basalt arch, iron grate, roaring glow
    if (dkaFaceBusy(b)) return;
    const H = b.H || 2, y0 = -H, st = djit(P.basalt, r, 0.06), mh = Math.min(1.0, H - 0.7);
    b.box(shade(st, 1.1), 1.5, mh + 0.5, 0.3, 0, y0, 0.12, { g: 0.2 });
    b.box(P.hot, 0.8, mh - 0.1, 0.04, 0, y0 + 0.15, 0.29, { e: 1 });
    b.box(P.magma, 0.95, 0.1, 0.06, 0, y0 + 0.08, 0.3, { e: 1 });
    for (let s = 0; s < 5; s++) b.box(P.iron, 0.07, mh, 0.07, -0.36 + s * 0.18, y0 + 0.1, 0.34, { g: 0 });
    b.box(P.iron, 1.0, 0.1, 0.1, 0, y0 + 0.1 + mh - 0.1, 0.34, { g: 0 });
    b.box(shade(st, 1.2), 1.7, 0.18, 0.4, 0, y0 + mh + 0.5, 0.15, { g: 0 });
    b.flame(0, y0 + 0.35, 0.22, 0.6, 0.45, P.fire, P.fire2);
    b.glow(0, 0, y0 + 0.05, 1.2, 4.2, 3.2, P.fire, 0.5, 0.14);
    b.glow(1, 0, y0 + 0.6, 0.4, 2.2, 1.6, P.fire, 0.45, 0.14);
    b.light(0, y0 + 1.2, 1.0, P.fire, 1.8, 10);
    for (let s = 0; s < 3; s++) b.mote(2, (r() - 0.5) * 0.6, y0 + 0.6, 0.4, P.ember, 0.1, 0.8 + r());
  },
  coolRubble(b, r, P) {  // cooled lava chunks, still glowing in the cracks
    const n = 3 + Math.floor(r() * 3);
    for (let s = 0; s < n; s++) {
      const w = 0.24 + r() * 0.4, x = (r() - 0.5) * 1.1, z = (r() - 0.5) * 0.6;
      b.box(djit(dpick(P.stones, r), r, 0.1), w, w * (0.5 + r() * 0.5), w * (0.7 + r() * 0.5), x, 0, z, { ry: r() * 3, g: 0.35 });
    }
    if (r() < 0.85) {   // still-molten seams between the chunks
      for (let s = 0; s < 2; s++) b.box(s ? P.magma2 : P.magma, 0.4 + r() * 0.3, 0.03, 0.06, (r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.35, { ry: r() * 3, e: 1 });
      b.glow(0, 0, 0.04, 0, 2.2, 2.0, P.magma, 0.3, 0.06);
    }
  },
  ashPile(b, r, P) { dkaMound(b, r, P.ashCols, 0.9 + r() * 0.5, 0.22 + r() * 0.14, 0, 0, 0, 3); if (r() < 0.5) b.box(P.hot, 0.08, 0.04, 0.08, (r() - 0.5) * 0.3, 0.1, (r() - 0.5) * 0.2, { e: 1 }); },
  crust(b, r, P) {       // dark crust plates floating on the magma
    const n = 2 + Math.floor(r() * 3);
    for (let s = 0; s < n; s++) { const w = 0.4 + r() * 0.6; b.box(djit(dpick(P.stones, r), r, 0.1), w, 0.08 + s * 0.02, w * (0.6 + r() * 0.4), (r() - 0.5) * 1.4, -0.03, (r() - 0.5) * 1.4, { ry: r() * 3, g: 0.2 }); }
    if (r() < 0.5) b.mote(2, 0, 0.1, 0, P.ember, 0.12, 0.7 + r() * 0.6);
  },
  obsidianSpire(b, r, P) {   // jagged black spires with magma veins beyond the walls
    const n = 1 + Math.floor(r() * 2);
    for (let s = 0; s < n; s++) {
      const h = 3.2 + r() * 2.8, w = 0.9 + r() * 0.4, x = s ? (r() - 0.5) * 1.6 : 0, z = s ? (r() - 0.5) * 1.2 : 0, lean = (r() - 0.5) * 0.25;
      dkaTaper(b, k => k & 1 ? P.basalt : P.basalt2, w, w * 0.25, h, 5, x, -2.5, z, { rz: lean, g: 0.15 });
      b.box(P.magma, 0.06, h * 0.5, 0.03, x + 0.1, -0.5, z + w * 0.36, { rz: lean + 0.15, e: 1 });
    }
    b.glow(0, 0, 0.0, 0.5, 3.6, 3.6, P.magma, 0.22, 0.06);
  },
  crucible(b, r, P) {    // big iron crucible full of molten metal
    const h = 0.55 + r() * 0.15;
    b.box(shade(P.basalt, 0.9), 0.95, 0.16, 0.95, 0, 0, 0, { g: 0.3 });
    b.box(P.iron, 0.8, h, 0.8, 0, 0.16, 0, { g: 0.25 });
    b.box(P.iron2, 0.9, 0.1, 0.9, 0, 0.16 + h, 0, { g: 0 });
    b.box(P.hot, 0.66, 0.04, 0.66, 0, 0.2 + h, 0, { e: 1 });
    b.box(P.iron, 0.08, 0.08, 0.3, 0.46, 0.16 + h * 0.6, 0, { g: 0 }); b.box(P.iron, 0.08, 0.08, 0.3, -0.46, 0.16 + h * 0.6, 0, { g: 0 });
    b.box(P.magma, 0.12, 0.3, 0.04, 0.2, 0.16 + h - 0.26, 0.415, { e: 1 });
    b.glow(0, 0, 0.05, 0.2, 4.5, 4.5, P.magma, 0.4, 0.08);
    b.glow(2, 0, 0.5 + h, 0, 1.8, 1.4, P.hot, 0.45, 0.1);
    b.light(0, 1.4, 0.4, P.magma, 1.4, 9);
    for (let s = 0; s < 2; s++) b.mote(2, (r() - 0.5) * 0.4, 0.3 + h, (r() - 0.5) * 0.4, P.hot, 0.1, 0.8 + r());
  },
  weaponRack(b, r, P) {  // forged weapons leaning in a rack against the wall
    b.box(P.wood, 1.3, 0.1, 0.12, 0, 0.75, -0.05, { g: 0 });
    b.box(P.wood, 0.1, 0.9, 0.1, -0.6, 0, -0.08, { g: 0.2 }); b.box(P.wood, 0.1, 0.9, 0.1, 0.6, 0, -0.08, { g: 0.2 });
    for (let s = 0; s < 4; s++) {
      if (r() < 0.2) continue;
      const x = -0.42 + s * 0.28, kind = r();
      b.box(P.steel, 0.08, 0.95, 0.03, x, 0.05, 0.08, { rx: -0.12, g: 0 });
      b.box(kind < 0.5 ? P.gold : P.iron2, 0.24, 0.05, 0.06, x, 0.3, 0.06, { rx: -0.12, g: 0 });
      if (kind > 0.6) b.box(P.steel, 0.26, 0.22, 0.03, x + 0.08, 0.8, 0.0, { rx: -0.12, g: 0 });
    }
  },
  ironSpikes(b, r, P) {  // iron stakes along a wall top
    for (let s = 0; s < 5; s++) {
      if (r() < 0.15) continue;
      const x = -0.8 + s * 0.4, h = 0.5 + r() * 0.35;
      b.box(P.iron, 0.1, h, 0.1, x, 0, 0, { rz: (r() - 0.5) * 0.15, g: 0.1 });
      b.box(P.iron2, 0.13, 0.13, 0.13, x, h, 0, { ry: 0.785, rx: 0.6, g: 0 });
    }
    b.box(P.iron, 2.0, 0.07, 0.07, 0, 0.22, 0, { g: 0 });
  },
  columnDressL(b, r, P) {  // dungeon.js column: magma veins up the shaft, a chain wrap, ash at the foot
    for (let s = 0; s < 3; s++) b.box(s & 1 ? P.magma2 : P.magma, 0.06, 0.5 + r() * 0.3, 0.03, -0.15 + s * 0.14, 0.4 + s * 0.6, 0.465, { rz: (r() - 0.5) * 0.8, e: 1 });
    b.box(P.iron, 0.96, 0.1, 0.96, 0, 1.7, 0, { g: 0 });
    b.glow(1, 0, 1.1, 0.5, 1.4, 2.2, P.magma, 0.28, 0.06);
    dkaMound(b, r, P.ashCols, 1.2, 0.26, -0.3, 0, 0.75, 2);
    DPROP.coolRubble(b, r, P);
  },
  emberRing(b, r, P) { for (let s = 0; s < 3; s++) { const a = r() * 6.283; b.push(Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8, r() * 3, 0.75); (s ? DPROP.coolRubble : DPROP.ashPile)(b, r, P); b.pop(); } },
});

// ======================= Frost Caverns =======================
Object.assign(DPROP, {
  iceCrystals(b, r, P) {     // glowing cyan crystal cluster: light spot + drifting sparkles
    const n = 4 + Math.floor(r() * 3);
    b.box(djit(P.stone2, r, 0.06), 0.8, 0.14, 0.7, 0, 0, 0, { g: 0.3 });
    b.box(P.snow, 0.9, 0.06, 0.5, 0.05, 0, 0.22, { ry: r(), g: 0 });
    for (let s = 0; s < n; s++) {
      const h = (s ? 0.35 + r() * 0.6 : 0.9 + r() * 0.5), w = 0.12 + r() * 0.12, c = s % 3 === 0 ? P.crystal : s % 3 === 1 ? P.crystal2 : P.crystal3;
      const x = s ? (r() - 0.5) * 0.6 : 0, z = s ? (r() - 0.5) * 0.45 : 0, rx = s ? (r() - 0.5) * 0.9 : (r() - 0.5) * 0.2, rz = s ? (r() - 0.5) * 0.9 : (r() - 0.5) * 0.2, ry = r() * 3;
      b.box(c, w, h * 0.75, w, x, 0.06, z, { rx, rz, ry, e: 1 });
      // tip: a narrower box continuing along the same axis
      const t = dkaTip(h * 0.75, rx, ry, rz);
      b.box(shade(c, 1.15), w * 0.55, h * 0.25, w * 0.55, x + t.x, 0.06 + t.y, z + t.z, { rx, rz, ry, e: 1 });
    }
    b.glow(0, 0, 0.05, 0.1, 4.2, 4.2, P.crystal, 0.42, 0.03);
    b.glow(2, 0, 0.7, 0.2, 2.0, 2.0, P.crystal, 0.4, 0.04);
    if (r() < 0.7) b.light(0, 1.1, 0.4, P.crystal, 1.3, 9);
    for (let s = 0; s < 2; s++) b.mote(0, (r() - 0.5) * 0.6, 0.5 + r() * 0.5, (r() - 0.5) * 0.4, s ? P.crystal2 : P.crystal, 0.1, 0.5 + r() * 0.3);
  },
  icicles(b, r, P) {     // icicles hanging from the top edge of a wall face
    if (dkaFaceBusy(b)) return;
    const H = b.H || 2, n = 4 + Math.floor(r() * 4);
    for (let s = 0; s < n; s++) {
      const x = -0.85 + (s + r() * 0.6) * (1.7 / n), L = Math.min(H - 0.5, 0.3 + r() * 0.9), w = 0.1 + r() * 0.08, c = r() < 0.5 ? P.ice : P.ice2;
      b.box(c, w, L * 0.45, w, x, -L * 0.45 - 0.02, 0.14, { g: 0 });
      b.box(shade(c, 1.08), w * 0.66, L * 0.35, w * 0.66, x, -L * 0.8 - 0.02, 0.14, { g: 0 });
      b.box(shade(c, 1.16), w * 0.34, L * 0.2, w * 0.34, x, -L - 0.02, 0.14, { g: 0 });
    }
    if (r() < 0.4) { b.box(P.crystal2, 0.06, 0.12, 0.06, (r() - 0.5) * 1.2, -0.5, 0.17, { e: 1 }); }
  },
  snowDrift(b, r, P) { dkaMound(b, r, P.snowCols, 1.2 + r() * 0.6, 0.42 + r() * 0.24, 0, 0, 0.05, 2); if (r() < 0.3) b.box(P.ice, 0.3, 0.3, 0.3, (r() - 0.5) * 0.8, 0, (r() - 0.5) * 0.4, { ry: r() * 3, rz: 0.3, g: 0.2 }); },
  snowTop(b, r, P) { dkaMound(b, r, P.snowCols, 1.1 + r() * 0.7, 0.24 + r() * 0.16, (r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6, 2); },
  frozenPillar(b, r, P) {    // broken stone column sheathed in ice, snow on top
    const st = djit(P.stone, r, 0.06), h = 1.3 + r() * 1.2;
    b.box(shade(st, 0.85), 1.0, 0.25, 1.0, 0, 0, 0, { g: 0.3 });
    b.box(st, 0.66, h, 0.66, 0, 0.25, 0, { g: 0.3 });
    b.box(P.ice, 0.78, h * 0.55, 0.78, 0, 0.25, 0, { g: 0.15 });
    b.box(P.ice2, 0.84, h * 0.22, 0.84, 0.0, 0.25 + h * 0.12, 0, { ry: 0.2, g: 0.1 });
    b.box(P.snow, 0.74, 0.14, 0.74, 0, 0.25 + h, 0, { g: 0 });
    b.box(P.snow, 0.5, 0.1, 0.42, 0.05, 0.39 + h, 0.02, { g: 0 });
    for (let s = 0; s < 3; s++) b.box(P.ice, 0.08, 0.3 + r() * 0.3, 0.08, (r() - 0.5) * 0.5, 0.25 + h - 0.5, 0.36, { g: 0 });
    b.box(P.snow, 1.1, 0.12, 0.6, 0.1, 0, 0.45, { ry: r(), g: 0 });
  },
  pine(b, r, P) {        // snowy pine rising out of the void
    const th = 3.6 + r() * 1.4, base = -2.5, bark = djit(P.bark, r, 0.06);
    b.box(bark, 0.4, th - base - 1.2, 0.4, 0, base, 0, { g: 0.4 });
    const tiers = 4;
    for (let t = 0; t < tiers; t++) {
      const w = 2.4 - t * 0.5, y = th - 2.6 + t * 0.78, c = djit(dpick(P.pine, r), r, 0.06);
      b.box(c, w, 0.62, w, 0, y, 0, { ry: t * 0.4, g: 0.35 });
      b.box(P.snow, w * 0.8, 0.12, w * 0.8, 0.04, y + 0.62, 0.02, { ry: t * 0.4 + 0.1, g: 0 });
    }
    b.box(P.snow, 0.3, 0.3, 0.3, 0, th + 0.6, 0, { g: 0 });
  },
  iceSpire(b, r, P) {    // tall glowing crystal spires beyond the walls (strong silhouettes + cold light)
    const n = 2 + Math.floor(r() * 2);
    for (let s = 0; s < n; s++) {
      const h = (s ? 1.6 + r() * 1.6 : 3.4 + r() * 2.2), w = s ? 0.35 + r() * 0.25 : 0.6 + r() * 0.3, x = s ? (r() - 0.5) * 1.4 : 0, z = s ? (r() - 0.5) * 1.0 : 0;
      const rz = (r() - 0.5) * 0.35, rx = (r() - 0.5) * 0.35, c = s & 1 ? P.crystal3 : P.crystal;
      const ry = r() * 3, t = dkaTip(h * 0.7, rx, ry, rz);
      b.box(c, w, h * 0.7, w, x, -1.2, z, { rx, rz, ry, e: 1 });
      b.box(P.crystal2, w * 0.5, h * 0.3, w * 0.5, x + t.x, -1.2 + t.y, z + t.z, { rx, rz, ry, e: 1 });
    }
    b.box(djit(P.stone2, r, 0.06), 1.6, 1.4, 1.3, 0, -1.4, 0, { ry: r(), g: 0.3 });
    b.glow(2, 0, 1.6, 0.4, 3.0, 3.6, P.crystal, 0.3, 0.03);
    b.light(0, 2.0, 1.0, P.crystal, 1.2, 10);
    b.mote(0, 0, 1.5, 0.5, P.crystal2, 0.12, 0.4);
  },
  iceFloe(b, r, P) {     // flat ice plates drifting on the dark water
    const n = 2 + Math.floor(r() * 3);
    for (let s = 0; s < n; s++) { const w = 0.4 + r() * 0.7; b.box(djit(r() < 0.5 ? P.snow : P.ice, r, 0.05), w, 0.08 + s * 0.02, w * (0.6 + r() * 0.4), (r() - 0.5) * 1.4, -0.02, (r() - 0.5) * 1.4, { ry: r() * 3, g: 0.1 }); }
  },
  columnDressI(b, r, P) {  // dungeon.js column: ice sheath, snow on the capital, icicles, a drift at the foot
    b.box(P.ice, 1.0, 1.1, 1.0, 0, 0.3, 0, { g: 0.15 });
    b.box(P.ice2, 1.06, 0.3, 1.06, 0, 0.3, 0, { ry: 0.15, g: 0.1 });
    b.box(P.snow, 1.36, 0.14, 1.36, 0, 2.95, 0, { g: 0 });
    for (let s = 0; s < 4; s++) b.box(P.ice, 0.09, 0.25 + r() * 0.3, 0.09, -0.5 + s * 0.33, 2.65 - 0.3, 0.6, { g: 0 });
    dkaMound(b, r, P.snowCols, 1.4, 0.4, 0.2, 0, 0.75, 3);
  },
  frozenBones(b, r, P) { DPROP.bones(b, r, P); b.box(P.snow, 0.8, 0.05, 0.5, (r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3, { ry: r() * 3, g: 0 }); },
  snowRing(b, r, P) { for (let s = 0; s < 3; s++) { const a = r() * 6.283; b.push(Math.cos(a) * 0.85, 0, Math.sin(a) * 0.85, r() * 3, 0.7); (s === 0 && r() < 0.6 ? DPROP.iceCrystals : DPROP.snowDrift)(b, r, P); b.pop(); } },
});

// tall props cast shadows (the rest only receive: keeps the shadow pass cheap)
for (const n of ['brazierD', 'obeliskS', 'statueBroken', 'palm', 'jackal', 'sandColumn', 'forgeBrazier', 'anvilF', 'obsidianSpire', 'crucible', 'frozenPillar', 'pine']) DECOR_CAST.add(n);

Object.assign(DECOR_KITS, {
  desert: {
    pal: {
      sand: 0xe6c48a, sand2: 0xd6ae70, sandCols: [0xe6c48a, 0xdcb678, 0xd0a868], stone: 0xd2ae74, stone2: 0xb08a56,
      stones: [0xc8a066, 0xb48e58, 0xdab884], gold: 0xffc23a, gold2: 0xd8941c, lapis: 0x2457c5, glyph: 0x5a3a1e,
      clay: [0xb8683a, 0xa45a30, 0xc87a44], bone: 0xf4ead0, bone2: 0xd8caa4, fire: 0xffa23a, fire2: 0xfff0b8, ember: 0xff8a2a,
      frond: [0x5e8a2a, 0x6e9a30, 0x4e7a24], frondDry: 0xb89a4a, bark: 0x8a6840, date: 0x7a3a1a, reed: 0xc8b060, reed2: 0x9a9a40,
      reedTop: 0x8a6a30, scarab: 0x1f6a6a, dark: 0x2a1a10, jackal: 0x24201e, iron: 0x3a2a1e,
    },
    mist: { n: 20, c: 0xffb070, i: 0.16, y: 0.3, s: [6, 10] },
    shafts: { c: 0xffd08a, i: 0.36, per: 0.6, w: [2.0, 3.2] },
    wisps: { c: 0xffd8a0, n: 0.25 },                     // sand dust lifting out of the sinkholes
    rules: [
      { p: 'palm', at: 'void', d: 0.16, sp: 3, h: 6.2, rad: 1.3, fwd: 0.3 },
      { p: 'sandColumn', at: 'void', d: 0.07, sp: 5, h: 6, rad: 0.7 },
      { p: 'dune', at: 'void', d: 0.4, h: 1.4, rad: 1.2 },
      { p: 'glyphPanel', at: 'faceN', d: 0.26, sp: 2, solo: 1, minH: 1.7 },
      { p: 'sandfall', at: 'faceN', d: 0.06, sp: 5, solo: 1 },
      { p: 'brazierD', at: 'cornerN', d: 0.45, sp: 5, h: 2.6, in: 0.5, solo: 1 },
      { p: 'obeliskS', at: 'cornerN', d: 0.28, sp: 5, h: 3.0, in: 0.55, solo: 1 },
      { p: 'statueBroken', at: 'cornerN', d: 0.22, sp: 6, h: 1.6, in: 0.6, solo: 1 },
      { p: 'brazierD', at: 'edgeN', d: 0.03, sp: 6, h: 2.6, in: 0.45, solo: 1 },
      { p: 'urns', at: 'cornerN', d: 0.6, in: 0.4, solo: 1 },
      { p: 'urns', at: 'cornerS', d: 0.3, in: 0.35, s: [0.7, 0.85], solo: 1 },
      { p: 'goldPile', at: 'cornerN', d: 0.12, sp: 6, in: 0.45, solo: 1 },
      { p: 'urns', at: 'edgeN', d: 0.1, sp: 3, in: 0.35, solo: 1 },
      { p: 'sandPile', at: 'edgeN', d: 0.22, in: 0.05 },
      { p: 'sandPile', at: 'edgeE', d: 0.12, in: 0.05, s: [0.7, 0.9] },
      { p: 'sandPile', at: 'edgeW', d: 0.12, in: 0.05, s: [0.7, 0.9] },
      { p: 'sandPile', at: 'cornerS', d: 0.35, in: 0.3, s: [0.7, 0.9] },
      { p: 'reeds', at: 'cornerN', d: 0.25, in: 0.35 },
      { p: 'rubble', at: 'edge', d: 0.12, in: 0.3 },
      { p: 'bonesD', at: 'edge', d: 0.06, in: 0.45 },
      { p: 'scarab', at: 'floor', d: 0.012 },
      { p: 'bonesD', at: 'floor', d: 0.015 },
      { p: 'sandDrift', at: 'floor', d: 0.03 },
      { p: 'jackal', at: 'wallTopN', d: 0.05, sp: 6, h: 1.5, solo: 1 },
      { p: 'obeliskS', at: 'wallTopN', d: 0.025, sp: 7, h: 3.0, solo: 1, s: [0.7, 0.8] },
      { p: 'brazierD', at: 'wallTopN', d: 0.03, sp: 6, h: 2.0, solo: 1, s: [0.7, 0.8] },
      { p: 'urns', at: 'wallTopN', d: 0.06, h: 0.8 },
      { p: 'sandDrift', at: 'wallTop', d: 0.5 },
      { p: 'rubble', at: 'wallTop', d: 0.15 },
      { p: 'reeds', at: 'wallTopSide', d: 0.08 },
      { p: 'bonesD', at: 'wallTop', d: 0.04 },
      { p: 'reeds', at: 'pitEdge', d: 0.3, in: 0.35 },
      { p: 'sandPile', at: 'pitEdge', d: 0.2, in: 0.3, s: [0.6, 0.8] },
    ],
    solids: { obelisk: 'urnRing', column: 'columnDressD' },
    overlay: 'urnRing',
  },
  lava: {
    pal: {
      basalt: 0x2a2326, basalt2: 0x1c1719, stones: [0x2e2628, 0x3a3030, 0x231d1f], ashCols: [0x4a4446, 0x3e393a, 0x565052],
      iron: 0x34343a, iron2: 0x4e4e56, steel: 0x8a8c96, wood: 0x4a3020, gold: 0xffb030, bone: 0x8a8078, bone2: 0x6a625a,
      magma: 0xff5a10, magma2: 0xff8a1a, hot: 0xffc040, fire: 0xff8a2a, fire2: 0xffe2a0, ember: 0xff7a1a,
    },
    mist: { n: 18, c: 0xff5a1a, i: 0.1, y: 0.3, s: [6, 10] },
    wisps: { c: 0xff8a2a, n: 0.4 },                      // embers rising off the magma
    rules: [
      { p: 'obsidianSpire', at: 'void', d: 0.2, sp: 3, h: 4, rad: 0.9 },
      { p: 'furnace', at: 'faceN', d: 0.09, sp: 5, solo: 1, minH: 1.7 },
      { p: 'magmaVein', at: 'faceN', d: 0.22, sp: 2, solo: 1 },
      { p: 'chains', at: 'faceN', d: 0.14, sp: 2, solo: 1 },
      { p: 'magmaVein', at: 'faceSide', d: 0.1, sp: 3, solo: 1 },
      { p: 'forgeBrazier', at: 'cornerN', d: 0.45, sp: 5, h: 2.4, in: 0.5, solo: 1 },
      { p: 'anvilF', at: 'cornerN', d: 0.3, sp: 5, h: 1.3, in: 0.6, solo: 1 },
      { p: 'crucible', at: 'cornerN', d: 0.25, sp: 6, h: 1.0, in: 0.55, solo: 1 },
      { p: 'forgeBrazier', at: 'edgeN', d: 0.035, sp: 6, h: 2.4, in: 0.45, solo: 1 },
      { p: 'forgeBrazier', at: 'edgeE', d: 0.02, sp: 7, h: 2.4, in: 0.45, solo: 1, s: [0.8, 0.9] },
      { p: 'forgeBrazier', at: 'edgeW', d: 0.02, sp: 7, h: 2.4, in: 0.45, solo: 1, s: [0.8, 0.9] },
      { p: 'weaponRack', at: 'edgeN', d: 0.06, sp: 5, in: 0.25, solo: 1 },
      { p: 'coolRubble', at: 'cornerN', d: 0.5, in: 0.35 },
      { p: 'coolRubble', at: 'cornerS', d: 0.35, in: 0.3, s: [0.7, 0.9] },
      { p: 'coolRubble', at: 'edge', d: 0.14, in: 0.3 },
      { p: 'ashPile', at: 'edge', d: 0.1, in: 0.2 },
      { p: 'ashPile', at: 'floor', d: 0.02 },
      { p: 'coolRubble', at: 'floor', d: 0.015 },
      { p: 'bones', at: 'edge', d: 0.03, in: 0.45 },
      { p: 'ironSpikes', at: 'wallTopN', d: 0.25, h: 0.9, rad: 0.3, solo: 1, rot0: 1, snap: 1, s: [1, 1] },
      { p: 'forgeBrazier', at: 'wallTopN', d: 0.03, sp: 6, h: 2.0, solo: 1, s: [0.7, 0.8] },
      { p: 'coolRubble', at: 'wallTop', d: 0.35 },
      { p: 'ashPile', at: 'wallTop', d: 0.2 },
      { p: 'coolRubble', at: 'pitEdge', d: 0.25, in: 0.35, s: [0.7, 0.9] },
      { p: 'crust', at: 'pit', d: 0.35 },
    ],
    solids: { anvil: 'emberRing', column: 'columnDressL' },
    overlay: 'emberRing',
  },
  ice: {
    pal: {
      snow: 0xeaf2fc, snowCols: [0xdce8f6, 0xeaf2fc, 0xd0dff0], ice: 0xa8d4f0, ice2: 0x84bce6, stone: 0x5a6a80, stone2: 0x3e4a5c,
      stones: [0x5a6a80, 0x6a7a90, 0x4a586c], crystal: 0x4ff0ff, crystal2: 0xb8ffff, crystal3: 0x3a9cff,
      pine: [0x1c3a36, 0x22443c, 0x183230], bark: 0x3a2a24, bone: 0xe2ecf4, bone2: 0xb8c6d4,
      iron: 0x2a3038, ember: 0xff8a2a, fire: 0xffa63a, fire2: 0xfff0b0, moss: 0xe8f0fa,
    },
    mist: { n: 26, c: 0x7ab0e8, i: 0.22, y: 0.3, s: [5, 9] },
    shafts: { c: 0xa8c8ff, i: 0.28, per: 0.5, w: [1.8, 2.8] },
    wisps: { c: 0xa8e8ff, n: 0.3 },                      // cold vapour off the dark water
    fireflies: { c: 0x8ff4ff, c2: 0xd8ffff, n: 0.25 },
    rules: [
      { p: 'iceSpire', at: 'void', d: 0.1, sp: 4, h: 5, rad: 0.9 },
      { p: 'pine', at: 'void', d: 0.22, sp: 3, h: 5.6, rad: 1.2 },
      { p: 'icicles', at: 'faceN', d: 0.34, sp: 1, solo: 1 },
      { p: 'icicles', at: 'faceSide', d: 0.12, sp: 2, solo: 1 },
      { p: 'iceCrystals', at: 'cornerN', d: 0.55, sp: 4, in: 0.4, solo: 1 },
      { p: 'frozenPillar', at: 'cornerN', d: 0.3, sp: 4, h: 2.6, in: 0.55, solo: 1 },
      { p: 'brazier', at: 'cornerN', d: 0.18, sp: 7, h: 2.6, in: 0.5, solo: 1 },
      { p: 'iceCrystals', at: 'edgeN', d: 0.06, sp: 5, in: 0.35, solo: 1 },
      { p: 'iceCrystals', at: 'edge', d: 0.02, sp: 7, in: 0.3, solo: 1, s: [0.6, 0.8] },
      { p: 'snowDrift', at: 'edgeN', d: 0.3, in: 0.05 },
      { p: 'snowDrift', at: 'edgeE', d: 0.18, in: 0.05, s: [0.7, 0.9] },
      { p: 'snowDrift', at: 'edgeW', d: 0.18, in: 0.05, s: [0.7, 0.9] },
      { p: 'snowDrift', at: 'cornerS', d: 0.4, in: 0.3, s: [0.7, 0.9] },
      { p: 'snowDrift', at: 'cornerN', d: 0.4, in: 0.3 },
      { p: 'rubble', at: 'edge', d: 0.08, in: 0.3 },
      { p: 'frozenBones', at: 'edge', d: 0.04, in: 0.45 },
      { p: 'snowTop', at: 'floor', d: 0.03, s: [0.6, 0.8] },
      { p: 'iceCrystals', at: 'wallTopN', d: 0.08, sp: 4, h: 1.4, solo: 1 },
      { p: 'iceCrystals', at: 'wallTopSide', d: 0.05, sp: 5, h: 1.4, solo: 1 },
      { p: 'snowTop', at: 'wallTop', d: 0.55 },
      { p: 'rubble', at: 'wallTop', d: 0.1 },
      { p: 'snowDrift', at: 'pitEdge', d: 0.25, in: 0.3, s: [0.6, 0.8] },
      { p: 'iceFloe', at: 'pit', d: 0.35 },
    ],
    solids: { crystal: 'snowRing', column: 'columnDressI' },
    overlay: 'snowRing',
  },
});
