// decor.js — environment set dressing. Per-world "kits" (data + small voxel prop builders) placed
// deterministically on safe tiles: wall edges, corners, wall tops, wall faces, the void beyond the walls,
// pit edges, around statues. Purely visual: never touches map.g / collision.
//
// Everything a kit builds is merged into a handful of draw calls per level:
//   lit props   -> merged vertex-coloured Lambert meshes, one per 16x16-tile chunk (culled per chunk, cast shadows)
//   glowing     -> one merged MeshBasic mesh (crystals, eyes, embers)
//   flames      -> one InstancedMesh (flicker = per-frame instance matrices, small counts)
//   light pools -> one glow-decal InstancedMesh (dungeon.js buildGlows), mist -> another (drifts)
//   motes       -> one THREE.Points (fireflies, falling leaves, rising soul wisps; animated in the shader)
//   light shafts-> one merged additive mesh
// Glowing props also register light spots in group.userData.lights for the moving point-light pool.
//
// Adding a world: add DECOR_KITS[<theme.deco or theme.kit>] = { pal, rules, ... } using the existing
// builders in DPROP (or new ones). Worlds without a kit keep their dungeon.js decoration only.
'use strict';

// ---------- shared materials (live across levels: userData.shared keeps gpuCollect away) ----------
const DECOR_U = { uTime: { value: 0 } };
const DECOR_CHUNK = 32;          // world units per lit chunk (16 tiles)
const DECOR_PROJ = 0.7;          // ground shift per unit of height in screen space (camera pitch ~55-60°)
let _dMats = null;
function decorMats() {
  if (_dMats) return _dMats;
  // lit props: Lambert + vertex colours, skip the point-light loop like other level geometry, gentle sway
  const lit = new THREE.MeshLambertMaterial({ vertexColors: true });
  lit.onBeforeCompile = sh => {
    sh.uniforms.uTime = DECOR_U.uTime;
    sh.vertexShader = 'uniform float uTime;\nattribute float aSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { float ph = transformed.x * 0.45 + transformed.z * 0.31;
        transformed.x += aSway * (0.6 * sin(uTime * 1.6 + ph) + 0.4 * sin(uTime * 2.7 + ph * 1.9));
        transformed.z += aSway * 0.5 * sin(uTime * 1.2 + ph * 1.4); }`);
    if (typeof LVL_LIGHTS === 'string') sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', LVL_LIGHTS);
  };
  lit.customProgramCacheKey = () => 'decorLit';
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const flame = new THREE.MeshBasicMaterial({ toneMapped: false });
  const shaft = new THREE.ShaderMaterial({
    uniforms: { uTime: DECOR_U.uTime, uFogN: { value: 24 }, uFogF: { value: 50 }, uGain: { value: 1 } },
    vertexShader: `uniform float uTime, uFogN, uFogF; attribute vec4 aS; attribute vec3 aCol; varying vec3 vC; varying vec2 vUV; varying float vA;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vUV = aS.xy; vC = aCol;
        vA = aS.z * (0.7 + 0.3 * sin(uTime * 0.5 + aS.w)) * (1.0 - smoothstep(uFogN, uFogF, -mv.z)); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uGain; varying vec3 vC; varying vec2 vUV; varying float vA;
      void main() { float a = 1.0 - abs(vUV.y); a *= a; a *= smoothstep(0.0, 0.25, vUV.x) * (1.0 - smoothstep(0.45, 1.0, vUV.x));
        gl_FragColor = vec4(linearToOutputTexel(vec4(vC, 1.0)).rgb * a * vA * uGain, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  });
  // motes: premultiplied blending so additive sparks (alpha 0) and solid leaves (alpha a) share one draw call
  const motes = new THREE.ShaderMaterial({
    uniforms: { uTime: DECOR_U.uTime, uScale: { value: 400 }, uFogF: { value: 50 } },
    vertexShader: `uniform float uTime, uScale, uFogF; attribute vec4 aP; attribute vec3 aCol; varying vec3 vC; varying float vA; varying float vM;
      void main() {
        vec3 p = position; float t = uTime * aP.y + aP.x; float a = 1.0;
        if (aP.z < 0.5) {            // firefly: lazy loops + blinking
          p += vec3(sin(t) * 0.9 + sin(t * 2.3) * 0.25, sin(t * 1.7) * 0.35, cos(t * 0.8) * 0.9);
          a = smoothstep(-0.3, 0.9, sin(t * 2.1 + aP.x * 5.0));
        } else if (aP.z < 1.5) {     // falling leaf from the anchor height to the ground
          float f = fract(t * 0.06); p.y = position.y * (1.0 - f) + 0.05; p.x += sin(t * 1.9) * 0.5 + f * 1.4; p.z += cos(t * 1.3) * 0.35;
          a = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.9, 1.0, f));
        } else {                     // rising wisp / ember
          float f = fract(t * 0.05); p.y += f * 3.2; p.x += sin(t * 1.3) * 0.35; p.z += cos(t * 1.1) * 0.25;
          a = sin(f * 3.1416);
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = a * (1.0 - smoothstep(uFogF * 0.75, uFogF, -mv.z)); vC = aCol; vM = aP.z;
        gl_PointSize = aP.w * uScale / -mv.z; gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec3 vC; varying float vA; varying float vM;
      void main() {
        vec2 d = gl_PointCoord - 0.5; vec3 c = linearToOutputTexel(vec4(vC, 1.0)).rgb;
        if (vM > 0.5 && vM < 1.5) { float s = step(abs(d.x) + abs(d.y) * 1.6, 0.5) * vA; gl_FragColor = vec4(c * s, s); }
        else { float r = dot(d, d); float a = max(0.0, 1.0 - 4.0 * r); a = a * a * 0.8 + 0.6 * step(r, 0.015); gl_FragColor = vec4(c * a * vA, 0.0); }
      }`,
    transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  _dMats = { lit, glow, flame, shaft, motes };
  for (const k in _dMats) _dMats[k].userData.shared = true;
  return _dMats;
}

// ---------- colour helpers (sRGB hex in, like dungeon.js shade/mix) ----------
const _dc = new THREE.Color();
function djit(hex, r, v) { return shade(hex, 1 + (r() - 0.5) * 2 * (v === undefined ? 0.08 : v)); }
function dpick(arr, r) { return arr[Math.floor(r() * arr.length)]; }

// ---------- merged geometry writer ----------
// unit cube faces: [axis, sign]; corners built so (c1-c0)x(c2-c0) points outwards
const _DFACES = [];
for (let a = 0; a < 3; a++) for (const s of [1, -1]) {
  const n = [0, 0, 0]; n[a] = s;
  const u = [0, 0, 0], v = [0, 0, 0]; u[(a + 1) % 3] = 1; v[(a + 2) % 3] = 1;
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => [0, 1, 2].map(k => n[k] * 0.5 + (u[k] * p + v[k] * q) * 0.5));
  if (s < 0) c.reverse();
  _DFACES.push({ a, s, c, bottom: a === 1 && s < 0 });
}
function DWriter() { return { p: [], n: [], c: [], w: [], nv: 0 }; }
// M: unit-cube -> world matrix. rgb: linear colour. grad: darken bottom vertices (fake AO). swb/swt: sway weight bottom/top.
function dwBox(W, M, cr, cg, cb, grad, swb, swt, noBottom) {
  const e = M.elements;
  const l0 = Math.hypot(e[0], e[1], e[2]) || 1, l1 = Math.hypot(e[4], e[5], e[6]) || 1, l2 = Math.hypot(e[8], e[9], e[10]) || 1;
  const L = [l0, l1, l2];
  for (const f of _DFACES) {
    if (noBottom && f.bottom) continue;
    const o = f.a * 4, nx = e[o] / L[f.a] * f.s, ny = e[o + 1] / L[f.a] * f.s, nz = e[o + 2] / L[f.a] * f.s;
    const lift = f.a === 1 && f.s > 0 ? 1.06 : 1;   // tops a touch brighter
    for (const q of f.c) {
      const x = q[0], y = q[1], z = q[2];
      W.p.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      W.n.push(nx, ny, nz);
      const k = (y < 0 ? 1 - grad : 1) * lift;
      W.c.push(cr * k, cg * k, cb * k);
      W.w.push(y < 0 ? swb : swt);
    }
    W.nv += 4;
  }
}
function dwGeometry(W, withSway) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(W.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(W.n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(W.c, 3));
  if (withSway) g.setAttribute('aSway', new THREE.Float32BufferAttribute(W.w, 1));
  const nq = W.nv / 4, idx = W.nv > 65535 ? new Uint32Array(nq * 6) : new Uint16Array(nq * 6);
  for (let q = 0; q < nq; q++) { const b = q * 4, o = q * 6; idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3; }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// ---------- prop builder: boxes in local prop space (origin on the ground / surface, +z = front) ----------
const _dm = new THREE.Matrix4(), _dm2 = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _de = new THREE.Euler(0, 0, 0, 'YXZ'), _dv = new THREE.Vector3(), _ds = new THREE.Vector3();
function decorBuilder(out) {
  const stack = [];
  let M = new THREE.Matrix4();      // local -> world for the current prop (+ push frames)
  const b = {
    H: 0, r: null, stats: out.stats,
    begin(x, y, z, rot, s) { stack.length = 0; M.compose(_dv.set(x, y, z), _dq.setFromAxisAngle(_DUP, rot || 0), _ds.set(s || 1, s || 1, s || 1)); },
    push(x, y, z, ry, s) { stack.push(M.clone()); _dm.compose(_dv.set(x, y, z), _dq.setFromAxisAngle(_DUP, ry || 0), _ds.set(s || 1, s || 1, s || 1)); M.multiply(_dm); },
    pop() { M = stack.pop() || M; },
    // box: colour (sRGB hex), size, position of the bottom centre; o = { ry, rx, rz, g: AO grad, sw/sb: sway top/bottom, e: emissive }
    box(c, sx, sy, sz, x, y, z, o) {
      o = o || _DNO;
      _de.set(o.rx || 0, o.ry || 0, o.rz || 0);
      _dq.setFromEuler(_de);
      // bottom-centre pivot: centre = pos + R * (0, sy/2, 0)
      _dv.set(0, sy / 2, 0).applyQuaternion(_dq).add(_ds.set(x, y, z));
      _dm.compose(_dv, _dq, _ds.set(sx, sy, sz));
      _dm2.multiplyMatrices(M, _dm);
      _dc.setHex(c);
      const wx = _dm2.elements[12], wz = _dm2.elements[14];
      if (o.e) { dwBox(out.glow, _dm2, _dc.r, _dc.g, _dc.b, 0, 0, 0, false); out.stats.glow++; return; }
      const key = Math.floor(wx / DECOR_CHUNK) * 4096 + Math.floor(wz / DECOR_CHUNK);
      let W = out.chunks.get(key); if (!W) out.chunks.set(key, W = DWriter());
      dwBox(W, _dm2, _dc.r, _dc.g, _dc.b, o.g === undefined ? 0.18 : o.g, o.sb || 0, o.sw || 0, y <= 0.001 && !o.rx && !o.rz);
      out.stats.boxes++;
    },
    // blade: thin box growing from a base point along (yaw, pitch-from-vertical)
    blade(c, w, len, t, x, y, z, yaw, pitch, o) {
      const oo = Object.assign({ ry: yaw, rx: pitch }, o || _DNO);
      b.box(c, w, len, t, x, y, z, oo);
    },
    wp(x, y, z) { return _dv.set(x, y, z).applyMatrix4(M); },
    flame(x, y, z, w, h, c, c2) { const p = b.wp(x, y, z); out.flames.push(p.x, p.y, p.z, w, h, out.flames.length * 0.37, c, c2 === undefined ? 0xffffff : c2); },
    glow(k, x, y, z, sx, sy, c, i, fl) { const p = b.wp(x, y, z); const s = M.elements; const sc = Math.hypot(s[0], s[1], s[2]); out.glows.push({ k, x: p.x, y: p.y, z: p.z, sx: sx * sc, sy: (sy || sx) * sc, c, i, fl: fl === undefined ? 0.08 : fl, ph: (out.glows.length * 2.399) % 6.283 }); },
    light(x, y, z, c, i, d) { const p = b.wp(x, y, z); out.lights.push({ x: p.x, y: p.y, z: p.z, c, i, d }); },
    mote(mode, x, y, z, c, size, speed) { const p = b.wp(x, y, z); out.motes.push(p.x, p.y, p.z, mode, c, size, speed || 1); },
  };
  return b;
}
const _DUP = new THREE.Vector3(0, 1, 0), _DNO = {};

// ---------- prop builders: (b, r, P) — r = per-instance random, P = kit palette ----------
const DPROP = {};
// little helpers shared by builders
function dSkull(b, P, r, x, y, z, s, ry) {
  b.push(x, y, z, ry, s);
  b.box(djit(P.bone, r, 0.05), 0.3, 0.24, 0.3, 0, 0, 0, { g: 0.3 });
  b.box(P.bone2, 0.2, 0.08, 0.06, 0, -0.0, 0.14, { g: 0 });
  b.box(0x15151a, 0.08, 0.07, 0.02, -0.07, 0.1, 0.15, { g: 0 }); b.box(0x15151a, 0.08, 0.07, 0.02, 0.07, 0.1, 0.15, { g: 0 });
  b.pop();
}
function dBone(b, P, r, x, y, z, ry, len) {
  len = len || 0.45 + r() * 0.25;
  b.box(djit(P.bone, r, 0.06), len, 0.06, 0.07, x, y, z, { ry, g: 0.2 });
  b.box(P.bone, 0.1, 0.08, 0.12, x + Math.cos(ry) * len / 2, y, z - Math.sin(ry) * len / 2, { ry, g: 0.2 });
  b.box(P.bone, 0.1, 0.08, 0.12, x - Math.cos(ry) * len / 2, y, z + Math.sin(ry) * len / 2, { ry, g: 0.2 });
}
function dLeafFan(b, r, cols, n, len, x, y, z, spread, sw) {
  for (let s = 0; s < n; s++) {
    const yaw = (s / n) * 6.283 + r() * 0.6, pitch = spread * (0.75 + r() * 0.5), L = len * (0.7 + r() * 0.5);
    b.blade(djit(dpick(cols, r), r, 0.1), 0.16 + r() * 0.1, L, 0.04, x, y, z, yaw, pitch, { sw, g: 0.35 });
    // drooping tip
    const tx = x + Math.sin(yaw) * Math.sin(pitch) * L, ty = y + Math.cos(pitch) * L, tz = z + Math.cos(yaw) * Math.sin(pitch) * L;
    b.blade(djit(dpick(cols, r), r, 0.1), 0.13, L * 0.5, 0.035, tx, ty - 0.03, tz, yaw, Math.min(2.2, pitch + 0.9), { sw: sw * 1.4, sb: sw, g: 0.1 });
  }
}

// ---- Bone Crypt ----
DPROP.candles = (b, r, P) => {
  const n = 3 + Math.floor(r() * 4);
  for (let s = 0; s < n; s++) {
    const a = r() * 6.283, d = s ? 0.12 + r() * 0.24 : 0, h = (s ? 0.1 + r() * 0.24 : 0.28 + r() * 0.2), w = 0.07 + r() * 0.04;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    b.box(djit(P.wax, r, 0.06), w, h, w, x, 0, z, { g: 0.3 });
    b.box(P.wax2, w * 1.7, 0.02, w * 1.7, x, 0, z, { g: 0 });
    b.flame(x, h + 0.07, z, 0.07, 0.13, P.fire, P.fire2);
  }
  b.glow(0, 0, 0.05, 0, 3.4, 3.4, P.fire, 0.5, 0.1);
  b.glow(2, 0, 0.5, 0.15, 1.3, 1.3, P.fire, 0.4, 0.16);
  if (r() < 0.45) b.light(0, 0.9, 0.4, P.fire, 1.2, 7);
  if (r() < 0.5) b.mote(2, 0, 0.3, 0, P.fire, 0.12, 0.8 + r() * 0.6);
};
DPROP.skullPile = (b, r, P) => {
  const n = 4 + Math.floor(r() * 5);
  for (let s = 0; s < n; s++) {
    const layer = s < 4 ? 0 : s < 7 ? 1 : 2, a = r() * 6.283, d = (2 - layer) * 0.16 * r();
    dSkull(b, P, r, Math.cos(a) * d, layer * 0.2, Math.sin(a) * d * 0.7, 0.9 + r() * 0.3, (r() - 0.5) * 1.2);
  }
  for (let s = 0; s < 3; s++) dBone(b, P, r, (r() - 0.5) * 0.8, 0, (r() - 0.3) * 0.5, r() * 3);
};
DPROP.bones = (b, r, P) => {
  const n = 2 + Math.floor(r() * 3);
  for (let s = 0; s < n; s++) dBone(b, P, r, (r() - 0.5) * 1.0, 0, (r() - 0.5) * 0.8, r() * 3);
  if (r() < 0.5) dSkull(b, P, r, (r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.4, 0.9, (r() - 0.5) * 2);
};
DPROP.rubble = (b, r, P) => {
  const n = 3 + Math.floor(r() * 4);
  for (let s = 0; s < n; s++) { const w = 0.15 + r() * 0.3; b.box(djit(dpick(P.stones, r), r, 0.1), w, w * (0.5 + r() * 0.5), w * (0.7 + r() * 0.5), (r() - 0.5) * 1.1, 0, (r() - 0.5) * 0.6, { ry: r() * 3, g: 0.35 }); }
};
DPROP.cobweb = (b, r, P) => {   // flat on the back wall face, fanning out of the corner (origin = the corner, on the floor)
  const sg = b.cs || 1, top = (b.H || 2) - 0.08, sz = 0.75 + r() * 0.35;
  for (let s = 0; s < 5; s++) { const a = 0.15 + s * 0.32; b.box(P.web, 0.03, sz * (0.85 + r() * 0.3), 0.02, 0, top, 0.02, { rz: -sg * (Math.PI - a), g: 0 }); }
  for (let ring = 1; ring <= 3; ring++) { const d = ring * sz * 0.3; b.box(P.web, d * 1.19, 0.025, 0.02, sg * d * 0.57, top - d * 0.565, 0.025, { rz: sg * 0.785, g: 0 }); }
};
DPROP.sarcophagus = (b, r, P) => {   // upright coffin set into the wall face; origin = top edge of the face
  const H = b.H || 2, y0 = -H, st = djit(P.stone2, r, 0.05);
  b.box(shade(st, 0.7), 1.15, Math.min(H - 0.1, 1.9), 0.12, 0, y0, 0.0, { g: 0.2 });          // niche frame
  b.box(st, 0.9, 1.75, 0.34, 0, y0, 0.12, { g: 0.25 });
  b.box(shade(st, 1.12), 0.7, 1.5, 0.06, 0, y0 + 0.12, 0.31, { g: 0.1 });
  b.box(shade(st, 1.2), 0.4, 0.34, 0.08, 0, y0 + 1.25, 0.33, { g: 0 });                   // carved face
  b.box(0x101014, 0.08, 0.05, 0.02, -0.09, y0 + 1.42, 0.37, { g: 0 }); b.box(0x101014, 0.08, 0.05, 0.02, 0.09, y0 + 1.42, 0.37, { g: 0 });
  b.box(shade(st, 0.95), 0.6, 0.06, 0.08, 0, y0 + 0.9, 0.33, { g: 0 });                     // folded arms
  if (r() < 0.5) { b.box(P.fire, 0.05, 0.04, 0.02, -0.09, y0 + 1.42, 0.38, { e: 1 }); b.box(P.fire, 0.05, 0.04, 0.02, 0.09, y0 + 1.42, 0.38, { e: 1 }); b.glow(2, 0, y0 + 1.42, 0.45, 0.8, 0.45, P.fire, 0.3, 0.05); }
  if (r() < 0.6) b.box(P.stone2, 0.5, 0.18, 0.4, (r() - 0.5) * 0.5, y0, 0.45, { ry: r(), g: 0.3 });   // broken lid piece
};
DPROP.chains = (b, r, P) => {     // hanging from the top edge down the face
  const n = 1 + Math.floor(r() * 2);
  for (let c = 0; c < n; c++) {
    const x = (r() - 0.5) * 1.2, len = 6 + Math.floor(r() * 6);
    for (let s = 0; s < len; s++) { const sw = s * 0.006; b.box(P.iron, s & 1 ? 0.05 : 0.11, 0.13, s & 1 ? 0.11 : 0.05, x, -0.12 - s * 0.11, 0.06, { g: 0, sw, sb: sw }); }
    if (r() < 0.5) b.box(P.iron, 0.18, 0.12, 0.18, x, -0.12 - len * 0.11 - 0.1, 0.06, { g: 0.2, sw: len * 0.006, sb: len * 0.006 });
  }
  b.box(P.iron, 1.3, 0.06, 0.06, 0, -0.1, 0.04, { g: 0 });
};
DPROP.tombstone = (b, r, P) => {
  const st = djit(P.stone, r, 0.08), w = 0.5 + r() * 0.2, h = 0.55 + r() * 0.25;
  b.box(shade(st, 0.8), w + 0.16, 0.08, 0.3, 0, 0, 0);
  b.box(st, w, h, 0.14, 0, 0.08, 0, { rz: (r() - 0.5) * 0.25 });
  b.box(st, w * 0.7, 0.12, 0.14, 0, 0.08 + h - 0.02, 0, { rz: (r() - 0.5) * 0.25 });
  b.box(shade(st, 0.6), w * 0.5, 0.05, 0.02, 0, 0.08 + h * 0.55, 0.075);
  if (r() < 0.5) b.box(P.lichen, w * 0.6, 0.05, 0.16, -0.05, 0.08 + h + 0.05, 0, { g: 0 });
};
DPROP.brokenPillar = (b, r, P) => {
  const st = djit(P.stone, r, 0.06), h = 1.0 + r() * 1.4;
  b.box(shade(st, 0.85), 1.0, 0.25, 1.0, 0, 0, 0);
  b.box(st, 0.72, h, 0.72, 0, 0.25, 0, { g: 0.25 });
  b.box(shade(st, 1.1), 0.5, 0.3, 0.4, 0.1, 0.25 + h, -0.05, { rz: 0.3, g: 0 });
  for (let s = 0; s < 3; s++) b.box(shade(st, 0.9), 0.25 + r() * 0.2, 0.2, 0.25, (r() - 0.5) * 1.2, 0, 0.3 + r() * 0.3, { ry: r() * 3, g: 0.3 });
  if (P.lichen) b.box(P.lichen, 0.74, 0.3, 0.74, 0, 0.25 + h * 0.3 * r(), 0, { g: 0 });
};
DPROP.ruinPillar = (b, r, P) => {    // tall ruined column rising out of the void (silhouette behind the walls)
  const st = djit(P.stone2, r, 0.06), h = 3.5 + r() * 3;
  b.box(st, 1.0, h, 1.0, 0, -2.5, 0, { g: 0.6 });
  b.box(shade(st, 1.15), 1.3, 0.3, 1.3, 0, -2.5 + h, 0, { g: 0 });
  if (r() < 0.6) b.box(shade(st, 1.1), 0.9, 0.5, 0.7, 0.2, -2.5 + h + 0.3, 0, { rz: 0.35, g: 0 });
  if (r() < 0.4) { b.flame(0, -2.5 + h + 0.5, 0, 0.18, 0.3, P.fire, P.fire2); b.glow(2, 0, -2.5 + h + 0.55, 0.2, 2.0, 2.0, P.fire, 0.45, 0.12); }
};
DPROP.deadRoots = (b, r, P) => {    // on a wall face: roots crawling down and out over the floor
  const H = b.H || 2, n = 2 + Math.floor(r() * 3);
  for (let s = 0; s < n; s++) {
    const x = (r() - 0.5) * 1.4; let y = -0.05, z = 0.04, w = 0.14;
    b.box(P.root, w, 0.4 + r() * 0.5, 0.08, x, -0.6 - r() * 0.4, z, { rz: (r() - 0.5) * 0.4, g: 0 });
    b.box(P.root, w * 0.8, 0.06, 0.6 + r() * 0.6, x + (r() - 0.5) * 0.3, -H + 0.001, 0.3, { ry: (r() - 0.5) * 0.8, g: 0 });
    b.box(P.root, 0.1, 0.9 + r() * 0.5, 0.07, x, -H, 0.06, { rz: (r() - 0.5) * 0.3, g: 0.2 });
  }
};
DPROP.crystals = (b, r, P) => {
  const n = 3 + Math.floor(r() * 3);
  b.box(shade(P.stone, 0.8), 0.7, 0.12, 0.6, 0, 0, 0, { g: 0.3 });
  for (let s = 0; s < n; s++) {
    const h = 0.3 + r() * (s ? 0.5 : 0.9), w = 0.1 + r() * 0.1;
    b.box(s & 1 ? P.crystal : P.crystal2, w, h, w, (r() - 0.5) * 0.5, 0.05, (r() - 0.5) * 0.4, { rx: (r() - 0.5) * 0.7, rz: (r() - 0.5) * 0.7, ry: r() * 3, e: 1 });
  }
  b.glow(0, 0, 0.05, 0, 3.6, 3.6, P.crystal, 0.4, 0.02);
  b.glow(2, 0, 0.5, 0.2, 1.6, 1.6, P.crystal, 0.35, 0.03);
  if (r() < 0.6) b.light(0, 1.0, 0.4, P.crystal, 1.1, 8);
  b.mote(0, 0, 0.6, 0, P.crystal, 0.1, 0.6);
};
DPROP.lichen = (b, r, P) => { const w = 0.6 + r() * 0.9; b.box(djit(P.lichen, r, 0.1), w, 0.03, w * (0.5 + r() * 0.5), (r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6, { ry: r() * 3, g: 0 }); };
DPROP.candleRing = (b, r, P) => {   // around a statue / coffin (origin = statue centre; candles at the edge of its tile)
  for (let s = 0; s < 4; s++) {
    if (r() < 0.3) continue;
    const a = s * 1.571 + 0.785 + (r() - 0.5) * 0.3, d = 0.78;
    b.push(Math.cos(a) * d, 0, Math.sin(a) * d, 0, 0.8); DPROP.candles(b, r, P); b.pop();
  }
};
DPROP.boneRing = (b, r, P) => { for (let s = 0; s < 3; s++) { const a = r() * 6.283; b.push(Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8, r() * 3, 0.8); DPROP.bones(b, r, P); b.pop(); } };

// ---- Jungle Temple ----
DPROP.fern = (b, r, P) => dLeafFan(b, r, P.leaf, 6 + Math.floor(r() * 4), 0.45 + r() * 0.25, 0, 0, 0, 0.9, 0.035);
DPROP.lowFern = (b, r, P) => dLeafFan(b, r, P.leaf, 5 + Math.floor(r() * 3), 0.3 + r() * 0.12, 0, 0, 0, 1.15, 0.025);
DPROP.broadLeaf = (b, r, P) => {
  const n = 3 + Math.floor(r() * 3);
  for (let s = 0; s < n; s++) {
    const yaw = r() * 6.283, L = 0.35 + r() * 0.3;
    b.blade(P.stem, 0.05, L, 0.05, 0, 0, 0, yaw, 0.4, { sw: 0.02, g: 0.3 });
    const tx = Math.sin(yaw) * Math.sin(0.4) * L, ty = Math.cos(0.4) * L, tz = Math.cos(yaw) * Math.sin(0.4) * L;
    b.box(djit(dpick(P.leaf, r), r, 0.12), 0.38 + r() * 0.15, 0.04, 0.5 + r() * 0.2, tx, ty, tz, { ry: yaw, rx: 0.35, sw: 0.05, sb: 0.03, g: 0 });
  }
};
DPROP.grass = (b, r, P) => {
  const n = 5 + Math.floor(r() * 6);
  for (let s = 0; s < n; s++) {
    const c = djit(r() < 0.25 ? P.grassDry : dpick(P.leaf, r), r, 0.12), h = 0.18 + r() * 0.32;
    b.blade(c, 0.05, h, 0.05, (r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.4, r() * 6.283, r() * 0.45, { sw: 0.04 * h / 0.3, g: 0.5 });
  }
};
DPROP.flowers = (b, r, P) => {
  if (r() < 0.45) {   // big red jungle flower lying in its leaves (like a rafflesia)
    const c = djit(dpick(P.flower, r), r, 0.1), s = 0.8 + r() * 0.4;
    b.push(0, 0, 0, r() * 3, s);
    dLeafFan(b, r, P.leaf, 4, 0.35, 0, 0, 0, 1.3, 0.02);
    for (let k = 0; k < 5; k++) { const a = k * 1.2566; b.box(c, 0.22, 0.07, 0.3, Math.sin(a) * 0.17, 0.04, Math.cos(a) * 0.17, { ry: a, rx: -0.25, g: 0.15 }); }
    b.box(shade(c, 0.6), 0.16, 0.09, 0.16, 0, 0.05, 0, { g: 0 });
    b.box(P.pollen, 0.08, 0.04, 0.08, 0, 0.13, 0, { e: 1 });
    b.pop();
  } else {             // cluster of tall orange/red blooms
    const n = 3 + Math.floor(r() * 3), c = dpick(P.flower, r);
    for (let s = 0; s < n; s++) {
      const x = (r() - 0.5) * 0.5, z = (r() - 0.5) * 0.4, h = 0.25 + r() * 0.3;
      b.box(P.stem, 0.04, h, 0.04, x, 0, z, { sw: 0.04, g: 0.3 });
      b.box(djit(c, r, 0.12), 0.14, 0.1, 0.14, x, h, z, { ry: r(), sw: 0.04, sb: 0.04, g: 0 });
      b.box(P.pollen, 0.05, 0.04, 0.05, x, h + 0.09, z, { sw: 0.04, sb: 0.04, g: 0 });
    }
    dLeafFan(b, r, P.leaf, 4, 0.25, 0, 0, 0, 1.1, 0.02);
  }
};
DPROP.moss = (b, r, P) => {
  const n = 1 + Math.floor(r() * 3);
  for (let s = 0; s < n; s++) { const w = 0.5 + r() * 0.8; b.box(djit(P.moss, r, 0.1), w, 0.025 + r() * 0.02, w * (0.6 + r() * 0.5), (r() - 0.5) * 0.8, 0, (r() - 0.5) * 0.6, { ry: r() * 3, g: 0 }); }
};
DPROP.vines = (b, r, P) => {     // draped over the top edge of a wall and hanging down its face
  const H = b.H || 2, n = 2 + Math.floor(r() * 3);
  b.box(djit(dpick(P.leaf, r), r, 0.1), 1.6 + r() * 0.4, 0.08, 0.7, (r() - 0.5) * 0.3, 0, -0.32, { g: 0 });   // leafy mat on top
  for (let s = 0; s < n; s++) {
    const x = (r() - 0.5) * 1.6, len = 0.5 + r() * Math.min(1.5, H - 0.3), seg = Math.max(2, Math.round(len / 0.25));
    for (let k = 0; k < seg; k++) {
      const y = -0.04 - k * (len / seg), sw = 0.01 + k * 0.012;
      b.box(P.vine, 0.07, len / seg + 0.02, 0.05, x + Math.sin(k * 1.3 + s) * 0.04, y - len / seg, 0.04, { g: 0, sw, sb: sw + 0.012 });
      if (k % 2 === 0 || k === seg - 1) b.box(djit(dpick(P.leaf, r), r, 0.12), 0.22, 0.16, 0.05, x + (k & 2 ? 0.1 : -0.1), y - len / seg, 0.07, { rz: (k & 2 ? -0.5 : 0.5), g: 0, sw: sw + 0.01, sb: sw + 0.02 });
    }
  }
};
DPROP.roots = (b, r, P) => {     // big roots crawling out of the wall base over the floor (origin on the floor at the wall face)
  const n = 1 + Math.floor(r() * 3);
  for (let s = 0; s < n; s++) {
    const x = (r() - 0.5) * 1.3, a = (r() - 0.5) * 0.9, L = 0.6 + r() * 0.8, w = 0.12 + r() * 0.1;
    b.box(djit(P.root, r, 0.08), w, w * 0.8, L, x + Math.sin(a) * L / 2, 0, Math.cos(a) * L / 2, { ry: a, g: 0.3 });
    b.box(djit(P.root, r, 0.08), w * 1.2, 0.5 + r() * 0.6, w * 0.9, x, 0, 0.02, { rx: -0.25, g: 0.25 });
    b.box(shade(P.root, 0.85), w * 0.6, w * 0.6, L * 0.5, x + Math.sin(a + 0.6) * L * 0.9, 0, Math.cos(a + 0.6) * L * 0.9, { ry: a + 0.6, g: 0.2 });
  }
};
DPROP.bush = (b, r, P) => {      // dense leafy clump (wall tops / void border)
  const n = 3 + Math.floor(r() * 3), s = 0.7 + r() * 0.5;
  for (let k = 0; k < n; k++) {
    const w = (0.7 + r() * 0.6) * s, h = (0.4 + r() * 0.5) * s, x = (r() - 0.5) * 1.0, z = (r() - 0.5) * 0.9, y = r() * 0.35 * s;
    b.box(djit(dpick(P.leafDark, r), r, 0.1), w, h, w * (0.8 + r() * 0.3), x, y, z, { ry: r(), g: 0.35, sw: 0.025 });
    b.box(djit(dpick(P.leaf, r), r, 0.1), w * 0.7, h * 0.35, w * 0.6, x + 0.05, y + h, z + 0.05, { ry: r(), g: 0.1, sw: 0.035, sb: 0.025 });
  }
};
DPROP.tree = (b, r, P) => {      // big jungle tree: buttressed trunk out of the void, layered canopy leaning toward +z
  const th = 4.2 + r() * 1.6, tw = 0.6 + r() * 0.25, base = -2.5;
  const bark = djit(P.bark, r, 0.08);
  b.box(bark, tw, th - base, tw, 0, base, 0, { g: 0.5 });
  for (let s = 0; s < 4; s++) { const a = s * 1.571 + r() * 0.5; b.box(shade(bark, 0.85), 0.22, 1.4 + r() * 0.8, 0.5, Math.sin(a) * tw * 0.55, base + 1.5, Math.cos(a) * tw * 0.55, { ry: a, g: 0.4 }); }
  // branches
  b.box(bark, 0.25, 0.25, 1.4, 0, th - 0.9, 0.6, { rx: -0.5, g: 0 });
  if (r() < 0.6) b.box(bark, 1.2, 0.22, 0.22, 0.5, th - 0.6, 0, { rz: 0.5, g: 0 });
  // hanging vines from the canopy
  const lean = 0.9 + r() * 0.5;
  for (let s = 0; s < 3; s++) { const x = (r() - 0.5) * 2.4, z = lean + (r() - 0.2) * 1.3, L = 0.8 + r() * 1.4; b.box(P.vine, 0.06, L, 0.06, x, th - L, z, { sb: 0.06, sw: 0.01, g: 0 }); }
  // canopy: 3 layers of leaf slabs, darker underneath, sunlit on top
  const layers = [[3.4, 0.7, -0.1], [2.8, 0.6, 0.5], [1.9, 0.5, 1.0]];
  for (const [w, h, y] of layers) {
    const n = 3 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) {
      const ww = w * (0.55 + r() * 0.35), x = (r() - 0.5) * w * 0.6, z = lean * (0.7 + 0.4 * r()) + (r() - 0.5) * w * 0.5;
      b.box(djit(dpick(y < 0.3 ? P.leafDark : P.leaf, r), r, 0.1), ww, h, ww * (0.8 + r() * 0.3), x, th + y, z, { ry: r() * 0.5, g: 0.45, sw: 0.03, sb: 0.02 });
    }
  }
  if (r() < 0.6) b.mote(1, (r() - 0.5) * 1.5, th, lean + 0.5, dpick(P.leaf, r), 0.16, 0.8 + r() * 0.5);
  b.mote(1, (r() - 0.5) * 2, th - 0.5, lean, P.grassDry, 0.15, 0.7 + r() * 0.5);
};
DPROP.templePillar = (b, r, P) => {
  const st = djit(P.stone, r, 0.06), h = 1.2 + r() * 1.3;
  b.box(shade(st, 0.85), 1.05, 0.3, 1.05, 0, 0, 0, { g: 0.3 });
  b.box(st, 0.78, h, 0.78, 0, 0.3, 0, { g: 0.3 });
  b.box(shade(st, 0.8), 0.8, 0.08, 0.8, 0, 0.3 + h * 0.45, 0, { g: 0 });            // carved band
  b.box(shade(st, 1.08), 0.6, 0.3, 0.6, -0.05, 0.3 + h, 0.05, { rz: 0.25, ry: 0.3, g: 0 });
  b.box(djit(P.moss, r, 0.1), 0.82, 0.12, 0.82, 0, 0.3 + h - 0.05, 0, { g: 0 });
  b.box(djit(P.moss, r, 0.1), 0.82, 0.5, 0.3, 0, 0.3, 0.27, { g: 0 });
  b.push(0.35, 0, 0.5, 0.4, 0.7); DPROP.fern(b, r, P); b.pop();
  for (let s = 0; s < 2; s++) b.box(P.vine, 0.06, h * 0.7, 0.06, (r() - 0.5) * 0.6, 0.3 + h * 0.3, 0.4, { g: 0, sb: 0.03 });
};
DPROP.brazier = (b, r, P) => {   // stone pillar with a fire bowl: warm light spot
  const st = djit(P.stone, r, 0.05), h = 1.05 + r() * 0.25;
  b.box(shade(st, 0.85), 0.75, 0.2, 0.75, 0, 0, 0, { g: 0.3 });
  b.box(st, 0.5, h, 0.5, 0, 0.2, 0, { g: 0.35 });
  b.box(shade(st, 1.1), 0.8, 0.12, 0.8, 0, 0.2 + h, 0, { g: 0 });
  b.box(P.iron, 0.7, 0.22, 0.7, 0, 0.32 + h, 0, { g: 0.2 });
  b.box(P.ember, 0.55, 0.06, 0.55, 0, 0.5 + h, 0, { e: 1 });
  b.box(djit(P.moss, r, 0.1), 0.52, 0.3, 0.52, 0, 0.2, 0, { g: 0 });
  const y = 0.56 + h;
  b.flame(0, y + 0.18, 0, 0.36, 0.42, P.fire, P.fire2); b.flame(0.12, y + 0.12, 0.08, 0.2, 0.28, P.fire, P.fire2); b.flame(-0.13, y + 0.1, -0.05, 0.18, 0.24, P.fire, P.fire2);
  b.glow(0, 0, 0.05, 0.4, 6.5, 6.0, P.fire, 0.42, 0.12);
  b.glow(2, 0, y + 0.3, 0.3, 2.4, 2.4, P.fire, 0.6, 0.18);
  b.light(0, y + 0.8, 0.5, P.fire, 1.7, 11);
  for (let s = 0; s < 3; s++) b.mote(2, (r() - 0.5) * 0.3, y + 0.2, (r() - 0.5) * 0.3, P.fire, 0.11, 1 + r());
};
DPROP.idolHead = (b, r, P) => {  // carved stone head on a wall top, glowing eyes
  const st = djit(P.stone, r, 0.05);
  b.box(shade(st, 0.9), 1.1, 0.25, 0.9, 0, 0, 0, { g: 0.2 });
  b.box(st, 0.95, 1.0, 0.8, 0, 0.25, 0, { g: 0.3 });
  b.box(shade(st, 1.1), 1.15, 0.22, 0.9, 0, 1.25, 0, { g: 0 });
  b.box(shade(st, 0.8), 0.22, 0.32, 0.12, 0, 0.6, 0.42, { g: 0 });            // nose
  b.box(shade(st, 0.6), 0.55, 0.1, 0.06, 0, 0.42, 0.41, { g: 0 });            // mouth
  b.box(P.eye, 0.18, 0.12, 0.04, -0.22, 0.86, 0.41, { e: 1 }); b.box(P.eye, 0.18, 0.12, 0.04, 0.22, 0.86, 0.41, { e: 1 });
  b.glow(2, 0, 0.86, 0.5, 1.4, 0.7, P.eye, 0.45, 0.04);
  b.box(djit(P.moss, r, 0.1), 0.98, 0.14, 0.82, 0, 1.2, 0, { g: 0 });
  b.push(-0.55, 0, 0.3, 0, 0.7); DPROP.fern(b, r, P); b.pop();
  if (r() < 0.6) b.light(0, 1.2, 1.0, P.eye, 0.9, 7);
};
DPROP.mushrooms = (b, r, P) => {
  const n = 2 + Math.floor(r() * 3);
  for (let s = 0; s < n; s++) {
    const x = (r() - 0.5) * 0.5, z = (r() - 0.5) * 0.4, h = 0.08 + r() * 0.16, w = 0.12 + r() * 0.12, c = dpick(P.shroom, r);
    b.box(P.stemPale, w * 0.35, h, w * 0.35, x, 0, z, { g: 0.2 });
    b.box(c, w, w * 0.45, w, x, h, z, { g: 0.1 });
    b.box(0xfff0e0, w * 0.2, 0.02, w * 0.2, x + w * 0.2, h + w * 0.45, z, { g: 0 });
  }
};
DPROP.puddle = (b, r, P) => {
  const w = 0.9 + r() * 0.8;
  b.box(P.water, w, 0.018, w * (0.6 + r() * 0.4), 0, 0, 0, { ry: r() * 3, g: 0 });
  b.box(P.waterHi, w * 0.4, 0.02, 0.05, (r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.2, { ry: r() * 3, g: 0 });
  if (r() < 0.6) b.box(dpick(P.leaf, r), 0.25, 0.022, 0.22, (r() - 0.5) * w * 0.5, 0, (r() - 0.5) * 0.3, { ry: r() * 3, g: 0 });
};
DPROP.lilies = (b, r, P) => {    // on pit water: lily pads + a few reeds
  const n = 2 + Math.floor(r() * 3);
  for (let s = 0; s < n; s++) {
    const x = (r() - 0.5) * 1.5, z = (r() - 0.5) * 1.5, w = 0.3 + r() * 0.3;
    b.box(djit(dpick(P.leaf, r), r, 0.1), w, 0.03, w, x, 0, z, { ry: r() * 3, g: 0 });
    if (r() < 0.3) b.box(dpick(P.flower, r), 0.1, 0.08, 0.1, x, 0.03, z, { g: 0 });
  }
  if (r() < 0.5) for (let s = 0; s < 4; s++) b.blade(djit(P.grassDry, r, 0.1), 0.05, 0.5 + r() * 0.5, 0.05, (r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6, r() * 6, r() * 0.3, { sw: 0.04, g: 0.4 });
  b.glow(0, 0, 0.04, 0, 2.2, 2.2, P.waterGlow, 0.18, 0);
};
DPROP.fernRing = (b, r, P) => {
  for (let s = 0; s < 4; s++) { if (r() < 0.25) continue; const a = s * 1.571 + 0.785 + (r() - 0.5) * 0.4; b.push(Math.cos(a) * 0.82, 0, Math.sin(a) * 0.82, r() * 3, 0.75); DPROP.fern(b, r, P); b.pop(); }
  b.push(0, 0, 0.75, 0, 1); DPROP.roots(b, r, P); b.pop();
};
DPROP.grassRing = (b, r, P) => { for (let s = 0; s < 3; s++) { const a = r() * 6.283; b.push(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55, 0, 0.8); (s ? DPROP.grass : DPROP.lowFern)(b, r, P); b.pop(); } };

// ---------- kits ----------
// rule: { p: prop, at: site, d: probability per site, sp: min spacing in tiles (same rule), h: height for the
// occlusion test (skip when its top would cover walkable floor on screen), s: [min,max] scale, in: inset from
// the wall face, solo: claims the site slot so other solo props don't stack there }
// sites: edgeN/edgeS/edgeE/edgeW/edge (floor hugging a wall; S = camera side), cornerN/cornerS, floor (room
// interior), wallTopN/wallTopS/wallTopSide/wallTop (rim wall tops), faceN/faceSide (rim wall faces, origin at
// the top edge), void (beyond the rim), pitEdge (floor next to a pit), pit (pit surface)
const DECOR_KITS = {
  crypt: {
    pal: {
      bone: 0xdcd8c6, bone2: 0xb8b4a2, wax: 0xd8d2bc, wax2: 0xbab29a, fire: 0x46ffc4, fire2: 0xd8fff2,
      stone: 0x6a6d78, stone2: 0x4c4f5a, stones: [0x5a5d68, 0x6e717c, 0x4a4d57], iron: 0x2c2e34, web: 0xc8ccd4,
      root: 0x3b3029, lichen: 0x4f6b62, crystal: 0x3ff0d8, crystal2: 0x9ffff0,
    },
    mist: { n: 26, c: 0x6fa0c8, i: 0.13, y: 0.3, s: [5, 9] },
    shafts: { c: 0x8fb0ff, i: 0.16, per: 0.45, w: [1.6, 2.6] },
    wisps: { c: 0x6affd8, n: 0.5 },                    // rising soul wisps from chasms (per pit tile probability)
    rules: [
      { p: 'sarcophagus', at: 'faceN', d: 0.07, sp: 4, solo: 1, minH: 1.7 },
      { p: 'chains', at: 'faceN', d: 0.14, sp: 2, solo: 1 },
      { p: 'deadRoots', at: 'faceN', d: 0.08, sp: 3, solo: 1 },
      { p: 'cobweb', at: 'cornerN', d: 0.6, in: 0.02, rot0: 1, s: [1, 1] },
      { p: 'brokenPillar', at: 'cornerN', d: 0.3, sp: 4, h: 2.6, in: 0.55, solo: 1 },
      { p: 'candles', at: 'cornerN', d: 0.75, in: 0.35, solo: 1 },
      { p: 'skullPile', at: 'cornerN', d: 0.5, in: 0.3, solo: 1 },
      { p: 'skullPile', at: 'cornerS', d: 0.3, in: 0.3, s: [0.7, 0.9], solo: 1 },
      { p: 'candles', at: 'edgeN', d: 0.1, sp: 3, in: 0.3, solo: 1 },
      { p: 'tombstone', at: 'edgeN', d: 0.08, sp: 3, in: 0.2, solo: 1 },
      { p: 'crystals', at: 'edge', d: 0.025, sp: 7, in: 0.3, solo: 1 },
      { p: 'rubble', at: 'edge', d: 0.14, in: 0.3 },
      { p: 'bones', at: 'edge', d: 0.08, in: 0.45 },
      { p: 'bones', at: 'floor', d: 0.03 },
      { p: 'lichen', at: 'floor', d: 0.04 },
      { p: 'candles', at: 'wallTopN', d: 0.05, sp: 4, h: 0.5, solo: 1 },
      { p: 'tombstone', at: 'wallTopN', d: 0.06, sp: 3, h: 0.9, solo: 1 },
      { p: 'rubble', at: 'wallTop', d: 0.16 },
      { p: 'bones', at: 'wallTop', d: 0.07 },
      { p: 'lichen', at: 'wallTop', d: 0.12 },
      { p: 'ruinPillar', at: 'void', d: 0.09, sp: 4, h: 7, rad: 0.7 },
      { p: 'bones', at: 'pitEdge', d: 0.1, in: 0.4 },
    ],
    solids: { coffin: 'candleRing', column: 'boneRing', obelisk: 'candleRing' },
    overlay: 'boneRing',                                 // around dungeon.js floor props
  },
  jungle: {
    pal: {
      leaf: [0x2f7426, 0x3f8c2c, 0x4f9e34, 0x5aae3c, 0x376a28], leafDark: [0x1e4a1c, 0x24561f, 0x2c6224, 0x1a3f1a],
      grassDry: 0x9ab04a, stem: 0x3a6a22, vine: 0x2e6424, bark: 0x5a4430, root: 0x6a4c30, moss: 0x4c8a2c,
      flower: [0xe0302a, 0xff6a1a, 0xd8203a], pollen: 0xffd84a, stone: 0x7c846a, stones: [0x6c745c, 0x7c846a, 0x5c644e],
      iron: 0x3a3430, ember: 0xff8a2a, fire: 0xffa63a, fire2: 0xfff0b0, eye: 0x4dff9a, shroom: [0xd8402a, 0xff8a3a, 0xe8c040],
      stemPale: 0xe8dcc0, water: 0x24555a, waterHi: 0x9fe0e0, waterGlow: 0x5affd0,
    },
    fireflies: { c: 0xd8ff6a, c2: 0xffe27a, n: 0.5 },     // per tree/bush/fern anchor probability
    shafts: { c: 0xfff0b8, i: 0.2, per: 0.7, w: [1.8, 3.0] },
    rules: [
      { p: 'tree', at: 'void', d: 0.32, sp: 3, h: 6.6, rad: 1.4, fwd: 0.4 },
      { p: 'bush', at: 'void', d: 0.6, h: 2.8, rad: 0.8, y: 0.9 },
      { p: 'vines', at: 'faceN', d: 0.45, sp: 1, solo: 1 },
      { p: 'vines', at: 'faceSide', d: 0.25, sp: 2, solo: 1 },
      { p: 'brazier', at: 'cornerN', d: 0.45, sp: 5, h: 2.6, in: 0.5, solo: 1 },
      { p: 'templePillar', at: 'cornerN', d: 0.35, sp: 4, h: 2.8, in: 0.55, solo: 1 },
      { p: 'brazier', at: 'edgeN', d: 0.035, sp: 6, h: 2.6, in: 0.45, solo: 1 },
      { p: 'roots', at: 'edgeN', d: 0.14, sp: 2, in: 0.02, solo: 1 },
      { p: 'roots', at: 'edgeE', d: 0.06, sp: 3, in: 0.02, solo: 1 },
      { p: 'roots', at: 'edgeW', d: 0.06, sp: 3, in: 0.02, solo: 1 },
      { p: 'fern', at: 'cornerN', d: 0.7, in: 0.4 },
      { p: 'fern', at: 'cornerS', d: 0.55, in: 0.35, s: [0.7, 0.85] },
      { p: 'fern', at: 'edgeN', d: 0.3, in: 0.35 },
      { p: 'fern', at: 'edgeE', d: 0.16, in: 0.3, s: [0.75, 1] },
      { p: 'fern', at: 'edgeW', d: 0.16, in: 0.3, s: [0.75, 1] },
      { p: 'lowFern', at: 'edgeS', d: 0.22, in: 0.3 },
      { p: 'broadLeaf', at: 'edgeN', d: 0.12, in: 0.35 },
      { p: 'flowers', at: 'edgeN', d: 0.09, sp: 2, in: 0.4 },
      { p: 'flowers', at: 'cornerS', d: 0.2, in: 0.5 },
      { p: 'mushrooms', at: 'edge', d: 0.06, in: 0.3 },
      { p: 'grass', at: 'edge', d: 0.4, in: 0.3 },
      { p: 'moss', at: 'edge', d: 0.3, in: 0.5 },
      { p: 'grass', at: 'floor', d: 0.05 },
      { p: 'moss', at: 'floor', d: 0.05 },
      { p: 'puddle', at: 'floor', d: 0.018 },
      { p: 'idolHead', at: 'wallTopN', d: 0.035, sp: 7, h: 1.5, solo: 1 },
      { p: 'bush', at: 'wallTopN', d: 0.3, h: 1.4, rad: 0.7, s: [0.7, 1] },
      { p: 'bush', at: 'wallTopSide', d: 0.18, h: 1.2, rad: 0.7, s: [0.6, 0.85] },
      { p: 'fern', at: 'wallTopN', d: 0.35 },
      { p: 'fern', at: 'wallTopSide', d: 0.3 },
      { p: 'lowFern', at: 'wallTopS', d: 0.25 },
      { p: 'grass', at: 'wallTop', d: 0.6 },
      { p: 'flowers', at: 'wallTop', d: 0.07, h: 0.6 },
      { p: 'moss', at: 'wallTop', d: 0.4 },
      { p: 'lowFern', at: 'pitEdge', d: 0.3, in: 0.35 },
      { p: 'lilies', at: 'pit', d: 0.3 },
    ],
    solids: { idol: 'fernRing', column: 'fernRing', obelisk: 'fernRing' },
    overlay: 'grassRing',
  },
};

// ---------- placement ----------
function decorHeights(map, group) {
  // surface height per tile, read back from the level's tile-sized boxes (walls, caps, floor slabs, pits),
  // so wall-top dressing follows whatever heights buildLevel used
  const { W, H } = map, h = new Float32Array(W * H).fill(-99);
  for (const m of group.children) {
    if (!m.isInstancedMesh || !m.geometry || m.geometry.type !== 'BoxGeometry') continue;
    const a = m.instanceMatrix.array, n = m.count, py = m.position.y;
    for (let q = 0; q < n; q++) {
      const o = q * 16;
      const sx = Math.hypot(a[o], a[o + 1], a[o + 2]), sz = Math.hypot(a[o + 8], a[o + 9], a[o + 10]);
      if (sx < 1.5 || sz < 1.5) continue;
      const i = Math.floor(a[o + 12] / TILE), j = Math.floor(a[o + 14] / TILE);
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const top = a[o + 13] + py + 0.5 * Math.hypot(a[o + 4], a[o + 5], a[o + 6]);
      if (top > h[j * W + i]) h[j * W + i] = top;
    }
  }
  return h;
}

function buildDecor(map, theme, group) {
  const kit = DECOR_KITS[theme.kit || theme.deco];
  if (!kit || !group || !map) return null;
  const tier = typeof gfxTier === 'function' ? gfxTier() : 'high';
  const dens = tier === 'low' ? 0.5 : tier === 'medium' ? 0.8 : 1;
  const P = kit.pal;
  const { W, H, g } = map, tt = map.tt || new Uint8Array(W * H), corr = map.corr || new Uint8Array(W * H);
  const hts = decorHeights(map, group);
  const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H) ? T_WALL : g[j * W + i];
  const isF = (i, j) => at(i, j) === T_FLOOR;
  const isWall = (i, j) => at(i, j) === T_WALL;
  const rim = (i, j) => { if (!isWall(i, j)) return false; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (at(i + dx, j + dy) !== T_WALL) return true; return false; };
  const walkW = (x, z) => { const i = Math.floor(x / TILE), j = Math.floor(z / TILE); const v = at(i, j); return v === T_FLOOR || v === T_PIT; };
  // keep-out zones (world units): portal pad, spawn point, merchant stall, arrow-trap slits
  const keep = [[map.exit.x, map.exit.z, 3.6], [map.start.x, map.start.z, 2.4]];
  if (map.merchant) { const m = map.merchant; keep.push([m.sx, m.sz, 4.2], [m.x, m.z, 2.2], [m.camel.x, m.camel.z, 2.2]); }
  const kept = (x, z, extra) => { for (const k of keep) { const dx = x - k[0], dz = z - k[1], r = k[2] + (extra || 0); if (dx * dx + dz * dz < r * r) return true; } return false; };
  const slit = new Set((map.plates || []).map(p => p.lj * W + p.li));
  const roomCtr = (map.rooms || []).map(r => [(r.x + r.w / 2) * TILE, (r.y + r.h / 2) * TILE]);
  const nearCtr = (x, z) => roomCtr.some(c => Math.abs(c[0] - x) < 1.8 && Math.abs(c[1] - z) < 1.8);
  const freeF = k => g[k] === T_FLOOR && !tt[k];
  // occlusion test: does the top (or front-bottom) of a prop land on walkable floor on screen?
  const occl = (x, z, y0, h, rad) => {
    const yt = y0 + h, yb = Math.max(0, y0);
    for (const dx of [-rad, 0, rad]) {
      if (walkW(x + dx, z - rad - DECOR_PROJ * yt)) return true;
      if (walkW(x + dx, z + rad - DECOR_PROJ * yt)) return true;
      if (yb > 0.6 && walkW(x + dx, z + rad - DECOR_PROJ * yb)) return true;
    }
    return false;
  };

  const out = { chunks: new Map(), glow: DWriter(), flames: [], glows: [], lights: [], motes: [], stats: { boxes: 0, glow: 0, props: 0 } };
  const B = decorBuilder(out);
  const slot = new Uint8Array(W * H);    // bit 1 floor-edge, 2 wall top, 4 wall face, 8 void
  const anchors = [];                    // vegetation spots for fireflies
  const SLOT = { edgeN: 1, edgeS: 1, edgeE: 1, edgeW: 1, edge: 1, cornerN: 1, cornerS: 1, floor: 1, pitEdge: 1, wallTopN: 2, wallTopS: 2, wallTopSide: 2, wallTop: 2, faceN: 4, faceSide: 4, void: 8, pit: 16 };

  // candidate sites per site type: [{k, i, j, x, y, z, rot, H}]
  const sites = (type, r, rule) => {
    const res = [], inset = rule.in === undefined ? 0.3 : rule.in;
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const k = j * W + i, cx = (i + 0.5) * TILE, cz = (j + 0.5) * TILE, jx = (r() - 0.5) * 1.3;
      const wn = isWall(i, j - 1), ws = isWall(i, j + 1), ww = isWall(i - 1, j), we = isWall(i + 1, j);
      switch (type) {
        case 'edgeN': case 'edgeS': case 'edgeE': case 'edgeW': case 'edge': case 'cornerN': case 'cornerS': case 'floor': case 'pitEdge': {
          if (!freeF(k)) continue;
          const hy = Math.max(0, hts[k] > -50 ? hts[k] : 0);
          if (type === 'floor') { if (wn || ws || ww || we || corr[k] || !(map.rid && map.rid[k] >= 0)) continue; if (isWall(i - 1, j - 1) || isWall(i + 1, j - 1) || isWall(i - 1, j + 1) || isWall(i + 1, j + 1)) continue; res.push({ k, i, j, x: cx + jx, y: hy, z: cz + (r() - 0.5) * 1.3, rot: r() * 6.283 }); continue; }
          if (type === 'pitEdge') {
            const pn = at(i, j - 1) === T_PIT, ps = at(i, j + 1) === T_PIT, pw = at(i - 1, j) === T_PIT, pe = at(i + 1, j) === T_PIT;
            if (pn) res.push({ k, i, j, x: cx + jx, y: hy, z: j * TILE + inset, rot: 0 });
            else if (pw) res.push({ k, i, j, x: i * TILE + inset, y: hy, z: cz + jx, rot: Math.PI / 2 });
            else if (pe) res.push({ k, i, j, x: (i + 1) * TILE - inset, y: hy, z: cz + jx, rot: -Math.PI / 2 });
            else if (ps) res.push({ k, i, j, x: cx + jx, y: hy, z: (j + 1) * TILE - inset, rot: Math.PI });
            continue;
          }
          if (type === 'cornerN' || type === 'cornerS') {
            const v = type === 'cornerN' ? wn : ws; if (!v || !(ww || we) || (ww && we)) continue;
            const sx = ww ? 1 : -1, sz = type === 'cornerN' ? 1 : -1;
            res.push({ k, i, j, x: (ww ? i * TILE : (i + 1) * TILE) + sx * inset, y: hy, z: (type === 'cornerN' ? j * TILE : (j + 1) * TILE) + sz * inset, rot: type === 'cornerN' ? (ww ? 0.6 : -0.6) : Math.PI + (ww ? -0.6 : 0.6), cs: sx, H: hts[(j - 1) * W + i] });
            continue;
          }
          const want = type === 'edge' ? [wn && 'N', we && 'E', ww && 'W', ws && 'S'].filter(Boolean) : [type.slice(4)];
          for (const sd of want) {
            if (sd === 'N' && wn) res.push({ k, i, j, x: cx + jx, y: hy, z: j * TILE + inset, rot: (r() - 0.5) * 0.4 });
            else if (sd === 'S' && ws) res.push({ k, i, j, x: cx + jx, y: hy, z: (j + 1) * TILE - inset, rot: Math.PI + (r() - 0.5) * 0.4 });
            else if (sd === 'W' && ww) res.push({ k, i, j, x: i * TILE + inset, y: hy, z: cz + jx, rot: Math.PI / 2 + (r() - 0.5) * 0.4 });
            else if (sd === 'E' && we) res.push({ k, i, j, x: (i + 1) * TILE - inset, y: hy, z: cz + jx, rot: -Math.PI / 2 + (r() - 0.5) * 0.4 });
          }
          continue;
        }
        case 'wallTopN': case 'wallTopS': case 'wallTopSide': case 'wallTop': {
          if (!rim(i, j) || hts[k] < 0.5 || slit.has(k)) continue;
          const fs = isF(i, j + 1), fn = isF(i, j - 1), fe = isF(i + 1, j), fw = isF(i - 1, j);
          if (type === 'wallTopN' && !fs) continue;
          if (type === 'wallTopS' && !(fn && !fs)) continue;
          if (type === 'wallTopSide' && (fs || fn || !(fe || fw))) continue;
          const zz = type === 'wallTopN' ? (j + 1) * TILE - 0.55 : type === 'wallTopS' ? j * TILE + 0.45 : cz + (r() - 0.5) * 1.2;
          const xx = type === 'wallTopSide' ? (fe ? (i + 1) * TILE - 0.5 : i * TILE + 0.5) : cx + jx;
          res.push({ k, i, j, x: xx, y: hts[k], z: zz, rot: type === 'wallTopS' ? Math.PI : type === 'wallTopSide' ? (fe ? -Math.PI / 2 : Math.PI / 2) : (r() - 0.5) * 0.6 });
          continue;
        }
        case 'faceN': case 'faceSide': {
          if (!rim(i, j) || hts[k] < 0.5 || slit.has(k)) continue;
          if (type === 'faceN') { if (!isF(i, j + 1) || tt[k + W]) continue; res.push({ k, i, j, x: cx + (r() - 0.5) * 0.4, y: hts[k], z: (j + 1) * TILE, rot: 0, H: hts[k] }); }
          else {
            if (isF(i, j + 1)) continue;
            if (isF(i + 1, j) && !tt[k + 1]) res.push({ k, i, j, x: (i + 1) * TILE, y: hts[k], z: cz + (r() - 0.5) * 0.4, rot: Math.PI / 2, H: hts[k] });
            else if (isF(i - 1, j) && !tt[k - 1]) res.push({ k, i, j, x: i * TILE, y: hts[k], z: cz + (r() - 0.5) * 0.4, rot: -Math.PI / 2, H: hts[k] });
          }
          continue;
        }
        case 'void': {
          if (!isWall(i, j) || rim(i, j)) continue;
          let nearRim = false; for (let dy = -1; dy <= 1 && !nearRim; dy++) for (let dx = -1; dx <= 1; dx++) if (rim(i + dx, j + dy)) { nearRim = true; break; }
          if (!nearRim) continue;
          // lean toward the closest floor (trees reach over the walls)
          let fx = 0, fz = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (isF(i + dx, j + dy)) { fx += Math.sign(dx); fz += Math.sign(dy); }
          const rot = fx || fz ? Math.atan2(fx, fz) : r() * 6.283;
          res.push({ k, i, j, x: cx + (r() - 0.5) * 0.8, y: rule.y || 0, z: cz + (r() - 0.5) * 0.8, rot });
          continue;
        }
        case 'pit': {
          if (g[k] !== T_PIT || hts[k] < -50) continue;
          if (!(isF(i - 1, j) || isF(i + 1, j) || isF(i, j - 1) || isF(i, j + 1))) continue;
          res.push({ k, i, j, x: cx + (r() - 0.5) * 0.6, y: hts[k] + 0.005, z: cz + (r() - 0.5) * 0.6, rot: r() * 6.283 });
          continue;
        }
      }
    }
    return res;
  };

  const put = (name, s, r, sc) => {
    const fn = DPROP[name]; if (!fn) return;
    B.begin(s.x, s.y, s.z, s.rot, sc); B.H = s.H || 2; B.cs = s.cs || 1; B.r = r;
    fn(B, r, P);
    out.stats.props++;
  };
  kit.rules.forEach((rule, n) => {
    const r = RNG((map.seed ^ (0x5eed + n * 7919)) >>> 0);
    const cand = sites(rule.at, r, rule);
    const bit = SLOT[rule.at] || 1, sp = rule.sp || 0;
    const lastAt = sp ? new Int32Array(W * H).fill(0) : null;
    const mark = sp ? (i, j) => { for (let dy = -sp + 1; dy < sp; dy++) for (let dx = -sp + 1; dx < sp; dx++) { const ii = i + dx, jj = j + dy; if (ii >= 0 && jj >= 0 && ii < W && jj < H) lastAt[jj * W + ii] = 1; } } : null;
    for (const s of cand) {
      if (r() >= rule.d * dens) continue;
      if (rule.solo && (slot[s.k] & bit)) continue;
      if (sp && lastAt[s.k]) continue;
      if (rule.minH && (s.H || 0) < rule.minH) continue;
      const sc = rule.s ? rule.s[0] + r() * (rule.s[1] - rule.s[0]) : 0.85 + r() * 0.3;
      if (bit === 1 && kept(s.x, s.z, 0.6)) continue;
      if (bit !== 1 && kept(s.x, s.z, 1.5)) continue;
      if (rule.at === 'floor' && nearCtr(s.x, s.z)) continue;
      if (rule.rot0) s.rot = 0;
      if (rule.fwd) { s.x += Math.sin(s.rot) * rule.fwd * TILE * 0.5; s.z += Math.cos(s.rot) * rule.fwd * TILE * 0.5; }
      if (rule.h && occl(s.x + Math.sin(s.rot) * (rule.fwdC || 0), s.z, s.y, rule.h * sc, (rule.rad || 0.45) * sc)) continue;
      if (rule.p === 'tree') {  // canopy leans ~1.2 units toward the room: test that too
        const cx = s.x + Math.sin(s.rot) * 1.2 * sc, cz = s.z + Math.cos(s.rot) * 1.2 * sc;
        if (occl(cx, cz, 3.2 * sc, 3.2 * sc, 1.5 * sc)) continue;
      }
      if (rule.solo) slot[s.k] |= bit;
      if (sp) mark(s.i, s.j);
      put(rule.p, s, r, sc);
      if (/fern|bush|tree|flowers|broadLeaf/.test(rule.p)) anchors.push(s.x, s.y + (rule.p === 'tree' ? 2.4 : 0.6), s.z);
    }
  });

  // statues / columns: dress their tile margins (the solid tile is not walkable)
  const r2 = RNG((map.seed ^ 0x51d5) >>> 0);
  for (const sd of map.solids || []) {
    const name = kit.solids && kit.solids[sd.t]; if (!name) continue;
    const x = (sd.i + 0.5) * TILE, z = (sd.j + 0.5) * TILE;
    if (kept(x, z, 0)) continue;
    put(name, { x, y: 0, z, rot: 0 }, r2, 1);
  }
  // existing dungeon.js floor props get a ring of kit dressing so they sit in the scene
  if (kit.overlay) for (const d of map.deco || []) {
    if (d.t !== 'prop' || r2() > 0.8 * dens) continue;
    const x = (d.i + 0.5) * TILE, z = (d.j + 0.5) * TILE;
    if (kept(x, z, 0.5)) continue;
    put(kit.overlay, { x, y: 0, z, rot: d.rot || 0 }, r2, 1);
  }
  // chasms: rising soul wisps (crypt) — motes only
  if (kit.wisps) for (let k = 0; k < W * H; k++) {
    if (g[k] !== T_PIT || r2() > kit.wisps.n * dens) continue;
    const i = k % W, j = (k / W) | 0;
    out.motes.push((i + 0.2 + r2() * 0.6) * TILE, (hts[k] > -50 ? hts[k] : -3) + 0.5, (j + 0.2 + r2() * 0.6) * TILE, 2, kit.wisps.c, 0.16, 0.6 + r2() * 0.6);
    if (r2() < 0.25) out.glows.push({ k: 0, x: (i + 0.5) * TILE, y: (hts[k] > -50 ? hts[k] : -3) + 0.12, z: (j + 0.5) * TILE, sx: 5, sy: 5, c: kit.wisps.c, i: 0.25, fl: 0, ph: k % 6.283 });
  }
  // fireflies around vegetation
  if (kit.fireflies) for (let n = 0; n < anchors.length; n += 3) {
    if (r2() > kit.fireflies.n * dens) continue;
    out.motes.push(anchors[n] + (r2() - 0.5) * 1.5, anchors[n + 1] + 0.3 + r2() * 1.2, anchors[n + 2] + (r2() - 0.5) * 1.5, 0, r2() < 0.5 ? kit.fireflies.c : kit.fireflies.c2, 0.13, 0.35 + r2() * 0.4);
  }

  // ---- light shafts (rooms only, not near the portal / spawn) ----
  const shafts = [];
  if (kit.shafts && tier !== 'low') {
    const S = kit.shafts, r3 = RNG((map.seed ^ 0x5af7) >>> 0);
    for (const rm of map.rooms || []) {
      if (r3() > S.per) continue;
      const n = rm.w * rm.h > 90 ? 2 : 1;
      for (let q = 0; q < n; q++) {
        const i = rm.x + 1 + Math.floor(r3() * Math.max(1, rm.w - 2)), j = rm.y + 1 + Math.floor(r3() * Math.max(1, rm.h - 2));
        if (!isF(i, j)) continue;
        const x = (i + 0.5) * TILE, z = (j + 0.5) * TILE;
        if (kept(x, z, 0)) continue;
        shafts.push({ x, z, w: S.w[0] + r3() * (S.w[1] - S.w[0]), c: S.c, i: S.i * (0.7 + r3() * 0.5), ph: r3() * 6.283 });
        out.glows.push({ k: 0, x: x + 0.2, y: 0.05, z, sx: 3.6, sy: 3.0, c: S.c, i: S.i * 0.9, fl: 0, ph: 0 });
      }
    }
  }

  // ---- finalize: meshes ----
  const M = decorMats();
  const dg = new THREE.Group(); dg.name = 'decor';
  for (const W2 of out.chunks.values()) {
    if (!W2.nv) continue;
    const mesh = new THREE.Mesh(dwGeometry(W2, true), M.lit);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    dg.add(mesh);
  }
  if (out.glow.nv) { const m = new THREE.Mesh(dwGeometry(out.glow, false), M.glow); m.matrixAutoUpdate = false; dg.add(m); }
  // flames: one InstancedMesh, two instances per flame (outer colour + bright core)
  const nf = out.flames.length / 8;
  let flames = null, fdat = null;
  if (nf) {
    flames = new THREE.InstancedMesh(BOXG, M.flame, nf * 2);
    flames.frustumCulled = false; flames.renderOrder = 1;
    fdat = new Float32Array(nf * 6);
    for (let n = 0; n < nf; n++) {
      const o = n * 8;
      fdat.set([out.flames[o], out.flames[o + 1], out.flames[o + 2], out.flames[o + 3], out.flames[o + 4], out.flames[o + 5]], n * 6);
      _dc.setHex(out.flames[o + 6]).multiplyScalar(1.6); flames.setColorAt(n * 2, _dc);
      _dc.setHex(out.flames[o + 7]).multiplyScalar(1.4); flames.setColorAt(n * 2 + 1, _dc);
    }
    decorFlames(flames, fdat, 0);
    dg.add(flames);
  }
  // light pools / halos: one draw call (dungeon.js glow decals)
  const glowMesh = out.glows.length ? buildGlows(dg, out.glows) : null;
  // ground mist: a few big soft flat glows that drift
  let mist = null, mdat = null;
  if (kit.mist && tier !== 'low') {
    const r4 = RNG((map.seed ^ 0x3157) >>> 0), list = [];
    const fl = []; for (let k = 0; k < W * H; k++) if (g[k] === T_FLOOR && !(corr[k] && !(map.rid && map.rid[k] >= 0))) fl.push(k);
    const n = Math.round(Math.min(kit.mist.n, fl.length / 12) * dens);
    for (let q = 0; q < n && fl.length; q++) {
      const k = fl[Math.floor(r4() * fl.length)], s = kit.mist.s[0] + r4() * (kit.mist.s[1] - kit.mist.s[0]);
      list.push({ k: 0, x: (k % W + 0.5) * TILE, y: kit.mist.y + r4() * 0.25, z: (((k / W) | 0) + 0.5) * TILE, sx: s, sy: s * 0.7, c: kit.mist.c, i: kit.mist.i, fl: 0, ph: r4() * 6.283 });
    }
    if (list.length) { mist = buildGlows(dg, list); mdat = new Float32Array(list.length * 5); list.forEach((l, q) => mdat.set([l.x, l.y, l.z, l.sx, l.ph], q * 5)); mist.renderOrder = 1; }
  }
  // motes
  let motes = null;
  const nm = out.motes.length / 7;
  if (nm && tier !== 'low') {
    const pos = new Float32Array(nm * 3), ap = new Float32Array(nm * 4), col = new Float32Array(nm * 3);
    for (let q = 0; q < nm; q++) {
      const o = q * 7;
      pos[q * 3] = out.motes[o]; pos[q * 3 + 1] = out.motes[o + 1]; pos[q * 3 + 2] = out.motes[o + 2];
      ap[q * 4] = (q * 2.399) % 6.283 * 10; ap[q * 4 + 1] = out.motes[o + 6]; ap[q * 4 + 2] = out.motes[o + 3]; ap[q * 4 + 3] = out.motes[o + 5];
      _dc.setHex(out.motes[o + 4]); col[q * 3] = _dc.r * 1.5; col[q * 3 + 1] = _dc.g * 1.5; col[q * 3 + 2] = _dc.b * 1.5;
      if (out.motes[o + 3] === 1) { col[q * 3] /= 2.2; col[q * 3 + 1] /= 2.2; col[q * 3 + 2] /= 2.2; }   // leaves are lit, not glowing
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aP', new THREE.BufferAttribute(ap, 4));
    geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    motes = new THREE.Points(geo, M.motes); motes.frustumCulled = false; motes.renderOrder = 3;
    dg.add(motes);
  }
  // shafts: camera-facing ribbons slanted along the light direction
  let shaftMesh = null;
  if (shafts.length) {
    const p = [], a = [], c = [], idx = [];
    const view = new THREE.Vector3(0, 16.8, 10.5).normalize(), ax = new THREE.Vector3(), wv = new THREE.Vector3();
    shafts.forEach((s, q) => {
      const top = new THREE.Vector3(s.x - 3.2, 9, s.z - 1.0), bot = new THREE.Vector3(s.x, 0.02, s.z);
      ax.subVectors(top, bot); wv.crossVectors(ax, view).normalize().multiplyScalar(s.w / 2);
      const wt = wv.clone().multiplyScalar(1.5);
      p.push(bot.x - wv.x, bot.y - wv.y, bot.z - wv.z, bot.x + wv.x, bot.y + wv.y, bot.z + wv.z, top.x + wt.x, top.y + wt.y, top.z + wt.z, top.x - wt.x, top.y - wt.y, top.z - wt.z);
      a.push(0, -1, s.i, s.ph, 0, 1, s.i, s.ph, 1, 1, s.i, s.ph, 1, -1, s.i, s.ph);
      _dc.setHex(s.c); for (let v = 0; v < 4; v++) c.push(_dc.r, _dc.g, _dc.b);
      const b0 = q * 4; idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('aS', new THREE.Float32BufferAttribute(a, 4));
    geo.setAttribute('aCol', new THREE.Float32BufferAttribute(c, 3));
    geo.setIndex(idx); geo.computeBoundingSphere();
    shaftMesh = new THREE.Mesh(geo, M.shaft); shaftMesh.renderOrder = 4; shaftMesh.frustumCulled = false;
    dg.add(shaftMesh);
  }
  group.add(dg);
  if (Array.isArray(group.userData.lights)) for (const l of out.lights) group.userData.lights.push(l);
  const info = { flames, fdat, mist, mdat, motes, shafts: shaftMesh, glow: glowMesh, stats: Object.assign(out.stats, { lights: out.lights.length, flames: nf, motes: nm, shafts: shafts.length, chunks: out.chunks.size }) };
  group.userData.decor = info;
  return info;
}

// flame instance matrices (scale + translate written directly, no allocation)
function decorFlames(m, d, t) {
  const a = m.instanceMatrix.array, n = d.length / 6;
  for (let q = 0; q < n; q++) {
    const o = q * 6, ph = d[o + 5], f = 1 + 0.22 * Math.sin(t * 11 + ph) + 0.12 * Math.sin(t * 17.3 + ph * 2.1);
    const w = d[o + 3] * (1.05 - 0.1 * f), h = d[o + 4] * f, x = d[o], y = d[o + 1] + (h - d[o + 4]) * 0.4, z = d[o + 2];
    let b = q * 32;
    a[b] = w; a[b + 1] = 0; a[b + 2] = 0; a[b + 3] = 0; a[b + 4] = 0; a[b + 5] = h; a[b + 6] = 0; a[b + 7] = 0;
    a[b + 8] = 0; a[b + 9] = 0; a[b + 10] = w; a[b + 11] = 0; a[b + 12] = x; a[b + 13] = y; a[b + 14] = z; a[b + 15] = 1;
    b += 16; const wi = w * 0.5, hi = h * 0.55;
    a[b] = wi; a[b + 1] = 0; a[b + 2] = 0; a[b + 3] = 0; a[b + 4] = 0; a[b + 5] = hi; a[b + 6] = 0; a[b + 7] = 0;
    a[b + 8] = 0; a[b + 9] = 0; a[b + 10] = wi; a[b + 11] = 0; a[b + 12] = x; a[b + 13] = y - h * 0.18; a[b + 14] = z + w * 0.3; a[b + 15] = 1;
  }
  m.instanceMatrix.needsUpdate = true;
}

const _dv2 = new THREE.Vector2();
function animateDecor(level, t) {
  const D = level && level.userData.decor; if (!D) return;
  DECOR_U.uTime.value = t % 3600;
  const low = typeof GFX !== 'undefined' && GFX.q === 'low';
  if (D.flames) decorFlames(D.flames, D.fdat, t);
  // follow the level glow's gain / fog fade (set per tier and world by render.js)
  const lg = level.userData.glow && level.userData.glow.material.uniforms;
  if (lg) for (const m of [D.glow, D.mist]) if (m) { const u = m.material.uniforms; u.uGain.value = lg.uGain.value; u.uFogN.value = lg.uFogN.value; u.uFogF.value = lg.uFogF.value; u.uTime.value = lg.uTime.value; }
  if (D.shafts) { D.shafts.visible = !low; if (lg) { const u = D.shafts.material.uniforms; u.uFogN.value = lg.uFogN.value; u.uFogF.value = lg.uFogF.value; } }
  if (D.mist) {
    D.mist.visible = !low;
    const a = D.mist.instanceMatrix.array, d = D.mdat, n = d.length / 5;
    for (let q = 0; q < n; q++) {
      const o = q * 5, ph = d[o + 4], s = d[o + 3] * (1 + 0.12 * Math.sin(t * 0.21 + ph)), b = q * 16;
      a[b] = s; a[b + 6] = -s * 0.7; a[b + 9] = 1;
      a[b + 12] = d[o] + 1.6 * Math.sin(t * 0.06 + ph); a[b + 13] = d[o + 1]; a[b + 14] = d[o + 2] + 1.0 * Math.cos(t * 0.045 + ph * 1.3);
    }
    D.mist.instanceMatrix.needsUpdate = true;
  }
  if (D.motes) {
    D.motes.visible = !low;
    const u = D.motes.material.uniforms;
    if (typeof renderer !== 'undefined' && typeof camera !== 'undefined') u.uScale.value = renderer.getDrawingBufferSize(_dv2).y / (2 * Math.tan(camera.fov * Math.PI / 360));
    if (lg) u.uFogF.value = lg.uFogF.value;
  }
}
