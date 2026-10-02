// sim.js — host-authoritative simulation: enemies, combat, projectiles, loot, bosses
// Player positions are owned by each player's own device; everything else is decided here.
'use strict';

const Sim = (() => {
  const S = {
    floor: 1, seed: 1, map: null, theme: THEMES[0],
    players: new Map(), enemies: [], projs: [], loot: [],
    events: [], nextId: 1, boss: null, portalOpen: false, time: 0,
    flow: null, flowT: 0, wipeT: 0, nPlayersAtStart: 1,
    timers: [], hz: [], waves: [], arenas: [], plateCd: [],
    champLastF: undefined, champPlan: null, // champion packs: last floor that had one, this floor's roll
  };
  const nid = () => S.nextId++;
  const ev = (...a) => { S.events.push(a); if (Sim.onEvent) Sim.onEvent(a); };
  const scaleHp = f => 1 + 0.38 * (f - 1);
  const scaleDmg = f => 1 + 0.16 * (f - 1);
  // co-op scaling: more heroes -> more enemies (+30% per extra hero) and a little more health (+12.5%);
  // bosses have no extra bodies, so they get the bigger health boost (+55% per extra hero)
  const nHeroes = () => Math.max(1, S.players.size);
  const coopN = () => 1 + 0.3 * (nHeroes() - 1);
  const coopHp = () => 1 + 0.125 * (nHeroes() - 1);
  const coopBossHp = () => 1 + 0.55 * (nHeroes() - 1);

  function alivePlayers() { const a = []; for (const p of S.players.values()) if (!p.downed) a.push(p); return a; }

  // ---------- player management ----------
  function addPlayer(id, info) {
    const p = {
      id, name: info.name || ('Hero ' + (id + 1)), color: info.color || PLAYER_COLORS[id % PLAYER_COLORS.length],
      x: S.map ? S.map.start.x + (id % 2) * 1.5 : 0, z: S.map ? S.map.start.z + (id > 1 ? 1.5 : 0) : 0, f: 0,
      lvl: info.lvl || 1, wpn: info.wpn || makeItem(1, 0, 'sword'), hp: 0, maxHp: 0,
      downed: false, revive: 0, atkT: 0, scdT: 0, potT: 0, inv: 0, hurtT: 0, atkAnim: 0, floor: S.floor,
      boosts: {}, skin: '', ph: 0, buffs: { rage: 0, swift: 0, iron: 0 },
      inp: { atk: false, an: 0, pn: 0, dn: 0 }, last: { an: 0, pn: 0, dn: 0 }, init: false,
    };
    applyHeroStats(p, info);
    p.maxHp = calcMaxHp(p); p.hp = p.maxHp;
    // make sure every player has a different color
    const used = new Set([...S.players.values()].map(o => o.color));
    if (used.has(p.color)) p.color = PLAYER_COLORS.find(c => !used.has(c)) || p.color;
    S.players.set(id, p);
    return p;
  }
  function removePlayer(id) { S.players.delete(id); }
  // merchant extras sent by the player's device: permanent boosts, outfit, phoenix feather carried
  function applyHeroStats(p, st) {
    if (st.boosts && typeof st.boosts === 'object') { const b = {}; for (const k of BOOST_KEYS) b[k] = boostRank(st.boosts, k); p.boosts = b; }
    if (typeof st.skin === 'string') p.skin = HERO_SKINS.some(h => h.id === st.skin) ? st.skin : '';
    if (st.ph !== undefined) p.ph = st.ph ? 1 : 0;
  }
  function calcMaxHp(p) { return Math.round(maxHpFor(p.lvl) * hpBoostMult(p.boosts)); }
  function setStats(id, st) {
    const p = S.players.get(id); if (!p) return;
    if (st.lvl) p.lvl = st.lvl;
    applyHeroStats(p, st);
    const old = p.maxHp; p.maxHp = calcMaxHp(p);
    if (p.maxHp > old) p.hp += p.maxHp - old; else p.hp = Math.min(p.hp, p.maxHp);
    if (st.wpn) p.wpn = st.wpn;
    if (st.name) p.name = st.name;
    if (st.color && ![...S.players.values()].some(o => o !== p && o.color === st.color)) p.color = st.color;
  }
  // battle potion drunk on a player's device: timed buff applied here (host)
  function buff(id, k) {
    const p = S.players.get(id); if (!p || !POTIONS[k] || !BUFF_KEYS.includes(k)) return false;
    p.buffs[k] = POTIONS[k].dur;
    ev('buff', id, k);
    return true;
  }
  function setInput(id, m) {
    const p = S.players.get(id); if (!p) return;
    if (m.fl !== S.floor) return; // stale packet from previous floor
    // Inputs ride the unreliable channel and can arrive out of order: ignore older ones.
    // (counters an/pn/dn are cumulative, so a skipped packet loses nothing)
    if (m.ts !== undefined) { if (p.inTs !== undefined && m.ts <= p.inTs && m.ts > p.inTs - 60000) return; p.inTs = m.ts; }
    if (!(isFinite(m.x) && isFinite(m.z))) return;
    if (!p.downed) { p.x = m.x; p.z = m.z; }
    if (isFinite(m.f)) p.f = m.f;
    p.moving = m.mv;
    p.inp.atk = !!m.atk; p.inp.an = m.an; p.inp.pn = m.pn; p.inp.dn = m.dn;
    if (!p.init) { p.last.an = m.an; p.last.pn = m.pn; p.last.dn = m.dn; p.init = true; }
  }

  // ---------- floors ----------
  function startFloor(floor, seed) {
    S.floor = floor; S.seed = seed;
    S.map = genDungeon(seed, floor);
    S.theme = themeFor(floor);
    S.enemies = []; S.projs = []; S.loot = []; S.boss = null; S.portalOpen = !S.map.boss; S.wipeT = 0; S.portalT = 0; S.portalNear = 0;
    S.timers = []; S.hz = []; S.waves = []; S.arenas = []; S.trapT = 0;
    S.plateCd = S.map.plates.map(() => 0);
    S.nPlayersAtStart = Math.max(1, S.players.size);
    navPrep(); S.flowT = 0;
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
    if (!d.prop && !d.still && S.map) unstickPos(e); // big bodies spawned with a small-radius check
    if (type === 'egg') { e.hatch = 5; e.awake = true; }
    if (type === 'totem') e.summonT = 2.5;
    if (type === 'mage') e.blinkT = 3 + R() * 2;
    S.enemies.push(e);
    return e;
  }

  const PORTAL_R = 3.2, PORTAL_T = 5; // portal radius, countdown seconds
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
      const hp = Math.round(ENEMIES.boss.hp * scaleHp(f) * coopBossHp() * (1 + 0.15 * Math.floor(f / 12)));
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
      n = Math.min(Math.round(Math.min(n, 9) * coopN()), 13);
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
    // rare champion pack: takes over one room (its normal mobs) and counts against the mob budget
    const champRi = champRoll(f) ? champRoom(rooms) : -1;
    const packN = champRi >= 0 ? champPackSize() : 0;
    if (champRi >= 0) plan[champRi] = 0;
    const mobTotal = plan.reduce((a, b) => a + b, 0);
    const mobBudget = Math.round(Math.max(20, MAX_ENTS - propTotal - 8) * coopN()) - packN; // snapshots only carry nearby entities, so co-op can afford more
    const scale = Math.min(1, mobBudget / Math.max(1, mobTotal));

    const chestRooms = new Set();
    const normalIdx = rooms.map((r, i) => i).filter(i => i > 0 && i !== champRi && (rooms[i].kind === 'normal' || rooms[i].kind === 'exit' || rooms[i].kind === 'chasm'));
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
      if (i === champRi) spawnPack(r, packN - 1);
      else if (r.kind === 'normal' || r.kind === 'exit' || r.kind === 'chasm') {
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

  // ---------- champion packs ----------
  // A rare, named, bigger version of a world mob with 1-2 affixes (CHAMP_AFFIXES in data.js) and 4-6
  // minions that guard it. Roughly every 2-3 floors: never on floor 1, boss floors or in the start room;
  // the chance grows with every floor without one. HP ~8x a grunt (x the boss co-op factor), hits a bit
  // harder, can't be juggled, and always drops a rare-or-better weapon (25% legendary).
  const CHAMP_HP = 250, CHAMP_DMG = 1.35, CHAMP_SPD_MAX = 6; // heroes run at 7.2: you can always get away
  function champRoll(f) {
    if (f < 2 || isBossFloor(f)) return false;
    if (S.champPlan && S.champPlan.f === f) return S.champPlan.has; // retrying a floor: same surprise
    if (S.champLastF === undefined || S.champLastF >= f) S.champLastF = f - 2; // new run / started mid-way
    const d = f - S.champLastF;
    const has = R() < (d <= 1 ? 0.12 : d === 2 ? 0.45 : d === 3 ? 0.7 : 1);
    S.champPlan = { f, has };
    if (has) S.champLastF = f;
    return has;
  }
  // a roomy normal room well away from the start (exit / chasm rooms only as a fallback)
  function champRoom(rooms) {
    const st = S.map.start;
    let best = -1, bs = 0;
    rooms.forEach((r, i) => {
      if (i === 0 || !(r.kind === 'normal' || r.kind === 'exit' || r.kind === 'chasm') || r.w * r.h < 64) return;
      if (Math.hypot((r.x + r.w / 2) * TILE - st.x, (r.y + r.h / 2) * TILE - st.z) < 22) return;
      const sc = r.w * r.h * (r.kind === 'normal' ? 1 : 0.3) * (0.6 + R() * 0.8);
      if (sc > bs) { bs = sc; best = i; }
    });
    return best;
  }
  const champPackSize = () => 1 + Math.min(8, Math.round(R.int(4, 6) * coopN()));
  function champAffixRoll(f, type) {
    const n = f >= 12 ? 2 : f >= 5 && R() < 0.5 ? 2 : 1;
    let bits = 0;
    for (let k = 0; k < n; k++) {
      const ok = CHAMP_AFFIXES.map((a, i) => i).filter(i => {
        if (bits & (1 << i)) return false;
        const id = CHAMP_AFFIXES[i].id, has = x => !!(bits & (1 << CHAMP_IDX[x]));
        if (id === 'iron' && (type === 'shield' || has('vamp'))) return false; // no unkillable combos
        if (id === 'vamp' && has('iron')) return false;
        return true;
      });
      bits |= 1 << R.pick(ok);
    }
    return bits;
  }
  // is (x,z) a fine spot for a pack member: free, no trap, in room ri, away from the portal
  function packSpotOk(x, z, rad, ri) {
    const map = S.map, k = tileOf(map, x, z);
    if (blockedCircle(map, x, z, rad) || map.rid[k] !== ri) return false;
    const tt = map.tt[k];
    if (tt === TT_SPIKE || tt === TT_VENT || tt === TT_PLATE) return false;
    return Math.hypot(x - map.exit.x, z - map.exit.z) >= 3.5;
  }
  function spawnPack(r, nMin) {
    const f = S.floor, map = S.map, ri = map.rooms.indexOf(r);
    const type = R() < 0.3 ? 'brute' : f >= 4 && R() < 0.35 ? 'shield' : 'grunt';
    const aff = champAffixRoll(f, type);
    const big = type === 'brute' ? 1.3 : 1.5, rad = ENEMIES[type].r * big;
    let c = { x: (r.x + r.w / 2) * TILE, z: (r.y + r.h / 2) * TILE };
    if (!packSpotOk(c.x, c.z, rad, ri)) { c = null; for (let t = 0; t < 30 && !c; t++) { const s = freeSpotIn(r, 2.5, rad); if (s && packSpotOk(s.x, s.z, rad, ri)) c = s; } }
    if (!c) return null;
    const e = spawnEnemy(type, c.x, c.z);
    e.cc = 1 | (aff << 2); e.pack = e.id; e.homeX = c.x; e.homeZ = c.z;
    e.size *= big; e.r = rad;
    e.hp = e.maxHp = Math.round(CHAMP_HP * (type === 'brute' ? 1.3 : type === 'shield' ? 1.1 : 1) * scaleHp(f) * coopBossHp());
    e.spdM = champHas(e.cc, 'swift') ? 1.35 : 1; e.cdM = champHas(e.cc, 'swift') ? 0.8 : 1;
    e.reach = big * 0.85; e.shockT = 3; e.patT = 1 + R() * 2;
    unstickPos(e);
    // minions: one normal type per pack, standing in a ring around their leader
    const pool = ['grunt', 'grunt', 'runner', 'slime', 'archer'].concat(f >= 5 ? ['shield', 'charger'] : []);
    e.minType = R.pick(pool);
    for (let k = 0; k < nMin; k++) addMinion(e, (k / nMin) * 6.283 + R() * 0.4, false);
    return e;
  }
  function addMinion(L, slot, awake) {
    const map = S.map, ri = map.rid[tileOf(map, L.homeX, L.homeZ)];
    const rr = L.r + 1.4 + R() * 0.8, d = ENEMIES[L.minType];
    let x = L.x + Math.sin(slot) * rr, z = L.z + Math.cos(slot) * rr;
    if (!packSpotOk(x, z, d.r, ri)) {
      let ok = false;
      for (let t = 0; t < 12 && !ok; t++) { const a = slot + (t + 1) * 0.55 * (t % 2 ? 1 : -1), q = rr + (t % 3) * 0.6; x = L.x + Math.sin(a) * q; z = L.z + Math.cos(a) * q; ok = packSpotOk(x, z, d.r, ri); }
      if (!ok) { const s = freeSpotIn(map.rooms[ri] || map.rooms[0], 1.5); if (!s) return null; x = s.x; z = s.z; }
    }
    const m = spawnEnemy(L.minType, x, z);
    m.cc = 2 | (L.cc & ~3); m.pack = L.pack; m.leader = L; m.slot = slot; m.slotR = rr; m.awake = !!awake;
    return m;
  }
  // asleep: the champion strolls around its post, minions keep their place in the ring around it
  function packIdle(e, dt) {
    let tx, tz, spd;
    if (e.cc & 1) {
      e.patT -= dt;
      if (e.patT <= 0) { e.patT = 3 + R() * 3; const a = R() * 6.283, d = R() * 3.5; e.patX = e.homeX + Math.sin(a) * d; e.patZ = e.homeZ + Math.cos(a) * d; }
      if (e.patX === undefined || e.patT > 4.5) return; // pause a moment at each stop
      tx = e.patX; tz = e.patZ; spd = 1.2;
    } else {
      const L = e.leader; if (!L || L.hp <= 0) return;
      tx = L.x + Math.sin(e.slot) * e.slotR; tz = L.z + Math.cos(e.slot) * e.slotR; spd = Math.min(e.d.spd, 3.2);
    }
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
    if (d < 0.35) return;
    const nx = dx / d, nz = dz / d, map = S.map, k = tileOf(map, e.x + nx * (e.r + 0.4), e.z + nz * (e.r + 0.4)), tt = map.tt[k];
    if (tt === TT_SPIKE || tt === TT_VENT || map.g[k] !== T_FLOOR) return; // never stroll onto traps or ledges
    moveEnemy(e, nx, nz, d > 3 ? spd : spd * 0.6, dt);
  }
  // the whole pack wakes together; the champion is announced the first time
  function packAlert(id) {
    let L = null;
    for (const o of S.enemies) if (o.pack === id && o.hp > 0) { o.awake = true; if (o.cc & 1) L = o; }
    if (!L || L.seen) return;
    L.seen = true;
    ev('msg', '⚠️ ' + champName(L.id, L.cc) + ' appears!', champAffixes(L.cc).map(a => a.icon + ' ' + a.label).join(' · '));
    ev('sfx', 'roar'); ev('shake', 0.3); ev('ring', r1(L.x), r1(L.z), 5, champColor(L.cc));
  }
  // awake champion: affixes that act on their own (frenzy, summoner, shocking)
  function champUpdate(e, dist, dt) {
    const cc = e.cc, half = e.hp < e.maxHp * 0.5;
    if (half && !e.frenzy && champHas(cc, 'frenzy')) {
      e.frenzy = true; e.spdM *= 1.25; e.cdM *= 0.6;
      ev('msg', '😡 ' + champName(e.id, cc) + ' is FRENZIED!', 'Faster attacks — keep moving!'); ev('sfx', 'roar'); ev('ring', r1(e.x), r1(e.z), 4, 0xff8a1a);
    }
    if (half && !e.called && champHas(cc, 'summon')) {
      e.called = true;
      ev('msg', '📯 ' + champName(e.id, cc) + ' calls for help!'); ev('sfx', 'roar'); ev('ring', r1(e.x), r1(e.z), 4.5, 0xb46aff);
      const n = 2 + Math.min(2, nHeroes() - 1);
      for (let i = 0; i < n; i++) later(0.5 + i * 0.15, () => { if (e.hp > 0 && S.enemies.length < 95) { const m = addMinion(e, R() * 6.283, true); if (m) ev('ring', r1(m.x), r1(m.z), 1.5, 0xb46aff); } });
    }
    if (champHas(cc, 'shock')) { // marked circle on the floor, 1.1 s later a burst of lightning: step out!
      e.shockT -= dt;
      if (e.shockT <= 0 && dist < 9) {
        e.shockT = 5 + R() * 1.5;
        const x = e.x, z = e.z, rad = 2.4 + e.r;
        ev('tele', r1(x), r1(z), rad, 1.1); ev('sfx', 'zap');
        later(1.1, () => { if (e.hp > 0) explode(x, z, rad, 12, 0, -1, 0xfff04a); });
      }
    }
  }
  // an enemy's hit on a player (vampiric champions heal when it lands)
  function enemyHits(e, p, dmg) {
    const hp0 = p.hp;
    hurtPlayer(p, dmg);
    if (e.cc & 1 && p.hp < hp0 && e.hp > 0 && champHas(e.cc, 'vamp')) {
      e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * 0.06));
      ev('ring', r1(e.x), r1(e.z), 2.4, 0xff2a4a);
    }
  }
  function champDeath(e) {
    const f = S.floor;
    ev('msg', '🏆 ' + champName(e.id, e.cc) + ' defeated!'); ev('sfx', 'fanfare'); ev('shake', 0.4);
    ev('ring', r1(e.x), r1(e.z), 5, champColor(e.cc));
    for (const p of S.players.values()) {
      const rar = R() < 0.25 ? 3 : R() < 0.35 ? 2 : 1; // always rare or better
      dropLoot(p.id, 'item', e.x, e.z, { item: makeItem(f, rar) });
      for (let i = 0; i < 5; i++) dropLoot(p.id, 'coin', e.x, e.z, { v: R.int(3, 6) * f });
    }
    dropLoot(-1, 'heart', e.x, e.z);
  }

  // ---------- navigation ----------
  // Walkable = floor tiles only (map.g === T_FLOOR): walls, pits (2) and statues/fountains (3) block.
  // Flow field: Dijkstra from every living player (Dial's bucket queue, no distance cap). Orthogonal
  // step 2, diagonal 3 (only when both sides are floor), +1 on tiles that touch a wall/pit/statue so
  // paths keep to the middle of corridors (big bodies don't snag on corners).
  const NBX = [1, -1, 0, 0, 1, 1, -1, -1], NBY = [0, 0, 1, -1, 1, -1, 1, -1];
  function navPrep() {
    const map = S.map, W = map.W, H = map.H, N = W * H, g = map.g;
    const nw = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      if (g[k] !== T_FLOOR) continue;
      const x = k % W;
      for (let n = 0; n < 8; n++) {
        const xx = x + NBX[n], m = k + NBX[n] + NBY[n] * W;
        if (xx < 0 || xx >= W || m < 0 || m >= N || g[m] !== T_FLOOR) { nw[k] = 1; break; }
      }
    }
    // big bodies (wider than a tile: elite brutes, bosses) can't use 1-tile necks: floor tiles that are
    // blocked on both opposite sides are left out of their field, and wall-hugging tiles cost more
    const wide = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      if (g[k] !== T_FLOOR) continue;
      const x = k % W;
      const L = x > 0 && g[k - 1] === T_FLOOR, Rr = x < W - 1 && g[k + 1] === T_FLOOR, U = k >= W && g[k - W] === T_FLOOR, D = k + W < N && g[k + W] === T_FLOOR;
      wide[k] = (L || Rr) && (U || D) && !(!L && !Rr) && !(!U && !D) ? 1 : 0;
    }
    S.nearWall = nw; S.wide = wide; S.flow = new Int32Array(N).fill(-1); S.flowBig = new Int32Array(N).fill(-1);
  }
  const BIG_R = 1.0; // body radius (r * 0.9) above which an enemy uses the wide-body flow field
  const isBig = e => e.r * 0.9 > BIG_R;
  function updateFlow() {
    const map = S.map, N = map.W * map.H;
    if (!S.flow || S.flow.length !== N || !S.nearWall) navPrep();
    flowFill(S.flow, null, 1);
    if (S.enemies.some(e => e.awake && e.hp > 0 && isBig(e))) flowFill(S.flowBig, S.wide, 3); else S.flowBig.fill(-1);
  }
  function flowFill(fl, mask, wallCost) {
    const map = S.map, W = map.W, N = W * map.H, g = map.g;
    const nw = S.nearWall; fl.fill(-1);
    const B = S.buckets || (S.buckets = [[], [], [], [], [], [], [], []]);
    for (const b of B) b.length = 0;
    let pending = 0;
    for (const p of alivePlayers()) {
      const k = tileOf(map, p.x, p.z);
      if (k >= 0 && k < N && g[k] === T_FLOOR && fl[k] !== 0) { fl[k] = 0; B[0].push(k); pending++; }
    }
    for (let cur = 0; pending > 0; cur++) {
      const b = B[cur & 7];
      while (b.length) {
        const k = b.pop(); pending--;
        if (fl[k] !== cur) continue; // stale entry
        const x = k % W;
        for (let n = 0; n < 8; n++) {
          const ox = NBX[n], oy = NBY[n], xx = x + ox;
          if (xx < 0 || xx >= W) continue;
          const m = k + ox + oy * W;
          if (m < 0 || m >= N || g[m] !== T_FLOOR || (mask && !mask[m])) continue;
          if (n >= 4 && (g[k + ox] !== T_FLOOR || g[k + oy * W] !== T_FLOOR)) continue;
          const c = cur + (n >= 4 ? 3 : 2) + nw[m] * wallCost;
          if (fl[m] < 0 || c < fl[m]) { fl[m] = c; B[c & 7].push(m); pending++; }
        }
      }
    }
  }
  // can a circle of radius r slide straight from (x0,z0) to (x1,z1)?
  function walkLine(x0, z0, x1, z1, r) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.5);
    for (let i = 1; i <= n; i++) { const t = i / n; if (blockedCircle(S.map, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, r)) return false; }
    return true;
  }
  // line of sight: walls and statues block, pits don't (you can see across a chasm)
  function seeLine(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.7);
    for (let i = 1; i < n; i++) { const t = i / n; if (isSolidAt(S.map, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false; }
    return true;
  }
  const tileC = k => [((k % S.map.W) + 0.5) * TILE, (Math.floor(k / S.map.W) + 0.5) * TILE];
  // steepest-descent neighbour on the flow field (diagonals only around clear corners)
  function flowNext(k, fl) {
    fl = fl || S.flow;
    const map = S.map, W = map.W, g = map.g, x = k % W;
    let best = fl[k] < 0 ? 1e9 : fl[k], bk = -1;
    for (let n = 0; n < 8; n++) {
      const ox = NBX[n], oy = NBY[n], xx = x + ox;
      if (xx < 0 || xx >= W) continue;
      const m = k + ox + oy * W;
      if (m < 0 || m >= fl.length || fl[m] < 0) continue;
      if (n >= 4 && (g[k + ox] !== T_FLOOR || g[k + oy * W] !== T_FLOOR)) continue;
      if (fl[m] < best) { best = fl[m]; bk = m; }
    }
    return bk;
  }
  // Direction for an enemy chasing (tx,tz): straight only with a clear swept line; otherwise follow the
  // flow field and aim at the farthest of the next few path tiles it can walk straight to (string pulling).
  function navCompute(e, tx, tz) {
    const r = e.r * 0.9, dx = tx - e.x, dz = tz - e.z, dd = Math.hypot(dx, dz) || 1;
    if (dd < 30 && walkLine(e.x, e.z, tx, tz, r)) return [dx / dd, dz / dd];
    const map = S.map;
    let k = tileOf(map, e.x, e.z);
    let fl = isBig(e) && S.flowBig ? S.flowBig : S.flow;
    if (fl === S.flowBig && k >= 0 && k < fl.length && fl[k] < 0 && flowNext(k, fl) < 0) fl = S.flow; // off the wide network: use the normal field
    if (!fl || k < 0 || k >= fl.length) return [dx / dd, dz / dd];
    if (fl[k] < 0) { // standing on an unreached tile (edge of a wall / bad spawn): head to the nearest reached neighbour
      const nb = flowNext(k, fl);
      if (nb < 0) return [dx / dd, dz / dd];
      const [cx, cz] = tileC(nb), cd = Math.hypot(cx - e.x, cz - e.z) || 1;
      return [(cx - e.x) / cd, (cz - e.z) / cd];
    }
    const chain = [];
    for (let i = 0; i < 5; i++) { const nb = flowNext(k, fl); if (nb < 0) break; chain.push(nb); k = nb; }
    if (!chain.length) return [dx / dd, dz / dd];
    for (let i = chain.length - 1; i >= 0; i--) {
      const [cx, cz] = tileC(chain[i]);
      if (i === 0 || walkLine(e.x, e.z, cx, cz, r)) {
        const cd = Math.hypot(cx - e.x, cz - e.z);
        if (cd < 0.05) continue;
        return [(cx - e.x) / cd, (cz - e.z) / cd];
      }
    }
    return [dx / dd, dz / dd];
  }
  // cached per enemy (recomputed ~7x/s, or right away while unsticking)
  function flowDir(e, tx, tz) {
    e.navT = (e.navT || 0) - (S.dt || 0);
    if (e.unT > 0) return [e.unX, e.unZ];
    if (e.navT <= 0 || e.ndx === undefined) {
      e.navT = 0.12 + R() * 0.06;
      const [x, z] = navCompute(e, tx, tz); e.ndx = x; e.ndz = z;
    }
    return [e.ndx, e.ndz];
  }
  // pull an entity whose body overlaps a wall / pit / statue out to the nearest free spot
  function unstickPos(e) {
    const r = e.r * 0.9;
    if (!blockedCircle(S.map, e.x, e.z, r)) return false;
    for (let rad = 0.4; rad <= 7; rad += 0.4) {
      const n = Math.max(8, Math.round(rad * 6));
      let best = null, bd = 1e9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.283, x = e.x + Math.sin(a) * rad, z = e.z + Math.cos(a) * rad;
        if (blockedCircle(S.map, x, z, r)) continue;
        const k = tileOf(S.map, x, z), f = S.flow && S.flow[k] >= 0 ? S.flow[k] : 1e6;
        if (f < bd) { bd = f; best = [x, z]; }
      }
      if (best) { e.x = best[0]; e.z = best[1]; e.kx = e.kz = 0; return true; }
    }
    return false;
  }
  // stuck watchdog for chasing enemies: < 0.3 units of progress in ~0.7 s while trying to move
  // -> slide sideways / take another flow neighbour for a moment, then re-path
  function stuckCheck(e, dt, wantX, wantZ) {
    if (e.stkX === undefined) { e.stkX = e.x; e.stkZ = e.z; e.stkT = 0; e.stkMv = 0; }
    e.stkT += dt; e.stkMv += dt;
    if (e.stkT < 0.7) return;
    const moved = Math.hypot(e.x - e.stkX, e.z - e.stkZ);
    if (e.stkMv > 0.5 && moved < 0.3) {
      e.stuckN = (e.stuckN || 0) + 1;
      if (unstickPos(e)) { e.stuckN = 0; }
      else {
        const r = e.r * 0.9, side = (e.stuckN & 1) ? 1 : -1;
        const opts = [];
        for (const a of [1.57 * side, -1.57 * side, 0.785 * side, -0.785 * side, 2.36 * side, -2.36 * side, 3.14]) {
          const c = Math.cos(a), s = Math.sin(a);
          opts.push([wantX * c - wantZ * s, wantX * s + wantZ * c]);
        }
        const k = tileOf(S.map, e.x, e.z), nb = S.flow ? flowNext(k, isBig(e) && S.flowBig ? S.flowBig : S.flow) : -1;
        if (nb >= 0) { const [cx, cz] = tileC(nb), cd = Math.hypot(cx - e.x, cz - e.z) || 1; opts.unshift([(cx - e.x) / cd, (cz - e.z) / cd]); }
        for (const [ox, oz] of opts) {
          if (!blockedCircle(S.map, e.x + ox * 0.7, e.z + oz * 0.7, r)) { e.unX = ox; e.unZ = oz; e.unT = 0.5 + 0.15 * Math.min(4, e.stuckN); break; }
        }
      }
      e.navT = 0;
    } else if (moved > 0.6) e.stuckN = 0;
    e.stkT = 0; e.stkMv = 0; e.stkX = e.x; e.stkZ = e.z;
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
    let d = itemDmg(p.wpn) * (1 + 0.06 * (p.lvl - 1)) * dmgBoostMult(p.boosts) * (p.buffs.rage > 0 ? 1.5 : 1);
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
    if (e.cc & 1 && champHas(e.cc, 'iron')) amt *= 0.65; // Ironhide champion
    amt = Math.max(1, Math.round(amt));
    e.hp -= amt; e.flash = 0.12;
    if (!e.d.prop) ev('dmg', r1(e.x), r1(e.z), amt, opt.crit ? 1 : 0);
    if (!e.awake) wake(e);
    if (opt.kb && e.type !== 'boss' && !e.d.prop && !e.d.still) {
      const k = opt.kb / (e.cc & 1 ? 5 : e.type === 'brute' || e.elite ? 2.5 : 1);
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
    amt = Math.round(amt * scaleDmg(S.floor) * (p.buffs.iron > 0 ? 0.5 : 1));
    p.hp -= amt; p.hurtT = 0.25;
    ev('hurt', p.id, amt);
    if (p.hp <= 0 && p.ph) { // Phoenix Feather: straight back up (the owner's device uses one up)
      p.ph = 0; p.hp = Math.round(p.maxHp * 0.5); p.inv = 2;
      ev('phoenix', p.id); ev('ring', r1(p.x), r1(p.z), 3, 0xff9a2a); ev('sfx', 'fanfare');
      return;
    }
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
    const xp = Math.round(e.d.xp * (1 + 0.25 * (f - 1)) * (e.cc & 1 ? 12 : e.elite ? 4 : 1) * (e.small ? 0.5 : 1));
    if (Sim.onGrant) for (const p of S.players.values()) Sim.onGrant(p.id, { xp });
    if (e.type === 'egg') return;
    if (e.cc & 1) { champDeath(e); return; }
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
    p.atkT = itemRate(p.wpn) / (p.buffs.swift > 0 ? 1.3 : 1);
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
    // pack aggro: only friends in the same room or that can see the alerted one
    const map = S.map, rm = map.rid[tileOf(map, e.x, e.z)];
    const packs = e.pack ? [e.pack] : [];
    for (const o of S.enemies) {
      if (o.awake || o.d.prop || o.type === 'boss' || Math.hypot(o.x - e.x, o.z - e.z) >= 9) continue;
      const ro = map.rid[tileOf(map, o.x, o.z)];
      if ((rm >= 0 && ro === rm) || seeLine(o.x, o.z, e.x, e.z)) { o.awake = true; if (o.pack) packs.push(o.pack); }
    }
    for (const id of new Set(packs)) packAlert(id); // champion packs: all or nothing
  }
  // a sleeping enemy notices a player it can see (13 units), or one that is right next to it (< 3)
  function noticed(e) {
    for (const p of S.players.values()) {
      if (p.downed) continue;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < 3 || (d < 13 && seeLine(e.x, e.z, p.x, p.z))) return true;
    }
    return false;
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
    const m = spd * dt * (e.slow > 0 ? 0.5 : 1), r = e.r * 0.9;
    const x0 = e.x, z0 = e.z;
    const hit = moveCircle(S.map, e, dirx * m, dirz * m, r);
    if (hit && m > 0 && (e.x - x0) ** 2 + (e.z - z0) ** 2 < (m * 0.35) ** 2) {
      // corner sliding: try turning 45° / 90° (keep the side that worked last time)
      const sd = e.slideSide || 1;
      for (const a of [0.785 * sd, -0.785 * sd, 1.4 * sd, -1.4 * sd]) {
        e.x = x0; e.z = z0;
        const c = Math.cos(a), s = Math.sin(a);
        moveCircle(S.map, e, (dirx * c - dirz * s) * m * 0.8, (dirx * s + dirz * c) * m * 0.8, r);
        if ((e.x - x0) ** 2 + (e.z - z0) ** 2 > (m * 0.3) ** 2) { e.slideSide = a > 0 ? 1 : -1; break; }
      }
    }
    if (dirx || dirz) e.f = Math.atan2(dirx, dirz);
  }
  // follow the flow field toward (tx,tz) with the stuck watchdog
  function chase(e, tx, tz, spd, dt) {
    const [fx, fz] = flowDir(e, tx, tz);
    moveEnemy(e, fx, fz, spd, dt);
    if (e.chF !== S.frame - 1) { e.stkX = undefined; }
    e.chF = S.frame;
    stuckCheck(e, dt, fx, fz);
  }
  // cached line-of-sight to the target (re-checked ~10x/s)
  function losTo(e, tp) {
    e.losT = (e.losT || 0) - (S.dt || 0);
    if (e.losT <= 0 || e.losP !== tp.id) { e.losT = 0.1; e.losP = tp.id; e.los = seeLine(e.x, e.z, tp.x, tp.z); }
    return e.los;
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
        for (let i = 0; i < 2; i++) { const s = spawnEnemy('runner', e.x + R.range(-0.8, 0.8), e.z + R.range(-0.8, 0.8)); s.awake = true; if (blockedCircle(S.map, s.x, s.z, s.r)) { s.x = e.x; s.z = e.z; } unstickPos(s); }
      }
      return;
    }
    if (e.unT > 0) e.unT -= dt;
    if (e.stun > 0) { e.stun -= dt; e.st = e.st === 'wind' ? 'chase' : e.st; return; }
    const [tp, dist] = nearestPlayer(e);
    if (!e.awake && e.pack) packIdle(e, dt);
    if (!e.awake) {
      e.wakeT = (e.wakeT || R() * 0.25) - dt;
      if (e.wakeT > 0) return;
      e.wakeT = 0.25;
      if (tp && dist < 13 && noticed(e)) wake(e); else return;
    }
    if (!tp) { e.st = 'idle'; return; }
    if (e.type === 'boss') return updateBoss(e, tp, dist, dt);
    const d = e.d;
    e.cd -= dt;
    const ang = Math.atan2(tp.x - e.x, tp.z - e.z);
    let spd = d.spd * (1 + 0.03 * Math.min(S.floor, 15));
    const champ = e.cc & 1, reach = d.range * (e.reach || 1), cdM = e.cdM || 1;
    if (champ) { champUpdate(e, dist, dt); spd = Math.min(CHAMP_SPD_MAX, spd * e.spdM); }

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
          s.awake = true; s.parent = e.id; if (blockedCircle(S.map, s.x, s.z, s.r)) { s.x = e.x; s.z = e.z + 1.2; } unstickPos(s);
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
      if (dist > 7.5 || !losTo(e, tp)) chase(e, tp.x, tp.z, spd, dt);
      else e.f = ang;
      if (dist < d.range && e.cd <= 0 && losTo(e, tp) && clearLine(e.x, e.z, tp.x, tp.z)) {
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
        e.cd = d.cd * (0.8 + R() * 0.4) * cdM;
        const dm = d.dmg * (e.elite ? 1.6 : 1) * (champ ? CHAMP_DMG : 1);
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
          const off = 1.6 * (e.reach || 1), rad = 2.8 * (champ ? 1.15 : 1);
          const fx = e.x + Math.sin(e.f) * off, fz = e.z + Math.cos(e.f) * off;
          ev('ring', r1(fx), r1(fz), rad, 0xff5030);
          for (const p of S.players.values()) if (Math.hypot(p.x - fx, p.z - fz) < rad) enemyHits(e, p, dm);
        } else {
          for (const p of S.players.values()) {
            const dd = Math.hypot(p.x - e.x, p.z - e.z);
            if (dd < reach * 1.35 + 0.3) enemyHits(e, p, dm);
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
        for (let i = 0; i < 2; i++) { const s = spawnEnemy('grunt', e.x + R.range(-1.5, 1.5), e.z + R.range(-1.5, 1.5)); s.awake = true; if (blockedCircle(S.map, s.x, s.z, s.r)) { s.x = e.x; s.z = e.z; } unstickPos(s); }
      }
    }

    if (d.ranged) {
      const want = e.type === 'caster' ? 8 : e.type === 'bomber' ? 8 : 9;
      const los = dist <= d.range && losTo(e, tp);
      if (dist > d.range || !los) chase(e, tp.x, tp.z, spd, dt);
      else if (dist < want - 3) moveEnemy(e, -Math.sin(ang), -Math.cos(ang), spd * 0.8, dt);
      else e.f = ang;
      if (los && e.cd <= 0) {
        e.st = 'wind'; e.t = d.wind; e.f = ang;
        if (e.type === 'caster' || e.type === 'mage') ev('sfx', 'magic');
        if (e.type === 'bomber') { e.tx = tp.x; e.tz = tp.z; }
      }
    } else {
      const prevF = e.f;
      let mspd = spd;
      if (e.type === 'slime') { e.hop = (e.hop || R() * 6) + dt * 5.5; mspd = spd * (Math.sin(e.hop) > 0 ? 1.7 : 0.15); }
      const near = dist <= reach * 0.85 && losTo(e, tp);
      if (!near) chase(e, tp.x, tp.z, mspd, dt);
      else e.f = ang;
      if (e.type === 'shield') { // turns slowly so you can run around it
        const want = e.f, da = wrapA(want - prevF);
        e.f = prevF + Math.max(-2.4 * dt, Math.min(2.4 * dt, da));
      }
      if (dist <= reach && e.cd <= 0 && (near || losTo(e, tp))) {
        e.st = 'wind'; e.t = d.wind * (e.elite ? 0.85 : champ ? 1.15 : 1); e.f = e.type === 'shield' ? e.f : ang; // champions wind up a bit longer: big hits, clear tell
        if (e.type === 'boomer') ev('sfx', 'fuse');
        if (e.type === 'brute') { const off = 1.6 * (e.reach || 1), fx = e.x + Math.sin(e.f) * off, fz = e.z + Math.cos(e.f) * off; ev('tele', r1(fx), r1(fz), 2.8 * (champ ? 1.15 : 1), e.t); }
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
        if (dist > 4) chase(e, tp.x, tp.z, ENEMIES.boss.spd * (P2 ? 1.3 : 1), dt);
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
              if (blockedCircle(S.map, s.x, s.z, s.r)) { s.x = e.x; s.z = e.z + 3; } unstickPos(s);
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
        e.trapT = 1; dmgEnemy(e, Math.max(8, e.maxHp * (e.cc & 1 ? 0.08 : 0.25)), -1, { noEnch: true, aoe: true });
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
        const n = Math.min(10, Math.round(Math.min(7, 3 + Math.floor(S.floor / 3) + A.wave) * coopN()));
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
    S.time += dt; S.dt = dt; S.frame = (S.frame || 0) + 1;

    // players
    for (const p of S.players.values()) {
      p.atkT -= dt; p.scdT -= dt; p.potT -= dt; p.inv -= dt; p.hurtT -= dt; p.atkAnim -= dt;
      for (const k of BUFF_KEYS) if (p.buffs[k] > 0) p.buffs[k] -= dt;
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
      if (inp.pn !== p.last.pn) { p.last.pn = inp.pn; if (p.potT <= 0) { p.potT = COOLDOWN.potion * 0.95; p.hp = Math.min(p.maxHp, p.hp + p.maxHp * potionHealFrac(p.boosts)); ev('heal', p.id); } }
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
        if (l.dropBy === p.id && l.t < 4) continue; // weapon a player dropped (social.js): not straight back to them
        const d = Math.hypot(p.x - l.x, p.z - l.z);
        if (l.kind === 'coin' && d < 4.5 && d > 0.8) { l.x += (p.x - l.x) / d * 14 * dt; l.z += (p.z - l.z) / d * 14 * dt; }
        if (d < 1.3) {
          if (l.kind === 'heart') { if (p.hp >= p.maxHp) continue; p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.25); ev('heal', p.id); }
          else if (Sim.onGrant) Sim.onGrant(p.id, l.kind === 'item' ? { item: l.item } : { coins: l.v || 1 });
          l.gone = true; ev('pick', p.id, l.kind);
          if (l.dropBy !== undefined && Sim.onDropPick) Sim.onDropPick(p.id, l);
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
      // everyone alive must stand in the portal; then a 5 s countdown runs (anyone stepping out cancels it)
      const near = alive.filter(p => Math.hypot(p.x - S.map.exit.x, p.z - S.map.exit.z) < PORTAL_R).length;
      S.portalNear = near;
      if (near > 0 && near >= alive.length) {
        if (S.portalT <= 0) { S.portalT = PORTAL_T; ev('sfx', 'portal'); }
        S.portalT -= dt;
        if (S.portalT <= 0 && Sim.onExit) { S.portalT = 0; S.portalOpen = false; Sim.onExit(); }
        else if (S.portalT <= 0) S.portalT = 0.001;
      } else S.portalT = 0;
    } else S.portalT = 0;
  }

  // ---------- snapshot for guests ----------
  // Compact, per-guest state message (sent ~20x/s on the unreliable channel; keep it < ~1100 bytes).
  // Positions are quantized to ints (x*QP), angles to ints (rad*QA), velocities to ints (v*QV).
  // Only entities within INTEREST_R of the guest are included (players always), nearest first.
  // Static per-entity data is appended only while the guest may not have it yet:
  //   p: [id, x, z, f, hp, flags(1 downed, 2 attacking, revive*10 << 2 (5 bits), 128 rage, 256 swift, 512 iron), aim]
  //      + [maxHp, wpn, rarity, color, lvl, name, skin]
  //   e: [id, x, z, f, hp%, flags(1 wind, 2 flash, 4 burn, 8 slow, 16 elite, 32 awake)] + [skin index (SKINS), size*20, cc?]
  //      cc (only for champion packs): champion code, see CHAMP_AFFIXES in data.js (name derived from id)
  //   j: [id, x, z] + [kind index (PROJ_KINDS), vx*QV, vz*QV, col]
  //   l: [id, x, z] + [kind, rarity, weapon]
  // g (per-guest net state, optional): { ack, known: Map(key -> first seq it was sent with static) }.
  //   Static is included while known has no entry or entry > ack. The caller records what was sent
  //   via g.inc (all keys) and g.st (keys sent with static) and commits them after sending.
  // view (optional Map id -> {x, z, f}): display positions for players (smoothed remote players).
  const QP = 20, QA = 40, QV = 10, INTEREST_R = 28;
  const qp = v => Math.round(v * QP);
  const qa = v => Math.round(Math.atan2(Math.sin(v), Math.cos(v)) * QA);
  function eflags(e) { return (e.st === 'wind' ? 1 : 0) | (e.flash > 0 ? 2 : 0) | (e.burn > 0 ? 4 : 0) | (e.slow > 0 ? 8 : 0) | (e.elite ? 16 : 0) | (e.awake ? 32 : 0); }
  function playerSig(p) { return [p.maxHp, p.wpn.w, p.wpn.r, p.color, p.lvl, p.name, p.skin || '']; }
  function pflags(p) { let f = (p.downed ? 1 : 0) | (p.atkAnim > 0 ? 2 : 0) | (Math.min(31, Math.round(p.revive * 10)) << 2); BUFF_KEYS.forEach((k, i) => { if (p.buffs[k] > 0) f |= 128 << i; }); return f; }
  function snapshot(forId, g, maxE, maxJ, view) {
    const fp = S.players.get(forId);
    const cx = fp ? fp.x : (S.map ? S.map.start.x : 0), cz = fp ? fp.z : (S.map ? S.map.start.z : 0);
    const R2 = INTEREST_R * INTEREST_R;
    if (g) { g.inc = []; g.st = []; }
    const need = (key, sig) => {
      if (!g) return true;
      g.inc.push(key);
      if (sig !== undefined) { if (g.sig.get(key) !== sig) { g.sig.set(key, sig); g.known.delete(key); } }
      const k = g.known.get(key);
      if (k !== undefined && k <= g.ack) return false;
      g.st.push(key);
      return true;
    };
    const near = (list, max) => {
      const out = [];
      for (const o of list) {
        if (o.hp !== undefined && o.hp <= 0) continue;
        const d = (o.x - cx) * (o.x - cx) + (o.z - cz) * (o.z - cz);
        if (d <= R2) out.push([d, o]);
      }
      out.sort((a, b) => a[0] - b[0]);
      if (max !== undefined && out.length > max) out.length = max;
      return out;
    };
    const ps = [];
    for (const p of S.players.values()) {
      const v = view && view.get(p.id);
      const a = [p.id, qp(v ? v.x : p.x), qp(v ? v.z : p.z), qa(v ? v.f : p.f), Math.round(p.hp), pflags(p), qa(p.aim || p.f)];
      const sig = playerSig(p);
      if (need('p' + p.id, sig.join('|'))) a.push(...sig);
      ps.push(a);
    }
    const es = [];
    for (const [, e] of near(S.enemies, maxE)) {
      const a = [e.id, qp(e.x), qp(e.z), qa(e.f), Math.round(100 * e.hp / e.maxHp), eflags(e)];
      if (need('e' + e.id)) { a.push(e.sk, Math.round(e.size * 20)); if (e.cc) a.push(e.cc); }
      es.push(a);
    }
    const js = [];
    for (const [, p] of near(S.projs, maxJ)) {
      const a = [p.id, qp(p.x), qp(p.z)];
      if (need('j' + p.id)) a.push(PROJ_KINDS.indexOf(p.k), Math.round(p.vx * QV), Math.round(p.vz * QV), p.col || 0);
      js.push(a);
    }
    const ls = [];
    for (const [, l] of near(S.loot.filter(l => l.owner === -1 || l.owner === forId))) {
      const a = [l.id, qp(l.x), qp(l.z)];
      if (need('l' + l.id)) a.push(l.kind, l.item ? l.item.r : 0, l.item ? l.item.w : '');
      ls.push(a);
    }
    let k = 0;
    for (const e of S.enemies) if (!e.d.prop && e.hp > 0) k++;
    return {
      t: 's', fl: S.floor, p: ps, e: es, j: js, l: ls,
      b: S.boss ? [S.boss.name, Math.round(1000 * S.boss.hp / S.boss.maxHp)] : 0,
      po: S.portalOpen ? 1 : 0, pn: S.portalNear || 0, k, pt: portalTenths(),
    };
  }

  // portal countdown for the HUD: tenths of a second left (0 = not counting)
  function portalTenths() { return S.portalOpen && S.portalT > 0 ? Math.max(1, Math.ceil(S.portalT * 10)) : 0; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }

  return {
    S, addPlayer, removePlayer, setStats, setInput, startFloor, update, snapshot, nearestEnemy, eflags, QP, QA, QV,
    buff, pflags, portalTenths, PORTAL_R, PORTAL_T,
    __spawn: spawnEnemy, __dmg: dmgEnemy, __pack: spawnPack, // test hooks
    onGrant: null, onExit: null, onWipe: null, onEvent: null,
  };
})();
