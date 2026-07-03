/* 3D 黑白棋 — 規則、AI（三段難度）、渲染 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const svg = $('scene');

  // ================= 棋盤狀態 =================
  // board[idx]=0空 1黑 2白；idx = r*8+c；黑先
  let board, player, history, lastMove, gameOver;
  // 先建立初始盤面，讓開局對話框背後就看得到棋盤（newBoard 為函式宣告，已提升）
  board = newBoard(); player = 1; history = []; lastMove = -1; gameOver = true;
  let mode = 'ai', diff = 'mid', humanSide = 0, mySide = 0; // mySide: 連線時我方
  let thinking = false, aiTimer = null;

  const OPP = (p) => 3 - p;
  const NAME = ['', '黑棋', '白棋'];

  function newBoard() {
    const b = new Int8Array(64);
    b[27] = 2; b[28] = 1; b[35] = 1; b[36] = 2;
    return b;
  }

  // ================= 規則 =================
  const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

  function flipsFor(bd, p, idx) {
    if (bd[idx] !== 0) return null;
    const r0 = idx >> 3, c0 = idx & 7, out = [];
    for (const [dr, dc] of DIRS) {
      let r = r0 + dr, c = c0 + dc, line = [];
      while (r >= 0 && r < 8 && c >= 0 && c < 8 && bd[r * 8 + c] === OPP(p)) { line.push(r * 8 + c); r += dr; c += dc; }
      if (line.length && r >= 0 && r < 8 && c >= 0 && c < 8 && bd[r * 8 + c] === p) out.push(...line);
    }
    return out.length ? out : null;
  }

  function legalMoves(bd, p) {
    const out = [];
    for (let i = 0; i < 64; i++) if (bd[i] === 0 && flipsFor(bd, p, i)) out.push(i);
    return out;
  }

  function count(bd) {
    let b = 0, w = 0;
    for (let i = 0; i < 64; i++) { if (bd[i] === 1) b++; else if (bd[i] === 2) w++; }
    return [b, w];
  }

  // ================= AI =================
  const W = [
    120, -20, 20, 5, 5, 20, -20, 120,
    -20, -40, -5, -5, -5, -5, -40, -20,
    20, -5, 15, 3, 3, 15, -5, 20,
    5, -5, 3, 3, 3, 3, -5, 5,
    5, -5, 3, 3, 3, 3, -5, 5,
    20, -5, 15, 3, 3, 15, -5, 20,
    -20, -40, -5, -5, -5, -5, -40, -20,
    120, -20, 20, 5, 5, 20, -20, 120,
  ];
  const CORNERS = [0, 7, 56, 63];

  function evaluate(bd, p) {
    let pos = 0, mine = 0, theirs = 0;
    for (let i = 0; i < 64; i++) {
      if (bd[i] === p) { pos += W[i]; mine++; }
      else if (bd[i] === OPP(p)) { pos -= W[i]; theirs++; }
    }
    const mob = legalMoves(bd, p).length - legalMoves(bd, OPP(p)).length;
    const empties = 64 - mine - theirs;
    const discW = empties < 16 ? 6 : 1; // 越接近終盤子數越重要
    return pos + mob * 7 + (mine - theirs) * discW;
  }

  let nodes = 0, deadline = 0;
  const TIMEOUT = { timeout: true };
  function checkTime() { if ((++nodes & 511) === 0 && Date.now() > deadline) throw TIMEOUT; }

  function negamax(bd, p, depth, alpha, beta, passed) {
    checkTime();
    const moves = legalMoves(bd, p);
    if (!moves.length) {
      if (passed) { const [b, w] = count(bd); const d = (p === 1 ? b - w : w - b); return d > 0 ? 100000 + d : d < 0 ? -100000 + d : 0; }
      return -negamax(bd, OPP(p), depth, -beta, -alpha, true);
    }
    if (depth <= 0) return evaluate(bd, p);
    moves.sort((a, b2) => W[b2] - W[a]);
    let best = -Infinity;
    for (const m of moves) {
      const fl = flipsFor(bd, p, m);
      bd[m] = p; for (const f of fl) bd[f] = p;
      const v = -negamax(bd, OPP(p), depth - 1, -beta, -alpha, false);
      bd[m] = 0; for (const f of fl) bd[f] = OPP(p);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  // 終盤精算（以子差為分數）
  function solveExact(bd, p, alpha, beta, passed) {
    checkTime();
    const moves = legalMoves(bd, p);
    if (!moves.length) {
      if (passed) { const [b, w] = count(bd); return p === 1 ? b - w : w - b; }
      return -solveExact(bd, OPP(p), -beta, -alpha, true);
    }
    let best = -Infinity;
    for (const m of moves) {
      const fl = flipsFor(bd, p, m);
      bd[m] = p; for (const f of fl) bd[f] = p;
      const v = -solveExact(bd, OPP(p), -beta, -alpha, false);
      bd[m] = 0; for (const f of fl) bd[f] = OPP(p);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  const DIFFS = {
    easy: { maxDepth: 1, rand: 0.45, timeMs: 300, exact: 0 },
    mid: { maxDepth: 3, rand: 0.06, timeMs: 700, exact: 8 },
    hard: { maxDepth: 12, rand: 0, timeMs: 1200, exact: 13 },
  };

  function aiPick(bd, p, level) {
    const cfg = DIFFS[level];
    const moves = legalMoves(bd, p);
    if (!moves.length) return -1;
    if (moves.length === 1) return moves[0];
    if (cfg.rand > 0 && Math.random() < cfg.rand) return moves[(Math.random() * moves.length) | 0];

    const empties = 64 - count(bd)[0] - count(bd)[1];
    nodes = 0; deadline = Date.now() + cfg.timeMs;
    const b2 = bd.slice();

    // 終盤精算
    if (cfg.exact && empties <= cfg.exact) {
      try {
        let best = moves[0], bestV = -Infinity;
        for (const m of moves) {
          const fl = flipsFor(b2, p, m);
          b2[m] = p; for (const f of fl) b2[f] = p;
          const v = -solveExact(b2, OPP(p), -64, 64, false);
          b2[m] = 0; for (const f of fl) b2[f] = OPP(p);
          if (v > bestV) { bestV = v; best = m; }
        }
        return best;
      } catch (e) { if (e !== TIMEOUT) throw e; /* 超時退回一般搜尋 */ }
    }

    // 迭代加深
    let best = moves.slice().sort((a, b3) => W[b3] - W[a])[0];
    for (let d = 2; d <= cfg.maxDepth; d++) {
      try {
        let curBest = best, curV = -Infinity;
        const ordered = [best, ...moves.filter((m) => m !== best)];
        for (const m of ordered) {
          const fl = flipsFor(b2, p, m);
          b2[m] = p; for (const f of fl) b2[f] = p;
          const v = -negamax(b2, OPP(p), d - 1, -Infinity, -curV === Infinity ? Infinity : -curV, false);
          b2[m] = 0; for (const f of fl) b2[f] = OPP(p);
          if (v > curV) { curV = v; curBest = m; }
        }
        best = curBest;
        if (cfg.maxDepth <= 3 && d >= cfg.maxDepth) break;
      } catch (e) { if (e !== TIMEOUT) throw e; break; }
    }
    return best;
  }

  // ================= 3D 渲染 =================
  const CELL = 2, R = 0.8, H = 0.26;
  const cam = E3D.createCamera({ yaw: 0, pitch: 0.62, dist: 27, target: [0, 0, 0], fov: 0.82, minDist: 14, maxDist: 46, minPitch: 0.22, maxPitch: 1.32 });
  let W2 = 0, H2 = 0, dirty = true;
  const anims = []; // {idx, kind:'drop'|'flip', t0, dur, from, to}

  function cellXZ(idx) { return [((idx & 7) - 3.5) * CELL, ((idx >> 3) - 3.5) * CELL]; }

  function resize() {
    W2 = innerWidth; H2 = innerHeight;
    svg.setAttribute('viewBox', `0 0 ${W2} ${H2}`);
    dirty = true;
  }
  addEventListener('resize', resize); resize();

  const DEFS = `<defs>${E3D.DEFS}
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8a5a2b"/><stop offset=".5" stop-color="#6e451f"/><stop offset="1" stop-color="#4e2f13"/>
    </linearGradient>
    <linearGradient id="boardTop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2e6b41"/><stop offset="1" stop-color="#1e4d2d"/>
    </linearGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5c3a19"/><stop offset="1" stop-color="#3c250e"/>
    </linearGradient>
    <radialGradient id="dBlack" cx=".35" cy=".3" r=".9">
      <stop offset="0" stop-color="#5a5f66"/><stop offset=".55" stop-color="#23262b"/><stop offset="1" stop-color="#0b0c0e"/>
    </radialGradient>
    <radialGradient id="dWhite" cx=".35" cy=".3" r=".9">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#e8e6df"/><stop offset="1" stop-color="#b9b5a8"/>
    </radialGradient>
  </defs>`;

  function quad(view, pts3, fill, extra) {
    const ps = pts3.map((p) => view.project(p));
    if (ps.some((p) => !p)) return '';
    return `<path d="${E3D.pathOf(ps, true)}" fill="${fill}"${extra || ''}/>`;
  }

  function render() {
    const view = E3D.makeView(cam, W2, H2);
    const B = 8 * CELL / 2, F = B + 1.0, T = 0.55; // 盤半寬、外框、厚度
    let s = DEFS;

    // 桌面
    s += quad(view, [[-30, -T, -26], [30, -T, -26], [30, -T, 30], [-30, -T, 30]], 'url(#wood)');
    // 盤側面（依相機取可見兩面就好：全部畫,由深到淺排序簡化為固定順序遠→近）
    const sides = [
      [[-F, -T, -F], [F, -T, -F], [F, 0, -F], [-F, 0, -F]],
      [[-F, -T, F], [F, -T, F], [F, 0, F], [-F, 0, F]],
      [[-F, -T, -F], [-F, -T, F], [-F, 0, F], [-F, 0, -F]],
      [[F, -T, -F], [F, -T, F], [F, 0, F], [F, 0, -F]],
    ];
    const sideD = sides.map((q) => {
      const c = q.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4, a[2] + p[2] / 4], [0, 0, 0]);
      const pr = view.project(c);
      return { q, d: pr ? pr.z : 1e9 };
    }).sort((a, b) => b.d - a.d);
    for (const sd of sideD) s += quad(view, sd.q, '#33200d');
    // 外框頂 + 盤面
    s += quad(view, [[-F, 0, -F], [F, 0, -F], [F, 0, F], [-F, 0, F]], 'url(#frame)');
    s += quad(view, [[-B, 0.02, -B], [B, 0.02, -B], [B, 0.02, B], [-B, 0.02, B]], 'url(#boardTop)');

    // 格線
    let grid = '';
    for (let i = 0; i <= 8; i++) {
      const t = -B + i * CELL;
      const a = view.project([t, 0.03, -B]), b = view.project([t, 0.03, B]);
      const c = view.project([-B, 0.03, t]), d = view.project([B, 0.03, t]);
      if (a && b) grid += `<line x1="${E3D.fmt(a.x)}" y1="${E3D.fmt(a.y)}" x2="${E3D.fmt(b.x)}" y2="${E3D.fmt(b.y)}"/>`;
      if (c && d) grid += `<line x1="${E3D.fmt(c.x)}" y1="${E3D.fmt(c.y)}" x2="${E3D.fmt(d.x)}" y2="${E3D.fmt(d.y)}"/>`;
    }
    s += `<g stroke="rgba(8,30,15,.75)" stroke-width="1.1">${grid}</g>`;
    // 星點
    for (const [gc, gr] of [[2, 2], [2, 6], [6, 2], [6, 6]]) {
      const p = view.project([-B + gc * CELL, 0.03, -B + gr * CELL]);
      if (p) s += `<circle cx="${E3D.fmt(p.x)}" cy="${E3D.fmt(p.y)}" r="${E3D.fmt(p.s * 0.09)}" fill="rgba(8,30,15,.8)"/>`;
    }

    // 合法步提示（輪到本地人類時）
    if (!gameOver && isHumanTurn() && !thinking) {
      for (const m of legalMoves(board, player)) {
        const [x, z] = cellXZ(m);
        const pts = E3D.circle3D(view, x, 0.04, z, 0.34, 14);
        if (pts.length > 2) s += `<path d="${E3D.pathOf(pts, true)}" fill="${player === 1 ? 'rgba(10,12,14,.4)' : 'rgba(255,255,255,.35)'}" stroke="rgba(217,164,65,.55)" stroke-width="1"/>`;
      }
    }

    // 棋子（含動畫），依深度排序
    const now = performance.now();
    const items = [];
    for (let i = 0; i < 64; i++) {
      if (!board[i]) continue;
      const [x, z] = cellXZ(i);
      let col = board[i], yBase = 0.02, squash = 1, lift = 0;
      const an = anims.find((a) => a.idx === i);
      if (an) {
        const t = Math.min(1, (now - an.t0) / an.dur);
        if (an.kind === 'drop') {
          const e = E3D.ease.outCubic(t);
          lift = (1 - e) * 5;
        } else { // flip
          lift = Math.sin(t * Math.PI) * 0.9;
          squash = Math.max(0.1, Math.abs(Math.cos(t * Math.PI)));
          col = t < 0.5 ? an.from : an.to;
        }
      }
      items.push({ i, x, z, col, yBase, squash, lift });
    }
    // 陰影先畫
    for (const it of items) s += E3D.shadow(view, it.x, it.z, R * 1.15, 0.4 * Math.max(0.25, 1 - it.lift * 0.2));
    items.sort((a, b) => {
      const pa = view.project([a.x, 0, a.z]), pb = view.project([b.x, 0, b.z]);
      return (pb ? pb.z : 0) - (pa ? pa.z : 0);
    });
    for (const it of items) {
      const st = E3D.stone(view, it.x, it.yBase + it.lift, it.z, R, {
        h: H * it.squash + 0.02,
        fill: it.col === 1 ? 'url(#dBlack)' : 'url(#dWhite)',
        rim: it.col === 1 ? 'rgba(0,0,0,.5)' : 'rgba(120,115,100,.6)',
        hiA: it.col === 1 ? 0.3 : 0.55,
      });
      if (st) s += st.svg;
    }

    // 最後一手標記
    if (lastMove >= 0 && board[lastMove]) {
      const [x, z] = cellXZ(lastMove);
      const p = view.project([x, H + 0.1, z]);
      if (p) s += `<circle cx="${E3D.fmt(p.x)}" cy="${E3D.fmt(p.y)}" r="${E3D.fmt(p.s * 0.13)}" fill="#d9a441" stroke="rgba(0,0,0,.5)" stroke-width="1"/>`;
    }

    svg.innerHTML = s;
  }

  function tick() {
    if (W2 !== innerWidth || H2 !== innerHeight) resize();
    const now = performance.now();
    for (let i = anims.length - 1; i >= 0; i--) if (now - anims[i].t0 > anims[i].dur) anims.splice(i, 1);
    if (dirty || anims.length) {
      try { render(); } catch (e) { console.error('render error', e); }
      dirty = anims.length > 0;
    }
    schedule();
  }
  // 分頁隱藏時 rAF 不觸發，退回 setTimeout 驅動
  function schedule() { if (document.hidden) setTimeout(tick, 250); else requestAnimationFrame(tick); }
  schedule();

  // ================= 遊戲流程 =================
  function isHumanTurn() {
    if (gameOver) return false;
    if (mode === '2p') return true;
    if (mode === 'ai') return player - 1 === humanSide ? true : false;
    if (mode === 'net') return player - 1 === mySide;
    return false;
  }

  function statusText(extra) {
    const [b, w] = count(board);
    let who;
    if (gameOver) who = '對局結束';
    else if (mode === 'net') who = (player - 1 === mySide ? `輪到你（${NAME[player]}）` : `等待對方（${NAME[player]}）…`);
    else who = `輪到 ${NAME[player]}`;
    Shell.setStatus(`${extra ? extra + '｜' : ''}黑 <b>${b}</b> ─ <b>${w}</b> 白｜${who}`);
  }

  function place(idx, animate) {
    const fl = flipsFor(board, player, idx);
    if (!fl) return false;
    history.push({ board: board.slice(), player, lastMove });
    board[idx] = player;
    const now = performance.now();
    if (animate) anims.push({ idx, kind: 'drop', t0: now, dur: 260 });
    fl.forEach((f, k) => {
      const from = board[f];
      board[f] = player;
      if (animate) anims.push({ idx: f, kind: 'flip', t0: now + 90 + k * 55, dur: 330, from, to: player });
    });
    lastMove = idx;
    player = OPP(player);
    dirty = true;
    advance();
    return true;
  }

  function advance() {
    // 跳過 / 結束判定
    if (!legalMoves(board, player).length) {
      if (!legalMoves(board, OPP(player)).length) { endGame(); return; }
      const skipped = NAME[player];
      player = OPP(player);
      statusText(`${skipped}無步可下，跳過`);
    } else statusText();
    Shell.setUndoEnabled(history.length > 0 && (mode === '2p' || mode === 'ai') && !thinking);
    scheduleAI();
  }

  function endGame() {
    gameOver = true;
    const [b, w] = count(board);
    statusText();
    let big, sub = `黑 ${b} ─ ${w} 白`;
    if (b === w) big = '平手';
    else {
      const winner = b > w ? 1 : 2;
      if (mode === 'ai') big = winner - 1 === humanSide ? '你贏了！' : '電腦獲勝';
      else if (mode === 'net') big = winner - 1 === mySide ? '你贏了！' : '對方獲勝';
      else big = `${NAME[winner]}獲勝`;
    }
    setTimeout(() => Shell.showBanner(big, sub), 600);
  }

  function isAITurn() {
    if (gameOver) return false;
    if (mode === 'aivai') return true;
    if (mode === 'ai') return player - 1 !== humanSide;
    return false;
  }

  function scheduleAI() {
    if (!isAITurn() || thinking) return;
    if (mode === 'aivai' && Shell.isPaused()) return;
    thinking = true;
    Shell.setStatus(`電腦（${NAME[player]}）思考中…`);
    Shell.setUndoEnabled(false);
    const delay = mode === 'aivai' ? Math.max(120, 750 / Shell.speed()) : 420;
    aiTimer = setTimeout(() => {
      const m = aiPick(board, player, diff);
      thinking = false;
      if (m >= 0 && !gameOver) place(m, true);
    }, delay);
  }

  // ================= 輸入 =================
  E3D.attachControls(svg, cam, {
    onChange: () => { dirty = true; },
    onTap: (px, py) => {
      if (gameOver || thinking || !isHumanTurn()) return;
      const view = E3D.makeView(cam, W2, H2);
      const hit = E3D.pickPlane(view, px, py, 0);
      if (!hit) return;
      const c = Math.floor((hit[0] + 8) / CELL), r = Math.floor((hit[2] + 8) / CELL);
      if (c < 0 || c > 7 || r < 0 || r > 7) return;
      const idx = r * 8 + c;
      if (place(idx, true)) {
        if (mode === 'net') Net.send({ type: 'move', idx });
      }
    },
  });

  // ================= Shell / 模式 =================
  function resetView() {
    const flip = (mode === 'ai' && humanSide === 1) || (mode === 'net' && mySide === 1);
    cam.yaw = flip ? Math.PI : 0;
    cam.pitch = 0.62; cam.dist = 27;
    dirty = true;
  }

  function startGame(cfg) {
    mode = cfg.mode; diff = cfg.diff; humanSide = cfg.side || 0;
    if (mode === 'net') mySide = cfg.netRole === 'host' ? 0 : 1;
    clearTimeout(aiTimer); thinking = false;
    board = newBoard(); player = 1; history = []; lastMove = -1; gameOver = false;
    anims.length = 0;
    resetView();
    statusText();
    Shell.setUndoEnabled(false);
    dirty = true;
    scheduleAI();
  }

  Net.onMessage((msg) => {
    if (msg.type === 'move' && mode === 'net' && !gameOver && player - 1 !== mySide) {
      if (flipsFor(board, player, msg.idx)) place(msg.idx, true);
    } else if (msg.type === 'rematch') {
      startGame({ mode: 'net', diff, netRole: mySide === 0 ? 'host' : 'join' });
      Shell.hideBanner();
    } else if (msg.type === 'bye') {
      Shell.setStatus('對方已離開連線');
    }
  });
  Net.onClose(() => { if (mode === 'net' && !gameOver) Shell.setStatus('連線已中斷'); });

  // 測試/除錯掛鉤（不影響遊戲）
  window.DBG = {
    cam,
    view: () => E3D.makeView(cam, W2, H2),
    cellXZ,
    state: () => ({ board: Array.from(board), player, gameOver, thinking, mode, histLen: history.length }),
    legal: () => legalMoves(board, player),
    rules: { newBoard, legalMoves, flipsFor, count, OPP, aiPick, DIFFS },
  };

  Shell.init({
    title: '3D 黑白棋',
    sideLabels: ['黑棋（先手）', '白棋（後手）'],
    hint: '拖曳環顧視角．滾輪/雙指縮放．點擊格子落子',
    rulesHtml: '夾住對方棋子即翻面。雙方都無步可下時結束，子多者勝。',
    defaultMode: 'ai',
    onStart: startGame,
    onUndo: () => {
      if (thinking || !history.length) return;
      if (mode === 'ai') { // 一路退回到輪到人類的局面
        while (history.length) {
          const h = history.pop();
          board = h.board; player = h.player; lastMove = h.lastMove;
          if (player - 1 === humanSide) break;
        }
      } else {
        const h = history.pop();
        board = h.board; player = h.player; lastMove = h.lastMove;
      }
      gameOver = false; anims.length = 0;
      Shell.hideBanner();
      statusText();
      Shell.setUndoEnabled(history.length > 0);
      dirty = true;
      scheduleAI(); // 若退回後輪到電腦（例：玩家執白悔到開局），讓電腦重新走
    },
    onResetView: resetView,
    onPause: (p) => { if (!p) scheduleAI(); },
    onSpeed: () => {},
    onRematch: () => {
      Net.send({ type: 'rematch' });
      startGame({ mode: 'net', diff, netRole: mySide === 0 ? 'host' : 'join' });
    },
  });
})();
