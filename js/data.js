// data.js — constants, RNG, weapons, enchantments, enemies, themes, item generation
'use strict';

const TILE = 2;

function RNG(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.chance = p => f() < p;
  f.range = (lo, hi) => lo + f() * (hi - lo);
  return f;
}
// gameplay randomness (not synced)
const R = RNG((Date.now() ^ (Math.random() * 1e9)) >>> 0);

const RAR = [
  { n: 'Common',    c: '#dcdcdc', hex: 0xdcdcdc, m: 1.0 },
  { n: 'Rare',      c: '#4aa8ff', hex: 0x4aa8ff, m: 1.35 },
  { n: 'Epic',      c: '#c65cff', hex: 0xc65cff, m: 1.8 },
  { n: 'Legendary', c: '#ffb300', hex: 0xffb300, m: 2.4 },
];

const WEAPONS = {
  sword:   { name: 'Sword',   icon: '⚔️', kind: 'melee',  dmg: 12, rate: 0.40, range: 3.0, arc: 2.1, kb: 4,  special: 'spin',   sname: 'Whirlwind',  sicon: '🌀', scd: 5 },
  hammer:  { name: 'Hammer',  icon: '🔨', kind: 'melee',  dmg: 28, rate: 0.85, range: 3.4, arc: 2.5, kb: 9,  special: 'slam',   sname: 'Earthquake', sicon: '💫', scd: 7 },
  daggers: { name: 'Daggers', icon: '🗡️', kind: 'melee',  dmg: 6,  rate: 0.19, range: 2.5, arc: 1.8, kb: 1.5, special: 'dash', sname: 'Shadow Dash', sicon: '🌪️', scd: 4 },
  bow:     { name: 'Bow',     icon: '🏹', kind: 'ranged', dmg: 10, rate: 0.42, speed: 32, special: 'volley', sname: 'Arrow Storm', sicon: '🎆', scd: 5 },
  staff:   { name: 'Staff',   icon: '🪄', kind: 'magic',  dmg: 16, rate: 0.62, speed: 20, splash: 2.2, special: 'nova', sname: 'Meteor', sicon: '☄️', scd: 7 },
};
const WEAPON_KEYS = Object.keys(WEAPONS);

const ENCH = {
  fire:  { icon: '🔥', adj: 'Blazing',   desc: 'Sets enemies on fire' },
  ice:   { icon: '❄️', adj: 'Frozen',    desc: 'Slows enemies' },
  zap:   { icon: '⚡', adj: 'Thunder',   desc: 'Lightning jumps to 2 more enemies' },
  leech: { icon: '❤️', adj: 'Vampire',   desc: 'Heals you when you hit' },
  boom:  { icon: '💥', adj: 'Exploding', desc: 'Enemies explode when they die' },
  crit:  { icon: '🎯', adj: 'Deadly',    desc: 'More critical hits' },
  swift: { icon: '💨', adj: 'Swift',     desc: 'Attacks 25% faster' },
};
const ENCH_KEYS = Object.keys(ENCH);

const LEGEND_NAMES = {
  sword:   ['Sunfire Blade', 'Pharaoh\'s Fang', 'Dragonbone Sword', 'Starsplitter'],
  hammer:  ['Mountain Breaker', 'Thunder Maul', 'Titan Fist', 'Quake Bringer'],
  daggers: ['Twin Vipers', 'Shadow Claws', 'Desert Wind', 'Scorpion Stingers'],
  bow:     ['Sky Piercer', 'Phoenix Wing', 'Storm Caller', 'Moonstring'],
  staff:   ['Staff of Ra', 'Comet Rod', 'Void Scepter', 'Inferno Wand'],
};

let itemSeq = Math.floor(R() * 1e6);
function makeItem(floor, rar, w) {
  w = w || R.pick(WEAPON_KEYS);
  const nE = [0, 1, 2, 2][rar] + (rar === 3 && R.chance(0.5) ? 1 : 0);
  const e = [];
  while (e.length < nE) { const k = R.pick(ENCH_KEYS); if (!e.includes(k)) e.push(k); }
  let n;
  if (rar === 3) n = R.pick(LEGEND_NAMES[w]);
  else n = (e.length ? ENCH[e[0]].adj + ' ' : (rar === 0 ? R.pick(['Old ', 'Rusty ', 'Simple ', '']) : '')) + WEAPONS[w].name;
  return { id: (++itemSeq).toString(36) + R.int(10, 99), w, r: rar, p: Math.max(1, floor | 0), e, n };
}
function itemDmg(it) { return WEAPONS[it.w].dmg * RAR[it.r].m * (1 + 0.22 * (it.p - 1)); }
function itemRate(it) { return WEAPONS[it.w].rate * (it.e.includes('swift') ? 0.75 : 1); }
function itemDps(it) { return itemDmg(it) / itemRate(it); }
function itemPower(it) { return Math.round(itemDps(it)); }
function rollRarity(bonus) {
  const x = R() + (bonus || 0);
  return x > 0.985 ? 3 : x > 0.9 ? 2 : x > 0.62 ? 1 : 0;
}

function xpForLevel(l) { return Math.floor(40 * Math.pow(l, 1.45)); }
function maxHpFor(l) { return 100 + 12 * (l - 1); }

// enemy archetypes (base stats, scaled by floor)
const ENEMIES = {
  grunt:  { hp: 30,  spd: 3.4, dmg: 8,  range: 1.7, cd: 1.1, wind: 0.38, xp: 6,  r: 0.5,  w: 40 },
  runner: { hp: 16,  spd: 6.0, dmg: 5,  range: 1.4, cd: 0.8, wind: 0.22, xp: 5,  r: 0.45, w: 22 },
  archer: { hp: 22,  spd: 2.8, dmg: 7,  range: 11,  cd: 1.9, wind: 0.5,  xp: 8,  r: 0.5,  w: 15, ranged: true, minF: 1 },
  boomer: { hp: 20,  spd: 4.3, dmg: 26, range: 2.2, cd: 99,  wind: 1.0,  xp: 7,  r: 0.5,  w: 10, minF: 2 },
  brute:  { hp: 140, spd: 2.3, dmg: 18, range: 2.6, cd: 1.8, wind: 0.75, xp: 25, r: 0.95, w: 8,  minF: 2 },
  caster: { hp: 55,  spd: 2.5, dmg: 9,  range: 10,  cd: 2.4, wind: 0.6,  xp: 18, r: 0.5,  w: 7,  ranged: true, minF: 4 },
  chest:  { hp: 1,   spd: 0,   dmg: 0,  range: 0,   cd: 99,  wind: 0,    xp: 0,  r: 0.7,  prop: true },
  pot:    { hp: 1,   spd: 0,   dmg: 0,  range: 0,   cd: 99,  wind: 0,    xp: 0,  r: 0.4,  prop: true },
  boss:   { hp: 1000, spd: 2.4, dmg: 30, range: 0,  cd: 0,   wind: 0,    xp: 200, r: 1.9 },
};
const MOB_KEYS = ['grunt', 'runner', 'archer', 'boomer', 'brute', 'caster'];

const SKINS = ['mummy', 'skeleton', 'zombie', 'skelArcher', 'scorpion', 'spider', 'imp', 'golem', 'cube', 'priest', 'necro', 'boss', 'chest', 'pot'];

const THEMES = [
  {
    name: 'Desert Tomb', floor: 0xd8b878, floor2: 0xc9a663, wall: 0xa7814b, top: 0xe3c890, voidc: 0x2b1d10, hemi: 0xfff0cc, ground: 0x6b4a22,
    mobs: { grunt: 'mummy', runner: 'scorpion', archer: 'skelArcher', boomer: 'cube', brute: 'golem', caster: 'priest' },
    golem: 0xc9a25e, cube: 0x7cc242, bone: 0xf1e6c8, accent: 0x2f6fd6, deco: 'desert',
    boss: { name: 'The Sand Pharaoh', body: 0xe0b44a, accent: 0x2457c5, skin: 0x9a6b3a, eye: 0x3dffd0 },
  },
  {
    name: 'Bone Crypt', floor: 0x6d6f78, floor2: 0x5e6069, wall: 0x45474f, top: 0x7b7e88, voidc: 0x0d0e14, hemi: 0xc9d6ff, ground: 0x22242c,
    mobs: { grunt: 'skeleton', runner: 'spider', archer: 'skelArcher', boomer: 'cube', brute: 'golem', caster: 'necro' },
    golem: 0x7d8088, cube: 0x58c43a, bone: 0xe9e9e0, accent: 0x7a3cc2, deco: 'crypt',
    boss: { name: 'The Skeleton King', body: 0xe8e6da, accent: 0x7a1fc2, skin: 0xe8e6da, eye: 0xff2a2a },
  },
  {
    name: 'Lava Forge', floor: 0x4a3530, floor2: 0x3d2b27, wall: 0x2d1f1c, top: 0x5e413a, voidc: 0x120604, hemi: 0xffc8a0, ground: 0x401010,
    mobs: { grunt: 'zombie', runner: 'imp', archer: 'skelArcher', boomer: 'cube', brute: 'golem', caster: 'necro' },
    golem: 0x3a2a26, cube: 0xff6a1a, bone: 0x3b3433, accent: 0xff4a10, deco: 'lava',
    boss: { name: 'The Magma Titan', body: 0x2e2421, accent: 0xff5a00, skin: 0x2e2421, eye: 0xffd000 },
  },
  {
    name: 'Frost Caverns', floor: 0xb9d4e6, floor2: 0xa7c4d9, wall: 0x7ea3c0, top: 0xdcefff, voidc: 0x0b1626, hemi: 0xe6f4ff, ground: 0x3a5c7a,
    mobs: { grunt: 'zombie', runner: 'spider', archer: 'skelArcher', boomer: 'cube', brute: 'golem', caster: 'necro' },
    golem: 0x9fd0ef, cube: 0x4fe0ff, bone: 0xdff3ff, accent: 0x2aa3ff, deco: 'ice',
    boss: { name: 'The Frost Giant', body: 0x8fc4e8, accent: 0xffffff, skin: 0x8fc4e8, eye: 0x00e5ff },
  },
];
function themeFor(floor) { return THEMES[Math.floor((floor - 1) / 3) % THEMES.length]; }
function isBossFloor(floor) { return floor % 3 === 0; }

const PLAYER_COLORS = ['#3d8bff', '#ff4d4d', '#3ddc6a', '#ffcc33', '#b366ff', '#ff8a3d'];

const COOLDOWN = { potion: 14, dodge: 1.1 };
