// heroes.js — hero slots (title hero card, hero picker, new hero) and the character sheet, plus the
// off-screen 3D hero preview they share with the merchant's outfit tab.
//
// Storage lives in core.js (Heroes, heroActivate/heroCreate/heroDelete): up to 3 heroes per device,
// each a completely separate save. `Profile` is always the active hero. Switching is only allowed on
// the title screen (never mid-run, never in a lobby), so nothing in the netcode changes: every phone
// simply plays with whichever hero is active on it.
'use strict';

// ---------- 3D hero preview: rendered off-screen with the main renderer (no second WebGL context) ----------
// draw(canvas, {color, skin, wpn}, {rot, t, atk, face}) renders one frame into a 2D canvas of any size.
const HeroPv = (() => {
  let scene = null, cam = null;
  const rts = new Map();   // 'WxH' -> {rt, buf, img}
  const mdls = new Map();  // look key -> player model (small LRU)
  let last = '';           // look key of the last frame drawn (tests read it)
  function setup() {
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4dd, 0x5a4026, 1.0));
    const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(2, 4, 5); scene.add(dl);
    cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  }
  function model(h) {
    const it = h.wpn, key = h.color + '|' + (h.skin || '') + '|' + (it ? it.w + it.r : '');
    let m = mdls.get(key);
    if (m) mdls.delete(key);
    else {
      while (mdls.size >= 6) { const [k0, m0] = mdls.entries().next().value; mdls.delete(k0); trashObj(m0.root); }
      m = buildPlayerModel(h.color, h.skin || '');
      if (it) setWeapon(m, it.w, it.r);
      m.ring.visible = false;
      prepModel(m.root);
    }
    mdls.set(key, m);
    last = key;
    return m;
  }
  function target(W, H) {
    const k = W + 'x' + H;
    let T = rts.get(k);
    if (!T) {
      while (rts.size >= 4) { const [k0, T0] = rts.entries().next().value; rts.delete(k0); T0.rt.dispose(); }
      T = { rt: new THREE.WebGLRenderTarget(W, H), buf: new Uint8Array(W * H * 4), img: null };
      T.rt.texture.encoding = renderer.outputEncoding;
      rts.set(k, T);
    }
    return T;
  }
  function draw(cv, h, o) {
    if (!cv || !cv.width || !cv.height || !h) return false;
    o = o || {};
    try {
      if (!scene) setup();
      const W = cv.width, H = cv.height, T = target(W, H), m = model(h), asp = W / H;
      m.root.rotation.y = o.rot || 0;
      animateModel(m, 0.05, 0, o.atk || 0, 0, o.t || 0);
      if (o.face) { cam.fov = 30; cam.position.set(0, 1.85, 2.55); cam.lookAt(0, 1.45, 0); }
      else { // whole hero (+ weapon) always fits, whatever the canvas shape
        const half = Math.max(1.55, 1.3 / asp);
        cam.fov = 2 * Math.atan(half / 5.4) * 180 / Math.PI; cam.position.set(0, 1.7, 5.4); cam.lookAt(0, 1.05, 0);
      }
      cam.aspect = asp; cam.updateProjectionMatrix();
      scene.add(m.root);
      renderer.setRenderTarget(T.rt);
      renderer.setClearColor(0x000000, 0); renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(T.rt, 0, 0, W, H, T.buf);
      renderer.setRenderTarget(null);
      scene.remove(m.root);
      const ctx = cv.getContext('2d');
      if (!T.img) T.img = ctx.createImageData(W, H);
      const d = T.img.data, b = T.buf, row = W * 4;
      for (let y = 0; y < H; y++) d.set(b.subarray((H - 1 - y) * row, (H - y) * row), y * row); // flip rows
      ctx.putImageData(T.img, 0, 0);
      return true;
    } catch (e) { try { renderer.setRenderTarget(null); } catch (_) { } return false; }
  }
  return { draw, get last() { return last; } };
})();
function heroLook(h) { return { color: h.color, skin: h.skin || '', wpn: h.inv ? h.inv[h.eq] || h.inv[0] : h.wpn }; }
function heroName(h, i) { return (h && h.name) || 'Hero ' + (i + 1); }
// size a canvas' pixels to its on-screen box (capped, so the GPU read-back stays cheap)
function fitCanvas(cv, maxPx) {
  const r = cv.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(maxPx / (r.width * r.height)));
  const w = Math.max(16, Math.round(r.width * s)), h = Math.max(16, Math.round(r.height * s));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return true;
}

// ---------- title screen: hero card extras (portrait, HEROES button) ----------
function heroCardRefresh() {
  const av = $('heroAv'), cv = $('heroAvCv');
  if (av && cv) av.classList.toggle('pv', HeroPv.draw(cv, heroLook(Profile), { face: true, rot: 0.42 }));
  const b = $('heroesBtn');
  if (b) b.querySelector('.nb').classList.toggle('hidden', heroCount() >= HERO_SLOTS);
}
// a switch is only allowed on the title screen, and never while a gift/drop of this hero is still pending
function canSwitchHero() { return !G.inGame && !G.role && !Social._s.outbox.size && !Social._s.drops.size; }
function heroSwitched() { // reset per-hero UI state after Profile changed to another hero
  invSel = null; shop.stockKey = null; shop.encSel = null; shop.encLast = null;
  lastLvl = Profile.lvl; lastXp = -1;
  G.startFloor = 1;
  refreshMenu();
}

// ---------- hero picker (title screen) ----------
const heroUi = { open: false, mode: 'list', slot: -1, color: '', t: 0, last: -1 };
function openHeroes() {
  if (!canSwitchHero()) return;
  heroUi.open = true; heroUi.mode = 'list';
  $('heroes').classList.remove('hidden');
  renderHeroes();
}
function closeHeroes() {
  heroUi.open = false;
  $('heroes').classList.add('hidden');
}
function renderHeroes() {
  const box = $('heroList');
  box.innerHTML = '';
  if (heroUi.mode === 'new') { renderNewHero(box); return; }
  const list = document.createElement('div'); list.className = 'hlist'; box.appendChild(list);
  const many = heroCount() > 1;
  Heroes.slots.forEach((h, i) => {
    const el = document.createElement('div');
    list.appendChild(el);
    if (!h) {
      el.className = 'hslot empty';
      el.innerHTML = '<button class="hnew"><span class="pl">➕</span><b>NEW HERO</b><span>Start fresh at level 1</span></button>';
      el.querySelector('button').onclick = () => { sfx('hit'); startNewHero(i); };
      return;
    }
    const it = h.inv[h.eq] || h.inv[0], W = WEAPONS[it.w], RR = RAR[it.r], act = i === Heroes.active;
    el.className = 'hslot' + (act ? ' on' : '');
    el.style.setProperty('--pc', h.color);
    el.innerHTML = (act ? '<span class="htag">✓ PLAYING</span>' : '') +
      `<div class="hpv"><canvas width="160" height="160"></canvas></div><div class="hnm">${esc(heroName(h, i))}</div>
      <div class="hmeta"><span>⭐ Lv <b>${h.lvl}</b></span><span>🏆 <b>F${h.best}</b></span><span>🪙 <b>${h.coins}</b></span></div>
      <div class="hw" style="--rc:${RR.c}"><span class="i">${W.icon}</span><span class="n">${esc(it.n)}</span><b>⚡${itemPower(it)}</b></div><div class="hacts"></div>`;
    HeroPv.draw(el.querySelector('canvas'), heroLook(h), { face: true, rot: 0.42 });
    const acts = el.querySelector('.hacts');
    const mk = (cls, html, fn) => { const b = document.createElement('button'); b.className = 'big ' + cls; b.innerHTML = html; b.onclick = fn; acts.appendChild(b); return b; };
    if (act) mk('blue', '📜 Look', () => { closeHeroes(); openSheet(); });
    else mk('green', '▶ Play', () => pickHero(i));
    if (many) {
      const del = mk('red del', '🗑️', () => armConfirm(del, 'Delete?<small>tap again</small>', () => {
        const nm = heroName(h, i);
        if (!heroDelete(i)) return;
        sfx('hurt'); heroSwitched(); renderHeroes();
        toast('🗑️ ' + esc(nm) + ' was deleted', null, null, 2200);
      }));
    }
  });
}
function pickHero(i) {
  if (!canSwitchHero() || !heroActivate(i)) return;
  sfx('item'); heroSwitched(); closeHeroes();
  toast('👋 Now playing as <b>' + esc(heroName(Profile, i)) + '</b>', null, null, 2200);
}
function startNewHero(i) {
  const used = Heroes.slots.filter(Boolean).map(h => h.color);
  heroUi.mode = 'new'; heroUi.slot = i; heroUi.last = -1;
  heroUi.color = PLAYER_COLORS.find(c => !used.includes(c)) || PLAYER_COLORS[i % PLAYER_COLORS.length];
  renderHeroes();
}
function renderNewHero(box) {
  const i = heroUi.slot;
  box.innerHTML = `<div class="hnewf"><div class="hnpv"><canvas id="newPv" width="200" height="242"></canvas></div><div class="hnform">
    <div class="glab">NEW HERO · SLOT ${i + 1}</div>
    <input id="newName" type="text" maxlength="12" placeholder="${'Hero ' + (i + 1)}">
    <div class="swatches" id="newSw"></div>
    <div class="hint">Starts at <b>level 1</b> with a Trusty Sword and a Hunting Bow. Your other heroes keep all their stuff.</div>
    <div class="row2"><button class="big gray sm" id="newBack">◀ Back</button><button class="big green" id="newGo">✔ CREATE HERO</button></div></div></div>`;
  const sw = $('newSw');
  const paint = () => {
    sw.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b._c === heroUi.color));
    box.querySelector('.hnpv').style.setProperty('--pc', heroUi.color);
    heroUi.last = -1;
  };
  PLAYER_COLORS.forEach(c => {
    const b = document.createElement('button'); b.className = 'sw'; b.style.background = c; b._c = c;
    b.onclick = () => { heroUi.color = c; sfx('hit'); paint(); };
    sw.appendChild(b);
  });
  paint();
  $('newBack').onclick = () => { heroUi.mode = 'list'; renderHeroes(); };
  $('newGo').onclick = () => {
    const name = $('newName').value.trim().slice(0, 12) || 'Hero ' + (i + 1);
    if (!canSwitchHero() || !heroCreate(i, name, heroUi.color)) return;
    sfx('lvl'); vibrate(40);
    heroSwitched(); closeHeroes();
    toast('🎉 Welcome, <b>' + esc(name) + '</b>! A brand new adventure begins.', null, null, 3000);
  };
  $('newName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.target.blur(); } });
}
function tickNewHero(dt) {
  heroUi.t += dt;
  if (heroUi.last >= 0 && heroUi.t - heroUi.last < 0.07) return;
  heroUi.last = heroUi.t;
  const cv = $('newPv'); if (!cv) return;
  HeroPv.draw(cv, { color: heroUi.color, skin: '', wpn: { w: 'sword', r: 0 } }, { rot: 0.5 + heroUi.t * 0.9, t: heroUi.t });
}

// ---------- character sheet ----------
// Opens from the HUD (tap your level badge / health bar) or the title hero card. Solo pauses the game
// while it is open (like the bag); co-op never pauses.
const sheet = { open: false, paused: false, rot: 0.5, spinT: 0, atk: 0, t: 0, last: -1, statT: 0, drag: null };
function openSheet() {
  if (sheet.open) return;
  if (G.inGame && (shop.open || !$('inv').classList.contains('hidden') || !$('pause').classList.contains('hidden'))) return;
  sheet.open = true;
  $('sheet').classList.remove('hidden');
  if (G.inGame && G.role === 'solo' && !G.paused) { G.paused = true; sheet.paused = true; }
  sheet.rot = 0.5; sheet.atk = 0; sheet.spinT = 0; sheet.last = -1; sheet.statT = 0;
  renderSheet();
  fitCanvas($('sheetPv'), 110000);
  sfx('hit');
}
function closeSheet() {
  if (!sheet.open) return;
  sheet.open = false; sheet.drag = null;
  $('sheet').classList.add('hidden');
  if (sheet.paused && $('pause').classList.contains('hidden') && $('inv').classList.contains('hidden')) G.paused = false;
  sheet.paused = false;
}
function renderSheet() {
  const P = Profile, it = equipped(), W = WEAPONS[it.w], RR = RAR[it.r];
  const mul = (1 + 0.06 * (P.lvl - 1)) * dmgBoostMult(P.boosts);            // same as the host's damage formula
  const maxHp = Math.round(maxHpFor(P.lvl) * hpBoostMult(P.boosts));
  const mp = G.inGame && typeof myViewPlayer === 'function' ? myViewPlayer() : null;
  const need = xpForLevel(P.lvl), bonus = Math.round(100 * (mul - 1));
  const sk = heroSkin(P.skin);
  $('sheet').querySelector('.panel').style.setProperty('--pc', P.color);
  setHTML($('sheetTitle'), '📜 ' + esc(heroName(P, Heroes.active)));
  setTxt($('sheetCoins'), '🪙 ' + P.coins);
  const tile = (icon, val, lab, extra) => `<div class="shtile"><b>${icon} ${val}</b><span>${lab}</span>${extra || ''}</div>`;
  const boosts = BOOST_KEYS.map(k => {
    const B = BOOSTS[k], rank = boostRank(P.boosts, k);
    return `<div class="sbst${rank ? '' : ' none'}"><span class="t">${B.name}</span><div class="r"><span class="i">${B.icon}</span><div class="pips">${'<i class="on"></i>'.repeat(rank)}${'<i></i>'.repeat(B.max - rank)}</div></div></div>`;
  }).join('');
  const pots = POTION_KEYS.filter(k => P.pots[k] > 0).map(k => POTIONS[k].icon + '<b>' + P.pots[k] + '</b>').join(' ');
  setHTML($('sheetStats'), `
    <div class="shtop"><div class="shlv"><span>LV</span><b>${P.lvl}</b></div>
      <div class="shxp"><div class="shxpl"><span>⭐ <b>${P.xp}</b> / ${need} XP</span><span>Next: Level ${P.lvl + 1}</span></div><div class="shxpb"><i style="width:${Math.min(100, 100 * P.xp / need).toFixed(1)}%"></i></div></div></div>
    <div class="shtiles">
      ${tile('❤️', mp && mp.maxHp ? mp.maxHp : maxHp, 'Max health', mp && mp.maxHp ? `<i class="hpb"><i style="width:${Math.max(0, Math.min(100, 100 * mp.hp / mp.maxHp)).toFixed(0)}%"></i></i>` : '')}
      ${tile('⚔️', Math.round(itemDmg(it) * mul), 'Damage', bonus > 0 ? `<span class="bn">+${bonus}%</span>` : '')}
      ${tile('💨', itemSpeed(it).toFixed(1) + '<small>/s</small>', 'Attacks')}
      ${tile(W.sicon, Math.round(itemSpecial(it) * mul), W.sname)}
    </div>
    <div class="wprev" style="--rc:${RR.c}"><div class="wi">${W.icon}</div><div class="wn"><b>${esc(it.n)}</b><span>${RR.n} ${W.name} · Lv ${it.p}</span>${enchChips(it, true)}</div><div class="pow"><b>${itemPower(it)}</b><span>POWER</span></div></div>
    <div class="shlab">💪 BOOSTS (FOREVER)</div>
    <div class="shbst">${boosts}</div>
    <div class="shfoot"><span class="pill">🏆 Deepest floor <b>${P.best}</b></span><span class="pill">${sk.icon} <b>${esc(sk.name)}</b></span>${pots ? `<span class="pill">${pots}</span>` : ''}</div>`);
}
function tickSheet(dt) {
  sheet.t += dt;
  if (sheet.atk > 0) sheet.atk = Math.max(0, sheet.atk - dt / 0.38);
  if (!sheet.drag) { sheet.spinT += dt; if (sheet.spinT > 1.2) sheet.rot += dt * 0.7; }
  sheet.statT -= dt;
  if (sheet.statT <= 0) { sheet.statT = 0.5; renderSheet(); } // live: HP, xp, coins (co-op keeps playing)
  if (sheet.last >= 0 && sheet.t - sheet.last < (sheet.atk > 0 || sheet.drag ? 0.04 : 0.07)) return;
  sheet.last = sheet.t;
  HeroPv.draw($('sheetPv'), heroLook(Profile), { rot: sheet.rot, t: sheet.t, atk: sheet.atk });
}
// drag to spin, tap to swing the weapon
(() => {
  const pv = $('sheetPv');
  pv.addEventListener('pointerdown', e => {
    sheet.drag = { id: e.pointerId, x: e.clientX, x0: e.clientX, t: performance.now(), moved: false };
    try { pv.setPointerCapture(e.pointerId); } catch (_) { }
    e.preventDefault();
  });
  pv.addEventListener('pointermove', e => {
    const d = sheet.drag; if (!d || d.id !== e.pointerId) return;
    sheet.rot += (e.clientX - d.x) * 0.014; d.x = e.clientX;
    if (Math.abs(e.clientX - d.x0) > 8) d.moved = true;
    sheet.spinT = 0;
  });
  const up = e => {
    const d = sheet.drag; if (!d || d.id !== e.pointerId) return;
    sheet.drag = null; sheet.spinT = 0;
    if (!d.moved && performance.now() - d.t < 400 && e.type === 'pointerup') { sheet.atk = 1; sfx(WEAPONS[equipped().w].kind === 'melee' ? 'swing' : WEAPONS[equipped().w].kind === 'magic' ? 'magic' : 'bow'); }
  };
  pv.addEventListener('pointerup', up); pv.addEventListener('pointercancel', up);
})();

// ---------- wiring ----------
$('heroAv').onclick = () => openSheet();
$('heroStat').addEventListener('click', () => openSheet());
$('heroesBtn').onclick = () => { sfx('hit'); openHeroes(); };
$('heroesClose').onclick = () => closeHeroes();
$('sheetClose').onclick = () => closeSheet();
// tap outside the panel (the dimmed area) closes it
$('heroes').addEventListener('click', e => { if (e.target === e.currentTarget) closeHeroes(); });
$('sheet').addEventListener('click', e => { if (e.target === e.currentTarget) closeSheet(); });
// HUD: tap your level badge / health bar (it sits above the joystick zone, so a tap never moves you,
// and a stick drag is captured by the joystick, so it never opens this)
$('pframe').addEventListener('click', e => { if (!G.inGame) return; e.stopPropagation(); audioInit(); openSheet(); });
addEventListener('keydown', e => {
  if (e.code === 'Escape') { if (sheet.open) closeSheet(); else if (heroUi.open) closeHeroes(); }
  else if (e.code === 'KeyC' && G.inGame && e.target === document.body) { if (sheet.open) closeSheet(); else openSheet(); }
});
addEventListener('resize', () => { if (sheet.open) { fitCanvas($('sheetPv'), 110000); sheet.last = -1; } });

// per-frame: animated previews (only while their window is open) + housekeeping
let heroPvT = performance.now(), sheetTipDone = false;
(function heroFrame() {
  requestAnimationFrame(heroFrame);
  const now = performance.now(), dt = Math.min(0.1, (now - heroPvT) / 1000); heroPvT = now;
  if (sheet.open) tickSheet(dt);
  if (heroUi.open) {
    if (!canSwitchHero() || $('menu').classList.contains('hidden')) closeHeroes();
    else if (heroUi.mode === 'new') tickNewHero(dt);
  }
  // tip (first game of the session, twice per device): an extra line under the "Floor N" banner, which
  // can't be tapped by accident and doesn't push the loot / gift toasts around
  if (!sheetTipDone && G.inGame && G.map) {
    sheetTipDone = true;
    let n = 0; try { n = +localStorage.getItem('dd_sheettip') || 0; } catch (e) { }
    const sm = $('center').querySelector('small');
    if (n < 2 && sm) {
      try { localStorage.setItem('dd_sheettip', String(n + 1)); } catch (e) { }
      sm.insertAdjacentHTML('beforeend', '<br>📜 Tip: tap your health bar to see your hero');
    }
  }
})();
