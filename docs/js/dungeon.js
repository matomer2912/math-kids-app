// dungeon.js — deterministic procedural dungeon generation, collision, level meshes, traps
'use strict';

// map.g tile codes
const T_WALL = 0, T_FLOOR = 1, T_PIT = 2, T_SOLID = 3;   // pit: can't walk, arrows fly over. solid: statue/fountain on the floor
// map.tt terrain / trap layer
const TT_NONE = 0, TT_SPIKE = 1, TT_VENT = 2, TT_PLATE = 3, TT_SLOW = 4, TT_SHRINE = 5;
// trap timing is driven by the wall clock (Date.now) so host and guests agree without any network traffic
const SPIKE_P = 3.2, VENT_P = 4.8;
function levelTime() { return Date.now() / 1000; }
// 0 = down (safe), 1 = warning (tips poke out), 2 = up (hurts)
function spikeState(q, t) { const p = ((t + q * SPIKE_P / 8) % SPIKE_P + SPIKE_P) % SPIKE_P; return p < 1.5 ? 0 : p < 2.3 ? 1 : 2; }
// 0 = idle, 1 = warning (glow + sparks), 2 = fire column (hurts)
function ventState(q, t) { const p = ((t + q * VENT_P / 8) % VENT_P + VENT_P) % VENT_P; return p < 2.6 ? 0 : p < 3.6 ? 1 : 2; }

function genDungeon(seed, floor) {
  const rng = RNG(seed);
  const theme = themeFor(floor);
  const boss = isBossFloor(floor);
  const W = boss ? 46 : 46 + Math.min(floor, 12) * 2, H = W;
  const N = W * H;
  const g = new Uint8Array(N), corr = new Uint8Array(N), tt = new Uint8Array(N), tq = new Uint8Array(N);
  const rid = new Int16Array(N).fill(-1);
  const rooms = [];
  const inside = (i, j) => i > 0 && j > 0 && i < W - 1 && j < H - 1;
  const carve = (x, y, w, h, c) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++)
      if (inside(i, j)) { g[j * W + i] = T_FLOOR; if (c) corr[j * W + i] = 1; }
  };
  const center = r => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) });
  const corridor = (a, b, wd) => {
    const A = center(a), B = center(b);
    const o = -(wd >> 1);
    if (rng() < 0.5) {
      carve(Math.min(A.x, B.x) + o, A.y + o, Math.abs(A.x - B.x) + wd, wd, 1);
      carve(B.x + o, Math.min(A.y, B.y) + o, wd, Math.abs(A.y - B.y) + wd, 1);
    } else {
      carve(A.x + o, Math.min(A.y, B.y) + o, wd, Math.abs(A.y - B.y) + wd, 1);
      carve(Math.min(A.x, B.x) + o, B.y + o, Math.abs(A.x - B.x) + wd, wd, 1);
    }
  };
  // room shapes: rect, octa (cut corners), cross, L, round, hall (pillar rows)
  const inShape = (r, u, v) => {
    const w = r.w, h = r.h;
    switch (r.shape) {
      case 'octa': { const c = r.cut || Math.min(3, Math.floor(Math.min(w, h) / 3)); return !(u + v < c || (w - 1 - u) + v < c || u + (h - 1 - v) < c || (w - 1 - u) + (h - 1 - v) < c); }
      case 'cross': { const bw = Math.max(3, Math.round(w * 0.42)), bh = Math.max(3, Math.round(h * 0.42)); return Math.abs(u - (w - 1) / 2) <= bw / 2 || Math.abs(v - (h - 1) / 2) <= bh / 2; }
      case 'L': { let uu = r.lq & 1 ? w - 1 - u : u, vv = r.lq & 2 ? h - 1 - v : v; return !(uu >= Math.ceil(w * 0.58) && vv < Math.floor(h * 0.42)); }
      case 'round': { const dx = (u - (w - 1) / 2) / (w / 2), dy = (v - (h - 1) / 2) / (h / 2); return dx * dx + dy * dy <= 1.08; }
      default: return true;
    }
  };

  if (boss) {
    rooms.push({ x: 3, y: (H >> 1) - 4, w: 8, h: 8, shape: 'rect', kind: 'start' });
    rooms.push({ x: 17, y: (H >> 1) - 13, w: 26, h: 26, arena: true, shape: 'octa', cut: 5, kind: 'boss' });
  } else {
    const target = 8 + Math.min(floor, 8);
    for (let t = 0; t < 600 && rooms.length < target; t++) {
      const w = rng.int(7, 13), h = rng.int(7, 12);
      const x = rng.int(2, W - w - 3), y = rng.int(2, H - h - 3);
      if (rooms.some(r => x < r.x + r.w + 3 && x + w + 3 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y)) continue;
      rooms.push({ x, y, w, h });
    }
  }
  // exit = room farthest from the start
  let exitRoom = 1;
  if (!boss) {
    let bd = -1; const a = center(rooms[0]);
    rooms.forEach((r, i) => { if (!i) return; const b = center(r); const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y); if (d > bd) { bd = d; exitRoom = i; } });
  }
  // shapes + special room kinds
  rooms.forEach((r, i) => {
    if (r.shape) return;
    if (i === 0) { r.shape = 'rect'; r.kind = 'start'; return; }
    const big = r.w >= 9 && r.h >= 9, x = rng();
    r.shape = !big ? (x < 0.6 ? 'rect' : 'octa') : x < 0.22 ? 'rect' : x < 0.38 ? 'octa' : x < 0.54 ? 'cross' : x < 0.68 ? 'L' : x < 0.84 ? 'round' : 'hall';
    r.lq = rng.int(0, 3);
    r.kind = i === exitRoom ? 'exit' : 'normal';
  });
  if (!boss) {
    const cand = rooms.map((r, i) => i).filter(i => i !== 0 && i !== exitRoom);
    for (let i = cand.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); const tmp = cand[i]; cand[i] = cand[k]; cand[k] = tmp; }
    const take = ok => { const n = cand.findIndex(i => ok(rooms[i])); if (n < 0) return null; const i = cand[n]; cand.splice(n, 1); return rooms[i]; };
    const want = [
      ['chasm', floor >= 2 ? 0.8 : 0.55, r => r.w >= 9 && r.h >= 9],
      ['traps', 0.85, r => r.w * r.h >= 56],
      ['shrine', floor >= 2 ? 0.6 : 0.4, () => true],
      ['vault', 0.45, r => r.w * r.h <= 110],
      ['arena', floor >= 2 ? 0.55 : 0, r => r.w * r.h >= 80],
      ['storage', 0.85, () => true],
      ['storage', 0.45, () => true],
    ];
    for (const [k, p, ok] of want) {
      if (rng() >= p) continue;
      const r = take(ok); if (!r) continue;
      r.kind = k;
      if (k === 'chasm') r.shape = r.w >= 11 && r.h >= 11 && rng() < 0.4 ? 'octa' : 'rect';
      if (k === 'arena' && r.shape === 'L') r.shape = 'round';
      if (k === 'traps' && r.shape !== 'rect') r.shape = 'rect';
    }
  }
  rooms.forEach((r, idx) => {
    for (let v = 0; v < r.h; v++) for (let u = 0; u < r.w; u++) {
      if (!inShape(r, u, v)) continue;
      const i = r.x + u, j = r.y + v;
      if (inside(i, j)) { g[j * W + i] = T_FLOOR; rid[j * W + i] = idx; }
    }
  });
  if (boss) corridor(rooms[0], rooms[1], 4);
  else {
    const conn = [0], rest = [];
    for (let i = 1; i < rooms.length; i++) rest.push(i);
    while (rest.length) {
      let best = null, bd = 1e9;
      for (const a of conn) for (const b of rest) {
        const A = center(rooms[a]), B = center(rooms[b]);
        const d = Math.abs(A.x - B.x) + Math.abs(A.y - B.y);
        if (d < bd) { bd = d; best = [a, b]; }
      }
      corridor(rooms[best[0]], rooms[best[1]], 3);
      conn.push(best[1]); rest.splice(rest.indexOf(best[1]), 1);
    }
    for (let k = 0; k < 2; k++) {
      const a = rng.int(0, rooms.length - 1), b = rng.int(0, rooms.length - 1);
      if (a !== b) corridor(rooms[a], rooms[b], 3);
    }
  }
  const start = center(rooms[0]);
  const ec = center(rooms[exitRoom]);
  const nearKey = (i, j, d) => (Math.abs(i - start.x) <= d && Math.abs(j - start.y) <= d) || (Math.abs(i - ec.x) <= d && Math.abs(j - ec.y) <= d);

  // ---- connectivity check: every floor tile reachable from the start ----
  const connected = () => {
    const seen = new Uint8Array(N); const q = [start.y * W + start.x]; seen[q[0]] = 1;
    let total = 0; for (let k = 0; k < N; k++) if (g[k] === T_FLOOR) total++;
    for (let h = 0; h < q.length; h++) {
      const k = q[h];
      for (const n of [k + 1, k - 1, k + W, k - W]) if (g[n] === T_FLOOR && !seen[n]) { seen[n] = 1; q.push(n); }
    }
    return q.length === total;
  };

  const solids = [], traps = [], plates = [], shrines = [];
  const qOf = x => ((x % 8) + 8) % 8;
  const addTrap = (k, type, q) => { if (g[k] !== T_FLOOR || tt[k]) return; tt[k] = type; tq[k] = qOf(q); traps.push({ t: type, k, i: k % W, j: (k / W) | 0, q: qOf(q) }); };
  const addSolid = (i, j, t, onCorr) => { const k = j * W + i; if (g[k] !== T_FLOOR || (corr[k] && !onCorr) || nearKey(i, j, 2)) return false; g[k] = T_SOLID; solids.push({ t, i, j }); return true; };
  const slowBlob = (ci, cj, rr) => {
    for (let j = Math.floor(cj - rr); j <= cj + rr; j++) for (let i = Math.floor(ci - rr); i <= ci + rr; i++) {
      if (!inside(i, j)) continue;
      const k = j * W + i; if (g[k] !== T_FLOOR || tt[k] || nearKey(i, j, 2)) continue;
      const d = Math.hypot(i - ci, j - cj) + (((i * 7 + j * 13) % 5) / 10);
      if (d <= rr) tt[k] = TT_SLOW;
    }
  };
  const trapKind = theme.traps.includes('vent') && theme.traps[0] === 'vent' ? 'vent' : (theme.traps.includes('vent') && rng() < 0.4 ? 'vent' : 'spike');
  const statue = { desert: 'obelisk', crypt: 'coffin', jungle: 'idol', lava: 'anvil', ice: 'crystal', sky: 'column', mushroom: 'shroom', pirate: 'cannon' }[theme.deco] || 'column';

  rooms.forEach((r, idx) => {
    if (idx === 0) return;
    const gs = g.slice(), ts = tt.slice(), nS = solids.length, nT = traps.length, nSh = shrines.length;
    const loc = (u, v) => (r.y + v) * W + r.x + u;
    const c = center(r);
    if (r.arena) {
      for (const [px, py] of [[6, 6], [r.w - 8, 6], [6, r.h - 8], [r.w - 8, r.h - 8]]) {
        for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) g[loc(px + ox, py + oy)] = T_WALL;
      }
      return;
    }
    switch (r.kind) {
      case 'chasm': {
        const style = r.w >= 11 && r.h >= 11 ? (rng() < 0.5 ? 'plus' : 'island') : (r.w >= r.h ? 'h' : 'v');
        r.bridge = style;
        for (let v = 1; v < r.h - 1; v++) for (let u = 1; u < r.w - 1; u++) {
          const k = loc(u, v); if (g[k] !== T_FLOOR) continue;
          const du = Math.abs(r.x + u - c.x), dv = Math.abs(r.y + v - c.y);
          let keep = false;
          if (style === 'plus' || style === 'island') keep = du <= 1 || dv <= 1;
          if (style === 'h') keep = dv <= 1;
          if (style === 'v') keep = du <= 1;
          if (style === 'island' && du <= 2 && dv <= 2) keep = true;
          if (!keep) g[k] = T_PIT;
        }
        if (style === 'island') addSolid(c.x, c.y, statue);
        break;
      }
      case 'traps': {
        const horiz = r.w >= r.h;
        for (let v = 0; v < r.h; v++) for (let u = 0; u < r.w; u++) {
          const k = loc(u, v), i = r.x + u, j = r.y + v;
          if (nearKey(i, j, 2)) continue;
          const a = horiz ? v : u, b = horiz ? u : v;
          if (trapKind === 'vent') { if (a % 3 === 1 && b % 3 === 1) addTrap(k, TT_VENT, (a + b) / 3 * 2); }
          else if (Math.floor(a / 2) % 2 === 1 && a < (horiz ? r.h : r.w) - 1) addTrap(k, TT_SPIKE, Math.floor(a / 2) * 3);
        }
        break;
      }
      case 'shrine': {
        if (!addSolid(c.x, c.y, 'fountain', true)) break;
        for (let j = c.y - 3; j <= c.y + 3; j++) for (let i = c.x - 3; i <= c.x + 3; i++) {
          const k = j * W + i; if (inside(i, j) && g[k] === T_FLOOR && Math.hypot(i - c.x, j - c.y) <= 2.6) tt[k] = TT_SHRINE;
        }
        shrines.push({ x: (c.x + 0.5) * TILE, z: (c.y + 0.5) * TILE, r: 2.6 * TILE, room: idx });
        break;
      }
      case 'vault': case 'storage': case 'arena': break;
      default: {
        if (r.shape === 'hall') {
          for (let u = 2; u < r.w - 2; u += 3) for (const v of [2, r.h - 3]) addSolid(r.x + u, r.y + v, 'column');
        } else if (r.w >= 10 && r.h >= 9 && rng() < 0.7) {
          const asStatue = rng() < 0.45;
          for (const [px, py] of [[2, 2], [r.w - 3, 2], [2, r.h - 3], [r.w - 3, r.h - 3]]) {
            const k = loc(px, py);
            if (corr[k] || g[k] !== T_FLOOR) continue;
            if (asStatue) addSolid(r.x + px, r.y + py, statue); else g[k] = T_WALL;
          }
        }
        if (r.kind === 'normal' && rng() < 0.4) slowBlob(r.x + rng.int(2, r.w - 3), r.y + rng.int(2, r.h - 3), rng.range(1.4, 2.6));
      }
    }
    if (!connected()) { g.set(gs); tt.set(ts); solids.length = nS; traps.length = nT; shrines.length = nSh; if (r.kind !== 'exit') r.kind = 'normal'; r.bridge = null; }
  });

  if (!boss) {
    // spike / vent strips across corridors
    const nStrip = Math.min(5, 2 + Math.floor(floor / 3));
    const picked = [];
    for (let t = 0; t < 400 && picked.length < nStrip; t++) {
      const i = rng.int(2, W - 3), j = rng.int(2, H - 3);
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) { const k = (j + dy) * W + i + dx; if (!corr[k] || rid[k] >= 0 || g[k] !== T_FLOOR || tt[k]) { ok = false; break; } }
      if (!ok || nearKey(i, j, 6) || picked.some(p => Math.abs(p[0] - i) + Math.abs(p[1] - j) < 9)) continue;
      picked.push([i, j]);
      const vent = theme.traps.includes('vent') && rng() < 0.5;
      const horiz = g[j * W + i - 2] === T_FLOOR && g[j * W + i + 2] === T_FLOOR; // corridor runs left-right
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = (j + dy) * W + i + dx;
        if (vent) { if (dx === 0 && dy === 0) addTrap(k, TT_VENT, i + j); }
        else if (horiz ? dx === 0 : dy === 0) addTrap(k, TT_SPIKE, (horiz ? i : j) * 3);
      }
    }
    // pressure plates that fire arrows out of a wall slit
    if (theme.traps.includes('plate')) {
      const nPl = 2 + Math.min(3, Math.floor(floor / 4));
      for (let t = 0; t < 500 && plates.length < nPl; t++) {
        const i = rng.int(2, W - 3), j = rng.int(2, H - 3), k = j * W + i;
        if (g[k] !== T_FLOOR || tt[k] || nearKey(i, j, 5) || plates.some(p => Math.abs(p.i - i) + Math.abs(p.j - j) < 10)) continue;
        if (g[k - 1] !== T_FLOOR || g[k + 1] !== T_FLOOR || g[k - W] !== T_FLOOR || g[k + W] !== T_FLOOR) continue;
        const dirs = [[0, -1], [-1, 0], [1, 0], [0, 1]];
        const [dx, dy] = dirs[rng.int(0, 3)];
        let li = -1, lj = -1;
        for (let s = 1; s <= 7; s++) { const x = i + dx * s, y = j + dy * s; if (!inside(x, y)) break; const v = g[y * W + x]; if (v === T_WALL) { li = x; lj = y; break; } if (v !== T_FLOOR) break; }
        if (li < 0 || Math.abs(li - i) + Math.abs(lj - j) < 3) continue;
        tt[k] = TT_PLATE;
        plates.push({ i, j, k, li, lj, dx: -dx, dz: -dy });
      }
    }
  }
  // final safety net (should never trigger): drop everything that blocks
  if (!connected()) {
    for (let k = 0; k < N; k++) if (g[k] === T_PIT || g[k] === T_SOLID) g[k] = T_FLOOR;
    solids.length = 0;
  }

  // deterministic decorations
  const deco = [];
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const k = j * W + i;
    if (g[k] === T_WALL) {
      // wall decorations on walls facing the camera (floor to the south)
      if (g[k + W] === T_FLOOR) {
        const x = rng();
        if (x < 0.075) deco.push({ t: 'torch', i, j });
        else if (x < 0.2) deco.push({ t: 'wall', i, j, v: rng() });
      }
    } else if (g[k] === T_FLOOR && !corr[k] && !tt[k] && rng() < 0.035) {
      if (!nearKey(i, j, 3)) deco.push({ t: 'prop', i, j, v: rng(), rot: rng() * 6.28 });
    }
  }

  const tc = (cc) => ({ x: (cc.x + 0.5) * TILE, z: (cc.y + 0.5) * TILE });
  return {
    seed, floor, boss, W, H, g, rooms, deco, corr, tt, tq, rid, traps, plates, shrines, solids,
    start: tc(start), exit: tc(ec), exitRoom,
    roomWorld: r => ({ x0: r.x * TILE, z0: r.y * TILE, x1: (r.x + r.w) * TILE, z1: (r.y + r.h) * TILE }),
  };
}

// ---------- collision ----------
// walking: only floor tiles are walkable (walls, pits and statues block)
function isWallAt(map, wx, wz) {
  const i = Math.floor(wx / TILE), j = Math.floor(wz / TILE);
  if (i < 0 || j < 0 || i >= map.W || j >= map.H) return true;
  return map.g[j * map.W + i] !== T_FLOOR;
}
// projectiles: only walls and statues stop them (they fly over pits)
function isSolidAt(map, wx, wz) {
  const i = Math.floor(wx / TILE), j = Math.floor(wz / TILE);
  if (i < 0 || j < 0 || i >= map.W || j >= map.H) return true;
  const v = map.g[j * map.W + i];
  return v === T_WALL || v === T_SOLID;
}
function isWalkTile(map, k) { return map.g[k] === T_FLOOR; }
function terrainAt(map, wx, wz) {
  if (!map.tt) return 0;
  const i = Math.floor(wx / TILE), j = Math.floor(wz / TILE);
  if (i < 0 || j < 0 || i >= map.W || j >= map.H) return 0;
  return map.tt[j * map.W + i];
}
function blockedCircle(map, x, z, r) {
  const steps = Math.max(1, Math.ceil((2 * r) / 1.5));
  for (let a = 0; a <= steps; a++) {
    const t = -r + (2 * r * a) / steps;
    if (isWallAt(map, x + t, z - r) || isWallAt(map, x + t, z + r) || isWallAt(map, x - r, z + t) || isWallAt(map, x + r, z + t)) return true;
  }
  return false;
}
function moveCircle(map, o, dx, dz, r) {
  let hit = false;
  // sticky floor (quicksand, webs, mud, snow...) slows everyone that walks through it
  if (map.tt && terrainAt(map, o.x, o.z) === TT_SLOW) { dx *= 0.55; dz *= 0.55; }
  // sub-step large moves so nothing tunnels through walls
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.7));
  for (let s = 0; s < n; s++) {
    if (!blockedCircle(map, o.x + dx / n, o.z, r)) o.x += dx / n; else hit = true;
    if (!blockedCircle(map, o.x, o.z + dz / n, r)) o.z += dz / n; else hit = true;
  }
  return hit;
}
function tileOf(map, x, z) { return Math.floor(z / TILE) * map.W + Math.floor(x / TILE); }

// ---------- level mesh ----------
const _m4 = new THREE.Matrix4(), _col = new THREE.Color(), _q = new THREE.Quaternion(), _v3 = new THREE.Vector3(), _s3 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
// collects lots of boxes and turns them into one InstancedMesh (one draw call)
function BoxBatch(mat) {
  const list = [];
  return {
    list,
    add(color, sx, sy, sz, x, y, z, ry, vary) { list.push([color, sx, sy, sz, x, y, z, ry || 0, vary || 0]); },
    build(grp, rng) {
      if (!list.length) return null;
      const m = new THREE.InstancedMesh(BOXG, mat, list.length);
      list.forEach((b, n) => {
        _q.setFromAxisAngle(_up, b[7]); _s3.set(b[1], b[2], b[3]); _v3.set(b[4], b[5], b[6]);
        _m4.compose(_v3, _q, _s3); m.setMatrixAt(n, _m4);
        _col.setHex(b[0]); if (b[8] && rng) _col.offsetHSL(0, 0, (rng() - 0.5) * b[8]);
        m.setColorAt(n, _col);
      });
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.frustumCulled = false;
      grp.add(m);
      return m;
    },
  };
}
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

function buildLevel(map, theme) {
  const grp = new THREE.Group();
  const { W, H, g, tt } = map;
  const rng = RNG(map.seed ^ 0x9e3779b9);
  const L = BoxBatch(new THREE.MeshLambertMaterial());           // lit static boxes
  const E = BoxBatch(new THREE.MeshBasicMaterial());             // glowing static boxes
  const A = BoxBatch(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false })); // translucent overlays
  const anim = { spikes: [], vents: [], glow: [], torches: null, shrine: [], clouds: [] };
  const deco = theme.deco, P = theme.pit;
  const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H) ? T_WALL : g[j * W + i];
  const walk = (i, j) => { const v = at(i, j); return v === T_FLOOR || v === T_SOLID; };
  const roomOf = k => map.rid && map.rid[k] >= 0 ? map.rooms[map.rid[k]] : null;
  const hash = (i, j) => { let h = (i * 374761393 + j * 668265263) ^ map.seed; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const blob = (i, j, s) => (hash(Math.floor(i / s), Math.floor(j / s)) + hash(Math.floor((i + 2) / s), Math.floor((j + 1) / s))) / 2;

  // ---- floor tiles ----
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, v = g[k];
    if (v !== T_FLOOR && v !== T_SOLID) continue;
    const x = (i + 0.5) * TILE, z = (j + 0.5) * TILE;
    const r = roomOf(k), kind = r ? r.kind : 'corr';
    let c = ((i + j) & 1) ? theme.floor : theme.floor2, vary = 0.05, gap = 0.98;
    switch (theme.pattern) {
      case 'slabs': c = (((i >> 1) + (j >> 1)) & 1) ? theme.floor : theme.floor2; gap = 0.94; break;
      case 'cracks': c = mix(theme.floor, theme.floor2, hash(i, j)); vary = 0.03; gap = 1.0; break;
      case 'moss': c = blob(i, j, 3) > 0.62 ? mix(theme.floor, deco === 'mushroom' ? 0x2fbfa0 : 0x4f8a2a, 0.55) : (((i + j) & 1) ? theme.floor : theme.floor2); gap = 0.95; break;
      case 'basalt': c = hash(i, j) < 0.5 ? theme.floor : theme.floor2; gap = 0.9; break;
      case 'ice': c = blob(i, j, 4) > 0.55 ? mix(theme.floor, 0xffffff, 0.35) : theme.floor; vary = 0.03; gap = 0.99; break;
      case 'marble': c = ((i + j) & 1) ? theme.floor : theme.floor2; gap = 0.97; break;
      case 'planks': c = mix(theme.floor, theme.floor2, hash(0, j) * 0.8 + hash(i >> 1, j) * 0.2); vary = 0.06; break;
    }
    if (kind === 'corr' && theme.pattern !== 'planks') c = shade(c, 0.93);
    if (kind === 'vault') c = ((i + j) & 1) ? 0xd9b23a : 0xc49a2a;
    if (kind === 'traps') c = shade(c, 0.85);
    if (tt[k] === TT_SHRINE) c = ((i + j) & 1) ? 0xbfe8ff : 0x8fd0f0;
    // tiles next to a pit become tall cliff blocks so the chasm reads as deep
    let cliff = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(i + dx, j + dy) === T_PIT) cliff = true;
    if (cliff) L.add(c, TILE * gap, 3.0, TILE * gap, x, -1.5, z, 0, vary);
    else L.add(c, TILE * gap, 0.3, TILE * gap, x, -0.15, z, 0, vary);
    // pattern details
    if (theme.pattern === 'cracks' && hash(i + 7, j) < 0.12) { L.add(shade(c, 0.75), 1.1, 0.02, 0.08, x, 0.01, z, hash(i, j + 3) * 3); L.add(shade(c, 0.75), 0.6, 0.02, 0.08, x + 0.3, 0.01, z + 0.2, hash(i, j + 5) * 3); }
    if (theme.pattern === 'basalt' && hash(i + 3, j + 1) < 0.1) E.add(0xff6a00, 1.2, 0.02, 0.08, x, 0.01, z, hash(i, j) * 3);
    if (theme.pattern === 'marble' && (i % 4 === 0 && j % 4 === 0)) L.add(0xffc72c, 0.4, 0.02, 0.4, x, 0.01, z, 0.785);
    if (theme.pattern === 'planks') L.add(shade(c, 0.7), TILE, 0.02, 0.06, x, 0.01, z - TILE * 0.49 + (j & 1) * 0.02);
    if (theme.pattern === 'ice' && hash(i, j + 9) < 0.05) L.add(0xffffff, 0.9, 0.02, 0.05, x, 0.01, z, hash(i + 1, j) * 3);
    // puddles
    if ((deco === 'jungle' || deco === 'crypt' || deco === 'pirate') && !tt[k] && v === T_FLOOR && blob(i + 11, j + 5, 2) > 0.8 && hash(i, j + 1) < 0.6) A.add(deco === 'jungle' ? 0x3a8a9a : 0x5a7a9a, 1.7, 0.02, 1.5, x, 0.02, z, hash(i, j) * 0.5);
    // carpets / runners down the middle of corridors
    if (kind === 'corr' && map.corr[k] && walk(i - 1, j) && walk(i + 1, j) && walk(i, j - 1) && walk(i, j + 1) && !tt[k]) {
      const hz = map.corr[k - 1] && map.corr[k + 1] && !(map.corr[k - W] && map.corr[k + W] && map.corr[k - W - 1] === 0);
      const ver = map.corr[k - W] && map.corr[k + W] && !(map.corr[k - 1] && map.corr[k + 1]);
      const sx = ver ? 1.3 : TILE, sz = hz && !ver ? 1.3 : TILE;
      if (deco === 'desert') A.add(0xf2dfa8, sx, 0.02, sz, x, 0.015, z);
      else if (deco !== 'jungle' && deco !== 'ice') {
        L.add(theme.carpet2, sx + (ver ? 0.16 : 0), 0.025, sz + (hz && !ver ? 0.16 : 0), x, 0.012, z);
        L.add(theme.carpet, sx - (ver ? 0.1 : 0), 0.03, sz - (hz && !ver ? 0.1 : 0), x, 0.016, z);
      }
    }
    // slow terrain overlays
    if (tt[k] === TT_SLOW) {
      const sc = theme.slow.c;
      if (theme.slow.web) {
        A.add(0xffffff, 0.06, 0.03, 2.0, x, 0.03, z, 0.785); A.add(0xffffff, 0.06, 0.03, 2.0, x, 0.03, z, -0.785);
        A.add(0xffffff, 0.06, 0.03, 2.0, x, 0.03, z, 0); A.add(0xffffff, 2.0, 0.03, 0.06, x, 0.03, z, 0);
        L.add(0x9a9aa8, 2.0, 0.015, 2.0, x, 0.006, z);
      } else {
        L.add(sc, TILE, 0.04, TILE, x, 0.02, z, 0, 0.06);
        if (hash(i, j + 2) < 0.5) L.add(shade(sc, deco === 'ice' || deco === 'sky' ? 0.92 : 1.25), 0.7, 0.12, 0.6, x + (hash(i, j) - 0.5), 0.06, z + (hash(j, i) - 0.5), hash(i, j) * 3);
        if (deco === 'pirate') for (let s = 0; s < 3; s++) L.add(0x2f6a2a, 0.1, 0.5, 0.1, x + (hash(i + s, j) - 0.5) * 1.4, 0.25, z + (hash(i, j + s) - 0.5) * 1.4);
      }
    }
  }

  // ---- pits (chasm / lava / water / sky) ----
  let nPit = 0;
  for (let k = 0; k < W * H; k++) if (g[k] === T_PIT) nPit++;
  if (nPit) {
    const glow = !!P.glow, sky = !!P.sky;
    const depth = glow ? -0.55 : sky ? -30 : deco === 'crypt' ? -4.5 : -1.6;
    const pm = glow ? new THREE.MeshBasicMaterial({ color: P.c }) : new THREE.MeshLambertMaterial({ color: P.c });
    const pit = new THREE.InstancedMesh(BOXG, pm, nPit); pit.frustumCulled = false;
    let n = 0;
    for (let k = 0; k < W * H; k++) {
      if (g[k] !== T_PIT) continue;
      const i = k % W, j = (k / W) | 0, x = (i + 0.5) * TILE, z = (j + 0.5) * TILE;
      _m4.makeScale(TILE, 0.2, TILE); _m4.setPosition(x, depth, z);
      pit.setMatrixAt(n, _m4); _col.setHex(sky ? 0xffffff : P.c); _col.offsetHSL(0, 0, (rng() - 0.5) * 0.06); pit.setColorAt(n++, _col);
      // texture on the surface
      if (glow && hash(i, j) < 0.25) L.add(shade(P.c, 0.25), 0.5 + hash(j, i), 0.12, 0.5 + hash(i + 1, j), x + (hash(i, j + 1) - 0.5), depth + 0.1, z + (hash(i + 2, j) - 0.5), hash(i, j) * 3);
      if (!glow && !sky && hash(i, j) < 0.3) L.add(P.c2, 0.8, 0.05, 0.12, x, depth + 0.11, z + (hash(j, i) - 0.5), 0);
      if (sky && hash(i, j) < 0.35) { const cl = new THREE.Mesh(BOXG, anim.cloudMat || (anim.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }))); cl.scale.set(1.5 + hash(i, j) * 2, 0.6, 1.2 + hash(j, i)); cl.position.set(x, -6 - hash(i + 1, j) * 4, z); grp.add(cl); anim.clouds.push(cl); }
    }
    if (sky) pit.visible = false;
    if (pit.instanceColor) pit.instanceColor.needsUpdate = true;
    pit.instanceMatrix.needsUpdate = true;
    grp.add(pit);
    if (glow) anim.glow.push({ mat: pm, c: P.c, c2: P.c2 });
  }

  // ---- walls ----
  const WH = 2.0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (g[k] !== T_WALL) continue;
    let adj = false;
    for (let dy = -1; dy <= 1 && !adj; dy++) for (let dx = -1; dx <= 1; dx++) { const v = at(i + dx, j + dy); if (v !== T_WALL) { adj = true; break; } }
    if (!adj) continue;
    const x = (i + 0.5) * TILE, z = (j + 0.5) * TILE;
    let hh = WH + (rng() < 0.15 ? 0.3 : 0);
    const st = theme.walls;
    if (st === 'cave' || st === 'glow') hh = 1.6 + hash(i, j) * 1.1;
    if (st === 'basalt') hh = 1.8 + Math.floor(hash(i, j) * 3) * 0.3;
    // lowered, broken wall segments on walls facing the camera keep the view open
    const front = at(i, j + 1) === T_FLOOR;
    if (front && st !== 'cave' && hash(i + 5, j) < 0.06) hh = 0.9;
    const wc = st === 'brick' && ((i + (j & 1)) & 1) ? shade(theme.wall, 0.94) : theme.wall;
    L.add(wc, TILE, hh, TILE, x, hh / 2, z, 0, 0.08);
    L.add(theme.top, TILE * 1.001, 0.12, TILE * 1.001, x, hh + 0.06, z, 0, 0.05);
    if (st === 'brick' && front) { L.add(shade(theme.wall, 0.8), TILE * 1.002, 0.08, 0.04, x, 0.7, z + 1.0); L.add(shade(theme.wall, 0.8), TILE * 1.002, 0.08, 0.04, x, 1.4, z + 1.0); }
    if (st === 'basalt' && front && hash(i, j + 1) < 0.2) E.add(0xff5a00, 0.08, hh * 0.7, 0.04, x + (hash(i, j) - 0.5) * 1.2, hh * 0.4, z + 1.01);
  }

  // ---- wall decorations (on camera-facing walls) ----
  const torches = map.deco.filter(d => d.t === 'torch');
  if (torches.length) {
    const flame = new THREE.InstancedMesh(BOXG, new THREE.MeshBasicMaterial({ color: theme.light }), torches.length);
    flame.frustumCulled = false;
    torches.forEach((d, n) => {
      const x = (d.i + 0.5) * TILE, z = (d.j + 1) * TILE + 0.12;
      L.add(0x4a3420, 0.2, 0.5, 0.2, x, 1.3, z);
      L.add(0x2a2018, 0.4, 0.08, 0.3, x, 1.55, z);
      _m4.makeScale(0.3, 0.35, 0.3); _m4.setPosition(x, 1.72, z); flame.setMatrixAt(n, _m4);
    });
    grp.add(flame);
    anim.torches = flame;
  }
  for (const d of map.deco) {
    if (d.t !== 'wall') continue;
    const x = (d.i + 0.5) * TILE, z = (d.j + 1) * TILE + 0.04, v = d.v;
    switch (theme.walls) {
      case 'brick': // desert: blue/gold banners and hieroglyph plaques
        if (v < 0.4) { L.add(theme.accent, 0.9, 1.3, 0.05, x, 1.25, z); L.add(0xffc72c, 0.9, 0.12, 0.06, x, 1.85, z); L.add(0xffc72c, 0.25, 0.25, 0.06, x, 1.2, z + 0.01); }
        else { L.add(shade(theme.wall, 0.75), 1.2, 0.8, 0.04, x, 1.2, z); for (let s = 0; s < 3; s++) L.add(0x3a2a1a, 0.15, 0.2, 0.05, x - 0.35 + s * 0.35, 1.2 + (s & 1) * 0.15, z + 0.01); }
        break;
      case 'bone': // crypt: skulls and purple drapes
        if (v < 0.5) { L.add(0xe9e9e0, 0.36, 0.32, 0.3, x, 1.2, z + 0.12); E.add(0xff3030, 0.08, 0.06, 0.02, x - 0.08, 1.24, z + 0.28); E.add(0xff3030, 0.08, 0.06, 0.02, x + 0.08, 1.24, z + 0.28); L.add(0xe9e9e0, 0.7, 0.08, 0.1, x, 0.95, z + 0.05, 0.5); L.add(0xe9e9e0, 0.7, 0.08, 0.1, x, 0.95, z + 0.05, -0.5); }
        else { L.add(theme.accent, 1.0, 1.4, 0.05, x, 1.2, z); L.add(0xc9a227, 1.05, 0.1, 0.07, x, 1.9, z); }
        break;
      case 'vine': // jungle: hanging vines + leaves
        for (let s = 0; s < 3; s++) { const hx = x - 0.6 + s * 0.6 + (v - 0.5) * 0.2, len = 0.8 + hash(d.i + s, d.j) * 1.2; L.add(0x2f7a2a, 0.12, len, 0.06, hx, 2.0 - len / 2, z); L.add(0x4fa83a, 0.3, 0.2, 0.08, hx, 2.0 - len, z + 0.02); }
        if (v < 0.25) { L.add(0x9a7a4a, 0.6, 0.6, 0.06, x, 1.2, z); E.add(0x3dff8a, 0.12, 0.08, 0.02, x - 0.12, 1.3, z + 0.04); E.add(0x3dff8a, 0.12, 0.08, 0.02, x + 0.12, 1.3, z + 0.04); }
        break;
      case 'basalt': // lava: glowing cracks and iron chains
        if (v < 0.5) { E.add(0xff6a00, 0.1, 1.2, 0.03, x - 0.3, 1.0, z, 0.3); E.add(0xff8a00, 0.1, 0.8, 0.03, x + 0.2, 1.2, z, -0.4); }
        else { for (let s = 0; s < 5; s++) L.add(0x2a2a2e, 0.12, 0.16, 0.12, x, 1.9 - s * 0.2, z + 0.06, s * 0.8); L.add(0x3a3a40, 0.3, 0.3, 0.12, x, 0.95, z + 0.06); }
        break;
      case 'crystal': // frost: icy crystal clusters
        E.add(0x9ff0ff, 0.25, 0.9, 0.25, x - 0.2, 0.6, z + 0.1, 0.4); E.add(0xdffaff, 0.18, 0.6, 0.18, x + 0.15, 0.45, z + 0.12, -0.3); L.add(0xdcefff, 0.8, 0.12, 0.3, x, 1.95, z + 0.05);
        for (let s = 0; s < 3; s++) L.add(0xeaf8ff, 0.1, 0.35 + s * 0.1, 0.1, x - 0.4 + s * 0.4, 1.8 - s * 0.05, z + 0.05);
        break;
      case 'banner': // sky castle: royal banners and windows
        if (v < 0.55) { L.add(theme.carpet, 0.8, 1.5, 0.05, x, 1.15, z); L.add(0xffc72c, 0.85, 0.1, 0.07, x, 1.9, z); L.add(0xffc72c, 0.3, 0.3, 0.07, x, 1.25, z + 0.01, 0.785); }
        else { E.add(0xbfe4ff, 0.7, 1.0, 0.04, x, 1.2, z); L.add(0xffffff, 0.08, 1.0, 0.06, x, 1.2, z + 0.01); L.add(0xffffff, 0.7, 0.08, 0.06, x, 1.2, z + 0.01); }
        break;
      case 'glow': // mushroom: glowing shelf fungus
        for (let s = 0; s < 3; s++) { const c = s & 1 ? 0x3affc0 : 0xd05aff; E.add(c, 0.5 - s * 0.08, 0.08, 0.35, x - 0.4 + s * 0.4, 0.6 + s * 0.45 + v * 0.3, z + 0.15); }
        break;
      case 'cave': // pirate: lanterns, anchors, nets
        if (v < 0.35) { L.add(0x3a3a3a, 0.12, 1.0, 0.1, x, 1.2, z + 0.05); L.add(0x3a3a3a, 0.7, 0.12, 0.1, x, 1.5, z + 0.05); L.add(0x3a3a3a, 0.8, 0.12, 0.1, x, 0.75, z + 0.05); }
        else if (v < 0.6) { for (let s = 0; s < 4; s++) { L.add(0x8a7a5a, 0.04, 1.2, 0.03, x - 0.45 + s * 0.3, 1.2, z); L.add(0x8a7a5a, 1.0, 0.04, 0.03, x, 0.75 + s * 0.3, z); } }
        else { L.add(0x5a3a1a, 0.9, 0.12, 0.3, x, 1.0, z + 0.1); L.add(0xffc72c, 0.2, 0.12, 0.2, x - 0.2, 1.12, z + 0.1); L.add(0x7a5a3a, 0.3, 0.3, 0.25, x + 0.2, 1.21, z + 0.1); }
        break;
    }
  }

  // ---- floor props (non-blocking scenery) ----
  const kinds = {
    desert:   [[0x3f8f3a, 0.5, 1.4, 0.5], [0xefe6cc, 0.7, 0.25, 0.4], [0xb5743a, 0.6, 0.8, 0.6], [0xd8c090, 0.9, 0.12, 0.9]],
    crypt:    [[0xe6e6dc, 0.7, 0.25, 0.4], [0x5b4636, 0.9, 0.5, 1.6], [0x8a8f99, 0.5, 0.9, 0.5], [0xf0f0e0, 0.35, 0.3, 0.35]],
    jungle:   [[0x2f8a2a, 0.9, 0.5, 0.9], [0x5a8a2a, 0.3, 1.1, 0.3], [0xd04a8a, 0.35, 0.35, 0.35], [0x6a4a2a, 1.2, 0.2, 0.3]],
    lava:     [[0xff5a00, 1.6, 0.06, 1.6], [0x1f1715, 0.6, 0.7, 0.6], [0xff8c1a, 1.2, 0.06, 1.2], [0x2a2a2e, 0.8, 0.4, 0.5]],
    ice:      [[0x9fe6ff, 0.4, 1.3, 0.4], [0xe8f7ff, 0.8, 0.4, 0.8], [0x6ad0ff, 0.3, 0.9, 0.3], [0xffffff, 1.0, 0.15, 0.8]],
    sky:      [[0xffffff, 1.1, 0.4, 0.8], [0xffc72c, 0.4, 0.6, 0.4], [0xd8d4e4, 0.6, 0.3, 0.6], [0x7ad07a, 0.5, 0.5, 0.5]],
    mushroom: [[0xd05aff, 0.3, 0.6, 0.3], [0x3affc0, 0.25, 0.4, 0.25], [0x5a4a70, 0.8, 0.3, 0.6], [0xff5a8a, 0.35, 0.5, 0.35]],
    pirate:   [[0xffc72c, 0.6, 0.15, 0.6], [0x8a7a5a, 0.7, 0.2, 0.7], [0x7a5a3a, 0.5, 0.6, 0.5], [0xe8e6da, 0.6, 0.2, 0.3]],
  }[deco] || [[0x888888, 0.5, 0.5, 0.5]];
  const glowProp = (kd) => (deco === 'lava' && kd[2] < 0.1) || (deco === 'mushroom' && kd[0] !== 0x5a4a70);
  for (const p of map.deco) {
    if (p.t !== 'prop') continue;
    const kd = kinds[Math.floor(p.v * kinds.length)];
    const x = (p.i + 0.5) * TILE, z = (p.j + 0.5) * TILE;
    (glowProp(kd) ? E : L).add(kd[0], kd[1], kd[2], kd[3], x, kd[2] / 2 + 0.01, z, p.rot, 0.06);
    if (deco === 'mushroom' && kd[2] > 0.35) E.add(kd[0], kd[1] * 2.4, 0.15, kd[1] * 2.4, x, kd[2] + 0.05, z, p.rot); // little mushroom caps
    if (deco === 'jungle' && kd[1] === 0.3) L.add(0x3fa83a, 0.9, 0.08, 0.3, x, 1.1, z, p.rot);
  }

  // ---- solid scenery: statues, columns, fountains (block walking) ----
  for (const s of map.solids) {
    const x = (s.i + 0.5) * TILE, z = (s.j + 0.5) * TILE;
    switch (s.t) {
      case 'fountain':
        L.add(0x9aa4b0, 1.9, 0.5, 1.9, x, 0.25, z); L.add(0x9aa4b0, 1.9, 0.5, 1.9, x, 0.25, z, 0.785);
        E.add(0x6fd8ff, 1.6, 0.06, 1.6, x, 0.5, z); E.add(0x6fd8ff, 1.6, 0.06, 1.6, x, 0.5, z, 0.785);
        L.add(0xc0c8d0, 0.4, 1.3, 0.4, x, 0.9, z);
        anim.shrine.push(Object.assign(new THREE.Mesh(BOXG, new THREE.MeshBasicMaterial({ color: 0x9ff7ff })), {}));
        { const gem = anim.shrine[anim.shrine.length - 1]; gem.scale.setScalar(0.45); gem.position.set(x, 1.9, z); gem.rotation.set(0.6, 0, 0.6); grp.add(gem);
          const ring = new THREE.Mesh(new THREE.RingGeometry(2.6 * TILE - 0.25, 2.6 * TILE, 40), new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.04, z); grp.add(ring); gem.userData.ring = ring; }
        break;
      case 'column':
        L.add(shade(theme.top, 0.95), 1.3, 0.3, 1.3, x, 0.15, z); L.add(theme.top, 0.9, 2.6, 0.9, x, 1.45, z, 0, 0.04); L.add(shade(theme.top, 0.95), 1.3, 0.3, 1.3, x, 2.8, z);
        if (deco === 'sky' || deco === 'crypt') L.add(theme.carpet, 0.92, 0.9, 0.05, x, 1.8, z + 0.47);
        if (deco === 'jungle') L.add(0x2f7a2a, 0.95, 1.2, 0.95, x, 1.3, z, 0.3);
        break;
      case 'obelisk': L.add(0xd8b878, 1.1, 0.4, 1.1, x, 0.2, z); L.add(0xc9a663, 0.75, 2.6, 0.75, x, 1.6, z); L.add(0xffc72c, 0.5, 0.4, 0.5, x, 3.0, z, 0.785); L.add(0x2f6fd6, 0.4, 0.4, 0.05, x, 1.8, z + 0.38); break;
      case 'coffin': L.add(0x4a3628, 1.0, 0.7, 1.8, x, 0.35, z); L.add(0x5b4636, 1.1, 0.12, 1.9, x, 0.76, z); L.add(0xc9a227, 0.14, 0.05, 0.9, x, 0.84, z); L.add(0xc9a227, 0.5, 0.05, 0.14, x, 0.84, z - 0.2); break;
      case 'idol': L.add(0x7a6a4a, 1.2, 0.5, 1.2, x, 0.25, z); L.add(0x8a7a5a, 0.9, 1.6, 0.8, x, 1.3, z); E.add(0x3dff8a, 0.18, 0.14, 0.04, x - 0.2, 1.7, z + 0.41); E.add(0x3dff8a, 0.18, 0.14, 0.04, x + 0.2, 1.7, z + 0.41); L.add(0x2f7a2a, 1.0, 0.3, 0.9, x, 2.2, z); break;
      case 'anvil': L.add(0x2a2a2e, 1.0, 0.6, 0.7, x, 0.3, z); L.add(0x3a3a40, 1.5, 0.35, 0.6, x, 0.78, z); E.add(0xff6a00, 0.5, 0.1, 0.3, x + 0.2, 0.98, z); break;
      case 'crystal': E.add(0x7fe8ff, 0.6, 2.2, 0.6, x, 1.1, z, 0.4); E.add(0xbff6ff, 0.4, 1.4, 0.4, x + 0.4, 0.7, z + 0.2, -0.3); E.add(0x4fc8ff, 0.35, 1.1, 0.35, x - 0.4, 0.55, z - 0.1, 0.9); break;
      case 'shroom': L.add(0xe8e0d0, 0.5, 1.8, 0.5, x, 0.9, z); E.add(0xd05aff, 1.8, 0.5, 1.8, x, 2.0, z); E.add(0xff9aff, 0.3, 0.1, 0.3, x + 0.4, 2.27, z + 0.3); E.add(0xff9aff, 0.3, 0.1, 0.3, x - 0.5, 2.27, z - 0.2); break;
      case 'cannon': L.add(0x6a4a2a, 1.2, 0.4, 1.0, x, 0.3, z); L.add(0x2a2a2e, 0.5, 0.5, 1.6, x, 0.75, z + 0.2); L.add(0x1a1a1e, 0.35, 0.35, 0.05, x, 0.75, z + 1.0); break;
      default: L.add(theme.top, 1, 2.5, 1, x, 1.25, z);
    }
  }

  // ---- special room dressing ----
  for (const r of map.rooms) {
    const cx = (r.x + r.w / 2) * TILE, cz = (r.y + r.h / 2) * TILE;
    if (r.kind === 'vault') {
      for (let n = 0; n < 6; n++) {
        const i = r.x + 1 + Math.floor(hash(r.x + n, r.y) * (r.w - 2)), j = r.y + 1 + Math.floor(hash(r.x, r.y + n) * (r.h - 2));
        if (at(i, j) !== T_FLOOR || tt[j * W + i]) continue;
        const x = (i + 0.5) * TILE, z = (j + 0.5) * TILE;
        L.add(0xffc72c, 1.0, 0.3, 0.9, x, 0.15, z, n); L.add(0xffd84a, 0.6, 0.25, 0.5, x, 0.4, z, n + 1);
      }
    } else if (r.kind === 'arena') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(Math.min(r.w, r.h) * 0.75, Math.min(r.w, r.h) * 0.75 + 0.35, 48), new THREE.MeshBasicMaterial({ color: 0xff4a2a, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(cx, 0.03, cz); grp.add(ring);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const i = Math.floor((cx + dx * (r.w / 2 - 1.2) * TILE) / TILE), j = Math.floor((cz + dz * (r.h / 2 - 1.2) * TILE) / TILE);
        if (at(i, j) !== T_FLOOR) continue;
        const x = (i + 0.5) * TILE, z = (j + 0.5) * TILE;
        L.add(0x3a3a3a, 0.5, 1.0, 0.5, x, 0.5, z); E.add(0xff4a2a, 0.45, 0.25, 0.45, x, 1.1, z);
      }
    } else if (r.kind === 'storage') {
      // sacks along the top wall
      for (let u = 1; u < r.w - 1; u += 2) {
        const i = r.x + u, j = r.y; if (at(i, j) !== T_FLOOR || at(i, j - 1) !== T_WALL || tt[j * W + i] || hash(i, j) < 0.4) continue;
        L.add(0xc8b08a, 0.7, 0.55, 0.6, (i + 0.5) * TILE, 0.28, j * TILE + 0.4, hash(i, j)); L.add(0xb89a70, 0.5, 0.45, 0.5, (i + 0.5) * TILE + 0.5, 0.23, j * TILE + 0.5, hash(j, i));
      }
    }
  }

  // ---- traps ----
  const spikeG = [], ventG = [], trapStyle = deco === 'ice' ? 0xdff6ff : 0xd8d8d8;
  const ventCol = deco === 'ice' ? 0x9ff0ff : deco === 'mushroom' ? 0x7dff4a : deco === 'sky' ? 0xfff07a : deco === 'crypt' ? 0x9a6aff : 0xff7a1a;
  for (const t of map.traps) (t.t === TT_SPIKE ? spikeG : ventG)[t.q] = ((t.t === TT_SPIKE ? spikeG : ventG)[t.q] || []).concat([t]);
  const coneG = new THREE.ConeGeometry(0.22, 0.9, 4);
  spikeG.forEach((list, q) => {
    if (!list) return;
    const plate = new THREE.InstancedMesh(BOXG, new THREE.MeshLambertMaterial({ color: 0x55555c }), list.length);
    const spikes = new THREE.InstancedMesh(coneG, new THREE.MeshLambertMaterial({ color: trapStyle }), list.length * 4);
    plate.frustumCulled = spikes.frustumCulled = false;
    list.forEach((t, n) => {
      const x = (t.i + 0.5) * TILE, z = (t.j + 0.5) * TILE;
      _m4.makeScale(1.8, 0.06, 1.8); _m4.setPosition(x, 0.03, z); plate.setMatrixAt(n, _m4);
      [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]].forEach(([ox, oz], s) => { _m4.makeTranslation(x + ox, 0, z + oz); spikes.setMatrixAt(n * 4 + s, _m4); });
    });
    spikes.position.y = -0.5;
    grp.add(plate, spikes);
    anim.spikes.push({ q, plate, spikes });
  });
  ventG.forEach((list, q) => {
    if (!list) return;
    const fire = new THREE.InstancedMesh(BOXG, new THREE.MeshBasicMaterial({ color: ventCol, transparent: true, opacity: 0.8, depthWrite: false }), list.length * 2);
    const glowM = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
    const grate = new THREE.InstancedMesh(BOXG, glowM, list.length);
    fire.frustumCulled = grate.frustumCulled = false;
    list.forEach((t, n) => {
      const x = (t.i + 0.5) * TILE, z = (t.j + 0.5) * TILE;
      L.add(0x3a3a3e, 1.6, 0.1, 1.6, x, 0.05, z);
      _m4.makeScale(1.1, 0.06, 1.1); _m4.setPosition(x, 0.11, z); grate.setMatrixAt(n, _m4);
      for (let b = -1; b <= 1; b++) L.add(0x55555c, 1.2, 0.08, 0.12, x, 0.15, z + b * 0.35);
      _m4.makeScale(1.0, 1, 1.0); _m4.setPosition(x, 0.5, z); fire.setMatrixAt(n * 2, _m4);
      _m4.makeScale(0.55, 1.3, 0.55); _m4.setPosition(x, 0.65, z); fire.setMatrixAt(n * 2 + 1, _m4);
    });
    grp.add(fire, grate);
    anim.vents.push({ q, fire, glowM, col: ventCol });
  });
  for (const p of map.plates) {
    const x = (p.i + 0.5) * TILE, z = (p.j + 0.5) * TILE;
    L.add(shade(theme.floor, 0.7), 1.5, 0.08, 1.5, x, 0.04, z); L.add(shade(theme.floor, 1.1), 1.2, 0.12, 1.2, x, 0.06, z);
    L.add(0x8a2a1a, 0.4, 0.13, 0.4, x, 0.07, z, 0.785);
    // arrow slit on the wall that shoots
    const lx = (p.li + 0.5) * TILE - p.dx * 1.0, lz = (p.lj + 0.5) * TILE - p.dz * 1.0;
    L.add(0x1a1a1a, p.dx ? 0.06 : 0.9, 0.3, p.dz ? 0.06 : 0.9, lx + p.dx * 0.03, 1.0, lz + p.dz * 0.03);
    L.add(0xb03a2a, p.dx ? 0.05 : 1.1, 0.08, p.dz ? 0.05 : 1.1, lx + p.dx * 0.04, 1.3, lz + p.dz * 0.04);
  }

  L.build(grp, rng); E.build(grp, rng); A.build(grp, rng);

  // exit portal
  const portal = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.28, 8, 24), new THREE.MeshBasicMaterial({ color: 0x555555 }));
  ring.position.y = 1.9;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.4, 24), new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.0, side: THREE.DoubleSide }));
  disc.position.y = 1.9;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.2, 20), new THREE.MeshLambertMaterial({ color: 0x8a8a8a }));
  pad.position.y = 0.1;
  portal.add(ring, disc, pad);
  portal.position.set(map.exit.x, 0, map.exit.z);
  portal.userData = { ring, disc };
  grp.add(portal);
  grp.userData.portal = portal;
  grp.userData.anim = anim;
  grp.userData.themeLight = theme.light;
  return grp;
}

// Animate traps, lava, torches, shrines. Call every frame with t = Date.now() / 1000 (same clock as the host's trap damage).
const _wc = new THREE.Color();
function animateLevel(level, t) {
  const A = level && level.userData.anim; if (!A) return;
  for (const s of A.spikes) {
    const st = spikeState(s.q, t);
    s.spikes.position.y = st === 0 ? -0.5 : st === 1 ? -0.22 + 0.04 * Math.sin(t * 40) : 0.42;
    s.plate.material.color.setHex(st === 1 ? ((t * 8) & 1 ? 0xff5a2a : 0x8a3a2a) : st === 2 ? 0xa02a20 : 0x55555c);
    s.spikes.material.color.setHex(st === 2 ? 0xff6a5a : 0xd8d8d8);
  }
  for (const v of A.vents) {
    const st = ventState(v.q, t);
    const f = v.fire;
    f.visible = st !== 0;
    if (st === 1) { f.scale.set(1, 0.25 + 0.1 * Math.sin(t * 30), 1); f.material.opacity = 0.5; }
    else if (st === 2) { f.scale.set(1, 2.6 + 0.4 * Math.sin(t * 25), 1); f.material.opacity = 0.85; }
    v.glowM.color.setHex(st === 0 ? 0x2a2a2a : v.col);
  }
  for (const gl of A.glow) { _wc.setHex(gl.c).lerp(_wc.clone().setHex(gl.c2), 0.5 + 0.5 * Math.sin(t * 1.7)); gl.mat.color.copy(_wc); }
  if (A.torches) A.torches.material.color.setHex(level.userData.themeLight).offsetHSL(0.01 * Math.sin(t * 9), 0, 0.06 * Math.sin(t * 13));
  for (const gem of A.shrine) { gem.rotation.y = t * 1.5; gem.position.y = 1.9 + 0.15 * Math.sin(t * 2); if (gem.userData.ring) gem.userData.ring.material.opacity = 0.35 + 0.25 * Math.sin(t * 3); }
  for (let n = 0; n < A.clouds.length; n++) { const c = A.clouds[n]; c.position.x += Math.sin(t * 0.3 + n) * 0.004; }
}
