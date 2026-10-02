// ui.js — HUD, toasts, inventory, pause menu, title/lobby menus
'use strict';

// ---------- tiny DOM helpers: per-tick code only touches the DOM when a value changes ----------
function setTxt(el, s) { if (el._t !== s) { el._t = s; el.textContent = s; } }
function setHTML(el, s) { if (el._h !== s) { el._h = s; el.innerHTML = s; } }
function setW(el, pct) { const v = Math.round(pct * 10) / 10; if (el._w !== v) { el._w = v; el.style.width = v + '%'; } }
function setCls(el, c, on) { on = !!on; const k = '_c_' + c; if (el[k] !== on) { el[k] = on; el.classList.toggle(c, on); } }
function replayCls(el, c) { el.classList.remove(c); void el.offsetWidth; el.classList.add(c); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------- gear math (display only; Power itself comes from data.js itemPower) ----------
const ENCH_SHORT = { fire: 'Burn', ice: 'Slow', zap: 'Chain zap', leech: 'Heal on hit', boom: 'Explode on kill', crit: 'More crits', swift: '25% faster' };
const SPECIAL_MULT = { spin: 2.2, slam: 2.4, dash: 3.5, volley: 3.3, nova: 4 };
function itemSpecial(it) { return Math.round(itemDmg(it) * (SPECIAL_MULT[WEAPONS[it.w].special] || 2)); }
function itemSpeed(it) { return 1 / itemRate(it); }
function bestItem() { let b = equipped(); for (const it of Profile.inv) if (itemPower(it) > itemPower(b)) b = it; return b; }
function deltaTxt(d) { return d > 0 ? '▲ +' + d : d < 0 ? '▼ −' + (-d) : '= same'; }
function deltaCls(d) { return d > 0 ? 'up' : d < 0 ? 'dn' : 'eq'; }
function enchChips(it, mini) { return it.e.length ? '<div class="ench">' + it.e.map(e => `<span class="ech${mini ? ' mini' : ''}">${ENCH[e].icon} ${ENCH_SHORT[e] || ''}</span>`).join('') + '</div>' : '<span class="cnone">No enchant</span>'; }

// NEW badges: ids of items picked up but not looked at yet (device-local)
const newIds = new Set((() => { try { return JSON.parse(localStorage.getItem('dd_new') || '[]'); } catch (e) { return []; } })());
function saveNew() { try { localStorage.setItem('dd_new', JSON.stringify([...newIds].slice(-60))); } catch (e) { } }

// ---------- HUD ----------
const H = {};
function hudEls() {
  if (H.ok) return H;
  ['hpfill', 'hplag', 'hptext', 'hpwrap', 'lvnum', 'lvbadge', 'lvring', 'xpwrap', 'floorPill', 'objPill', 'team', 'center', 'bossbar', 'bossname', 'bossfill', 'bosslag', 'bosspct', 'arrows', 'hud', 'spBtn', 'ptBtn', 'dgBtn'].forEach(id => H[id] = $(id));
  for (const k of ['spBtn', 'ptBtn', 'dgBtn']) { H[k + 'Cd'] = H[k].querySelector('.cd'); H[k + 'T'] = H[k].querySelector('.cdt'); }
  H.ok = true; return H;
}
let lastLvl = Profile.lvl, lastXp = -1;
function updateBagBadge() {
  const b = $('invBtn').querySelector('.badge');
  const better = bestItem() !== equipped();
  const anyNew = Profile.inv.some(it => newIds.has(it.id));
  b.classList.toggle('hidden', !better && !anyNew);
  b.classList.toggle('new', !better && anyNew);
  b.textContent = better ? '▲' : 'NEW';
}
function refreshHUDStatic() {
  const h = hudEls();
  const it = equipped(), W = WEAPONS[it.w], rc = RAR[it.r].c;
  const ib = $('invBtn'); ib.querySelector('.ic').textContent = W.icon; ib.style.setProperty('--rc', rc);
  const ab = $('atkBtn'); ab.querySelector('.ic').textContent = W.icon; ab.style.setProperty('--rc', rc);
  h.spBtn.querySelector('.ic').textContent = W.sicon;
  h.spBtn.querySelector('.lbl').textContent = W.sname.toUpperCase();
  $('xpfill').style.width = (100 * Profile.xp / xpForLevel(Profile.lvl)) + '%';
  if (lastXp >= 0 && Profile.xp !== lastXp) replayCls(h.xpwrap, 'flash');
  lastXp = Profile.xp;
  h.lvnum.textContent = Profile.lvl;
  if (Profile.lvl > lastLvl && G.inGame) { replayCls(h.lvbadge, 'burst'); replayCls(h.lvring, 'go'); }
  lastLvl = Profile.lvl;
  updateBagBadge();
}

// cooldown ring + seconds; plays a "ready" pulse the moment it comes off cooldown
function cdRing(btn, cdEl, tEl, rem, total) {
  const k = Math.max(0, rem) / total;
  const step = Math.ceil(k * 50);
  if (cdEl._s !== step) { cdEl._s = step; cdEl.style.background = step > 0 ? `conic-gradient(rgba(0,0,0,.45) ${step * 7.2}deg, transparent 0)` : 'none'; }
  if (tEl) setTxt(tEl, rem > 0.05 ? String(Math.ceil(rem)) : '');
  const cool = rem > 0.05;
  if (btn._cool && !cool && G.inGame) replayCls(btn, 'ready');
  btn._cool = cool; setCls(btn, 'cool', cool);
}

let hudT = 0;
function updateHUD(dt) {
  hudT -= dt; if (hudT > 0) return; hudT = 0.1;
  const v = G.view; if (!v) return;
  const h = hudEls();
  const mp = myViewPlayer();
  if (mp) {
    const hp = Math.max(0, mp.hp), k = mp.maxHp ? hp / mp.maxHp : 0;
    setW(h.hpfill, 100 * k); setW(h.hplag, 100 * k);
    setTxt(h.hptext, hp + ' / ' + mp.maxHp);
    setCls(h.hpwrap, 'low', k < 0.3);
    if (mp.downed) {
      const s = '💀 You are down!<small>A teammate can stand next to you to revive you' + (mp.rev > 0 ? ' — ' + Math.round(100 * mp.rev / 2.2) + '%' : '') + '</small>';
      if (h.center._dsrc !== s || h.center.innerHTML !== h.center._dser) { h.center.innerHTML = s; h.center._dsrc = s; h.center._dser = h.center.innerHTML; }
    } else h.center._dsrc = null;
  }
  // floor + objective
  const boss = isBossFloor(G.floor);
  setHTML(h.floorPill, (boss ? '👑 ' : '') + '<b>F' + G.floor + '</b> ' + esc(G.theme ? G.theme.name : ''));
  const alive = v.players.filter(p => !p.downed).length;
  let obj, go = false;
  if (v.boss) obj = '👑 Beat the boss!';
  else if (v.po && v.pt > 0) { go = true; obj = '🌀 Leaving in ' + Math.ceil(v.pt / 10) + '…'; }
  else if (v.po && v.pn > 0 && v.players.length > 1) { go = true; obj = '🌀 ' + v.pn + '/' + alive + ' at portal — join them!'; }
  else if (v.po && (boss || !v.k)) { go = true; obj = '🌀 Portal open — go!'; }
  else obj = '👾 ' + (v.k || 0) + ' left';
  setTxt(h.objPill, obj); setCls(h.objPill, 'go', go);
  updatePortalHUD(v, alive);
  // cooldowns
  const W = WEAPONS[equipped().w];
  cdRing(h.spBtn, h.spBtnCd, h.spBtnT, me.spCd, W.scd);
  cdRing(h.ptBtn, h.ptBtnCd, h.ptBtnT, me.potCd, COOLDOWN.potion);
  cdRing(h.dgBtn, h.dgBtnCd, null, me.dodgeCd, rollCooldown(Profile.boosts));
  // boss (or a champion we are fighting: same big bar, orange, see champBarInfo in render.js)
  const cb = !v.boss && champBarInfo(v);
  if (v.boss || cb) {
    setCls(h.bossbar, 'hidden', false); setCls(h.hud, 'boss', true); setCls(h.bossbar, 'champ', !!cb);
    setTxt(h.bossname, cb ? cb.name : v.boss[0]);
    const pct = cb ? cb.hp : v.boss[1] / 10;
    setW(h.bossfill, pct); setW(h.bosslag, pct); setTxt(h.bosspct, Math.ceil(pct) + '%');
  } else { setCls(h.bossbar, 'hidden', true); setCls(h.hud, 'boss', false); }
  // team cards: rebuild only when the roster changes, otherwise just bar widths
  const others = v.players.filter(p => p.id !== G.myId);
  const sig = others.map(p => p.id + ':' + p.name + ':' + p.color).join('|');
  if (h.team._sig !== sig) {
    h.team._sig = sig;
    h.team.innerHTML = others.map(p => `<div class="tm" style="--pc:${p.color}"><span class="nm">${esc(p.name)}</span><span class="bar"><i></i></span><span class="sk">💀</span></div>`).join('');
    h.team._rows = [...h.team.children].map(el => ({ el, bar: el.querySelector('i') }));
  }
  others.forEach((p, i) => { const r = h.team._rows[i]; if (!r) return; setW(r.bar, 100 * Math.max(0, p.hp) / (p.maxHp || 1)); setCls(r.el, 'down', p.downed); });
  // off-screen teammate arrows (pooled elements)
  const pool = h.arrows._pool || (h.arrows._pool = new Map());
  const seen = new Set();
  for (const p of others) {
    const o = vis.get('p' + p.id); if (!o) continue;
    const sv = new THREE.Vector3(o.x, 1, o.z).project(camera);
    if (Math.abs(sv.x) < 0.95 && Math.abs(sv.y) < 0.95 && sv.z < 1) continue;
    seen.add(p.id);
    let el = pool.get(p.id);
    if (!el) { el = document.createElement('div'); el.className = 'arw'; h.arrows.appendChild(el); pool.set(p.id, el); }
    const ang = Math.atan2(-sv.y, sv.x);
    const cx = innerWidth / 2 + Math.cos(ang) * (innerWidth / 2 - 40), cy = innerHeight / 2 + Math.sin(ang) * (innerHeight / 2 - 40);
    el.style.borderBottomColor = p.color;
    el.style.transform = `translate(${(cx - 12) | 0}px,${(cy - 11) | 0}px) rotate(${(ang + Math.PI / 2).toFixed(2)}rad)`;
    el.style.display = '';
  }
  for (const [id, el] of pool) if (!seen.has(id)) el.style.display = 'none';
}

// portal: big 5 s countdown while everyone stands in it (tick each second), or "waiting for teammates"
// for the ones already standing in it
let portalLastN = 0;
function updatePortalHUD(v, alive) {
  const el = $('portalCd');
  const ex = G.map && G.map.exit;
  const inPortal = ex && !me.downed && Math.hypot(me.x - ex.x, me.z - ex.z) < Sim.PORTAL_R;
  if (v.po && v.pt > 0) {
    const n = Math.ceil(v.pt / 10), k = 360 * (1 - v.pt / (Sim.PORTAL_T * 10));
    if (n !== portalLastN) {
      setHTML(el, `<div class="pc-ring"><span class="n tick">${n}</span></div><div><div class="pc-t">🌀 Next floor in ${n}…</div><div class="pc-s">${inPortal ? 'Step out to stay and explore' : 'Everyone is in the portal!'}</div></div>`);
      const nn = el.querySelector('.n'); if (nn) replayCls(nn, 'tick');
      sfx(n <= 1 ? 'tock' : 'tick'); if (n <= 3) vibrate(20);
      portalLastN = n;
    }
    const ring = el.querySelector('.pc-ring'); if (ring) ring.style.setProperty('--k', k.toFixed(0) + 'deg');
    setCls(el, 'wait', false); setCls(el, 'hidden', false);
    return;
  }
  portalLastN = 0;
  if (v.po && inPortal && v.pn < alive && alive > 1) {
    setHTML(el, `<div><div class="pc-t">⏳ Waiting for teammates ${v.pn}/${alive}</div><div class="pc-s">Everyone must stand in the portal to go on</div></div><div class="pc-dots">${'<i class="on"></i>'.repeat(v.pn)}${'<i></i>'.repeat(Math.max(0, alive - v.pn))}</div>`);
    setCls(el, 'wait', true); setCls(el, 'hidden', false);
    return;
  }
  setCls(el, 'hidden', true);
}

// banner pop: replay the entrance animation whenever the headline changes
(() => {
  const c = $('center'); let last = '';
  new MutationObserver(() => {
    const head = c.firstChild ? c.firstChild.textContent : '';
    if (head && head !== last) replayCls(c, 'pop');
    last = head;
  }).observe(c, { childList: true });
})();

// ---------- toasts ----------
function pushToast(el, ms) {
  const box = $('toast');
  box.appendChild(el);
  // keep at most 2 cards on screen; drop plain/"meh" ones before upgrade cards
  while (box.childElementCount > 2) { const old = [...box.children].find(c => c !== el && !c.classList.contains('upg')) || box.firstChild; clearTimeout(old._tm); old.remove(); }
  el._tm = setTimeout(() => dismissToast(el), ms);
}
function dismissToast(el) {
  clearTimeout(el._tm);
  if (!el.isConnected) return;
  el.classList.add('out');
  setTimeout(() => el.remove(), 260);
}
function toast(text, btn, onBtn, ms) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = '<span>' + text + '</span>';
  if (btn) { const b = document.createElement('button'); b.textContent = btn; b.onclick = () => { onBtn(); dismissToast(el); }; el.appendChild(b); }
  pushToast(el, ms || 3500);
}
function lootToast(it, diff) {
  newIds.add(it.id); saveNew();
  const W = WEAPONS[it.w], RR = RAR[it.r], up = diff > 0;
  const el = document.createElement('div');
  el.className = 'toast loot r' + it.r + (up ? ' upg' : ' meh');
  el.style.setProperty('--rc', RR.c);
  const tag = it.r === 3 ? '★ LEGENDARY! ★' : it.r === 2 ? '◆ EPIC! ◆' : up ? '▲ UPGRADE!' : RR.n.toUpperCase() + ' ' + W.name.toUpperCase();
  el.innerHTML = `<div class="lt-ico">${W.icon}</div><div class="lt-main"><div class="lt-tag">${tag}</div><div class="lt-nm">${esc(it.n)}</div><div class="lt-sub">⚡ <b>${itemPower(it)}</b><span class="pw-w"> Power</span> ${it.e.map(e => ENCH[e].icon).join('')}</div></div><div class="delta ${deltaCls(diff)}">${deltaTxt(diff)}</div>`;
  if (up) {
    const b = document.createElement('button'); b.textContent = 'EQUIP';
    b.onclick = () => { equipItem(it); newIds.delete(it.id); saveNew(); b.textContent = '✓'; b.disabled = true; updateBagBadge(); if (!$('inv').classList.contains('hidden')) renderInv(); setTimeout(() => dismissToast(el), 500); };
    el.appendChild(b);
  }
  pushToast(el, up ? (it.r >= 2 ? 8000 : 6000) : (it.r >= 2 ? 4500 : 2600));
  if (it.r === 3) vibrate([60, 40, 140]);
  updateBagBadge();
  if (!$('inv').classList.contains('hidden')) renderInv();
}

// ---------- inventory ----------
const SORTS = [['power', '⇅ Power'], ['rarity', '⇅ Rarity'], ['new', '⇅ Newest']];
let invSort = 'power', invFilter = 'all', invSel = null, invPaused = false;
try { const s = JSON.parse(localStorage.getItem('dd_invui') || '{}'); if (s.sort) invSort = s.sort; if (s.filter) invFilter = s.filter; } catch (e) { }
function saveInvUi() { try { localStorage.setItem('dd_invui', JSON.stringify({ sort: invSort, filter: invFilter })); } catch (e) { } }

function toggleInv() { if ($('inv').classList.contains('hidden')) openInv(); else closeInv(); }
function openInv() {
  $('inv').classList.remove('hidden');
  if (G.inGame && G.role === 'solo' && !G.paused) { G.paused = true; invPaused = true; }
  const best = bestItem();
  invSel = best !== equipped() ? best : equipped();
  renderInv();
}
function closeInv() {
  $('inv').classList.add('hidden');
  const had = newIds.size; newIds.clear(); if (had) saveNew();
  if (invPaused && $('pause').classList.contains('hidden')) G.paused = false;
  invPaused = false;
  updateBagBadge();
}

// two-tap confirm for destructive actions (kids + bumpy car = misclicks)
function armConfirm(btn, label, fn) {
  if (btn._armed) { fn(); return; }
  btn._armed = true; btn._orig = btn.innerHTML; btn.innerHTML = label; btn.classList.add('confirm');
  setTimeout(() => { if (btn.isConnected && btn._armed) { btn._armed = false; btn.innerHTML = btn._orig; btn.classList.remove('confirm'); } }, 2600);
}
function salvageItems(list) {
  const cur = equipped();
  let gain = 0;
  for (const it of list) { if (it === cur) continue; const i = Profile.inv.indexOf(it); if (i < 0) continue; gain += salvageValue(it); Profile.inv.splice(i, 1); newIds.delete(it.id); }
  Profile.eq = Profile.inv.indexOf(cur);
  Profile.coins += gain;
  if (invSel && !Profile.inv.includes(invSel)) invSel = null;
  saveProfile(); saveNew(); sfx('coin');
  const c = $('coinsLbl'); replayCls(c, 'bump');
  return gain;
}
function junkList() { const cur = equipped(), cp = itemPower(cur); return Profile.inv.filter(it => it !== cur && it.r === 0 && itemPower(it) < cp); }

function renderInv() {
  const cur = equipped(), cp = itemPower(cur), best = bestItem();
  $('coinsLbl').textContent = '🪙 ' + Profile.coins;
  // toolbar: sort + filter
  $('sortBtn').textContent = (SORTS.find(s => s[0] === invSort) || SORTS[0])[1];
  const fbox = $('invFilter'); fbox.innerHTML = '';
  [['all', 'All']].concat(WEAPON_KEYS.map(k => [k, WEAPONS[k].icon])).forEach(([k, lab]) => {
    const n = k === 'all' ? Profile.inv.length : Profile.inv.filter(it => it.w === k).length;
    const b = document.createElement('button');
    b.className = 'fchip' + (k === 'all' ? ' all' : '') + (invFilter === k ? ' on' : '') + (n ? '' : ' none');
    b.textContent = lab;
    b.onclick = () => { invFilter = invFilter === k && k !== 'all' ? 'all' : k; saveInvUi(); renderInv(); };
    fbox.appendChild(b);
  });
  // list
  const idx = new Map(Profile.inv.map((it, i) => [it, i]));
  let list = Profile.inv.filter(it => invFilter === 'all' || it.w === invFilter);
  const byPow = (a, b) => itemPower(b) - itemPower(a);
  list.sort(invSort === 'rarity' ? (a, b) => b.r - a.r || byPow(a, b) : invSort === 'new' ? (a, b) => idx.get(b) - idx.get(a) : byPow);
  list.sort((a, b) => (b === cur) - (a === cur));
  const box = $('invList'); box.innerHTML = '';
  if (!list.length) box.innerHTML = '<div class="empty">No ' + (WEAPONS[invFilter] ? WEAPONS[invFilter].name.toLowerCase() + 's' : 'items') + ' yet — go find some loot!</div>';
  for (const it of list) {
    const W = WEAPONS[it.w], isEq = it === cur, d = itemPower(it) - cp;
    const el = document.createElement('button');
    el.className = 'it r' + it.r + (isEq ? ' iseq' : '') + (it === invSel ? ' sel' : '');
    el.style.setProperty('--rc', RAR[it.r].c);
    el.innerHTML = (it === best && Profile.inv.length > 1 ? '<span class="best">👑 BEST</span>' : '') +
      (newIds.has(it.id) && !isEq ? '<span class="tg new">NEW</span>' : '') +
      (isEq ? '' : `<span class="dl ${deltaCls(d)}">${d > 0 ? '▲' + d : d < 0 ? '▼' + (-d) : '='}</span>`) +
      `<span class="ico">${W.icon}</span><span class="en">${it.e.map(e => ENCH[e].icon).join('')}</span><span class="pw"><small>⚡</small>${itemPower(it)}</span>`;
    el.onclick = () => { invSel = it; if (newIds.delete(it.id)) saveNew(); sfx('hit'); renderInv(); };
    box.appendChild(el);
  }
  // footer helpers
  const bb = $('bestBtn');
  const canBest = best !== cur;
  bb.innerHTML = canBest ? `⚡ Equip best <small>⚡ ${cp} → ${itemPower(best)}</small>` : '✓ Best equipped';
  bb.classList.toggle('off', !canBest);
  bb.onclick = () => { if (!canBest) return; equipItem(best); invSel = best; flashEquip(); renderInv(); };
  const junk = junkList(), jv = junk.reduce((s, it) => s + salvageValue(it), 0);
  const jb = $('junkBtn'); jb._armed = false; jb.classList.remove('confirm');
  jb.innerHTML = junk.length ? `♻️ Salvage ${junk.length} weak <small>Commons → +🪙${jv}</small>` : '♻️ No junk <small>weak Commons</small>';
  jb.classList.toggle('off', !junk.length);
  jb.onclick = () => { if (!junk.length) return; armConfirm(jb, `Sure? ♻️ ${junk.length}<small>tap again → +🪙${jv}</small>`, () => { const g = salvageItems(junk); toast('♻️ Salvaged ' + junk.length + ' items: +🪙' + g); renderInv(); updateBagBadge(); }); };
  renderCmp();
}
function flashEquip() { toast('✅ Equipped <b>' + esc(equipped().n) + '</b>', null, null, 1600); }

function cmpHead(it, key) {
  const W = WEAPONS[it.w];
  return `<div class="chd" style="--rc:${RAR[it.r].c}"><span class="k">${key}</span><div class="i">${W.icon}</div><div class="n">${esc(it.n)}</div><div class="r">${RAR[it.r].n} · Lv ${it.p}</div></div>`;
}
function cmpCell(v, vs, max, txt) {
  const cls = vs === undefined ? '' : v > vs * 1.005 ? ' better' : v < vs * 0.995 ? ' worse' : '';
  return `<div class="cval${cls}"><span class="v">${txt}</span><span class="bar"><i style="width:${Math.max(4, Math.min(100, 100 * v / max)).toFixed(0)}%"></i></span></div>`;
}
function renderCmp() {
  const cur = equipped();
  const sel = invSel && Profile.inv.includes(invSel) ? invSel : cur;
  const isEq = sel === cur;
  const other = isEq ? Object.assign({}, cur, { p: cur.p + 1 }) : cur;   // equipped → preview of the upgrade
  const pool = Profile.inv.concat([other]);
  const mD = Math.max(...pool.map(itemDmg)), mS = Math.max(...pool.map(itemSpeed)), mP = Math.max(...pool.map(itemSpecial));
  const A = sel, B = other;
  const pa = itemPower(A), pb = itemPower(B), d = pa - pb;
  const kA = isEq ? 'EQUIPPED' : 'SELECTED', kB = isEq ? 'AFTER UPGRADE' : 'EQUIPPED';
  const nA = isEq ? undefined : 1;   // upgrade preview: keep the current weapon's column neutral
  const vsA = v => nA === undefined ? undefined : v;
  const powCell = (p, vs, show) => `<div class="cval cpow${vs === undefined ? '' : p > vs ? ' better' : p < vs ? ' worse' : ''}"><b><small>⚡</small>${p}</b>${show ? `<span class="delta ${deltaCls(show)}">${deltaTxt(show)}</span>` : ''}</div>`;
  const WA = WEAPONS[A.w], WB = WEAPONS[B.w];
  $('cmp').innerHTML = `<div class="cgrid">
    <span></span>${cmpHead(A, kA)}${cmpHead(B, kB)}
    <span class="clab">Power</span>${powCell(pa, vsA(pb), isEq ? 0 : d)}${powCell(pb, pa, isEq ? pb - pa : 0)}
    <span class="clab">Damage</span>${cmpCell(itemDmg(A), vsA(itemDmg(B)), mD, Math.round(itemDmg(A)))}${cmpCell(itemDmg(B), itemDmg(A), mD, Math.round(itemDmg(B)))}
    <span class="clab">Speed</span>${cmpCell(itemSpeed(A), vsA(itemSpeed(B)), mS, itemSpeed(A).toFixed(1) + '/s')}${cmpCell(itemSpeed(B), itemSpeed(A), mS, itemSpeed(B).toFixed(1) + '/s')}
    <span class="clab">Special</span>${cmpCell(itemSpecial(A), vsA(itemSpecial(B)), mP, WA.sicon + ' ' + itemSpecial(A))}${cmpCell(itemSpecial(B), itemSpecial(A), mP, WB.sicon + ' ' + itemSpecial(B))}
    <span class="clab top">Magic</span><div class="top">${enchChips(A)}</div><div class="top">${enchChips(B)}</div>
  </div>`;
  // actions
  const acts = $('cmpActs'); acts.innerHTML = '';
  const mk = (cls, html, fn) => { const b = document.createElement('button'); b.className = 'big ' + cls; b.innerHTML = html; b.onclick = fn; acts.appendChild(b); return b; };
  if (isEq) {
    const cost = upgradeCost(cur), can = Profile.coins >= cost, capped = cur.p >= upgradeCap();
    if (capped) mk('blue main off', `🔒 MAX LV ${cur.p}<small>Reach floor ${cur.p - 1} to upgrade further</small>`, () => toast('🔒 Go deeper first! Weapons can be upgraded up to 2 levels above your deepest floor.'));
    else mk('blue main' + (can ? '' : ' off'), `⬆️ UPGRADE 🪙${cost}<small>${can ? `⚡ ${pa} → ${pb}  (Lv ${cur.p} → ${cur.p + 1})` : `Need 🪙${cost - Profile.coins} more — salvage junk!`}</small>`, () => {
      if (Profile.coins < cost) { toast('🪙 Not enough coins — smash pots & salvage gear!'); return; }
      Profile.coins -= cost; cur.p++; saveProfile(); pushStats(); refreshHUDStatic(); sfx('lvl');
      toast('⬆️ <b>' + esc(cur.n) + '</b> is now Lv ' + cur.p + '!', null, null, 1800);
      renderInv(); replayCls($('coinsLbl'), 'bump');
    });
  } else {
    mk((d > 0 ? 'green' : '') + ' main', `EQUIP<small>⚡ ${pb} → ${pa}  ${d > 0 ? '▲ stronger' : d < 0 ? '▼ weaker' : 'same power'}</small>`, () => { equipItem(sel); flashEquip(); renderInv(); });
    const sv = salvageValue(sel);
    const sb = mk('brown', `♻️ +🪙${sv}<small>Salvage</small>`, () => {
      const go = () => { salvageItems([sel]); renderInv(); updateBagBadge(); };
      if (sel.r >= 1 || d > 0) armConfirm(sb, `Sure?<small>tap again</small>`, go); else go();
    });
    sb.style.flex = '0 0 auto';
  }
}
$('invBtn').onclick = () => openInv();
$('invClose').onclick = () => closeInv();
$('sortBtn').onclick = () => { const i = SORTS.findIndex(s => s[0] === invSort); invSort = SORTS[(i + 1) % SORTS.length][0]; saveInvUi(); renderInv(); };

// ---------- pause ----------
function updatePauseLabels() {
  $('lowBtn').classList.toggle('on', !!lowPower);
  $('sndBtn').classList.toggle('on', !!soundOn);
  $('sndBtn').querySelector('.ti').textContent = soundOn ? '🔊' : '🔇';
  $('pauseInfo').innerHTML = G.inGame ? `<span class="pill">${isBossFloor(G.floor) ? '👑 ' : ''}<b>Floor ${G.floor}</b> ${esc(G.theme ? G.theme.name : '')}</span><span class="pill">⭐ <b>Lv ${Profile.lvl}</b></span><span class="pill">🪙 <b>${Profile.coins}</b></span>` + (G.role !== 'solo' ? '<span class="pill">🤝 Co-op: game keeps going</span>' : '') : '';
}
$('menuBtn').onclick = () => { $('pause').classList.remove('hidden'); if (G.role === 'solo') G.paused = true; updatePauseLabels(); };
const closePause = () => { $('pause').classList.add('hidden'); G.paused = false; };
$('pauseClose').onclick = closePause; $('resumeBtn').onclick = closePause;
$('lowBtn').onclick = () => { lowPower = !lowPower; localStorage.setItem('dd_low', lowPower ? '1' : '0'); applyPR(); resize(); updatePauseLabels(); };
$('sndBtn').onclick = () => { soundOn = !soundOn; localStorage.setItem('dd_snd', soundOn ? '1' : '0'); updatePauseLabels(); };
$('quitBtn').onclick = () => { closePause(); quitToMenu(); };
$('addBtn').onclick = () => {
  Net.hostAddPlayer().then(id => toast('✅ Player ' + (id + 1) + ' connected!')).catch(() => { });
};

// ---------- menus ----------
function refreshMenu() {
  $('nameIn').value = Profile.name || '';
  const sw = $('swatches'); sw.innerHTML = '';
  PLAYER_COLORS.forEach(c => {
    const b = document.createElement('button'); b.className = 'sw' + (c === Profile.color ? ' on' : ''); b.style.background = c;
    b.onclick = () => { Profile.color = c; saveProfile(); refreshMenu(); };
    sw.appendChild(b);
  });
  const av = $('heroAv'); if (av) av.style.setProperty('--pc', Profile.color);
  const it = equipped(), W = WEAPONS[it.w], RR = RAR[it.r];
  $('heroStat').innerHTML = `<div class="hstats"><div class="hstat"><b>${Profile.lvl}</b><span>Level</span></div><div class="hstat"><b>${Profile.best}</b><span>Best floor</span></div><div class="hstat"><b>🪙 ${Profile.coins}</b><span>Coins</span></div></div>
    <div class="wprev" style="--rc:${RR.c}"><div class="wi">${W.icon}</div><div class="wn"><b>${esc(it.n)}</b><span>${RR.n} ${W.name} · Lv ${it.p}</span></div><div class="pow"><b>${itemPower(it)}</b><span>POWER</span></div></div>`;
  // checkpoint floors: 1, 4, 7, ... up to best
  const chips = $('floorChips'); chips.innerHTML = '';
  const cps = []; for (let f = 1; f <= Profile.best; f += 3) cps.push(f);
  if (!cps.includes(G.startFloor)) G.startFloor = cps[cps.length - 1];
  chips.classList.toggle('hidden', cps.length < 2);
  if (cps.length > 1) {
    chips.insertAdjacentHTML('beforeend', '<span class="lbl">START AT</span>');
    cps.slice(-5).forEach(f => {
      const b = document.createElement('button'); b.className = 'chip' + (f === G.startFloor ? ' on' : ''); b.textContent = 'Floor ' + f;
      b.onclick = () => { G.startFloor = f; refreshMenu(); };
      chips.appendChild(b);
    });
  }
}
$('nameIn').addEventListener('input', e => { Profile.name = e.target.value.trim().slice(0, 12); saveProfile(); });
$('soloBtn').onclick = () => { audioInit(); startGame('solo'); };
$('hostBtn').onclick = () => {
  audioInit(); goFullscreen();
  Net.hostStart();
  G.role = 'host'; G.myId = 0;
  Sim.S.players.clear();
  Sim.addPlayer(0, myStats());
  $('menu').classList.add('hidden'); $('lobby').classList.remove('hidden');
  refreshLobby();
};
function refreshLobby() {
  const list = $('lobbyList');
  if (!list) return;
  const rows = [...Sim.S.players.values()].map(p => `<div class="pl"><span class="sw" style="background:${p.color};width:26px;height:26px"></span>${esc(p.name)} ${p.id === 0 ? '👑' : ''} <span style="opacity:.7;font-size:14px">Lv ${p.lvl}</span></div>`);
  list.innerHTML = rows.join('') || 'Nobody yet';
}
$('addPlayerBtn').onclick = () => { Net.hostAddPlayer().then(() => refreshLobby()).catch(() => { }); };
$('startCoopBtn').onclick = () => { startGame('host'); };
$('lobbyBack').onclick = () => { quitToMenu(); };
$('joinBtn').onclick = () => {
  audioInit(); goFullscreen();
  G.role = 'guest';
  Net.joinGame().then(id => {
    G.myId = id;
    Net.send(0, { t: 'hello', st: myStats() });
    $('menu').classList.add('hidden'); $('wait').classList.remove('hidden');
  }).catch(() => { G.role = null; });
};
$('waitBack').onclick = () => quitToMenu();
$('shareBtn').onclick = () => {
  const url = location.href.split('#')[0].split('?')[0];
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const n = qr.getModuleCount(), cv = $('shareQR');
  const size = Math.floor(Math.min(innerWidth * 0.5, innerHeight * 0.62, 420));
  const cell = Math.max(2, Math.floor(size / (n + 8)));
  cv.width = cv.height = cell * (n + 8);
  cv.style.width = cv.style.height = cv.width + 'px';
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + 4) * cell, (r + 4) * cell, cell, cell);
  $('shareUrl').textContent = url;
  $('share').classList.remove('hidden');
};
$('shareClose').onclick = () => $('share').classList.add('hidden');

function goFullscreen() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => { try { screen.orientation.lock('landscape').catch(() => { }); } catch (e) { } }).catch(() => { });
    }
  } catch (e) { }
}
let wakeLock = null;
async function requestWake() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && G.inGame) requestWake(); });

