// ui.js — HUD, toasts, inventory, pause menu, title/lobby menus
'use strict';

// ---------- HUD ----------
function refreshHUDStatic() {
  const it = equipped(), W = WEAPONS[it.w];
  $('invBtn').textContent = W.icon;
  $('invBtn').style.borderColor = RAR[it.r].c;
  $('spBtn').querySelector('.ic').textContent = W.sicon;
  $('atkBtn').querySelector('.ic').textContent = W.icon;
  $('xpfill').style.width = (100 * Profile.xp / xpForLevel(Profile.lvl)) + '%';
}
let hudT = 0;
function updateHUD(dt) {
  hudT -= dt; if (hudT > 0) return; hudT = 0.1;
  const v = G.view; if (!v) return;
  const mp = myViewPlayer();
  if (mp) {
    $('hpfill').style.width = (100 * Math.max(0, mp.hp) / mp.maxHp) + '%';
    $('hptext').textContent = Math.max(0, mp.hp) + ' / ' + mp.maxHp;
    if (mp.downed) {
      $('center').innerHTML = '💀 You are down!<small>A teammate can stand next to you to revive you' + (mp.rev > 0 ? ' — ' + Math.round(100 * mp.rev / 2.2) + '%' : '') + '</small>';
    }
  }
  const W = WEAPONS[equipped().w];
  $('lvlrow').textContent = 'Lv ' + Profile.lvl + ' · Floor ' + G.floor + (v.k ? ' · 👾 ' + v.k : '') + (v.po && v.pn && v.players.length > 1 ? ' · 🌀 ' + v.pn + '/' + v.players.filter(p => !p.downed).length + ' at portal' : '');
  const spK = Math.max(0, me.spCd) / W.scd;
  $('spBtn').querySelector('.cd').style.background = spK > 0 ? `conic-gradient(rgba(0,0,0,.65) ${spK * 360}deg, transparent 0)` : 'none';
  const pK = Math.max(0, me.potCd) / COOLDOWN.potion;
  $('ptBtn').querySelector('.cd').style.background = pK > 0 ? `conic-gradient(rgba(0,0,0,.65) ${pK * 360}deg, transparent 0)` : 'none';
  // boss
  if (v.boss) { $('bossbar').classList.remove('hidden'); $('bossname').textContent = v.boss[0]; $('bossfill').style.width = (v.boss[1] / 10) + '%'; }
  else $('bossbar').classList.add('hidden');
  // team
  const others = v.players.filter(p => p.id !== G.myId);
  $('team').innerHTML = others.map(p => `<div class="tm"><span class="dot" style="background:${p.color}"></span>${esc(p.name)} <span class="bar"><i style="width:${100 * Math.max(0, p.hp) / p.maxHp}%"></i></span>${p.downed ? '💀' : ''}</div>`).join('');
  // off-screen teammate arrows
  const arrows = $('arrows');
  let html = '';
  for (const p of others) {
    const o = vis.get('p' + p.id); if (!o) continue;
    const sv = new THREE.Vector3(o.x, 1, o.z).project(camera);
    if (Math.abs(sv.x) < 0.95 && Math.abs(sv.y) < 0.95 && sv.z < 1) continue;
    const ang = Math.atan2(-sv.y, sv.x);
    const cx = innerWidth / 2 + Math.cos(ang) * (innerWidth / 2 - 40), cy = innerHeight / 2 + Math.sin(ang) * (innerHeight / 2 - 40);
    html += `<div class="arw" style="left:${cx - 12}px;top:${cy - 11}px;border-bottom-color:${p.color};transform:rotate(${ang + Math.PI / 2}rad)"></div>`;
  }
  arrows.innerHTML = html;
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function toast(text, btn, onBtn, ms) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = '<span>' + text + '</span>';
  if (btn) { const b = document.createElement('button'); b.textContent = btn; b.onclick = () => { onBtn(); el.remove(); }; el.appendChild(b); }
  const box = $('toast');
  box.appendChild(el);
  while (box.childElementCount > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), ms || 3500);
}
function lootToast(it, diff) {
  const W = WEAPONS[it.w];
  const txt = `${W.icon} <span style="color:${RAR[it.r].c}">${esc(it.n)}</span> ${it.e.map(e => ENCH[e].icon).join('')} <span class="${diff > 0 ? 'up-green' : 'down-red'}">${diff > 0 ? '▲' + diff : (diff < 0 ? '▼' + (-diff) : '=')}</span>`;
  if (diff > 0) toast(txt, 'EQUIP', () => equipItem(it), 6000);
  else toast(txt, null, null, 2500);
  if (diff > 0) { const b = $('invBtn'); b.querySelector('.badge') || b.insertAdjacentHTML('beforeend', '<span class="badge">!</span>'); }
}

// ---------- inventory ----------
function toggleInv() { if ($('inv').classList.contains('hidden')) openInv(); else $('inv').classList.add('hidden'); }
function openInv() {
  $('inv').classList.remove('hidden');
  const b = $('invBtn').querySelector('.badge'); if (b) b.remove();
  renderInv();
}
function renderInv() {
  $('coinsLbl').textContent = '🪙 ' + Profile.coins;
  const cur = equipped();
  const list = Profile.inv.slice().sort((a, b) => (b === cur) - (a === cur) || itemPower(b) - itemPower(a));
  const box = $('invList'); box.innerHTML = '';
  for (const it of list) {
    const W = WEAPONS[it.w];
    const isEq = it === cur;
    const diff = itemPower(it) - itemPower(cur);
    const el = document.createElement('div');
    el.className = 'item' + (isEq ? ' eq' : '');
    el.style.borderColor = RAR[it.r].c;
    el.innerHTML = `<div class="top"><span class="ico">${W.icon}</span><div><div class="nm" style="color:${RAR[it.r].c}">${esc(it.n)}</div><div class="rr">${RAR[it.r].n} ${W.name} · Lv ${it.p}</div></div></div>
      <div class="pw">⚡ Power ${itemPower(it)} ${isEq ? '· EQUIPPED' : `<span class="${diff > 0 ? 'up-green' : 'down-red'}">(${diff >= 0 ? '+' : ''}${diff})</span>`}</div>
      <div class="en">${W.sicon} ${W.sname}${it.e.length ? '<br>' + it.e.map(e => ENCH[e].icon + ' ' + ENCH[e].desc).join('<br>') : ''}</div>
      <div class="acts"></div>`;
    const acts = el.querySelector('.acts');
    if (!isEq) {
      const eb = document.createElement('button'); eb.textContent = 'Equip'; eb.onclick = () => { equipItem(it); renderInv(); }; acts.appendChild(eb);
      const sb = document.createElement('button'); sb.className = 'sal'; sb.textContent = '♻️ +' + salvageValue(it); sb.onclick = () => { Profile.coins += salvageValue(it); Profile.inv.splice(Profile.inv.indexOf(it), 1); Profile.eq = Profile.inv.indexOf(cur); saveProfile(); sfx('coin'); renderInv(); }; acts.appendChild(sb);
    } else {
      const cost = upgradeCost(it);
      const ub = document.createElement('button'); ub.className = 'up'; ub.textContent = `⬆️ Upgrade (🪙${cost})`;
      if (Profile.coins < cost) ub.style.opacity = 0.45;
      ub.onclick = () => { if (Profile.coins < cost) { toast('Not enough coins — smash pots & salvage gear!'); return; } Profile.coins -= cost; it.p++; saveProfile(); pushStats(); sfx('lvl'); renderInv(); };
      acts.appendChild(ub);
    }
    box.appendChild(el);
  }
}
$('invBtn').onclick = () => openInv();
$('invClose').onclick = () => $('inv').classList.add('hidden');

// ---------- pause ----------
function updatePauseLabels() {
  $('lowBtn').textContent = '🔋 Battery saver: ' + (lowPower ? 'ON' : 'OFF');
  $('sndBtn').textContent = (soundOn ? '🔊' : '🔇') + ' Sound: ' + (soundOn ? 'ON' : 'OFF');
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
  const it = equipped();
  $('heroStat').innerHTML = `⭐ Level ${Profile.lvl} · 🏆 Best floor ${Profile.best} · 🪙 ${Profile.coins}<br>${WEAPONS[it.w].icon} <span style="color:${RAR[it.r].c}">${esc(it.n)}</span> (Power ${itemPower(it)})`;
  // checkpoint floors: 1, 4, 7, ... up to best
  const chips = $('floorChips'); chips.innerHTML = '';
  const cps = []; for (let f = 1; f <= Profile.best; f += 3) cps.push(f);
  if (!cps.includes(G.startFloor)) G.startFloor = cps[cps.length - 1];
  if (cps.length > 1) {
    chips.insertAdjacentHTML('beforeend', '<span class="stat" style="margin:0 4px 0 0;align-self:center">Start at:</span>');
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

