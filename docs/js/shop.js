// shop.js — the travelling merchant (first floor of every world + floor 1): stall prompt, shop panel
// (weapons, mystery crates, hero boosts, enchant reroll, battle potions, hero skins), the battle-potion
// quick-use button and buff timers.
// Shopping is device-local: every player spends their OWN coins into their OWN Profile (no host
// involvement), so the whole family can shop at once. Boosts / skin / phoenix reach the host through
// myStats() -> pushStats(); battle potions are drunk with {t:'buff', k} (host applies them in Sim).
'use strict';

const SHOP_TABS = [
  ['weapons', '⚔️', 'Weapons'], ['crates', '🎁', 'Crates'], ['boosts', '💪', 'Boosts'],
  ['enchant', '✨', 'Enchant'], ['potions', '🧪', 'Potions'], ['skins', '🎩', 'Skins'],
];
// mystery crates: odds per rarity (Common, Rare, Epic, Legendary) in %, price grows with the floor
const CRATES = [
  { id: 'wood', icon: '📦', name: 'Wooden Crate', odds: [45, 40, 13, 2], price: f => 30 + 16 * f, desc: 'A random weapon. Could be anything!' },
  { id: 'gold', icon: '🎁', name: 'Golden Crate', odds: [0, 35, 50, 15], price: f => 90 + 60 * f, desc: 'Always Rare or better. Best Legendary chance!' },
];
const WEAPON_PRICE = [25, 55, 100, 190];   // per weapon level, by rarity (always above salvage value)
const SHOP_NEAR = 4.6;                     // how close to the stall the 🛒 prompt shows

function shopWeaponPrice(it) { return Math.round(WEAPON_PRICE[it.r] * it.p * (it.r === 3 && it.e.length > 2 ? 1.15 : 1)); }
function enchantCost(it) { return Math.round(10 * it.p * (it.r + 1)); }
function shopFloor() { return Math.max(1, G.floor || 1); }
function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const shop = { open: false, tab: 'weapons', sel: 0, encSel: null, encLast: null, paused: false, stockKey: null, stock: [], near: false, preview: null };
try { const t = localStorage.getItem('dd_shoptab'); if (t && SHOP_TABS.some(x => x[0] === t)) shop.tab = t; } catch (e) { }

// ---------- stock: seeded per floor + player, so it doesn't change when reopened ----------
function shopKey() { return G.seed + ':' + G.floor; }
function shopState() {
  const key = shopKey();
  if (!Profile.shop || Profile.shop.key !== key) Profile.shop = { key, sold: [] };
  return Profile.shop;
}
function shopStock() {
  const key = shopKey();
  if (shop.stockKey === key) return shop.stock;
  const rng = RNG(hashStr(key + '|' + (Profile.name || 'hero') + '|' + G.myId));
  const p = shopFloor() + 1;                               // a level ahead of what drops on this floor
  const rars = [1, 2, 2, rng() < 0.5 ? 3 : 2];             // rare, epic, epic, epic-or-legendary
  const kinds = WEAPON_KEYS.slice();
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  // make sure one of them is the weapon type the hero uses now (easy upgrade)
  const cur = equipped().w; if (!kinds.slice(0, 4).includes(cur)) kinds[3] = cur;
  shop.stock = rars.map((r, i) => makeItem(p, r, kinds[i], rng));
  shop.stockKey = key;
  return shop.stock;
}

// ---------- inventory helpers ----------
function shopAddItem(it) {
  Profile.inv.push(it);
  if (Profile.inv.length > 36) { // same rule as loot: auto-salvage the weakest non-equipped item
    const cur = equipped();
    let wi = -1, wp = 1e9;
    Profile.inv.forEach((x, i) => { if (x !== cur && x !== it && itemPower(x) < wp) { wp = itemPower(x); wi = i; } });
    if (wi >= 0) { Profile.coins += salvageValue(Profile.inv[wi]); Profile.inv.splice(wi, 1); Profile.eq = Profile.inv.indexOf(cur); }
  }
}
function spend(cost) {
  if (Profile.coins < cost) { sfx('hurt'); toastShop('🪙 Not enough coins — smash pots, open chests & sell junk!'); return false; }
  Profile.coins -= cost; saveProfile(); sfx('buy'); vibrate(30);
  const c = $('shopCoins'); if (c) replayCls(c, 'bump');
  return true;
}
function toastShop(t) {
  const el = $('shopToast'); if (!el) return;
  el.innerHTML = t; el.classList.remove('hidden'); replayCls(el, 'pop');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hidden'), 2200);
}
function priceTag(cost, extra) { return `<span class="price${Profile.coins < cost ? ' no' : ''}${extra ? ' ' + extra : ''}">🪙${cost}</span>`; }

// ---------- open / close ----------
function shopAvailable() { return !!(G.inGame && G.map && G.map.merchant && !me.downed); }
function openShop() {
  if (!shopAvailable()) return;
  shop.open = true;
  $('shop').classList.remove('hidden');
  $('shopPrompt').classList.add('hidden');
  if (G.role === 'solo' && !G.paused) { G.paused = true; shop.paused = true; }
  shop.encLast = null; shop.sel = 0;
  sfx('chest');
  renderShop();
}
function closeShop() {
  if (!shop.open) return;
  shop.open = false;
  $('shop').classList.add('hidden'); $('crateFx').classList.add('hidden');
  if (shop.paused && $('pause').classList.contains('hidden') && $('inv').classList.contains('hidden')) G.paused = false;
  shop.paused = false;
  saveProfile(); refreshHUDStatic();
}
function shopFloorReset() {
  closeShop();
  shop.stockKey = null; shop.near = false;
  $('shopPrompt').classList.add('hidden');
}

// ---------- rendering ----------
function renderShop() {
  if (!shop.open) return;
  $('shopCoins').textContent = '🪙 ' + Profile.coins;
  const tabs = $('shopTabs'); tabs.innerHTML = '';
  for (const [id, ic, lab] of SHOP_TABS) {
    const b = document.createElement('button');
    b.className = 'stab' + (shop.tab === id ? ' on' : '');
    b.innerHTML = `<span class="ti">${ic}</span><span class="tl">${lab}</span>`;
    b.onclick = () => { if (shop.tab === id) return; shop.tab = id; shop.sel = 0; shop.encLast = null; try { localStorage.setItem('dd_shoptab', id); } catch (e) { } sfx('hit'); renderShop(); };
    tabs.appendChild(b);
  }
  const list = $('shopList'), det = $('shopDetail'), acts = $('shopActs'), hint = $('shopHint');
  list.innerHTML = ''; det.innerHTML = ''; acts.innerHTML = '';
  ({ weapons: tabWeapons, crates: tabCrates, boosts: tabBoosts, enchant: tabEnchant, potions: tabPotions, skins: tabSkins })[shop.tab](list, det, acts);
  // footer: tip + quick "sell junk" so kids can always raise coins here
  const junk = junkList(), jv = junk.reduce((s, it) => s + salvageValue(it), 0);
  hint.innerHTML = `<span class="tip">${SHOP_TIPS[shop.tab]}</span>`;
  if (junk.length) {
    const jb = document.createElement('button'); jb.className = 'big brown sm'; jb.innerHTML = `♻️ Sell ${junk.length} junk <small>+🪙${jv}</small>`;
    jb.onclick = () => armConfirm(jb, `Sure? ♻️<small>tap again → +🪙${jv}</small>`, () => { const g = salvageItems(junk); toastShop('♻️ Sold ' + junk.length + ' weak items: +🪙' + g); updateBagBadge(); renderShop(); });
    hint.appendChild(jb);
  }
}
const SHOP_TIPS = {
  weapons: 'Strong weapons, a level above this floor. <b>▲ green</b> = stronger than yours!',
  crates: 'Open a crate for a surprise weapon. Golden crates are always Rare or better.',
  boosts: 'Boosts are forever — they stay with your hero on every floor.',
  enchant: 'Pick a weapon and roll new magic for it. Same number of enchantments.',
  potions: 'Carry up to 3 of each. Drink them in a fight with the ⚗️ button.',
  skins: 'Outfits are just for looks — your friends see them too!',
};
function mkBtn(acts, cls, html, fn) { const b = document.createElement('button'); b.className = 'big ' + cls; b.innerHTML = html; b.onclick = fn; acts.appendChild(b); return b; }
function grid(list) { const g = document.createElement('div'); g.className = 'sgrid'; list.appendChild(g); return g; }
function tile(g, cls, html, selected, fn, rc) {
  const el = document.createElement('button');
  el.className = cls + (selected ? ' sel' : '');
  if (rc) el.style.setProperty('--rc', rc);
  el.innerHTML = html;
  el.onclick = () => { fn(); sfx('hit'); renderShop(); };
  g.appendChild(el); return el;
}

// ----- weapons -----
function tabWeapons(list, det, acts) {
  const stock = shopStock(), st = shopState(), cur = equipped(), cp = itemPower(cur);
  const g = grid(list);
  stock.forEach((it, i) => {
    const sold = st.sold.includes(i), d = itemPower(it) - cp, cost = shopWeaponPrice(it);
    tile(g, 'it r' + it.r + (sold ? ' sold' : ''), (it.r >= 2 ? `<span class="best">${it.r === 3 ? '★ LEGENDARY' : '◆ EPIC'}</span>` : '') +
      `<span class="dl ${deltaCls(d)}">${d > 0 ? '▲' + d : d < 0 ? '▼' + (-d) : '='}</span><span class="ico">${WEAPONS[it.w].icon}</span><span class="en">${it.e.map(e => ENCH[e].icon).join('')}</span><span class="pw"><small>⚡</small>${itemPower(it)}</span>` +
      (sold ? '<span class="price own">SOLD</span>' : priceTag(cost)), shop.sel === i, () => { shop.sel = i; }, RAR[it.r].c);
  });
  const i = Math.min(shop.sel, stock.length - 1), it = stock[i], sold = st.sold.includes(i);
  det.innerHTML = cmpGrid(it, cur, sold ? 'SOLD' : 'FOR SALE', 'YOURS');
  const cost = shopWeaponPrice(it), d = itemPower(it) - cp;
  if (sold) {
    const mine = Profile.inv.find(x => x.shopKey === shopKey() + ':' + i);
    if (mine && mine !== equipped()) mkBtn(acts, 'green main', `EQUIP<small>⚡ ${cp} → ${itemPower(mine)}</small>`, () => { equipItem(mine); toastShop('✅ Equipped <b>' + esc(mine.n) + '</b>'); renderShop(); });
    else mkBtn(acts, 'gray main off', `✓ BOUGHT<small>${mine === equipped() ? 'You are using it' : 'It is in your bag'}</small>`, () => { });
    return;
  }
  const can = Profile.coins >= cost;
  mkBtn(acts, (can ? (d > 0 ? 'green' : 'blue') : 'off') + ' main', `BUY 🪙${cost}<small>${can ? (d > 0 ? '▲ +' + d + ' Power — an upgrade!' : '▼ weaker than yours') : 'Need 🪙' + (cost - Profile.coins) + ' more'}</small>`, () => {
    if (!spend(cost)) return;
    const n = Object.assign({}, it, { e: it.e.slice(), id: (++itemSeq).toString(36) + R.int(10, 99), shopKey: shopKey() + ':' + i });
    shopAddItem(n); shopState().sold.push(i);
    if (itemPower(n) > itemPower(equipped())) { equipItem(n); toastShop('⚔️ Bought & equipped <b>' + esc(n.n) + '</b>!'); }
    else toastShop('🎒 <b>' + esc(n.n) + '</b> is in your bag');
    saveProfile(); renderShop();
  });
}
// compare grid (same look as the bag): A = shop item, B = equipped
function cmpGrid(A, B, kA, kB) {
  const pool = [A, B];
  const mD = Math.max(...pool.map(itemDmg)), mS = Math.max(...pool.map(itemSpeed)), mP = Math.max(...pool.map(itemSpecial));
  const pa = itemPower(A), pb = itemPower(B), d = pa - pb;
  const powCell = (p, vs, show) => `<div class="cval cpow${p > vs ? ' better' : p < vs ? ' worse' : ''}"><b><small>⚡</small>${p}</b>${show ? `<span class="delta ${deltaCls(show)}">${deltaTxt(show)}</span>` : ''}</div>`;
  return `<div class="cgrid">
    <span></span>${cmpHead(A, kA)}${cmpHead(B, kB)}
    <span class="clab">Power</span>${powCell(pa, pb, d)}${powCell(pb, pa, 0)}
    <span class="clab">Damage</span>${cmpCell(itemDmg(A), itemDmg(B), mD, Math.round(itemDmg(A)))}${cmpCell(itemDmg(B), itemDmg(A), mD, Math.round(itemDmg(B)))}
    <span class="clab">Speed</span>${cmpCell(itemSpeed(A), itemSpeed(B), mS, itemSpeed(A).toFixed(1) + '/s')}${cmpCell(itemSpeed(B), itemSpeed(A), mS, itemSpeed(B).toFixed(1) + '/s')}
    <span class="clab">Special</span>${cmpCell(itemSpecial(A), itemSpecial(B), mP, WEAPONS[A.w].sicon + ' ' + itemSpecial(A))}${cmpCell(itemSpecial(B), itemSpecial(A), mP, WEAPONS[B.w].sicon + ' ' + itemSpecial(B))}
    <span class="clab top">Magic</span><div class="top">${enchChips(A)}</div><div class="top">${enchChips(B)}</div>
  </div>`;
}

// ----- mystery crates -----
function tabCrates(list, det, acts) {
  const f = shopFloor(), g = grid(list);
  CRATES.forEach((c, i) => tile(g, 'sitem crate' + (i ? ' gold' : ''), `<span class="ico">${c.icon}</span><span class="nm">${c.name}</span>` + priceTag(c.price(f)), shop.sel === i, () => { shop.sel = i; }, i ? RAR[3].c : RAR[0].c));
  const c = CRATES[Math.min(shop.sel, CRATES.length - 1)], cost = c.price(f);
  det.innerHTML = `<div class="sdet"><div class="shd"><div class="bigico" style="--rc:${shop.sel ? RAR[3].c : '#c9963c'}">${c.icon}</div><div class="t"><b>${c.name}</b><span>${c.desc}<br>Weapon level: Lv ${f}</span></div></div>
    <div class="odds">${c.odds.map((o, r) => o ? `<span class="rn" style="--rc:${RAR[r].c}">${RAR[r].n}</span><span class="bar" style="--rc:${RAR[r].c}"><i style="width:${Math.max(3, o)}%"></i></span><span class="pc">${o}%</span>` : '').join('')}</div></div>`;
  mkBtn(acts, (Profile.coins >= cost ? 'purple' : 'off') + ' main', `OPEN 🪙${cost}<small>${Profile.coins >= cost ? 'Tap to open — good luck!' : 'Need 🪙' + (cost - Profile.coins) + ' more'}</small>`, () => {
    if (!spend(cost)) return;
    let x = R() * 100, r = 0;
    for (let k = 0; k < 4; k++) { x -= c.odds[k]; if (x < 0) { r = k; break; } r = k; }
    const it = makeItem(f, r);
    shopAddItem(it); saveProfile();
    crateReveal(c, it);
  });
}
// opening animation: the crate shakes, bursts, and the weapon pops out in a ray of its rarity color
function crateReveal(c, it) {
  const fx = $('crateFx'), RR = RAR[it.r], W = WEAPONS[it.w];
  const d = itemPower(it) - itemPower(equipped());
  fx.style.setProperty('--rc', RR.c);
  fx.className = '';
  fx.innerHTML = `<div class="cfx-rays"></div><div class="cfx-crate">${c.icon}</div>
    <div class="cfx-card r${it.r}"><div class="cfx-tag">${it.r === 3 ? '★ LEGENDARY! ★' : it.r === 2 ? '◆ EPIC! ◆' : RR.n.toUpperCase()}</div>
    <div class="cfx-ico">${W.icon}</div><div class="cfx-nm">${esc(it.n)}</div>
    <div class="cfx-sub">⚡ <b>${itemPower(it)}</b> Power ${it.e.map(e => ENCH[e].icon).join('')} <span class="delta ${deltaCls(d)}">${deltaTxt(d)}</span></div>
    <div class="cfx-acts"></div></div>`;
  let n = 0; const shake = setInterval(() => { sfx('shake'); if (++n >= 5) clearInterval(shake); }, 200);
  setTimeout(() => {
    if (!shop.open) return;
    fx.classList.add('open');
    sfx(it.r >= 2 ? 'fanfare' : 'chest'); vibrate(it.r === 3 ? [60, 40, 140] : 60);
    const acts = fx.querySelector('.cfx-acts');
    if (d > 0) mkBtn(acts, 'green sm', 'EQUIP', () => { equipItem(it); fx.classList.add('hidden'); toastShop('✅ Equipped <b>' + esc(it.n) + '</b>'); renderShop(); });
    mkBtn(acts, 'sm', d > 0 ? 'KEEP' : 'OK', () => { fx.classList.add('hidden'); renderShop(); });
  }, 1150);
}

// ----- permanent hero boosts -----
function boostLabel(k, rank) {
  const B = BOOSTS[k];
  if (k === 'roll') return rollCooldown({ roll: rank }).toFixed(2) + 's roll';
  if (k === 'pot') return Math.round(100 * potionHealFrac({ pot: rank })) + '% heal';
  return '+' + Math.round(100 * B.per * rank) + (k === 'hp' ? '% HP' : '% dmg');
}
function tabBoosts(list, det, acts) {
  const g = grid(list), keys = BOOST_KEYS;
  keys.forEach((k, i) => {
    const B = BOOSTS[k], rank = boostRank(Profile.boosts, k), maxed = rank >= B.max;
    tile(g, 'sitem boost', `<span class="ico">${B.icon}</span><span class="nm">${B.name}</span><span class="pips">${'<i class="on"></i>'.repeat(rank)}${'<i></i>'.repeat(B.max - rank)}</span>` + (maxed ? '<span class="price own">MAX</span>' : priceTag(B.cost[rank])), shop.sel === i, () => { shop.sel = i; }, maxed ? RAR[3].c : '#c9963c');
  });
  const k = keys[Math.min(shop.sel, keys.length - 1)], B = BOOSTS[k], rank = boostRank(Profile.boosts, k), maxed = rank >= B.max;
  det.innerHTML = `<div class="sdet"><div class="shd"><div class="bigico">${B.icon}</div><div class="t"><b>${B.name}</b><span>${B.desc}. Lasts forever!</span></div></div>
    <div class="pips big">${'<i class="on"></i>'.repeat(rank)}${'<i></i>'.repeat(B.max - rank)}<span class="rk">Rank ${rank} / ${B.max}</span></div>
    <div class="nownext"><span class="now">${rank ? boostLabel(k, rank) : (k === 'roll' ? COOLDOWN.dodge.toFixed(2) + 's roll' : k === 'pot' ? '60% heal' : 'no boost yet')}</span>${maxed ? '<span class="mx">★ MAXED ★</span>' : `<span class="ar">➜</span><span class="nx">${boostLabel(k, rank + 1)}</span>`}</div></div>`;
  if (maxed) { mkBtn(acts, 'gray main off', '★ MAXED<small>This boost is as strong as it gets</small>', () => { }); return; }
  const cost = B.cost[rank], can = Profile.coins >= cost;
  mkBtn(acts, (can ? 'green' : 'off') + ' main', `BUY RANK ${rank + 1} 🪙${cost}<small>${can ? boostLabel(k, rank + 1) + ' forever' : 'Need 🪙' + (cost - Profile.coins) + ' more'}</small>`, () => {
    if (!spend(cost)) return;
    Profile.boosts[k] = rank + 1; saveProfile(); pushStats();
    toastShop(B.icon + ' <b>' + B.name + '</b> rank ' + (rank + 1) + '!');
    renderShop();
  });
}

// ----- enchant reroll -----
function rerollEnchants(it) {
  const n = Math.max(it.e.length, [0, 1, 2, 2][it.r]);
  const old = it.e.slice();
  let e = [];
  for (let tries = 0; tries < 20; tries++) {
    e = [];
    while (e.length < n) { const k = R.pick(ENCH_KEYS); if (!e.includes(k)) e.push(k); }
    if (e.some(k => !old.includes(k))) break; // at least one new enchantment
  }
  it.e = e;
  if (it.r < 3) it.n = ENCH[e[0]].adj + ' ' + WEAPONS[it.w].name;
  return old;
}
function tabEnchant(list, det, acts) {
  const cand = Profile.inv.filter(it => it.r >= 1).sort((a, b) => itemPower(b) - itemPower(a));
  if (!cand.length) { list.innerHTML = '<div class="empty">You need a Rare or better weapon to enchant. Find one, or buy one!</div>'; det.innerHTML = ''; return; }
  if (!shop.encSel || !cand.includes(shop.encSel)) shop.encSel = cand.includes(equipped()) ? equipped() : cand[0];
  const g = grid(list), cur = equipped();
  for (const it of cand) {
    tile(g, 'it r' + it.r + (it === cur ? ' iseq' : ''), `<span class="ico">${WEAPONS[it.w].icon}</span><span class="en">${it.e.map(e => ENCH[e].icon).join('')}</span><span class="pw"><small>⚡</small>${itemPower(it)}</span>` + (it === cur ? '' : priceTag(enchantCost(it))),
      it === shop.encSel, () => { shop.encSel = it; shop.encLast = null; }, RAR[it.r].c);
  }
  const it = shop.encSel, cost = enchantCost(it), last = shop.encLast && shop.encLast.it === it ? shop.encLast : null;
  const chips = e => e.length ? e.map(k => `<span class="ech">${ENCH[k].icon} ${ENCH_SHORT[k] || ''}</span>`).join('') : '<span class="cnone">No enchant</span>';
  det.innerHTML = `<div class="sdet">${cmpHead(it, it === cur ? 'EQUIPPED' : 'SELECTED')}
    ${last ? `<div class="bfaf"><div class="bf"><span class="lab">BEFORE</span><div class="ench">${chips(last.old)}</div></div><div class="ar">➜</div><div class="af"><span class="lab">AFTER ✨</span><div class="ench">${chips(it.e)}</div></div></div>`
      : `<div class="bfaf one"><span class="lab">MAGIC NOW</span><div class="ench">${chips(it.e)}</div></div>`}
    <div class="desc">${it.e.map(k => '<div>' + ENCH[k].icon + ' <b>' + ENCH[k].adj + '</b> — ' + ENCH[k].desc + '</div>').join('')}</div></div>`;
  const can = Profile.coins >= cost;
  mkBtn(acts, (can ? 'purple' : 'off') + ' main', `✨ REROLL 🪙${cost}<small>${can ? 'New random magic (' + it.e.length + ' enchant' + (it.e.length > 1 ? 's' : '') + ')' : 'Need 🪙' + (cost - Profile.coins) + ' more'}</small>`, () => {
    if (!spend(cost)) return;
    const old = rerollEnchants(it);
    shop.encLast = { it, old };
    saveProfile(); if (it === equipped()) pushStats(); refreshHUDStatic();
    sfx('magic');
    renderShop();
    const af = $('shopDetail').querySelector('.af'); if (af) replayCls(af, 'pop');
  });
}

// ----- battle potions -----
function tabPotions(list, det, acts) {
  const g = grid(list);
  POTION_KEYS.forEach((k, i) => {
    const P = POTIONS[k], n = Profile.pots[k] | 0, full = n >= POTION_MAX;
    tile(g, 'sitem potion', `<span class="cnt">${n}/${POTION_MAX}</span><span class="ico">${P.icon}</span><span class="nm">${P.name}</span>` + (full ? '<span class="price own">FULL</span>' : priceTag(potionCost(k))), shop.sel === i, () => { shop.sel = i; }, P.color);
  });
  const k = POTION_KEYS[Math.min(shop.sel, POTION_KEYS.length - 1)], P = POTIONS[k], n = Profile.pots[k] | 0, cost = potionCost(k);
  det.innerHTML = `<div class="sdet"><div class="shd"><div class="bigico" style="--rc:${P.color}">${P.icon}</div><div class="t"><b>${P.name}</b><span>${P.desc}</span></div></div>
    <div class="have">You carry: ${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(POTION_MAX - n)} <b>${n} / ${POTION_MAX}</b></div>
    <div class="desc">${P.passive ? '🪶 No button needed — if you fall in battle, one feather is used and you stand right back up with half your health.' : '⚗️ Tap the potion button (next to HEAL) during a fight, then pick this potion. Lasts ' + P.dur + ' seconds.'}</div></div>`;
  if (n >= POTION_MAX) { mkBtn(acts, 'gray main off', `BAG FULL<small>You can carry ${POTION_MAX}</small>`, () => { }); return; }
  const can = Profile.coins >= cost;
  mkBtn(acts, (can ? 'green' : 'off') + ' main', `BUY 🪙${cost}<small>${can ? 'You will have ' + (n + 1) + ' / ' + POTION_MAX : 'Need 🪙' + (cost - Profile.coins) + ' more'}</small>`, () => {
    if (!spend(cost)) return;
    Profile.pots[k] = n + 1; saveProfile();
    if (k === 'phoenix') pushStats();
    toastShop(P.icon + ' <b>' + P.name + '</b> ×' + (n + 1));
    updatePotBtn(); renderShop();
  });
}
function potionCost(k) { return Math.round(POTIONS[k].cost * (1 + 0.12 * (shopFloor() - 1))); }

// ----- hero skins -----
function tabSkins(list, det, acts) {
  const g = grid(list), owned = id => !id || Profile.skins.includes(id);
  HERO_SKINS.forEach((sk, i) => {
    const wear = (Profile.skin || '') === sk.id;
    tile(g, 'sitem skin' + (sk.id === 'golden' ? ' gold' : ''), `<span class="ico">${sk.icon}</span><span class="nm">${sk.name}</span>` +
      (wear ? '<span class="price own">WEARING</span>' : owned(sk.id) ? '<span class="price own">OWNED</span>' : priceTag(sk.cost)), shop.sel === i, () => { shop.sel = i; }, sk.id === 'golden' ? RAR[3].c : wear ? '#7dffb0' : '#c9963c');
  });
  const sk = HERO_SKINS[Math.min(shop.sel, HERO_SKINS.length - 1)], wear = (Profile.skin || '') === sk.id;
  det.innerHTML = `<div class="sdet skdet"><canvas class="skprev" id="skPrev" width="240" height="280"></canvas><div class="t"><b>${sk.icon} ${sk.name}</b><span>${sk.desc}</span>
    <span class="own">${wear ? '✓ You are wearing it' : owned(sk.id) ? '✓ Yours — free to wear' : '🪙 ' + sk.cost}</span></div></div>`;
  shop.preview = { skin: sk.id, t: 0, last: -1 };
  if (wear) { mkBtn(acts, 'gray main off', '✓ WEARING<small>Teammates see it too</small>', () => { }); return; }
  if (owned(sk.id)) { mkBtn(acts, 'green main', `WEAR<small>Switch outfit (free)</small>`, () => { setSkin(sk.id); }); return; }
  const can = Profile.coins >= sk.cost;
  mkBtn(acts, (can ? 'green' : 'off') + ' main', `BUY 🪙${sk.cost}<small>${can ? 'And put it on right away' : 'Need 🪙' + (sk.cost - Profile.coins) + ' more'}</small>`, () => {
    if (!spend(sk.cost)) return;
    Profile.skins.push(sk.id); setSkin(sk.id);
  });
}
function setSkin(id) {
  Profile.skin = id; saveProfile(); pushStats();
  toastShop(heroSkin(id).icon + ' Looking good, <b>' + esc(heroSkin(id).name) + '</b>!');
  renderShop();
}
// 3D turntable preview of an outfit (rendered off-screen with the main renderer, ~12 fps)
const skinPv = { scene: null, cam: null, rt: null, mdl: null, key: null, buf: null, img: null };
function drawSkinPreview(dt) {
  const pv = shop.preview, cv = $('skPrev');
  if (!pv || !cv || !shop.open || shop.tab !== 'skins') return;
  pv.t += dt;
  if (pv.last >= 0 && pv.t - pv.last < 0.08) return;
  pv.last = pv.t;
  try {
    const W = cv.width, H = cv.height;
    if (!skinPv.scene) {
      skinPv.scene = new THREE.Scene();
      skinPv.scene.add(new THREE.HemisphereLight(0xfff4dd, 0x5a4026, 1.0));
      const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(2, 4, 5); skinPv.scene.add(dl);
      skinPv.cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 50); skinPv.cam.position.set(0, 1.7, 5.4); skinPv.cam.lookAt(0, 1.05, 0);
      skinPv.rt = new THREE.WebGLRenderTarget(W, H);
      skinPv.rt.texture.encoding = renderer.outputEncoding;
      skinPv.buf = new Uint8Array(W * H * 4);
    }
    const key = pv.skin + '|' + Profile.color;
    if (skinPv.key !== key) {
      if (skinPv.mdl) trashObj(skinPv.mdl.root);
      skinPv.mdl = buildPlayerModel(Profile.color, pv.skin);
      setWeapon(skinPv.mdl, equipped().w, equipped().r);
      skinPv.mdl.ring.visible = false;
      skinPv.scene.add(skinPv.mdl.root); skinPv.key = key;
    }
    skinPv.mdl.root.rotation.y = 0.5 + pv.t * 1.1;
    animateModel(skinPv.mdl, 0.08, 0, 0, 0, pv.t);
    const prevBg = skinPv.scene.background; skinPv.scene.background = null;
    renderer.setRenderTarget(skinPv.rt);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(skinPv.scene, skinPv.cam);
    renderer.readRenderTargetPixels(skinPv.rt, 0, 0, W, H, skinPv.buf);
    renderer.setRenderTarget(null);
    skinPv.scene.background = prevBg;
    const ctx = cv.getContext('2d');
    if (!skinPv.img || skinPv.img.width !== W) skinPv.img = ctx.createImageData(W, H);
    const d = skinPv.img.data, b = skinPv.buf, row = W * 4;
    for (let y = 0; y < H; y++) d.set(b.subarray((H - 1 - y) * row, (H - y) * row), y * row); // flip rows
    ctx.putImageData(skinPv.img, 0, 0);
  } catch (e) { shop.preview = null; }
}

// ---------- battle potions: quick-use button + buff timers ----------
const myBuffs = { rage: 0, swift: 0, iron: 0 };   // seconds left (device-local display + my move speed)
function myBuffLeft(k) { return myBuffs[k] || 0; }
function potCount() { return BUFF_KEYS.reduce((s, k) => s + (Profile.pots[k] | 0), 0); }
function updatePotBtn() {
  const b = $('potBtn'); if (!b) return;
  const n = potCount();
  b.classList.toggle('hidden', !n && !$('potPop').childElementCount);
  setTxt(b.querySelector('.badge'), String(n));
  if (!n) $('potPop').classList.add('hidden');
}
function togglePotPop(force) {
  const pop = $('potPop');
  const show = force !== undefined ? force : pop.classList.contains('hidden');
  if (!show) { pop.classList.add('hidden'); return; }
  pop.innerHTML = '';
  for (const k of BUFF_KEYS) {
    const P = POTIONS[k], n = Profile.pots[k] | 0;
    const b = document.createElement('button');
    b.className = 'pbtn' + (n ? '' : ' none') + (myBuffLeft(k) > 0 ? ' on' : '');
    b.style.setProperty('--pc', P.color);
    b.innerHTML = `<span class="ic">${P.icon}</span><span class="n">${n}</span><span class="lb">${P.name.split(' ')[0].toUpperCase()}</span>`;
    b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (n) drinkPotion(k); else { sfx('hurt'); toast(P.icon + ' No ' + P.name + ' left — buy more at the merchant!'); } });
    pop.appendChild(b);
  }
  pop.classList.remove('hidden');
  clearTimeout(pop._t); pop._t = setTimeout(() => pop.classList.add('hidden'), 3500);
}
function drinkPotion(k) {
  if (!G.inGame || me.downed || !(Profile.pots[k] > 0) || !BUFF_KEYS.includes(k)) return;
  Profile.pots[k]--; saveT = 1;
  myBuffs[k] = POTIONS[k].dur;
  if (G.role === 'guest') Net.send(0, { t: 'buff', k }); else Sim.buff(G.myId, k);
  sfx('drink'); vibrate(40);
  togglePotPop(false); updatePotBtn();
}
// buff / phoenix events (from render.js handleEvent)
function shopEvent(a) {
  if (a[0] === 'buff') {
    const pp = playerPos(a[1]), P = POTIONS[a[2]];
    if (pp && P) { ringFx(pp.x, pp.z, 2.2, P.hex); particles(pp.x, pp.z, P.hex, 8, 1); }
    if (a[1] === G.myId && P) myBuffs[a[2]] = Math.max(myBuffs[a[2]], P.dur - 0.3);
  } else if (a[0] === 'phoenix') {
    const pp = playerPos(a[1]);
    if (pp) { ringFx(pp.x, pp.z, 3.2, 0xff9a2a); particles(pp.x, pp.z, 0xffb03a, 16, 1.3); }
    if (a[1] === G.myId) {
      Profile.pots.phoenix = Math.max(0, (Profile.pots.phoenix | 0) - 1); saveProfile(); pushStats();
      showBanner('🪶 PHOENIX FEATHER!', 'You rose from the ashes!' + (Profile.pots.phoenix ? ' (' + Profile.pots.phoenix + ' left)' : ''));
      vibrate([60, 40, 120]);
    } else {
      const o = G.view && G.view.players.find(p => p.id === a[1]);
      toast('🪶 ' + esc(o ? o.name : 'A teammate') + ' rose again with a Phoenix Feather!');
    }
  }
}
// HUD buff pills (+ phoenix feather carried)
function updateBuffHUD() {
  const row = $('buffRow'); if (!row) return;
  const parts = [];
  for (const k of BUFF_KEYS) if (myBuffs[k] > 0) { const P = POTIONS[k]; parts.push(`<span class="buff" style="--pc:${P.color}">${P.icon}<b>${Math.ceil(myBuffs[k])}</b><i style="width:${Math.round(100 * myBuffs[k] / P.dur)}%"></i></span>`); }
  if (Profile.pots.phoenix > 0) parts.push(`<span class="buff ph" style="--pc:${POTIONS.phoenix.color}">🪶<b>×${Profile.pots.phoenix}</b></span>`);
  setHTML(row, parts.join(''));
}
// hero glow for active buffs (all players; flags from the view)
function buffGlow(o, bf) {
  bf = bf | 0;
  if (!bf) { if (o.glow) o.glow.visible = false; return; }
  if (!o.glow) {
    o.glow = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 2.3, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    o.glow.position.y = 1.15; o.obj.add(o.glow);
  }
  const k = BUFF_KEYS[Math.floor(G.time * 2) % 3];
  const on = BUFF_KEYS.filter((b, i) => bf & (1 << i));
  const show = on.includes(k) ? k : on[0];
  o.glow.visible = true;
  o.glow.material.color.setHex(POTIONS[show].hex);
  o.glow.material.opacity = 0.16 + 0.08 * Math.sin(G.time * 6);
}

// ---------- per-frame: prompt near the stall, merchant idle animation, buffs, preview ----------
let shopHudT = 0;
function updateShop(dt) {
  for (const k of BUFF_KEYS) if (myBuffs[k] > 0) myBuffs[k] = Math.max(0, myBuffs[k] - dt);
  shopHudT -= dt;
  if (shopHudT <= 0) { shopHudT = 0.2; updateBuffHUD(); updatePotBtn(); }
  const mc = G.map && G.map.merchant, pr = $('shopPrompt');
  if (G.merchant) animateMerchant(G.merchant, dt, shop.near);
  if (!mc) { if (!pr.classList.contains('hidden')) pr.classList.add('hidden'); return; }
  const d = Math.hypot(me.x - mc.x, me.z - mc.z);
  const near = d < SHOP_NEAR && !me.downed;
  if (near && !shop.near) sfx('coin');
  shop.near = near;
  if (near && !shop.open) {
    const v = new THREE.Vector3(mc.sx + mc.nx * 1.2, 3.6, mc.sz + mc.nz * 1.2).project(camera);
    pr.style.left = Math.round((v.x + 1) / 2 * innerWidth) + 'px';
    pr.style.top = Math.round((1 - v.y) / 2 * innerHeight) + 'px';
    pr.classList.remove('hidden');
  } else if (!pr.classList.contains('hidden')) pr.classList.add('hidden');
  if (shop.open) drawSkinPreview(dt);
}

// ---------- wiring ----------
$('shopPrompt').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); audioInit(); openShop(); });
$('shopClose').onclick = () => closeShop();
$('potBtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); audioInit(); togglePotPop(); });
$('potBtn').addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  if (!G.inGame) return;
  if (e.code === 'KeyE' && shop.near && !shop.open) openShop();
  else if (e.code === 'Escape' && shop.open) closeShop();
  else if (e.code === 'Digit1') drinkPotion('rage');
  else if (e.code === 'Digit2') drinkPotion('swift');
  else if (e.code === 'Digit3') drinkPotion('iron');
});
