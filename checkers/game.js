/* 3D 跳棋（中國跳棋，雙人） — 規則、AI（三段難度）、渲染 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const svg = $('scene');

  // ================= 棋盤建構 =================
  // 六角星 121 格：17 列，各列長度如下；X 為橫向座標（間距 2，半步 1）
  const ROWLEN = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1];
  const S = 1.05, DZ = Math.sqrt(3) / 2; // 世界間距（格距 = 2S）
  const cells = [];            // {row, X, x, z}
  const keyMap = new Map();    // "row,X" -> idx
  for (let row = 0; row < 17; row++) {
    const L = ROWLEN[row];
    for (let i = 0; i < L; i++) {
      const X = -(L - 1) + i * 2;
      const idx = cells.length;
      cells.push({ row, X, x: 0, z: 0 });
      keyMap.set(row + ',' + X, idx);
    }
  }
  // 世界座標（置中：中列 row 8）
  for (const c of cells) { c.x = c.X * S * 0.5 * 2; c.z = (c.row - 8) * DZ * S * 2; }

  const DIRS = [[0, 2], [0, -2], [-1, 1], [-1, -1], [1, 1], [1, -1]];
  const at = (row, X) => { const i = keyMap.get(row + ',' + X); return i === undefined ? -1 : i; };

  // 陣營格：P1(紅)＝下方 rows 13-16，目標上方 rows 0-3；P2(藍)相反
  const camp = (rows) => cells.map((c, i) => rows.includes(c.row) ? i : -1).filter((i) => i >= 0);
  const HOME = [null, camp([13, 14, 15, 16]), camp([0, 1, 2, 3])];
  const GOAL = [null, camp([0, 1, 2, 3]), camp([13, 14, 15, 16])];
  const GOALV = [null, at(0, 0), at(16, 0)]; // 目標頂點

  const OPP = (p) => 3 - p;
  const NAME = ['', '紅方', '藍方'];

  function hexDist(a, b) {
    const dr = Math.abs(cells[a].row - cells[b].row);
    const dx = Math.abs(cells[a].X - cells[b].X);
    return dx <= dr ? dr : dr + (dx - dr) / 2;
  }

  // ================= 狀態 =================
  let board, player, history, lastPath, gameOver, selected, selMoves;
  let mode = 'ai', diff = 'mid', humanSide = 0, mySide = 0;
  let thinking = false, aiTimer = null;

  function newBoard() {
    const b = new Int8Array(cells.length);
    for (const i of HOME[1]) b[i] = 1;
    for (const i of HOME[2]) b[i] = 2;
    return b;
  }
  board = newBoard(); player = 1; history = []; lastPath = null; gameOver = true; selected = -1; selMoves = [];

  // ================= 規則 =================
  // 單格移動與連跳；回傳 [{to, path}]（path 含起點）
  function destsFor(bd, from) {
    const out = new Map();
    const { row, X } = cells[from];
    for (const [dr, dX] of DIRS) {
      const n = at(row + dr, X + dX);
      if (n >= 0 && !bd[n]) out.set(n, [from, n]);
    }
    // 連跳 BFS
    const visited = new Set([from]);
    const queue = [[from, [from]]];
    while (queue.length) {
      const [cur, path] = queue.shift();
      const cc = cells[cur];
      for (const [dr, dX] of DIRS) {
        const over = at(cc.row + dr, cc.X + dX);
        if (over < 0 || !bd[over]) continue;
        const land = at(cc.row + dr * 2, cc.X + dX * 2);
        if (land < 0 || visited.has(land)) continue;
        if (bd[land] && land !== from) continue; // 起點視為空（棋子已拿起）
        if (land === from) continue;
        visited.add(land);
        const np = path.concat(land);
        queue.push([land, np]);
        if (!out.has(land) || out.get(land).length <= 2) out.set(land, np);
      }
    }
    out.delete(from);
    return [...out.entries()].map(([to, path]) => ({ to, path }));
  }

  function allMoves(bd, p) {
    const out = [];
    for (let i = 0; i < bd.length; i++) {
      if (bd[i] !== p) continue;
      for (const d of destsFor(bd, i)) out.push({ from: i, to: d.to, path: d.path });
    }
    return out;
  }

  function checkWin(bd, p) {
    // 目標區 10 格全被占滿，且至少一格是自己的（對手佔位視同填滿，反堵規則）
    let mine = 0;
    for (const i of GOAL[p]) {
      if (!bd[i]) return false;
      if (bd[i] === p) mine++;
    }
    return mine > 0;
  }

  // ================= AI =================
  function progressOf(bd, p) {
    // 越小越好：所有子到目標頂點距離和 + 落後懲罰 + 偏離中線小懲罰
    let sum = 0, worst = 0, inGoal = 0;
    for (let i = 0; i < bd.length; i++) {
      if (bd[i] !== p) continue;
      const d = hexDist(i, GOALV[p]);
      sum += d;
      if (d > worst) worst = d;
      if (bd[i] === p && GOAL[p].includes(i)) inGoal++;
      sum += Math.abs(cells[i].X) * 0.02;
    }
    return -(sum + worst * 0.55) + inGoal * 1.2;
  }
  const evalFor = (bd, p) => progressOf(bd, p) - progressOf(bd, OPP(p));

  function moveDelta(bd, p, m) {
    return hexDist(m.from, GOALV[p]) - hexDist(m.to, GOALV[p]);
  }

  let deadline = 0, nodes = 0;
  const TIMEOUT = { t: 1 };
  function absearch(bd, p, meP, depth, alpha, beta) {
    if ((++nodes & 255) === 0 && Date.now() > deadline) throw TIMEOUT;
    if (checkWin(bd, 1)) return meP === 1 ? 1e6 : -1e6;
    if (checkWin(bd, 2)) return meP === 2 ? 1e6 : -1e6;
    if (depth === 0) return evalFor(bd, meP);
    let moves = allMoves(bd, p);
    // 剪枝：只看前進性最好的 K 步
    moves.sort((a, b) => moveDelta(bd, p, b) - moveDelta(bd, p, a));
    moves = moves.slice(0, 10);
    const maximizing = p === meP;
    let best = maximizing ? -Infinity : Infinity;
    for (const m of moves) {
      bd[m.from] = 0; bd[m.to] = p;
      const v = absearch(bd, OPP(p), meP, depth - 1, alpha, beta);
      bd[m.to] = 0; bd[m.from] = p;
      if (maximizing) { if (v > best) best = v; if (v > alpha) alpha = v; }
      else { if (v < best) best = v; if (v < beta) beta = v; }
      if (alpha >= beta) break;
    }
    if (best === -Infinity || best === Infinity) return evalFor(bd, meP);
    return best;
  }

  function aiPick(bd, p, level) {
    const moves = allMoves(bd, p);
    if (!moves.length) return null;
    const jitter = () => Math.random() * 0.01;

    if (level === 'easy') {
      // 前進步中偏隨機挑（不倒退）
      const fwd = moves.filter((m) => moveDelta(bd, p, m) > 0);
      const pool = (fwd.length ? fwd : moves).sort((a, b) => moveDelta(bd, p, b) - moveDelta(bd, p, a));
      const k = Math.max(1, Math.ceil(pool.length * 0.5));
      return pool[(Math.random() * k) | 0];
    }

    if (level === 'mid') {
      // 貪婪：套用後全域評估最佳（含小雜訊）
      let best = null, bestV = -Infinity;
      for (const m of moves) {
        bd[m.from] = 0; bd[m.to] = p;
        const v = evalFor(bd, p) + jitter();
        bd[m.to] = 0; bd[m.from] = p;
        if (v > bestV) { bestV = v; best = m; }
      }
      return best;
    }

    // hard：3 層 α-β（每層取前 10 步），800ms 預算，超時退回貪婪
    nodes = 0; deadline = Date.now() + 800;
    let cand = moves.slice().sort((a, b) => moveDelta(bd, p, b) - moveDelta(bd, p, a)).slice(0, 14);
    let best = cand[0], bestV = -Infinity;
    try {
      for (const m of cand) {
        bd[m.from] = 0; bd[m.to] = p;
        const v = absearch(bd, OPP(p), p, 2, -Infinity, Infinity) + jitter();
        bd[m.to] = 0; bd[m.from] = p;
        if (v > bestV) { bestV = v; best = m; }
      }
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      if (bestV === -Infinity) return aiPick(bd, p, 'mid');
    }
    return best;
  }

  // ================= 3D 渲染 =================
  const cam = E3D.createCamera({ yaw: 0, pitch: 0.6, dist: 30, target: [0, 0, 0], fov: 0.82, minDist: 14, maxDist: 52, minPitch: 0.22, maxPitch: 1.32 });
  let W2 = 0, H2 = 0, dirty = true;
  let moveAnim = null; // {path:[idx], t0, dur, piece, color}

  function resize() { W2 = innerWidth; H2 = innerHeight; svg.setAttribute('viewBox', `0 0 ${W2} ${H2}`); dirty = true; }
  addEventListener('resize', resize); resize();

  const MR = 0.62; // 彈珠半徑

  const DEFS = `<defs>${E3D.DEFS}
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8a5a2b"/><stop offset=".5" stop-color="#6e451f"/><stop offset="1" stop-color="#4e2f13"/>
    </linearGradient>
    <linearGradient id="star" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c99a5b"/><stop offset="1" stop-color="#a3742f"/>
    </linearGradient>
    <radialGradient id="mRed" cx=".35" cy=".3" r=".95">
      <stop offset="0" stop-color="#ff9d8a"/><stop offset=".45" stop-color="#d94b35"/><stop offset="1" stop-color="#7e1d10"/>
    </radialGradient>
    <radialGradient id="mBlue" cx=".35" cy=".3" r=".95">
      <stop offset="0" stop-color="#9ecbff"/><stop offset=".45" stop-color="#3d7fd4"/><stop offset="1" stop-color="#153f7a"/>
    </radialGradient>
  </defs>`;

  // 星形板外框：兩個大三角形（頂點超出格心 1.4）
  function starTris() {
    const m = 1.35;
    const v = (row, X) => { const c = cells[at(row, X)]; return [c.x, 0, c.z]; };
    const stretch = (p, f) => [p[0] * f, 0, p[2] * f + (p[2] > 0 ? m : -m) * 0]; // 簡單放大
    const A = [v(0, 0), v(12, -12), v(12, 12)];   // 下指三角（頂點在上）
    const B = [v(16, 0), v(4, -12), v(4, 12)];    // 上指三角
    const grow = (tri) => {
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3;
      return tri.map((p) => [cx + (p[0] - cx) * 1.18, 0, cz + (p[2] - cz) * 1.18]);
    };
    return [grow(A), grow(B)];
  }
  const TRIS = starTris();

  function quad(view, pts3, fill, extra) {
    const ps = pts3.map((p) => view.project(p));
    if (ps.some((p) => !p)) return '';
    return `<path d="${E3D.pathOf(ps, true)}" fill="${fill}"${extra || ''}/>`;
  }

  function render() {
    const view = E3D.makeView(cam, W2, H2);
    let s = DEFS;

    // 桌面
    s += quad(view, [[-34, -0.5, -30], [34, -0.5, -30], [34, -0.5, 34], [-34, -0.5, 34]], 'url(#wood)');
    // 星形板：厚度假影 + 板面
    for (const t of TRIS) s += quad(view, t.map((p) => [p[0], -0.42, p[2] + 0.22]), 'rgba(20,10,4,.55)');
    for (const t of TRIS) s += quad(view, t, 'url(#star)', ' stroke="#5f3d1c" stroke-width="1.2"');

    // 陣營淡色
    const tint = (idxs, color) => {
      for (const i of idxs) {
        const c = cells[i];
        const pts = E3D.circle3D(view, c.x, 0.015, c.z, S * 0.62, 10);
        if (pts.length > 2) s += `<path d="${E3D.pathOf(pts, true)}" fill="${color}"/>`;
      }
    };
    tint(HOME[1], 'rgba(200,60,40,.14)');
    tint(HOME[2], 'rgba(50,110,210,.14)');

    // 洞
    for (const c of cells) {
      const pts = E3D.circle3D(view, c.x, 0.02, c.z, 0.26, 10);
      if (pts.length > 2) s += `<path d="${E3D.pathOf(pts, true)}" fill="rgba(48,28,10,.85)"/>`;
    }

    // 可走提示
    if (selected >= 0) {
      const c0 = cells[selected];
      const ring = E3D.circle3D(view, c0.x, 0.03, c0.z, MR + 0.28, 16);
      if (ring.length > 2) s += `<path d="${E3D.pathOf(ring, true)}" fill="none" stroke="#d9a441" stroke-width="2.2"/>`;
      for (const m of selMoves) {
        const c = cells[m.to];
        const pts = E3D.circle3D(view, c.x, 0.03, c.z, 0.4, 12);
        if (pts.length > 2) s += `<path d="${E3D.pathOf(pts, true)}" fill="rgba(217,164,65,.35)" stroke="rgba(217,164,65,.8)" stroke-width="1.4"/>`;
      }
    }

    // 最後一手路徑
    if (lastPath && lastPath.length > 1) {
      let d = '';
      for (let i = 0; i < lastPath.length; i++) {
        const c = cells[lastPath[i]];
        const p = view.project([c.x, 0.05, c.z]);
        if (!p) { d = ''; break; }
        d += (i ? 'L' : 'M') + E3D.fmt(p.x) + ' ' + E3D.fmt(p.y);
      }
      if (d) s += `<path d="${d}" fill="none" stroke="rgba(217,164,65,.5)" stroke-width="1.6" stroke-dasharray="5 4"/>`;
    }

    // 棋子（含移動動畫）
    const now = performance.now();
    const items = [];
    for (let i = 0; i < board.length; i++) {
      if (!board[i]) continue;
      if (moveAnim && i === moveAnim.hideIdx) continue;
      items.push({ x: cells[i].x, z: cells[i].z, col: board[i], lift: 0, sel: i === selected });
    }
    if (moveAnim) {
      const segs = moveAnim.path.length - 1;
      const t = Math.min(1, (now - moveAnim.t0) / moveAnim.dur);
      const ft = t * segs, si = Math.min(segs - 1, Math.floor(ft)), st = ft - si;
      const a = cells[moveAnim.path[si]], b = cells[moveAnim.path[si + 1]];
      const isJump = hexDist(moveAnim.path[si], moveAnim.path[si + 1]) >= 2;
      const e = E3D.ease.inOutCubic(st);
      items.push({
        x: a.x + (b.x - a.x) * e, z: a.z + (b.z - a.z) * e,
        col: moveAnim.color,
        lift: isJump ? Math.sin(st * Math.PI) * 1.4 : Math.sin(st * Math.PI) * 0.25,
        sel: false,
      });
    }
    for (const it of items) s += E3D.shadow(view, it.x, it.z, MR * 1.1, 0.38);
    items.sort((a, b) => {
      const pa = view.project([a.x, 0, a.z]), pb = view.project([b.x, 0, b.z]);
      return (pb ? pb.z : 0) - (pa ? pa.z : 0);
    });
    for (const it of items) {
      const st = E3D.stone(view, it.x, 0.02 + it.lift, it.z, MR, {
        h: MR * 1.15,
        fill: it.col === 1 ? 'url(#mRed)' : 'url(#mBlue)',
        rim: 'rgba(0,0,0,.4)',
        hiA: 0.55,
      });
      if (st) s += st.svg;
    }

    svg.innerHTML = s;
  }

  function tick() {
    if (W2 !== innerWidth || H2 !== innerHeight) resize();
    if (moveAnim && performance.now() - moveAnim.t0 > moveAnim.dur) { moveAnim = null; dirty = true; }
    if (dirty || moveAnim) {
      try { render(); } catch (e) { console.error('render error', e); }
      dirty = !!moveAnim;
    }
    schedule();
  }
  function schedule() { if (document.hidden) setTimeout(tick, 250); else requestAnimationFrame(tick); }
  schedule();

  // ================= 遊戲流程 =================
  function isHumanTurn() {
    if (gameOver || moveAnim) return false;
    if (mode === '2p') return true;
    if (mode === 'ai') return player - 1 === humanSide;
    if (mode === 'net') return player - 1 === mySide;
    return false;
  }

  function statusText(extra) {
    let who;
    if (gameOver) who = '對局結束';
    else if (mode === 'net') who = player - 1 === mySide ? `輪到你（${NAME[player]}）` : `等待對方（${NAME[player]}）…`;
    else who = `輪到 ${NAME[player]}`;
    Shell.setStatus(`${extra ? extra + '｜' : ''}${who}`);
  }

  // 狀態立即套用；動畫純裝飾（隱藏分頁計時器被節流時遊戲仍正常推進）
  function doMove(m, animate) {
    history.push({ board: board.slice(), player, lastPath });
    const color = board[m.from];
    const mover = player;
    board[m.from] = 0;
    board[m.to] = color;
    lastPath = m.path;
    const won = checkWin(board, mover);
    player = OPP(player);
    selected = -1; selMoves = [];
    if (animate) moveAnim = { path: m.path, t0: performance.now(), dur: 220 * (m.path.length - 1) + 120, color, hideIdx: m.to };
    dirty = true;
    if (won) { endGame(mover); return; }
    statusText();
    Shell.setUndoEnabled(history.length > 0 && (mode === '2p' || mode === 'ai') && !thinking);
    scheduleAI();
  }

  function endGame(winner) {
    gameOver = true;
    statusText();
    let big;
    if (mode === 'ai') big = winner - 1 === humanSide ? '你贏了！' : '電腦獲勝';
    else if (mode === 'net') big = winner - 1 === mySide ? '你贏了！' : '對方獲勝';
    else big = `${NAME[winner]}獲勝`;
    setTimeout(() => Shell.showBanner(big, `${NAME[winner]}先抵達對面陣地`), 500);
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
    const delay = mode === 'aivai' ? Math.max(100, 650 / Shell.speed()) : 400;
    aiTimer = setTimeout(() => {
      const m = aiPick(board, player, diff);
      thinking = false;
      if (m && !gameOver) doMove(m, true);
    }, delay);
  }

  // ================= 輸入 =================
  E3D.attachControls(svg, cam, {
    onChange: () => { dirty = true; },
    onTap: (px, py) => {
      if (!isHumanTurn()) return;
      const view = E3D.makeView(cam, W2, H2);
      const hit = E3D.pickPlane(view, px, py, 0);
      if (!hit) return;
      // 找最近的格
      let bi = -1, bd2 = 1e9;
      for (let i = 0; i < cells.length; i++) {
        const dx = cells[i].x - hit[0], dz = cells[i].z - hit[2];
        const d = dx * dx + dz * dz;
        if (d < bd2) { bd2 = d; bi = i; }
      }
      if (bi < 0 || bd2 > S * S * 1.2) { selected = -1; selMoves = []; dirty = true; return; }
      // 點自己的子 → 選取
      if (board[bi] === player) {
        selected = bi;
        selMoves = destsFor(board, bi).map((d) => ({ from: bi, to: d.to, path: d.path }));
        dirty = true;
        return;
      }
      // 點目的地 → 移動
      if (selected >= 0) {
        const m = selMoves.find((mm) => mm.to === bi);
        if (m) {
          doMove(m, true);
          if (mode === 'net') Net.send({ type: 'move', from: m.from, to: m.to });
          return;
        }
      }
      selected = -1; selMoves = []; dirty = true;
    },
  });

  // ================= Shell / 模式 =================
  function resetView() {
    const flip = (mode === 'ai' && humanSide === 1) || (mode === 'net' && mySide === 1);
    cam.yaw = flip ? Math.PI : 0;
    cam.pitch = 0.6; cam.dist = 34;
    dirty = true;
  }

  function startGame(cfg) {
    mode = cfg.mode; diff = cfg.diff; humanSide = cfg.side || 0;
    if (mode === 'net') mySide = cfg.netRole === 'host' ? 0 : 1;
    clearTimeout(aiTimer); thinking = false; moveAnim = null;
    board = newBoard(); player = 1; history = []; lastPath = null; gameOver = false;
    selected = -1; selMoves = [];
    resetView();
    statusText();
    Shell.setUndoEnabled(false);
    dirty = true;
    scheduleAI();
  }

  Net.onMessage((msg) => {
    if (msg.type === 'move' && mode === 'net' && !gameOver && player - 1 !== mySide) {
      const legal = destsFor(board, msg.from);
      const d = legal.find((x) => x.to === msg.to);
      if (board[msg.from] === player && d) doMove({ from: msg.from, to: msg.to, path: d.path }, true);
    } else if (msg.type === 'rematch') {
      startGame({ mode: 'net', diff, netRole: mySide === 0 ? 'host' : 'join' });
      Shell.hideBanner();
    } else if (msg.type === 'bye') {
      Shell.setStatus('對方已離開連線');
    }
  });
  Net.onClose(() => { if (mode === 'net' && !gameOver) Shell.setStatus('連線已中斷'); });

  // 測試掛鉤
  window.DBG = {
    cam,
    view: () => E3D.makeView(cam, W2, H2),
    cells,
    state: () => ({ board: Array.from(board), player, gameOver, thinking, mode, histLen: history.length, selected }),
    rules: { newBoard, allMoves, destsFor, checkWin, aiPick, OPP, hexDist, GOAL, GOALV, HOME },
  };

  Shell.init({
    title: '3D 跳棋',
    sideLabels: ['紅方（先手）', '藍方（後手）'],
    hint: '拖曳環顧視角．滾輪/雙指縮放．點選棋子再點目的地（可連跳）',
    rulesHtml: '棋子可走一步或連續跳過相鄰棋子。先把 10 顆棋子全部走進對面尖角者獲勝（被對手佔住的格視同填滿）。',
    defaultMode: 'ai',
    onStart: startGame,
    onUndo: () => {
      if (thinking || !history.length) return;
      moveAnim = null;
      if (mode === 'ai') {
        while (history.length) {
          const h = history.pop();
          board = h.board; player = h.player; lastPath = h.lastPath;
          if (player - 1 === humanSide) break;
        }
      } else {
        const h = history.pop();
        board = h.board; player = h.player; lastPath = h.lastPath;
      }
      gameOver = false; selected = -1; selMoves = [];
      Shell.hideBanner();
      statusText();
      Shell.setUndoEnabled(history.length > 0);
      dirty = true;
      scheduleAI();
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
