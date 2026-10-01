// social.js — co-op sharing: give a weapon to a teammate, or drop one on the floor for anyone.
//
// Ways in:
//   • tap a teammate's card in the HUD (top-left) or their hero in the 3D view → share window #gift
//   • inventory compare pane: 🎁 Give (→ share window with that weapon picked) and ⬇ Drop
//
// Net messages (reliable channel; the host validates and relays — guests never talk to each other):
//   giver -> host      {t:'gift', gid, to, item}        gid = unique per gift, so retries can't duplicate
//   host -> receiver   {t:'giftin', gid, from, name, item}
//   receiver -> host   {t:'giftack', gid}
//   host -> giver      {t:'giftok', gid, name} | {t:'giftno', gid}
//   dropper -> host    {t:'drop', item, x, z, f, seed}   host -> dropper {t:'dropno', iid} if refused
//   host -> everyone   {t:'dropped', id, by, name, w, r, n}       (id = loot id)
//   host -> everyone   {t:'droppick', id, iid, by, name, from, n}
//   host -> guests     {t:'gear', g:{playerId: equipped weapon}}  (for the ▲/▼ in the share window)
//
// Nothing gets lost: a gift or drop stays in this device's pending list until the host confirms it.
// An unanswered gift comes back after a timeout; an unclaimed drop comes back when the floor changes
// (new seed), when the game ends, or on the next app start. The host removes a dropped weapon from
// the floor if its dropper leaves (the dropper's device gives it back to them).
'use strict';

const Social = (() => {
  const GIFT_RETRY_MS = 3000, GIFT_GIVEUP_MS = 20000;
  const outbox = new Map();     // gid -> {item, to, toName, sent, wait}
  const drops = new Map();      // item id -> {item, seed}
  const labels = new Map();     // loot id -> {name, r, el}
  const hostGifts = new Map();  // host: gid -> {from, to, name, done}
  const gearSent = new Map();   // host: peer id -> last 'gear' signature sent
  let gear = {};                // guest: player id -> equipped weapon (from the host)
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const gotGifts = new Set(load('dd_gotgifts', []));

  // ---------- items ----------
  function cleanItem(it) {
    if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !it.id || !WEAPONS[it.w]) return null;
    const r = it.r | 0, p = it.p | 0;
    if (r < 0 || r > 3 || p < 1 || p > 9999) return null;
    const e = Array.isArray(it.e) ? it.e.filter((k, i, a) => ENCH[k] && a.indexOf(k) === i).slice(0, 4) : [];
    return { id: it.id.slice(0, 32), w: it.w, r, p, e, n: String(it.n || WEAPONS[it.w].name).slice(0, 40) };
  }
  const hasItem = id => Profile.inv.some(x => x.id === id);
  const invOpen = () => !$('inv').classList.contains('hidden');
  const anA = s => (/^[AEIOU]/i.test(s) ? 'an ' : 'a ') + s;
  function bestIndex() { let b = 0; Profile.inv.forEach((x, j) => { if (itemPower(x) > itemPower(Profile.inv[b])) b = j; }); return b; }
  // takes an item out of the bag (never the last one); keeps the equipped weapon, or equips the best left
  function takeItem(it) {
    const i = Profile.inv.indexOf(it);
    if (i < 0 || Profile.inv.length < 2) return false;
    const cur = equipped();
    Profile.inv.splice(i, 1);
    const eq = Profile.inv.indexOf(cur);
    Profile.eq = eq >= 0 ? eq : bestIndex();
    if (newIds.delete(it.id)) saveNew();
    if (invSel === it) invSel = null;
    saveProfile(); pushStats(); refreshHUDStatic();
    if (eq < 0) toast('✅ Now using <b>' + esc(equipped().n) + '</b>', null, null, 2200);
    return true;
  }
  // puts an item into the bag (gifts, returns); keeps the bag at 36 like addItem does
  function putItem(it) {
    if (hasItem(it.id)) return false;
    const cur = equipped();
    Profile.inv.push(it);
    if (Profile.inv.length > 36) {
      let wi = -1, wp = 1e9;
      Profile.inv.forEach((x, i) => { if (x !== cur && x !== it && itemPower(x) < wp) { wp = itemPower(x); wi = i; } });
      if (wi >= 0) { Profile.coins += salvageValue(Profile.inv[wi]); Profile.inv.splice(wi, 1); }
    }
    Profile.eq = Math.max(0, Profile.inv.indexOf(cur));
    saveProfile(); refreshHUDStatic();
    if (invOpen()) renderInv();
    return true;
  }
  function restore(item, msg) {
    if (!putItem(item)) return;
    if (G.inGame && msg) toast(msg, null, null, 4000);
  }

  // pending gifts/drops survive an app restart (they come back on the next start)
  function savePending() {
    store('dd_pending', { o: [...outbox.values()].map(o => o.item), d: [...drops.values()].map(d => d.item) });
  }
  function restoreAll() {
    for (const o of outbox.values()) restore(o.item);
    for (const d of drops.values()) restore(d.item);
    outbox.clear(); drops.clear(); labels.forEach(l => l.el.remove()); labels.clear();
    savePending();
  }
  (() => {
    const p = load('dd_pending', null);
    if (!p) return;
    let n = 0;
    for (const raw of [].concat(p.o || [], p.d || [])) { const it = cleanItem(raw); if (it && putItem(it)) n++; }
    store('dd_pending', { o: [], d: [] });
    if (n) saveProfile();
  })();

  // ---------- roster ----------
  function mates() { return G.view ? G.view.players.filter(p => p.id !== G.myId).sort((a, b) => a.id - b.id) : []; }
  function canShare() { return G.inGame && G.role !== 'solo' && mates().length > 0; }
  function mateGear(id) {
    if (G.role === 'host') { const p = Sim.S.players.get(id); return p && p.wpn ? cleanItem(p.wpn) : null; }
    if (gear[id]) return gear[id];
    const v = mates().find(p => p.id === id);
    return v && WEAPONS[v.w] ? { w: v.w, r: v.r, n: RAR[v.r].n + ' ' + WEAPONS[v.w].name, p: 0 } : null; // power unknown
  }

  // ---------- sending ----------
  const toHost = m => { if (G.role === 'host') host(G.myId, m); else Net.send(0, m); };
  const toPlayer = (id, m) => { if (id === G.myId) client(m); else Net.send(id, m); };
  const toAll = m => { Net.broadcast(m); client(m); };

  function giveItem(it, to) {
    const mate = mates().find(p => p.id === to);
    if (!mate) { toast('😕 That teammate isn\'t here any more'); return false; }
    if (Profile.inv.length < 2) { toast('✋ That\'s your only weapon — keep it!'); return false; }
    const item = cleanItem(it);
    if (!item || !takeItem(it)) return false;
    const gid = item.id + '.' + G.myId + '.' + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
    outbox.set(gid, { item, to, toName: mate.name, sent: 0, wait: 0 });
    savePending();
    sfx('item');
    toast('🎁 Sending <b>' + esc(item.n) + '</b> to ' + esc(mate.name) + '…', null, null, 1800);
    pushGift(gid);
    if (invOpen()) renderInv();
    return true;
  }
  function pushGift(gid) {
    const o = outbox.get(gid); if (!o) return;
    o.sent = performance.now();
    toHost({ t: 'gift', gid, to: o.to, item: o.item });
  }

  function dropItem(it) {
    if (Profile.inv.length < 2) { toast('✋ That\'s your only weapon — keep it!'); return false; }
    const item = cleanItem(it);
    if (!item || !takeItem(it)) return false;
    drops.set(item.id, { item, seed: G.seed });
    savePending();
    sfx('swing'); vibrate(30);
    toast('⬇ Dropped <b>' + esc(item.n) + '</b> — a teammate can grab it!', null, null, 2600);
    toHost({ t: 'drop', item, x: Math.round(me.x * 100) / 100, z: Math.round(me.z * 100) / 100, f: Math.round(me.f * 100) / 100, seed: G.seed });
    if (invOpen()) closeInv();   // let them see it land next to their hero
    return true;
  }

  // ---------- host: validate + relay ----------
  function host(from, m) {
    const P = Sim.S.players;
    if (m.t === 'gift') {
      const gid = typeof m.gid === 'string' ? m.gid.slice(0, 80) : '', item = cleanItem(m.item);
      if (!gid || !item) return;
      const rec = hostGifts.get(gid);
      if (rec && rec.from === from) {
        if (rec.done) toPlayer(from, { t: 'giftok', gid, name: rec.name });
        else if (P.has(rec.to)) toPlayer(rec.to, { t: 'giftin', gid, from, name: (P.get(from) || {}).name || 'A friend', item });
        else toPlayer(from, { t: 'giftno', gid });
        return;
      }
      const giver = P.get(from), rcv = P.get(m.to);
      if (!giver || !rcv || m.to === from) { toPlayer(from, { t: 'giftno', gid }); return; }
      hostGifts.set(gid, { from, to: m.to, name: rcv.name, done: false });
      toPlayer(m.to, { t: 'giftin', gid, from, name: giver.name, item });
    } else if (m.t === 'giftack') {
      const rec = hostGifts.get(m.gid);
      if (!rec || rec.to !== from) return;
      rec.done = true;
      if (P.has(rec.from)) toPlayer(rec.from, { t: 'giftok', gid: m.gid, name: rec.name });
    } else if (m.t === 'drop') {
      const item = cleanItem(m.item), p = P.get(from), S = Sim.S;
      if (!item) return;
      if (!p || !S.map || m.seed !== S.seed) { toPlayer(from, { t: 'dropno', iid: item.id }); return; }
      if (S.loot.some(l => l.item && l.item.id === item.id)) return; // repeated message
      const ok = isFinite(m.x) && isFinite(m.z) && Math.hypot(m.x - p.x, m.z - p.z) < 4;
      const bx = ok ? m.x : p.x, bz = ok ? m.z : p.z, f = isFinite(m.f) ? m.f : p.f;
      let x = bx, z = bz;
      // next to the hero, a bit in front — just outside the pick-up radius so it doesn't bounce back
      for (const da of [0, 0.7, -0.7, 1.5, -1.5, 2.3, -2.3, 3.14]) {
        const tx = bx + Math.sin(f + da) * 1.8, tz = bz + Math.cos(f + da) * 1.8;
        if (!blockedCircle(S.map, tx, tz, 0.35)) { x = tx; z = tz; break; }
      }
      const l = { id: S.nextId++, owner: -1, kind: 'item', x, z, t: 0, item, dropBy: from };
      S.loot.push(l);
      toAll({ t: 'dropped', id: l.id, by: from, name: p.name, w: item.w, r: item.r, n: item.n });
    }
  }
  // called by sim.js when someone walks over a dropped weapon (after Sim.onGrant gave it to them)
  Sim.onDropPick = (pid, l) => {
    const p = Sim.S.players.get(pid);
    toAll({ t: 'droppick', id: l.id, iid: l.item.id, by: pid, name: p ? p.name : 'Someone', from: l.dropBy, n: l.item.n });
  };
  function hostTick() {
    const S = Sim.S;
    // a dropper who left: take their weapon off the floor (their device gives it back to them)
    if (S.loot.some(l => l.dropBy !== undefined && !S.players.has(l.dropBy))) S.loot = S.loot.filter(l => l.dropBy === undefined || S.players.has(l.dropBy));
    // everyone's equipped weapon, for the share window's ▲/▼ on the guests
    const g = {};
    for (const p of S.players.values()) { const w = p.wpn && cleanItem(p.wpn); if (w) g[p.id] = w; }
    const sig = JSON.stringify(g);
    for (const id of Net.peerIds()) if (gearSent.get(id) !== sig && Net.send(id, { t: 'gear', g })) gearSent.set(id, sig);
  }

  // ---------- every device ----------
  function client(m) {
    if (m.t === 'giftin') {
      const it = cleanItem(m.item); if (!it || typeof m.gid !== 'string') return;
      if (!gotGifts.has(m.gid) && !hasItem(it.id)) {
        gotGifts.add(m.gid); store('dd_gotgifts', [...gotGifts].slice(-80));
        receiveGift(it, String(m.name || 'A friend').slice(0, 16));
      }
      toHost({ t: 'giftack', gid: m.gid });
    } else if (m.t === 'giftok') {
      const o = outbox.get(m.gid); if (!o) return;
      outbox.delete(m.gid); savePending();
      sfx('coin');
      toast('✅ ' + esc(m.name || o.toName) + ' got your <b>' + esc(o.item.n) + '</b>!', null, null, 3500);
    } else if (m.t === 'giftno') {
      const o = outbox.get(m.gid); if (!o) return;
      outbox.delete(m.gid); savePending();
      restore(o.item, '😕 ' + esc(o.toName) + ' isn\'t here — <b>' + esc(o.item.n) + '</b> is back in your bag');
    } else if (m.t === 'dropno') {
      const d = drops.get(m.iid); if (!d) return;
      drops.delete(m.iid); savePending();
      restore(d.item, '↩️ Couldn\'t drop it right now — <b>' + esc(d.item.n) + '</b> is back in your bag');
    } else if (m.t === 'dropped') {
      if (!labels.has(m.id)) {
        const el = document.createElement('div');
        el.className = 'dtag'; el.style.setProperty('--rc', (RAR[m.r] || RAR[0]).c); el.style.display = 'none';
        el.textContent = (m.by === G.myId ? 'Yours' : String(m.name).slice(0, 12) + '\'s') + ' ' + ((WEAPONS[m.w] || {}).icon || '');
        tagBox().appendChild(el);
        labels.set(m.id, { el, seen: 0 });
      }
      if (m.by !== G.myId && RAR[m.r] && WEAPONS[m.w]) {
        toast('⬇ ' + esc(m.name) + ' dropped <b style="color:' + RAR[m.r].c + '">' + anA(RAR[m.r].n + ' ' + WEAPONS[m.w].name) + '</b>! Walk over it to grab it', null, null, 4200);
      }
    } else if (m.t === 'droppick') {
      const l = labels.get(m.id); if (l) { l.el.remove(); labels.delete(m.id); }
      if (drops.has(m.iid)) {
        drops.delete(m.iid); savePending();
        if (m.by !== G.myId) toast('🤝 ' + esc(m.name) + ' picked up your <b>' + esc(m.n) + '</b>', null, null, 3000);
      }
    } else if (m.t === 'gear') {
      gear = {};
      for (const k in m.g || {}) { const w = cleanItem(m.g[k]); if (w) gear[k] = w; }
      if (gift.open) renderGift();
    }
  }

  function receiveGift(it, from) {
    if (!putItem(it)) return;
    newIds.add(it.id); saveNew();
    sfx('chest'); vibrate([60, 40, 140]);
    const W = WEAPONS[it.w], RR = RAR[it.r], diff = itemPower(it) - itemPower(equipped());
    const el = document.createElement('div');
    el.className = 'toast loot gift upg r' + it.r;
    el.style.setProperty('--rc', RR.c);
    el.innerHTML = `<div class="lt-ico">${W.icon}<span class="gbow">🎁</span></div><div class="lt-main"><div class="lt-tag">${esc(from)} gave you</div><div class="lt-nm">${esc(it.n)}</div><div class="lt-sub">${RR.n} · ⚡ <b>${itemPower(it)}</b><span class="pw-w"> Power</span> ${it.e.map(e => ENCH[e].icon).join('')}</div></div><div class="delta ${deltaCls(diff)}">${deltaTxt(diff)}</div>`;
    const b = document.createElement('button'); b.textContent = 'EQUIP';
    b.onclick = () => {
      if (Profile.inv.includes(it)) { equipItem(it); flashEquip(); }
      newIds.delete(it.id); saveNew(); b.textContent = '✓'; b.disabled = true; updateBagBadge();
      if (invOpen()) renderInv();
      setTimeout(() => dismissToast(el), 500);
    };
    el.appendChild(b);
    pushToast(el, 9000);
    updateBagBadge();
  }

  // ---------- share window ----------
  const gift = { open: false, to: null, item: null, ask: false, sig: '' };
  function openGift(to, item) {
    if (!canShare()) { toast('🤝 Give weapons when a teammate is playing with you'); return; }
    const ms = mates();
    gift.to = ms.some(p => p.id === to) ? to : ms.length === 1 ? ms[0].id : null;
    gift.item = item && Profile.inv.includes(item) ? item : null;
    gift.ask = false; gift.open = true;
    $('gift').classList.remove('hidden');
    sfx('hit');
    renderGift();
  }
  function closeGift() { gift.open = false; gift.ask = false; $('gift').classList.add('hidden'); }
  function renderGift() {
    const ms = mates();
    gift.sig = ms.map(p => p.id + ':' + p.name).join('|');
    if (gift.to !== null && !ms.some(p => p.id === gift.to)) gift.to = null;
    if (gift.item && !Profile.inv.includes(gift.item)) gift.item = null;
    if (!ms.length) { closeGift(); return; }
    const mate = ms.find(p => p.id === gift.to), theirs = mate ? mateGear(mate.id) : null;
    const tp = theirs && theirs.p ? itemPower(theirs) : 0;
    const only = Profile.inv.length < 2;
    // who gets it
    const to = $('giftTo'); to.innerHTML = '';
    to.classList.toggle('ask', gift.to === null);
    for (const p of ms) {
      const b = document.createElement('button');
      b.className = 'gmate' + (p.id === gift.to ? ' on' : '');
      b.style.setProperty('--pc', p.color);
      b.innerHTML = `<span class="nm">${esc(p.name)}</span><span class="ck">${p.id === gift.to ? '✓' : ''}</span>`;
      b.onclick = () => { gift.to = p.id; gift.ask = false; sfx('hit'); renderGift(); };
      to.appendChild(b);
    }
    // what they use now
    const now = $('giftNow');
    if (theirs) {
      const W = WEAPONS[theirs.w], RR = RAR[theirs.r];
      now.innerHTML = `<div class="glab">${esc(mate.name.toUpperCase())} USES NOW</div><div class="wprev" style="--rc:${RR.c}"><div class="wi">${W.icon}</div><div class="wn"><b>${esc(theirs.n)}</b><span>${RR.n} ${W.name}${theirs.p ? ' · Lv ' + theirs.p : ''}</span></div>${tp ? `<div class="pow"><b>${tp}</b><span>POWER</span></div>` : ''}</div>`;
    } else now.innerHTML = '';
    // my weapons, compared with what they use now
    $('giftHead').innerHTML = only ? 'YOUR WEAPONS <span>· you need to keep one!</span>' : mate && tp ? `YOUR WEAPONS <span>· ▲▼ = compared with ${esc(mate.name)}'s ⚡${tp}</span>` : 'YOUR WEAPONS <span>· tap one</span>';
    const box = $('giftList'); box.innerHTML = '';
    const cur = equipped();
    const list = Profile.inv.slice().sort((a, b) => (b === cur) - (a === cur) || itemPower(b) - itemPower(a));
    for (const it of list) {
      const W = WEAPONS[it.w], d = tp ? itemPower(it) - tp : null;
      const el = document.createElement('button');
      el.className = 'it r' + it.r + (it === cur ? ' iseq' : '') + (it === gift.item ? ' sel' : '') + (only ? ' off' : '');
      el.style.setProperty('--rc', RAR[it.r].c); el.dataset.id = it.id;
      el.innerHTML = (d === null ? '' : `<span class="dl ${deltaCls(d)}">${d > 0 ? '▲' + d : d < 0 ? '▼' + (-d) : '='}</span>`) +
        `<span class="ico">${W.icon}</span><span class="en">${it.e.map(e => ENCH[e].icon).join('')}</span><span class="pw"><small>⚡</small>${itemPower(it)}</span>`;
      el.onclick = () => {
        if (only) { toast('✋ That\'s your only weapon — keep it!'); return; }
        gift.item = it; gift.ask = false; sfx('hit'); renderGift();
      };
      box.appendChild(el);
    }
    // footer: pick → "Give X to Y?" → yes
    const foot = $('giftFoot'); foot.innerHTML = '';
    const it = gift.item;
    const mk = (cls, html, fn) => { const b = document.createElement('button'); b.className = 'big ' + cls; b.innerHTML = html; b.onclick = fn; foot.appendChild(b); return b; };
    if (only) { foot.innerHTML = '<div class="tip">✋ You only have one weapon — find more loot to share!</div>'; return; }
    if (!it || !mate) {
      foot.innerHTML = `<div class="tip">${!mate ? '👈 Tap who gets it' : '👉 Tap a weapon to give to ' + esc(mate.name)}</div>`;
      return;
    }
    const d = tp ? itemPower(it) - tp : null;
    const sub = `${RAR[it.r].n} · ⚡ ${itemPower(it)}${d === null ? '' : ' · ' + (d > 0 ? '▲ stronger' : d < 0 ? '▼ weaker' : 'same') + ' for ' + esc(mate.name)}`;
    if (!gift.ask) {
      mk('green main', `🎁 GIVE ${esc(it.n)} to ${esc(mate.name)}<small>${sub}</small>`, () => { gift.ask = true; sfx('hit'); renderGift(); });
      return;
    }
    const warn = it === cur ? 'It\'s the weapon you\'re using!' : it.r === 3 ? 'It\'s LEGENDARY!' : it.r === 2 ? 'It\'s EPIC!' : '';
    foot.insertAdjacentHTML('beforeend', `<div class="q">Give ${WEAPONS[it.w].icon} <span style="color:${RAR[it.r].c}">${esc(it.n)}</span> to ${esc(mate.name)}?${warn ? `<small>⚠️ ${warn}</small>` : ''}</div>`);
    mk('gray', '✕ No', () => { gift.ask = false; renderGift(); });
    mk('green', '✔ Yes, give!', () => { if (giveItem(it, mate.id)) closeGift(); else renderGift(); });
  }
  $('giftClose').onclick = closeGift;

  // ---------- inventory compare pane: 🎁 Give / ⬇ Drop next to the other actions ----------
  // (wraps ui.js renderCmp so ui.js itself needs no edits)
  const baseRenderCmp = renderCmp;
  renderCmp = function () {
    baseRenderCmp();
    if (!canShare()) return;
    const acts = $('cmpActs'), cur = equipped();
    const sel = invSel && Profile.inv.includes(invSel) ? invSel : cur;
    const only = Profile.inv.length < 2;
    const mk = (cls, html, fn) => { const b = document.createElement('button'); b.className = 'big ' + cls + (only ? ' off' : ''); b.innerHTML = html; b.style.flex = '0 0 auto'; b.onclick = fn; acts.appendChild(b); return b; };
    const keep = () => toast('✋ That\'s your only weapon — keep it!');
    const ms = mates();
    mk('purple sact', `🎁<small>Give</small>`, () => { if (only) return keep(); openGift(ms.length === 1 ? ms[0].id : null, sel); });
    const db = mk('gray sact', `⬇<small>Drop</small>`, () => {
      if (only) return keep();
      if (sel.r >= 2 || sel === cur) armConfirm(db, `⬇ Sure?<small>tap again</small>`, () => dropItem(sel));
      else dropItem(sel);
    });
  };

  // ---------- tap a teammate (HUD card or their hero) ----------
  $('team').addEventListener('click', e => {
    const card = e.target.closest('.tm'); if (!card || !G.inGame) return;
    const ms = G.view ? G.view.players.filter(p => p.id !== G.myId) : []; // same order as the HUD cards
    const nm = card.querySelector('.nm'), name = nm ? nm.textContent : '';
    let p = ms[[...$('team').children].indexOf(card)];
    if (!p || p.name !== name) p = ms.find(q => q.name === name) || p;
    if (p) openGift(p.id, null);
  });
  const _v = new THREE.Vector3();
  function mateAt(cx, cy) {
    let best = null, bd = 46 * 46;
    for (const p of mates()) {
      const o = vis.get('p' + p.id); if (!o) continue;
      _v.set(o.x, 0.9, o.z).project(camera);
      if (_v.z > 1) continue;
      const sx = (_v.x + 1) / 2 * innerWidth, sy = (1 - _v.y) / 2 * innerHeight, d = (sx - cx) ** 2 + (sy - cy) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function tapAt(x, y) {
    if (!G.inGame || gift.open || invOpen() || !$('pause').classList.contains('hidden') || !canShare()) return;
    const p = mateAt(x, y);
    if (p) openGift(p.id, null);
  }
  canvas.addEventListener('click', e => tapAt(e.clientX, e.clientY));
  // joystick side: only a quick tap that doesn't move (a real stick drag never opens anything)
  let tap = null;
  $('joyzone').addEventListener('pointerdown', e => { tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }; });
  $('joyzone').addEventListener('pointerup', e => {
    const t = tap; tap = null;
    if (t && t.id === e.pointerId && performance.now() - t.t < 300 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 12) tapAt(e.clientX, e.clientY);
  });

  // ---------- name tags over dropped weapons ----------
  let tags = null;
  function tagBox() {
    if (!tags) { tags = document.createElement('div'); tags.id = 'dropTags'; $('fx').after(tags); }
    return tags;
  }
  function updateTags() {
    for (const [id, l] of labels) {
      const o = vis.get('l' + id);
      if (!o || !G.inGame) { if (l.el.style.display !== 'none') l.el.style.display = 'none'; continue; }
      _v.set(o.x, 1.45, o.z).project(camera);
      const vis2 = _v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05;
      l.el.style.display = vis2 ? '' : 'none';
      if (vis2) l.el.style.transform = `translate(${Math.round((_v.x + 1) / 2 * innerWidth)}px,${Math.round((1 - _v.y) / 2 * innerHeight)}px) translate(-50%,-100%)`;
    }
  }

  // ---------- housekeeping ----------
  let wasIn = false, lastSeed = null, tipDone = false, lastT = performance.now();
  function tick() {
    const now = performance.now(), dt = now - lastT; lastT = now;
    if (!G.inGame) {
      if (wasIn) { wasIn = false; restoreAll(); closeGift(); gear = {}; hostGifts.clear(); gearSent.clear(); }
      return;
    }
    wasIn = true;
    if (lastSeed !== G.seed) {
      // new floor (or a retry): unclaimed drops from the old floor come back to their dropper
      if (lastSeed !== null) {
        for (const [iid, d] of drops) if (d.seed !== G.seed) { drops.delete(iid); restore(d.item, '↩️ Nobody picked up your <b>' + esc(d.item.n) + '</b> — it\'s back in your bag'); }
        savePending();
      }
      lastSeed = G.seed;
      labels.forEach(l => l.el.remove()); labels.clear();
      hostGifts.forEach((r, k) => { if (r.done) hostGifts.delete(k); });
    }
    // gifts: retry until the host answers; give up (and give it back) after a while connected
    const online = G.role === 'host' || Net.myId != null;
    for (const [gid, o] of outbox) {
      if (!online) continue;
      o.wait += dt;
      if (o.wait > GIFT_GIVEUP_MS) { outbox.delete(gid); savePending(); restore(o.item, '😕 Couldn\'t reach ' + esc(o.toName) + ' — <b>' + esc(o.item.n) + '</b> is back in your bag'); }
      else if (now - o.sent > GIFT_RETRY_MS) pushGift(gid);
    }
    if (G.role === 'host') hostTick();
    if (gift.open) {
      const sig = mates().map(p => p.id + ':' + p.name).join('|');
      if (sig !== gift.sig) renderGift();
    }
    // one-time hint (twice per device) the first time a teammate shows up
    if (!tipDone && mates().length) {
      tipDone = true;
      const n = +(load('dd_gifttip', 0)) || 0;
      if (n < 2) { store('dd_gifttip', n + 1); setTimeout(() => G.inGame && toast('🎁 Tip: tap a teammate\'s name to give them a weapon', null, null, 5000), 4000); }
    }
  }
  setInterval(tick, 250);
  (function frame() { requestAnimationFrame(frame); if (labels.size) updateTags(); })();

  // Net glue: main.js calls this first for every message; true = handled here
  const HOST_T = new Set(['gift', 'giftack', 'drop']), CLIENT_T = new Set(['giftin', 'giftok', 'giftno', 'dropno', 'dropped', 'droppick', 'gear']);
  function onNet(from, m) {
    if (Net.isHost) {
      if (m.t === 'hello') gearSent.delete(from); // (re)joined: send the gear list again
      if (HOST_T.has(m.t)) { if (G.inGame) host(from, m); return true; }
      return false;
    }
    if (CLIENT_T.has(m.t)) { if (G.inGame) client(m); return true; }
    return false;
  }

  return { onNet, openGift, closeGift, giveItem, dropItem, canShare, mates, _s: { outbox, drops, labels, hostGifts, gotGifts } };
})();
