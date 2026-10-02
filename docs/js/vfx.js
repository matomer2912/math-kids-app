// vfx.js — weapon visual effects: swing trails, hit sparks + impact flashes, enchantment motes,
// rarity auras on held weapons, projectile trails, pooled debris.
//
// Budget (phones, 3 heroes fighting a crowd): everything here is drawn with TWO meshes —
//   * one InstancedBufferGeometry of camera-facing / ground quads for every particle-like thing
//     (sparks, flashes, embers, motes, rings, dust, debris, arrow streaks), capped at MAXP instances;
//   * one dynamic triangle-strip buffer for the swing-trail ribbons (MAXR ribbons).
// Nothing is allocated per hit: particles live in a fixed pool, materials/geometries are created once.
// Both meshes use premultiplied blending (ONE, ONE_MINUS_SRC_ALPHA), so each particle picks how
// additive it is (glows: 1, dust/smoke/debris: 0) inside the same draw call.
// Everything is derived locally from what every device already knows (attack events, player weapon
// type/rarity/enchant mask from the snapshot, 'dmg' events with the attacker id, projectiles), so
// guests see their teammates' effects without extra network traffic.
// Tiers: High = all; Medium = fewer idle motes; Low / battery saver = trails + minimal sparks only.
'use strict';

const VFX = (() => {
  const MAXP = 256, POOL = 216;          // instance cap (pool + per-frame attached quads) / pooled particles
  const MAXR = 12, COLS = 18, ROWS = 4;  // swing-trail ribbons
  const FLOOR_Y = 0.17;                  // ground effects (floor dressing tops out at 0.06, blob shadows 0.09, rings 0.11-0.15)
  const TAU = Math.PI * 2;
  const rnd = Math.random;
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

  // ---------- colours (display space, 0..1; shaders output them as-is like toneMapped:false) ----------
  const cache = new Map();
  function rgb(hex) { let c = cache.get(hex); if (!c) { c = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; cache.set(hex, c); } return c; }
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const WHITE = [1, 1, 1];
  // trail / spark colour per rarity: common is a warm steel white, the rest use the rarity colour
  const RCOL = [rgb(0xfff1d8), rgb(0x55b4ff), rgb(0xcf6cff), rgb(0xffc21a)];
  const RCORE = RCOL.map((c, i) => mixc(c, WHITE, i ? 0.55 : 0.2));
  const REDGE = [rgb(0xffe2b0), rgb(0x2f86ff), rgb(0xa848ff), rgb(0xff8a00)]; // outer rim of a trail: deeper tone, reads on bright floors
  const RALPHA = [0.58, 0.66, 0.74, 0.84];
  const SPARK = [rgb(0xffe6a0), rgb(0x9fd6ff), rgb(0xe6a8ff), rgb(0xffd860)];
  const C = {
    ember: [rgb(0xffc04a), rgb(0xff8a1e), rgb(0xff5a14)], frost: rgb(0xc8f6ff), ice: rgb(0x8fe6ff), zap: rgb(0xd6f4ff), zapB: rgb(0x8fd8ff),
    leech: rgb(0xff2f52), leechD: rgb(0xb0102e), boom: rgb(0xff9a30), smoke: rgb(0x5a5048), dust: rgb(0xc9b48e), crit: rgb(0xff5a3a), staff: rgb(0xb388ff),
  };
  const E_FIRE = 1, E_ICE = 2, E_ZAP = 4, E_LEECH = 8, E_BOOM = 16, E_CRIT = 32; // bit i = ENCH_KEYS[i] (see enchMask in data.js)

  // ---------- particle mesh ----------
  // shapes: 0 soft glow dot, 1 spark streak (bright head), 2 ground ring, 3 ground soft disc, 4 square (debris), 5 star flare, 6 beam segment
  const pGeo = new THREE.InstancedBufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  pGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const iPos = new Float32Array(MAXP * 3), iDir = new Float32Array(MAXP * 3), iCol = new Float32Array(MAXP * 4), iPar = new Float32Array(MAXP * 4);
  const aPos = new THREE.InstancedBufferAttribute(iPos, 3), aDir = new THREE.InstancedBufferAttribute(iDir, 3), aCol = new THREE.InstancedBufferAttribute(iCol, 4), aPar = new THREE.InstancedBufferAttribute(iPar, 4);
  for (const a of [aPos, aDir, aCol, aPar]) a.setUsage(THREE.DynamicDrawUsage);
  pGeo.setAttribute('iPos', aPos); pGeo.setAttribute('iDir', aDir); pGeo.setAttribute('iCol', aCol); pGeo.setAttribute('iPar', aPar);
  pGeo.instanceCount = 0;
  const BLEND = { transparent: true, depthWrite: false, depthTest: true, toneMapped: false, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };
  const pMat = new THREE.ShaderMaterial(Object.assign({
    vertexShader: `attribute vec3 iPos; attribute vec3 iDir; attribute vec4 iCol; attribute vec4 iPar;
      varying vec4 vCol; varying vec2 vUv; varying float vShape, vAdd, vW;
      void main() {
        vCol = iCol; vUv = position.xy; vShape = iPar.y; vAdd = iPar.z; vW = iPar.w;
        float s = iPar.x;
        if (iPar.y > 1.5 && iPar.y < 3.5) { // flat on the ground
          gl_Position = projectionMatrix * viewMatrix * vec4(iPos + vec3(position.x * s, 0.0, -position.y * s), 1.0); // -y: keep the front face up
          return;
        }
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        mv.xyz *= 1.0 - 0.7 / length(mv.xyz); // pulled towards the camera along its view ray (same spot on screen)
        if (abs(iPar.y - 1.0) < 0.5 || iPar.y > 5.5) { // streak / beam: stretched along the screen direction of iDir
          vec2 ax = (viewMatrix * vec4(iDir, 0.0)).xy; float L = length(ax);
          vec2 nx = L > 1e-4 ? ax / L : vec2(1.0, 0.0), ny = vec2(-nx.y, nx.x);
          mv.xy += nx * position.x * (L + s) + ny * position.y * s;
        } else {
          float c = cos(iPar.w), d = sin(iPar.w);
          mv.xy += vec2(position.x * c - position.y * d, position.x * d + position.y * c) * s;
        }
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec4 vCol; varying vec2 vUv; varying float vShape, vAdd, vW;
      void main() {
        vec2 p = vUv; float r2 = dot(p, p), a;
        if (vShape < 0.5) { a = max(0.0, 1.0 - r2); a *= a; }
        else if (vShape < 1.5) { float u = p.x * 0.5 + 0.5; a = u * u * (1.0 - smoothstep(0.82, 1.0, u)) * max(0.0, 1.0 - p.y * p.y); }
        else if (vShape < 2.5) { float r = sqrt(r2); a = max(0.0, 1.0 - abs(r - 1.0 + vW) / vW); a *= a * step(r, 1.0); }
        else if (vShape < 3.5) { a = max(0.0, 1.0 - r2); a *= a; }
        else if (vShape < 4.5) { vec2 q = abs(p); a = 1.0 - smoothstep(0.62, 0.8, max(q.x, q.y)); }
        else if (vShape < 5.5) { vec2 q = abs(p); a = max(max(0.0, 1.0 - q.x) * max(0.0, 1.0 - q.y * 6.0), max(0.0, 1.0 - q.y) * max(0.0, 1.0 - q.x * 6.0)); float g = max(0.0, 1.0 - r2); a = max(a, g * g * g); }
        else { a = (1.0 - smoothstep(0.75, 1.0, abs(p.x))) * max(0.0, 1.0 - p.y * p.y); }
        float al = vCol.a * a;
        if (al < 0.004) discard;
        gl_FragColor = vec4(vCol.rgb * al, al * (1.0 - vAdd));
      }`,
  }, BLEND));
  pMat.userData.shared = true;
  const pMesh = new THREE.Mesh(pGeo, pMat);
  pMesh.frustumCulled = false; pMesh.renderOrder = 6; pMesh.visible = false; pMesh.name = 'vfxParticles';

  // ---------- ribbon mesh (swing trails) ----------
  const RV = COLS * ROWS;
  const rPos = new Float32Array(MAXR * RV * 3), rCol = new Float32Array(MAXR * RV * 4);
  const rGeo = new THREE.BufferGeometry();
  const raPos = new THREE.BufferAttribute(rPos, 3), raCol = new THREE.BufferAttribute(rCol, 4);
  raPos.setUsage(THREE.DynamicDrawUsage); raCol.setUsage(THREE.DynamicDrawUsage);
  rGeo.setAttribute('position', raPos); rGeo.setAttribute('aCol', raCol);
  { const idx = [];
    for (let r = 0; r < MAXR; r++) for (let c = 0; c < COLS - 1; c++) for (let w = 0; w < ROWS - 1; w++) {
      const v = r * RV + c * ROWS + w, n = v + ROWS;
      idx.push(v, n, v + 1, v + 1, n, n + 1);
    }
    rGeo.setIndex(idx); }
  const RIDX = (COLS - 1) * (ROWS - 1) * 6;
  const rMat = new THREE.ShaderMaterial(Object.assign({
    uniforms: { uAdd: { value: 0.72 } },
    vertexShader: `attribute vec4 aCol; varying vec4 vCol;
      void main() {
        vCol = aCol;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mv.xyz *= 1.0 - 1.6 / length(mv.xyz); // drawn in front of the enemies it slices through (walls still hide it)
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uAdd; varying vec4 vCol; void main() { float a = vCol.a; if (a < 0.004) discard; gl_FragColor = vec4(vCol.rgb * a, a * (1.0 - uAdd)); }`,
    side: THREE.DoubleSide,
  }, BLEND));
  rMat.userData.shared = true;
  const rMesh = new THREE.Mesh(rGeo, rMat);
  rMesh.frustumCulled = false; rMesh.renderOrder = 5; rMesh.visible = false; rMesh.name = 'vfxTrails';

  // ---------- world brightness ----------
  // On bright floors (sunlit sand, snow, sky marble) purely additive glows wash out, so there effects
  // blend more like paint (less additive) and trails get a little more opaque. 0 = dark world, 1 = bright.
  let brightKey = null, BR = 0, ADDK = 1;
  function updBright() {
    const T = G.theme, sun = typeof sunny !== 'undefined' && sunny;
    const key = T ? T.name + (sun ? '+' : '') : '';
    if (key === brightKey) return;
    brightKey = key;
    if (!T) return;
    const L = T.gfx || {}, c = rgb(T.floor || 0x808080);
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const B = lum * (0.45 * (L.sun ? L.sun[1] : 1) + (L.hemi || 0.8)) * (L.exp || 1) * (sun ? 1.5 : 1);
    BR = clamp01((B - 0.3) / 0.5);
    ADDK = 1 - 0.55 * BR;
    rMat.uniforms.uAdd.value = 0.82 - 0.5 * BR;
  }

  let added = false;
  function attach() { if (!added && typeof scene !== 'undefined') { scene.add(pMesh, rMesh); added = true; } }

  // ---------- particle pool ----------
  // x,y,z pos, vx,vy,vz vel, t/life, s0->s1 size, col, a alpha, sh shape, ad additive, g gravity (+ = falls),
  // dr drag, st streak factor (stretch = vel * st), ro/rv rotation, fl floor y, fi fade-in fraction,
  // hm: homing player id (-1 none) with hx,hy,hz start, w ring thickness
  const P = [];
  for (let i = 0; i < POOL; i++) P.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 1, s0: 0.1, s1: 0.1, col: WHITE, a: 1, sh: 0, ad: 1, g: 0, dr: 0, st: 0, ro: 0, rv: 0, fl: -9, fi: 0, hm: -1, hx: 0, hy: 0, hz: 0, w: 0.2, tw: 0, dxs: 0, dys: 0, dzs: 0 });
  let np = 0;
  function spawn(x, y, z, o) {
    if (np >= POOL) return null;
    const p = P[np++];
    p.x = x; p.y = y; p.z = z; p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0; p.t = 0; p.life = o.life || 0.3;
    p.s0 = o.s0 !== undefined ? o.s0 : 0.1; p.s1 = o.s1 !== undefined ? o.s1 : p.s0; p.col = o.col || WHITE; p.a = o.a !== undefined ? o.a : 1;
    p.sh = o.sh || 0; p.ad = o.ad !== undefined ? o.ad : 1; p.g = o.g || 0; p.dr = o.dr || 0; p.st = o.st || 0;
    p.ro = o.ro || 0; p.rv = o.rv || 0; p.fl = o.fl !== undefined ? o.fl : -9; p.fi = o.fi || 0; p.hm = o.hm !== undefined ? o.hm : -1; p.w = o.w || 0.2; p.tw = o.tw || 0;
    if (p.hm >= 0) { p.hx = x; p.hy = y; p.hz = z; }
    return p;
  }
  const load = () => np / POOL;

  // ---------- ribbons ----------
  const RB = [];
  for (let i = 0; i < MAXR; i++) RB.push({ on: false, pid: 0, x: 0, z: 0, y: 1, a0: 0, a1: 1, R: 3, w: 1, t: 0, dur: 0.1, fade: 0.12, col: WHITE, core: WHITE, al: 0.5, gl: 0, end: null, ended: false, ang: 0, rar: 0 });
  function ribbon(o) {
    let rb = RB.find(r => !r.on);
    if (!rb) { rb = RB[0]; for (const r of RB) if (r.t - r.dur - r.fade > rb.t - rb.dur - rb.fade) rb = r; } // steal the most finished one
    Object.assign(rb, { on: true, ended: false, end: null, gl: 0 }, o);
    return rb;
  }
  const easeInv = u => 1 - Math.sqrt(Math.max(0, 1 - u));     // inverse of easeOutQuad
  const ease = x => 1 - (1 - x) * (1 - x);

  // ---------- helpers ----------
  function tier() { return typeof gfxTier === 'function' ? gfxTier() : 'high'; }
  function viewPlayer(pid) {
    const v = G.view; if (!v) return null;
    for (const p of v.players) if (p.id === pid) return p;
    return null;
  }
  // rendered hero position (reused objects: called per particle / ribbon every frame)
  const posC = new Map();
  function heroPos(pid) {
    let c = posC.get(pid);
    if (!c) { c = { x: 0, z: 0 }; posC.set(pid, c); }
    if (pid === G.myId) { c.x = me.x; c.z = me.z; return c; }
    const o = vis.get('p' + pid); if (o) { c.x = o.x; c.z = o.z; return c; }
    const p = viewPlayer(pid); if (!p) return null;
    c.x = p.x; c.z = p.z; return c;
  }
  // weapon of a player: { w, r, em } (the local hero's is cached per equipped item)
  let myIt = null, myW = null;
  function weaponOf(pid) {
    if (pid === G.myId) {
      const it = equipped();
      if (it !== myIt || !myW || myW.w !== it.w || myW.r !== it.r) { myIt = it; myW = { w: it.w, r: it.r, em: enchMask(it.e) }; }
      return myW;
    }
    const p = viewPlayer(pid); return p ? { w: p.w, r: p.r | 0, em: p.em | 0 } : null;
  }
  const swingN = new Map(); // pid -> swing counter (alternating sword direction)

  // ---------- swing trails ----------
  // tuning per weapon: R = radius as a fraction of the weapon range, w = band width, dur = sweep time, fade = tail life
  const TRAIL = {
    // cp = where the bright core line sits inside the band (fraction of w from the rim), fl = fill strength
    sword:   { R: 0.93, w: 0.95, dur: 0.1, fade: 0.2, y: 1.0, arc: 1.0, cp: 0.14, fl: 0.3 },
    hammer:  { R: 0.86, w: 1.55, dur: 0.15, fade: 0.25, y: 1.15, arc: 1.0, cp: 0.28, fl: 0.55 },
    daggers: { R: 0.9, w: 0.55, dur: 0.06, fade: 0.12, y: 1.05, arc: 0.72, cp: 0.2, fl: 0.3 },
  };
  function slash(pid, ang, range, arc, rar) {
    const wp = weaponOf(pid); if (!wp) return;
    const T = TRAIL[wp.w] || TRAIL.sword;
    const pos = heroPos(pid); if (!pos) return;
    rar = Math.max(0, Math.min(3, rar | 0));
    const n = (swingN.get(pid) || 0) + 1; swingN.set(pid, n);
    const half = arc * T.arc / 2, R = range * T.R;
    // the right hand is on the hero's ang + PI/2 side: forehand sweeps right -> left; swords alternate back-hand
    const dir = wp.w === 'sword' && n % 2 === 0 ? -1 : 1;
    const base = { pid, x: pos.x, z: pos.z, R, col: RCOL[rar], core: RCORE[rar], al: RALPHA[rar], ang, rar, gl: rar, cp: T.cp, fl: T.fl };
    if (wp.w === 'daggers') {
      ribbon(Object.assign({}, base, { y: 1.08, a0: ang + half, a1: ang - half * 0.7, w: T.w, t: 0, dur: T.dur, fade: T.fade, al: base.al * 0.85 }));
      ribbon(Object.assign({}, base, { y: 0.9, a0: ang - half, a1: ang + half * 0.7, w: T.w, t: -0.045, dur: T.dur, fade: T.fade, al: base.al * 0.85, R: R * 0.92 }));
    } else {
      const rb = ribbon(Object.assign({}, base, { y: T.y, a0: ang + dir * half, a1: ang - dir * half, w: T.w, t: 0, dur: T.dur, fade: T.fade }));
      if (wp.w === 'hammer') { rb.al = Math.min(0.9, rb.al + 0.08); rb.end = hammerLand; }
    }
  }
  // hammer head hits the floor at the end of the swing: a puff of dust
  function hammerLand(rb) {
    if (tier() === 'low') return;
    const d = rb.R * 0.62, x = rb.x + Math.sin(rb.ang) * d, z = rb.z + Math.cos(rb.ang) * d;
    for (let i = 0; i < 5; i++) {
      const a = rnd() * TAU, s = 0.8 + rnd() * 1.4;
      spawn(x + Math.sin(a) * 0.3, FLOOR_Y + 0.15, z + Math.cos(a) * 0.3, { vx: Math.sin(a) * s, vz: Math.cos(a) * s, vy: 0.6 + rnd() * 0.6, dr: 3.5, life: 0.45 + rnd() * 0.2, s0: 0.22, s1: 0.5, col: C.dust, a: 0.32, ad: 0, fi: 0.1 });
    }
  }

  // ---------- hits ----------
  // a: ['dmg', x, z, amt, crit, src?] — src (attacker player id) is only sent for direct weapon hits
  const lastRing = new Map();
  function hit(x, z, crit, src) {
    const low = tier() === 'low';
    const wp = weaponOf(src), pos = heroPos(src);
    let dx = 0, dz = 1;
    if (pos) { dx = x - pos.x; dz = z - pos.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
    const w = wp ? wp.w : 'sword', r = wp ? wp.r : 0, em = wp ? wp.em : 0;
    const hx = x - dx * 0.45, hz = z - dz * 0.45, hy = 1.0;
    const busy = load(), mul = (low ? 0.4 : 1) * (busy > 0.85 ? 0.35 : busy > 0.6 ? 0.6 : 1) * (crit ? 1.5 : 1);
    const sc = SPARK[r];
    // impact flash (+ crit star)
    spawn(hx, hy, hz, { life: crit ? 0.14 : 0.09, s0: crit ? 0.75 : 0.45, s1: crit ? 1.05 : 0.65, col: mixc(sc, WHITE, 0.45), a: crit ? 0.95 : 0.6 });
    if (crit) {
      spawn(hx, hy + 0.05, hz, { sh: 5, life: 0.2, s0: 0.7, s1: 1.25, col: mixc(sc, WHITE, 0.4), a: 1, ro: rnd() * 0.6 });
      if (!low) spawn(x, FLOOR_Y, z, { sh: 2, life: 0.26, s0: 0.35, s1: 1.5, col: sc, a: 0.7, w: 0.22 });
    }
    // sparks flying away from the attacker
    if (w === 'staff') { // magic: round motes burst outward
      const n = Math.round(6 * mul), mc = r ? RCOL[r] : C.staff;
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU, s = 2 + rnd() * 3;
        spawn(hx, hy, hz, { vx: Math.sin(a) * s, vz: Math.cos(a) * s, vy: (rnd() - 0.3) * 3, dr: 4, life: 0.3 + rnd() * 0.15, s0: 0.11, s1: 0.03, col: mixc(mc, WHITE, 0.35), a: 0.95 });
      }
    } else {
      const n = Math.round((w === 'hammer' ? 8 : w === 'daggers' ? 3 : w === 'bow' ? 4 : 5) * mul);
      const sp = w === 'hammer' ? 1.2 : 0.95;
      const base = Math.atan2(dx, dz);
      for (let i = 0; i < n; i++) {
        const a = base + (rnd() - 0.5) * 2 * sp, s = 5 + rnd() * 6;
        spawn(hx, hy, hz, { vx: Math.sin(a) * s, vz: Math.cos(a) * s, vy: 1 + rnd() * 4, g: 16, dr: 2.5, st: 0.032, life: 0.16 + rnd() * 0.14, s0: 0.08, s1: 0.05, col: rnd() < 0.35 ? WHITE : sc, a: 1, sh: 1 });
      }
    }
    if (w === 'hammer' && !low) { // one shockwave ring per swing (a swing can hit several enemies)
      const now = G.time;
      if (!(now - (lastRing.get(src) || -9) < 0.3)) {
        lastRing.set(src, now);
        const d = pos ? Math.min(Math.hypot(x - pos.x, z - pos.z), 2.4) : 0, gx = pos ? pos.x + dx * d : x, gz = pos ? pos.z + dz * d : z;
        spawn(gx, FLOOR_Y, gz, { sh: 2, life: 0.32, s0: 0.4, s1: crit ? 2.6 : 2.0, col: mixc(sc, WHITE, 0.3), a: 0.6, w: 0.16, ad: 0.6 });
        if (crit && src === G.myId) G.shake = Math.max(G.shake, 0.16);
      }
    }
    if (em && !low) enchantHit(hx, hy, hz, em, src, busy);
  }
  function enchantHit(x, y, z, em, src, busy) {
    const k = busy > 0.75 ? 0.5 : 1;
    if (em & E_FIRE) for (let i = 0, n = Math.round(4 * k); i < n; i++) {
      const a = rnd() * TAU, s = 0.8 + rnd() * 1.6;
      spawn(x, y, z, { vx: Math.sin(a) * s, vz: Math.cos(a) * s, vy: 1.6 + rnd() * 1.8, g: -1.5, dr: 2.5, life: 0.4 + rnd() * 0.25, s0: 0.11, s1: 0.03, col: C.ember[i % 3], a: 1 });
    }
    if (em & E_ICE) {
      for (let i = 0, n = Math.round(4 * k); i < n; i++) {
        const a = rnd() * TAU, s = 3 + rnd() * 3;
        spawn(x, y, z, { vx: Math.sin(a) * s, vz: Math.cos(a) * s, vy: rnd() * 2.5, g: 8, dr: 3, st: 0.03, life: 0.28, s0: 0.07, s1: 0.04, col: C.frost, a: 1, sh: 1, ad: 0.6 });
      }
      spawn(x, FLOOR_Y, z, { sh: 2, life: 0.3, s0: 0.25, s1: 1.0, col: C.ice, a: 0.7, w: 0.3, ad: 0.6 });
    }
    if (em & E_ZAP) for (let i = 0, n = Math.round(4 * k); i < n; i++) {
      const a = rnd() * TAU, s = 9 + rnd() * 6;
      spawn(x, y + (rnd() - 0.5) * 0.6, z, { vx: Math.sin(a) * s, vz: Math.cos(a) * s, vy: (rnd() - 0.5) * 4, dr: 6, st: 0.02, life: 0.12, s0: 0.06, s1: 0.05, col: i % 2 ? C.zap : C.zapB, a: 1, sh: 1 });
    }
    if (em & E_LEECH) for (let i = 0, n = Math.round(3 * k); i < n; i++) // red motes drift back to the attacker (life steal)
      spawn(x + (rnd() - 0.5) * 0.5, y + rnd() * 0.4, z + (rnd() - 0.5) * 0.5, { hm: src, life: 0.42 + i * 0.07, s0: 0.12, s1: 0.06, col: i % 2 ? C.leech : C.leechD, a: 0.95, ad: 0.45, tw: rnd() * TAU });
    if (em & E_BOOM) for (let i = 0; i < 2; i++) {
      const a = rnd() * TAU;
      spawn(x, y, z, { vx: Math.sin(a) * 1.2, vz: Math.cos(a) * 1.2, vy: 1 + rnd(), dr: 2, life: 0.45, s0: 0.12, s1: 0.28, col: C.smoke, a: 0.45, ad: 0, fi: 0.15 });
    }
  }

  // ---------- specials ----------
  function special(pid, kind) {
    const pos = heroPos(pid), wp = weaponOf(pid); if (!pos || !wp) return;
    const r = wp.r | 0, low = tier() === 'low';
    const pv = pid === G.myId ? me : (vis.get('p' + pid) || {});
    const f = pv.f || 0;
    if (kind === 'spin') {
      ribbon({ pid, x: pos.x, z: pos.z, y: 1.0, R: 3.7, w: 1.4, cp: 0.2, fl: 0.4, a0: f + Math.PI, a1: f + Math.PI - TAU * 1.1, t: 0, dur: 0.3, fade: 0.2, col: RCOL[r], core: RCORE[r], al: Math.min(0.9, RALPHA[r] + 0.1), ang: f, rar: r, gl: r + 1 });
    } else if (kind === 'slam') {
      spawn(pos.x, FLOOR_Y, pos.z, { sh: 2, life: 0.45, s0: 0.8, s1: 6.2, col: mixc(SPARK[r], WHITE, 0.3), a: 0.75, w: 0.1, ad: 0.6 });
      if (!low) for (let i = 0; i < 14; i++) {
        const a = i / 14 * TAU + rnd() * 0.3, d = 1 + rnd() * 1.5, s = 4 + rnd() * 3;
        spawn(pos.x + Math.sin(a) * d, FLOOR_Y + 0.2, pos.z + Math.cos(a) * d, { vx: Math.sin(a) * s, vz: Math.cos(a) * s, vy: 0.8 + rnd(), dr: 3, life: 0.55 + rnd() * 0.25, s0: 0.3, s1: 0.75, col: C.dust, a: 0.35, ad: 0, fi: 0.08 });
      }
      if (pid === G.myId) G.shake = Math.max(G.shake, 0.3);
    } else if (kind === 'dash') {
      const c = RCOL[r];
      for (let i = 0; i < (low ? 4 : 9); i++) {
        const d = i * 0.9, side = (rnd() - 0.5) * 1.4;
        spawn(pos.x + Math.sin(f) * d + Math.cos(f) * side, 0.5 + rnd() * 1.1, pos.z + Math.cos(f) * d - Math.sin(f) * side, { vx: Math.sin(f) * 9, vz: Math.cos(f) * 9, dr: 7, st: 0.06, life: 0.25 + rnd() * 0.1, s0: 0.07, s1: 0.05, col: i % 2 ? c : WHITE, a: 0.8, sh: 1, fi: 0.05 });
      }
    }
  }

  // ---------- enemy death pop / explosions / lightning chain ----------
  function diePop(x, z, size) {
    const s = Math.max(1, size || 1);
    spawn(x, 1.0 * s, z, { life: 0.14, s0: 0.6 * s, s1: 1.1 * s, col: [1, 0.97, 0.9], a: 0.7 });
  }
  function boom(x, z, r, color) {
    if (tier() === 'low' || r < 3 || load() > 0.7) return; // staff splashes (r 2.2) are frequent: leave them to render.js
    for (let i = 0; i < 6; i++) {
      const a = rnd() * TAU, d = rnd() * r * 0.4;
      spawn(x + Math.sin(a) * d, 0.6 + rnd() * 0.6, z + Math.cos(a) * d, { vx: Math.sin(a) * 1.5, vz: Math.cos(a) * 1.5, vy: 1.2 + rnd(), dr: 1.5, life: 0.8 + rnd() * 0.3, s0: 0.35, s1: 0.9, col: C.smoke, a: 0.4, ad: 0, fi: 0.12 });
    }
    const ec = rgb(color || 0xff9a30);
    for (let i = 0; i < 6; i++) {
      const a = rnd() * TAU, s = 3 + rnd() * 4;
      spawn(x, 0.8, z, { vx: Math.sin(a) * s, vz: Math.cos(a) * s, vy: 3 + rnd() * 3, g: 9, dr: 1.5, life: 0.5 + rnd() * 0.3, s0: 0.1, s1: 0.04, col: mixc(ec, WHITE, 0.3), a: 1 });
    }
  }
  function zap(x1, z1, x2, z2) {
    let px = x1, py = 1.2, pz = z1;
    const N = 4;
    for (let i = 1; i <= N; i++) {
      const t = i / N, j = i < N ? 1 : 0;
      const nx = x1 + (x2 - x1) * t + (rnd() - 0.5) * 0.9 * j, ny = 1.2 + (rnd() - 0.5) * 0.6 * j, nz = z1 + (z2 - z1) * t + (rnd() - 0.5) * 0.9 * j;
      const p = spawn((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2, { sh: 6, life: 0.2, s0: 0.09, s1: 0.06, col: C.zap, a: 1 });
      if (p) { p.vx = 0; p.dxs = (nx - px) / 2; p.dys = (ny - py) / 2; p.dzs = (nz - pz) / 2; } // fixed stretch (see write)
      px = nx; py = ny; pz = nz;
    }
    spawn(x2, 1.2, z2, { life: 0.16, s0: 0.5, s1: 0.7, col: C.zapB, a: 0.8 });
  }

  // ---------- pooled debris (replaces the per-particle cube meshes of render.js particles()) ----------
  function debris(x, z, color, n, s) {
    if (load() > 0.8) n = Math.min(n, 3);
    const c = rgb(color);
    for (let i = 0; i < n; i++) {
      const sz = (0.12 + rnd() * 0.15) * s;
      spawn(x, 0.8, z, { vx: (rnd() - 0.5) * 8, vz: (rnd() - 0.5) * 8, vy: 3 + rnd() * 5, g: 20, life: 0.6, s0: sz * 0.62, s1: sz * 0.5, col: c, a: 1, ad: 0, sh: 4, ro: rnd() * 3, rv: (rnd() - 0.5) * 16, fl: 0.12 });
    }
    return true;
  }

  // ---------- per-frame attached quads (auras, projectile streaks/glows) ----------
  let nq = 0; // instances written this frame
  function quad(x, y, z, dx, dy, dz, s, sh, col, a, ad, w) {
    if (nq >= MAXP) return;
    const i = nq++, i3 = i * 3, i4 = i * 4;
    iPos[i3] = x; iPos[i3 + 1] = y; iPos[i3 + 2] = z;
    iDir[i3] = dx; iDir[i3 + 1] = dy; iDir[i3 + 2] = dz;
    iCol[i4] = col[0]; iCol[i4 + 1] = col[1]; iCol[i4 + 2] = col[2]; iCol[i4 + 3] = a;
    iPar[i4] = s; iPar[i4 + 1] = sh; iPar[i4 + 2] = ad * ADDK; iPar[i4 + 3] = w;
  }

  // weapon attach points in the weapon mesh's local space: [hilt, mid, tip]
  const WPT = {
    sword: [[0, 0.22, 0], [0, 0.72, 0], [0, 1.2, 0]], hammer: [[0, 0.4, 0], [0, 0.95, 0], [0, 1.05, 0]],
    daggers: [[0, 0.17, 0], [0, 0.42, 0], [0, 0.64, 0]], bow: [[0, -0.55, 0.08], [0, 0, 0.12], [0, 0.55, 0.08]],
    staff: [[0, 0.5, 0], [0, 1.32, 0], [0, 1.32, 0]],
  };
  const _v = new THREE.Vector3(), _h = new THREE.Vector3(), _m = new THREE.Vector3(), _t = new THREE.Vector3();
  const heroAcc = new Map(); // pid -> emission accumulators
  function emitN(acc, key, rate, dt) { acc[key] = (acc[key] || 0) + rate * dt; const n = Math.floor(acc[key]); acc[key] -= n; return n; }

  function heroIdle(p, dt, T, q) {
    const o = vis.get('p' + p.id); if (!o || !o.model || !o.model.wmesh) return;
    const mine = p.id === G.myId;
    const wp = mine ? weaponOf(p.id) : { w: p.w, r: p.r | 0, em: p.em | 0 };
    const pts = WPT[wp.w]; if (!pts) return;
    const aura = wp.r >= 2, em = wp.em & (E_FIRE | E_ICE | E_ZAP | E_LEECH | E_BOOM | E_CRIT);
    if (!aura && !em) return;
    o.model.wmesh.updateWorldMatrix(true, false); // this frame's pose of the hand chain only (the renderer updates the rest later)
    const wm = o.model.wmesh.matrixWorld;
    _h.fromArray(pts[0]).applyMatrix4(wm); _m.fromArray(pts[1]).applyMatrix4(wm); _t.fromArray(pts[2]).applyMatrix4(wm);
    const med = q === 'medium';
    const glowA = 1 - 0.4 * BR; // additive glows wash out on bright floors anyway: keep them soft there
    if (aura) { // weapon glow + motes circling the hero (legendary: gold, 3 motes with tails + glints; epic: fainter purple, 2 motes)
      const leg = wp.r === 3, col = RCOL[wp.r];
      quad(_m.x, _m.y, _m.z, 0, 0, 0, leg ? 0.9 : 0.66, 0, col, ((leg ? 0.42 : 0.27) + 0.06 * Math.sin(T * 2.6 + p.id)) * glowA, 1 / ADDK, 0);
      const n = leg ? (med ? 2 : 3) : (med ? 1 : 2), rr = leg ? 0.8 : 0.72, spd = leg ? 2.3 : 1.8;
      for (let i = 0; i < n; i++) {
        const a = T * spd + i * TAU / n + p.id * 1.3, y = 1.15 + Math.sin(T * 1.7 + i * 2.1) * 0.25;
        const x = o.x + Math.sin(a) * rr, z = o.z + Math.cos(a) * rr;
        const tx = Math.cos(a) * rr * spd * 0.1, tz = -Math.sin(a) * rr * spd * 0.1; // short tail along the orbit (head at the mote)
        quad(x - tx, y, z - tz, tx, 0, tz, leg ? 0.07 : 0.055, 1, col, leg ? 0.9 : 0.7, 0.85, 0);
        quad(x, y, z, 0, 0, 0, leg ? 0.13 : 0.1, 0, RCORE[wp.r], leg ? 1 : 0.8, 0.85, 0);
      }
      if (wp.r === 3 && o.model.wmesh2) { o.model.wmesh2.updateWorldMatrix(true, false); _v.fromArray(pts[1]).applyMatrix4(o.model.wmesh2.matrixWorld); quad(_v.x, _v.y, _v.z, 0, 0, 0, 0.6, 0, col, 0.26 * (1 - 0.45 * BR), 1 / ADDK, 0); }
      if (leg && !med) {
        const acc = heroAcc.get(p.id) || {}; heroAcc.set(p.id, acc);
        for (let i = emitN(acc, 'gl', 2.5, dt); i > 0; i--) {
          const u = 0.3 + rnd() * 0.7; _v.copy(_h).lerp(_t, u);
          spawn(_v.x, _v.y, _v.z, { sh: 5, vy: 0.4, life: 0.4, s0: 0.16, s1: 0.04, col: RCORE[3], a: 0.9, ro: rnd(), fi: 0.3 });
        }
      }
    }
    if (!em) return;
    { // a soft glow on the blade in the enchant's colour (fire flickers, lightning crackles: smooth, never strobing)
      const ec = em & E_FIRE ? C.ember[1] : em & E_ICE ? C.ice : em & E_ZAP ? C.zapB : em & E_LEECH ? C.leech : em & E_BOOM ? C.boom : null;
      if (ec) {
        const fl = em & E_FIRE ? 0.82 + 0.1 * Math.sin(T * 11 + p.id) + 0.08 * Math.sin(T * 17.3) : em & E_ZAP ? 0.8 + 0.2 * Math.sin(T * 23 + p.id) * Math.sin(T * 7.1) : 0.9 + 0.1 * Math.sin(T * 3);
        _v.copy(_m).lerp(_t, 0.4);
        quad(_v.x, _v.y, _v.z, 0, 0, 0, 0.55, 0, ec, 0.34 * fl * glowA, 1 / ADDK, 0);
      }
    }
    if (load() > 0.7) return;
    const acc = heroAcc.get(p.id) || {}; heroAcc.set(p.id, acc);
    const k = med ? 0.5 : 1;
    const along = () => { _v.copy(_h).lerp(_t, 0.25 + rnd() * 0.75); return _v; };
    if (em & E_FIRE) for (let i = emitN(acc, 'f', 12 * k, dt); i > 0; i--) {
      const v = along();
      spawn(v.x + (rnd() - 0.5) * 0.12, v.y, v.z + (rnd() - 0.5) * 0.12, { vx: (rnd() - 0.5) * 0.4, vz: (rnd() - 0.5) * 0.4, vy: 1.0 + rnd() * 0.9, g: -0.8, dr: 1, life: 0.6 + rnd() * 0.4, s0: 0.13, s1: 0.03, col: C.ember[(rnd() * 3) | 0], a: 1, fi: 0.1 });
    }
    if (em & E_ICE) for (let i = emitN(acc, 'i', 7 * k, dt); i > 0; i--) {
      const v = along();
      spawn(v.x + (rnd() - 0.5) * 0.3, v.y, v.z + (rnd() - 0.5) * 0.3, { vx: (rnd() - 0.5) * 0.3, vz: (rnd() - 0.5) * 0.3, vy: -0.35, life: 0.8 + rnd() * 0.4, s0: 0.15, s1: 0.04, col: C.frost, a: 1, sh: 5, ro: rnd(), rv: 1.5, fi: 0.25 });
    }
    if (em & E_ZAP) for (let i = emitN(acc, 'z', 4 * k, dt); i > 0; i--) { // a tiny crackling arc near the tip
      const v = along(), a = rnd() * TAU, b = rnd() * TAU, L = 0.19;
      const p1 = spawn(v.x + Math.cos(a) * L, v.y + Math.sin(b) * L, v.z + Math.sin(a) * L, { sh: 6, life: 0.13, s0: 0.055, s1: 0.04, col: C.zap, a: 1 });
      if (p1) { p1.dxs = Math.cos(a) * L; p1.dys = Math.sin(b) * L; p1.dzs = Math.sin(a) * L; }
      const p2 = spawn(v.x + Math.cos(a) * L * 2 + Math.sin(b) * L, v.y + Math.sin(b) * L * 2 - L * 0.5, v.z + Math.sin(a) * L * 2 + Math.cos(b) * L, { sh: 6, life: 0.13, s0: 0.05, s1: 0.035, col: C.zapB, a: 1 });
      if (p2) { p2.dxs = Math.sin(b) * L * 0.8; p2.dys = -L * 0.5; p2.dzs = Math.cos(b) * L * 0.8; }
    }
    if (em & E_LEECH) for (let i = emitN(acc, 'l', 5 * k, dt); i > 0; i--) {
      const v = along();
      spawn(v.x, v.y, v.z, { vy: 0.55 + rnd() * 0.3, life: 0.9 + rnd() * 0.3, s0: 0.13, s1: 0.05, col: rnd() < 0.5 ? C.leech : C.leechD, a: 0.85, ad: 0.45, tw: rnd() * TAU, fi: 0.2, dr: 0.5 });
    }
    if (em & E_BOOM) for (let i = emitN(acc, 'b', 1.6 * k, dt); i > 0; i--) {
      spawn(_t.x, _t.y, _t.z, { vx: (rnd() - 0.5) * 0.6, vz: (rnd() - 0.5) * 0.6, vy: 0.7, life: 0.7, s0: 0.07, s1: 0.2, col: C.smoke, a: 0.45, ad: 0, fi: 0.2 });
      spawn(_t.x, _t.y, _t.z, { vx: (rnd() - 0.5) * 3, vz: (rnd() - 0.5) * 3, vy: 2 + rnd() * 2, g: 9, life: 0.3, s0: 0.05, s1: 0.03, col: C.boom, a: 1, st: 0.02, sh: 1 });
    }
    if (em & E_CRIT) for (let i = emitN(acc, 'c', 0.9 * k, dt); i > 0; i--) // a glint running up the blade
      spawn(_t.x, _t.y, _t.z, { sh: 5, life: 0.3, s0: 0.05, s1: 0.2, col: [1, 0.85, 0.8], a: 0.9, ro: 0.4, fi: 0.4 });
  }

  // ---------- projectiles ----------
  const projInfo = new Map(); // id -> { em, seen }
  let projFrame = 0;
  function projectiles(dt, q) {
    const v = G.view; if (!v) return;
    projFrame++;
    const low = q === 'low', med = q === 'medium';
    for (const j of v.projs) {
      if (j.k !== 'arrow' && j.k !== 'orb') continue;
      let info = projInfo.get(j.id);
      const sp = Math.hypot(j.vx, j.vz) || 1, ux = j.vx / sp, uz = j.vz / sp, r = Math.max(0, Math.min(3, j.col | 0));
      if (!info) { // first sight: guess the shooter (nearest hero with that weapon kind) for the enchant mask
        let best = null, bd = 16;
        for (const p of v.players) {
          const w = p.id === G.myId ? equipped().w : p.w; if ((w === 'bow') !== (j.k === 'arrow') || (w !== 'bow' && w !== 'staff')) continue;
          const pos = heroPos(p.id) || p, d = (pos.x - j.x) ** 2 + (pos.z - j.z) ** 2;
          if (d < bd) { bd = d; best = p; }
        }
        const wp = best ? weaponOf(best.id) : null;
        info = { em: wp ? wp.em : 0, acc: {} };
        projInfo.set(j.id, info);
        if (!low && load() < 0.8) spawn(j.x, 1.0, j.z, { life: 0.1, s0: 0.35, s1: 0.55, col: mixc(RCOL[r], WHITE, 0.5), a: 0.7 }); // muzzle flash
      }
      info.seen = projFrame;
      const col = j.k === 'orb' && !r ? C.staff : RCOL[r];
      if (j.k === 'arrow') {
        const L = 0.75 + r * 0.12;
        quad(j.x - ux * (L + 0.2), 1.0, j.z - uz * (L + 0.2), ux * L, 0, uz * L, 0.07 + r * 0.008, 1, r ? mixc(col, WHITE, 0.25) : rgb(0xfff3c4), 0.55 + r * 0.1, 0.8, 0);
      } else if (!low) {
        quad(j.x, 1.0, j.z, 0, 0, 0, 0.62 + r * 0.06, 0, col, 0.4 + r * 0.05, 1, 0);
        if (load() < 0.75) for (let i = emitN(info.acc, 't', med ? 12 : 22, dt); i > 0; i--)
          spawn(j.x - ux * 0.25 + (rnd() - 0.5) * 0.2, 1.0 + (rnd() - 0.5) * 0.2, j.z - uz * 0.25 + (rnd() - 0.5) * 0.2, { life: 0.26, s0: 0.14 + r * 0.015, s1: 0.02, col: mixc(col, WHITE, 0.3), a: 0.85 });
      }
      if (low || !info.em || load() > 0.7) continue;
      const em = info.em, k = med ? 0.5 : 1;
      if (em & E_FIRE) for (let i = emitN(info.acc, 'f', 18 * k, dt); i > 0; i--) spawn(j.x, 1.0, j.z, { vx: (rnd() - 0.5) * 0.8, vz: (rnd() - 0.5) * 0.8, vy: 1 + rnd(), life: 0.35, s0: 0.08, s1: 0.02, col: C.ember[(rnd() * 3) | 0], a: 1 });
      if (em & E_ICE) for (let i = emitN(info.acc, 'i', 12 * k, dt); i > 0; i--) spawn(j.x, 1.0, j.z, { vy: -0.4, life: 0.45, s0: 0.09, s1: 0.03, col: C.frost, a: 0.9, sh: 5, ro: rnd() });
      if (em & E_ZAP) for (let i = emitN(info.acc, 'z', 10 * k, dt); i > 0; i--) { const a = rnd() * TAU; spawn(j.x, 1.0, j.z, { vx: Math.sin(a) * 4, vz: Math.cos(a) * 4, vy: (rnd() - 0.5) * 3, dr: 8, st: 0.02, life: 0.1, s0: 0.045, col: C.zap, a: 1, sh: 1 }); }
      if (em & E_LEECH) for (let i = emitN(info.acc, 'l', 9 * k, dt); i > 0; i--) spawn(j.x, 1.0, j.z, { vy: 0.4, life: 0.4, s0: 0.08, s1: 0.03, col: C.leech, a: 0.9, ad: 0.45 });
    }
    if (projFrame % 30 === 0) for (const [id, info] of projInfo) if (info.seen !== projFrame) projInfo.delete(id);
  }

  // burning / slowed enemies (snapshot flags 4 / 8): embers and frost motes
  let enemyAcc = 0;
  function statusMotes(dt, q) {
    if (q === 'low' || load() > 0.6) return;
    const v = G.view; if (!v) return;
    enemyAcc += dt * (q === 'medium' ? 2.5 : 5);
    const n = Math.floor(enemyAcc); if (!n) return;
    enemyAcc -= n;
    let k = 0;
    for (const e of v.enemies) {
      if (!(e.fl & 12)) continue;
      if (++k > 14) break;
      const o = vis.get('e' + e.id), x = o ? o.x : e.x, z = o ? o.z : e.z, s = e.size || 1;
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU, d = rnd() * 0.45 * s, y = (0.5 + rnd() * 1.1) * s;
        if (e.fl & 4) spawn(x + Math.sin(a) * d, y, z + Math.cos(a) * d, { vy: 1.2 + rnd() * 0.8, g: -0.6, life: 0.5 + rnd() * 0.3, s0: 0.09, s1: 0.02, col: C.ember[(rnd() * 3) | 0], a: 1 });
        if (e.fl & 8) spawn(x + Math.sin(a) * d, y + 0.3, z + Math.cos(a) * d, { vy: -0.5, life: 0.7, s0: 0.09, s1: 0.03, col: C.frost, a: 0.85, sh: 5, ro: rnd(), fi: 0.25 });
      }
    }
  }

  // ---------- simulate + write buffers ----------
  function simulate(dt) {
    for (let i = np - 1; i >= 0; i--) {
      const p = P[i];
      p.t += dt;
      if (p.t >= p.life) { np--; if (i !== np) { P[i] = P[np]; P[np] = p; } continue; }
      if (p.hm >= 0) { // homing mote: ease from its start point into the attacker's chest
        const pos = heroPos(p.hm);
        if (pos) {
          const k = p.t / p.life, e = k * k;
          const wob = Math.sin(p.tw + k * 9) * 0.35 * (1 - k);
          p.x = p.hx + (pos.x - p.hx) * e + wob; p.y = p.hy + (1.15 - p.hy) * e + Math.sin(k * Math.PI) * 0.5; p.z = p.hz + (pos.z - p.hz) * e + wob * 0.6;
          continue;
        }
        p.hm = -1;
      }
      if (p.dr) { const f = Math.max(0, 1 - p.dr * dt); p.vx *= f; p.vz *= f; if (p.g <= 0) p.vy *= f; }
      p.vy -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.tw && p.sh === 0) { p.x += Math.sin(p.t * 5 + p.tw) * 0.25 * dt; } // wisps curl
      if (p.y < p.fl) { p.y = p.fl; p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; p.rv *= 0.8; }
      p.ro += p.rv * dt;
    }
    for (let i = 0; i < np; i++) {
      const p = P[i], k = p.t / p.life;
      let a = p.a * (1 - k);
      if (p.fi && k < p.fi) a *= k / p.fi;
      if (p.sh === 4 || p.sh === 2) a = p.a * (k < 0.6 ? 1 : (1 - k) / 0.4) * (p.sh === 2 ? 1 - k * 0.5 : 1);
      const s = p.s0 + (p.s1 - p.s0) * k;
      let dx = 0, dy = 0, dz = 0;
      if (p.sh === 1) { dx = p.vx * p.st; dy = p.vy * p.st; dz = p.vz * p.st; }
      else if (p.sh === 6) { dx = p.dxs; dy = p.dys; dz = p.dzs; }
      quad(p.x, p.y, p.z, dx, dy, dz, s, p.sh, p.col, a, p.ad, p.sh === 2 ? p.w : p.ro);
    }
  }

  const radii = [0, 0, 0, 0], alphas = [0, 0, 0, 0];
  let shade = RCOL, shadeBR = -1;
  function writeRibbons(dt) {
    let nr = 0;
    if (shadeBR !== BR) { shadeBR = BR; shade = RCOL.map(c => mixc(c, [0.1, 0.06, 0.03], 0.85 * BR)); }
    for (const rb of RB) {
      if (!rb.on) continue;
      rb.t += dt;
      if (rb.t >= rb.dur + rb.fade) { rb.on = false; continue; }
      if (rb.t < 0) continue;
      if (rb.pid !== undefined && rb.pid >= 0) { const pos = heroPos(rb.pid); if (pos) { rb.x = pos.x; rb.z = pos.z; } } // the trail rides with its hero
      const pHead = ease(Math.min(1, rb.t / rb.dur));
      const uT = ease(clamp01((rb.t - rb.fade) / rb.dur));
      if (!rb.ended && rb.t >= rb.dur) { rb.ended = true; if (rb.end) rb.end(rb); }
      if (pHead - uT < 1e-3) continue;
      // sparkle glints shed from the leading edge (epic / legendary)
      if (rb.gl >= 2 && rb.t < rb.dur && tier() !== 'low') {
        if (rnd() < (rb.gl >= 3 ? 0.9 : 0.4)) {
          const ah = rb.a0 + (rb.a1 - rb.a0) * pHead, rr = rb.R - rnd() * 0.25;
          spawn(rb.x + Math.sin(ah) * rr, rb.y + (rnd() - 0.5) * 0.15, rb.z + Math.cos(ah) * rr, { sh: 5, vx: Math.sin(ah) * 1.5, vz: Math.cos(ah) * 1.5, vy: 0.5, dr: 3, life: 0.3, s0: 0.14, s1: 0.03, col: RCORE[rb.rar], a: 1, ro: rnd() });
        }
      }
      const vb = nr * RV;
      for (let c = 0; c < COLS; c++) {
        const u = uT + (pHead - uT) * c / (COLS - 1);
        const ang = rb.a0 + (rb.a1 - rb.a0) * u;
        const age = rb.t - rb.dur * easeInv(u);
        const k = clamp01(1 - age / rb.fade);
        const taper = 0.3 + 0.7 * k;
        const al = Math.min(0.95, rb.al * (1 + 0.22 * BR)) * Math.pow(k, 0.8);
        const sx = Math.sin(ang), sz = Math.cos(ang);
        // rows inside -> out: transparent, soft fill (a darker under-stroke on bright floors), bright core, rim
        const wt = rb.w * taper;
        radii[0] = rb.R - wt; radii[1] = rb.R - wt * (rb.cp + 0.3); radii[2] = rb.R - wt * rb.cp; radii[3] = rb.R;
        alphas[1] = al * Math.min(0.9, rb.fl + 0.3 * BR); alphas[2] = al; alphas[3] = al * 0.6;
        for (let w = 0; w < ROWS; w++) {
          const vi = vb + c * ROWS + w, p3 = vi * 3, p4 = vi * 4;
          rPos[p3] = rb.x + sx * radii[w]; rPos[p3 + 1] = rb.y; rPos[p3 + 2] = rb.z + sz * radii[w];
          const col = w === 2 ? rb.core : w === 3 ? REDGE[rb.rar] : w === 1 ? shade[rb.rar] : rb.col;
          rCol[p4] = col[0]; rCol[p4 + 1] = col[1]; rCol[p4 + 2] = col[2]; rCol[p4 + 3] = alphas[w];
        }
      }
      nr++;
    }
    if (nr) {
      raPos.updateRange.offset = 0; raPos.updateRange.count = nr * RV * 3; raPos.needsUpdate = true;
      raCol.updateRange.offset = 0; raCol.updateRange.count = nr * RV * 4; raCol.needsUpdate = true;
    }
    rGeo.setDrawRange(0, nr * RIDX);
    rMesh.visible = nr > 0;
    return nr;
  }

  // ---------- public ----------
  const api = {
    on: true,
    stats: { p: 0, q: 0, r: 0 },
    _dbg: { RB, P },
    // every game event (render.js handleEvent); legacy visuals are skipped by render.js where VFX draws them
    onEvent(a) {
      if (!api.on || !G.view) return;
      attach();
      switch (a[0]) {
        case 'slash': slash(a[1], a[2], a[3], a[4], a[5]); break;
        case 'dmg': if (a.length > 5 && typeof a[5] === 'number') hit(a[1], a[2], a[4], a[5]); break;
        case 'special': special(a[1], a[2]); break;
        case 'die': diePop(a[1], a[2], a[4]); break;
        case 'boom': boom(a[1], a[2], a[3], a[4]); break;
        case 'zap': zap(a[1], a[2], a[3], a[4]); break;
      }
    },
    debris(x, z, color, n, s) { if (!api.on) return false; attach(); return debris(x, z, color, n, s); },
    update(dt) {
      if (!api.on) { pMesh.visible = rMesh.visible = false; return; }
      attach();
      const q = tier();
      updBright();
      nq = 0;
      const nr = writeRibbons(dt);
      const v = G.view;
      if (v && G.inGame) {
        if (q !== 'low') { const T = G.time; for (const p of v.players) if (!p.downed) heroIdle(p, dt, T, q); statusMotes(dt, q); }
        projectiles(dt, q);
      }
      simulate(dt);
      if (nq) {
        for (const [a, n] of [[aPos, 3], [aDir, 3], [aCol, 4], [aPar, 4]]) { a.updateRange.offset = 0; a.updateRange.count = nq * n; a.needsUpdate = true; }
      }
      pGeo.instanceCount = nq;
      pMesh.visible = nq > 0;
      api.stats.p = np; api.stats.q = nq; api.stats.r = nr;
    },
    clear() {
      np = 0; nq = 0; pGeo.instanceCount = 0; pMesh.visible = false;
      for (const rb of RB) rb.on = false; rMesh.visible = false;
      projInfo.clear(); heroAcc.clear(); swingN.clear(); lastRing.clear();
    },
  };
  return api;
})();
