/* net.js — 免伺服器雙人連線（WebRTC DataChannel，複製貼上邀請碼配對）
   流程：
     房主：Net.host() → 取得邀請碼 → 傳給對方 → 對方回覆回應碼 → Net.acceptAnswer(code)
     加入：Net.join(邀請碼) → 取得回應碼 → 傳回房主
   連上後 Net.send(obj) / Net.onMessage(fn)。 */
(function () {
  'use strict';

  const RTC_CFG = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

  let pc = null, ch = null;
  const listeners = { message: [], open: [], close: [] };
  const emit = (k, d) => listeners[k].forEach((f) => { try { f(d); } catch (e) { console.error(e); } });

  function reset() {
    try { if (ch) ch.close(); } catch (e) {}
    try { if (pc) pc.close(); } catch (e) {}
    pc = null; ch = null;
  }

  // SDP 壓成短一點的碼（去空行 + base64）
  function encode(desc) {
    return btoa(unescape(encodeURIComponent(JSON.stringify({ t: desc.type, s: desc.sdp }))));
  }
  function decode(code) {
    const o = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    return { type: o.t, sdp: o.s };
  }

  function waitIce(p) {
    if (p.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((res) => {
      const to = setTimeout(res, 4000); // 最多等 4 秒（拿不到全部 candidate 也能用）
      p.addEventListener('icegatheringstatechange', function f() {
        if (p.iceGatheringState === 'complete') { clearTimeout(to); p.removeEventListener('icegatheringstatechange', f); res(); }
      });
    });
  }

  function wireChannel(c) {
    ch = c;
    ch.onopen = () => emit('open');
    ch.onclose = () => emit('close');
    ch.onmessage = (e) => { try { emit('message', JSON.parse(e.data)); } catch (err) {} };
  }

  function wirePc(p) {
    p.onconnectionstatechange = () => {
      if (p.connectionState === 'failed' || p.connectionState === 'disconnected') emit('close');
    };
  }

  const Net = {
    connected: () => !!(ch && ch.readyState === 'open'),

    async host() {
      reset();
      pc = new RTCPeerConnection(RTC_CFG);
      wirePc(pc);
      wireChannel(pc.createDataChannel('game', { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      await waitIce(pc);
      return encode(pc.localDescription);
    },

    async acceptAnswer(code) {
      await pc.setRemoteDescription(decode(code));
    },

    async join(offerCode) {
      reset();
      pc = new RTCPeerConnection(RTC_CFG);
      wirePc(pc);
      pc.ondatachannel = (e) => wireChannel(e.channel);
      await pc.setRemoteDescription(decode(offerCode));
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIce(pc);
      return encode(pc.localDescription);
    },

    send(obj) {
      if (Net.connected()) ch.send(JSON.stringify(obj));
    },

    onMessage(f) { listeners.message.push(f); },
    onOpen(f) { listeners.open.push(f); },
    onClose(f) { listeners.close.push(f); },
    close: reset,
  };

  window.Net = Net;
})();
