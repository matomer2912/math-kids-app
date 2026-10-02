/* net.js - co-op networking for the dungeon game.
 *
 * WebRTC DataChannels: one RTCPeerConnection per guest with two negotiated channels,
 * 'r' (reliable, ordered) and 'u' (unreliable: unordered, maxRetransmits 0).
 * Two ways to connect:
 *  1. Room code (needs signal at join time). The host registers "desertdungeons-<CODE>-host"
 *     on the free PeerJS cloud signaling server; guests type the 4-letter code, scan the lobby
 *     QR, or open the #join=CODE link. PeerJS only relays the SDP/ICE messages; the data path
 *     is our own RTCPeerConnection (direct over the hotspot LAN, via STUN, or a TURN relay).
 *  2. Offline QR (no signal needed): host shows offer QR -> guest scans,
 *     guest shows answer QR -> host scans. The QR payload is a compact string,
 *     not raw SDP; each side rebuilds a minimal data-channel-only SDP.
 *
 * Needs (globals, loaded before this file): qrcode (qrcode-generator), jsQR (fallback scanner),
 * Peer (lib/peerjs.min.js; only used for room codes).
 * Exposes window.Net (see API at the bottom).
 */
(function () {
  'use strict';

  var MAX_GUESTS = 3;            // host + 3 guests = 4 players
  var ICE_WAIT_MS = 2500;        // non-trickle ICE gathering timeout (offline)
  var ICE_WAIT_ONLINE_MS = 4000; // when online, give STUN/TURN time to answer
  // Public helper servers so phones on different mobile networks can find each other.
  // Unreachable servers (e.g. no signal in the desert) are simply skipped after the timeout.
  // Public helper servers so phones on different networks (home Wi-Fi + mobile data) can find each other.
  // STUN tells a phone its public address; TURN relays the game traffic when the routers can't be
  // punched through (mobile carrier NAT, Wi-Fi with client isolation). Unreachable servers (no signal in
  // the desert) are skipped: ICE gathering never waits longer than the caps below.
  //  - PeerJS's own free TURN (the PeerJS library's default iceServers, user peerjs / peerjsp)
  //  - freestun.net (free/free)
  //  (openrelay.metered.ca's shared "openrelayproject" login was retired: it needs a per-app key now.)
  var ICE_STUN = { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] };
  var ICE_TURN = [
    { name: 'PeerJS TURN', urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478', 'turn:eu-0.turn.peerjs.com:3478?transport=tcp'], username: 'peerjs', credential: 'peerjsp' },
    { name: 'freestun.net TURN', urls: ['turn:freestun.net:3478', 'turn:freestun.net:3478?transport=tcp'], username: 'free', credential: 'free' }
  ];
  function iceEntry(e) { var o = { urls: e.urls }; if (e.username) { o.username = e.username; o.credential = e.credential; } return o; }
  var ICE_SERVERS = [ICE_STUN].concat(ICE_TURN.map(iceEntry));
  function isOnline() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
  var CONNECT_TIMEOUT_MS = 20000; // host: after scanning the answer
  var GUEST_WAIT_MS = 180000;    // guest: waiting for host to scan its code
  var DISCONNECT_GRACE_MS = 4000;
  var PEER_TIMEOUT_MS = 10000;   // nothing received for this long -> the connection is dead
  var KEEPALIVE_MS = 1000;       // send a tiny 'k' on the reliable channel when idle
  var UNRELIABLE_MAX_BUFFER = 64 * 1024;
  // Room codes
  var ROOM_PREFIX = 'desertdungeons-';
  var CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I / L / O and no digits: easy to read and type
  var ROOM_JOIN_MS = 25000;      // guest: one whole join attempt
  var ROOM_HOST_SESS_MS = 25000; // host: one guest's connection attempt

  var Net = {
    isHost: false,
    myId: null,
    roomCode: null,
    onMessage: function () {},
    onPeerJoin: function () {},
    onPeerLeave: function () {},
    onRoomStatus: function () {},
    onJoinStatus: function () {}
  };

  var peers = new Map();   // id -> peer (only joined peers)
  var pairing = null;      // current pairing attempt (QR host/guest, or room guest)
  var debug = { lastQR: null, state: 'idle', log: [], sigServer: null };

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
      else if ((m = /^a=candidate:\S+ (\d+) (\w+) (\d+) (\S+) (\d+) typ (\w+)/i.exec(line))) {
        if (m[1] !== '1' || m[2].toLowerCase() !== 'udp') return;
        var key = m[4] + ':' + m[5];
        if (seen[key]) return;
        seen[key] = 1;
        out.cands.push({ addr: m[4], port: +m[5], type: m[6], prio: +m[3] });
      }
    });
    return out;
  }

  function isGlobalV6(ip) { return ip.indexOf(':') >= 0 && !/^(fe80|fc|fd|::1)/i.test(ip); }
  function pickCands(cands) {
    var list = cands.filter(function (c) { return TYPE_CH[c.type]; });
    // Chrome's own priority already prefers Wi-Fi/Ethernet over mobile data: keep that order inside a rank
    list.sort(function (a, b) { return addrRank(a.addr) - addrRank(b.addr) || (b.prio || 0) - (a.prio || 0); });
    // LAN / hotspot addresses first (direct, fastest). Up to 3: a phone can have Wi-Fi + hotspot + mobile data.
    var host = list.filter(function (c) { return c.type === 'host' && addrRank(c.addr) < 3; }).slice(0, 3);
    // a global IPv6 address can connect two phones on mobile data directly
    var v6 = list.filter(function (c) { return c.type === 'host' && isGlobalV6(c.addr); }).slice(0, 1);
    // public address seen by STUN (works through many home/mobile routers)
    var srflx = list.filter(function (c) { return c.type === 'srflx' || c.type === 'prflx'; }).slice(0, 1);
    // relayed address from TURN (works almost everywhere, a bit slower); prefer two different relay servers
    var relayAll = list.filter(function (c) { return c.type === 'relay' && !/:/.test(c.addr); }), relay = [];
    relayAll.forEach(function (c) { if (relay.length < 2 && !relay.some(function (r) { return r.addr === c.addr; })) relay.push(c); });
    relayAll.forEach(function (c) { if (relay.length < 2 && relay.indexOf(c) < 0) relay.push(c); });
    var out = host.concat(v6, srflx, relay);
    if (!out.length) out = list.slice(0, 4); // keep whatever there is (loopback etc.)
    return out;
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
      L.push('a=candidate:' + (i + 1) + ' 1 udp ' + prio + ' ' + c.addr + ' ' + c.port + ' typ ' + c.type + (c.type === 'host' ? '' : ' raddr 0.0.0.0 rport 0') + ' generation 0');
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
  function makePeer(id, forceIce) {
    var pc = new RTCPeerConnection({ iceServers: forceIce || isOnline() ? ICE_SERVERS : [] });
    var r = pc.createDataChannel('r', { negotiated: true, id: 0, ordered: true });
    var u = pc.createDataChannel('u', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    var now = Date.now();
    var peer = {
      id: id, pc: pc, r: r, u: u, joined: false, left: false, dcTimer: null,
      lastRecv: now, lastSent: now, rx: 0, tx: 0, via: 'qr', did: null
    };
    var onmsg = function (e) {
      if (peer.left) return;
      peer.lastRecv = Date.now();
      var d = e.data;
      if (typeof d === 'string') peer.rx += d.length;
      if (d === 'k') return; // keepalive
      var msg;
      try { msg = JSON.parse(d); } catch (err) { return; }
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
    peer.pc.onicecandidate = null;
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
    } else if (peer.sess) {
      dropSess(peer.sess);
    }
  }

  function onPeerOpen(peer) {
    if (peer.left || peer.joined) return;
    if (peer.sess) { hostSessOpen(peer); return; }
    if (!pairing || pairing.peer !== peer) { closePeer(peer); return; }
    var p = pairing;
    pairing = null;
    clearTimers(p);
    peer.joined = true;
    var old = peers.get(peer.id);
    if (old && old !== peer) closePeer(old);
    peers.set(peer.id, peer);
    peer.lastRecv = Date.now();
    if (p.kind !== 'room') { hideOverlay(); stopCamera(); }
    setState('connected');
    if (p.kind === 'host') {
      safeCall(Net.onPeerJoin, peer.id);
      p.resolve(peer.id);
    } else {
      Net.myId = p.id;
      if (p.bus) { var bus = p.bus; setTimeout(function () { bus.destroy(); }, 3000); }
      p.resolve(p.id);
    }
  }

  // Non-trickle gathering for the QR codes: stop at 'complete', or as soon as we have a LAN address plus
  // a public (STUN) and a relay (TURN) address, or at the cap (dead servers never stall the QR screen).
  function waitIce(pc) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') return resolve();
      var done = false, t0 = Date.now(), have = {};
      var finish = function () { if (!done) { done = true; resolve(); } };
      pc.addEventListener('icegatheringstatechange', function () {
        if (pc.iceGatheringState === 'complete') finish();
      });
      pc.addEventListener('icecandidate', function (e) {
        if (!e.candidate) { finish(); return; }
        var m = / typ (\w+)/.exec(e.candidate.candidate || '');
        if (m) have[m[1]] = (have[m[1]] || 0) + 1;
        if (have.host && have.srflx && have.relay >= 2) setTimeout(finish, 250);
        else if (have.host && have.srflx && have.relay) setTimeout(finish, Math.max(300, 1500 - (Date.now() - t0)));
      });
      setTimeout(finish, isOnline() ? ICE_WAIT_ONLINE_MS : ICE_WAIT_MS);
    });
  }

  // Guest ids 1..3. Ids held by a connected peer, a pending room join or the QR pairing are taken;
  // ids remembered for another device (so it can rejoin with the same slot) are used last.
  function idBusy(i, did) {
    var pe = peers.get(i);
    if (pe && !(did && pe.did === did)) return true;
    if (pairing && pairing.kind === 'host' && pairing.id === i) return true;
    var busy = false;
    roomSess.forEach(function (s) { if (s.id === i && s.did !== did) busy = true; });
    return busy;
  }
  function freeGuestId(did) {
    var i, remembered = {};
    Object.keys(didToId).forEach(function (d) { if (d !== did) remembered[didToId[d]] = 1; });
    for (i = 1; i <= MAX_GUESTS; i++) if (!idBusy(i, did) && !peers.has(i) && !remembered[i]) return i;
    for (i = 1; i <= MAX_GUESTS; i++) if (!idBusy(i, did) && !peers.has(i)) return i;
    return 0;
  }

  function clearTimers(p) {
    if (p.timer) { clearTimeout(p.timer); p.timer = null; }
    if (p.joinT) { clearInterval(p.joinT); p.joinT = null; }
    if (p.cqT) { clearTimeout(p.cqT); p.cqT = null; }
  }

  function cancelPairing(reason) {
    var p = pairing;
    if (!p) return;
    pairing = null;
    clearTimers(p);
    if (p.bus) p.bus.destroy();
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
    return 'Camera blocked. In Chrome tap the 🔒 next to the web address → Permissions → Camera → Allow, then Retry';
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
    var detectorFails = 0, frame = 0, t0 = Date.now();
    function next() { if (my === scanToken) setTimeout(tick, 100); }
    function handle(text) {
      if (my !== scanToken) return;
      if (text && currentScan && currentScan(text)) return; // accepted -> stop
      next();
    }
    function tick() {
      if (my !== scanToken) return;
      if (!video.videoWidth || video.readyState < 2) return next();
      frame++;
      // Some Android phones have a BarcodeDetector that never finds anything (its scanner module isn't
      // downloaded yet): after 1.5 s without a hit, every other frame goes through jsQR as well.
      if (detector && !(window.jsQR && Date.now() - t0 > 1500 && frame % 2 === 0)) {
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
        var res = window.jsQR(img.data, w, h, { inversionAttempts: frame % 4 === 1 ? 'attemptBoth' : 'dontInvert' });
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
    '#net-overlay .net-small{font-size:12px;color:#8b93a7;font-family:ui-monospace,monospace;white-space:pre-line;word-break:break-word}',
    '#net-overlay .net-list{display:grid;grid-template-columns:1fr;gap:3px 14px;text-align:left;width:100%;max-width:760px}',
    '#net-overlay .net-li{font-size:15px;line-height:1.25;color:#e8e8ff;display:flex;gap:6px;align-items:baseline}',
    '#net-overlay .net-li b{font-weight:700;white-space:nowrap}#net-overlay .net-li span{color:#aab3c8;font-size:13px}',
    '#net-overlay .net-box.net-wide .net-side{max-width:820px;width:100%}',
    '#net-overlay .net-verdict{font-size:18px;font-weight:800;line-height:1.25;color:#fff;background:rgba(255,255,255,.08);border-radius:12px;padding:6px 12px}',
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
    '#net-overlay .net-title{font-size:26px}#net-overlay .net-msg{font-size:18px}',
    '#net-overlay .net-list{grid-template-columns:1fr 1fr}#net-overlay .net-wide .net-side{gap:8px}',
    '#net-overlay .net-wide button{min-height:48px;font-size:18px;padding:6px 18px}}'
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
    if (view.list) box.classList.add('net-wide');
    if (view.step) side.appendChild(el('div', 'net-step', view.step));
    if (view.title) side.appendChild(el('div', 'net-title', view.title));
    if (view.list) {
      var ul = el('div', 'net-list');
      view.list.forEach(function (it) {
        var li = el('div', 'net-li');
        li.appendChild(el('b', null, (ICON[it.ok] || '⏳') + ' ' + it.label));
        if (it.detail) li.appendChild(el('span', null, it.detail));
        ul.appendChild(li);
      });
      side.appendChild(ul);
    }
    if (view.verdict) side.appendChild(el('div', 'net-verdict', view.verdict));
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

  var ICON = { 'true': '✅', 'false': '❌', warn: '⚠️', info: 'ℹ️' };
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

  // Diagnostics line for the QR screens: which addresses this phone found (helps fix Wi-Fi problems).
  function candSummary(sig) {
    var lan = [], hidden = 0, v6 = 0, pub = null, relay = 0;
    sig.cands.forEach(function (c) {
      if (c.type === 'relay') relay++;
      else if (c.type === 'srflx' || c.type === 'prflx') pub = pub || c.addr;
      else if (/\.local$/.test(c.addr)) hidden++;
      else if (c.addr.indexOf(':') >= 0) v6++;
      else lan.push(c.addr);
    });
    return { lan: lan, hidden: hidden, v6: v6, pub: pub, relay: relay };
  }
  function netInfo(payload) {
    var sig = decodeSignal(payload);
    if (!sig || !sig.cands.length) return '⚠️ No network found — turn on Wi-Fi or the hotspot';
    var c = candSummary(sig), parts = [];
    if (c.lan.length) parts.push('📶 Wi-Fi ' + c.lan.join(', '));
    else if (c.hidden) parts.push('📶 Wi-Fi (address hidden' + (camError ? ': allow the camera' : '') + ')');
    if (c.v6) parts.push('IPv6');
    parts.push(c.pub ? '🌍 internet ✓' : '🌍 no internet');
    parts.push(c.relay ? '🔁 relay ✓' : '🔁 no relay');
    var s = 'Found: ' + parts.join(' · ');
    if (!c.lan.length && !c.hidden && !c.v6) s += ' — ⚠️ no Wi-Fi address';
    else if (!c.pub && !c.relay) s += ' — same Wi-Fi/hotspot needed';
    return s + (camError ? ' · no camera' : '');
  }
  // Why a QR pairing didn't connect, from both phones' address lists (host side has both).
  function sameNet(a, b) { return a.split('.').slice(0, 3).join('.') === b.split('.').slice(0, 3).join('.'); }
  function qrFailHint(offer, answer) {
    var a = offer && decodeSignal(offer), b = answer && decodeSignal(answer);
    if (!a || !b) return 'Couldn\'t connect. Put both phones on the same Wi-Fi or Dad\'s hotspot, then Retry.';
    var ca = candSummary(a), cb = candSummary(b);
    var same = ca.lan.some(function (x) { return cb.lan.some(function (y) { return sameNet(x, y); }); });
    if (same && !(ca.relay && cb.relay)) return 'Both phones are on the same Wi-Fi but it doesn\'t let phones talk to each other (guest Wi-Fi?). Use Dad\'s hotspot instead, then Retry.';
    if (!ca.pub && !ca.relay || !cb.pub && !cb.relay) return 'The phones are on different networks without internet. Put everyone on the same Wi-Fi or Dad\'s hotspot, then Retry.';
    return 'Couldn\'t connect through the internet. Try: same Wi-Fi or Dad\'s hotspot for everyone, or mobile data off/on, then Retry.';
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
    debug.lastAnswer = null;
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
      msg: 'On their phone: Join → "Offline QR join" → point the camera here. When their phone shows a code, tap Next.',
      hint: camError ? '📷 ' + cameraErrorText(camError) : 'Works best with every phone on the same Wi-Fi or Dad\'s hotspot.',
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
    var peer = p.peer, offer = debug.lastQR;
    debug.lastAnswer = text;
    dlog('scanned answer', text);
    var failNow = function () {
      if (pairing === p && p.peer === peer && !peer.joined) hostError(p, qrFailHint(offer, text));
    };
    peer.pc.setRemoteDescription({ type: 'answer', sdp: buildSdp(sig) }).catch(function (err) {
      dlog('setRemote(answer) failed', err);
      if (pairing === p && p.peer === peer) hostError(p, 'That code didn\'t work. Tap Retry and scan again.');
    });
    peer.pc.addEventListener('connectionstatechange', function () { if (peer.pc.connectionState === 'failed') failNow(); });
    p.timer = setTimeout(failNow, CONNECT_TIMEOUT_MS);
    return true;
  }

  function hostError(p, msg) {
    clearTimers(p);
    currentScan = null;
    setState('error');
    render({
      title: 'Oops!', msg: msg, err: true,
      hint: 'Retry makes a new code. On ' + playerName(p.id) + '\'s phone tap "Start over".',
      small: debug.lastAnswer ? 'Host ' + netInfo(debug.lastQR) + '\n' + playerName(p.id) + ' ' + netInfo(debug.lastAnswer) : '',
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
    if (!sig) { flashMsg(codeFromText(text) ? 'That\'s the room-code QR — type the code in the Join screen instead (or ask the host for the QR pairing code)' : 'That\'s not a game code — try again'); return false; }
    if (sig.kind !== 'offer' || sig.id < 1) { flashMsg('That\'s a player\'s code — scan the code on the host\'s phone'); return false; }
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
            msg: 'You are ' + playerName(sig.id) + '. The host taps "Next: scan their code" and points the camera here…',
            media: 'qr', qr: payload, small: 'Host ' + netInfo(text) + '\nYou: ' + netInfo(payload).replace(/^Found: /, ''),
            buttons: [{ label: 'Start over', fn: function () { guestScanStep(p); } }, cancelButton(p)]
          });
          p.timer = setTimeout(function () {
            if (pairing === p && p.peer === peer && !peer.joined) guestError(p, 'Couldn\'t connect. Did the host scan your code? Put both phones on the same Wi-Fi or Dad\'s hotspot, then Retry.');
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
  // Room codes: signaling transports
  //   Several independent free servers carry the tiny join/offer/answer/candidate messages, all at
  //   the same time: the host listens on every one, a guest asks on every one, and whichever reaches
  //   the other side first is used. One dead or blocked server can't break room codes any more.
  //    - PeerJS cloud (0.peerjs.com): our payloads ride in its relayed OFFER messages (payload.type 'dd',
  //      which the PeerJS client itself ignores). Only its server connection is used.
  //    - WebTorrent WebSocket trackers: everyone "announces" into a swarm named after the room
  //      (info_hash = hash of 'desertdungeons-v1-<CODE>'; host = seeder, guests = leechers). A guest's
  //      join rides in "offers" that the tracker forwards into the swarm; messages to a known peer ride
  //      in "answers" (to_peer_id). Our JSON sits in the sdp field: {type:'offer'|'answer', sdp:'DD1{...}'}.
  //    - Public MQTT brokers (MQTT 3.1.1 over WebSocket, minimal client below): one topic per player,
  //      plus a retained "host is here" topic that the broker clears if the host vanishes (last will).
  //   transport = factory(cfg, code, me, {onOpen(), onMsg(from, payload), onPresence(hostHere), onClose(why)})
  //   me / from are logical ids: 'host' or a guest's random id; transport.send(to, payload); .destroy()
  //   Test overrides: ?sig=host:port (local PeerServer), ?trk=ws://..., ?mqtt=ws://... (comma lists; when
  //   any is given, only those are used), or Net._debug.sigConfig / Net._debug.makeTransport.
  // ------------------------------------------------------------------
  var SIG_TRACKERS = ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev', 'wss://tracker.files.fm:7073/announce'];
  var SIG_MQTT = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
  var SIG_NS = 'desertdungeons-v1-';
  var SIG_CONNECT_MS = 8000;     // a server that hasn't answered by then counts as down (and is retried)
  var ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  function rnd(n, abc) {
    abc = abc || 'abcdefghijkmnpqrstuvwxyz23456789';
    var s = '', a = new Uint32Array(n);
    try { crypto.getRandomValues(a); } catch (e) { for (var j = 0; j < n; j++) a[j] = Math.floor(Math.random() * 1e9); }
    for (var i = 0; i < n; i++) s += abc.charAt(a[i] % abc.length);
    return s;
  }
  // 20 hex chars (80 bits) from a string: the tracker swarm id / MQTT topic of a room. Same on every phone.
  function hash20(str) {
    var out = '';
    for (var seed = 1; seed <= 3; seed++) {
      var h = (0x811c9dc5 ^ Math.imul(seed, 0x9e3779b9)) >>> 0;
      for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
      out += ('0000000' + (h >>> 0).toString(16)).slice(-8);
    }
    return out.slice(0, 20);
  }
  function urlParam(k) {
    var m = new RegExp('[?&]' + k + '=([^&#]+)').exec(location.search || '');
    return m ? decodeURIComponent(m[1]) : null;
  }
  function shortHost(u) {
    var m = /^\w+:\/\/([^\/?#]+)/.exec(u), h = m ? m[1] : u, hn = h.replace(/:\d+$/, '');
    if (/^[\d.]+$/.test(hn) || hn === 'localhost') return h;
    var parts = hn.split('.');
    return parts.length > 2 ? parts.slice(1).join('.') : hn;
  }
  function sigConfigs() {
    if (debug.sigConfig) return debug.sigConfig;
    var sig = debug.sigServer || urlParam('sig'), trk = urlParam('trk'), mq = urlParam('mqtt');
    var custom = !!(sig || trk || mq), list = [];
    if (!custom || sig) list.push({ kind: 'peerjs', name: 'PeerJS', server: sig || null });
    (custom ? (trk ? trk.split(',') : []) : SIG_TRACKERS).forEach(function (u) { list.push({ kind: 'tracker', name: 'Tracker ' + shortHost(u), url: u }); });
    (custom ? (mq ? mq.split(',') : []) : SIG_MQTT).forEach(function (u) { list.push({ kind: 'mqtt', name: 'MQTT ' + shortHost(u), url: u }); });
    return list;
  }
  function later(fn) { setTimeout(fn, 0); }

  // ---- PeerJS cloud ----
  function peerjsOptions(server) {
    var o = { debug: 0, config: { iceServers: ICE_SERVERS } };
    if (server) {
      var hp = server.split(':');
      o.host = hp[0]; o.port = +(hp[1] || 9000); o.path = '/'; o.key = 'peerjs';
      o.secure = location.protocol === 'https:';
    }
    return o;
  }
  function peerjsTr(cfg, code, me, h) {
    var t = { send: function () {}, destroy: function () {} }, dead = false, pre = ROOM_PREFIX + code + '-';
    if (typeof window.Peer !== 'function') { later(function () { h.onClose('no-lib'); }); return t; }
    var pj;
    try { pj = new window.Peer(pre + me, peerjsOptions(cfg.server)); } catch (e) { later(function () { h.onClose('no-lib'); }); return t; }
    pj.on('open', function () { if (!dead) h.onOpen(); });
    pj.on('error', function (err) {
      if (dead) return;
      var type = (err && err.type) || 'error';
      if (type === 'peer-unavailable') { if (me !== 'host') h.onPresence(false); return; } // host: a guest left mid-handshake
      h.onClose(type === 'unavailable-id' ? 'taken' : type);
    });
    pj.on('disconnected', function () { if (!dead) h.onClose('disconnected'); });
    pj.socket.on('message', function (m) {
      if (dead || !m || !m.src || !m.payload || m.payload.type !== 'dd') return;
      var src = String(m.src);
      h.onMsg(src.indexOf(pre) === 0 ? src.slice(pre.length) : src, m.payload);
    });
    t.send = function (to, payload) {
      if (dead) return;
      var p = {}; for (var k in payload) p[k] = payload[k];
      p.type = 'dd';
      try { pj.socket.send({ type: 'OFFER', dst: pre + to, payload: p }); } catch (e) { dlog('peerjs send failed', e); }
    };
    t.destroy = function () { if (dead) return; dead = true; try { pj.destroy(); } catch (e) {} };
    return t;
  }

  // ---- WebTorrent WebSocket tracker ----
  var TRK_TAG = 'DD1';
  function trackerTr(cfg, code, me, h) {
    var t = { send: function () {}, destroy: function () {} }, dead = false, open = false, started = false;
    var isHost = me === 'host', infoHash = hash20(SIG_NS + code), peerId = '-DD0100-' + rnd(12, ALNUM);
    var addr = {}, timer = null, ws;
    try { ws = new WebSocket(cfg.url); } catch (e) { later(function () { h.onClose('ws'); }); return t; }
    function msg() {
      var o = { action: 'announce', info_hash: infoHash, peer_id: peerId, uploaded: 0, downloaded: 0, left: isHost ? 0 : 1, numwant: 0 };
      if (!started) { o.event = 'started'; started = true; }
      return o;
    }
    function raw(o) { if (ws.readyState === 1) { try { ws.send(JSON.stringify(o)); } catch (e) {} } }
    ws.onopen = function () {
      if (dead) return;
      raw(msg());
      timer = setInterval(function () { raw(msg()); }, 30000); // stay in the swarm + keep the socket alive
    };
    ws.onmessage = function (e) {
      if (dead) return;
      var d; try { d = JSON.parse(e.data); } catch (err) { return; }
      if (!d || (d.info_hash && d.info_hash !== infoHash)) return;
      if (d['failure reason']) { dlog('tracker refused', cfg.name, d['failure reason']); h.onClose('refused'); return; }
      if (d.action && d.action !== 'announce') return;
      var sdp = (d.offer && d.offer.sdp) || (d.answer && d.answer.sdp);
      if (sdp != null) {
        sdp = String(sdp);
        if (!d.peer_id || d.peer_id === peerId || sdp.indexOf(TRK_TAG) !== 0) return;
        var m; try { m = JSON.parse(sdp.slice(TRK_TAG.length)); } catch (err) { return; }
        if (!m || typeof m.f !== 'string') return;
        addr[m.f] = d.peer_id;
        h.onMsg(m.f, m);
        return;
      }
      if (d.interval != null || d.complete != null) {
        if (!open) { open = true; h.onOpen(); }
        if (!isHost && d.complete != null) h.onPresence(d.complete > 0); // the host announces as the only seeder
      }
    };
    ws.onerror = function () { if (!dead) h.onClose('ws-error'); };
    ws.onclose = function () { if (!dead) h.onClose('ws-closed'); };
    t.send = function (to, payload) {
      if (dead || ws.readyState !== 1) return;
      var o = msg(), s = TRK_TAG + JSON.stringify(payload);
      if (addr[to]) {
        o.to_peer_id = addr[to]; o.offer_id = rnd(20, ALNUM); o.answer = { type: 'answer', sdp: s };
      } else if (to === 'host' && !isHost) {
        // host not met yet: the tracker hands these to random swarm members (the host + other guests)
        o.numwant = 5; o.offers = [];
        for (var i = 0; i < 5; i++) o.offers.push({ offer_id: rnd(20, ALNUM), offer: { type: 'offer', sdp: s } });
      } else return;
      raw(o);
    };
    t.destroy = function () {
      if (dead) return;
      dead = true; clearInterval(timer);
      try { if (ws.readyState === 1) { var o = msg(); o.event = 'stopped'; raw(o); } ws.close(); } catch (e) {}
    };
    return t;
  }

  // ---- MQTT 3.1.1 over WebSocket (QoS 0 only: CONNECT, SUBSCRIBE, PUBLISH, PING, DISCONNECT) ----
  function mqttTr(cfg, code, me, h) {
    var t = { send: function () {}, destroy: function () {} }, dead = false, open = false;
    var isHost = me === 'host', base = 'dd1/' + hash20(SIG_NS + code) + '/', presT = base + 'p', myT = base + me;
    var enc = new TextEncoder(), dec = new TextDecoder(), buf = new Uint8Array(0), ping = null, presTimer = null, ws;
    try { ws = new WebSocket(cfg.url, ['mqtt']); ws.binaryType = 'arraybuffer'; } catch (e) { later(function () { h.onClose('ws'); }); return t; }
    function bytes(s) { return Array.prototype.slice.call(enc.encode(s)); }
    function str(s) { var b = bytes(s); return [b.length >> 8, b.length & 255].concat(b); }
    function pkt(type, body) {
      var len = body.length, hdr = [type];
      do { var x = len % 128; len = Math.floor(len / 128); hdr.push(len > 0 ? x | 128 : x); } while (len > 0);
      return new Uint8Array(hdr.concat(body));
    }
    function sendPkt(p) { if (ws.readyState === 1) { try { ws.send(p); } catch (e) {} } }
    function publish(topic, text, retain) { sendPkt(pkt(0x30 | (retain ? 1 : 0), str(topic).concat(bytes(text)))); }
    ws.onopen = function () {
      if (dead) return;
      var flags = 0x02, payload = str('dd' + rnd(14, ALNUM)); // clean session
      if (isHost) { flags |= 0x04 | 0x20; payload = payload.concat(str(presT), [0, 0]); } // last will: clear "host is here"
      sendPkt(pkt(0x10, str('MQTT').concat([4, flags, 0, 30], payload)));
    };
    function onPacket(type, flags, body) {
      if (type === 2) { // CONNACK
        if (body[1] !== 0) { h.onClose('refused'); return; }
        var subs = str(myT).concat([0]);
        if (!isHost) subs = subs.concat(str(presT), [0]);
        sendPkt(pkt(0x82, [0, 1].concat(subs)));
        ping = setInterval(function () { sendPkt(new Uint8Array([0xC0, 0])); }, 20000);
      } else if (type === 9) { // SUBACK
        if (open) return;
        open = true;
        if (isHost) publish(presT, '1', true);
        h.onOpen();
        if (!isHost) presTimer = setTimeout(function () { if (!dead) h.onPresence(false); }, 2500);
      } else if (type === 3) { // PUBLISH
        var tl = (body[0] << 8) | body[1], topic = dec.decode(body.subarray(2, 2 + tl)), pos = 2 + tl;
        if ((flags >> 1) & 3) pos += 2;
        var text = dec.decode(body.subarray(pos));
        if (topic === presT) { clearTimeout(presTimer); h.onPresence(text.length > 0); return; }
        if (topic !== myT) return;
        var m; try { m = JSON.parse(text); } catch (e) { return; }
        if (m && typeof m.f === 'string') h.onMsg(m.f, m);
      }
    }
    ws.onmessage = function (e) {
      if (dead || typeof e.data === 'string') return;
      var d = new Uint8Array(e.data), nb = new Uint8Array(buf.length + d.length);
      nb.set(buf); nb.set(d, buf.length); buf = nb;
      while (buf.length >= 2) {
        var mult = 1, len = 0, i = 1, b;
        do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * mult; mult *= 128; } while (b & 128);
        if (buf.length < i + len) return;
        var first = buf[0], body = buf.slice(i, i + len);
        buf = buf.slice(i + len);
        onPacket(first >> 4, first & 15, body);
        if (dead) return;
      }
    };
    ws.onerror = function () { if (!dead) h.onClose('ws-error'); };
    ws.onclose = function () { if (!dead) h.onClose('ws-closed'); };
    t.send = function (to, payload) { if (!dead && open) publish(base + to, JSON.stringify(payload), false); };
    t.destroy = function () {
      if (dead) return;
      dead = true; clearInterval(ping); clearTimeout(presTimer);
      try { if (open && isHost) publish(presT, '', true); sendPkt(new Uint8Array([0xE0, 0])); ws.close(); } catch (e) {}
    };
    return t;
  }
  var TR_FACTORY = { peerjs: peerjsTr, tracker: trackerTr, mqtt: mqttTr };

  // ---- Bus: all transports of one room side by side, each retried on its own with backoff ----
  //   slot.state: 'connecting' | 'open' | 'down' (retrying later) | 'closed'
  function openBus(code, me, h) {
    var bus = { code: code, me: me, dead: false };
    var changed = function () { if (!bus.dead && h.onChange) h.onChange(bus); };
    bus.slots = sigConfigs().map(function (cfg) {
      return { cfg: cfg, tr: null, state: 'idle', fails: 0, everFailed: false, retry: null, ct: null, presence: null, why: '' };
    });
    function start(slot) {
      if (bus.dead) return;
      slot.state = 'connecting'; slot.presence = null;
      var tr = null;
      var hh = {
        onOpen: function () {
          if (slot.tr !== tr || slot.state !== 'connecting') return;
          clearTimeout(slot.ct); slot.state = 'open'; slot.fails = 0;
          dlog('signaling up:', slot.cfg.name);
          changed();
        },
        onMsg: function (from, m) { if (slot.tr === tr && m && typeof m === 'object') h.onMsg(String(from), m, slot); },
        onPresence: function (yes) { if (slot.tr === tr && slot.presence !== yes) { slot.presence = yes; changed(); } },
        onClose: function (why) { if (slot.tr === tr) down(slot, why); }
      };
      try { tr = (debug.makeTransport || TR_FACTORY[slot.cfg.kind])(slot.cfg, code, me, hh); } catch (e) { tr = null; }
      slot.tr = tr;
      if (!tr) { down(slot, 'error'); return; }
      slot.ct = setTimeout(function () { if (slot.tr === tr && slot.state === 'connecting') down(slot, 'timeout'); }, SIG_CONNECT_MS);
    }
    function down(slot, why) {
      clearTimeout(slot.ct);
      var tr = slot.tr, wasOpen = slot.state === 'open';
      slot.tr = null;
      if (tr) { try { tr.destroy(); } catch (e) {} }
      if (bus.dead) return;
      slot.state = 'down'; slot.why = why; slot.everFailed = true;
      dlog('signaling down:', slot.cfg.name, why);
      if (why === 'taken' && h.onTaken && h.onTaken(slot)) return; // the room got a new code: this bus is gone
      var wait = Math.min(30000, (me === 'host' ? 6000 : 2500) * Math.pow(2, Math.min(3, slot.fails++)));
      if (wasOpen) wait = 1500; // worked a moment ago: come back fast
      if (!isOnline()) wait = Math.max(wait, 10000); // the 'online' event retries right away
      slot.retry = setTimeout(function () { slot.retry = null; start(slot); }, wait);
      changed();
    }
    bus.send = function (to, m, slot) {
      m.f = me;
      (slot ? [slot] : bus.slots).forEach(function (s) {
        if (s.state === 'open' && s.tr) { try { s.tr.send(to, m); } catch (e) { dlog('signaling send failed', e); } }
      });
    };
    bus.retryNow = function () {
      bus.slots.forEach(function (s) {
        if (s.state !== 'down') return;
        clearTimeout(s.retry); s.retry = null; s.fails = 0; s.everFailed = false;
        start(s);
      });
      changed();
    };
    bus.info = function () {
      var up = 0, servers = bus.slots.map(function (s) {
        if (s.state === 'open') up++;
        return { name: s.cfg.name, kind: s.cfg.kind, state: s.state, why: s.why };
      });
      return { up: up, total: bus.slots.length, servers: servers, online: isOnline() };
    };
    bus.destroy = function () {
      if (bus.dead) return;
      bus.dead = true;
      bus.slots.forEach(function (s) {
        clearTimeout(s.ct); clearTimeout(s.retry);
        if (s.tr) { try { s.tr.destroy(); } catch (e) {} }
        s.tr = null; s.state = 'closed';
      });
    };
    bus.slots.forEach(start);
    return bus;
  }

  var memDid = null;
  function deviceId() {
    try {
      var d = localStorage.getItem('dd_did');
      if (!d) { d = rnd(12); localStorage.setItem('dd_did', d); }
      return d;
    } catch (e) { return memDid || (memDid = rnd(12)); }
  }
  function normCode(c) {
    c = String(c || '').toUpperCase().replace(/[^A-Z]/g, '');
    return c.length === 4 ? c : null;
  }
  // Accepts "KQMB", or any URL/text containing join=KQMB (the lobby QR holds the game URL + #join=CODE).
  function codeFromText(t) {
    t = String(t || '').trim();
    var m = /[#?&]join=([A-Za-z]{4})(?![A-Za-z])/.exec(t);
    if (m) return m[1].toUpperCase();
    return /^[A-Za-z]{4}$/.test(t) ? t.toUpperCase() : null;
  }

  function addCand(s, c) {
    if (!c) return;
    if (!s.remoteSet) { s.cands.push(c); return; }
    s.peer.pc.addIceCandidate(c).catch(function (e) { dlog('addIceCandidate failed', e && e.message); });
  }
  function flushCands(s) {
    var list = s.cands; s.cands = [];
    list.forEach(function (c) { addCand(s, c); });
  }
  // Trickle ICE: candidates go out in small batches ({k:'cands'}) to v2 peers, one by one to older ones.
  function queueCand(s, c, send) {
    if (c && (s.v || 1) < 2) { send({ k: 'cand', sid: s.sid, c: c.toJSON() }); return; }
    if (c) s.cq.push(c.toJSON());
    var flush = function () {
      if (s.cqT) { clearTimeout(s.cqT); s.cqT = null; }
      if (s.cq.length) { var list = s.cq; s.cq = []; send({ k: 'cands', sid: s.sid, c: list }); }
    };
    if (!c) flush(); else if (!s.cqT) s.cqT = setTimeout(flush, 120);
  }
  function remoteCands(s, m) {
    if (m.k === 'cand') addCand(s, m.c);
    else if (Array.isArray(m.c)) m.c.slice(0, 30).forEach(function (c) { addCand(s, c); });
  }

  // ------------------------------------------------------------------
  // Room codes: host side
  // ------------------------------------------------------------------
  var room = null;          // {code, bus, status, restored, idTries, doneJ}
  var roomSess = new Map(); // sid -> pending guest connection
  var didToId = {};         // device id -> guest id (rejoin gets the same slot)

  function roomInfo() {
    if (!room) return null;
    var info = room.bus ? room.bus.info() : { up: 0, total: 0, servers: [], online: isOnline() };
    info.status = room.status; info.code = room.code;
    return info;
  }
  function roomRecalc() {
    var r = room;
    if (!r || !r.bus) return;
    var info = r.bus.info();
    var st = info.up ? 'open' : r.bus.slots.some(function (s) { return !s.everFailed; }) ? 'connecting' : 'offline';
    if (st === 'open' && r.status !== 'open') saveRoomCode();
    var key = st + info.up + '/' + info.total + info.online;
    if (key === r.key) return;
    r.key = key; r.status = st;
    dlog('room', r.code, st, info.up + '/' + info.total);
    safeCall(Net.onRoomStatus, st, r.code, roomInfo());
  }

  function hostOpenRoom() {
    if (!Net.isHost) Net.hostStart();
    if (room) return room.code;
    var code = null, restored = false;
    try {
      var sv = JSON.parse(localStorage.getItem('dd_room') || 'null');
      if (sv && normCode(sv.c) && Date.now() - sv.t < 3 * 3600 * 1000) { code = sv.c; restored = true; }
    } catch (e) {}
    room = { code: code || rnd(4, CODE_ABC), bus: null, status: 'connecting', restored: restored, idTries: 0, doneJ: [], key: null };
    Net.roomCode = room.code;
    roomConnect();
    return room.code;
  }

  function saveRoomCode() {
    try { localStorage.setItem('dd_room', JSON.stringify({ c: room.code, t: Date.now() })); } catch (e) {}
  }

  function roomConnect() {
    var r = room;
    if (!r) return;
    if (r.bus) r.bus.destroy();
    r.key = null; r.status = 'connecting';
    r.bus = openBus(r.code, 'host', {
      onMsg: function (from, m, slot) { if (room === r) hostSigMsg(from, m, slot); },
      onChange: function (bus) { if (room === r && r.bus === bus) roomRecalc(); },
      onTaken: function () {
        // PeerJS says this code is in use: maybe our own previous session that the server hasn't dropped yet.
        if (room !== r) return false;
        if ((r.restored && r.idTries++ < 2) || peers.size || roomSess.size) return false; // just retry later
        r.code = rnd(4, CODE_ABC); r.restored = false; r.idTries = 0;
        Net.roomCode = r.code;
        later(function () { if (room === r) roomConnect(); });
        return true;
      }
    });
    roomRecalc();
  }

  function closeRoom() {
    var r = room;
    room = null;
    roomSess.forEach(function (s) { dropSess(s); });
    if (r && r.bus) r.bus.destroy();
  }

  function dropSess(s) {
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    if (s.cqT) { clearTimeout(s.cqT); s.cqT = null; }
    if (roomSess.get(s.sid) === s) roomSess.delete(s.sid);
    if (!s.peer.joined && !s.peer.left) closePeer(s.peer);
  }

  // A session talks to its guest over every server the guest has reached us on; a server that shows up
  // later gets the whole conversation so far (duplicates are ignored on both sides).
  function sessSend(s, msg) {
    s.log.push(msg);
    s.routes.forEach(function (slot) { if (room && room.bus) room.bus.send(s.gid, msg, slot); });
  }
  function addRoute(s, slot) {
    if (!slot || s.routes.indexOf(slot) >= 0) return;
    s.routes.push(slot);
    s.log.forEach(function (msg) { if (room && room.bus) room.bus.send(s.gid, msg, slot); });
  }

  function hostSigMsg(from, m, slot) {
    if (!Net.isHost || !room) return;
    if (m.k === 'join') { hostRoomJoin(from, m, slot); return; }
    var s = roomSess.get(m.sid);
    if (!s || s.gid !== from) return;
    addRoute(s, slot);
    if (m.k === 'answer') {
      if (s.gotAnswer) return;
      s.gotAnswer = true;
      s.peer.pc.setRemoteDescription({ type: 'answer', sdp: String(m.sdp) }).then(function () {
        s.remoteSet = true; flushCands(s);
      }).catch(function (e) { dlog('room answer failed', e && e.message); dropSess(s); });
    } else if (m.k === 'cand' || m.k === 'cands') remoteCands(s, m);
  }

  function hostRoomJoin(from, m, slot) {
    var r = room;
    var j = m.j ? String(m.j).slice(0, 20) : null, jkey = from + '/' + j, dup = null;
    if (j && r.doneJ.indexOf(jkey) >= 0) return; // late copy of a join that already connected
    roomSess.forEach(function (s) { if (s.gid === from && s.j === j) dup = s; });
    if (dup) { addRoute(dup, slot); return; }     // same join attempt arriving over another server
    var did = String(m.did || '').replace(/[^\w-]/g, '').slice(0, 40) || ('anon-' + from);
    roomSess.forEach(function (s) { if (s.did === did || s.gid === from) dropSess(s); });
    var prev = didToId[did];
    var id = prev && !idBusy(prev, did) ? prev : freeGuestId(did);
    dlog('room join from', from, 'device', did, '-> id', id, 'via', slot.cfg.name);
    if (!id) { r.bus.send(from, { k: 'full' }, slot); return; }
    var peer = makePeer(id, true);
    var s = {
      sid: rnd(8), gid: from, j: j, jkey: jkey, did: did, id: id, peer: peer, cands: [], remoteSet: false, timer: null,
      routes: [slot], log: [], v: +m.v || 1, gotAnswer: false, cq: [], cqT: null
    };
    peer.sess = s; peer.via = 'room'; peer.did = did; peer.sigVia = slot.cfg.name;
    roomSess.set(s.sid, s);
    var send = function (msg) { if (roomSess.get(s.sid) === s && room === r) sessSend(s, msg); };
    peer.pc.onicecandidate = function (e) { if (roomSess.get(s.sid) === s) queueCand(s, e.candidate, send); };
    peer.pc.addEventListener('connectionstatechange', function () {
      if (peer.pc.connectionState === 'failed' && !peer.joined && roomSess.get(s.sid) === s) { dlog('room connection failed', id); dropSess(s); }
    });
    s.timer = setTimeout(function () { if (!peer.joined) { dlog('room join timed out', id); dropSess(s); } }, ROOM_HOST_SESS_MS);
    peer.pc.createOffer().then(function (o) { return peer.pc.setLocalDescription(o); }).then(function () {
      send({ k: 'offer', sid: s.sid, id: id, sdp: peer.pc.localDescription.sdp, v: 2 });
    }).catch(function (e) { dlog('room offer failed', e && e.message); dropSess(s); });
  }

  function hostSessOpen(peer) {
    var s = peer.sess;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    roomSess.delete(s.sid);
    peer.sess = null;
    if (!Net.isHost) { closePeer(peer); return; }
    if (room && s.j) { room.doneJ.push(s.jkey); if (room.doneJ.length > 40) room.doneJ.shift(); }
    var old = peers.get(peer.id);
    if (old && old !== peer) peerGone(old, 'replaced by rejoin'); // stale connection of the same device
    peer.joined = true;
    peer.lastRecv = Date.now();
    peers.set(peer.id, peer);
    didToId[s.did] = peer.id;
    setState('connected');
    safeCall(Net.onPeerJoin, peer.id);
  }

  // ------------------------------------------------------------------
  // Room codes: guest side
  //   Asks for the room on every server at once. Fails with 'noroom' only when every server either
  //   says "no host here" or is unreachable; 'nosignal' when none can be reached; 'offline' when the
  //   phone itself has no network.
  // ------------------------------------------------------------------
  function joinRoom(codeIn) {
    var code = normCode(codeIn);
    if (!code) return Promise.reject(new Error('badcode'));
    cancelPairing('replaced');
    closeRoom();
    peers.forEach(function (peer) { closePeer(peer); });
    peers.clear();
    Net.isHost = false;
    Net.myId = null;
    Net.roomCode = code;
    return new Promise(function (resolve, reject) {
      var p = {
        kind: 'room', code: code, id: null, peer: null, timer: null, joinT: null, bus: null, sid: null, cands: [], remoteSet: false,
        me: rnd(8), j: rnd(8), routes: [], log: [], v: 1, cq: [], cqT: null, resolve: resolve, reject: reject
      };
      pairing = p;
      setState('room-signaling');
      var fail = p.fail = function (why) {
        if (pairing !== p) return;
        dlog('room join failed:', why, p.bus ? p.bus.info().servers.map(function (s) { return s.name + ':' + s.state; }).join(' ') : '');
        pairing = null;
        clearTimers(p);
        if (p.bus) p.bus.destroy();
        if (p.peer) closePeer(p.peer);
        setState('error');
        reject(new Error(why));
      };
      if (!isOnline()) { later(function () { fail('offline'); }); return; }
      var progress = function () {
        if (pairing !== p) return;
        var info = p.bus.info();
        info.phase = p.sid ? 'connecting' : info.up ? 'asking' : 'servers';
        info.code = code;
        safeCall(Net.onJoinStatus, info);
      };
      p.timer = setTimeout(function () {
        var anyNoHost = p.bus.slots.some(function (s) { return s.presence === false; });
        fail(p.sid ? 'connect' : p.bus.info().up ? (anyNoHost ? 'noroom' : 'timeout') : isOnline() ? 'nosignal' : 'offline');
      }, ROOM_JOIN_MS);
      var joinMsg = function () { return { k: 'join', did: deviceId(), v: 2, j: p.j }; };
      var bus = p.bus = openBus(code, p.me, {
        onChange: function () {
          if (pairing !== p) return;
          bus.slots.forEach(function (slot) {
            if (slot.state === 'open' && slot.askedTr !== slot.tr) { slot.askedTr = slot.tr; if (!p.sid) bus.send('host', joinMsg(), slot); }
          });
          if (!p.sid) {
            var settled = bus.slots.every(function (s) {
              return s.presence !== true && ((s.everFailed && s.state !== 'open') || (s.state === 'open' && s.presence === false));
            });
            if (settled) { fail(bus.slots.some(function (s) { return s.presence === false; }) ? 'noroom' : isOnline() ? 'nosignal' : 'offline'); return; }
            setState(bus.info().up ? 'room-asking' : 'room-signaling');
          }
          progress();
        },
        onMsg: function (from, m, slot) { if (pairing === p && from === 'host') guestSigMsg(p, m, slot); }
      });
      // ask again every 4 s on servers where the host hasn't answered yet (it may have just come back)
      p.joinT = setInterval(function () {
        if (pairing !== p || p.sid) return;
        bus.slots.forEach(function (slot) { if (slot.state === 'open' && p.routes.indexOf(slot) < 0) bus.send('host', joinMsg(), slot); });
      }, 4000);
      progress();
    });
  }

  function guestSigMsg(p, m, slot) {
    if (p.routes.indexOf(slot) < 0) {
      p.routes.push(slot);
      p.log.forEach(function (msg) { p.bus.send('host', msg, slot); });
    }
    slot.presence = true;
    if (m.k === 'full') { p.fail('full'); return; }
    if (m.k === 'cand' || m.k === 'cands') { if (m.sid === p.sid) remoteCands(p, m); return; }
    if (m.k !== 'offer' || !(m.id >= 1 && m.id <= MAX_GUESTS) || m.sid === p.sid) return; // (same offer via another server)
    if (p.peer) closePeer(p.peer);
    if (p.cqT) { clearTimeout(p.cqT); p.cqT = null; }
    p.sid = m.sid; p.id = m.id; p.cands = []; p.remoteSet = false; p.v = +m.v || 1; p.log = []; p.cq = [];
    var peer = p.peer = makePeer(0, true);
    peer.via = 'room'; peer.sigVia = slot.cfg.name;
    var send = function (msg) {
      if (pairing !== p || p.peer !== peer) return;
      p.log.push(msg);
      p.routes.forEach(function (sl) { p.bus.send('host', msg, sl); });
    };
    peer.pc.onicecandidate = function (e) { if (pairing === p && p.peer === peer) queueCand(p, e.candidate, send); };
    peer.pc.addEventListener('connectionstatechange', function () {
      if (peer.pc.connectionState === 'failed' && pairing === p && p.peer === peer) p.fail('connect');
    });
    setState('room-connecting');
    safeCall(Net.onJoinStatus, { phase: 'connecting', code: p.code, up: p.bus.info().up, total: p.bus.slots.length, via: slot.cfg.name });
    peer.pc.setRemoteDescription({ type: 'offer', sdp: String(m.sdp) }).then(function () {
      p.remoteSet = true; flushCands(p);
      return peer.pc.createAnswer();
    }).then(function (a) { return peer.pc.setLocalDescription(a); }).then(function () {
      send({ k: 'answer', sid: m.sid, sdp: peer.pc.localDescription.sdp });
    }).catch(function (e) { dlog('room answer error', e && e.message); p.fail('rtc'); });
  }

  // ------------------------------------------------------------------
  // Connection test (lobby / join screen button): what works on this phone's network, in ~6 s.
  //   internet, each matchmaking server, STUN (public address), each TURN relay, LAN address, camera.
  // ------------------------------------------------------------------
  var TEST_MS = 6000;
  function maskIp(ip) { var p = String(ip).split('.'); return p.length === 4 ? p[0] + '.' + p[1] + '.x.x' : String(ip).replace(/:[^:]*:[^:]*$/, ':…'); }
  function gatherTest(servers, relayOnly, ms, onCand) {
    return new Promise(function (resolve) {
      var pc, done = false, t;
      var finish = function () { if (done) return; done = true; clearTimeout(t); try { pc.close(); } catch (e) {} resolve(); };
      try {
        pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: relayOnly ? 'relay' : 'all' });
        pc.createDataChannel('t');
        pc.onicecandidate = function (e) {
          if (!e.candidate) { finish(); return; }
          var m = /candidate:\S+ \d+ (\w+) \d+ (\S+) \d+ typ (\w+)/.exec(e.candidate.candidate || '');
          if (m && onCand(m[3], m[2], m[1].toLowerCase())) finish();
        };
        pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(finish);
      } catch (e) { finish(); return; }
      t = setTimeout(finish, ms);
    });
  }
  function connTest(onUpdate) {
    var t0 = Date.now(), items = [], online = isOnline();
    var item = function (label) { var it = { label: label, ok: null, detail: '' }; items.push(it); return it; };
    var upd = function () { safeCall(onUpdate, items); };
    var set = function (it, ok, detail) { if (it.ok !== null) return; it.ok = ok; it.detail = detail || ''; upd(); };
    var secs = function () { return ((Date.now() - t0) / 1000).toFixed(1) + ' s'; };
    var iNet = item('Internet'), iSig = [], tasks = [];
    sigConfigs().forEach(function (cfg) { iSig.push({ cfg: cfg, it: item(cfg.name.replace(/^Tracker /, 'Tracker ').replace(/^PeerJS$/, 'PeerJS server')) }); });
    var iStun = item('STUN (public address)');
    var iTurn = ICE_TURN.map(function (e) { return { e: e, it: item(e.name) }; });
    var iLan = item('Wi-Fi / LAN address');
    var iCam = item('Camera (QR mode)');
    upd();
    // internet: a no-cors fetch comes back 'opaque' only from the real network (never from the offline cache)
    if (!online) set(iNet, false, 'phone is offline (no Wi-Fi / mobile data)');
    else {
      var probe = function (u) {
        return fetch(u + (u.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { mode: 'no-cors', cache: 'no-store' })
          .then(function (r) { if (r.type !== 'opaque') throw new Error('cache'); return true; });
      };
      var left = 2;
      tasks.push(new Promise(function (res) {
        var fin = function (ok) { if (ok) { set(iNet, true, 'reachable (' + secs() + ')'); res(); } else if (--left === 0) res(); };
        ['https://www.gstatic.com/generate_204', 'https://www.cloudflare.com/cdn-cgi/trace'].forEach(function (u) {
          probe(u).then(function () { fin(true); }, function () { fin(false); });
        });
        setTimeout(res, TEST_MS - 500);
      }));
    }
    // matchmaking servers: open each transport with a throwaway room name
    iSig.forEach(function (x) {
      tasks.push(new Promise(function (res) {
        var tr = null, done = false;
        var fin = function (ok, d) { if (done) return; done = true; set(x.it, ok, d); later(function () { if (tr) tr.destroy(); }); res(); };
        try {
          tr = (debug.makeTransport || TR_FACTORY[x.cfg.kind])(x.cfg, 'TEST' + rnd(6, CODE_ABC), 't' + rnd(7), {
            onOpen: function () { fin(true, 'reachable (' + secs() + ')'); },
            onMsg: function () {}, onPresence: function () {},
            onClose: function (why) { fin(false, why === 'ws-error' || why === 'ws-closed' ? 'can\'t connect' : String(why)); }
          });
        } catch (e) { fin(false, 'error'); }
        setTimeout(function () { fin(false, 'no answer'); }, TEST_MS - 700);
      }));
    });
    // STUN + local address
    var lan = [], hidden = false, v6 = false;
    tasks.push(gatherTest(online ? [ICE_STUN] : [], false, 4500, function (type, addr) {
      if (type === 'srflx') { set(iStun, true, 'public ' + maskIp(addr) + ' (' + secs() + ')'); }
      else if (type === 'host') {
        if (/\.local$/i.test(addr)) hidden = true;
        else if (addr.indexOf(':') >= 0) v6 = true;
        else if (lan.indexOf(addr) < 0) lan.push(addr);
      }
      return false;
    }).then(function () {
      set(iStun, false, online ? 'no answer (UDP blocked?)' : 'offline');
      if (lan.length) set(iLan, true, lan.slice(0, 2).join(', '));
      else if (hidden) set(iLan, true, 'found (hidden by Chrome until the camera is allowed)');
      else if (v6) set(iLan, 'warn', 'IPv6 only');
      else set(iLan, false, 'none — Wi-Fi off?');
    }));
    // TURN relays, one by one in parallel (relay-only gathering)
    iTurn.forEach(function (x) {
      tasks.push(gatherTest(online ? [iceEntry(x.e)] : [], true, 5000, function (type, addr, proto) {
        if (type === 'relay') { set(x.it, true, 'relay ' + maskIp(addr) + ' (' + secs() + ')'); return true; }
        return false;
      }).then(function () { set(x.it, false, online ? 'no relay (busy or blocked)' : 'offline'); }));
    });
    // camera permission (no prompt)
    tasks.push(new Promise(function (res) {
      var bd = 'BarcodeDetector' in window ? 'fast scanner' : 'scanner: jsQR';
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { set(iCam, false, window.isSecureContext ? 'no camera' : 'needs https'); res(); return; }
      var q = navigator.permissions && navigator.permissions.query ? navigator.permissions.query({ name: 'camera' }) : Promise.reject();
      q.then(function (st) {
        if (st.state === 'granted') set(iCam, true, 'allowed · ' + bd);
        else if (st.state === 'denied') set(iCam, false, 'blocked — allow it in Chrome site settings');
        else set(iCam, 'info', 'will ask when scanning · ' + bd);
      }, function () { set(iCam, 'info', 'will ask when scanning'); }).then(res, res);
    }));
    return Promise.race([Promise.all(tasks), new Promise(function (r) { setTimeout(r, TEST_MS); })]).then(function () {
      items.forEach(function (it) { if (it.ok === null) { it.ok = false; it.detail = 'timed out'; } });
      var sigOk = iSig.filter(function (x) { return x.it.ok === true; }).length;
      var turnOk = iTurn.some(function (x) { return x.it.ok === true; });
      var stunOk = iStun.ok === true;
      if (iNet.ok !== true && (sigOk || stunOk)) { iNet.ok = true; iNet.detail = 'reachable (web check blocked)'; }
      var verdict;
      if (!online || (iNet.ok !== true && !sigOk && !stunOk && !turnOk)) verdict = '📵 No internet here. Only the QR mode will work — put everyone on the same Wi-Fi or Dad\'s hotspot.';
      else if (!sigOk) verdict = '⚠️ Internet works, but the matchmaking servers are blocked on this network. Try mobile data, or use the QR mode on the same Wi-Fi.';
      else if (!stunOk && !turnOk) verdict = '⚠️ Room codes can find the game, but this network blocks game traffic. Put everyone on the same Wi-Fi or Dad\'s hotspot.';
      else if (!turnOk) verdict = '✅ Room codes should work. If a phone on mobile data can\'t join, put everyone on the same Wi-Fi.';
      else verdict = '✅ Room codes should work — even with phones on different networks.';
      if (iCam.ok === false) verdict += ' (QR mode needs the camera.)';
      var conn = navigator.connection || {};
      var lines = [
        'Desert Dungeons connection test · ' + new Date().toISOString().replace('T', ' ').slice(0, 19),
        'browser: ' + navigator.userAgent,
        'online: ' + online + (conn.type ? ' · type ' + conn.type : '') + (conn.effectiveType ? ' · ' + conn.effectiveType : '') + (conn.rtt != null ? ' · rtt ' + conn.rtt + ' ms' : ''),
        'page: ' + location.href.split('#')[0]
      ];
      items.forEach(function (it) { lines.push((ICON[it.ok] || '?') + ' ' + it.label + ': ' + it.detail); });
      lines.push('=> ' + verdict);
      if (room) lines.push('room ' + room.code + ' ' + room.status + ' · ' + room.bus.info().servers.map(function (s) { return s.name + ' ' + s.state + (s.why && s.state !== 'open' ? ' (' + s.why + ')' : ''); }).join(', '));
      lines.push('log: ' + debug.log.slice(-12).join(' | '));
      return { items: items, verdict: verdict, text: lines.join('\n'), ms: Date.now() - t0 };
    });
  }
  function copyText(text) {
    var fallback = function () {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    return Promise.resolve(fallback());
  }
  var testRun = 0;
  function showConnTest() {
    if (pairing) return; // never on top of a pairing in progress
    var my = ++testRun, result = null;
    var close = { label: 'Close', cls: 'net-cancel', fn: function () { testRun++; hideOverlay(); } };
    var view = function (items) {
      var v = { title: '📶 Connection test', list: items, buttons: [close] };
      if (result) {
        v.verdict = result.verdict;
        v.buttons = [
          { label: '📋 Copy details', fn: function () {
            copyText(result.text).then(function (ok) {
              if (my !== testRun) return;
              var m = ov.querySelector('.net-hint') || ov.querySelector('.net-side').appendChild(el('div', 'net-hint'));
              m.textContent = ok ? '✅ Copied — paste it in a message.' : 'Couldn\'t copy — take a screenshot instead.';
            });
          } },
          { label: '↻ Again', fn: showConnTest },
          close
        ];
      } else v.msg = 'Testing… (about 6 seconds)';
      render(v);
    };
    setState('conn-test');
    connTest(function (items) { if (my === testRun && !result) view(items); }).then(function (r) {
      if (my !== testRun) return;
      result = r; debug.lastTest = r;
      dlog('conn test', r.ms + 'ms', r.verdict);
      view(r.items);
      setState('conn-test-done');
    });
  }

  // ------------------------------------------------------------------
  // Keepalive + dead-connection watchdog
  // ------------------------------------------------------------------
  setInterval(function () {
    var now = Date.now();
    peers.forEach(function (peer) {
      if (!peer.joined || peer.left) return;
      if (now - peer.lastRecv > PEER_TIMEOUT_MS) { peerGone(peer, 'timeout'); return; }
      if (now - peer.lastSent >= KEEPALIVE_MS && peer.r.readyState === 'open') {
        try { peer.r.send('k'); peer.lastSent = now; peer.tx += 1; } catch (e) {}
      }
    });
  }, 500);

  // ------------------------------------------------------------------
  // Connection stats (RTT + direct/relay) for the quality badge
  // ------------------------------------------------------------------
  function getStats(id) {
    var peer = Net.isHost ? peers.get(id) : peers.get(0);
    if (!peer || peer.left || !peer.pc.getStats) return Promise.resolve(null);
    return peer.pc.getStats().then(function (rep) {
      var pair = null, transport = null;
      rep.forEach(function (s) { if (s.type === 'transport' && s.selectedCandidatePairId) transport = s; });
      if (transport) pair = rep.get(transport.selectedCandidatePairId);
      if (!pair) rep.forEach(function (s) {
        if (s.type === 'candidate-pair' && (s.selected || (s.nominated && s.state === 'succeeded'))) pair = pair || s;
      });
      var out = { id: peer.id, via: peer.via, rtt: null, relay: false, local: '?', remote: '?', rx: peer.rx, tx: peer.tx, state: peer.pc.connectionState };
      if (!pair) return out;
      if (pair.currentRoundTripTime != null) out.rtt = Math.round(pair.currentRoundTripTime * 1000);
      var lc = rep.get(pair.localCandidateId), rc = rep.get(pair.remoteCandidateId);
      var desc = function (c) { return c ? (c.candidateType || '?') + '/' + (c.relayProtocol || c.protocol || '?') : '?'; };
      out.local = desc(lc); out.remote = desc(rc);
      out.relay = !!((lc && lc.candidateType === 'relay') || (rc && rc.candidateType === 'relay'));
      return out;
    }).catch(function () { return null; });
  }

  // ------------------------------------------------------------------
  // Generic QR scan (room code / join URL) and info panel, reusing the overlay
  // ------------------------------------------------------------------
  function scanCode(title) {
    cancelPairing('replaced');
    return new Promise(function (resolve, reject) {
      var done = false;
      var finish = function (val, err) {
        if (done) return;
        done = true;
        currentScan = null;
        hideOverlay();
        stopCamera();
        if (err) reject(err); else resolve(val);
      };
      var handler = function (text) {
        if (done) return false;
        var c = codeFromText(text);
        if (!c) { flashMsg('That\'s not a room code — scan the code on the host\'s lobby screen'); return false; }
        buzz();
        finish(c);
        return true;
      };
      currentScan = handler;
      var cancel = { label: 'Cancel', cls: 'net-cancel', fn: function () { finish(null, new Error('cancelled')); } };
      var view = { title: title || 'Point your camera at the code on the host\'s phone', media: 'video', buttons: [cancel] };
      setState('scan-code');
      render({ title: 'Starting camera…', media: 'spin', buttons: [cancel] });
      startCamera().then(function () {
        if (!done && currentScan === handler) render(view);
      }, function (err) {
        if (done || currentScan !== handler) return;
        render({ title: 'Camera problem', msg: cameraErrorText(err), err: true, hint: 'You can type the code instead.', buttons: [cancel] });
      });
    });
  }

  // view: {title, msg, hint, qr, small, buttons:[{label, cls:'net-go'|'net-cancel', fn}]}
  function showPanel(view) {
    var v = {};
    for (var k in view) v[k] = view[k];
    if (v.qr) v.media = 'qr';
    render(v);
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
  Net.joinGame = function () { closeRoom(); Net.roomCode = null; return joinGame(); };
  // Room codes. Host: hostOpenRoom() -> code; status via Net.onRoomStatus(status, code, info),
  // status = 'connecting' | 'open' | 'offline'; info = Net.roomInfo() =
  // {status, code, up, total, online, servers:[{name, kind, state}]} (matchmaking servers reachable).
  // Guest: joinRoom(code) -> Promise<myId>, progress via Net.onJoinStatus({phase:'servers'|'asking'|'connecting', up, total}),
  // rejects with Error('noroom' | 'full' | 'offline' | 'nosignal' | 'timeout' | 'connect' | 'rtc' | 'badcode').
  Net.hostOpenRoom = hostOpenRoom;
  Net.roomStatus = function () { return room ? room.status : null; };
  Net.roomInfo = roomInfo;
  Net.isOnline = isOnline;
  Net.connTest = connTest;          // Promise<{items:[{label, ok, detail}], verdict, text}>, onUpdate(items) while running
  Net.showConnTest = showConnTest;  // the same as an overlay with "Copy details"
  Net.copyText = copyText;
  Net.joinRoom = joinRoom;
  Net.codeFromText = codeFromText;
  Net.deviceId = deviceId;
  Net.scanCode = scanCode;          // camera scan of the lobby QR -> Promise<code>
  Net.showPanel = showPanel;        // simple info overlay (title/msg/qr/buttons)
  Net.hidePanel = function () { if (!pairing) { hideOverlay(); stopCamera(); } };
  Net.getStats = getStats;          // Promise<{rtt, relay, local, remote, via, rx, tx}|null>
  Net.peerVia = function (id) { var p = Net.isHost ? peers.get(id) : peers.get(0); return p ? p.via : null; };

  function chSend(peer, ch, data, reliable) {
    if (!ch || ch.readyState !== 'open') return false;
    if (!reliable && ch.bufferedAmount > UNRELIABLE_MAX_BUFFER) return false;
    try { ch.send(data); } catch (e) { return false; }
    peer.lastSent = Date.now();
    peer.tx += data.length;
    return true;
  }
  function sendTo(peer, data, reliable) {
    if (!peer || peer.left || !peer.joined) return false;
    return chSend(peer, reliable ? peer.r : peer.u, data, reliable);
  }

  Net.send = function (toId, msg, reliable) {
    var peer = Net.isHost ? peers.get(toId) : peers.get(0);
    return sendTo(peer, JSON.stringify(msg), reliable !== false);
  };
  // Same as send() for an already JSON-encoded string (lets the caller measure its size).
  Net.sendRaw = function (toId, str, reliable) {
    var peer = Net.isHost ? peers.get(toId) : peers.get(0);
    return sendTo(peer, str, reliable !== false);
  };

  Net.broadcast = function (msg, reliable) {
    var data = JSON.stringify(msg), ok = 0;
    peers.forEach(function (peer) { if (sendTo(peer, data, reliable !== false)) ok++; });
    return ok;
  };

  Net.closeOverlay = function () {
    cancelPairing('cancelled');
    hideOverlay();
    stopCamera();
  };

  Net.disconnect = function () {
    cancelPairing('disconnected');
    closeRoom();
    hideOverlay();
    stopCamera();
    peers.forEach(function (peer) { closePeer(peer); });
    peers.clear();
    Net.isHost = false;
    Net.myId = null;
    Net.roomCode = null;
    setState('idle');
  };

  // Signal came back: retry the room's signaling connection now instead of waiting for the backoff.
  window.addEventListener('online', function () {
    if (room && room.bus) room.bus.retryNow();
    if (pairing && pairing.bus) pairing.bus.retryNow();
  });
  window.addEventListener('offline', function () { if (room) { room.key = null; roomRecalc(); } });

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
  debug.roomSess = roomSess;
  debug.didToId = didToId;
  debug.room = function () { return room; };
  debug.pairing = function () { return pairing; };
  debug.sigConfigs = sigConfigs;
  debug.hash20 = hash20;
  // Test helper: lose the connection to the host without telling it (like driving into a tunnel).
  debug.simulateDrop = function () {
    var peer = peers.get(0);
    if (!peer || Net.isHost) return false;
    peer.left = true;
    peer.r.onmessage = peer.u.onmessage = null;
    peers.delete(0);
    Net.myId = null;
    safeCall(Net.onPeerLeave, 0);
    return true;
  };
  Net._debug = debug;

  window.Net = Net;
})();
