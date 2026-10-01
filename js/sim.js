// sim.js — host-authoritative simulation: enemies, combat, projectiles, loot, bosses
// Player positions are owned by each player's own device; everything else is decided here.
'use strict';

const Sim = (() => {
  const S = {
    floor: 1, seed: 1, map: null, theme: THEMES[0],
    players: new Map(), enemies: [], projs: [], loot: [],
    events: [], nextId: 1, boss: null, portalOpen: false, time: 0,
    flow: null, flowT: 0, wipeT: 0, nPlayersAtStart: 1,
  };
  const nid = () => S.nextId++;
  const ev = (...a) => { S.events.push(a); if (Sim.onEvent) Sim.onEvent(a); };
  const scaleHp = f => 1 + 0.38 * (f - 1);
  const scaleDmg = f => 1 + 0.16 * (f - 1);
  const coopHp = () => 1 + 0.55 * (Math.max(1, S.players.size) - 1);

  function alivePlayers() { const a = []; for (const p of S.players.values()) if (!p.downed) a.push(p); return a; }

  // ---------- player management ----------
  function addPlayer(id, info) {
    const p = {
      id, name: info.name || ('Hero ' + (id + 1)), color: info.color || PLAYER_COLORS[id % PLAYER_COLORS.length],
      x: S.map ? S.map.start.x + (id % 2) * 1.5 : 0, z: S.map ? S.map.start.z + (id > 1 ? 1.5 : 0) : 0, f: 0,
      lvl: info.lvl || 1, wpn: info.wpn || makeItem(1, 0, 'sword'), hp: 0, maxHp: 0,
      downed: false, revive: 0, atkT: 0, scdT: 0, potT: 0, inv: 0, hurtT: 0, atkAnim: 0, floor: S.floor,
      inp: { atk: false, an: 0, pn: 0, dn: 0 }, last: { an: 0, pn: 0, dn: 0 }, init: false,
    };
    p.maxHp = maxHpFor(p.lvl); p.hp = p.maxHp;
    // make sure every player has a different color
    const used = new Set([...S.players.values()].map(o => o.color));
    if (used.has(p.color)) p.color = PLAYER_COLORS.find(c => !used.has(c)) || p.color;
    S.players.set(id, p);
    return p;
  }
  function removePlayer(id) { S.players.delete(id); }
  function setStats(id, st) {
    const p = S.players.get(id); if (!p) return;
    if (st.lvl) { const old = p.maxHp; p.lvl = st.lvl; p.maxHp = maxHpFor(p.lvl); if (p.maxHp > old) p.hp += p.maxHp - old; }
    if (st.wpn) p.wpn = st.wpn;
    if (st.name) p.name = st.name;
    if (st.color && ![...S.players.values()].some(o => o !== p && o.color === st.color)) p.color = st.color;
  }
  function setInput(id, m) {
    const p = S.players.get(id); if (!p) return;
    if (m.fl !== S.floor) return; // stale packet from previous floor
    if (!p.downed) { p.x = m.x; p.z = m.z; }
    p.f = m.f; p.moving = m.mv;
    p.inp.atk = !!m.atk; p.inp.an = m.an; p.inp.pn = m.pn; p.inp.dn = m.dn;
    if (!p.init) { p.last.an = m.an; p.last.pn = m.pn; p.last.dn = m.dn; p.init = true; }
  }

  // ---------- floors ----------
  function startFloor(floor, seed) {
    S.floor = floor; S.seed = seed;
    S.map = genDungeon(seed, floor);
    S.theme = themeFor(floor);
    S.enemies = []; S.projs = []; S.loot = []; S.boss = null; S.portalOpen = !S.map.boss; S.wipeT = 0;
    S.timers = []; S.hz = []; S.waves = []; S.arenas = []; S.trapT = 0;
    S.plateCd = S.map.plates.map(() => 0);
    S.nPlayersAtStart = Math.max(1, S.players.size);
    let k = 0;
    for (const p of S.players.values()) {
      p.x = S.map.start.x + ((k % 2) - 0.5) * 2; p.z = S.map.start.z + (k > 1 ? 1.5 : -0.5); k++;
      p.downed = false; p.hp = p.maxHp; p.revive = 0; p.floor = floor;
    }
    populate();
  }
  // run fn after a delay (host only; cleared on every new floor)
  function later(t, fn) { S.timers.push({ t, fn }); }

  function spawnEnemy(type, x, z, opts) {
    const d = ENEMIES[type];
    opts = opts || {};
    const sk = d.prop ? type : opts.skin || S.theme.mobs[type] || NEW_MOBS[type] || 'grunt';
    const elite = opts.elite;
    let size = type === 'brute' ? 1.45 : type === 'runner' ? 0.85 : type === 'slime' ? (opts.small ? 0.7 : 1.3) : type === 'egg' ? 0.9 : 1;
    let hp = d.prop ? 1 : Math.round(d.hp * scaleHp(S.floor) * coopHp() * (elite ? 3 : 1) * (opts.small ? 0.45 : 1));
    const e = {
      id: nid(), type, sk: SKINS.indexOf(sk), x, z, f: R() * 6.28, hp, maxHp: hp, d,
      st: 'idle', t: 0, cd: R() * 1.5, awake: false, kx: 0, kz: 0, burn: 0, burnDps: 0, burnSrc: -1,
      slow: 0, stun: 0, flash: 0, size: size * (elite ? 1.3 : 1), elite: !!elite, summonT: 4 + R() * 3,
      r: d.r * (elite ? 1.3 : 1) * (opts.small ? 0.7 : 1), small: !!opts.small, trapT: 0,
    };
    if (type === 'egg') { e.hatch = 5; e.awake = true; }
    if (type === 'totem') e.summonT = 2.5;
    if (type === 'mage') e.blinkT = 3 + R() * 2;
    S.enemies.push(e);
    return e;
  }

  const MAX_ENTS = 88;           // network budget: enemies + props per floor
  function freeSpotIn(r, pad, rad) {
    const map = S.map;
    for (let t = 0; t < 40; t++) {
      const x = (r.x + pad + R() * (r.w - 2 * pad)) * TILE, z = (r.y + pad + R() * (r.h - 2 * pad)) * TILE;
      if (blockedCircle(map, x, z, rad || 0.6)) continue;
      const tt = map.tt[tileOf(map, x, z)];
      if (tt === TT_SPIKE || tt === TT_VENT || tt === TT_PLATE) continue;
      if (Math.hypot(x - map.exit.x, z - map.exit.z) < 3) continue;
      return { x, z };
    }
    return null;
  }

  function populate() {
    const map = S.map, f = S.floor;
    const rooms = map.rooms;
    const pool = MOB_KEYS.filter(k => !ENEMIES[k].minF || f >= ENEMIES[k].minF);
    const totalW = pool.reduce((s, k) => s + ENEMIES[k].w, 0);
    const pickType = () => { let x = R() * totalW; for (const k of pool) { x -= ENEMIES[k].w; if (x <= 0) return k; } return 'grunt'; };
    const freeSpot = (r, pad, rad) => freeSpotIn(r, pad, rad);
    if (map.boss) {
      const arena = rooms[1];
      const B = S.theme.boss;
      const hp = Math.round(ENEMIES.boss.hp * scaleHp(f) * coopHp() * (1 + 0.15 * Math.floor(f / 12)));
      const bx = (arena.x + arena.w / 2) * TILE, bz = (arena.y + arena.h / 2) * TILE;
      const e = spawnEnemy('boss', bx, bz, { skin: 'boss' });
      e.hp = e.maxHp = hp; e.size = 2.8; e.r = 1.9; e.name = B.name; e.phase = 1; e.st = 'idle'; e.t = 2; e.atkIdx = 0;
      if (B.kind === 'spider' || B.kind === 'dragon') e.size = 2.4;
      S.boss = e;
      for (let i = 0; i < 4; i++) { const s = freeSpot(arena, 2); if (s) spawnEnemy(i < 2 ? 'pot' : (i === 2 ? 'barrel' : 'crate'), s.x, s.z); }
      // explosive barrels around the arena: lure the boss next to them!
      for (let i = 0; i < 3; i++) { const s = freeSpot(arena, 4); if (s) spawnEnemy('xbarrel', s.x, s.z); }
      return;
    }
    // plan how many mobs each room gets, then scale to the network budget
    const plan = rooms.map((r, i) => {
      if (i === 0) return 0;
      let n = Math.round(r.w * r.h / 17 * (0.75 + 0.06 * Math.min(f, 12)));
      n = Math.min(n, 9);
      if (r.kind === 'shrine') n = Math.min(n, 2);
      if (r.kind === 'arena') n = 0;
      if (r.kind === 'vault') n = 1;
      if (r.kind === 'traps') n = Math.ceil(n * 0.5);
      if (r.kind === 'storage') n = Math.ceil(n * 0.6);
      return n;
    });
    const props = rooms.map((r, i) => i === 0 ? 0 : r.kind === 'storage' ? 4 : r.kind === 'vault' ? 3 : r.kind === 'shrine' ? 1 : R.int(1, 2));
    const nChestR = (f > 4 ? 2 : 1);
    const propTotal = props.reduce((a, b) => a + b, 0) + nChestR + rooms.filter(r => r.kind === 'vault' || r.kind === 'traps').length * 1.5 + 3;
    const mobTotal = plan.reduce((a, b) => a + b, 0);
    const mobBudget = Math.max(20, MAX_ENTS - propTotal - 8);
    const scale = Math.min(1, mobBudget / Math.max(1, mobTotal));

    const chestRooms = new Set();
    const normalIdx = rooms.map((r, i) => i).filter(i => i > 0 && (rooms[i].kind === 'normal' || rooms[i].kind === 'exit' || rooms[i].kind === 'chasm'));
    while (chestRooms.size < Math.min(nChestR, normalIdx.length)) chestRooms.add(normalIdx[Math.floor(R() * normalIdx.length)]);
    let totems = f >= 5 ? (f >= 12 ? 2 : 1) : 0;
    const putChest = (r) => { const c = { x: (r.x + r.w / 2) * TILE, z: (r.y + r.h / 2) * TILE }; if (!blockedCircle(map, c.x, c.z, 0.8) && !map.tt[tileOf(map, c.x, c.z)]) spawnEnemy('chest', c.x, c.z); else { const s = freeSpot(r, 2, 0.8); if (s) spawnEnemy('chest', s.x, s.z); } };
    rooms.forEach((r, i) => {
      if (i === 0) return;
      const n = Math.round(plan[i] * scale);
      const packType = pickType();
      for (let k = 0; k < n; k++) {
        const s = freeSpot(r, 1.5); if (!s) continue;
        spawnEnemy(R() < 0.5 ? packType : pickType(), s.x, s.z);
      }
      if (r.kind === 'normal' || r.kind === 'exit' || r.kind === 'chasm') {
        if (f >= 2 && R() < 0.18 + 0.02 * f) { const s = freeSpot(r, 2); if (s) spawnEnemy(R() < 0.4 ? 'brute' : R() < 0.5 && f >= 3 ? 'shield' : 'grunt', s.x, s.z, { elite: true }); }
        if (totems > 0 && r.kind === 'normal' && R() < 0.5) { const s = freeSpot(r, 2.5, 0.8); if (s) { spawnEnemy('totem', s.x, s.z); totems--; } }
      }
      if (r.kind === 'vault') {
        putChest(r);
        const s = freeSpot(r, 1.5, 0.8); if (s) spawnEnemy('chest', s.x, s.z);
        const g = freeSpot(r, 2); if (g) spawnEnemy(f >= 3 ? 'shield' : 'brute', g.x, g.z, { elite: true });
      }
      if (r.kind === 'traps' && R() < 0.7) { const s = freeSpot(r, 1, 0.8); if (s) spawnEnemy('chest', s.x, s.z); }
      // smashables
      for (let k = 0; k < props[i]; k++) {
        const s = freeSpot(r, 1, 0.5); if (!s) continue;
        let t = 'pot';
        if (r.kind === 'storage') t = k === 0 && f >= 2 ? 'xbarrel' : R.pick(['crate', 'crate', 'barrel', f >= 2 ? 'xbarrel' : 'barrel']);
        else if (r.kind === 'vault') t = R.pick(['pot', 'crate']);
        else t = R() < 0.45 ? 'pot' : R() < 0.5 ? 'crate' : (f >= 2 && R() < 0.5 ? 'xbarrel' : 'barrel');
        spawnEnemy(t, s.x, s.z);
      }
      if (chestRooms.has(i)) putChest(r);
      if (r.kind === 'arena') S.arenas.push({ room: i, st: 0, wave: 0, nW: f >= 8 ? 3 : 2, ids: [] });
    });
  }

  // ---------- flow field toward players ----------
  function updateFlow() {
    const map = S.map, W = map.W, H = map.H;
    if (!S.flow || S.flow.length !== W * H) S.flow = new Int16Array(W * H);
    const fl = S.flow; fl.fill(-1);
    const q = [];
    for (const p of alivePlayers()) { const k = tileOf(map, p.x, p.z); if (k >= 0 && k < W * H && fl[k] < 0) { fl[k] = 0; q.push(k); } }
    for (let h = 0; h < q.length; h++) {
      const k = q[h]; const d = fl[k];
      if (d > 40) continue;
      const x = k % W;
      if (x + 1 < W && map.g[k + 1] === T_FLOOR && fl[k + 1] < 0) { fl[k + 1] = d + 1; q.push(k + 1); }
      if (x - 1 >= 0 && map.g[k - 1] === T_FLOOR && fl[k - 1] < 0) { fl[k - 1] = d + 1; q.push(k - 1); }
      if (k + W < W * H && map.g[k + W] === T_FLOOR && fl[k + W] < 0) { fl[k + W] = d + 1; q.push(k + W); }
      if (k - W >= 0 && map.g[k - W] === T_FLOOR && fl[k - W] < 0) { fl[k - W] = d + 1; q.push(k - W); }
    }
  }
  function flowDir(e, tx, tz) {
    const map = S.map, W = map.W, fl = S.flow;
    const k = tileOf(map, e.x, e.z);
    const here = fl[k];
    const dx = tx - e.x, dz = tz - e.z, dd = Math.hypot(dx, dz) || 1;
    if (here < 0 || here <= 2 || e.r > 1.2) return [dx / dd, dz / dd];
    let best = here, bk = -1;
    const x = k % W;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [ox, oy] of nb) {
      if (x + ox < 0 || x + ox >= W) continue;
      const n = k + ox + oy * W;
      if (n < 0 || n >= fl.length || fl[n] < 0) continue;
      if (ox && oy && (map.g[k + ox] !== T_FLOOR || map.g[k + oy * W] !== T_FLOOR)) continue;
      if (fl[n] < best) { best = fl[n]; bk = n; }
    }
    if (bk < 0) return [dx / dd, dz / dd];
    const cx = ((bk % W) + 0.5) * TILE - e.x, cz = (Math.floor(bk / W) + 0.5) * TILE - e.z;
    const cd = Math.hypot(cx, cz) || 1;
    return [cx / cd, cz / cd];
  }

  // ---------- combat helpers ----------
  function nearestEnemy(x, z, maxD, includeProps) {
    let best = null, bd = maxD * maxD;
    for (const e of S.enemies) {
      if (e.hp <= 0 || (!includeProps && e.d.prop)) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function aimFor(p, range) {
    let t = nearestEnemy(p.x, p.z, range, false) || nearestEnemy(p.x, p.z, Math.min(range, 4), true);
    if (t) return Math.atan2(t.x - p.x, t.z - p.z);
    return p.f;
  }
  function playerDmg(p) {
    let d = itemDmg(p.wpn) * (1 + 0.06 * (p.lvl - 1));
    const critC = 0.08 + (p.wpn.e.includes('crit') ? 0.25 : 0);
    const crit = R() < critC;
    return { d: crit ? d * 2.2 : d, crit };
  }
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

  function dmgEnemy(e, amt, src, opt) {
    if (e.hp <= 0) return;
    opt = opt || {};
    // explosive barrel: any hit lights the fuse (short fuse when another blast hits it -> chain reactions)
    if (e.type === 'xbarrel') {
      if (!e.fuse) { e.fuse = opt.aoe ? 0.45 : 0.9; e.fuseSrc = src; ev('tele', r1(e.x), r1(e.z), 3.4, e.fuse); ev('sfx', 'fuse'); }
      return;
    }
    // shield-bearers block hits that come from the front (flank them, use area attacks, or stun them)
    if (e.type === 'shield' && !opt.aoe && opt.ang !== undefined && e.stun <= 0) {
      const da = wrapA(opt.ang + Math.PI - e.f);
      if (Math.abs(da) < 1.0) {
        amt *= 0.15; opt = Object.assign({}, opt, { kb: (opt.kb || 0) * 0.3, noEnch: true });
        if (!e.blockT || e.blockT <= 0) { ev('block', r1(e.x + Math.sin(e.f) * 0.7), r1(e.z + Math.cos(e.f) * 0.7)); e.blockT = 0.15; }
      }
    }
    amt = Math.max(1, Math.round(amt));
    e.hp -= amt; e.flash = 0.12;
    if (!e.d.prop) ev('dmg', r1(e.x), r1(e.z), amt, opt.crit ? 1 : 0);
    if (!e.awake) wake(e);
    if (opt.kb && e.type !== 'boss' && !e.d.prop && !e.d.still) {
      const k = opt.kb / (e.type === 'brute' || e.elite ? 2.5 : 1);
      e.kx += Math.sin(opt.ang) * k * 4; e.kz += Math.cos(opt.ang) * k * 4;
    }
    const p = S.players.get(src);
    const ench = opt.ench || (p && p.wpn ? p.wpn.e : []);
    if (!opt.noEnch && ench.length && !e.d.prop) {
      if (ench.includes('fire')) { e.burn = 3; e.burnDps = Math.max(e.burnDps, amt * 0.3); e.burnSrc = src; }
      if (ench.includes('ice')) e.slow = 2.5;
      if (ench.includes('leech') && p && !p.downed) p.hp = Math.min(p.maxHp, p.hp + Math.max(1, amt * 0.06));
      if (ench.includes('zap')) {
        let from = e; const hit = new Set([e]);
        for (let c = 0; c < 2; c++) {
          let nb = null, bd = 49;
          for (const o of S.enemies) if (!hit.has(o) && o.hp > 0 && !o.d.prop) { const d = (o.x - from.x) ** 2 + (o.z - from.z) ** 2; if (d < bd) { bd = d; nb = o; } }
          if (!nb) break;
          hit.add(nb); ev('zap', r1(from.x), r1(from.z), r1(nb.x), r1(nb.z));
          dmgEnemy(nb, amt * 0.5, src, { noEnch: true });
          from = nb;
        }
      }
      if (ench.includes('boom')) e.boomSrc = src;
    }
    if (e.hp <= 0) killEnemy(e, src, amt);
  }

  function hurtPlayer(p, amt) {
    if (p.downed || p.inv > 0 || p.hurtT > 0) return;
    amt = Math.round(amt * scaleDmg(S.floor));
    p.hp -= amt; p.hurtT = 0.25;
    ev('hurt', p.id, amt);
    if (p.hp <= 0) {
      p.hp = 0; p.downed = true; p.revive = 0;
      ev('down', p.id);
    }
  }

  function explode(x, z, r, dmgP, dmgE, src, color) {
    ev('boom', r1(x), r1(z), r, color || 0xff9a30);
    if (dmgP) for (const p of S.players.values()) if (Math.hypot(p.x - x, p.z - z) < r + 0.4) hurtPlayer(p, dmgP);
    if (dmgE) for (const e of S.enemies) if (e.hp > 0 && Math.hypot(e.x - x, e.z - z) < r + e.r) dmgEnemy(e, dmgE, src, { kb: 3, ang: Math.atan2(e.x - x, e.z - z), noEnch: true, aoe: true });
  }

  function killEnemy(e, src, lastHit) {
    e.hp = 0;
    ev('die', r1(e.x), r1(e.z), e.sk, e.size);
    if (e.boomSrc !== undefined) explode(e.x, e.z, 3.2, 0, Math.max(12, lastHit * 1.2), e.boomSrc, 0xff6a00);
    const f = S.floor;
    if (e.type === 'pot' || e.type === 'crate' || e.type === 'barrel') {
      const cc = e.type === 'pot' ? 0.6 : 0.8;
      for (const p of S.players.values()) if (R() < cc) dropLoot(p.id, 'coin', e.x, e.z, { v: R.int(1, e.type === 'pot' ? 3 : 4) * f });
      if (R() < (e.type === 'barrel' ? 0.45 : 0.3)) dropLoot(-1, 'heart', e.x, e.z);
      return;
    }
    if (e.type === 'xbarrel') {
      // the big boom: hurts enemies a lot, players a little (kid-friendly), lights other barrels
      explode(e.x, e.z, 3.4, 14, 45 * scaleHp(f) * 0.6, e.fuseSrc === undefined ? -1 : e.fuseSrc, 0xff4a10);
      ev('shake', 0.35);
      return;
    }
    if (e.type === 'chest') {
      ev('sfx', 'chest');
      for (const p of S.players.values()) {
        dropLoot(p.id, 'item', e.x, e.z, { item: makeItem(f, Math.max(1, rollRarity(0.12))) });
        for (let i = 0; i < 3; i++) dropLoot(p.id, 'coin', e.x, e.z, { v: R.int(2, 5) * f });
      }
      return;
    }
    // big slimes split into two small ones
    if (e.type === 'slime' && !e.small && S.enemies.length < 95) {
      for (let s = -1; s <= 1; s += 2) {
        const a = e.f + s * 1.57;
        const c = spawnEnemy('slime', e.x, e.z, { small: true });
        c.awake = true; c.kx = Math.sin(a) * 9; c.kz = Math.cos(a) * 9; c.cd = 0.8;
      }
    }
    // shared XP for everyone
    const xp = Math.round(e.d.xp * (1 + 0.25 * (f - 1)) * (e.elite ? 4 : 1) * (e.small ? 0.5 : 1));
    if (Sim.onGrant) for (const p of S.players.values()) Sim.onGrant(p.id, { xp });
    if (e.type === 'egg') return;
    const dropC = e.type === 'boss' ? 1 : e.elite ? 0.9 : e.type === 'brute' || e.type === 'caster' || e.type === 'totem' || e.type === 'mage' ? 0.3 : 0.09;
    for (const p of S.players.values()) {
      if (e.type === 'boss') {
        dropLoot(p.id, 'item', e.x, e.z, { item: makeItem(f, Math.max(2, rollRarity(0.25))) });
        dropLoot(p.id, 'item', e.x, e.z, { item: makeItem(f, Math.max(1, rollRarity(0.1))) });
        for (let i = 0; i < 6; i++) dropLoot(p.id, 'coin', e.x, e.z, { v: R.int(4, 9) * f });
      } else {
        if (R() < dropC) dropLoot(p.id, 'item', e.x, e.z, { item: makeItem(f, rollRarity(e.elite ? 0.2 : 0)) });
        if (R() < 0.3) dropLoot(p.id, 'coin', e.x, e.z, { v: R.int(1, 2) * f });
      }
    }
    if (R() < 0.05) dropLoot(-1, 'heart', e.x, e.z);
    if (e.type === 'boss') {
      S.boss = null; S.portalOpen = true;
      S.timers = []; S.hz = []; S.waves = [];
      ev('bossdead'); ev('msg', 'BOSS DEFEATED! Portal open!');
      // clear minions
      for (const o of S.enemies) if (o !== e && o.hp > 0 && !o.d.prop) { o.hp = 0; ev('die', r1(o.x), r1(o.z), o.sk, o.size); }
      for (const pr of S.projs) if (pr.team === 'e') pr.life = 0;
    }
  }

  function dropLoot(owner, kind, x, z, o) {
    const a = R() * 6.28, d = 0.6 + R() * 1.6;
    const l = { id: nid(), owner, kind, x: x + Math.sin(a) * d, z: z + Math.cos(a) * d, t: 0 };
    if (blockedCircle(S.map, l.x, l.z, 0.3)) { l.x = x; l.z = z; }
    if (o) Object.assign(l, o);
    S.loot.push(l);
  }

  function spawnProj(team, k, x, z, ang, speed, dmg, src, extra) {
    const pr = { id: nid(), team, k, x, z, vx: Math.sin(ang) * speed, vz: Math.cos(ang) * speed, dmg, src, life: 2.2, r: 0.45, pierce: 0, hit: null };
    if (extra) Object.assign(pr, extra);
    S.projs.push(pr);
    return pr;
  }
  // lobbed bomb: flies over everything, lands on a spot that is marked on the floor first
  function lobBomb(x, z, tx, tz, T, rad, dmg, color) {
    const d = Math.hypot(tx - x, tz - z);
    ev('tele', r1(tx), r1(tz), rad, T);
    return spawnProj('e', 'bomb', x, z, Math.atan2(tx - x, tz - z), d / T, 0, -1, { lob: true, life: T, tx, tz, boomR: rad, boomDmg: dmg, boomCol: color || 0xffa030 });
  }

  // ---------- player actions ----------
  function doAttack(p) {
    const W = WEAPONS[p.wpn.w];
    p.atkT = itemRate(p.wpn);
    p.atkAnim = 0.28;
    if (W.kind === 'melee') {
      const ang = aimFor(p, W.range + 2.5);
      p.aim = ang;
      ev('slash', p.id, r2(ang), W.range, W.arc, p.wpn.r);
      for (const e of S.enemies) {
        if (e.hp <= 0) continue;
        const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
        if (d > W.range + e.r) continue;
        let da = Math.atan2(dx, dz) - ang; da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) > W.arc / 2 && d > e.r + 0.6) continue;
        const { d: dm, crit } = playerDmg(p);
        dmgEnemy(e, dm, p.id, { crit, kb: W.kb, ang: Math.atan2(dx, dz) });
      }
    } else {
      const ang = aimFor(p, 18);
      p.aim = ang;
      const { d: dm, crit } = playerDmg(p);
      if (W.kind === 'ranged') { spawnProj('p', 'arrow', p.x, p.z, ang, W.speed, dm, p.id, { crit, pierce: p.wpn.r >= 2 ? 1 : 0, col: p.wpn.r }); ev('sfx', 'bow'); }
      else { spawnProj('p', 'orb', p.x, p.z, ang, W.speed, dm, p.id, { crit, splash: W.splash, col: p.wpn.r }); ev('sfx', 'magic'); }
    }
  }

  function doSpecial(p) {
    const W = WEAPONS[p.wpn.w];
    p.scdT = W.scd * 0.95;
    const { d: base } = playerDmg(p);
    ev('special', p.id, W.special);
    if (W.special === 'spin') {
      ev('ring', r1(p.x), r1(p.z), 4, 0xffffff);
      for (const e of S.enemies) if (e.hp > 0 && Math.hypot(e.x - p.x, e.z - p.z) < 4 + e.r) dmgEnemy(e, base * 2.2, p.id, { kb: 6, ang: Math.atan2(e.x - p.x, e.z - p.z), aoe: true });
    } else if (W.special === 'slam') {
      ev('ring', r1(p.x), r1(p.z), 6, 0xffcc66);
      for (const e of S.enemies) if (e.hp > 0 && Math.hypot(e.x - p.x, e.z - p.z) < 6 + e.r) { dmgEnemy(e, base * 2.4, p.id, { kb: 8, ang: Math.atan2(e.x - p.x, e.z - p.z), aoe: true }); e.stun = 1.6; }
    } else if (W.special === 'dash') {
      // the owning device moves the player; we damage along the dash line
      const ang = p.f;
      const L = 8;
      ev('dashfx', r1(p.x), r1(p.z), r2(ang));
      for (const e of S.enemies) {
        if (e.hp <= 0) continue;
        const dx = e.x - p.x, dz = e.z - p.z;
        const along = dx * Math.sin(ang) + dz * Math.cos(ang);
        const perp = Math.abs(dx * Math.cos(ang) - dz * Math.sin(ang));
        if (along > -1 && along < L + 1 && perp < 1.6 + e.r) dmgEnemy(e, base * 3.5, p.id, { kb: 2, ang });
      }
    } else if (W.special === 'volley') {
      const ang = aimFor(p, 18);
      for (let i = -4; i <= 4; i++) spawnProj('p', 'arrow', p.x, p.z, ang + i * 0.14, W.speed, base * 1.1, p.id, { pierce: 2, col: p.wpn.r });
      ev('sfx', 'bow');
    } else if (W.special === 'nova') {
      const t = nearestEnemy(p.x, p.z, 16, false);
      const x = t ? t.x : p.x + Math.sin(p.f) * 6, z = t ? t.z : p.z + Math.cos(p.f) * 6;
      explode(x, z, 5, 0, base * 3.2, p.id, 0xff5a1a);
      for (const e of S.enemies) if (e.hp > 0 && !e.d.prop && Math.hypot(e.x - x, e.z - z) < 5) { e.burn = 3; e.burnDps = base * 0.5; e.burnSrc = p.id; }
    }
  }

  // ---------- enemy AI ----------
  function wake(e) {
    if (e.awake || e.d.prop) return;
    e.awake = true;
    for (const o of S.enemies) if (!o.awake && !o.d.prop && o.type !== 'boss' && Math.hypot(o.x - e.x, o.z - e.z) < 9) o.awake = true;
  }

  function nearestPlayer(e) {
    let best = null, bd = 1e9;
    for (const p of S.players.values()) {
      if (p.downed) continue;
      const d = (p.x - e.x) ** 2 + (p.z - e.z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best ? [best, Math.sqrt(bd)] : [null, 1e9];
  }

  function moveEnemy(e, dirx, dirz, spd, dt) {
    const m = spd * dt * (e.slow > 0 ? 0.5 : 1);
    moveCircle(S.map, e, dirx * m, dirz * m, e.r * 0.9);
    if (dirx || dirz) e.f = Math.atan2(dirx, dirz);
  }
  function clearLine(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.8);
    for (let i = 1; i < n; i++) { const t = i / n; if (isWallAt(S.map, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false; }
    return true;
  }
  function countAlive(type) { let n = 0; for (const o of S.enemies) if (o.hp > 0 && (!type ? !o.d.prop : o.type === type)) n++; return n; }

  function updateEnemy(e, dt) {
    if (e.flash > 0) e.flash -= dt;
    if (e.fuse) { // explosive barrel fuse: blink, then boom
      e.fuse -= dt; e.blink = (e.blink || 0) - dt;
      if (e.blink <= 0) { e.blink = 0.14; e.flash = 0.07; }
      if (e.fuse <= 0) { e.fuse = 0; killEnemy(e, e.fuseSrc, 0); }
      return;
    }
    if (e.d.prop) return;
    if (e.blockT > 0) e.blockT -= dt;
    if (e.trapT > 0) e.trapT -= dt;
    // status
    if (e.burn > 0) {
      e.burn -= dt; e.burnTick = (e.burnTick || 0) - dt;
      if (e.burnTick <= 0) { e.burnTick = 0.5; dmgEnemy(e, e.burnDps * 0.5, e.burnSrc, { noEnch: true }); if (e.hp <= 0) return; }
    }
    if (e.slow > 0) e.slow -= dt;
    if (e.kx || e.kz) {
      moveCircle(S.map, e, e.kx * dt, e.kz * dt, e.r * 0.9);
      e.kx *= Math.pow(0.002, dt); e.kz *= Math.pow(0.002, dt);
      if (Math.abs(e.kx) + Math.abs(e.kz) < 0.2) e.kx = e.kz = 0;
    }
    if (e.type === 'egg') { // hatches into spiders unless smashed in time
      e.hatch -= dt;
      if (e.hatch < 1.2) e.flash = Math.sin(e.hatch * 25) > 0 ? 0.05 : 0;
      if (e.hatch <= 0) {
        e.hp = 0; ev('die', r1(e.x), r1(e.z), e.sk, e.size); ev('ring', r1(e.x), r1(e.z), 2, 0xff4a8a);
        for (let i = 0; i < 2; i++) { const s = spawnEnemy('runner', e.x + R.range(-0.8, 0.8), e.z + R.range(-0.8, 0.8)); s.awake = true; if (blockedCircle(S.map, s.x, s.z, s.r)) { s.x = e.x; s.z = e.z; } }
      }
      return;
    }
    if (e.stun > 0) { e.stun -= dt; e.st = e.st === 'wind' ? 'chase' : e.st; return; }
    const [tp, dist] = nearestPlayer(e);
    if (!e.awake) { if (tp && dist < 13) wake(e); else return; }
    if (!tp) { e.st = 'idle'; return; }
    if (e.type === 'boss') return updateBoss(e, tp, dist, dt);
    const d = e.d;
    e.cd -= dt;
    const ang = Math.atan2(tp.x - e.x, tp.z - e.z);
    const spd = d.spd * (1 + 0.03 * Math.min(S.floor, 15));

    if (e.type === 'totem') { // spawner: keeps calling helpers until smashed
      e.f = ang;
      e.summonT -= dt;
      if (e.summonT <= 0 && dist < 16) {
        e.summonT = 6.5;
        const mine = S.enemies.filter(o => o.hp > 0 && o.parent === e.id).length;
        if (mine < 3 && S.enemies.length < 95) {
          ev('ring', r1(e.x), r1(e.z), 2.6, S.theme.accent);
          const a = R() * 6.28;
          const s = spawnEnemy(R() < 0.6 ? 'runner' : 'grunt', e.x + Math.sin(a) * 1.6, e.z + Math.cos(a) * 1.6);
          s.awake = true; s.parent = e.id; if (blockedCircle(S.map, s.x, s.z, s.r)) { s.x = e.x; s.z = e.z + 1.2; }
        }
      }
      return;
    }

    if (e.type === 'charger') { // aims (red line), then dashes; bonks into walls and gets dizzy
      if (e.st === 'wind') {
        e.t -= dt; e.f = e.cang;
        if (e.t <= 0) { e.st = 'dash'; e.t = 0.6; e.hitP = new Set(); }
        return;
      }
      if (e.st === 'dash') {
        e.t -= dt;
        const hit = moveCircle(S.map, e, Math.sin(e.cang) * 19 * dt, Math.cos(e.cang) * 19 * dt, e.r * 0.9);
        for (const p of S.players.values()) if (!e.hitP.has(p.id) && Math.hypot(p.x - e.x, p.z - e.z) < e.r + 0.7) { e.hitP.add(p.id); hurtPlayer(p, d.dmg * (e.elite ? 1.5 : 1)); }
        if (hit || e.t <= 0) {
          e.st = 'chase'; e.cd = d.cd * (0.8 + R() * 0.4);
          if (hit) { e.stun = 1.3; ev('ring', r1(e.x), r1(e.z), 1.4, 0xffffff); ev('sfx', 'hit'); }
        }
        return;
      }
      if (dist > 7.5 || !clearLine(e.x, e.z, tp.x, tp.z)) { const [fx, fz] = flowDir(e, tp.x, tp.z); moveEnemy(e, fx, fz, spd, dt); }
      else e.f = ang;
      if (dist < d.range && e.cd <= 0 && clearLine(e.x, e.z, tp.x, tp.z)) {
        e.st = 'wind'; e.t = d.wind; e.cang = ang; e.f = ang;
        ev('teleline', r1(e.x), r1(e.z), r2(ang), Math.min(12, dist + 3), d.wind);
      }
      return;
    }

    if (e.type === 'mage') { // blinks around the player, then casts a fan of orbs
      e.blinkT -= dt;
      if (e.st !== 'wind' && (e.blinkT <= 0 || (dist < 3.5 && e.blinkT < 2))) {
        e.blinkT = 4.5 + R() * 2;
        for (let t = 0; t < 14; t++) {
          const a = R() * 6.28, rr = 6 + R() * 3;
          const nx = tp.x + Math.sin(a) * rr, nz = tp.z + Math.cos(a) * rr;
          if (blockedCircle(S.map, nx, nz, 0.6) || !clearLine(nx, nz, tp.x, tp.z)) continue;
          ev('ring', r1(e.x), r1(e.z), 1.6, 0xc06aff);
          e.x = nx; e.z = nz; e.kx = e.kz = 0;
          ev('ring', r1(e.x), r1(e.z), 1.6, 0xc06aff); ev('sfx', 'magic');
          e.cd = Math.max(e.cd, 0.7);
          break;
        }
      }
    }

    if (e.st === 'wind') {
      e.t -= dt;
      if (e.type === 'boomer') moveEnemy(e, Math.sin(ang), Math.cos(ang), spd * 0.35, dt);
      if (e.t <= 0) {
        e.st = 'chase';
        e.cd = d.cd * (0.8 + R() * 0.4);
        const dm = d.dmg * (e.elite ? 1.6 : 1);
        if (e.type === 'boomer') {
          e.hp = 0; ev('die', r1(e.x), r1(e.z), e.sk, e.size);
          explode(e.x, e.z, 3.4, dm, dm * 2, -1, 0x9cff3a);
          return;
        }
        if (e.type === 'bomber') { lobBomb(e.x, e.z, e.tx, e.tz, 1.1, 2.3, dm, 0xffa030); return; }
        if (e.type === 'mage') {
          const n = e.elite ? 5 : 3;
          for (let i = 0; i < n; i++) spawnProj('e', 'eorb', e.x, e.z, ang + (i - (n - 1) / 2) * 0.28, 10, dm, -1, { r: 0.5 });
          return;
        }
        if (d.ranged) {
          if (e.type === 'caster') spawnProj('e', 'eorb', e.x, e.z, ang, 11, dm, -1, { r: 0.55 });
          else spawnProj('e', 'earrow', e.x, e.z, ang, 15, dm, -1);
        } else if (e.type === 'brute') {
          const fx = e.x + Math.sin(e.f) * 1.6, fz = e.z + Math.cos(e.f) * 1.6;
          ev('ring', r1(fx), r1(fz), 2.8, 0xff5030);
          for (const p of S.players.values()) if (Math.hypot(p.x - fx, p.z - fz) < 2.8) hurtPlayer(p, dm);
        } else {
          for (const p of S.players.values()) {
            const dd = Math.hypot(p.x - e.x, p.z - e.z);
            if (dd < d.range * 1.35 + 0.3) hurtPlayer(p, dm);
          }
        }
      }
      return;
    }

    if (e.type === 'caster') {
      e.summonT -= dt;
      if (e.summonT <= 0 && S.enemies.length < 90) {
        e.summonT = 7;
        ev('ring', r1(e.x), r1(e.z), 2.5, 0xb050ff);
        for (let i = 0; i < 2; i++) { const s = spawnEnemy('grunt', e.x + R.range(-1.5, 1.5), e.z + R.range(-1.5, 1.5)); s.awake = true; if (blockedCircle(S.map, s.x, s.z, s.r)) { s.x = e.x; s.z = e.z; } }
      }
    }

    if (d.ranged) {
      const want = e.type === 'caster' ? 8 : e.type === 'bomber' ? 8 : 9;
      if (dist > d.range) { const [fx, fz] = flowDir(e, tp.x, tp.z); moveEnemy(e, fx, fz, spd, dt); }
      else if (dist < want - 3) moveEnemy(e, -Math.sin(ang), -Math.cos(ang), spd * 0.8, dt);
      else e.f = ang;
      if (dist <= d.range && e.cd <= 0) {
        e.st = 'wind'; e.t = d.wind; e.f = ang;
        if (e.type === 'caster' || e.type === 'mage') ev('sfx', 'magic');
        if (e.type === 'bomber') { e.tx = tp.x; e.tz = tp.z; }
      }
    } else {
      const prevF = e.f;
      let mspd = spd;
      if (e.type === 'slime') { e.hop = (e.hop || R() * 6) + dt * 5.5; mspd = spd * (Math.sin(e.hop) > 0 ? 1.7 : 0.15); }
      if (dist > d.range * 0.85) { const [fx, fz] = flowDir(e, tp.x, tp.z); moveEnemy(e, fx, fz, mspd, dt); }
      else e.f = ang;
      if (e.type === 'shield') { // turns slowly so you can run around it
        const want = e.f, da = wrapA(want - prevF);
        e.f = prevF + Math.max(-2.4 * dt, Math.min(2.4 * dt, da));
      }
      if (dist <= d.range && e.cd <= 0) {
        e.st = 'wind'; e.t = d.wind * (e.elite ? 0.85 : 1); e.f = e.type === 'shield' ? e.f : ang;
        if (e.type === 'boomer') ev('sfx', 'fuse');
        if (e.type === 'brute') { const fx = e.x + Math.sin(e.f) * 1.6, fz = e.z + Math.cos(e.f) * 1.6; ev('tele', r1(fx), r1(fz), 2.8, d.wind); }
      }
    }
  }

  // ---------- boss ----------
  // telegraphed circle somewhere near a player
  function nearPlayerSpot(spread) {
    const ps = alivePlayers(); if (!ps.length) return null;
    const p = R.pick(ps);
    for (let t = 0; t < 10; t++) {
      const x = p.x + R.range(-spread, spread), z = p.z + R.range(-spread, spread);
      if (!isWallAt(S.map, x, z)) return { x, z };
    }
    return { x: p.x, z: p.z };
  }
  function strike(x, z, r, delay, dmg, color) { // telegraphed area hit
    ev('tele', r1(x), r1(z), r, delay);
    later(delay, () => explode(x, z, r, dmg, 0, -1, color));
  }
  function updateBoss(e, tp, dist, dt) {
    if (e.phase === 1 && e.hp < e.maxHp * 0.5) {
      e.phase = 2; ev('msg', e.name + ' is ENRAGED!'); ev('sfx', 'roar'); ev('shake', 0.5);
      ev('ring', r1(e.x), r1(e.z), 6, S.theme.boss.accent);
      e.st = 'idle'; e.t = 0.6;
    }
    const P2 = e.phase === 2;
    const fast = P2 ? 0.7 : 1;
    const ang = Math.atan2(tp.x - e.x, tp.z - e.z);
    const dmg = ENEMIES.boss.dmg;
    const B = S.theme.boss;
    e.t -= dt;
    switch (e.st) {
      case 'idle': {
        if (dist > 4) moveEnemy(e, Math.sin(ang), Math.cos(ang), ENEMIES.boss.spd * (P2 ? 1.3 : 1), dt);
        else e.f = ang;
        if (e.t <= 0) {
          const sig = B.sig || [];
          const opts = ['slam', 'spray', 'charge', 'stomp'].concat(sig, sig);
          if (countAlive() < 7) opts.push('summon');
          let pick = R.pick(opts);
          if (pick === e.lastPick && R() < 0.6) pick = R.pick(opts);
          if (dist < 5 && R() < 0.4) pick = B.kind === 'captain' ? 'anchor' : 'stomp';
          if (pick === 'eggs' && countAlive('egg') >= 4) pick = 'leap';
          e.lastPick = pick;
          e.st = pick; e.f = ang;
          switch (pick) {
            case 'slam': e.tx = tp.x; e.tz = tp.z; e.t = 1.1 * fast; e.cnt = P2 ? 3 : 1; ev('tele', r1(e.tx), r1(e.tz), 4.2, e.t); break;
            case 'stomp': e.t = 1.2 * fast; ev('tele', r1(e.x), r1(e.z), 7, e.t); break;
            case 'charge': e.t = 0.9 * fast; e.cang = ang; ev('teleline', r1(e.x), r1(e.z), r2(ang), 22, e.t); break;
            case 'spray': e.t = 0.6; e.cnt = P2 ? 3 : 2; break;
            case 'summon': case 'raise': e.t = 0.9; ev('ring', r1(e.x), r1(e.z), 5, 0xb050ff); ev('sfx', 'roar');
              if (pick === 'raise') { e.spots = []; const n = 2 + S.players.size + (P2 ? 1 : 0); for (let i = 0; i < n; i++) { const s = nearPlayerSpot(5); if (s && !blockedCircle(S.map, s.x, s.z, 0.6)) { e.spots.push(s); ev('tele', r1(s.x), r1(s.z), 1.3, e.t); } } }
              break;
            case 'spiral': e.t = 0.8; e.sa = R() * 6.28; e.dur = 2.2; e.tick = 0; ev('tele', r1(e.x), r1(e.z), 3.2, 0.8); ev('sfx', 'magic'); break;
            case 'bonewall': {
              e.t = 1.0; e.cnt = P2 ? 2 : 1; e.cang = ang;
              e.gap = R.range(-4, 4); ev('lanes', r1(e.x), r1(e.z), r2(ang), 9, 24, r1(e.gap), 3.2, e.t);
              break;
            }
            case 'eggs': {
              e.t = 0.7; ev('ring', r1(e.x), r1(e.z), 4, 0xff4a8a); ev('sfx', 'roar');
              const n = P2 ? 3 : 2;
              for (let i = 0; i < n; i++) { const a = R() * 6.28; const x = e.x + Math.sin(a) * 4, z = e.z + Math.cos(a) * 4; if (!blockedCircle(S.map, x, z, 0.6)) spawnEnemy('egg', x, z); }
              break;
            }
            case 'leap': case 'bounce': e.tx = tp.x; e.tz = tp.z; e.t = (pick === 'bounce' ? 0.8 : 1.0) * fast; e.cnt = pick === 'bounce' ? (P2 ? 3 : 2) : 1; ev('tele', r1(e.tx), r1(e.tz), 3.6, e.t); break;
            case 'meteors': {
              e.t = 2.2; ev('sfx', 'roar');
              const n = P2 ? 10 : 6;
              for (let i = 0; i < n; i++) later(i * 0.18, () => { const s = i < alivePlayers().length ? alivePlayers()[i] : nearPlayerSpot(8); if (s) strike(s.x, s.z, 2.6, 1.2, dmg * 0.6, 0xff5a00); });
              break;
            }
            case 'avalanche': {
              e.t = 2.2; ev('shake', 0.4);
              const n = P2 ? 10 : 7;
              for (let i = 0; i < n; i++) later(i * 0.16, () => { const s = nearPlayerSpot(7); if (s) strike(s.x, s.z, 2.4, 1.2, dmg * 0.55, 0x9ff0ff); });
              break;
            }
            case 'cannons': {
              e.t = 2.2; ev('sfx', 'boom');
              const n = P2 ? 10 : 6;
              for (let i = 0; i < n; i++) later(i * 0.2, () => { const s = nearPlayerSpot(6); if (s && e.hp > 0) lobBomb(e.x, e.z, s.x, s.z, 1.3, 2.4, dmg * 0.6, 0xff8a30); });
              break;
            }
            case 'shock': e.t = 0.9 * fast; e.cnt = P2 ? 2 : 1; ev('tele', r1(e.x), r1(e.z), 3, e.t); ev('sfx', 'roar'); break;
            case 'icicles': {
              e.t = 1.0; const n = P2 ? 5 : 3; e.lines = [];
              for (let i = 0; i < n; i++) { const a = ang + (i - (n - 1) / 2) * (P2 ? 0.5 : 0.65); e.lines.push(a); ev('teleline', r1(e.x), r1(e.z), r2(a), 20, e.t); }
              break;
            }
            case 'lightning': {
              e.t = 1.1; e.lines = [];
              const ps = alivePlayers(); const n = P2 ? 5 : 3;
              for (let i = 0; i < n; i++) {
                const p = ps[i % ps.length]; const a = R() * 3.14;
                const off = i < ps.length ? 0 : R.range(-5, 5);
                const cx = p.x + Math.cos(a) * off, cz = p.z - Math.sin(a) * off;
                const x0 = cx - Math.sin(a) * 13, z0 = cz - Math.cos(a) * 13;
                e.lines.push([x0, z0, a]); ev('teleline', r1(x0), r1(z0), r2(a), 26, e.t);
              }
              ev('sfx', 'zap');
              break;
            }
            case 'breath': e.t = 0.8; e.cang = ang; e.dur = P2 ? 1.8 : 1.5; e.tick = 0; ev('teleline', r1(e.x), r1(e.z), r2(ang - 0.9), 12, 0.8); ev('teleline', r1(e.x), r1(e.z), r2(ang + 0.9), 12, 0.8); ev('sfx', 'roar'); break;
            case 'spores': {
              e.t = 1.6; const n = P2 ? 6 : 4;
              for (let i = 0; i < n; i++) { const s = i < alivePlayers().length ? alivePlayers()[i] : nearPlayerSpot(7); if (!s) continue; const x = s.x + R.range(-1, 1), z = s.z + R.range(-1, 1); ev('tele', r1(x), r1(z), 2.8, 1.0); later(1.0, () => { S.hz.push({ x, z, r: 2.8, t: 5, tick: 0.3, dmg: dmg * 0.22 }); ev('cloud', r1(x), r1(z), 2.8, 5, 0x9a5aff); }); }
              ev('sfx', 'magic');
              break;
            }
            case 'anchor': e.t = 0.9 * fast; e.cnt = P2 ? 2 : 1; ev('tele', r1(e.x), r1(e.z), 5.5, e.t); break;
          }
        }
        break;
      }
      case 'slam':
        if (e.t <= 0) {
          explode(e.tx, e.tz, 4.2, dmg, 0, -1, 0xff4020);
          ev('shake', 0.4);
          e.cnt--;
          if (e.cnt > 0) { e.tx = tp.x; e.tz = tp.z; e.t = 0.75; ev('tele', r1(e.tx), r1(e.tz), 4.2, e.t); }
          else { e.st = 'idle'; e.t = 1.2 * fast; }
        }
        break;
      case 'stomp':
        if (e.t <= 0) { explode(e.x, e.z, 7, dmg * 0.9, 0, -1, 0xffaa30); ev('shake', 0.5); e.st = 'idle'; e.t = 1.3 * fast; }
        break;
      case 'charge':
        if (e.t <= 0 && !e.charging) { e.charging = 0.7; }
        if (e.charging) {
          e.charging -= dt;
          const hit = moveCircle(S.map, e, Math.sin(e.cang) * 28 * dt, Math.cos(e.cang) * 28 * dt, e.r * 0.9);
          e.f = e.cang;
          for (const p of S.players.values()) if (Math.hypot(p.x - e.x, p.z - e.z) < e.r + 0.8) hurtPlayer(p, dmg * 0.8);
          for (const o of S.enemies) if (o.type === 'xbarrel' && o.hp > 0 && Math.hypot(o.x - e.x, o.z - e.z) < e.r + 0.6) dmgEnemy(o, 1, -1, { aoe: true });
          if (hit || e.charging <= 0) { e.charging = 0; e.st = 'idle'; e.t = (hit ? 1.6 : 1.1) * fast; if (hit) { ev('shake', 0.3); ev('boom', r1(e.x), r1(e.z), 2.5, 0xaaaaaa); } }
        }
        break;
      case 'spray':
        if (e.t <= 0) {
          const n = P2 ? 20 : 14;
          const off = R() * 6.28;
          const D = S.theme.deco;
          const kind = D === 'lava' ? 'fire' : D === 'crypt' || D === 'pirate' ? 'bone' : D === 'ice' ? 'shard' : D === 'mushroom' ? 'spore' : D === 'desert' ? 'sand' : D === 'jungle' ? 'web' : 'eorb';
          for (let i = 0; i < n; i++) spawnProj('e', kind, e.x, e.z, off + (i / n) * 6.28, 9, dmg * 0.5, -1, { r: 0.55, life: 3 });
          ev('sfx', 'magic');
          e.cnt--;
          if (e.cnt > 0) e.t = 0.55; else { e.st = 'idle'; e.t = 1.1 * fast; }
        }
        break;
      case 'summon': case 'raise':
        if (e.t <= 0) {
          if (e.st === 'raise') {
            for (const s of e.spots || []) { const m = spawnEnemy('grunt', s.x, s.z); m.awake = true; ev('ring', r1(s.x), r1(s.z), 1.5, 0xb050ff); }
          } else {
            const n = 3 + S.players.size;
            for (let i = 0; i < n; i++) {
              const a = (i / n) * 6.28;
              const s = spawnEnemy(R() < 0.6 ? 'grunt' : 'runner', e.x + Math.sin(a) * 4, e.z + Math.cos(a) * 4);
              s.awake = true;
              if (blockedCircle(S.map, s.x, s.z, s.r)) { s.x = e.x; s.z = e.z + 3; }
            }
          }
          e.st = 'idle'; e.t = 1.5 * fast;
        }
        break;
      case 'spiral': // Pharaoh: rotating arms of sand balls — walk around the gaps
        if (e.t <= 0) {
          e.dur -= dt; e.tick -= dt; e.f += dt * 4;
          if (e.tick <= 0) {
            e.tick = 0.15;
            const arms = P2 ? 4 : 3;
            for (let a = 0; a < arms; a++) spawnProj('e', 'sand', e.x, e.z, e.sa + a * 6.28 / arms, 8, dmg * 0.4, -1, { r: 0.5, life: 3.2 });
            e.sa += 0.27;
          }
          if (e.dur <= 0) { e.st = 'idle'; e.t = 1.0 * fast; }
        }
        break;
      case 'bonewall': // Skeleton King: a wall of bones with one gap — find the green gap!
        if (e.t <= 0) {
          const sa = Math.sin(e.cang), ca = Math.cos(e.cang);
          for (let s = -9; s <= 9; s += 1.2) {
            if (Math.abs(s - e.gap) < 1.7) continue;
            spawnProj('e', 'bone', e.x + ca * s, e.z - sa * s, e.cang, 8.5, dmg * 0.5, -1, { r: 0.6, life: 3.2, ghost: true });
          }
          ev('sfx', 'magic');
          e.cnt--;
          if (e.cnt > 0) { e.t = 1.0; e.cang = ang; e.gap = R.range(-4, 4); ev('lanes', r1(e.x), r1(e.z), r2(e.cang), 9, 24, r1(e.gap), 3.2, e.t); }
          else { e.st = 'idle'; e.t = 1.3 * fast; }
        }
        break;
      case 'eggs':
        if (e.t <= 0) { e.st = 'idle'; e.t = 1.0 * fast; }
        break;
      case 'leap': case 'bounce':
        if (e.t <= 0) {
          if (!e.jumping) { e.jumping = 0.4; }
          e.jumping -= dt;
          const dx = e.tx - e.x, dz = e.tz - e.z, dd = Math.hypot(dx, dz);
          if (dd > 0.3) moveCircle(S.map, e, dx / dd * Math.min(dd, 40 * dt), dz / dd * Math.min(dd, 40 * dt), e.r * 0.9);
          if (e.jumping <= 0 || dd < 0.5) {
            e.jumping = 0;
            explode(e.x, e.z, 3.6, dmg * 0.75, 0, -1, S.theme.boss.accent); ev('shake', 0.45);
            if (e.st === 'bounce') { S.hz.push({ x: e.x, z: e.z, r: 2.4, t: 3.5, tick: 0.3, dmg: dmg * 0.2 }); ev('cloud', r1(e.x), r1(e.z), 2.4, 3.5, 0x9a5aff); }
            e.cnt--;
            if (e.cnt > 0) { e.tx = tp.x; e.tz = tp.z; e.t = 0.75 * fast; ev('tele', r1(e.tx), r1(e.tz), 3.6, e.t); }
            else { e.st = 'idle'; e.t = 1.3 * fast; }
          }
        }
        break;
      case 'meteors': case 'avalanche': case 'cannons':
        if (e.t <= 0) { e.st = 'idle'; e.t = 1.0 * fast; }
        break;
      case 'shock': // expanding ring: dodge-roll through it!
        if (e.t <= 0) {
          S.waves.push({ x: e.x, z: e.z, r: 1.5, max: 20, spd: 8, dmg: dmg * 0.6, hit: new Set() });
          ev('shock', r1(e.x), r1(e.z), 20, 8, 0xff6a00); ev('shake', 0.4); ev('sfx', 'boom');
          e.cnt--;
          if (e.cnt > 0) e.t = 0.9; else { e.st = 'idle'; e.t = 1.5 * fast; }
        }
        break;
      case 'icicles':
        if (e.t <= 0) {
          for (const a of e.lines) {
            ev('spikeline', r1(e.x), r1(e.z), r2(a), 20, 0xbff6ff);
            for (const p of S.players.values()) {
              const dx = p.x - e.x, dz = p.z - e.z;
              const al = dx * Math.sin(a) + dz * Math.cos(a), pe = Math.abs(dx * Math.cos(a) - dz * Math.sin(a));
              if (al > 0 && al < 20 && pe < 1.7) hurtPlayer(p, dmg * 0.6);
            }
          }
          ev('shake', 0.35); ev('sfx', 'boom');
          e.st = 'idle'; e.t = 1.3 * fast;
        }
        break;
      case 'lightning':
        if (e.t <= 0) {
          for (const [x0, z0, a] of e.lines) {
            const x1 = x0 + Math.sin(a) * 26, z1 = z0 + Math.cos(a) * 26;
            ev('bolt', r1(x0), r1(z0), r1(x1), r1(z1));
            for (const p of S.players.values()) {
              const dx = p.x - x0, dz = p.z - z0;
              const al = dx * Math.sin(a) + dz * Math.cos(a), pe = Math.abs(dx * Math.cos(a) - dz * Math.sin(a));
              if (al > 0 && al < 26 && pe < 1.7) hurtPlayer(p, dmg * 0.6);
            }
          }
          ev('shake', 0.3);
          e.st = 'idle'; e.t = 1.2 * fast;
        }
        break;
      case 'breath': // Dragon: a sweeping cone of fire
        if (e.t <= 0) {
          e.dur -= dt; e.tick -= dt;
          const total = P2 ? 1.8 : 1.5, k = 1 - Math.max(0, e.dur) / total;
          const a = e.cang - 0.9 + 1.8 * k;
          e.f = a;
          if (e.tick <= 0) { e.tick = 0.07; spawnProj('e', 'fire', e.x + Math.sin(a) * 1.5, e.z + Math.cos(a) * 1.5, a, 13, dmg * 0.35, -1, { r: 0.55, life: 1.1 }); }
          if (e.dur <= 0) { e.st = 'idle'; e.t = 1.2 * fast; }
        }
        break;
      case 'spores':
        if (e.t <= 0) { e.st = 'idle'; e.t = 0.8 * fast; }
        break;
      case 'anchor': // Captain: spinning anchor sweep around him
        if (e.t <= 0) {
          ev('ring', r1(e.x), r1(e.z), 5.5, 0xc0c0c0); ev('ring', r1(e.x), r1(e.z), 4, 0xffffff); ev('sfx', 'swing'); ev('shake', 0.3);
          for (const p of S.players.values()) if (Math.hypot(p.x - e.x, p.z - e.z) < 5.5 + 0.4) hurtPlayer(p, dmg * 0.75);
          for (const o of S.enemies) if (o.type === 'xbarrel' && o.hp > 0 && Math.hypot(o.x - e.x, o.z - e.z) < 5.5) dmgEnemy(o, 1, -1, { aoe: true });
          e.f += 3.14;
          e.cnt--;
          if (e.cnt > 0) { e.t = 0.8; ev('tele', r1(e.x), r1(e.z), 5.5, 0.8); }
          else { e.st = 'idle'; e.t = 1.2 * fast; }
        }
        break;
      default: e.st = 'idle'; e.t = 1;
    }
  }

  // ---------- traps, shrines, hazards, arenas (host) ----------
  function updateWorld(dt) {
    const map = S.map, now = levelTime();
    // timers
    if (S.timers.length) {
      const due = [];
      for (const t of S.timers) { t.t -= dt; if (t.t <= 0) due.push(t); }
      if (due.length) { S.timers = S.timers.filter(t => t.t > 0); for (const t of due) t.fn(); }
    }
    // traps hurt players and enemies standing on them
    for (const p of S.players.values()) {
      if (p.downed) continue;
      p.trapT = (p.trapT || 0) - dt;
      const k = tileOf(map, p.x, p.z), tt = map.tt[k];
      if (tt === TT_SPIKE && spikeState(map.tq[k], now) === 2 && p.trapT <= 0) { hurtPlayer(p, 9); p.trapT = 0.9; }
      else if (tt === TT_VENT && ventState(map.tq[k], now) === 2 && p.trapT <= 0) { hurtPlayer(p, 10); p.trapT = 0.8; }
      else if (tt === TT_SHRINE) {
        p.healT = (p.healT || 0) - dt;
        if (p.healT <= 0 && p.hp < p.maxHp) { p.healT = 0.5; p.hp = Math.min(p.maxHp, p.hp + Math.max(3, p.maxHp * 0.04)); ev('ring', r1(p.x), r1(p.z), 1.2, 0x7dffb0); }
      }
    }
    // pressure plates: arrows shoot out of the wall after a short warning line
    map.plates.forEach((pl, n) => {
      if (S.plateCd[n] > 0) { S.plateCd[n] -= dt; return; }
      let on = false;
      for (const p of S.players.values()) if (!p.downed && tileOf(map, p.x, p.z) === pl.k) on = true;
      if (!on) return;
      S.plateCd[n] = 3.5;
      const sx = (pl.li + 0.5) * TILE + pl.dx * 1.05, sz = (pl.lj + 0.5) * TILE + pl.dz * 1.05;
      const a = Math.atan2(pl.dx, pl.dz);
      const len = Math.abs(pl.li - pl.i) * TILE + Math.abs(pl.lj - pl.j) * TILE + 6;
      ev('teleline', r1(sx), r1(sz), r2(a), len, 0.55); ev('sfx', 'hit');
      for (let s = 0; s < 3; s++) later(0.55 + s * 0.13, () => { spawnProj('e', 'earrow', sx, sz, a, 17, 8, -1, { life: len / 17 + 0.2 }); ev('sfx', 'bow'); });
    });
    // enemies on traps (lure them!)
    for (const e of S.enemies) {
      if (e.hp <= 0 || e.d.prop || e.d.still || e.type === 'boss' || e.trapT > 0) continue;
      const k = tileOf(map, e.x, e.z), tt = map.tt[k];
      if ((tt === TT_SPIKE && spikeState(map.tq[k], now) === 2) || (tt === TT_VENT && ventState(map.tq[k], now) === 2)) {
        e.trapT = 1; dmgEnemy(e, Math.max(8, e.maxHp * 0.25), -1, { noEnch: true, aoe: true });
      }
    }
    // lingering clouds
    if (S.hz.length) {
      for (const h of S.hz) {
        h.t -= dt; h.tick -= dt;
        if (h.tick <= 0) { h.tick = 0.6; for (const p of S.players.values()) if (Math.hypot(p.x - h.x, p.z - h.z) < h.r) hurtPlayer(p, h.dmg); }
      }
      S.hz = S.hz.filter(h => h.t > 0);
    }
    // shockwave rings
    if (S.waves.length) {
      for (const w of S.waves) {
        w.r += w.spd * dt;
        for (const p of S.players.values()) {
          if (w.hit.has(p.id) || p.downed) continue;
          const d = Math.hypot(p.x - w.x, p.z - w.z);
          if (Math.abs(d - w.r) < 0.7) { if (p.inv > 0) w.hit.add(p.id); else { w.hit.add(p.id); hurtPlayer(p, w.dmg); } }
        }
      }
      S.waves = S.waves.filter(w => w.r < w.max);
    }
    // arena rooms: waves of enemies once someone steps in, then a reward chest
    for (const A of S.arenas) {
      if (A.st === 2) continue;
      const r = map.rooms[A.room];
      if (A.st === 0) {
        let inside = false;
        for (const p of S.players.values()) if (!p.downed && map.rid[tileOf(map, p.x, p.z)] === A.room) inside = true;
        if (!inside) continue;
        A.st = 1; A.wave = 0; A.next = 0.3;
        ev('msg', '⚔️ AMBUSH! Survive the waves!'); ev('sfx', 'roar');
      }
      if (A.st === 1) {
        const alive = A.ids.some(id => S.enemies.some(o => o.id === id && o.hp > 0));
        if (alive || A.pending) continue;
        if (A.wave >= A.nW) {
          A.st = 2; ev('msg', '🏆 Arena cleared!');
          const c = { x: (r.x + r.w / 2) * TILE, z: (r.y + r.h / 2) * TILE };
          if (!blockedCircle(map, c.x, c.z, 0.8)) spawnEnemy('chest', c.x, c.z); else { const s = freeSpotIn(r, 1.5, 0.8); if (s) spawnEnemy('chest', s.x, s.z); }
          continue;
        }
        A.wave++; A.pending = true;
        const n = Math.min(7, 3 + Math.floor(S.floor / 3) + A.wave);
        const pool = MOB_KEYS.filter(k => !ENEMIES[k].minF || S.floor >= ENEMIES[k].minF);
        const spots = [];
        for (let i = 0; i < n; i++) { const s = freeSpotIn(r, 1.5); if (s) { spots.push(s); ev('tele', r1(s.x), r1(s.z), 1.3, 1.0); } }
        if (A.wave > 1) ev('msg', 'Wave ' + A.wave + '!');
        later(1.0, () => {
          A.pending = false; A.ids = [];
          spots.forEach((s, i) => {
            const t = i === 0 && A.wave === A.nW ? (S.floor >= 3 ? 'shield' : 'brute') : R.pick(pool);
            const m = spawnEnemy(t, s.x, s.z, { elite: i === 0 && A.wave === A.nW });
            m.awake = true; A.ids.push(m.id);
            ev('ring', r1(s.x), r1(s.z), 1.5, 0xff4a2a);
          });
        });
      }
    }
  }

  // ---------- main update ----------
  function update(dt) {
    if (!S.map) return;
    S.time += dt;

    // players
    for (const p of S.players.values()) {
      p.atkT -= dt; p.scdT -= dt; p.potT -= dt; p.inv -= dt; p.hurtT -= dt; p.atkAnim -= dt;
      const inp = p.inp;
      if (inp.dn !== p.last.dn) { p.last.dn = inp.dn; p.inv = 0.4; }
      if (p.downed) {
        p.last.an = inp.an; p.last.pn = inp.pn;
        let reviving = false;
        for (const o of S.players.values()) if (o !== p && !o.downed && Math.hypot(o.x - p.x, o.z - p.z) < 2.8) reviving = true;
        if (reviving) { p.revive += dt; if (p.revive >= 2.2) { p.downed = false; p.hp = Math.round(p.maxHp * 0.5); p.inv = 1.5; ev('revived', p.id); } }
        else p.revive = Math.max(0, p.revive - dt * 0.5);
        continue;
      }
      if (inp.atk && p.atkT <= 0) doAttack(p);
      if (inp.an !== p.last.an) { p.last.an = inp.an; if (p.scdT <= 0) doSpecial(p); }
      if (inp.pn !== p.last.pn) { p.last.pn = inp.pn; if (p.potT <= 0) { p.potT = COOLDOWN.potion * 0.95; p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.6); ev('heal', p.id); } }
    }

    S.flowT -= dt;
    if (S.flowT <= 0) { S.flowT = 0.25; updateFlow(); }

    updateWorld(dt);

    for (const e of S.enemies) if (e.hp > 0) updateEnemy(e, dt);
    // separation
    const act = S.enemies.filter(e => e.hp > 0 && e.awake && !e.d.prop);
    for (let i = 0; i < act.length; i++) {
      const a = act[i];
      for (let j = i + 1; j < act.length; j++) {
        const b = act[j];
        const dx = b.x - a.x, dz = b.z - a.z, rr = a.r + b.r;
        if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
        const d = Math.hypot(dx, dz);
        if (d < rr && d > 0.001) {
          const push = (rr - d) * 0.5, nx = dx / d, nz = dz / d;
          const wa = a.type === 'boss' ? 0.05 : a.d.still ? 0 : 1, wb = b.type === 'boss' ? 0.05 : b.d.still ? 0 : 1;
          if (wa) moveCircle(S.map, a, -nx * push * wa, -nz * push * wa, a.r * 0.9);
          if (wb) moveCircle(S.map, b, nx * push * wb, nz * push * wb, b.r * 0.9);
        }
      }
    }
    S.enemies = S.enemies.filter(e => e.hp > 0);

    // projectiles
    for (const pr of S.projs) {
      pr.life -= dt;
      pr.x += pr.vx * dt; pr.z += pr.vz * dt;
      if (pr.lob) { // lobbed bombs ignore walls and players until they land
        if (pr.life <= 0) explode(pr.tx, pr.tz, pr.boomR, pr.boomDmg, pr.boomDmg * 0.5, -1, pr.boomCol);
        continue;
      }
      if (!pr.ghost && isSolidAt(S.map, pr.x, pr.z)) {
        pr.life = 0;
        if (pr.splash) explode(pr.x - pr.vx * dt, pr.z - pr.vz * dt, pr.splash, 0, pr.dmg * 0.6, pr.src, 0xb388ff);
        continue;
      }
      if (pr.team === 'p') {
        for (const e of S.enemies) {
          if (e.hp <= 0) continue;
          if (pr.hit && pr.hit.has(e.id)) continue;
          if (Math.hypot(e.x - pr.x, e.z - pr.z) < e.r + pr.r) {
            dmgEnemy(e, pr.dmg, pr.src, { crit: pr.crit, kb: 1.5, ang: Math.atan2(pr.vx, pr.vz) });
            if (pr.splash) explode(pr.x, pr.z, pr.splash, 0, pr.dmg * 0.6, pr.src, 0xb388ff);
            if (pr.pierce > 0) { pr.pierce--; (pr.hit = pr.hit || new Set()).add(e.id); }
            else { pr.life = 0; break; }
          }
        }
      } else {
        for (const p of S.players.values()) {
          if (p.downed) continue;
          if (Math.hypot(p.x - pr.x, p.z - pr.z) < 0.5 + pr.r) { hurtPlayer(p, pr.dmg); pr.life = 0; break; }
        }
      }
    }
    S.projs = S.projs.filter(p => p.life > 0);
    S.enemies = S.enemies.filter(e => e.hp > 0);

    // loot pickup
    for (const l of S.loot) {
      l.t += dt;
      if (l.t < 0.5) continue;
      for (const p of S.players.values()) {
        if (p.downed) continue;
        if (l.owner !== -1 && l.owner !== p.id) continue;
        const d = Math.hypot(p.x - l.x, p.z - l.z);
        if (l.kind === 'coin' && d < 4.5 && d > 0.8) { l.x += (p.x - l.x) / d * 14 * dt; l.z += (p.z - l.z) / d * 14 * dt; }
        if (d < 1.3) {
          if (l.kind === 'heart') { if (p.hp >= p.maxHp) continue; p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.25); ev('heal', p.id); }
          else if (Sim.onGrant) Sim.onGrant(p.id, l.kind === 'item' ? { item: l.item } : { coins: l.v || 1 });
          l.gone = true; ev('pick', p.id, l.kind);
          break;
        }
      }
    }
    S.loot = S.loot.filter(l => !l.gone);

    // portal / wipe
    const alive = alivePlayers();
    if (alive.length === 0 && S.players.size) {
      S.wipeT += dt;
      if (S.wipeT > 3 && Sim.onWipe) { S.wipeT = -99; Sim.onWipe(); }
    } else if (S.portalOpen) {
      const near = alive.filter(p => Math.hypot(p.x - S.map.exit.x, p.z - S.map.exit.z) < 3.2).length;
      S.portalNear = near;
      if (near > 0 && near >= alive.length && Sim.onExit) { S.portalOpen = false; Sim.onExit(); }
    }
  }

  // ---------- snapshot for guests ----------
  function snapshot(forId) {
    const ps = [];
    for (const p of S.players.values()) ps.push([p.id, r2(p.x), r2(p.z), r2(p.f), Math.round(p.hp), p.maxHp, (p.downed ? 1 : 0) | (p.atkAnim > 0 ? 2 : 0), p.wpn.w, p.wpn.r, p.color, p.lvl, p.name, Math.round(p.revive * 10), r2(p.aim || p.f)]);
    const es = [];
    for (const e of S.enemies) es.push([e.id, e.sk, r2(e.x), r2(e.z), r2(e.f), Math.round(100 * e.hp / e.maxHp), (e.st === 'wind' ? 1 : 0) | (e.flash > 0 ? 2 : 0) | (e.burn > 0 ? 4 : 0) | (e.slow > 0 ? 8 : 0) | (e.elite ? 16 : 0) | (e.awake ? 32 : 0), r2(e.size)]);
    const js = [];
    for (const p of S.projs) js.push([p.id, PROJ_KINDS.indexOf(p.k), r2(p.x), r2(p.z), r2(p.vx), r2(p.vz), p.col || 0]);
    const ls = [];
    for (const l of S.loot) if (l.owner === -1 || l.owner === forId) ls.push([l.id, l.kind, r2(l.x), r2(l.z), l.item ? l.item.r : 0, l.item ? l.item.w : '']);
    return {
      t: 's', fl: S.floor, p: ps, e: es, j: js, l: ls,
      b: S.boss ? [S.boss.name, Math.round(1000 * S.boss.hp / S.boss.maxHp)] : 0,
      po: S.portalOpen ? 1 : 0, pn: S.portalNear || 0,
      k: S.enemies.filter(e => !e.d.prop).length,
    };
  }

  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }

  return {
    S, addPlayer, removePlayer, setStats, setInput, startFloor, update, snapshot, nearestEnemy,
    onGrant: null, onExit: null, onWipe: null, onEvent: null,
  };
})();
