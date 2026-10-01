// dungeon.js — deterministic procedural dungeon generation, collision, level meshes
'use strict';

function genDungeon(seed, floor) {
  const rng = RNG(seed);
  const boss = isBossFloor(floor);
  const W = boss ? 46 : 46 + Math.min(floor, 12) * 2, H = W;
  const g = new Uint8Array(W * H);
  const rooms = [];
  const corr = new Uint8Array(W * H);
  const carve = (x, y, w, h, c) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++)
      if (i > 0 && j > 0 && i < W - 1 && j < H - 1) { g[j * W + i] = 1; if (c) corr[j * W + i] = 1; }
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

  if (boss) {
    rooms.push({ x: 3, y: (H >> 1) - 4, w: 8, h: 8 });
    rooms.push({ x: 17, y: (H >> 1) - 13, w: 26, h: 26, arena: true });
    rooms.forEach(r => carve(r.x, r.y, r.w, r.h));
    corridor(rooms[0], rooms[1], 4);
  } else {
    const target = 8 + Math.min(floor, 8);
    for (let t = 0; t < 600 && rooms.length < target; t++) {
      const w = rng.int(7, 13), h = rng.int(7, 12);
      const x = rng.int(2, W - w - 3), y = rng.int(2, H - h - 3);
      if (rooms.some(r => x < r.x + r.w + 3 && x + w + 3 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y)) continue;
      rooms.push({ x, y, w, h });
    }
    rooms.forEach(r => carve(r.x, r.y, r.w, r.h));
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

  // pillars in big rooms (not start room)
  rooms.forEach((r, idx) => {
    if (idx === 0) return;
    if (r.arena) {
      for (const [px, py] of [[5, 5], [r.w - 6, 5], [5, r.h - 6], [r.w - 6, r.h - 6]]) {
        g[(r.y + py) * W + r.x + px] = 0; g[(r.y + py) * W + r.x + px + 1] = 0;
        g[(r.y + py + 1) * W + r.x + px] = 0; g[(r.y + py + 1) * W + r.x + px + 1] = 0;
      }
    } else if (r.w >= 10 && r.h >= 9 && rng() < 0.7) {
      for (const [px, py] of [[2, 2], [r.w - 3, 2], [2, r.h - 3], [r.w - 3, r.h - 3]]) {
        const k = (r.y + py) * W + r.x + px;
        if (!corr[k]) g[k] = 0;
      }
    }
  });

  // BFS from start to find farthest room for exit
  const start = center(rooms[0]);
  const dist = new Int32Array(W * H).fill(-1);
  const q = [start.y * W + start.x]; dist[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const k = q[h], x = k % W, y = (k / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (y + dy) * W + x + dx;
      if (g[n] && dist[n] < 0) { dist[n] = dist[k] + 1; q.push(n); }
    }
  }
  let exitRoom = 1, bestD = -1;
  rooms.forEach((r, i) => {
    if (i === 0) return;
    const c = center(r); const d = dist[c.y * W + c.x];
    if (d > bestD) { bestD = d; exitRoom = i; }
  });
  if (boss) exitRoom = 1;
  const ec = center(rooms[exitRoom]);

  // deterministic decorations
  const deco = [];
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const k = j * W + i;
    if (g[k] === 0) {
      // torch on a wall that faces floor to the south (visible to camera)
      if (g[k + W] === 1 && rng() < 0.07) deco.push({ t: 'torch', i, j });
    } else if (!corr[k] && rng() < 0.035) {
      const near0 = Math.abs(i - start.x) < 4 && Math.abs(j - start.y) < 4;
      const nearE = Math.abs(i - ec.x) < 3 && Math.abs(j - ec.y) < 3;
      if (!near0 && !nearE) deco.push({ t: 'prop', i, j, v: rng(), rot: rng() * 6.28 });
    }
  }

  const tc = (c) => ({ x: (c.x + 0.5) * TILE, z: (c.y + 0.5) * TILE });
  return {
    seed, floor, boss, W, H, g, rooms, deco, corr,
    start: tc(start), exit: tc(ec), exitRoom,
    roomWorld: r => ({ x0: r.x * TILE, z0: r.y * TILE, x1: (r.x + r.w) * TILE, z1: (r.y + r.h) * TILE }),
  };
}

function isWallAt(map, wx, wz) {
  const i = Math.floor(wx / TILE), j = Math.floor(wz / TILE);
  if (i < 0 || j < 0 || i >= map.W || j >= map.H) return true;
  return map.g[j * map.W + i] === 0;
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
const _m4 = new THREE.Matrix4(), _col = new THREE.Color();
function buildLevel(map, theme) {
  const grp = new THREE.Group();
  const { W, H, g } = map;
  const rng = RNG(map.seed ^ 0x9e3779b9);
  let nf = 0, nw = 0;
  for (let k = 0; k < W * H; k++) {
    if (g[k]) nf++;
    else {
      const i = k % W, j = (k / W) | 0;
      let adj = false;
      for (let dy = -1; dy <= 1 && !adj; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = i + dx, y = j + dy;
        if (x >= 0 && y >= 0 && x < W && y < H && g[y * W + x]) { adj = true; break; }
      }
      if (adj) nw++;
    }
  }
  const floorM = new THREE.InstancedMesh(BOXG, new THREE.MeshLambertMaterial(), nf);
  const wallM = new THREE.InstancedMesh(BOXG, new THREE.MeshLambertMaterial(), nw);
  const topM = new THREE.InstancedMesh(BOXG, new THREE.MeshLambertMaterial(), nw);
  let fi = 0, wi = 0;
  const WH = 2.0;
  for (let k = 0; k < W * H; k++) {
    const i = k % W, j = (k / W) | 0;
    const x = (i + 0.5) * TILE, z = (j + 0.5) * TILE;
    if (g[k]) {
      _m4.makeScale(TILE * 0.98, 0.3, TILE * 0.98); _m4.setPosition(x, -0.15, z);
      floorM.setMatrixAt(fi, _m4);
      _col.setHex(((i + j) & 1) ? theme.floor : theme.floor2);
      _col.offsetHSL(0, 0, (rng() - 0.5) * 0.05);
      floorM.setColorAt(fi++, _col);
    } else {
      let adj = false;
      for (let dy = -1; dy <= 1 && !adj; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = i + dx, yy = j + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && g[yy * W + xx]) { adj = true; break; }
      }
      if (!adj) continue;
      const hh = WH + (rng() < 0.15 ? 0.3 : 0);
      _m4.makeScale(TILE, hh, TILE); _m4.setPosition(x, hh / 2, z);
      wallM.setMatrixAt(wi, _m4);
      _col.setHex(theme.wall); _col.offsetHSL(0, 0, (rng() - 0.5) * 0.08);
      wallM.setColorAt(wi, _col);
      _m4.makeScale(TILE * 1.001, 0.12, TILE * 1.001); _m4.setPosition(x, hh + 0.06, z);
      topM.setMatrixAt(wi, _m4);
      _col.setHex(theme.top); _col.offsetHSL(0, 0, (rng() - 0.5) * 0.05);
      topM.setColorAt(wi++, _col);
    }
  }
  [floorM, wallM, topM].forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; grp.add(m); });

  // decorations
  const torches = map.deco.filter(d => d.t === 'torch');
  const props = map.deco.filter(d => d.t === 'prop');
  if (torches.length) {
    const base = new THREE.InstancedMesh(BOXG, new THREE.MeshLambertMaterial({ color: 0x4a3420 }), torches.length);
    const flame = new THREE.InstancedMesh(BOXG, new THREE.MeshBasicMaterial({ color: theme.deco === 'ice' ? 0x7fe8ff : 0xffa31a }), torches.length);
    torches.forEach((d, n) => {
      const x = (d.i + 0.5) * TILE, z = (d.j + 1) * TILE + 0.12;
      _m4.makeScale(0.2, 0.5, 0.2); _m4.setPosition(x, 1.3, z); base.setMatrixAt(n, _m4);
      _m4.makeScale(0.3, 0.35, 0.3); _m4.setPosition(x, 1.7, z); flame.setMatrixAt(n, _m4);
    });
    grp.add(base, flame);
    grp.userData.flame = flame;
  }
  if (props.length) {
    const kinds = {
      desert: [[0x3f8f3a, 0.5, 1.4, 0.5], [0xefe6cc, 0.7, 0.25, 0.4], [0xb5743a, 0.6, 0.8, 0.6]],
      crypt:  [[0xe6e6dc, 0.7, 0.25, 0.4], [0x5b4636, 0.9, 0.5, 1.6], [0x8a8f99, 0.5, 0.9, 0.5]],
      lava:   [[0xff5a00, 1.6, 0.06, 1.6], [0x1f1715, 0.6, 0.7, 0.6], [0xff8c1a, 1.2, 0.06, 1.2]],
      ice:    [[0x9fe6ff, 0.4, 1.3, 0.4], [0xe8f7ff, 0.8, 0.4, 0.8], [0x6ad0ff, 0.3, 0.9, 0.3]],
    }[theme.deco];
    kinds.forEach((kd, ki) => {
      const list = props.filter(p => Math.floor(p.v * kinds.length) === ki);
      if (!list.length) return;
      const emissive = theme.deco === 'lava' && kd[2] < 0.1;
      const m = new THREE.InstancedMesh(BOXG, emissive ? new THREE.MeshBasicMaterial({ color: kd[0] }) : new THREE.MeshLambertMaterial({ color: kd[0] }), list.length);
      list.forEach((p, n) => {
        _m4.makeRotationY(p.rot);
        _m4.scale(new THREE.Vector3(kd[1], kd[2], kd[3]));
        _m4.setPosition((p.i + 0.5) * TILE, kd[2] / 2 + 0.01, (p.j + 0.5) * TILE);
        m.setMatrixAt(n, _m4);
      });
      grp.add(m);
    });
  }

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
  return grp;
}
