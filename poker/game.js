/* 3D 撲克牌合集 — 大老二、21點、排七、抽鬼牌 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const svg = $('scene');

  // ================= 撲克牌工具 =================
  const SUITS = ['d', 'c', 'h', 's'];
  const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
  function deck52() { const d = []; for (const s of SUITS) for (let r = 1; r <= 13; r++) d.push({ suit: s, rank: r }); return d; }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const cardEq = (a, b) => a && b && a.suit === b.suit && a.rank === b.rank && !!a.joker === !!b.joker;
  const rlabel = (r) => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[r] || '' + r);

  // ================= 共用狀態 =================
  let game = 'bigtwo', diff = 'hard', numPlayers = 4;
  let players = [], hands = [], turn = 0, over = true, winner = -1;
  let centerCards = [], centerLabels = [], selected = new Set();
  let handXs = [], aiTimer = null;
  const anims = [];
  // 安全空場
  players = [{ ai: false, name: '' }]; hands = [[]];

  // ================= 3D 渲染基礎 =================
  const cam = E3D.createCamera({ yaw: 0, pitch: 0.82, dist: 25, target: [0, 0, 1.5], fov: 0.8, minDist: 13, maxDist: 42, minPitch: 0.3, maxPitch: 1.35 });
  let W2 = 0, H2 = 0, dirty = true;
  function resize() { W2 = innerWidth; H2 = innerHeight; svg.setAttribute('viewBox', `0 0 ${W2} ${H2}`); dirty = true; }
  addEventListener('resize', resize); resize();

  const CW = 1.5, CD = 2.2, HAND_Z = 6.4;

  function seat(pi) {
    if (numPlayers === 2) return [{ x: 0, z: HAND_Z, rot: 0 }, { x: 0, z: -6, rot: 0 }][pi];
    if (numPlayers === 3) return [{ x: 0, z: HAND_Z, rot: 0 }, { x: -8.5, z: -1, rot: 90 }, { x: 8.5, z: -1, rot: 90 }][pi];
    return [{ x: 0, z: HAND_Z, rot: 0 }, { x: -9.5, z: 0, rot: 90 }, { x: 0, z: -6, rot: 0 }, { x: 9.5, z: 0, rot: 90 }][pi];
  }
  function handLayout(n, spanMax, step0) {
    const span = Math.min(spanMax, n * (step0 || CW * 0.5));
    const step = n > 1 ? span / (n - 1) : 0;
    const arr = []; for (let i = 0; i < n; i++) arr.push((i - (n - 1) / 2) * step);
    return arr;
  }

  const DEFS = `<defs>${E3D.DEFS}
    <radialGradient id="feltG" cx=".5" cy=".42" r=".78"><stop offset="0" stop-color="#2f5540"/><stop offset="1" stop-color="#1c3527"/></radialGradient>
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6e451f"/><stop offset="1" stop-color="#3c250e"/></linearGradient>
  </defs>`;
  function quadS(view, pts3, fill, extra) {
    const ps = pts3.map((p) => view.project(p)); if (ps.some((p) => !p)) return '';
    return `<path d="${E3D.pathOf(ps, true)}" fill="${fill}"${extra || ''}/>`;
  }
  function faceOf(card) { return Cards3D.standardFace(card); }

  function render() {
    const view = E3D.makeView(cam, W2, H2);
    let s = DEFS;
    s += quadS(view, [[-30, -0.4, -24], [30, -0.4, -24], [30, -0.4, 28], [-30, -0.4, 28]], 'url(#wood)');
    const felt = [];
    for (let i = 0; i < 44; i++) { const a = i / 44 * Math.PI * 2; const p = view.project([Math.cos(a) * 13.5, 0, Math.sin(a) * 11 + 0.5]); if (p) felt.push(p); }
    if (felt.length > 3) s += `<path d="${E3D.pathOf(felt, true)}" fill="url(#feltG)" stroke="#14261b" stroke-width="2"/>`;

    const items = [];
    // 中央牌區（各遊戲填充）
    for (const cc of centerCards) {
      const c = Cards3D.draw(view, cc.x, cc.z, CW * (cc.scale || 1), CD * (cc.scale || 1), cc.rot || 0, cc.face === null ? null : (cc.face || faceOf(cc.card)), { y: cc.y != null ? cc.y : 0.02, lift: cc.lift || 0, shadow: cc.shadow !== false, textRot: cc.rot || 0 });
      if (c) items.push({ svg: c.svg, depth: c.depth + (cc.z0 || 0) });
    }
    // 對手手牌（牌背 + 張數）
    for (let pi = 1; pi < numPlayers; pi++) {
      if (!hands[pi]) continue;
      const st = seat(pi), n = hands[pi].length;
      const offs = handLayout(n, 6, CW * 0.42);
      for (let i = 0; i < n; i++) {
        const cx = st.rot === 90 ? st.x : st.x + offs[i];
        const cz = st.rot === 90 ? st.z + offs[i] : st.z;
        const c = Cards3D.draw(view, cx, cz, CW * 0.85, CD * 0.85, st.rot, null, { y: 0.02, shadow: i === 0, textRot: st.rot });
        if (c) items.push({ svg: c.svg, depth: c.depth });
      }
      const lp = view.project([st.x, 1.4, st.z]);
      if (lp) items.push({ svg: `<text x="${E3D.fmt(lp.x)}" y="${E3D.fmt(lp.y)}" font-size="${E3D.fmt(lp.s * 0.72)}" fill="${turn === pi ? '#d9a441' : '#cdd6e2'}" text-anchor="middle" font-family="'Noto Sans TC',sans-serif" font-weight="${turn === pi ? 700 : 400}">${players[pi].name}・${n}</text>`, depth: -999 });
    }
    // 玩家手牌
    const n0 = hands[0] ? hands[0].length : 0;
    handXs = handLayout(n0, 12, CW * 0.62);
    for (let i = 0; i < n0; i++) {
      const card = hands[0][i];
      const sel = selected.has(i);
      const lift = sel ? 0.6 : 0;
      const showFace = game !== 'oldmaid'; // 抽鬼牌自己的牌也蓋著
      const c = Cards3D.draw(view, handXs[i], HAND_Z, CW, CD, 0, showFace ? faceOf(card) : null, { y: 0.05, lift, shadow: i === 0 });
      if (c) items.push({ svg: c.svg, depth: c.depth - i * 0.01 });
    }
    // 中央文字標籤
    for (const L of centerLabels) {
      const p = view.project([L.x, L.y != null ? L.y : 0.1, L.z]);
      if (p) items.push({ svg: `<text x="${E3D.fmt(p.x)}" y="${E3D.fmt(p.y)}" font-size="${E3D.fmt(p.s * (L.size || 0.7))}" fill="${L.color || '#e8edf4'}" text-anchor="middle" font-family="'Noto Sans TC',sans-serif" font-weight="700">${L.text}</text>`, depth: -1000 });
    }
    // 飛牌動畫
    const now = performance.now();
    for (const a of anims) {
      const t = Math.min(1, (now - a.t0) / a.dur), e = E3D.ease.outCubic(t);
      const x = a.from.x + (a.to.x - a.from.x) * e, z = a.from.z + (a.to.z - a.from.z) * e;
      const c = Cards3D.draw(view, x, z, CW, CD, 0, a.face === null ? null : faceOf(a.card), { y: 0.05, lift: Math.sin(t * Math.PI) * 1.4 });
      if (c) items.push({ svg: c.svg, depth: -1e6 });
    }

    items.sort((a, b) => b.depth - a.depth);
    for (const it of items) s += it.svg;
    svg.innerHTML = s;
  }

  function tick() {
    if (W2 !== innerWidth || H2 !== innerHeight) resize();
    const now = performance.now();
    for (let i = anims.length - 1; i >= 0; i--) if (now - anims[i].t0 > anims[i].dur) anims.splice(i, 1);
    if (dirty || anims.length) { try { render(); } catch (e) { console.error('render', e); } dirty = anims.length > 0; }
    schedule();
  }
  function schedule() { if (document.hidden) setTimeout(tick, 250); else requestAnimationFrame(tick); }
  schedule();

  function flyCard(card, fromPi, face) {
    const s = seat(fromPi); anims.push({ card, face, from: { x: s.x, z: s.z }, to: { x: 0, z: 0.5 }, t0: performance.now(), dur: 300 });
  }

  // 動作按鈕
  function setButtons(btns) {
    const bar = $('actbar2');
    if (!btns || !btns.length) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
    bar.classList.remove('hidden');
    bar.innerHTML = btns.map((b, i) => `<button data-i="${i}"${b.disabled ? ' disabled' : ''} class="${b.primary ? 'primary' : ''}">${b.label}</button>`).join('');
    [...bar.children].forEach((el, i) => el.addEventListener('click', btns[i].on));
  }

  // ================= 大老二 =================
  const BT = {};
  const BT_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 1, 2];
  const rankIdx = (r) => BT_ORDER.indexOf(r);
  const suitIdx = (s) => ({ d: 0, c: 1, h: 2, s: 3 }[s]);
  const cardVal = (c) => rankIdx(c.rank) * 4 + suitIdx(c.suit);

  function parseCombo(cards) {
    const n = cards.length;
    if (n === 0) return null;
    const sorted = cards.slice().sort((a, b) => cardVal(a) - cardVal(b));
    const ranks = sorted.map((c) => c.rank);
    const allSameRank = ranks.every((r) => r === ranks[0]);
    if (n === 1) return { type: 'single', pri: 0, size: 1, key: cardVal(sorted[0]) };
    if (n === 2) return allSameRank ? { type: 'pair', pri: 0, size: 2, key: cardVal(sorted[1]) } : null;
    if (n === 3) return allSameRank ? { type: 'triple', pri: 0, size: 3, key: cardVal(sorted[2]) } : null;
    if (n === 5) {
      const suitsSame = sorted.every((c) => c.suit === sorted[0].suit);
      // 順子：BT_ORDER 連續且不含 2（rankIdx 0..11 連續）
      let straight = true;
      for (let i = 1; i < 5; i++) if (rankIdx(sorted[i].rank) !== rankIdx(sorted[0].rank) + i) straight = false;
      if (rankIdx(sorted[4].rank) > 11) straight = false; // 含 2 不算
      // 計數
      const cnt = {}; for (const r of ranks) cnt[r] = (cnt[r] || 0) + 1;
      const counts = Object.values(cnt).sort((a, b) => b - a);
      const key5 = cardVal(sorted[4]);
      if (straight && suitsSame) return { type: 'straightflush', pri: 5, size: 5, key: key5 };
      if (counts[0] === 4) { const quad = +Object.keys(cnt).find((r) => cnt[r] === 4); return { type: 'four', pri: 4, size: 5, key: rankIdx(quad) }; }
      if (counts[0] === 3 && counts[1] === 2) { const tri = +Object.keys(cnt).find((r) => cnt[r] === 3); return { type: 'fullhouse', pri: 3, size: 5, key: rankIdx(tri) }; }
      if (suitsSame) return { type: 'flush', pri: 2, size: 5, key: key5 };
      if (straight) return { type: 'straight', pri: 1, size: 5, key: key5 };
      return null;
    }
    return null;
  }
  function comboBeats(a, b) { // a 是否勝過 b（同尺寸）
    if (!a || !b || a.size !== b.size) return false;
    if (a.size === 5) { if (a.pri !== b.pri) return a.pri > b.pri; return a.key > b.key; }
    return a.key > b.key;
  }

  function bt_start() {
    players = []; for (let i = 0; i < 4; i++) players.push({ ai: i !== 0, name: i === 0 ? '你' : '電腦 ' + i });
    numPlayers = 4;
    const d = shuffle(deck52());
    hands = [[], [], [], []];
    for (let i = 0; i < 52; i++) hands[i % 4].push(d[i]);
    for (const h of hands) h.sort((a, b) => cardVal(a) - cardVal(b));
    // 找 ♦3 起手
    turn = hands.findIndex((h) => h.some((c) => c.suit === 'd' && c.rank === 3));
    BT.trick = null; BT.passes = 0; BT.first = true; BT.lastBy = turn;
    over = false; winner = -1; selected.clear();
    bt_updateCenter();
    bt_status();
    if (players[turn].ai) scheduleAI(); else bt_humanButtons();
  }

  function bt_updateCenter(combo, cards) {
    centerCards = []; centerLabels = [];
    if (BT.trick && BT.trickCards) {
      const xs = handLayout(BT.trickCards.length, 5, CW * 0.75);
      BT.trickCards.forEach((c, i) => centerCards.push({ card: c, x: xs[i], z: 0.5, y: 0.03 }));
    } else {
      centerLabels.push({ text: BT.first ? '請出含 ♦3 的牌' : '自由出牌', x: 0, z: 0.5, color: '#9fb0c3', size: 0.6 });
    }
  }

  function bt_status() {
    if (over) { Shell.setStatus(`${players[winner].name} 獲勝`); return; }
    const counts = players.map((p, i) => `${i === turn ? '▶' : ''}${p.name} ${hands[i].length}`).join('　');
    Shell.setStatus(`大老二｜${counts}`);
    renderPanel();
  }
  function renderPanel() {
    const dots = ['#c85a4f', '#e2b93b', '#7cc576', '#5a8fe0'];
    $('panel').innerHTML = players.map((p, i) => `<div class="pl ${i === turn && !over ? 'cur' : ''} ${hands[i].length === 0 ? 'dead' : ''}"><span class="dot" style="background:${dots[i]}"></span>${p.name}：${hands[i].length} 張</div>`).join('');
  }

  function bt_humanButtons() {
    if (over || turn !== 0) { setButtons(null); return; }
    const canPass = !(BT.first && BT.trick === null) && BT.trick !== null;
    setButtons([
      { label: '出牌', primary: true, on: () => bt_tryHuman() },
      { label: 'PASS', disabled: !canPass, on: () => bt_pass(0) },
    ]);
  }

  function bt_validLead(combo, cards) {
    if (!combo) return false;
    if (BT.first) { // 首手必含 ♦3
      if (!cards.some((c) => c.suit === 'd' && c.rank === 3)) return false;
    }
    return true;
  }

  function bt_tryHuman() {
    const idxs = [...selected].sort((a, b) => a - b);
    const cards = idxs.map((i) => hands[0][i]);
    const combo = parseCombo(cards);
    if (!combo) { flashPanel('牌型不符'); return; }
    if (BT.trick === null) { if (!bt_validLead(combo, cards)) { flashPanel(BT.first ? '首手需含 ♦3' : '牌型不符'); return; } }
    else if (!comboBeats(combo, BT.trick)) { flashPanel('壓不過上家'); return; }
    bt_doPlay(0, idxs, combo);
  }
  function flashPanel(msg) { const p = $('panel'); const old = p.innerHTML; p.innerHTML = `<div style="color:#e0a04a">${msg}</div>` + old; setTimeout(renderPanel, 1200); }

  function bt_doPlay(pi, idxs, combo) {
    const cards = idxs.map((i) => hands[pi][i]);
    for (const c of cards) flyCard(c, pi);
    idxs.sort((a, b) => b - a).forEach((i) => hands[pi].splice(i, 1));
    BT.trick = combo; BT.trickCards = cards.slice(); BT.lastBy = pi; BT.passes = 0; BT.first = false;
    selected.clear();
    if (hands[pi].length === 0) { bt_end(pi); return; }
    bt_updateCenter();
    turn = (turn + 1) % 4;
    bt_advance();
  }
  function bt_pass(pi) {
    BT.passes++;
    selected.clear();
    if (BT.passes >= 3) { // 一圈都 pass，最後出牌者自由領牌
      BT.trick = null; BT.trickCards = null; BT.passes = 0; turn = BT.lastBy;
      bt_updateCenter();
    } else {
      turn = (turn + 1) % 4;
    }
    bt_advance();
  }
  function bt_advance() {
    bt_status(); dirty = true;
    if (over) return;
    if (players[turn].ai) scheduleAI(); else bt_humanButtons();
  }

  function bt_aiTurn(pi) {
    // 產生候選：能壓過或（自由時）任意
    const hand = hands[pi];
    let best = null;
    if (BT.trick === null) {
      // 自由領牌：出最小的單張（若首手需含♦3，出含♦3最小組合）
      if (BT.first) {
        const i3 = hand.findIndex((c) => c.suit === 'd' && c.rank === 3);
        best = { idxs: [i3], combo: parseCombo([hand[i3]]) };
      } else {
        best = { idxs: [0], combo: parseCombo([hand[0]]) }; // 最小單張
        // hard：若有最小對子也可考慮，但簡化維持單張
      }
    } else {
      best = bt_findBeat(hand, BT.trick, pi);
    }
    if (!best) { bt_pass(pi); return; }
    bt_doPlay(pi, best.idxs, best.combo);
  }

  function bt_findBeat(hand, trick, pi) {
    const size = trick.size;
    const cand = [];
    if (size === 1) {
      for (let i = 0; i < hand.length; i++) { const c = parseCombo([hand[i]]); if (comboBeats(c, trick)) cand.push({ idxs: [i], combo: c }); }
    } else if (size === 2) {
      for (let i = 0; i < hand.length; i++) for (let j = i + 1; j < hand.length; j++) { const c = parseCombo([hand[i], hand[j]]); if (c && comboBeats(c, trick)) cand.push({ idxs: [i, j], combo: c }); }
    } else if (size === 3) {
      for (let i = 0; i < hand.length; i++) for (let j = i + 1; j < hand.length; j++) for (let k = j + 1; k < hand.length; k++) { const c = parseCombo([hand[i], hand[j], hand[k]]); if (c && comboBeats(c, trick)) cand.push({ idxs: [i, j, k], combo: c }); }
    } else if (size === 5) {
      const idx = hand.map((_, i) => i);
      // 列舉 5 子集（13 取 5 = 1287）
      for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) for (let c2 = b + 1; c2 < idx.length; c2++) for (let d2 = c2 + 1; d2 < idx.length; d2++) for (let e = d2 + 1; e < idx.length; e++) {
        const cc = [hand[a], hand[b], hand[c2], hand[d2], hand[e]]; const combo = parseCombo(cc);
        if (combo && comboBeats(combo, trick)) cand.push({ idxs: [a, b, c2, d2, e], combo });
      }
    }
    if (!cand.length) return null;
    // 選最小壓制（保守）；easy 有機率放棄
    cand.sort((x, y) => (x.combo.pri - y.combo.pri) || (x.combo.key - y.combo.key));
    if (diff === 'easy' && Math.random() < 0.3) return null; // 隨機蓋牌
    // hard：若要用炸彈(four/sf)壓小牌則保留
    if (diff === 'hard' && trick.size <= 2 && cand[0].combo.size === 5 && cand[0].combo.pri >= 4) {
      // 沒有同尺寸壓制才被迫用大牌，這裡 size 不同不會發生；保留判斷
    }
    return cand[0];
  }

  function bt_end(pi) { over = true; winner = pi; setButtons(null); bt_status(); const big = pi === 0 ? '你贏了！' : players[pi].name + ' 獲勝'; setTimeout(() => Shell.showBanner(big, '大老二'), 500); }

  function bt_tapHand(idx) {
    if (turn !== 0 || over) return;
    if (selected.has(idx)) selected.delete(idx); else selected.add(idx);
    dirty = true;
  }

  // ================= 21 點 =================
  const BJ = {};
  function bjVal(hand) {
    let sum = 0, aces = 0;
    for (const c of hand) { let v = c.rank; if (v > 10) v = 10; if (v === 1) { aces++; v = 11; } sum += v; }
    while (sum > 21 && aces > 0) { sum -= 10; aces--; }
    return sum;
  }
  function bj_start() {
    numPlayers = 2; players = [{ ai: false, name: '你' }, { ai: true, name: '莊家' }];
    BJ.deck = shuffle(deck52().concat(deck52())); // 兩副
    BJ.player = [BJ.deck.pop(), BJ.deck.pop()];
    BJ.dealer = [BJ.deck.pop(), BJ.deck.pop()];
    BJ.phase = 'player'; BJ.result = '';
    hands = [BJ.player, []]; // 用共用手牌槽顯示玩家；莊家另畫
    turn = 0; over = false;
    bj_render();
    const pv = bjVal(BJ.player);
    if (pv === 21) bj_stand();
    else bj_buttons();
    bj_status();
  }
  function bj_render() {
    centerCards = []; centerLabels = [];
    // 莊家牌（上方）
    const dl = BJ.dealer.length, xs = handLayout(dl, 5, CW * 0.75);
    BJ.dealer.forEach((c, i) => {
      const hidden = BJ.phase === 'player' && i === 1;
      centerCards.push({ card: c, face: hidden ? null : faceOf(c), x: xs[i], z: -4, y: 0.03 });
    });
    centerLabels.push({ text: `莊家 ${BJ.phase === 'player' ? '?' : bjVal(BJ.dealer)}`, x: 0, z: -6, color: '#cdd6e2', size: 0.7 });
    centerLabels.push({ text: `你 ${bjVal(BJ.player)}`, x: 0, z: 4.4, color: '#d9a441', size: 0.75 });
    hands = [BJ.player, []];
    dirty = true;
  }
  function bj_buttons() {
    setButtons([
      { label: '要牌', primary: true, on: () => bj_hit() },
      { label: '停牌', on: () => bj_stand() },
    ]);
  }
  function bj_hit() {
    if (BJ.phase !== 'player') return;
    BJ.player.push(BJ.deck.pop());
    bj_render();
    if (bjVal(BJ.player) > 21) { BJ.phase = 'done'; bj_finish('爆牌！莊家勝', false); }
    else bj_status();
  }
  function bj_stand() {
    BJ.phase = 'dealer';
    setButtons(null);
    bj_render();
    bj_dealerStep();
  }
  function bj_dealerStep() {
    const step = () => {
      if (bjVal(BJ.dealer) < 17) { BJ.dealer.push(BJ.deck.pop()); bj_render(); bj_status(); aiTimer = setTimeout(step, 600); }
      else { BJ.phase = 'done'; bj_settle(); }
    };
    aiTimer = setTimeout(step, 600);
  }
  function bj_settle() {
    const pv = bjVal(BJ.player), dv = bjVal(BJ.dealer);
    let msg, win;
    if (dv > 21) { msg = '莊家爆牌，你贏了！'; win = true; }
    else if (pv > dv) { msg = `${pv} 比 ${dv}，你贏了！`; win = true; }
    else if (pv < dv) { msg = `${pv} 比 ${dv}，莊家勝`; win = false; }
    else { msg = `平手 ${pv}`; win = null; }
    bj_finish(msg, win);
  }
  function bj_finish(msg, win) {
    over = true; bj_render(); setButtons([{ label: '再來一局', primary: true, on: () => bj_start() }]);
    Shell.setStatus(msg);
    setTimeout(() => Shell.showBanner(win === true ? '你贏了！' : win === false ? '莊家勝' : '平手', msg), 400);
  }
  function bj_status() { Shell.setStatus(`21 點｜你 ${bjVal(BJ.player)} 點｜莊家 ${BJ.phase === 'player' ? '?' : bjVal(BJ.dealer)}`); $('panel').innerHTML = ''; }

  // ================= 排七 =================
  const SV = {};
  function sv_start() {
    numPlayers = 4; players = []; for (let i = 0; i < 4; i++) players.push({ ai: i !== 0, name: i === 0 ? '你' : '電腦 ' + i });
    const d = shuffle(deck52()); hands = [[], [], [], []];
    for (let i = 0; i < 52; i++) hands[i % 4].push(d[i]);
    for (const h of hands) h.sort((a, b) => (suitIdx(a.suit) - suitIdx(b.suit)) || (a.rank - b.rank));
    SV.board = { d: null, c: null, h: null, s: null }; // 每花色 {lo,hi}
    turn = hands.findIndex((h) => h.some((c) => c.suit === 'd' && c.rank === 7));
    SV.passes = 0; over = false; winner = -1; selected.clear();
    sv_updateCenter(); sv_status();
    if (players[turn].ai) scheduleAI(); else sv_buttons();
  }
  function sv_playable(pi) {
    const out = [];
    hands[pi].forEach((c, i) => { if (sv_canPlay(c)) out.push(i); });
    return out;
  }
  function sv_canPlay(c) {
    const b = SV.board[c.suit];
    if (c.rank === 7) return b === null;
    if (b === null) return false;
    return c.rank === b.lo - 1 || c.rank === b.hi + 1;
  }
  function sv_do(pi, idx) {
    const c = hands[pi][idx];
    flyCard(c, pi);
    hands[pi].splice(idx, 1);
    const b = SV.board[c.suit];
    if (c.rank === 7) SV.board[c.suit] = { lo: 7, hi: 7 };
    else if (c.rank === b.lo - 1) b.lo = c.rank; else b.hi = c.rank;
    SV.passes = 0; selected.clear();
    if (hands[pi].length === 0) { sv_end(pi); return; }
    sv_updateCenter();
    turn = (turn + 1) % 4; sv_advance();
  }
  function sv_pass(pi) { SV.passes++; turn = (turn + 1) % 4; selected.clear(); sv_advance(); }
  function sv_advance() { sv_status(); dirty = true; if (over) return; if (players[turn].ai) scheduleAI(); else sv_buttons(); }
  function sv_buttons() {
    const pl = sv_playable(0);
    setButtons([{ label: pl.length ? '出牌' : '無牌可出', primary: true, disabled: !pl.length || selected.size !== 1, on: () => { const i = [...selected][0]; if (sv_canPlay(hands[0][i])) sv_do(0, i); else flashPanel('這張不能出'); } },
      { label: 'PASS', disabled: pl.length > 0, on: () => sv_pass(0) }]);
  }
  function sv_aiTurn(pi) {
    const pl = sv_playable(pi);
    if (!pl.length) { sv_pass(pi); return; }
    // 策略：hard 優先出 7 與接近端點的牌以打開牌路；easy 隨機
    let idx;
    if (diff === 'easy') idx = pl[(Math.random() * pl.length) | 0];
    else { pl.sort((a, b) => { const ca = hands[pi][a], cb = hands[pi][b]; const pa = ca.rank === 7 ? 0 : Math.min(Math.abs(ca.rank - 7), 6); const pb = cb.rank === 7 ? 0 : Math.min(Math.abs(cb.rank - 7), 6); return pa - pb; }); idx = pl[0]; }
    sv_do(pi, idx);
  }
  function sv_updateCenter() {
    centerCards = []; centerLabels = [];
    const suitZ = { s: -3, h: -1, d: 1, c: 3 };
    for (const su of SUITS) {
      const b = SV.board[su];
      const z = suitZ[su];
      if (!b) { centerLabels.push({ text: SUIT_SYM[su], x: -6.5, z, color: '#6d7d92', size: 0.6 }); continue; }
      // 顯示區間端點兩張（lo 與 hi），中間省略以文字
      const loC = { suit: su, rank: b.lo }, hiC = { suit: su, rank: b.hi };
      centerCards.push({ card: loC, x: -2, z, y: 0.03, scale: 0.8 });
      if (b.hi !== b.lo) centerCards.push({ card: hiC, x: 2, z, y: 0.03, scale: 0.8 });
      centerLabels.push({ text: `${rlabel(b.lo)}–${rlabel(b.hi)}`, x: 5.4, z, color: '#cdd6e2', size: 0.5 });
    }
  }
  function sv_status() {
    if (over) { Shell.setStatus(`${players[winner].name} 獲勝`); return; }
    const counts = players.map((p, i) => `${i === turn ? '▶' : ''}${p.name} ${hands[i].length}`).join('　');
    Shell.setStatus(`排七｜${counts}`);
    const dots = ['#c85a4f', '#e2b93b', '#7cc576', '#5a8fe0'];
    $('panel').innerHTML = players.map((p, i) => `<div class="pl ${i === turn && !over ? 'cur' : ''} ${hands[i].length === 0 ? 'dead' : ''}"><span class="dot" style="background:${dots[i]}"></span>${p.name}：${hands[i].length} 張</div>`).join('');
  }
  function sv_end(pi) { over = true; winner = pi; setButtons(null); sv_status(); setTimeout(() => Shell.showBanner(pi === 0 ? '你贏了！' : players[pi].name + ' 獲勝', '排七'), 500); }
  function sv_tapHand(idx) { if (turn !== 0 || over) return; selected.clear(); selected.add(idx); dirty = true; sv_buttons(); }

  // ================= 抽鬼牌 =================
  const OM = {};
  function om_start() {
    numPlayers = 4; players = []; for (let i = 0; i < 4; i++) players.push({ ai: i !== 0, name: i === 0 ? '你' : '電腦 ' + i });
    const d = shuffle(deck52()); d.push({ joker: true });
    hands = [[], [], [], []];
    d.forEach((c, i) => hands[i % 4].push(c));
    for (const h of hands) om_discardPairs(h);
    OM.alive = [true, true, true, true];
    turn = 0; over = false; winner = -1;
    om_check();
    om_updateCenter(); om_status();
    om_turnFlow();
  }
  function om_discardPairs(h) {
    const byRank = {};
    for (const c of h) { if (c.joker) continue; (byRank[c.rank] = byRank[c.rank] || []).push(c); }
    const remove = new Set();
    for (const r in byRank) { const arr = byRank[r]; const pairs = Math.floor(arr.length / 2) * 2; for (let i = 0; i < pairs; i++) remove.add(arr[i]); }
    for (let i = h.length - 1; i >= 0; i--) if (remove.has(h[i])) h.splice(i, 1);
  }
  const om_nextAlive = (t) => { let n = t; for (let k = 0; k < 4; k++) { n = (n + 1) % 4; if (OM.alive[n] && hands[n].length) return n; } return -1; };
  function om_check() {
    for (let i = 0; i < 4; i++) if (hands[i].length === 0) OM.alive[i] = false;
    const left = OM.alive.filter(Boolean).length;
    return left;
  }
  function om_draw(from, to) { // to 從 from 抽一張
    const src = hands[from];
    const i = (Math.random() * src.length) | 0;
    const c = src.splice(i, 1)[0];
    hands[to].push(c);
    om_discardPairs(hands[to]);
    dirty = true;
    return c;
  }
  function om_turnFlow() {
    om_updateCenter(); om_status();
    if (over) return;
    // 目前玩家從「上家（下一個有牌的人）」抽？規則：從下家抽。這裡：turn 從 next 抽
    const src = om_nextAlive(turn);
    if (src < 0 || hands[turn].length === 0) { turn = om_nextAlive(turn); if (om_check() <= 1) { om_end(); return; } setTimeout(om_turnFlow, 300); return; }
    if (players[turn].ai) {
      setButtons(null);
      aiTimer = setTimeout(() => { om_draw(src, turn); om_afterDraw(); }, 700);
    } else {
      // 人類：點按鈕從下家抽
      setButtons([{ label: `從 ${players[src].name} 抽一張`, primary: true, on: () => { om_draw(src, turn); om_afterDraw(); } }]);
    }
  }
  function om_afterDraw() {
    if (om_check() <= 1) { om_end(); return; }
    turn = om_nextAlive(turn);
    om_turnFlow();
  }
  function om_updateCenter() {
    centerCards = []; centerLabels = [];
    centerLabels.push({ text: over ? '' : `輪到 ${players[turn] ? players[turn].name : ''} 抽牌`, x: 0, z: 0.5, color: '#9fb0c3', size: 0.6 });
  }
  function om_status() {
    const counts = players.map((p, i) => `${i === turn && !over ? '▶' : ''}${p.name} ${hands[i].length}${OM.alive[i] ? '' : '✓'}`).join('　');
    Shell.setStatus(`抽鬼牌｜${counts}`);
    const dots = ['#c85a4f', '#e2b93b', '#7cc576', '#5a8fe0'];
    $('panel').innerHTML = players.map((p, i) => `<div class="pl ${i === turn && !over ? 'cur' : ''} ${!OM.alive[i] ? 'dead' : ''}"><span class="dot" style="background:${dots[i]}"></span>${p.name}：${hands[i].length} 張${OM.alive[i] ? '' : '（過關）'}</div>`).join('');
  }
  function om_end() {
    over = true;
    const loser = OM.alive.findIndex((a, i) => a && hands[i].some((c) => c.joker));
    let li = loser;
    if (li < 0) li = OM.alive.findIndex(Boolean);
    winner = li === 0 ? -2 : 0;
    setButtons([{ label: '再玩一局', primary: true, on: () => om_start() }]);
    om_status();
    const msg = li === 0 ? '你拿到鬼牌，輸了！' : `${players[li].name} 拿到鬼牌`;
    setTimeout(() => Shell.showBanner(li === 0 ? '你輸了' : '你過關！', msg), 400);
  }

  // ================= 通用排程/輸入 =================
  function scheduleAI() {
    clearTimeout(aiTimer);
    if (over || !players[turn] || !players[turn].ai) return;
    const fn = game === 'bigtwo' ? bt_aiTurn : game === 'sevens' ? sv_aiTurn : null;
    if (!fn) return;
    aiTimer = setTimeout(() => { if (!over && players[turn] && players[turn].ai) fn(turn); }, 650);
  }

  E3D.attachControls(svg, cam, {
    onChange: () => { dirty = true; },
    onTap: (px, py) => {
      if (over || turn !== 0) return;
      if (game === 'blackjack') return;
      const view = E3D.makeView(cam, W2, H2);
      const hit = E3D.pickPlane(view, px, py, 0.05);
      if (!hit) return;
      for (let i = hands[0].length - 1; i >= 0; i--) {
        if (Cards3D.hit(handXs[i], HAND_Z, CW, CD, 0, hit[0], hit[2])) {
          if (game === 'bigtwo') bt_tapHand(i);
          else if (game === 'sevens') sv_tapHand(i);
          return;
        }
      }
    },
  });

  // ================= DBG / Shell =================
  window.DBG = {
    cam, view: () => E3D.makeView(cam, W2, H2),
    state: () => ({ game, hands: hands.map((h) => h.slice()), turn, over, winner, trick: BT.trick, board: SV.board }),
    startGame: (g, d) => start({ game: g, diff: d }),
    bt: { parseCombo, comboBeats, cardVal, aiTurn: bt_aiTurn, findBeat: bt_findBeat, get trick() { return BT.trick; } },
    sv: { canPlay: sv_canPlay, playable: sv_playable, aiTurn: sv_aiTurn },
    bj: { val: bjVal, hit: bj_hit, stand: bj_stand, get st() { return BJ; } },
    play: (idxs) => { idxs.forEach((i) => selected.add(i)); if (game === 'bigtwo') bt_tryHuman(); },
    selectClearAdd: (i) => { selected.clear(); selected.add(i); },
    omAuto: () => { // 同步跑完抽鬼牌（測試用）
      let guard = 0;
      while (om_check() > 1 && guard++ < 500) {
        if (hands[turn].length === 0) { turn = om_nextAlive(turn); continue; }
        const src = om_nextAlive(turn);
        if (src < 0) break;
        om_draw(src, turn);
        if (om_check() <= 1) break;
        turn = om_nextAlive(turn);
      }
      om_end();
      return { guard, alive: OM.alive.slice(), handSizes: hands.map((h) => h.length), winner };
    },
  };

  function start(cfg) {
    game = cfg.game; diff = cfg.diff || 'hard';
    clearTimeout(aiTimer); anims.length = 0; selected.clear();
    setButtons(null); $('panel').innerHTML = '';
    if (game === 'bigtwo') bt_start();
    else if (game === 'blackjack') bj_start();
    else if (game === 'sevens') sv_start();
    else if (game === 'oldmaid') om_start();
    dirty = true;
  }

  Shell.init({
    title: '3D 撲克牌',
    startTitle: '選擇遊戲',
    sections: [
      { id: 'game', label: '遊戲', default: 'bigtwo', options: [
        { id: 'bigtwo', label: '大老二' }, { id: 'blackjack', label: '21 點' },
        { id: 'sevens', label: '排七' }, { id: 'oldmaid', label: '抽鬼牌' },
      ] },
      { id: 'diff', label: '電腦難度', default: 'hard', options: [
        { id: 'easy', label: '輕鬆' }, { id: 'hard', label: '進階' },
      ] },
    ],
    bar: {},
    hint: '拖曳環顧視角．滾輪縮放．依畫面下方按鈕操作',
    rulesHtml: '大老二/排七：點牌選取再按出牌．21 點：要牌或停牌．抽鬼牌：從下家抽牌湊對，最後留鬼者輸。',
    onStart: start,
    onResetView: () => { cam.yaw = 0; cam.pitch = 0.82; cam.dist = 25; dirty = true; },
  });
})();
