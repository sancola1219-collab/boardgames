/* 3D UNO — 2-4 人（1 人類 + AI）、兩段 AI、完整規則 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const svg = $('scene');

  const COLORS = ['R', 'Y', 'G', 'B'];
  const COLOR_HEX = { R: '#c8352b', Y: '#e2b93b', G: '#3f9f56', B: '#3d78c8', W: '#2b2b33' };
  const COLOR_NAME = { R: '紅', Y: '黃', G: '綠', B: '藍' };
  const VAL_LABEL = { skip: '⊘', rev: '⇄', d2: '+2', wild: '★', wd4: '+4' };

  // ================= 牌組 =================
  function buildDeck() {
    const d = [];
    for (const c of COLORS) {
      d.push({ c, v: '0' });
      for (let n = 1; n <= 9; n++) { d.push({ c, v: '' + n }); d.push({ c, v: '' + n }); }
      for (const a of ['skip', 'rev', 'd2']) { d.push({ c, v: a }); d.push({ c, v: a }); }
    }
    for (let i = 0; i < 4; i++) { d.push({ c: 'W', v: 'wild' }); d.push({ c: 'W', v: 'wd4' }); }
    return d;
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ================= 狀態 =================
  let players, hands, deck, discard, curColor, turn, dir, over, diff, drawPending, mustDraw;
  let winner = -1, aiTimer = null, pendingWild = null;
  let numPlayers = 2;
  const anims = []; // {card, from:{x,z}, to:{x,z}, t0, dur}
  // 開局前的空場（讓對話框後方就有牌桌）；兩個空手牌避免迴圈越界
  players = [{ ai: false, name: '' }, { ai: true, name: '' }];
  hands = [[], []]; deck = []; discard = []; curColor = 'R'; turn = -1; dir = 1; over = true;

  function reset(cfg) {
    numPlayers = +cfg.players;
    diff = cfg.diff;
    players = [];
    for (let i = 0; i < numPlayers; i++) players.push({ ai: i !== 0, name: i === 0 ? '你' : '電腦 ' + i });
    deck = shuffle(buildDeck());
    hands = players.map(() => deck.splice(0, 7));
    // 翻第一張非萬用當起始
    let first;
    do { first = deck.shift(); if (first.c === 'W') deck.push(first); } while (first.c === 'W');
    discard = [first];
    curColor = first.c;
    turn = 0; dir = 1; over = false; winner = -1; drawPending = 0; mustDraw = false;
    anims.length = 0;
    updateStatus();
    dirty = true;
    // 起始牌若為功能牌，對起手玩家生效（簡化：skip/rev/d2 對第 0 位）
    applyStartAction(first);
    scheduleAI();
  }

  function applyStartAction(card) {
    if (card.v === 'skip') turn = next(turn);
    else if (card.v === 'rev') { dir = -1; if (numPlayers === 2) turn = next(turn); else turn = next(0); }
    else if (card.v === 'd2') { drawN(0, 2); turn = next(turn); }
  }

  const next = (t, step) => ((t + dir * (step || 1)) % numPlayers + numPlayers) % numPlayers;

  function drawN(pi, n) {
    for (let i = 0; i < n; i++) {
      if (!deck.length) reshuffle();
      if (deck.length) hands[pi].push(deck.shift());
    }
    dirty = true;
  }
  function reshuffle() {
    if (discard.length <= 1) return;
    const top = discard.pop();
    deck = shuffle(discard.map((c) => (c.c === 'W' ? { c: 'W', v: c.v } : c)));
    discard = [top];
  }

  function canPlay(card) {
    if (card.c === 'W') return true;
    const top = discard[discard.length - 1];
    return card.c === curColor || card.v === top.v;
  }
  function hasPlay(pi) { return hands[pi].some(canPlay); }

  // 出牌
  function play(pi, cardIdx, chosenColor) {
    if (over || pi !== turn) return false;
    const card = hands[pi][cardIdx];
    if (!card || !canPlay(card)) return false;
    if (card.c === 'W' && !chosenColor && !players[pi].ai) { pendingWild = { pi, cardIdx }; openColorPick(); return false; }
    hands[pi].splice(cardIdx, 1);
    // 動畫：從該玩家席位飛到牌堆
    const from = seatCardPos(pi);
    anims.push({ card, from, to: { x: DISCARD_X, z: 0 }, t0: performance.now(), dur: 320 });
    discard.push(card);
    curColor = card.c === 'W' ? (chosenColor || bestColor(pi)) : card.c;
    mustDraw = false;

    if (hands[pi].length === 0) { endGame(pi); return true; }

    // 功能
    let skip = false;
    if (card.v === 'skip') skip = true;
    else if (card.v === 'rev') { dir = -dir; if (numPlayers === 2) skip = true; }
    else if (card.v === 'd2') { const tgt = next(turn); drawN(tgt, 2); skip = true; }
    else if (card.v === 'wd4') { const tgt = next(turn); drawN(tgt, 4); skip = true; }

    turn = skip ? next(next(turn)) : next(turn);
    if (hands[pi].length === 1) flash(players[pi].name + '：UNO！');
    updateStatus();
    dirty = true;
    if (mode === 'net') Net.send({ type: 'play', pi, card, curColor });
    scheduleAI();
    return true;
  }

  // 抽牌（人類主動或無牌可出）
  function drawTurn(pi) {
    if (over || pi !== turn) return;
    if (!deck.length) reshuffle();
    const card = deck.length ? deck.shift() : null;
    if (card) hands[pi].push(card);
    dirty = true;
    // 抽到可出 → 允許本回合出（僅該張）；否則換手
    if (card && canPlay(card)) {
      mustDraw = { idx: hands[pi].length - 1 };
      updateStatus();
      if (players[pi].ai) { // AI 抽到就出
        setTimeout(() => { if (turn === pi && !over) play(pi, hands[pi].length - 1, aiWildColor(pi)); }, 300);
      }
    } else {
      mustDraw = false;
      turn = next(turn);
      updateStatus();
      scheduleAI();
    }
  }

  function endGame(pi) {
    over = true; winner = pi;
    updateStatus();
    const big = pi === 0 ? '你贏了！' : players[pi].name + ' 獲勝';
    setTimeout(() => Shell.showBanner(big, 'UNO！'), 500);
  }

  // ================= AI =================
  function bestColor(pi) { // 手上最多的顏色
    const cnt = { R: 0, Y: 0, G: 0, B: 0 };
    for (const c of hands[pi]) if (c.c !== 'W') cnt[c.c]++;
    let best = 'R', mx = -1;
    for (const c of COLORS) if (cnt[c] > mx) { mx = cnt[c]; best = c; }
    return best;
  }
  function aiWildColor(pi) { return diff === 'hard' ? bestColor(pi) : COLORS[(Math.random() * 4) | 0]; }

  function aiMove(pi) {
    const playable = hands[pi].map((c, i) => ({ c, i })).filter((x) => canPlay(x.c));
    if (!playable.length) { drawTurn(pi); return; }
    let choice;
    if (diff === 'easy') {
      choice = playable[(Math.random() * playable.length) | 0];
    } else {
      // 優先：對只剩少牌的下家丟功能牌；否則出數字保留萬用；配合手上主色
      const score = (x) => {
        const c = x.c;
        let s = 0;
        if (c.v === 'wd4') s -= 5;         // 萬用+4 最後才用
        else if (c.v === 'wild') s -= 3;
        else if (c.v === 'd2' || c.v === 'skip' || c.v === 'rev') s += 4;
        else s += 2 + (+c.v ? 0 : 1);
        if (c.c === bestColor(pi)) s += 1;  // 保留主色連貫
        const tgt = next(turn);
        if (hands[tgt].length <= 2 && (c.v === 'd2' || c.v === 'skip' || c.v === 'wd4')) s += 6;
        return s;
      };
      choice = playable.sort((a, b) => score(b) - score(a))[0];
    }
    play(pi, choice.i, choice.c.c === 'W' ? aiWildColor(pi) : undefined);
  }

  function scheduleAI() {
    clearTimeout(aiTimer);
    if (over || !players[turn] || !players[turn].ai) return;
    aiTimer = setTimeout(() => { if (!over && players[turn] && players[turn].ai) aiMove(turn); }, 650);
  }

  // ================= 顏色選擇 =================
  function openColorPick() {
    $('colorPick').classList.remove('hidden');
    $('colorPick').innerHTML = `<div class="dialog" style="max-width:300px"><h2>選擇顏色</h2>
      <div class="sws">${COLORS.map((c) => `<div class="sw" data-c="${c}" style="background:${COLOR_HEX[c]}"></div>`).join('')}</div></div>`;
    $('colorPick').querySelectorAll('.sw').forEach((el) => el.addEventListener('click', () => {
      $('colorPick').classList.add('hidden');
      const w = pendingWild; pendingWild = null;
      if (w) play(w.pi, w.cardIdx, el.dataset.c);
    }));
  }

  function updateStatus() {
    if (over) { Shell.setStatus(`${players[winner].name} 獲勝`); return; }
    const arrow = dir === 1 ? '↻' : '↺';
    const counts = players.map((p, i) => `${i === turn ? '▶' : ''}${p.name} ${hands[i].length}`).join('　');
    Shell.setStatus(`${arrow} 目前顏色 <b style="color:${COLOR_HEX[curColor]}">${COLOR_NAME[curColor] || ''}</b>｜${counts}`);
  }

  let flashMsg = null, flashT = 0;
  function flash(m) { flashMsg = m; flashT = performance.now(); dirty = true; }

  // ================= 渲染 =================
  const cam = E3D.createCamera({ yaw: 0, pitch: 0.82, dist: 24, target: [0, 0, 1.5], fov: 0.8, minDist: 13, maxDist: 40, minPitch: 0.3, maxPitch: 1.35 });
  let W2 = 0, H2 = 0, dirty = true, mode = 'ai';
  function resize() { W2 = innerWidth; H2 = innerHeight; svg.setAttribute('viewBox', `0 0 ${W2} ${H2}`); dirty = true; }
  addEventListener('resize', resize); resize();

  const CW = 1.5, CD = 2.2;          // 牌寬、深
  const DISCARD_X = 1.6, DRAW_X = -1.6;
  const HAND_Z = 6.2;                 // 玩家手牌 z

  // 席位資訊：回傳 {x,z,rot,axis} — 玩家 0 在南
  function seat(pi) {
    if (numPlayers === 2) return [{ x: 0, z: HAND_Z, rot: 0 }, { x: 0, z: -6, rot: 0 }][pi];
    if (numPlayers === 3) return [{ x: 0, z: HAND_Z, rot: 0 }, { x: -8.5, z: -1, rot: 90 }, { x: 8.5, z: -1, rot: 90 }][pi];
    return [{ x: 0, z: HAND_Z, rot: 0 }, { x: -9, z: 0, rot: 90 }, { x: 0, z: -6, rot: 0 }, { x: 9, z: 0, rot: 90 }][pi];
  }
  function seatCardPos(pi) { const s = seat(pi); return { x: s.x, z: s.z }; }

  // 玩家手牌每張的 x 座標（置中重疊）
  function handLayout(n, spanMax) {
    const span = Math.min(spanMax, n * CW * 0.62);
    const step = n > 1 ? span / (n - 1) : 0;
    const arr = [];
    for (let i = 0; i < n; i++) arr.push((i - (n - 1) / 2) * step);
    return arr;
  }

  const DEFS = `<defs>${E3D.DEFS}
    <radialGradient id="feltG" cx=".5" cy=".42" r=".75">
      <stop offset="0" stop-color="#2f5540"/><stop offset="1" stop-color="#1c3527"/>
    </radialGradient>
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6e451f"/><stop offset="1" stop-color="#3c250e"/>
    </linearGradient>
  </defs>`;

  function quadS(view, pts3, fill, extra) {
    const ps = pts3.map((p) => view.project(p));
    if (ps.some((p) => !p)) return '';
    return `<path d="${E3D.pathOf(ps, true)}" fill="${fill}"${extra || ''}/>`;
  }

  function faceOf(card) {
    if (card.c === 'W') {
      return { bg: COLOR_HEX.W, ink: '#fff', edge: '#111', oval: true, ovalFill: 'conic', big: VAL_LABEL[card.v], bigSize: card.v === 'wd4' ? 0.85 : 1.1, corner: card.v === 'wd4' ? '+4' : '' };
    }
    const lab = VAL_LABEL[card.v] || card.v;
    return { bg: COLOR_HEX[card.c], ink: COLOR_HEX[card.c], edge: 'rgba(0,0,0,.4)', oval: true, big: lab, bigSize: lab.length > 1 ? 0.8 : 1.15, corner: lab, cornerInk: '#fff' };
  }

  function render() {
    const view = E3D.makeView(cam, W2, H2);
    let s = DEFS;
    // 桌面
    s += quadS(view, [[-30, -0.4, -24], [30, -0.4, -24], [30, -0.4, 28], [-30, -0.4, 28]], 'url(#wood)');
    // 綠氈圓桌
    const felt = [];
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; const p = view.project([Math.cos(a) * 13, 0, Math.sin(a) * 11 + 0.5]); if (p) felt.push(p); }
    if (felt.length > 3) s += `<path d="${E3D.pathOf(felt, true)}" fill="url(#feltG)" stroke="#14261b" stroke-width="2"/>`;

    const items = [];
    // 抽牌堆（牌背疊高）
    for (let k = 0; k < Math.min(6, Math.ceil(deck.length / 12)); k++) {
      const c = Cards3D.draw(view, DRAW_X, 0, CW, CD, 0, null, { y: 0.02 + k * 0.04, shadow: k === 0 });
      if (c) items.push(c);
    }
    // 棄牌堆頂（含底下幾張露邊）
    for (let k = Math.max(0, discard.length - 4); k < discard.length; k++) {
      const jitter = k < discard.length - 1 ? (k * 37 % 7 - 3) * 0.05 : 0;
      const c = Cards3D.draw(view, DISCARD_X + jitter, jitter, CW, CD, 0, faceOf(discard[k]), { y: 0.02 + (k - (discard.length - 4)) * 0.03 });
      if (c) items.push(c);
    }
    // 目前顏色指示環
    if (!over) {
      const ring = E3D.circle3D(view, DISCARD_X, 0.2, 0, CW * 0.9, 20);
      if (ring.length > 3) s += `<path d="${E3D.pathOf(ring, true)}" fill="none" stroke="${COLOR_HEX[curColor]}" stroke-width="3" opacity=".9"/>`;
    }

    // 對手手牌（牌背）+ 數量
    for (let pi = 1; pi < numPlayers; pi++) {
      const st = seat(pi);
      const n = hands[pi].length;
      const offs = handLayout(n, 6);
      for (let i = 0; i < n; i++) {
        const cx = st.rot === 90 ? st.x : st.x + offs[i];
        const cz = st.rot === 90 ? st.z + offs[i] : st.z;
        const c = Cards3D.draw(view, cx, cz, CW * 0.9, CD * 0.9, st.rot, null, { y: 0.02, shadow: i === 0, textRot: st.rot });
        if (c) items.push(c);
      }
      // 名稱與張數標籤
      const lp = view.project([st.x, 0.1, st.z + (st.rot === 90 ? 0 : (pi === 2 && numPlayers === 4 ? -1.6 : 1.6)) * (st.z < 0 ? -1 : 1)]);
      const lp2 = view.project([st.x, 1.4, st.z]);
      if (lp2) items.push({ svg: `<text x="${E3D.fmt(lp2.x)}" y="${E3D.fmt(lp2.y)}" font-size="${E3D.fmt(lp2.s * 0.75)}" fill="${turn === pi ? '#d9a441' : '#cdd6e2'}" text-anchor="middle" font-family="'Noto Sans TC',sans-serif" font-weight="${turn === pi ? 700 : 400}">${players[pi].name}・${n}</text>`, depth: -999 });
    }

    // 玩家手牌（面朝上，可點）
    const n0 = hands[0] ? hands[0].length : 0;
    handXs = handLayout(n0, 11);
    for (let i = 0; i < n0; i++) {
      const card = hands[0][i];
      const playable = !over && turn === 0 && canPlay(card) && (!mustDraw || mustDraw.idx === i);
      const lift = playable ? 0.35 : 0;
      const c = Cards3D.draw(view, handXs[i], HAND_Z, CW, CD, 0, faceOf(card), { y: 0.05, lift, shadow: i === 0 });
      if (c) {
        let extra = '';
        if (playable && c.center) extra = `<circle cx="${E3D.fmt(c.center.x)}" cy="${E3D.fmt(c.center.y - c.center.s * 1.2)}" r="${E3D.fmt(c.center.s * 0.12)}" fill="#d9a441"/>`;
        items.push({ svg: c.svg + extra, depth: c.depth - i * 0.01 });
      }
    }

    // 飛牌動畫
    const now = performance.now();
    for (const a of anims) {
      const t = Math.min(1, (now - a.t0) / a.dur);
      const e = E3D.ease.outCubic(t);
      const x = a.from.x + (a.to.x - a.from.x) * e, z = a.from.z + (a.to.z - a.from.z) * e;
      const c = Cards3D.draw(view, x, z, CW, CD, 0, faceOf(a.card), { y: 0.05, lift: Math.sin(t * Math.PI) * 1.5 });
      if (c) items.push({ svg: c.svg, depth: -1e6 }); // 永遠最上層
    }

    items.sort((a, b) => b.depth - a.depth);
    for (const it of items) s += it.svg;

    // flash 訊息
    if (flashMsg && now - flashT < 1400) {
      s += `<text x="${W2 / 2}" y="${H2 * 0.3}" font-size="34" fill="#d9a441" text-anchor="middle" font-family="'Arial Black',sans-serif" font-weight="900" opacity="${1 - (now - flashT) / 1400}">${flashMsg}</text>`;
    }
    svg.innerHTML = s;
  }
  let handXs = [];

  // ================= 主迴圈 =================
  function tick() {
    if (W2 !== innerWidth || H2 !== innerHeight) resize();
    const now = performance.now();
    for (let i = anims.length - 1; i >= 0; i--) if (now - anims[i].t0 > anims[i].dur) anims.splice(i, 1);
    const busy = anims.length || (flashMsg && now - flashT < 1400);
    if (dirty || busy) { try { render(); } catch (e) { console.error('render', e); } dirty = anims.length > 0; }
    schedule();
  }
  function schedule() { if (document.hidden) setTimeout(tick, 250); else requestAnimationFrame(tick); }
  schedule();

  // ================= 輸入 =================
  E3D.attachControls(svg, cam, {
    onChange: () => { dirty = true; },
    onTap: (px, py) => {
      if (over || turn !== 0) return;
      const view = E3D.makeView(cam, W2, H2);
      const hit = E3D.pickPlane(view, px, py, 0.05);
      if (!hit) return;
      // 點抽牌堆
      if (Math.abs(hit[0] - DRAW_X) < CW && Math.abs(hit[2]) < CD * 0.8) { if (!mustDraw) drawTurn(0); return; }
      // 點手牌（由右到左找最上層命中）
      const n0 = hands[0].length;
      for (let i = n0 - 1; i >= 0; i--) {
        if (Cards3D.hit(handXs[i], HAND_Z, CW, CD, 0, hit[0], hit[2])) {
          const card = hands[0][i];
          if (canPlay(card) && (!mustDraw || mustDraw.idx === i)) play(0, i, undefined);
          return;
        }
      }
    },
  });

  // ================= DBG / Shell =================
  window.DBG = {
    cam, view: () => E3D.makeView(cam, W2, H2),
    state: () => ({ hands: hands.map((h) => h.slice()), turn, dir, curColor, over, winner, top: discard[discard.length - 1], deckLen: deck.length }),
    reset, play, drawTurn, aiMove, canPlay, hasPlay,
    tapWorld: (x, z) => { // 模擬點擊桌面世界座標，回傳是否命中手牌並出牌
      if (over || turn !== 0) return 'not-your-turn';
      for (let i = hands[0].length - 1; i >= 0; i--) {
        if (Cards3D.hit(handXs[i], HAND_Z, CW, CD, 0, x, z)) {
          const card = hands[0][i];
          if (canPlay(card) && (!mustDraw || mustDraw.idx === i)) { play(0, i, card.c === 'W' ? 'R' : undefined); return 'played:' + i; }
          return 'not-playable:' + i;
        }
      }
      return 'miss';
    },
    handInfo: () => ({ xs: handXs.slice(), z: HAND_Z, cw: CW, cd: CD }),
  };

  Shell.init({
    title: '3D UNO',
    startTitle: '開始 UNO',
    sections: [
      { id: 'players', label: '玩家人數（你 + 電腦）', default: '2', options: [
        { id: '2', label: '2 人' }, { id: '3', label: '3 人' }, { id: '4', label: '4 人' },
      ] },
      { id: 'diff', label: '電腦難度', default: 'hard', options: [
        { id: 'easy', label: '輕鬆' }, { id: 'hard', label: '進階' },
      ] },
    ],
    bar: {},
    hint: '點手牌出牌．點抽牌堆抽牌．拖曳環顧．滾輪縮放',
    rulesHtml: '同色或同數字/功能即可出牌，萬用牌可指定顏色。功能牌：⊘跳過、⇄迴轉、+2、+4。先出完手牌者獲勝。',
    onStart: (cfg) => { mode = 'ai'; reset(cfg); },
    onResetView: () => { cam.yaw = 0; cam.pitch = 0.82; cam.dist = 24; dirty = true; },
  });
})();
