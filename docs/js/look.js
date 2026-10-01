// look.js — look-dev helpers: procedural pixel-texture atlas, per-theme surface "look" data,
// shared level / character material patches (baked AO, world-space texturing, ground mist,
// dappled sun "cookie", character rim light). Everything here is created ONCE and shared, so
// changing floors never allocates textures or compiles new shaders.
//
// For the set-dressing code (decor.js):
//   lookTile(name)            -> atlas tile index; pass it as the 10th arg of BoxBatch.add() on a batch
//                                built with decorMat('lit') to texture a box (bark, leaf, rock, ...)
//   decorMat(kind, theme)     -> shared materials: 'lit' (textured, AO, mist, cookie; use with BoxBatch),
//                                'plain' (lit, untextured: instance colours only), 'glow' (emissive, not
//                                tone mapped), 'fade' (translucent overlay)
//   lookOf(theme)             -> resolved per-theme look data (palette: moss, rubble, bark, leaf, glow, ...)
//   LOOK_U                    -> shared uniforms (uLkTime is advanced by animateLevel)
'use strict';

const LOOK_TS = 32, LOOK_COLS = 8, LOOK_ROWS = 4;           // atlas: 8 x 4 tiles of 32 x 32 px = 256 x 128
const LOOK_TILES = ['plain', 'slab', 'slabCrack', 'cobble', 'brick', 'brickMoss', 'rock', 'dirt',
  'mossFloor', 'roots', 'temple', 'sand', 'planks', 'rubble', 'grassTop', 'boneTop',
  'basalt', 'ice', 'marble', 'sandstone', 'bark', 'leaf', 'tiles', 'cryptWall',
  'templeWall', 'vineWall', 'bones', 'mud', 'sandTop', 'iceWall', 'slabTop', 'woodTop'];
function lookTile(name) { const i = LOOK_TILES.indexOf(name); return i < 0 ? 0 : i; }

// ---------- per-theme look data (THEMES[i].look overrides these; see data.js) ----------
// floor/corr: tile names picked per tile by hash; patch: tile used in large blob patches (moss, roots)
// wall/wallAlt: side textures of wall blocks (wallAlt on ~altP of blocks); top: wall-top texture
// cliff: sides of the deep blocks around pits; bright: compensates the texture's average darkening
// ao: contact-shadow strength (floor edges at walls, wall bases); side: side-face brightness vs tops
// topVar: wall-top height variation; rubble: chance of a broken block on a wall top; tint*: colours
const LOOK_DEF = {
  floor: ['slab', 'slabCrack'], corr: ['cobble'], patch: null, patchP: 0, wall: 'brick', wallAlt: null, altP: 0, top: 'rubble', cliff: 'rock',
  bright: 1.18, ao: 0.55, aoR: 0.42, side: 0.86, base: 0.62, topVar: 0.25, rubble: 0.18, lip: null, lipP: 0.5,
  rubbleC: null, bark: 0x5a4030, leaf: 0x3f7a2a, moss: 0x4f7a32, glow: null,
};
// light-touch defaults for worlds that don't have their own look yet (keyed by theme.pattern)
const LOOK_BY_PATTERN = {
  cracks: { floor: ['sandstone', 'sandstone', 'slabCrack'], corr: ['sand'], wall: 'brick', top: 'sandTop', cliff: 'sandstone' },
  slabs: {}, moss: { floor: ['slab', 'slabCrack', 'slab'], corr: ['cobble'], wall: 'rock', top: 'rubble' },
  basalt: { floor: ['basalt'], corr: ['basalt'], wall: 'rock', top: 'rubble', cliff: 'basalt' },
  ice: { floor: ['ice'], corr: ['ice'], wall: 'iceWall', top: 'slabTop', cliff: 'iceWall', ao: 0.4 },
  marble: { floor: ['marble'], corr: ['tiles'], wall: 'brick', top: 'slabTop', ao: 0.35 },
  planks: { floor: ['planks'], corr: ['planks'], wall: 'rock', top: 'woodTop', cliff: 'rock', norot: true },
};
const _lookCache = new Map();
function lookOf(theme) {
  let L = _lookCache.get(theme);
  if (!L) { L = Object.assign({}, LOOK_DEF, LOOK_BY_PATTERN[theme.pattern] || {}, theme.look || {}); _lookCache.set(theme, L); }
  return L;
}

// ---------- procedural atlas (painted once into one canvas) ----------
const LOOK_ATLAS = (() => {
  const W = LOOK_TS * LOOK_COLS, H = LOOK_TS * LOOK_ROWS, S = LOOK_TS;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d'), img = cx.createImageData(W, H), d = img.data;
  const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v;
  let ox = 0, oy = 0;
  const set = (x, y, r, g, b) => { x = ((x % S) + S) % S; y = ((y % S) + S) % S; const k = ((oy + y) * W + ox + x) * 4; d[k] = clamp(r) * 255; d[k + 1] = clamp(g === undefined ? r : g) * 255; d[k + 2] = clamp(b === undefined ? r : b) * 255; d[k + 3] = 255; };
  const get = (x, y) => { x = ((x % S) + S) % S; y = ((y % S) + S) % S; const k = ((oy + y) * W + ox + x) * 4; return [d[k] / 255, d[k + 1] / 255, d[k + 2] / 255]; };
  const mul = (x, y, m, mg, mb) => { const c = get(x, y); set(x, y, c[0] * m, c[1] * (mg === undefined ? m : mg), c[2] * (mb === undefined ? m : mb)); };
  // tileable smooth value noise (period S)
  const vnoise = (rnd, cell) => { const n = S / cell, g = []; for (let i = 0; i < n * n; i++) g.push(rnd()); return (x, y) => { const fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); const G = (a, b) => g[((b % n + n) % n) * n + ((a % n + n) % n)]; return (G(x0, y0) * (1 - sx) + G(x0 + 1, y0) * sx) * (1 - sy) + (G(x0, y0 + 1) * (1 - sx) + G(x0 + 1, y0 + 1) * sx) * sy; }; };
  // tileable voronoi: returns per pixel [cell id, d1, d2]
  const voronoi = (rnd, n) => { const p = []; for (let i = 0; i < n; i++) p.push([rnd() * S, rnd() * S, rnd()]); return (x, y) => { let d1 = 1e9, d2 = 1e9, id = 0; for (let i = 0; i < n; i++) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const dx = p[i][0] + a * S - x, dy = p[i][1] + b * S - y, dd = Math.sqrt(dx * dx + dy * dy); if (dd < d1) { d2 = d1; d1 = dd; id = i; } else if (dd < d2) d2 = dd; } return [p[id][2], d1, d2, id]; }; };
  const base = (rnd, lo, hi, cell) => { const nz = vnoise(rnd, cell || 8); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = lo + (hi - lo) * (0.55 * nz(x, y) + 0.45 * rnd()); set(x, y, v); } };
  const crack = (rnd, x, y, len, v) => { let a = rnd() * 6.28; for (let i = 0; i < len; i++) { set(Math.round(x), Math.round(y), v); x += Math.cos(a); y += Math.sin(a); a += (rnd() - 0.5) * 1.1; if (rnd() < 0.12) crack(rnd, x, y, len * 0.4 | 0, v * 1.1); } };
  const moss = (rnd, amt, from) => { const nz = vnoise(rnd, 8); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let m = nz(x, y) + rnd() * 0.25; if (from === 'top') m += 0.9 - y / S * 1.6; if (m > 1 - amt) { const k = 0.82 + rnd() * 0.18; const c = get(x, y); set(x, y, (c[0] * 0.35 + 0.12) * k, (c[1] * 0.4 + 0.32) * k, (c[2] * 0.3 + 0.08) * k); } } };
  // rect blocks with bevel (light top/left, dark bottom/right) and mortar lines
  const blocks = (rnd, rows, lo, hi, mortar) => { for (const r of rows) { const [x0, y0, w, h] = r, v = lo + rnd() * (hi - lo); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = get(x0 + x, y0 + y)[0]; let k = v * (0.8 + 0.4 * c); if (x === 0 || y === h - 1 || (x === w - 1) || y === 0) k = mortar; else if (y === 1 || x === 1) k *= 1.12; else if (y === h - 2 || x === w - 2) k *= 0.8; set(x0 + x, y0 + y, k); } } };
  const brickRows = (rnd, bh, bw) => { const r = []; for (let y = 0; y < S; y += bh) { const off = ((y / bh) & 1) ? bw / 2 : 0; for (let x = -bw; x < S; x += bw) r.push([x + off + Math.floor(rnd() * 2) * 0, y, bw, bh]); } return r; };
  const P = {
    plain() { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(x, y, 1); },
    slab(rnd) { base(rnd, 0.55, 0.85); const lay = rnd() < 0.5 ? [[0, 0, 32, 16], [0, 16, 16, 16], [16, 16, 16, 16]] : [[0, 0, 16, 16], [16, 0, 16, 16], [0, 16, 32, 16]]; blocks(rnd, lay, 0.85, 1.0, 0.42); for (let i = 0; i < 5; i++) { const x = rnd() * S | 0, y = rnd() * S | 0; mul(x, y, 0.75); mul(x + 1, y, 0.82); } },
    slabCrack(rnd) { P.slab(rnd); crack(rnd, 6 + rnd() * 20, 6 + rnd() * 20, 18, 0.32); },
    cobble(rnd) { base(rnd, 0.6, 0.9, 4); const vo = voronoi(rnd, 10); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const [c, d1, d2] = vo(x, y), e = d2 - d1; const v = e < 1.3 ? 0.38 : (0.72 + c * 0.28) * (e < 2.6 ? 0.85 : 1) * (0.9 + 0.1 * get(x, y)[0]) * (d1 < 2.5 ? 1.06 : 1); set(x, y, v); } },
    brick(rnd) { base(rnd, 0.6, 0.9, 4); blocks(rnd, brickRows(rnd, 8, 16), 0.78, 1.0, 0.4); for (let i = 0; i < 3; i++) crack(rnd, rnd() * S, rnd() * S, 5, 0.45); },
    brickMoss(rnd) { P.brick(rnd); moss(rnd, 0.45, 'top'); },
    cryptWall(rnd) { base(rnd, 0.6, 0.9, 4); blocks(rnd, brickRows(rnd, 8, 16), 0.72, 0.95, 0.38);
      // a burial niche with a skull
      for (let y = 9; y < 23; y++) for (let x = 9; x < 23; x++) set(x, y, (x === 9 || y === 9) ? 0.5 : 0.16);
      for (let y = 13; y < 20; y++) for (let x = 12; x < 20; x++) { const r = (x - 15.5) ** 2 / 14 + (y - 16) ** 2 / 10; if (r < 1) set(x, y, 0.98, 0.97, 0.9); }
      set(14, 16, 0.12); set(17, 16, 0.12); set(14, 17, 0.12); set(17, 17, 0.12); set(15, 19, 0.3); set(16, 19, 0.3); },
    rock(rnd) { base(rnd, 0.5, 0.9, 8); const vo = voronoi(rnd, 6); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const [c, d1, d2] = vo(x, y); let v = get(x, y)[0] * (0.8 + c * 0.3); if (d2 - d1 < 1.1) v *= 0.55; if ((y + (x >> 3)) % 11 === 0) v *= 0.85; set(x, y, v); } },
    dirt(rnd) { base(rnd, 0.62, 0.9, 8); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) mul(x, y, 1.0, 0.9, 0.78); for (let i = 0; i < 26; i++) { const x = rnd() * S | 0, y = rnd() * S | 0, v = rnd() < 0.5 ? 0.55 : 1.05; mul(x, y, v); if (rnd() < 0.4) mul(x + 1, y, v); } },
    mud(rnd) { base(rnd, 0.5, 0.75, 8); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) mul(x, y, 1.0, 0.88, 0.72); for (let i = 0; i < 6; i++) { const x = rnd() * S, y = rnd() * S; for (let a = 0; a < 6; a++) mul(Math.round(x + a), Math.round(y + Math.sin(a) * 0.8), 1.25); } },
    mossFloor(rnd) { P.slab(rnd); moss(rnd, 0.62); },
    roots(rnd) { P.dirt(rnd); for (let r = 0; r < 4; r++) { let x = rnd() * S, y = rnd() * S, a = rnd() * 6.28; const w = rnd() < 0.5 ? 2 : 1; for (let i = 0; i < 26; i++) { for (let k = 0; k < w; k++) set(Math.round(x) + k, Math.round(y), 0.34, 0.25, 0.18); set(Math.round(x), Math.round(y) - 1, 0.62, 0.5, 0.36); x += Math.cos(a); y += Math.sin(a); a += (rnd() - 0.5) * 0.7; } } },
    temple(rnd) { base(rnd, 0.62, 0.86, 4); blocks(rnd, [[0, 0, 32, 32]], 0.9, 0.95, 0.4); for (let y = 7; y < 25; y++) for (let x = 7; x < 25; x++) { const e = x === 7 || y === 7 ? 0.62 : x === 24 || y === 24 ? 1.08 : 0.8; mul(x, y, e); }
      for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) { const dd = Math.abs(x - 15.5) + Math.abs(y - 15.5); if (Math.abs(dd - 6) < 0.6 || Math.abs(dd - 2) < 0.6) mul(x, y, 0.55); else if (Math.abs(dd - 6) < 1.4) mul(x, y, 1.08); } },
    templeWall(rnd) { base(rnd, 0.6, 0.88, 4); blocks(rnd, [[0, 0, 20, 12], [20, 0, 12, 12], [0, 12, 32, 8], [-6, 20, 18, 12], [12, 20, 20, 12]], 0.78, 1.0, 0.38); for (let x = 2; x < 30; x += 4) { mul(x, 15, 0.6); mul(x + 1, 16, 0.6); mul(x, 17, 0.6); } },
    vineWall(rnd) { P.templeWall(rnd); moss(rnd, 0.35, 'top'); for (let v = 0; v < 3; v++) { let x = 3 + v * 10 + rnd() * 5; const len = 10 + rnd() * 20; for (let y = 0; y < len; y++) { set(Math.round(x), y, 0.25, 0.5, 0.18); if (rnd() < 0.25) { set(Math.round(x) + 1, y, 0.38, 0.72, 0.25); set(Math.round(x) - 1, y + 1, 0.3, 0.62, 0.2); } x += (rnd() - 0.5) * 0.6; } } },
    sand(rnd) { base(rnd, 0.82, 0.98, 4); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((y + Math.round(Math.sin(x * 0.4 + y * 0.1) * 2)) % 7 === 0) mul(x, y, 0.88); },
    sandstone(rnd) { base(rnd, 0.75, 0.95, 4); blocks(rnd, [[0, 0, 32, 16], [-8, 16, 24, 16], [16, 16, 24, 16]], 0.86, 1.0, 0.55); },
    sandTop(rnd) { P.sand(rnd); for (let i = 0; i < 4; i++) crack(rnd, rnd() * S, rnd() * S, 6, 0.6); },
    planks(rnd) { base(rnd, 0.7, 0.92, 4); for (let p = 0; p < 4; p++) { const y0 = p * 8, v = 0.78 + rnd() * 0.22, cut = rnd() * S | 0; for (let y = 0; y < 8; y++) for (let x = 0; x < S; x++) { let k = v * (0.88 + 0.12 * Math.sin((x + p * 13) * 0.9 + y * 2.3 + Math.sin(x * 0.3) * 2)); if (y === 0) k = 0.35; else if (y === 1) k *= 1.1; else if (y === 7) k *= 0.75; if (x === cut) k = 0.4; set(x, y0 + y, k * 1.0, k * 0.93, k * 0.85); } set((cut + 2) % S, y0 + 3, 0.3); set((cut + 2) % S, y0 + 5, 0.3); } },
    woodTop(rnd) { P.planks(rnd); },
    rubble(rnd) { base(rnd, 0.6, 0.9, 4); const vo = voronoi(rnd, 13); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const [c, d1, d2] = vo(x, y); let v = (0.66 + c * 0.22) * (0.9 + 0.1 * get(x, y)[0]); if (d2 - d1 < 1.2) v = 0.42; else if (d1 < 2) v *= 1.08; set(x, y, v); } },
    slabTop(rnd) { P.slab(rnd); },
    grassTop(rnd) { base(rnd, 0.6, 1.0, 4); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const c = get(x, y)[0]; set(x, y, 0.4 * c, 0.66 * c, 0.3 * c); } for (let i = 0; i < 26; i++) { const x = rnd() * S | 0, y = rnd() * S | 0; set(x, y, 0.55, 0.8, 0.4); set(x, y + 1, 0.22, 0.38, 0.17); } },
    boneTop(rnd) { P.rubble(rnd); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) mul(x, y, 0.7); for (let b = 0; b < 3; b++) { const x = rnd() * S | 0, y = rnd() * S | 0, a = rnd() < 0.5; for (let i = 0; i < 6; i++) set(x + (a ? i : 0), y + (a ? 0 : i), 1, 0.98, 0.9); set(x - 1, y - 1, 1, 0.98, 0.9); set(x + (a ? 6 : 1), y + (a ? 1 : 6), 1, 0.98, 0.9); }
      const sx = rnd() * 20 + 4 | 0, sy = rnd() * 20 + 4 | 0; for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) set(sx + x, sy + y, 1, 0.98, 0.9); set(sx + 1, sy + 2, 0.15); set(sx + 3, sy + 2, 0.15); },
    bones(rnd) { P.slab(rnd); for (let b = 0; b < 3; b++) { const x = rnd() * S | 0, y = rnd() * S | 0, a = rnd() < 0.5; for (let i = 0; i < 5; i++) set(x + (a ? i : 0), y + (a ? 0 : i), 1, 0.97, 0.88); set(x - 1, y, 1, 0.97, 0.88); set(x + (a ? 5 : 0), y + (a ? 0 : 5), 1, 0.97, 0.88); } },
    basalt(rnd) { base(rnd, 0.55, 0.85, 4); const vo = voronoi(rnd, 8); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const [c, d1, d2] = vo(x, y); let v = (0.65 + c * 0.35) * (0.85 + 0.15 * get(x, y)[0]); if (d2 - d1 < 1.4) v = 0.25; else if (d1 < 2) v *= 1.15; set(x, y, v); } },
    ice(rnd) { base(rnd, 0.85, 1.0, 8); for (let s = 0; s < 4; s++) { let x = rnd() * S, y = rnd() * S; for (let i = 0; i < 14; i++) { set(Math.round(x), Math.round(y), 1); x += 1; y += 0.6; } } for (let i = 0; i < 2; i++) crack(rnd, rnd() * S, rnd() * S, 8, 0.7); },
    iceWall(rnd) { P.rock(rnd); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const c = get(x, y); set(x, y, 0.4 + c[0] * 0.6, 0.45 + c[1] * 0.55, 0.5 + c[2] * 0.5); } },
    marble(rnd) { base(rnd, 0.88, 1.0, 8); let x = rnd() * S, y = 0; for (let i = 0; i < 40; i++) { set(Math.round(x), Math.round(y), 0.7); x += (rnd() - 0.4) * 1.5; y += 0.8; } blocks(rnd, [[0, 0, 32, 32]], 0.97, 1.0, 0.7); },
    tiles(rnd) { base(rnd, 0.75, 0.95, 4); const r = []; for (let y = 0; y < S; y += 8) for (let x = 0; x < S; x += 8) r.push([x, y, 8, 8]); blocks(rnd, r, 0.82, 1.0, 0.5); },
    bark(rnd) { base(rnd, 0.6, 0.9, 4); for (let x = 0; x < S; x++) { const v = 0.75 + 0.25 * Math.sin(x * 1.3 + rnd()); for (let y = 0; y < S; y++) { mul(x, y, v * (0.92 + 0.08 * Math.sin(y * 0.5 + x))); } } for (let i = 0; i < 6; i++) { const x = rnd() * S | 0, y = rnd() * S | 0; for (let k = 0; k < 4; k++) mul(x, y + k, 0.5); } },
    leaf(rnd) { base(rnd, 0.55, 1.0, 4); const vo = voronoi(rnd, 14); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const [c, d1, d2] = vo(x, y); const v = (d2 - d1 < 1.2 ? 0.45 : 0.7 + c * 0.3 + (d1 < 2 ? 0.15 : 0)) * (0.9 + 0.1 * get(x, y)[0]); set(x, y, v); } },
  };
  LOOK_TILES.forEach((name, i) => {
    ox = (i % LOOK_COLS) * S; oy = Math.floor(i / LOOK_COLS) * S;
    const rnd = RNG(0x51ed + i * 7919);
    (P[name] || P.plain)(rnd);
  });
  cx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.flipY = false;
  tex.encoding = THREE.sRGBEncoding; tex.userData.shared = true;
  return tex;
})();
// small tileable data textures: soft noise (ground mist) and a canopy pattern (dappled sunlight)
function lookDataTex(n, paint) {
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const cx = cv.getContext('2d'), img = cx.createImageData(n, n), d = img.data;
  const v = paint(n);
  for (let i = 0; i < n * n; i++) { const c = Math.max(0, Math.min(255, v[i] * 255)); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = c; d[i * 4 + 3] = 255; }
  cx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.userData.shared = true;
  return t;
}
const LOOK_NOISE = lookDataTex(64, n => {
  const r = RNG(77), out = new Float32Array(n * n);
  for (const [cell, w] of [[16, 0.6], [8, 0.3], [4, 0.1]]) {
    const m = n / cell, g = []; for (let i = 0; i < m * m; i++) g.push(r());
    const G = (a, b) => g[((b % m + m) % m) * m + ((a % m + m) % m)];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy); let tx = fx - x0, ty = fy - y0; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty); out[y * n + x] += w * ((G(x0, y0) * (1 - tx) + G(x0 + 1, y0) * tx) * (1 - ty) + (G(x0, y0 + 1) * (1 - tx) + G(x0 + 1, y0 + 1) * tx) * ty); }
  }
  return out;
});
const LOOK_CANOPY = lookDataTex(64, n => {
  const r = RNG(4141), out = new Float32Array(n * n).fill(1);
  for (let b = 0; b < 70; b++) { // leaf clusters block the light; the gaps between them are sun flecks
    const cx = r() * n, cy = r() * n, rad = 3 + r() * 7;
    for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) { const d = Math.hypot(x, y) / rad; if (d < 1) { const k = ((Math.round(cy + y) % n) + n) % n * n + (((Math.round(cx + x) % n) + n) % n); out[k] = Math.min(out[k], 0.12 + 0.5 * d * d); } }
  }
  return out;
});

// ---------- shared uniforms (values set per world by applyThemeLighting in core.js) ----------
const LOOK_U = {
  uLkTime: { value: 0 },
  uLkMist: { value: new THREE.Vector4(0, -1.5, 0.8, 0) },     // density, y fully misty, y mist-free, -
  uLkMistC: { value: new THREE.Color(0x8090a0) },
  uLkNoise: { value: LOOK_NOISE },
  uLkCanopy: { value: LOOK_CANOPY },
  uLkCookie: { value: new THREE.Vector4(0, 0.07, 0.6, 0) },   // dapple strength, scale, sway, -
  uLkAO: { value: new THREE.Vector4(0.55, 0.42, 0.86, 0.62) }, // edge AO strength, AO radius, side-face mul, wall-base mul
  uLkRim: { value: new THREE.Vector4(0.35, 0.08, 0, 0) },      // character rim strength, ambient lift
  uLkRimC: { value: new THREE.Color(0x9ab8ff) },
};

// ---------- level material patch ----------
// All level surfaces: no point lights (the pool lights characters only), sun "cookie" (dapple),
// low ground mist pooled in pits and drifting over floors. With opt.tex (BoxBatch materials): world-
// space pixel textures from the atlas (aTex.x top tile, aTex.y side tile, aTex.z AO corner bits,
// aTex.w top rotation) and baked AO (aAO: walls on N/E/S/W of a floor tile; wall bases darker).
const LOOK_VS_DECL = `
varying vec3 vLkW;
#ifdef LOOK_TEX
attribute vec4 aTex; attribute vec4 aAO;
varying vec2 vLkUv; varying vec4 vLkAO; varying vec4 vLkT;
#endif
`;
const LOOK_VS = `
{ vec4 lkW = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  lkW = instanceMatrix * lkW;
#endif
  lkW = modelMatrix * lkW; vLkW = lkW.xyz;
#ifdef LOOK_TEX
  vec3 lkN = normal;
#ifdef USE_INSTANCING
  lkN = mat3(instanceMatrix) * lkN;
#endif
  lkN = normalize(lkN);
  float top = step(0.5, lkN.y);
  vLkUv = top > 0.5 ? lkW.xz * 0.5 : (abs(lkN.x) > abs(lkN.z) ? vec2(lkW.z, -lkW.y) : vec2(lkW.x, -lkW.y)) * 0.5;
  vLkT = vec4(top > 0.5 ? aTex.x : aTex.y, top, aTex.z, top > 0.5 ? aTex.w : 0.0);
  vLkAO = aAO * top;
#endif
}
`;
const LOOK_FS_DECL = `
varying vec3 vLkW;
uniform float uLkTime; uniform vec4 uLkMist; uniform vec3 uLkMistC; uniform sampler2D uLkNoise; uniform sampler2D uLkCanopy; uniform vec4 uLkCookie; uniform vec4 uLkAO;
#ifdef LOOK_TEX
varying vec2 vLkUv; varying vec4 vLkAO; varying vec4 vLkT;
#endif
`;
const LOOK_FS_MAP = `
#ifdef LOOK_TEX
{ vec2 f = fract(vLkUv);
  float r = vLkT.w;
  vec2 g = r < 0.5 ? f : r < 1.5 ? vec2(1.0 - f.y, f.x) : r < 2.5 ? vec2(1.0 - f.x, 1.0 - f.y) : vec2(f.y, 1.0 - f.x);
  g = clamp(g, 0.5 / ${LOOK_TS}.0, 1.0 - 0.5 / ${LOOK_TS}.0);
  float t = floor(vLkT.x + 0.5);
  vec2 cell = vec2(mod(t, ${LOOK_COLS}.0), floor(t / ${LOOK_COLS}.0));
  diffuseColor.rgb *= texture2D(map, (cell + g) / vec2(${LOOK_COLS}.0, ${LOOK_ROWS}.0)).rgb;
  float ao = 1.0;
  if (vLkT.y > 0.5) {
    // contact shadow along walls (sides N E S W) and in inner corners (bits NE 1, SE 2, SW 4, NW 8)
    float R = uLkAO.y, e = 0.0;
    e = max(e, vLkAO.x * pow(1.0 - smoothstep(0.0, R, f.y), 1.6));
    e = max(e, vLkAO.y * pow(smoothstep(1.0 - R, 1.0, f.x), 1.6));
    e = max(e, vLkAO.z * pow(smoothstep(1.0 - R, 1.0, f.y), 1.6));
    e = max(e, vLkAO.w * pow(1.0 - smoothstep(0.0, R, f.x), 1.6));
    float b = vLkT.z;
    float c1 = mod(b, 2.0), c2 = mod(floor(b / 2.0), 2.0), c4 = mod(floor(b / 4.0), 2.0), c8 = floor(b / 8.0);
    float cr = R * 1.15;
    e = max(e, c1 * pow(1.0 - smoothstep(0.0, cr, length(vec2(1.0 - f.x, f.y))), 1.6));
    e = max(e, c2 * pow(1.0 - smoothstep(0.0, cr, length(vec2(1.0 - f.x, 1.0 - f.y))), 1.6));
    e = max(e, c4 * pow(1.0 - smoothstep(0.0, cr, length(vec2(f.x, 1.0 - f.y))), 1.6));
    e = max(e, c8 * pow(1.0 - smoothstep(0.0, cr, length(f)), 1.6));
    ao = 1.0 - uLkAO.x * e;
  } else {
    // side faces: a touch darker than tops, darkest at the base (walls grounded, pits deep)
    ao = uLkAO.z * mix(uLkAO.w, 1.0, smoothstep(-2.5, 1.7, vLkW.y));
  }
  diffuseColor.rgb *= ao;
}
#endif
`;
const LOOK_COOKIE = `getDirectionalLightInfo( directionalLight, geometry, directLight );
		if (uLkCookie.x > 0.0) { vec2 cuv = vLkW.xz * uLkCookie.y + vec2(sin(uLkTime * 0.5), cos(uLkTime * 0.37)) * uLkCookie.z * 0.02; float ck = texture2D(uLkCanopy, cuv).r; directLight.color *= mix(1.0, ck * 1.55, uLkCookie.x); }`;
const LOOK_MIST = `
if (uLkMist.x > 0.0) {
  float hm = 1.0 - smoothstep(uLkMist.y, uLkMist.z, vLkW.y);              // deep: pits fill with mist
  float band = 1.0 - smoothstep(-0.2, uLkMist.z, vLkW.y);                  // low band over floors / wall feet
  float n = 0.6 * texture2D(uLkNoise, vLkW.xz * 0.03 + uLkTime * vec2(0.012, 0.005)).r + 0.4 * texture2D(uLkNoise, vLkW.xz * 0.08 - uLkTime * vec2(0.007, 0.014)).r;
  float mf = uLkMist.x * max(hm * hm, band * (0.12 + 0.75 * smoothstep(0.42, 0.78, n)));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uLkMistC, clamp(mf, 0.0, 0.92));
}
#include <tonemapping_fragment>`;
const LOOK_LIGHTS = THREE.ShaderChunk.lights_fragment_begin
  .replace('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )', '#if 0')
  .replace('getDirectionalLightInfo( directionalLight, geometry, directLight );', LOOK_COOKIE);
function lookPatch(sh, tex) {
  Object.assign(sh.uniforms, LOOK_U);
  if (tex) sh.defines = Object.assign(sh.defines || {}, { LOOK_TEX: '' });
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + LOOK_VS_DECL).replace('#include <project_vertex>', '#include <project_vertex>' + LOOK_VS);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + LOOK_FS_DECL)
    .replace('#include <lights_fragment_begin>', LOOK_LIGHTS)
    .replace('#include <tonemapping_fragment>', LOOK_MIST);
  if (tex) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', LOOK_FS_MAP);
}
// shared materials (created once): textured level boxes, plain lit level boxes, glow, translucent
const LOOK_MATS = {};
function lookLitMat() {
  if (!LOOK_MATS.lit) {
    const m = new THREE.MeshLambertMaterial({ map: LOOK_ATLAS });
    m.onBeforeCompile = sh => lookPatch(sh, true); m.customProgramCacheKey = () => 'lvlT';
    m.userData.shared = true; LOOK_MATS.lit = m;
  }
  return LOOK_MATS.lit;
}
function decorMat(kind) {
  if (kind === 'lit' || kind === 'tex') return lookLitMat();
  if (!LOOK_MATS[kind]) {
    let m;
    if (kind === 'glow') m = new THREE.MeshBasicMaterial({ toneMapped: false });
    else if (kind === 'fade') m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
    else m = levelMat(new THREE.MeshLambertMaterial());
    m.userData.shared = true; LOOK_MATS[kind] = m;
  }
  return LOOK_MATS[kind];
}

// ---------- character readability: rim light + ambient lift (applied by prepModel) ----------
const LOOK_RIM = `
{ float rim = 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0);
  outgoingLight += uLkRimC * (pow(rim, 2.2) * uLkRim.x) + diffuseColor.rgb * uLkRim.y; }
#include <output_fragment>`;
function charPatch(sh) {
  sh.uniforms.uLkRim = LOOK_U.uLkRim; sh.uniforms.uLkRimC = LOOK_U.uLkRimC;
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uLkRim; uniform vec3 uLkRimC;').replace('#include <output_fragment>', LOOK_RIM);
}
function lookCharMat(m) {
  if (m.userData.lkChr) return;
  m.userData.lkChr = 1; m.onBeforeCompile = charPatch; m.customProgramCacheKey = () => 'chr'; m.needsUpdate = true;
}
