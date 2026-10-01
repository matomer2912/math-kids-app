/* net.js - offline LAN co-op networking for the dungeon game.
 *
 * WebRTC DataChannels over a phone hotspot (no internet, no STUN).
 * Signaling is done by hand with QR codes: host shows offer QR -> guest scans,
 * guest shows answer QR -> host scans.  The QR payload is a compact string,
 * not raw SDP; each side rebuilds a minimal data-channel-only SDP.
 *
 * Needs (globals, loaded before this file): qrcode (qrcode-generator), jsQR (fallback scanner).
 * Exposes window.Net (see API at the bottom).
 */
(function () {
  'use strict';

  var MAX_GUESTS = 3;            // host + 3 guests = 4 players
  var ICE_WAIT_MS = 2500;        // non-trickle ICE gathering timeout
  var CONNECT_TIMEOUT_MS = 15000; // host: after scanning the answer
  var GUEST_WAIT_MS = 180000;    // guest: waiting for host to scan its code
  var DISCONNECT_GRACE_MS = 4000;
  var UNRELIABLE_MAX_BUFFER = 64 * 1024;

  var Net = {
    isHost: false,
    myId: null,
    onMessage: function () {},
    onPeerJoin: function () {},
    onPeerLeave: function () {}
  };

  var peers = new Map();   // id -> peer (only joined peers)
  var pairing = null;      // current pairing attempt
  var debug = { lastQR: null, state: 'idle', log: [] };

  function dlog() {
    var s = Array.prototype.slice.call(arguments).join(' ');
    debug.log.push(s);
    if (debug.log.length > 200) debug.log.shift();
    try { console.log('[net]', s); } catch (e) {}
  }
  function setState(s) { debug.state = s; dlog('state', s); }
  function safeCall(fn, a, b) {
    try { if (typeof fn === 'function') fn(a, b); } catch (e) { console.error('[net] callback error', e); }
  }

  // ------------------------------------------------------------------
  // Compact signal encoding
  //   "<T><id>|<ufrag>|<pwd>|<fp base64>|<cand>,<cand>..."
  //   T = O (offer) / A (answer); id = guest id (0..3)
  //   cand = <h|s|p|r><addr>:<port>; addr "~<22 b64url>" = <uuid>.local (mDNS)
  // ------------------------------------------------------------------
  function hexToB64(hex) {
    var h = hex.replace(/[^0-9a-f]/gi, ''), s = '';
    for (var i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.substr(i, 2), 16));
    return btoa(s).replace(/=+$/, '');
  }
  function b64ToHex(b64, sep) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = [];
    for (var i = 0; i < bin.length; i++) out.push(('0' + bin.charCodeAt(i).toString(16)).slice(-2));
    return sep == null ? out.join('') : out.join(sep).toUpperCase();
  }
  var UUID_LOCAL = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;
  function packAddr(a) {
    var m = UUID_LOCAL.exec(a);
    if (m) return '~' + hexToB64(m.slice(1).join('')).replace(/\+/g, '-').replace(/\//g, '_');
    return a;
  }
  function unpackAddr(a) {
    if (a.charAt(0) !== '~') return a;
    var h = b64ToHex(a.slice(1));
    return h.substr(0, 8) + '-' + h.substr(8, 4) + '-' + h.substr(12, 4) + '-' + h.substr(16, 4) + '-' + h.substr(20) + '.local';
  }
  function isPrivateV4(ip) {
    return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  }
  function addrRank(ip) {
    if (isPrivateV4(ip)) return 0;
    if (/\.local$/i.test(ip)) return 1;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return /^127\./.test(ip) ? 3 : 2;
    return 4; // IPv6
  }
  var TYPE_CH = { host: 'h', srflx: 's', prflx: 'p', relay: 'r' };
  var CH_TYPE = { h: 'host', s: 'srflx', p: 'prflx', r: 'relay' };

  function parseSdp(sdp) {
    var out = { ufrag: null, pwd: null, fp: null, setup: null, cands: [] };
    var seen = {};
    sdp.split(/\r?\n/).forEach(function (line) {
      var m;
      if ((m = /^a=ice-ufrag:(.+)$/.exec(line))) out.ufrag = out.ufrag || m[1].trim();
      else if ((m = /^a=ice-pwd:(.+)$/.exec(line))) out.pwd = out.pwd || m[1].trim();
      else if ((m = /^a=fingerprint:sha-256 (.+)$/i.exec(line))) out.fp = out.fp || m[1].trim();
      else if ((m = /^a=setup:(\w+)/.exec(line))) out.setup = out.setup || m[1];
      else if ((m = /^a=candidate:\S+ (\d+) (\w+) \d+ (\S+) (\d+) typ (\w+)/i.exec(line))) {
        if (m[1] !== '1' || m[2].toLowerCase() !== 'udp') return;
        var key = m[3] + ':' + m[4];
        if (seen[key]) return;
        seen[key] = 1;
        out.cands.push({ addr: m[3], port: +m[4], type: m[5] });
      }
    });
    return out;
  }

  function pickCands(cands) {
    var list = cands.filter(function (c) { return TYPE_CH[c.type]; });
    list.sort(function (a, b) { return addrRank(a.addr) - addrRank(b.addr); });
    var good = list.filter(function (c) { return addrRank(c.addr) < 3; });
    if (!good.length) good = list; // keep whatever there is (loopback / IPv6)
    return good.slice(0, 4);
  }

  function encodeSignal(kind, id, sdp) {
    var p = parseSdp(sdp);
    if (!p.ufrag || !p.pwd || !p.fp) throw new Error('bad local SDP');
    var cands = pickCands(p.cands).map(function (c) {
      return TYPE_CH[c.type] + packAddr(c.addr) + ':' + c.port;
    });
    return (kind === 'offer' ? 'O' : 'A') + id + '|' + p.ufrag + '|' + p.pwd + '|' + hexToB64(p.fp) + '|' + cands.join(',');
  }

  function decodeSignal(str) {
    if (typeof str !== 'string') return null;
    var parts = str.trim().split('|');
    if (parts.length !== 5 || !/^[OA][0-3]$/.test(parts[0])) return null;
    try {
      var cands = parts[4] ? parts[4].split(',').map(function (c) {
        var i = c.lastIndexOf(':');
        return { type: CH_TYPE[c.charAt(0)] || 'host', addr: unpackAddr(c.slice(1, i)), port: +c.slice(i + 1) };
      }) : [];
      var fp = b64ToHex(parts[3], ':');
      if (fp.length !== 95) return null;
      return {
        kind: parts[0].charAt(0) === 'O' ? 'offer' : 'answer',
        id: +parts[0].charAt(1),
        ufrag: parts[1], pwd: parts[2], fp: fp, cands: cands
      };
    } catch (e) { return null; }
  }

  var TYPE_PREF = { host: 126, prflx: 110, srflx: 100, relay: 0 };
  function buildSdp(sig) {
    var L = [
      'v=0',
      'o=- ' + (Date.now() % 1e9) + Math.floor(Math.random() * 1e9) + ' 2 IN IP4 127.0.0.1',
      's=-', 't=0 0',
      'a=group:BUNDLE 0',
      'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0'
    ];
    sig.cands.forEach(function (c, i) {
      var prio = TYPE_PREF[c.type] * 16777216 + (65535 - i) * 256 + 255;
      L.push('a=candidate:' + (i + 1) + ' 1 udp ' + prio + ' ' + c.addr + ' ' + c.port + ' typ ' + c.type + ' generation 0');
    });
    L.push(
      'a=ice-ufrag:' + sig.ufrag,
      'a=ice-pwd:' + sig.pwd,
      'a=ice-options:trickle',
      'a=fingerprint:sha-256 ' + sig.fp,
      'a=setup:' + (sig.kind === 'offer' ? 'actpass' : 'active'),
      'a=mid:0',
      'a=sctp-port:5000',
      'a=max-message-size:262144'
    );
    return L.join('\r\n') + '\r\n';
  }

  // ------------------------------------------------------------------
  // Peers
  // ------------------------------------------------------------------
  function makePeer(id) {
    var pc = new RTCPeerConnection({ iceServers: [] });
    var r = pc.createDataChannel('r', { negotiated: true, id: 0, ordered: true });
    var u = pc.createDataChannel('u', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    var peer = { id: id, pc: pc, r: r, u: u, joined: false, left: false, dcTimer: null };
    var onmsg = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      safeCall(Net.onMessage, peer.id, msg);
    };
    r.onmessage = onmsg;
    u.onmessage = onmsg;
    r.onopen = function () { onPeerOpen(peer); };
    r.onclose = function () { peerGone(peer, 'channel closed'); };
    pc.onconnectionstatechange = function () {
      var st = pc.connectionState;
      dlog('peer', peer.id, 'connectionState', st);
      if (!peer.joined) return; // pairing phase is governed by timeouts
      if (st === 'failed' || st === 'closed') peerGone(peer, st);
      else if (st === 'disconnected') {
        if (!peer.dcTimer) peer.dcTimer = setTimeout(function () {
          peer.dcTimer = null;
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') peerGone(peer, 'disconnected');
        }, DISCONNECT_GRACE_MS);
      } else if (peer.dcTimer) { clearTimeout(peer.dcTimer); peer.dcTimer = null; }
    };
    return peer;
  }

  function closePeer(peer) {
    peer.left = true;
    if (peer.dcTimer) clearTimeout(peer.dcTimer);
    try { peer.r.close(); } catch (e) {}
    try { peer.u.close(); } catch (e) {}
    try { peer.pc.close(); } catch (e) {}
  }

  function peerGone(peer, why) {
    if (peer.left) return;
    dlog('peer', peer.id, 'gone:', why);
    closePeer(peer);
    if (peers.get(peer.id) === peer) peers.delete(peer.id);
    if (peer.joined) {
      if (!Net.isHost) Net.myId = null;
      safeCall(Net.onPeerLeave, peer.id);
    } else if (pairing && pairing.peer === peer) {
      pairing.peer = null;
    }
  }

  function onPeerOpen(peer) {
    if (peer.left || peer.joined) return;
    if (!pairing || pairing.peer !== peer) { closePeer(peer); return; }
    var p = pairing;
    pairing = null;
    clearTimers(p);
    peer.joined = true;
    var old = peers.get(peer.id);
    if (old && old !== peer) closePeer(old);
    peers.set(peer.id, peer);
    hideOverlay();
    stopCamera();
    setState('connected');
    if (p.kind === 'host') {
      safeCall(Net.onPeerJoin, peer.id);
      p.resolve(peer.id);
    } else {
      Net.myId = p.id;
      p.resolve(p.id);
    }
  }

  function waitIce(pc) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') return resolve();
      var done = false;
      var finish = function () { if (!done) { done = true; resolve(); } };
      pc.addEventListener('icegatheringstatechange', function () {
        if (pc.iceGatheringState === 'complete') finish();
      });
      setTimeout(finish, ICE_WAIT_MS);
    });
  }

  function freeGuestId() {
    for (var i = 1; i <= MAX_GUESTS; i++) if (!peers.has(i)) return i;
    return 0;
  }

  function clearTimers(p) {
    if (p.timer) { clearTimeout(p.timer); p.timer = null; }
  }

  function cancelPairing(reason) {
    var p = pairing;
    if (!p) return;
    pairing = null;
    clearTimers(p);
    if (p.peer) closePeer(p.peer);
    var err = new Error(reason || 'cancelled');
    p.reject(err);
  }

  // ------------------------------------------------------------------
  // Camera + scanning
  // ------------------------------------------------------------------
  var camStream = null, camError = null, scanToken = 0, currentScan = null;

  function startCamera() {
    if (camStream && camStream.active) return Promise.resolve(camStream);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      var e = new Error('no camera API'); e.name = window.isSecureContext ? 'NotFoundError' : 'InsecureError';
      camError = e;
      return Promise.reject(e);
    }
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    }).then(function (s) {
      camError = null;
      if (camStream && camStream !== s) camStream.getTracks().forEach(function (t) { t.stop(); });
      camStream = s;
      return s;
    }, function (err) {
      camError = err;
      dlog('camera error', err && err.name, err && err.message);
      throw err;
    });
  }
  function stopCamera() {
    scanToken++;
    if (camStream) { camStream.getTracks().forEach(function (t) { t.stop(); }); camStream = null; }
  }
  function cameraErrorText(err) {
    var n = err && err.name;
    if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') return 'No camera found on this phone';
    if (n === 'InsecureError') return 'Camera needs a secure (https) page';
    if (n === 'NotReadableError') return 'Camera is busy — close other camera apps and try again';
    return 'Camera blocked — allow camera access in Chrome settings';
  }

  // Scan loop: BarcodeDetector if available, else jsQR on downscaled frames. ~10 fps.
  function startScanLoop(video) {
    var my = ++scanToken;
    var detector = null;
    try {
      if ('BarcodeDetector' in window) {
        detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        if (window.BarcodeDetector.getSupportedFormats) {
          window.BarcodeDetector.getSupportedFormats().then(function (f) {
            if (f.indexOf('qr_code') < 0) detector = null;
          }, function () { detector = null; });
        }
      }
    } catch (e) { detector = null; }
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var detectorFails = 0, frame = 0;
    function next() { if (my === scanToken) setTimeout(tick, 100); }
    function handle(text) {
      if (my !== scanToken) return;
      if (text && currentScan && currentScan(text)) return; // accepted -> stop
      next();
    }
    function tick() {
      if (my !== scanToken) return;
      if (!video.videoWidth || video.readyState < 2) return next();
      if (detector) {
        detector.detect(video).then(function (r) {
          detectorFails = 0;
          handle(r && r.length ? r[0].rawValue : null);
        }, function () {
          if (++detectorFails > 5) detector = null;
          next();
        });
        return;
      }
      if (!window.jsQR) return next();
      var w = Math.min(640, video.videoWidth), h = Math.round(video.videoHeight * w / video.videoWidth);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      var text = null;
      try {
        ctx.drawImage(video, 0, 0, w, h);
        var img = ctx.getImageData(0, 0, w, h);
        frame++;
        var res = window.jsQR(img.data, w, h, { inversionAttempts: frame % 4 === 0 ? 'attemptBoth' : 'dontInvert' });
        if (res && res.data) text = res.data;
      } catch (e) {}
      handle(text);
    }
    next();
  }

  // ------------------------------------------------------------------
  // Overlay UI
  // ------------------------------------------------------------------
  var CSS = [
    '#net-overlay{position:fixed;inset:0;z-index:1000;background:rgba(10,12,30,.94);color:#fff;',
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:none;overflow:auto;',
    '-webkit-user-select:none;user-select:none;touch-action:manipulation}',
    '#net-overlay.net-show{display:flex}',
    '#net-overlay .net-box{margin:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'gap:14px;padding:12px 16px;box-sizing:border-box;width:100%;min-height:100%}',
    '#net-overlay .net-media{flex:none;display:flex;align-items:center;justify-content:center}',
    '#net-overlay .net-side{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;max-width:560px}',
    '#net-overlay .net-step{font-size:18px;font-weight:700;color:#9fd3ff;letter-spacing:.5px}',
    '#net-overlay .net-title{font-size:30px;font-weight:800;line-height:1.15}',
    '#net-overlay .net-msg{font-size:20px;font-weight:600;line-height:1.3;color:#e8e8ff}',
    '#net-overlay .net-msg.net-err{color:#ffb4b4}',
    '#net-overlay .net-hint{font-size:16px;color:#ffe08a;font-weight:600}',
    '#net-overlay .net-small{font-size:12px;color:#8b93a7;font-family:ui-monospace,monospace}',
    '#net-overlay .net-btns{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}',
    '#net-overlay button{min-height:64px;min-width:150px;padding:10px 26px;border:0;border-radius:20px;',
    'font-size:22px;font-weight:800;color:#fff;background:#3b82f6;box-shadow:0 4px 0 rgba(0,0,0,.35);cursor:pointer}',
    '#net-overlay button:active{transform:translateY(3px);box-shadow:0 1px 0 rgba(0,0,0,.35)}',
    '#net-overlay button.net-go{background:#22c55e}',
    '#net-overlay button.net-cancel{background:#6b7280}',
    '#net-overlay canvas.net-qr{background:#fff;image-rendering:pixelated;image-rendering:crisp-edges;border-radius:8px;display:block}',
    '#net-overlay video.net-video{object-fit:cover;border-radius:16px;background:#000;border:4px solid #9fd3ff;display:block}',
    '#net-overlay .net-spin{width:72px;height:72px;border-radius:50%;border:8px solid rgba(255,255,255,.25);',
    'border-top-color:#fff;animation:netspin 1s linear infinite}',
    '@keyframes netspin{to{transform:rotate(360deg)}}',
    '@media (orientation:landscape){#net-overlay .net-box{flex-direction:row;gap:24px}',
    '#net-overlay .net-title{font-size:26px}#net-overlay .net-msg{font-size:18px}}'
  ].join('');

  var ov = null, ovView = null;

  function ensureOverlay() {
    if (ov) return ov;
    var st = document.createElement('style');
    st.id = 'net-style';
    st.textContent = CSS;
    document.head.appendChild(st);
    ov = document.createElement('div');
    ov.id = 'net-overlay';
    document.body.appendChild(ov);
    window.addEventListener('resize', function () { if (ovView && ov.classList.contains('net-show')) render(ovView); });
    return ov;
  }

  function mediaSize(square) {
    var w = window.innerWidth, h = window.innerHeight;
    if (w > h) return Math.floor(Math.min(h * 0.85, w * 0.55));
    return Math.floor(Math.min(w * 0.85, h * (square ? 0.58 : 0.5)));
  }

  function drawQR(canvas, text, cssSize) {
    var qr = null;
    var levels = ['M', 'L'];
    for (var i = 0; i < levels.length && !qr; i++) {
      try { qr = qrcode(0, levels[i]); qr.addData(text); qr.make(); } catch (e) { qr = null; }
    }
    if (!qr) return;
    var n = qr.getModuleCount(), margin = 4, total = n + margin * 2;
    var dpr = window.devicePixelRatio || 1;
    var cell = Math.max(1, Math.floor(cssSize * dpr / total));
    canvas.width = canvas.height = cell * total;
    canvas.style.width = canvas.style.height = (cell * total / dpr) + 'px';
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    }
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // view: {step, title, msg, err, hint, media:'qr'|'video'|'spin'|null, qr, buttons:[{label,cls,fn}]}
  function render(view) {
    ensureOverlay();
    ovView = view;
    ov.innerHTML = '';
    var box = el('div', 'net-box');
    if (view.media) {
      var media = el('div', 'net-media');
      var size = mediaSize(true);
      if (view.media === 'qr') {
        var cv = el('canvas', 'net-qr');
        media.appendChild(cv);
        drawQR(cv, view.qr, size);
      } else if (view.media === 'video') {
        var v = el('video', 'net-video');
        v.setAttribute('playsinline', '');
        v.setAttribute('autoplay', '');
        v.muted = true;
        v.style.width = v.style.height = Math.floor(size * 0.95) + 'px';
        media.appendChild(v);
        if (camStream) {
          v.srcObject = camStream;
          var pp = v.play();
          if (pp && pp.catch) pp.catch(function () {});
          startScanLoop(v);
        }
      } else if (view.media === 'spin') {
        media.appendChild(el('div', 'net-spin'));
      }
      box.appendChild(media);
    }
    var side = el('div', 'net-side');
    if (view.step) side.appendChild(el('div', 'net-step', view.step));
    if (view.title) side.appendChild(el('div', 'net-title', view.title));
    if (view.msg) side.appendChild(el('div', 'net-msg' + (view.err ? ' net-err' : ''), view.msg));
    if (view.hint) side.appendChild(el('div', 'net-hint', view.hint));
    if (view.buttons && view.buttons.length) {
      var btns = el('div', 'net-btns');
      view.buttons.forEach(function (b) {
        var bt = el('button', b.cls || '', b.label);
        bt.type = 'button';
        bt.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); b.fn(); });
        btns.appendChild(bt);
      });
      side.appendChild(btns);
    }
    if (view.small) side.appendChild(el('div', 'net-small', view.small));
    box.appendChild(side);
    ov.appendChild(box);
    ov.classList.add('net-show');
  }

  function hideOverlay() {
    scanToken++;
    currentScan = null;
    ovView = null;
    if (ov) { ov.classList.remove('net-show'); ov.innerHTML = ''; }
  }

  function flashMsg(text) {
    if (!ovView) return;
    var m = ov.querySelector('.net-msg');
    if (!m) { m = el('div', 'net-msg'); var s = ov.querySelector('.net-side'); if (s) s.insertBefore(m, s.querySelector('.net-btns')); }
    m.textContent = text;
    m.classList.add('net-err');
  }

  function playerName(id) { return 'Player ' + (id + 1); }

  // Tiny diagnostics line for the QR screens (helps debug Wi-Fi problems in the field).
  function netInfo(payload) {
    var sig = decodeSignal(payload);
    if (!sig || !sig.cands.length) return 'Network: none found (is Wi-Fi / hotspot on?)';
    return 'Network: ' + sig.cands.map(function (c) {
      return /\.local$/.test(c.addr) ? 'hidden' : c.addr;
    }).join(', ') + (camError ? ' · no camera' : '');
  }
  function buzz() { try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) {} }

  // ------------------------------------------------------------------
  // Host pairing flow
  // ------------------------------------------------------------------
  function hostAddPlayer() {
    if (!Net.isHost) Net.hostStart();
    cancelPairing('replaced');
    var id = freeGuestId();
    return new Promise(function (resolve, reject) {
      if (!id) {
        render({
          title: 'Game is full', msg: 'Up to 4 players can play together.',
          buttons: [{ label: 'OK', cls: 'net-go', fn: function () { hideOverlay(); } }]
        });
        reject(new Error('full'));
        return;
      }
      var p = { kind: 'host', id: id, peer: null, timer: null, resolve: resolve, reject: reject };
      pairing = p;
      hostMakeOffer(p);
    });
  }

  function cancelButton(p) {
    return { label: 'Cancel', cls: 'net-cancel', fn: function () { if (pairing === p) { cancelPairing('cancelled'); } hideOverlay(); stopCamera(); } };
  }

  function hostMakeOffer(p) {
    if (pairing !== p) return;
    clearTimers(p);
    if (p.peer) { closePeer(p.peer); p.peer = null; }
    currentScan = null;
    setState('host-preparing');
    render({ step: 'Adding ' + playerName(p.id), title: 'Getting ready…', media: 'spin', buttons: [cancelButton(p)] });
    // Camera first: with camera permission Chrome reveals real LAN IPs instead of mDNS names.
    startCamera().catch(function () {}).then(function () {
      if (pairing !== p) return;
      var peer = makePeer(p.id);
      p.peer = peer;
      return peer.pc.createOffer().then(function (o) {
        return peer.pc.setLocalDescription(o);
      }).then(function () { return waitIce(peer.pc); }).then(function () {
        if (pairing !== p || p.peer !== peer) return;
        var payload = encodeSignal('offer', p.id, peer.pc.localDescription.sdp);
        debug.lastQR = payload;
        dlog('offer payload', payload.length, payload);
        currentScan = function (text) { return hostOnScan(p, text); };
        hostShowOffer(p, payload);
      });
    }).catch(function (err) {
      dlog('offer error', err);
      if (pairing === p) hostError(p, 'Something went wrong setting up. Try again.');
    });
  }

  function hostShowOffer(p, payload) {
    setState('host-show-offer');
    render({
      step: 'Step 1 of 2 — ' + playerName(p.id) + ' scans this code',
      title: playerName(p.id) + ': scan this code',
      msg: 'On their phone: tap "Join game" and point the camera here.',
      hint: 'Everyone must be on your phone\'s hotspot Wi-Fi',
      media: 'qr', qr: payload, small: netInfo(payload),
      buttons: [
        { label: 'Next: scan their code', cls: 'net-go', fn: function () { hostScanStep(p); } },
        cancelButton(p)
      ]
    });
  }

  function hostScanStep(p) {
    if (pairing !== p) return;
    setState('host-scan');
    var scanView = {
      step: 'Step 2 of 2 — Scan their code',
      title: 'Point your camera at ' + playerName(p.id) + '\'s code',
      media: 'video',
      buttons: [
        { label: 'Back', fn: function () { if (pairing === p) hostShowOffer(p, debug.lastQR); } },
        cancelButton(p)
      ]
    };
    render({ step: scanView.step, title: 'Starting camera…', media: 'spin', buttons: scanView.buttons });
    startCamera().then(function () {
      if (pairing === p && debug.state === 'host-scan') render(scanView);
    }, function (err) {
      if (pairing !== p || debug.state !== 'host-scan') return;
      render({
        step: scanView.step, title: 'Camera problem', msg: cameraErrorText(err), err: true,
        buttons: [{ label: 'Retry', cls: 'net-go', fn: function () { hostScanStep(p); } }, cancelButton(p)]
      });
    });
  }

  function hostOnScan(p, text) {
    if (pairing !== p || !p.peer) return false;
    var sig = decodeSignal(text);
    if (!sig) { flashMsg('That\'s not a game code — try again'); return false; }
    if (sig.kind !== 'answer') { flashMsg('That\'s your own code — scan the code on ' + playerName(p.id) + '\'s phone'); return false; }
    if (sig.id !== p.id) { flashMsg('That code is for ' + playerName(sig.id) + ' — scan again'); return false; }
    currentScan = null;
    scanToken++;
    buzz();
    setState('host-connecting');
    render({ step: 'Almost there', title: 'Connecting to ' + playerName(p.id) + '…', media: 'spin', buttons: [cancelButton(p)] });
    var peer = p.peer;
    peer.pc.setRemoteDescription({ type: 'answer', sdp: buildSdp(sig) }).catch(function (err) {
      dlog('setRemote(answer) failed', err);
      if (pairing === p && p.peer === peer) hostError(p, 'That code didn\'t work. Tap Retry and scan again.');
    });
    p.timer = setTimeout(function () {
      if (pairing === p && p.peer === peer && !peer.joined) {
        hostError(p, 'Couldn\'t connect — are both phones on the same hotspot Wi-Fi?');
      }
    }, CONNECT_TIMEOUT_MS);
    return true;
  }

  function hostError(p, msg) {
    clearTimers(p);
    currentScan = null;
    setState('error');
    render({
      title: 'Oops!', msg: msg, err: true,
      hint: 'Retry makes a new code. On ' + playerName(p.id) + '\'s phone tap "Start over".',
      buttons: [{ label: 'Retry', cls: 'net-go', fn: function () { hostMakeOffer(p); } }, cancelButton(p)]
    });
  }

  // ------------------------------------------------------------------
  // Guest pairing flow
  // ------------------------------------------------------------------
  function joinGame() {
    cancelPairing('replaced');
    // Leaving any previous host connection.
    peers.forEach(function (peer) { closePeer(peer); });
    peers.clear();
    Net.isHost = false;
    Net.myId = null;
    return new Promise(function (resolve, reject) {
      var p = { kind: 'guest', id: null, peer: null, timer: null, resolve: resolve, reject: reject };
      pairing = p;
      guestScanStep(p);
    });
  }

  function guestScanStep(p) {
    if (pairing !== p) return;
    clearTimers(p);
    if (p.peer) { closePeer(p.peer); p.peer = null; }
    setState('guest-scan');
    currentScan = function (text) { return guestOnScan(p, text); };
    var scanView = {
      step: 'Step 1 of 2 — Scan the host\'s code',
      title: 'Point your camera at the code on the host\'s phone',
      media: 'video',
      buttons: [cancelButton(p)]
    };
    render({ step: scanView.step, title: 'Starting camera…', media: 'spin', buttons: scanView.buttons });
    startCamera().then(function () {
      if (pairing === p && debug.state === 'guest-scan') render(scanView);
    }, function (err) {
      if (pairing !== p || debug.state !== 'guest-scan') return;
      render({
        step: scanView.step, title: 'Camera problem', msg: cameraErrorText(err), err: true,
        buttons: [{ label: 'Retry', cls: 'net-go', fn: function () { guestScanStep(p); } }, cancelButton(p)]
      });
    });
  }

  function guestOnScan(p, text) {
    if (pairing !== p || debug.state !== 'guest-scan') return false;
    var sig = decodeSignal(text);
    if (!sig) { flashMsg('That\'s not a game code — try again'); return false; }
    if (sig.kind !== 'offer' || sig.id < 1) { flashMsg('Scan the code on the host\'s phone'); return false; }
    currentScan = null;
    scanToken++;
    buzz();
    p.id = sig.id;
    setState('guest-preparing');
    render({ step: 'You are ' + playerName(sig.id), title: 'Making your code…', media: 'spin', buttons: [cancelButton(p)] });
    var peer = makePeer(0); // guest's only peer is the host (id 0)
    p.peer = peer;
    // Keep camera stream alive during ICE gathering so Chrome exposes real LAN IPs.
    var camReady = camStream ? Promise.resolve() : startCamera().catch(function () {});
    camReady.then(function () {
      if (pairing !== p || p.peer !== peer) return;
      return peer.pc.setRemoteDescription({ type: 'offer', sdp: buildSdp(sig) })
        .then(function () { return peer.pc.createAnswer(); })
        .then(function (a) { return peer.pc.setLocalDescription(a); })
        .then(function () { return waitIce(peer.pc); })
        .then(function () {
          if (pairing !== p || p.peer !== peer) return;
          if (peer.joined) return;
          var payload = encodeSignal('answer', sig.id, peer.pc.localDescription.sdp);
          debug.lastQR = payload;
          dlog('answer payload', payload.length, payload);
          setState('guest-show-answer');
          render({
            step: 'Step 2 of 2 — Show this to the host',
            title: 'Show this to the host',
            msg: 'You are ' + playerName(sig.id) + '. Waiting for the host to scan…',
            media: 'qr', qr: payload, small: netInfo(payload),
            buttons: [{ label: 'Start over', fn: function () { guestScanStep(p); } }, cancelButton(p)]
          });
          p.timer = setTimeout(function () {
            if (pairing === p && p.peer === peer && !peer.joined) guestError(p, 'Couldn\'t connect — are both phones on the same hotspot Wi-Fi?');
          }, GUEST_WAIT_MS);
        });
    }).catch(function (err) {
      dlog('answer error', err);
      if (pairing === p) guestError(p, 'That code didn\'t work. Ask the host for a new code.');
    });
    return true;
  }

  function guestError(p, msg) {
    clearTimers(p);
    currentScan = null;
    setState('error');
    render({
      title: 'Oops!', msg: msg, err: true,
      buttons: [{ label: 'Retry', cls: 'net-go', fn: function () { guestScanStep(p); } }, cancelButton(p)]
    });
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------
  Net.peerIds = function () {
    var ids = [];
    peers.forEach(function (peer, id) { if (peer.joined && !peer.left) ids.push(id); });
    return ids.sort();
  };

  Net.hostStart = function () {
    if (!Net.isHost) {
      peers.forEach(function (peer) { closePeer(peer); });
      peers.clear();
    }
    Net.isHost = true;
    Net.myId = 0;
  };

  Net.hostAddPlayer = hostAddPlayer;
  Net.joinGame = joinGame;

  function sendTo(peer, msg, reliable) {
    if (!peer || peer.left) return false;
    var ch = reliable === false ? peer.u : peer.r;
    if (!ch || ch.readyState !== 'open') return false;
    if (reliable === false && ch.bufferedAmount > UNRELIABLE_MAX_BUFFER) return false;
    try { ch.send(JSON.stringify(msg)); return true; } catch (e) { return false; }
  }

  Net.send = function (toId, msg, reliable) {
    var peer = Net.isHost ? peers.get(toId) : peers.get(0);
    return sendTo(peer, msg, reliable !== false);
  };

  Net.broadcast = function (msg, reliable) {
    var data = JSON.stringify(msg), ok = 0;
    peers.forEach(function (peer) {
      if (peer.left) return;
      var ch = reliable === false ? peer.u : peer.r;
      if (!ch || ch.readyState !== 'open') return;
      if (reliable === false && ch.bufferedAmount > UNRELIABLE_MAX_BUFFER) return;
      try { ch.send(data); ok++; } catch (e) {}
    });
    return ok;
  };

  Net.closeOverlay = function () {
    cancelPairing('cancelled');
    hideOverlay();
    stopCamera();
  };

  Net.disconnect = function () {
    cancelPairing('disconnected');
    hideOverlay();
    stopCamera();
    peers.forEach(function (peer) { closePeer(peer); });
    peers.clear();
    Net.isHost = false;
    Net.myId = null;
    setState('idle');
  };

  // Close connections cleanly when the page goes away so the other side notices fast.
  window.addEventListener('pagehide', function (e) {
    if (e.persisted) return;
    peers.forEach(function (peer) { closePeer(peer); });
  });

  debug.injectScan = function (str) { return currentScan ? !!currentScan(String(str)) : false; };
  debug.encode = encodeSignal;
  debug.decode = decodeSignal;
  debug.buildSdp = buildSdp;
  debug.parseSdp = parseSdp;
  debug.peers = peers;
  Net._debug = debug;

  window.Net = Net;
})();
