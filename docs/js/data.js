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
// rng (optional): a seeded RNG for reproducible items (merchant stock); defaults to gameplay randomness
function makeItem(floor, rar, w, rng) {
  const Q = rng || R;
  w = w || Q.pick(WEAPON_KEYS);
  const nE = [0, 1, 2, 2][rar] + (rar === 3 && Q.chance(0.5) ? 1 : 0);
  const e = [];
  while (e.length < nE) { const k = Q.pick(ENCH_KEYS); if (!e.includes(k)) e.push(k); }
  let n;
  if (rar === 3) n = Q.pick(LEGEND_NAMES[w]);
  else n = (e.length ? ENCH[e[0]].adj + ' ' : (rar === 0 ? Q.pick(['Old ', 'Rusty ', 'Simple ', '']) : '')) + WEAPONS[w].name;
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
  // new archetypes
  slime:   { hp: 40,  spd: 3.0, dmg: 8,  range: 1.6, cd: 1.2, wind: 0.4,  xp: 8,  r: 0.65, w: 12, minF: 1 },  // hops, splits in two when it dies
  charger: { hp: 46,  spd: 3.0, dmg: 15, range: 10,  cd: 3.4, wind: 0.85, xp: 12, r: 0.7,  w: 8,  minF: 2 },  // red line telegraph, then dashes
  shield:  { hp: 60,  spd: 2.6, dmg: 11, range: 1.9, cd: 1.5, wind: 0.55, xp: 14, r: 0.6,  w: 9,  minF: 3 },  // blocks hits from the front
  bomber:  { hp: 26,  spd: 2.9, dmg: 14, range: 11,  cd: 3.0, wind: 0.55, xp: 10, r: 0.5,  w: 8,  minF: 4, ranged: true }, // lobs bombs at a marked spot
  mage:    { hp: 36,  spd: 2.6, dmg: 8,  range: 11,  cd: 2.6, wind: 0.6,  xp: 16, r: 0.5,  w: 6,  minF: 6, ranged: true }, // teleports around, casts orb fans
  totem:   { hp: 80,  spd: 0,   dmg: 0,  range: 0,   cd: 6,   wind: 0,    xp: 20, r: 0.6,  w: 0,  minF: 5, still: true }, // spawner, must be smashed
  egg:     { hp: 26,  spd: 0,   dmg: 0,  range: 0,   cd: 99,  wind: 0,    xp: 2,  r: 0.6,  w: 0,  still: true },  // boss egg sac: hatches spiders
  // props (smashables)
  chest:   { hp: 1,   spd: 0,   dmg: 0,  range: 0,   cd: 99,  wind: 0,    xp: 0,  r: 0.7,  prop: true },
  pot:     { hp: 1,   spd: 0,   dmg: 0,  range: 0,   cd: 99,  wind: 0,    xp: 0,  r: 0.4,  prop: true },
  crate:   { hp: 1,   spd: 0,   dmg: 0,  range: 0,   cd: 99,  wind: 0,    xp: 0,  r: 0.55, prop: true },
  barrel:  { hp: 1,   spd: 0,   dmg: 0,  range: 0,   cd: 99,  wind: 0,    xp: 0,  r: 0.5,  prop: true },
  xbarrel: { hp: 1,   spd: 0,   dmg: 0,  range: 0,   cd: 99,  wind: 0,    xp: 0,  r: 0.5,  prop: true },  // red, explodes after a short fuse
  boss:    { hp: 1000, spd: 2.4, dmg: 30, range: 0,  cd: 0,   wind: 0,    xp: 200, r: 1.9 },
};
const MOB_KEYS = ['grunt', 'runner', 'archer', 'boomer', 'brute', 'caster', 'slime', 'charger', 'shield', 'bomber', 'mage'];
const PROP_TYPES = ['chest', 'pot', 'crate', 'barrel', 'xbarrel'];

// model skin names — the INDEX is sent over the network: only ever append
const SKINS = ['mummy', 'skeleton', 'zombie', 'skelArcher', 'scorpion', 'spider', 'imp', 'golem', 'cube', 'priest', 'necro', 'boss', 'chest', 'pot',
  'crate', 'barrel', 'xbarrel', 'guard', 'bomber', 'slime', 'charger', 'totem', 'mage', 'egg', 'lizard', 'knight', 'shroom', 'pirate', 'crab', 'bat'];
const PROP_SKINS = new Set(PROP_TYPES);
// true for smashable props (no HP bar, low auto-aim priority) — accepts a skin name or index
function isPropSkin(sk) { return PROP_SKINS.has(typeof sk === 'number' ? SKINS[sk] : sk); }

// shared mob skins for the new archetypes (their colors come from the theme)
const NEW_MOBS = { slime: 'slime', charger: 'charger', shield: 'guard', bomber: 'bomber', mage: 'mage', totem: 'totem', egg: 'egg' };

// Worlds. Each world = 3 floors, the 3rd is the boss floor.
//  pit: non-walkable chasm / lava / water look   slow: sticky floor patches (slows everyone)
//  pattern: floor tiles   walls: wall decoration style   traps: which traps appear   light: torch flame color
//  boss.sig: the boss's signature attacks (added to the shared slam/stomp/charge/spray/summon set)
//  gfx (mood, read by applyThemeLighting in core.js; every field optional, see GFX_DEF):
//    exp tone-mapping exposure · hemi ambient fill intensity · sky/gnd ambient sky/ground colours (default
//    hemi/ground) · sun [colour, intensity] · sunDir sun/moon direction (x west-east, y up, z north-south)
//    fog [near, far] · fogc fog / haze colour (default voidc) · bg background (default voidc)
//    mist [density, y fully misty, y mist-free, colour] ground mist pooled in pits and drifting over floors
//    dapple 0..1 leaf-shadow / moonbeam pattern on the sun light, dappleScale its world scale (0.055) · rim [colour, strength, lift] character rim light
//    gl glow-decal gain · amb/ambC ambient particle kind / colour · vig CSS vignette · hero hero light colour
//    heroPool hero light-pool strength
//  look (surface treatment, read by look.js lookOf/buildLevel; every field optional, see LOOK_DEF):
//    floor/corr tile names for rooms / corridors · patch + patchP big blob patches · wall, wallAlt + altP
//    wall sides · top wall tops · cliff pit cliffs · rubble chance of broken wall tops · rubbleT/rubbleC
//    their tile/colour · topVar wall-top height variation · lip + lipP moss overhang colour / chance
//    ao contact-shadow strength · aoR its radius · side side-face brightness · base wall-base darkening
//    bright texture brightness compensation · norot keep floor tiles unrotated · puddle puddle colour
const THEMES = [
  {
    name: 'Desert Tomb', floor: 0xd8b878, floor2: 0xc9a663, wall: 0xa7814b, top: 0xe3c890, voidc: 0x2b1d10, hemi: 0xfff0cc, ground: 0x6b4a22,
    mobs: Object.assign({ grunt: 'mummy', runner: 'scorpion', archer: 'skelArcher', boomer: 'cube', brute: 'golem', caster: 'priest' }, NEW_MOBS),
    golem: 0xc9a25e, cube: 0x7cc242, bone: 0xf1e6c8, accent: 0x2f6fd6, deco: 'desert',
    pit: { c: 0x4a3018, c2: 0x7a5428, glow: 0 }, slow: { c: 0xb8904c, name: 'Quicksand' }, pattern: 'cracks', walls: 'brick', traps: ['spike', 'plate'],
    light: 0xffa31a, carpet: 0x2f6fd6, carpet2: 0xffc72c, slime: 0xe0c060, guard: [0x1a1a1a, 0xffc72c], mage: [0x2457c5, 0xffc72c], totem: 0xc9a25e, charger: 0x2a6a8a,
    // golden hour: low warm sun from the west (long shadows), peach sky fill, amber haze, torch-lit tomb halls
    gfx: { exp: 0.96, gl: 1.2, hemi: 0.5, sky: 0xffcf9a, gnd: 0x4a2a14, sun: [0xffb46a, 1.6], sunDir: [-17, 12, 5], fog: [24, 52], fogc: 0x9a5a2e, bg: 0x2a1408,
      mist: [0.32, -2.2, 0.8, 0xd89a5a], dapple: 0.22, dappleScale: 0.03, amb: 'dust', ambC: 0xffd08a, vig: 'rgba(64,22,0,.5)', rim: [0xffd6a0, 0.5, 0.08], hero: 0xffd8a8, heroPool: 0.26 },
    look: { floor: ['sandstone', 'slab', 'temple', 'slabCrack', 'sandstone'], corr: ['sand', 'cobble', 'sand'], patch: 'sand', patchP: 0.3, wall: 'sandstone', wallAlt: 'templeWall', altP: 0.45,
      top: 'sandTop', rubbleT: 'rubble', rubbleC: 0xd2aa70, cliff: 'sandstone', topVar: 0.4, rubble: 0.24, lip: 0xe6c48a, lipT: 'sand', lipP: 0.4, ao: 0.72, aoR: 0.46, side: 0.84, base: 0.58, bright: 0.98 },
    boss: { name: 'The Sand Pharaoh', kind: 'pharaoh', body: 0xe0b44a, accent: 0x2457c5, skin: 0x9a6b3a, eye: 0x3dffd0, sig: ['spiral', 'spiral', 'raise'] },
  },
  {
    name: 'Bone Crypt', floor: 0x7a7a7e, floor2: 0x67686e, wall: 0x6a6b72, top: 0xa4a5aa, voidc: 0x07090e, hemi: 0xc9d6ff, ground: 0x22242c,
    mobs: Object.assign({ grunt: 'skeleton', runner: 'spider', archer: 'skelArcher', boomer: 'cube', brute: 'golem', caster: 'necro' }, NEW_MOBS),
    golem: 0x7d8088, cube: 0x58c43a, bone: 0xe9e9e0, accent: 0x7a3cc2, deco: 'crypt',
    pit: { c: 0x07060c, c2: 0x3a1a60, glow: 0 }, slow: { c: 0xd8d8e0, name: 'Cobwebs', web: true }, pattern: 'slabs', walls: 'bone', traps: ['spike', 'plate'],
    light: 0x3dffc0, carpet: 0x6a1622, carpet2: 0xa8862a, slime: 0x7dffb0, guard: [0xd8d8d0, 0x7a3cc2], mage: [0x3a1a6a, 0x9a6aff], totem: 0xe9e9e0, charger: 0x55585f,
    // dark & moody: cold blue-grey moonlight from the back-left, teal soul-fire, mist pooled low
    gfx: { exp: 0.92, gl: 1.55, hemi: 0.3, sky: 0x8ea6dc, gnd: 0x10141e, sun: [0xa8c0ff, 0.66], sunDir: [-13, 19, -5], dapple: 0.7, dappleScale: 0.022, fog: [21, 46], fogc: 0x0c121c, bg: 0x06080d,
      mist: [0.62, -2.6, 0.95, 0x8299c0], amb: 'wisp', ambC: 0x7dffd8, vig: 'rgba(0,6,22,.62)', rim: [0x9ab8ff, 0.6, 0.1], hero: 0xffe2bc, heroPool: 0.34 },
    look: { floor: ['slab', 'slab', 'slabCrack', 'bones'], corr: ['cobble', 'cobble', 'slabCrack'], wall: 'brick', wallAlt: 'cryptWall', altP: 0.22, top: 'boneTop', rubbleT: 'rubble',
      rubbleC: 0xd6d2c2, cliff: 'rock', topVar: 0.4, rubble: 0.28, ao: 0.75, aoR: 0.45, bright: 1.12, puddle: 0x1c2638 },
    boss: { name: 'The Skeleton King', kind: 'skelking', body: 0xe8e6da, accent: 0x7a1fc2, skin: 0xe8e6da, eye: 0xff2a2a, sig: ['bonewall', 'bonewall', 'raise'] },
  },
  {
    name: 'Jungle Temple', floor: 0x9a9070, floor2: 0x7c7c5e, wall: 0x7c7e66, top: 0x8e9a72, voidc: 0x07120b, hemi: 0xeaffd8, ground: 0x24401a,
    mobs: Object.assign({ grunt: 'lizard', runner: 'spider', archer: 'skelArcher', boomer: 'cube', brute: 'golem', caster: 'necro' }, NEW_MOBS),
    golem: 0x6f8060, cube: 0x3fbf3a, bone: 0xe0dcc0, accent: 0x1f9a5a, deco: 'jungle',
    pit: { c: 0x1a4a44, c2: 0x2f7a6a, glow: 0 }, slow: { c: 0x5a4126, name: 'Mud' }, pattern: 'moss', walls: 'vine', traps: ['plate', 'spike'],
    light: 0xffb63a, carpet: 0x8a5a2a, carpet2: 0xd0a040, slime: 0x6ad83a, guard: [0x3a8a3a, 0xd0a040], mage: [0x1f6a3a, 0xff7a2a], totem: 0x9a6a3a, charger: 0x6a4a2a,
    // dark & moody: warm sun flecks through the canopy, teal shadows, humid haze, warm braziers
    gfx: { exp: 0.92, gl: 1.4, hemi: 0.38, sky: 0x6fae9c, gnd: 0x142218, sun: [0xffd890, 1.3], sunDir: [-11, 21, 6], dapple: 0.9, fog: [21, 47], fogc: 0x0f2219, bg: 0x06100a,
      mist: [0.42, -2.0, 0.9, 0x7aa08a], amb: 'leaf', vig: 'rgba(0,16,6,.56)', rim: [0xffe6b8, 0.55, 0.1], heroPool: 0.26 },
    look: { floor: ['slab', 'temple', 'slabCrack', 'slab', 'temple'], corr: ['dirt', 'roots', 'dirt'], patch: 'mossFloor', patchP: 0.38, wall: 'templeWall', wallAlt: 'vineWall', altP: 0.5,
      top: 'grassTop', rubbleT: 'rubble', rubbleC: 0x8a8a70, cliff: 'rock', topVar: 0.45, rubble: 0.22, lip: 0x4a7a30, lipP: 0.55, ao: 0.72, aoR: 0.45, bright: 1.1, puddle: 0x16302c },
    boss: { name: 'The Spider Queen', kind: 'spider', body: 0x2a2030, accent: 0xc02060, skin: 0x2a2030, eye: 0xff3070, sig: ['eggs', 'leap', 'leap'] },
  },
  {
    name: 'Lava Forge', floor: 0x4a3530, floor2: 0x3d2b27, wall: 0x2d1f1c, top: 0x5e413a, voidc: 0x120604, hemi: 0xffc8a0, ground: 0x401010,
    mobs: Object.assign({ grunt: 'zombie', runner: 'imp', archer: 'skelArcher', boomer: 'cube', brute: 'golem', caster: 'necro' }, NEW_MOBS),
    golem: 0x3a2a26, cube: 0xff6a1a, bone: 0x3b3433, accent: 0xff4a10, deco: 'lava',
    pit: { c: 0xff4a00, c2: 0xffa000, glow: 1 }, slow: { c: 0x2a2220, name: 'Ash' }, pattern: 'basalt', walls: 'basalt', traps: ['vent', 'spike'],
    light: 0xff7a1a, carpet: 0x5a1a10, carpet2: 0xff7a1a, slime: 0xff5a1a, guard: [0x3a3a40, 0xff6a00], mage: [0x6a1a10, 0xffb000], totem: 0x2a2020, charger: 0x6a2a1a,
    // dark & moody: black basalt, the light comes from below (magma, cracks, forges), smoke haze, rising embers
    gfx: { exp: 1.0, gl: 1.6, hemi: 0.3, sky: 0x8a6a64, gnd: 0x2a0c04, sun: [0xff9a62, 0.62], sunDir: [-12, 20, 3], fog: [20, 46], fogc: 0x1c0a06, bg: 0x0a0302,
      mist: [0.42, -1.6, 0.85, 0x3a1a12], amb: 'ember', ambC: 0xff8a2a, vig: 'rgba(30,4,0,.6)', rim: [0xffa060, 0.7, 0.12], hero: 0xffc890, heroPool: 0.34 },
    look: { floor: ['basalt', 'basalt', 'cobble', 'slabCrack'], corr: ['basalt', 'rubble', 'cobble'], patch: 'rubble', patchP: 0.22, wall: 'rock', wallAlt: 'basalt', altP: 0.4, top: 'rubble',
      rubbleT: 'basalt', rubbleC: 0x3a2c28, cliff: 'basalt', topVar: 0.45, rubble: 0.3, ao: 0.8, aoR: 0.5, side: 0.8, base: 0.5, bright: 0.92 },
    boss: { name: 'The Magma Titan', kind: 'titan', body: 0x2e2421, accent: 0xff5a00, skin: 0x2e2421, eye: 0xffd000, sig: ['meteors', 'shock', 'shock'] },
  },
  {
    name: 'Frost Caverns', floor: 0xb9d4e6, floor2: 0xa7c4d9, wall: 0x7ea3c0, top: 0xdcefff, voidc: 0x0b1626, hemi: 0xe6f4ff, ground: 0x3a5c7a,
    mobs: Object.assign({ grunt: 'zombie', runner: 'spider', archer: 'skelArcher', boomer: 'cube', brute: 'golem', caster: 'necro' }, NEW_MOBS),
    golem: 0x9fd0ef, cube: 0x4fe0ff, bone: 0xdff3ff, accent: 0x2aa3ff, deco: 'ice',
    pit: { c: 0x0e3a66, c2: 0x2a6aa0, glow: 0 }, slow: { c: 0xf4fbff, name: 'Deep Snow' }, pattern: 'ice', walls: 'crystal', traps: ['spike', 'vent'],
    light: 0x7fe8ff, carpet: 0x2a5a9a, carpet2: 0xdff3ff, slime: 0x8fe8ff, guard: [0x5a8ab0, 0xdff3ff], mage: [0x2a6ab0, 0xffffff], totem: 0x9fe6ff, charger: 0x7a6a5a,
    // moonlit night: cold blue moonlight from the back-left, deep blue shadows, glowing cyan crystals, cold mist, snow
    gfx: { exp: 0.92, gl: 1.5, hemi: 0.3, sky: 0x7898d0, gnd: 0x0a1426, sun: [0xa8c4ff, 0.8], sunDir: [-11, 20, -6], dapple: 0.3, dappleScale: 0.026, fog: [22, 48], fogc: 0x0e1c34, bg: 0x050b18,
      mist: [0.46, -2.2, 0.9, 0x7a9ccc], amb: 'snow', ambC: 0xe0f0ff, vig: 'rgba(0,8,30,.6)', rim: [0x9ad8ff, 0.62, 0.1], hero: 0xffe2c0, heroPool: 0.32 },
    look: { floor: ['ice', 'slab', 'ice', 'slabCrack'], corr: ['ice', 'cobble', 'ice'], patch: 'sand', patchP: 0.32, wall: 'iceWall', wallAlt: 'rock', altP: 0.3, top: 'sandTop',
      rubbleT: 'ice', rubbleC: 0xcfe6ff, cliff: 'iceWall', topVar: 0.4, rubble: 0.24, lip: 0xeef6ff, lipT: 'sand', lipP: 0.5, ao: 0.72, aoR: 0.46, side: 0.8, base: 0.55, bright: 0.8 },
    boss: { name: 'The Frost Giant', kind: 'giant', body: 0x8fc4e8, accent: 0xffffff, skin: 0x8fc4e8, eye: 0x00e5ff, sig: ['icicles', 'icicles', 'avalanche'] },
  },
  {
    name: 'Sky Castle', floor: 0xe6e2ee, floor2: 0xd3cde0, wall: 0xa9a2bd, top: 0xf6f3ff, voidc: 0x5d9be0, hemi: 0xffffff, ground: 0x8fb4e0,
    mobs: Object.assign({ grunt: 'knight', runner: 'bat', archer: 'skelArcher', boomer: 'cube', brute: 'golem', caster: 'necro' }, NEW_MOBS),
    golem: 0xd8d4e4, cube: 0x8fd0ff, bone: 0xf0f0f0, accent: 0x2a5ad0, deco: 'sky',
    pit: { c: 0x6aaaf0, c2: 0xffffff, glow: 0, sky: true }, slow: { c: 0xffffff, name: 'Cloud Fluff' }, pattern: 'marble', walls: 'banner', traps: ['vent', 'plate'],
    light: 0xfff07a, carpet: 0x2a4ac0, carpet2: 0xffc72c, slime: 0xc8e8ff, guard: [0xc0c8d8, 0xffc72c], mage: [0x2a4ac0, 0xffe14a], totem: 0xe6e2ee, charger: 0x8a7ad0,
    gfx: { exp: 0.7, gl: 0.35, hemi: 0.8, sun: [0xfff4dc, 1.05], fog: [32, 64], amb: 'cloud', vig: 'rgba(20,40,90,.32)' },
    boss: { name: 'The Storm Dragon', kind: 'dragon', body: 0x3a5cc8, accent: 0xffe14a, skin: 0x3a5cc8, eye: 0xffffff, sig: ['lightning', 'lightning', 'breath'] },
  },
  {
    name: 'Mushroom Caves', floor: 0x544766, floor2: 0x4a3e5b, wall: 0x332a45, top: 0x63527c, voidc: 0x0a0612, hemi: 0xe6d0ff, ground: 0x1d1233,
    mobs: Object.assign({ grunt: 'shroom', runner: 'spider', archer: 'skelArcher', boomer: 'cube', brute: 'golem', caster: 'necro' }, NEW_MOBS),
    golem: 0x6a5a80, cube: 0xd05aff, bone: 0xe8e0f0, accent: 0x3affc0, deco: 'mushroom',
    pit: { c: 0x2adf5a, c2: 0x9aff3a, glow: 1 }, slow: { c: 0x8a3ac0, name: 'Goo' }, pattern: 'moss', walls: 'glow', traps: ['vent', 'spike'],
    light: 0x5affd0, carpet: 0x6a2a8a, carpet2: 0x3affc0, slime: 0xd05aff, guard: [0x6a4a8a, 0x3affc0], mage: [0x5a1a8a, 0x3affc0], totem: 0xd02a3a, charger: 0x4a3a6a,
    gfx: { exp: 1.15, gl: 1, hemi: 0.7, sun: [0xd8b0ff, 0.75], fog: [24, 48], amb: 'spore', vig: 'rgba(20,0,36,.6)', hero: 0xf0d8ff },
    boss: { name: 'The Mushroom King', kind: 'mushroom', body: 0xd8243a, accent: 0xffffff, skin: 0xf0e0c0, eye: 0x222222, sig: ['spores', 'spores', 'bounce'] },
  },
  {
    name: 'Pirate Cove', floor: 0xa47444, floor2: 0x93663a, wall: 0x5c534a, top: 0x7d7468, voidc: 0x06202a, hemi: 0xfff0d8, ground: 0x1a3a4a,
    mobs: Object.assign({ grunt: 'pirate', runner: 'crab', archer: 'skelArcher', boomer: 'cube', brute: 'golem', caster: 'necro' }, NEW_MOBS),
    golem: 0xc07a6a, cube: 0x3a3a3a, bone: 0xe8e6da, accent: 0xc0302a, deco: 'pirate',
    pit: { c: 0x135a7a, c2: 0x3aa0c0, glow: 0 }, slow: { c: 0x4a6a3a, name: 'Seaweed' }, pattern: 'planks', walls: 'cave', traps: ['plate', 'spike'],
    light: 0xffb040, carpet: 0xa0201a, carpet2: 0xffc72c, slime: 0x3ac0b0, guard: [0x2a2a3a, 0xc0302a], mage: [0x1a4a6a, 0x3dffd0], totem: 0x8a5a2a, charger: 0x3a6a8a,
    gfx: { exp: 1, gl: 0.85, hemi: 0.72, sun: [0xffe0b0, 1.0], fog: [25, 52], amb: 'mist', vig: 'rgba(0,20,32,.5)' },
    boss: { name: 'Captain Bonebeard', kind: 'captain', body: 0x2a2a3a, accent: 0xc0302a, skin: 0xe8e6da, eye: 0x3dffd0, sig: ['cannons', 'cannons', 'anchor'] },
  },
];
function themeFor(floor) { return THEMES[Math.floor((floor - 1) / 3) % THEMES.length]; }
function isBossFloor(floor) { return floor % 3 === 0; }
// how many times the player has looped through all worlds (for harder scaling)
function worldLoop(floor) { return Math.floor((floor - 1) / (3 * THEMES.length)); }

const PLAYER_COLORS = ['#3d8bff', '#ff4d4d', '#3ddc6a', '#ffcc33', '#b366ff', '#ff8a3d'];

const COOLDOWN = { potion: 14, dodge: 1.1 };

// ---------- merchant: permanent hero boosts, potions, hero skins ----------
// boosts: rank 0..max. cost[rank] = price of the NEXT rank. Effects are applied by the host (hp, pot, dmg)
// and by the player's own device (roll).
const BOOSTS = {
  hp:   { icon: '❤️', name: 'Tough Heart',  desc: 'More max health',        per: 0.08, unit: '% max HP',      max: 5, cost: [150, 300, 500, 800, 1200] },
  dmg:  { icon: '⚔️', name: 'Warrior Might', desc: 'Hit harder with everything', per: 0.06, unit: '% damage',  max: 5, cost: [200, 400, 650, 1000, 1500] },
  pot:  { icon: '🧪', name: 'Big Gulp',      desc: 'Heal potion heals more',  per: 0.10, unit: '% potion heal', max: 4, cost: [120, 250, 450, 700] },
  roll: { icon: '💨', name: 'Quick Feet',    desc: 'Roll comes back faster',  per: 0.15, unit: 's roll cooldown', max: 3, cost: [150, 350, 650] },
};
const BOOST_KEYS = Object.keys(BOOSTS);
function boostRank(b, k) { return Math.max(0, Math.min(BOOSTS[k].max, (b && b[k]) | 0)); }
function hpBoostMult(b) { return 1 + BOOSTS.hp.per * boostRank(b, 'hp'); }
function dmgBoostMult(b) { return 1 + BOOSTS.dmg.per * boostRank(b, 'dmg'); }
function potionHealFrac(b) { return 0.6 + BOOSTS.pot.per * boostRank(b, 'pot'); }
function rollCooldown(b) { return COOLDOWN.dodge - BOOSTS.roll.per * boostRank(b, 'roll'); }

// battle potions (carried in the Profile, max 3 each). Timed ones are applied by the host for `dur` s.
const POTIONS = {
  rage:    { icon: '😡', name: 'Rage Potion',     desc: '+50% damage for 20 seconds',              dur: 20, color: '#ff4a3a', hex: 0xff4a3a, cost: 60 },
  swift:   { icon: '⚡', name: 'Swiftness Potion', desc: '+30% move & attack speed for 20 seconds', dur: 20, color: '#ffe14a', hex: 0xffe14a, cost: 50 },
  iron:    { icon: '🛡️', name: 'Iron Skin Potion', desc: 'Take half damage for 20 seconds',         dur: 20, color: '#9ab8d8', hex: 0x9ab8d8, cost: 60 },
  phoenix: { icon: '🪶', name: 'Phoenix Feather',  desc: 'Works by itself: when you fall, you jump right back up!', dur: 0, color: '#ff9a2a', hex: 0xff9a2a, cost: 150, passive: true },
};
const POTION_KEYS = Object.keys(POTIONS);
const BUFF_KEYS = ['rage', 'swift', 'iron'];   // bit order in the player snapshot flags
const POTION_MAX = 3;

// cosmetic hero outfits (built in models.js). id '' = classic hero.
const HERO_SKINS = [
  { id: '',         icon: '🙂', name: 'Classic Hero', cost: 0,    desc: 'The hero who started it all' },
  { id: 'explorer', icon: '🤠', name: 'Explorer',     cost: 250,  desc: 'Safari hat and a trusty backpack' },
  { id: 'ninja',    icon: '🥷', name: 'Ninja',        cost: 400,  desc: 'Silent mask and a flowing headband' },
  { id: 'pirate',   icon: '🏴‍☠️', name: 'Pirate',       cost: 400,  desc: 'Tricorn hat, eyepatch, arrr!' },
  { id: 'knight',   icon: '🛡️', name: 'Knight',       cost: 600,  desc: 'Shiny helmet and plate armor' },
  { id: 'wizard',   icon: '🧙', name: 'Wizard',       cost: 600,  desc: 'Starry pointy hat and robe' },
  { id: 'pharaoh',  icon: '👑', name: 'Pharaoh',      cost: 900,  desc: 'Royal striped headdress of gold' },
  { id: 'robot',    icon: '🤖', name: 'Robot',        cost: 900,  desc: 'Beep boop! Glowing visor & antenna' },
  { id: 'golden',   icon: '🌟', name: 'Golden King',  cost: 2500, desc: 'Solid gold armor and a crown. Legendary!' },
];
function heroSkin(id) { return HERO_SKINS.find(s => s.id === id) || HERO_SKINS[0]; }
// merchant floors: the first floor of every world (right after a boss) + floor 1
function hasMerchant(floor) { return !isBossFloor(floor) && (floor === 1 || floor % 3 === 1); }
