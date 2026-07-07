/* 3D 俄羅斯方塊 — 直立場地、7-bag、SRS 踢牆、hold/next、消行動畫 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const svg = $('scene');

  const W = 10, H = 20, CELL = 1.0;
  // 顏色（每型）
  const COLORS = {
    I: { top: '#5cc9e6', side: '#33a7c8', dark: '#217e9a' },
    O: { top: '#f2cf4e', side: '#d9ad2c', dark: '#a9841c' },
    T: { top: '#b06fd6', side: '#8f4dbd', dark: '#6a3590' },
    S: { top: '#7cc576', side: '#57a851', dark: '#3d7d38' },
    Z: { top: '#e0685a', side: '#c04638', dark: '#912f24' },
    J: { top: '#5a8fe0', side: '#3d6dc0', dark: '#2a4f92' },
    L: { top: '#e6a259', side: '#c8803a', dark: '#985d26' },
    G: { top: '#3a4658', side: '#2c3546', dark: '#222b38' },
  };
  // 各型矩陣（1=方塊），以最小外框表示
  const SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  };
  const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  // 旋轉：把方陣順時針轉，回傳 offsets（dr,dc）
  function rotate(mat) {
    const n = mat.length;
    const out = [];
    for (let r = 0; r < n; r++) out.push(new Array(n).fill(0));
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[c][n - 1 - r] = mat[r][c];
    return out;
  }
  // 預先算好每型 4 個旋轉態的 cell 偏移
  const PIECES = {};
  for (const t of TYPES) {
    let m = SHAPES[t]; const states = [];
    for (let r = 0; r < 4; r++) {
      const cells = [];
      for (let i = 0; i < m.length; i++) for (let j = 0; j < m[i].length; j++) if (m[i][j]) cells.push([i, j]);
      states.push(cells);
      m = rotate(m);
    }
    PIECES[t] = states;
  }

  // SRS 踢牆表（x 右、y 上），轉成 (drow=-y, dcol=x)
  const KICK = {
    JLSTZ: {
      '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
      '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
      '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
      '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
      '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
      '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
      '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
      '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    },
    I: {
      '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
      '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
      '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
      '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
      '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
      '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
      '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
      '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    },
  };

  const GRAV = [800, 720, 630, 550, 470, 380, 300, 220, 160, 120, 100, 90, 80, 70, 60, 50, 45, 40, 35, 30, 25];

  // ================= 狀態 =================
  let grid, cur, holdType, holdUsed, bag, nextQ, level, lines, score, startLevel, over, running, best;
  let clearing = null; // {rows:[], t0}
  best = +(localStorage.getItem('tetris_best') || 0);
  grid = emptyGrid(); over = true; running = false; nextQ = []; cur = null;

  function emptyGrid() { const g = []; for (let r = 0; r < H; r++) g.push(new Array(W).fill(null)); return g; }

  function refillBag() {
    const b = TYPES.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [b[i], b[j]] = [b[j], b[i]]; }
    bag.push(...b);
  }
  function nextType() { if (bag.length < 1) refillBag(); return bag.shift(); }
  function fillQueue() { while (nextQ.length < 4) nextQ.push(nextType()); }

  function spawn(type) {
    const t = type || nextQ.shift();
    fillQueue();
    const cells = PIECES[t][0];
    // 置中：外框寬度
    const cols = cells.map((c) => c[1]);
    const w = Math.max(...cols) + 1;
    const piece = { type: t, rot: 0, r: -1, c: ((W - w) / 2) | 0 };
    if (collide(piece, piece.r, piece.c, piece.rot)) { gameOver(); return null; }
    return piece;
  }

  function cellsOf(p, rot) { return PIECES[p.type][rot]; }

  function collide(p, r, c, rot) {
    for (const [dr, dc] of cellsOf(p, rot)) {
      const rr = r + dr, cc = c + dc;
      if (cc < 0 || cc >= W || rr >= H) return true;
      if (rr >= 0 && grid[rr][cc]) return true;
    }
    return false;
  }

  function move(dr, dc) {
    if (!cur || over || clearing) return false;
    if (!collide(cur, cur.r + dr, cur.c + dc, cur.rot)) { cur.r += dr; cur.c += dc; dirty = true; return true; }
    return false;
  }

  function rotateCur(cw) {
    if (!cur || over || clearing) return false;
    const from = cur.rot, to = (from + (cw ? 1 : 3)) % 4;
    const table = cur.type === 'I' ? KICK.I : cur.type === 'O' ? null : KICK.JLSTZ;
    const kicks = table ? table[from + '>' + to] : [[0, 0]];
    for (const [x, y] of kicks) {
      const nr = cur.r + (-y), nc = cur.c + x;
      if (!collide(cur, nr, nc, to)) { cur.rot = to; cur.r = nr; cur.c = nc; dirty = true; return true; }
    }
    return false;
  }

  function ghostRow() {
    let r = cur.r;
    while (!collide(cur, r + 1, cur.c, cur.rot)) r++;
    return r;
  }

  function lock() {
    for (const [dr, dc] of cellsOf(cur, cur.rot)) {
      const rr = cur.r + dr, cc = cur.c + dc;
      if (rr < 0) { gameOver(); return; }
      grid[rr][cc] = cur.type;
    }
    // 找滿行
    const full = [];
    for (let r = 0; r < H; r++) if (grid[r].every((x) => x)) full.push(r);
    if (full.length) {
      clearing = { rows: full, t0: performance.now() };
      addScore(full.length);
    } else {
      cur = spawn();
    }
    holdUsed = false;
    dirty = true;
  }

  function finishClear() {
    const rows = clearing.rows;
    for (const r of rows) { grid.splice(r, 1); grid.unshift(new Array(W).fill(null)); }
    clearing = null;
    lines += rows.length;
    const newLevel = startLevel + Math.floor(lines / 10);
    level = newLevel;
    cur = spawn();
    updateStatus();
    dirty = true;
  }

  function addScore(n) {
    const tbl = [0, 100, 300, 500, 800];
    score += tbl[n] * (level + 1);
    if (score > best) { best = score; localStorage.setItem('tetris_best', best); }
    updateStatus();
  }

  function hold() {
    if (!cur || over || clearing || holdUsed) return;
    const t = cur.type;
    if (holdType) { const h = holdType; holdType = t; cur = spawn(h); }
    else { holdType = t; cur = spawn(); }
    holdUsed = true;
    dirty = true;
  }

  function softDrop() { if (move(1, 0)) { score += 1; updateStatus(); } else lockSoon(); }
  function hardDrop() {
    if (!cur || over || clearing) return;
    const g = ghostRow();
    score += (g - cur.r) * 2;
    cur.r = g;
    updateStatus();
    lock();
  }
  let lockTimer = 0;
  function lockSoon() { if (lockTimer === 0) lockTimer = performance.now(); }

  function gameOver() {
    over = true; running = false;
    updateStatus();
    setTimeout(() => Shell.showBanner('遊戲結束', `分數 ${score}｜消除 ${lines} 行｜最高 ${best}`), 400);
  }

  function updateStatus() {
    Shell.setStatus(`分數 <b>${score}</b>｜等級 ${level}｜消除 ${lines} 行｜最高 ${best}`);
  }

  function reset(cfg) {
    startLevel = { easy: 0, normal: 3, hard: 6 }[cfg.level] || 0;
    grid = emptyGrid(); bag = []; nextQ = []; holdType = null; holdUsed = false;
    level = startLevel; lines = 0; score = 0; over = false; running = true; clearing = null; lockTimer = 0;
    fillQueue();
    cur = spawn();
    acc = 0; lastT = 0;
    updateStatus();
    dirty = true;
  }

  // ================= 渲染 =================
  const cam = E3D.createCamera({ yaw: 0, pitch: 0.32, dist: 30, target: [0, H * CELL / 2 - 1, 0], fov: 0.82, minDist: 16, maxDist: 48, minPitch: 0.05, maxPitch: 1.15 });
  let W2 = 0, H2 = 0, dirty = true;
  function resize() { W2 = innerWidth; H2 = innerHeight; svg.setAttribute('viewBox', `0 0 ${W2} ${H2}`); dirty = true; }
  addEventListener('resize', resize); resize();

  // grid(row 0 頂) → world：x 置中，y 由下往上，z=0（方塊往 +z 凸）
  const gx = (c) => (c - (W - 1) / 2) * CELL;
  const gy = (r) => (H - 1 - r) * CELL * 1 + CELL / 2; // 中心 y
  const DEPTH = CELL * 0.92;

  const DEFS = `<defs>${E3D.DEFS}
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8a5a2b"/><stop offset=".5" stop-color="#6e451f"/><stop offset="1" stop-color="#4e2f13"/>
    </linearGradient>
    <linearGradient id="wellBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a2230"/><stop offset="1" stop-color="#0e141d"/>
    </linearGradient>
  </defs>`;

  function quadS(view, pts3, fill, extra) {
    const ps = pts3.map((p) => view.project(p));
    if (ps.some((p) => !p)) return '';
    return `<path d="${E3D.pathOf(ps, true)}" fill="${fill}"${extra || ''}/>`;
  }

  // 一顆方塊（中心 x,y；z 面在 0，往 +z 凸 DEPTH），centered in y
  function blockSvg(view, x, yc, z, col, size, alpha) {
    const b = E3D.box(view, x, yc - size / 2, z, size, size, DEPTH, col);
    if (!b) return null;
    return { svg: alpha != null ? `<g opacity="${alpha}">${b.svg}</g>` : b.svg, depth: b.depth };
  }

  function render() {
    const view = E3D.makeView(cam, W2, H2);
    const halfW = W * CELL / 2, topY = H * CELL, botY = 0;
    let s = DEFS;

    // 桌面（在井底下方）
    s += quadS(view, [[-40, -3.2, -6], [40, -3.2, -6], [40, -3.2, 30], [-40, -3.2, 30]], 'url(#wood)');
    // 井背板
    const back = -DEPTH / 2 - 0.05;
    s += quadS(view, [[-halfW, botY, back], [halfW, botY, back], [halfW, topY, back], [-halfW, topY, back]], 'url(#wellBg)');
    // 井格線
    let g = '';
    for (let c = 0; c <= W; c++) { const a = view.project([-halfW + c * CELL, botY, back]), b = view.project([-halfW + c * CELL, topY, back]); if (a && b) g += `<line x1="${E3D.fmt(a.x)}" y1="${E3D.fmt(a.y)}" x2="${E3D.fmt(b.x)}" y2="${E3D.fmt(b.y)}"/>`; }
    for (let r = 0; r <= H; r++) { const a = view.project([-halfW, r * CELL, back]), b = view.project([halfW, r * CELL, back]); if (a && b) g += `<line x1="${E3D.fmt(a.x)}" y1="${E3D.fmt(a.y)}" x2="${E3D.fmt(b.x)}" y2="${E3D.fmt(b.y)}"/>`; }
    s += `<g stroke="rgba(90,110,140,.14)" stroke-width=".8">${g}</g>`;
    // 井框（左右底）
    const frameC = { top: '#6e451f', side: '#5a3a19', dark: '#402910' };
    const items = [];
    for (const bx of [
      E3D.box(view, -halfW - CELL * 0.4, botY, 0, CELL * 0.8, topY, DEPTH * 1.4, frameC),
      E3D.box(view, halfW + CELL * 0.4, botY, 0, CELL * 0.8, topY, DEPTH * 1.4, frameC),
      E3D.box(view, 0, -CELL * 0.4, 0, W * CELL + CELL * 1.6, CELL * 0.8, DEPTH * 1.4, frameC),
    ]) if (bx) items.push({ svg: bx.svg, depth: bx.depth + 200 });

    // 已鎖定方塊
    const now = performance.now();
    const flashRows = clearing ? new Set(clearing.rows) : null;
    let flashOn = false;
    if (clearing) flashOn = (Math.floor((now - clearing.t0) / 70) % 2) === 0;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (!grid[r][c]) continue;
      let col = COLORS[grid[r][c]];
      let alpha = null;
      if (flashRows && flashRows.has(r)) { col = flashOn ? { top: '#fff', side: '#eee', dark: '#ccc' } : col; }
      const bl = blockSvg(view, gx(c), gy(r), 0, col, CELL * 0.92, alpha);
      if (bl) items.push(bl);
    }

    // ghost + 現行方塊
    if (cur && !clearing && !over) {
      const gr = ghostRow();
      for (const [dr, dc] of cellsOf(cur, cur.rot)) {
        const rr = gr + dr, cc = cur.c + dc;
        if (rr < 0) continue;
        const bl = blockSvg(view, gx(cc), gy(rr), 0, COLORS[cur.type], CELL * 0.9, 0.22);
        if (bl) items.push(bl);
      }
      for (const [dr, dc] of cellsOf(cur, cur.rot)) {
        const rr = cur.r + dr, cc = cur.c + dc;
        if (rr < 0) continue;
        const bl = blockSvg(view, gx(cc), gy(rr), 0, COLORS[cur.type], CELL * 0.92);
        if (bl) items.push(bl);
      }
    }

    // Hold（左）與 Next（右）迷你展示
    const drawMini = (type, ox, oy, scale) => {
      if (!type) return;
      const cells = PIECES[type][0];
      const cols = cells.map((c) => c[1]), rows = cells.map((c) => c[0]);
      const cw = (Math.max(...cols) + Math.min(...cols)) / 2, ch = (Math.max(...rows) + Math.min(...rows)) / 2;
      for (const [dr, dc] of cells) {
        const x = ox + (dc - cw) * CELL * scale;
        const y = oy - (dr - ch) * CELL * scale;
        const bl = blockSvg(view, x, y, 0, COLORS[type], CELL * 0.86 * scale);
        if (bl) items.push(bl);
      }
    };
    const leftX = -halfW - CELL * 3.2, rightX = halfW + CELL * 3.2;
    drawMini(holdType, leftX, topY - CELL * 2, 0.8);
    for (let i = 0; i < 3; i++) drawMini(nextQ[i], rightX, topY - CELL * 2 - i * CELL * 3, 0.8);

    // 標籤
    const lbl = (txt, wx, wy) => { const p = view.project([wx, wy, 0]); if (p) return `<text x="${E3D.fmt(p.x)}" y="${E3D.fmt(p.y)}" font-size="${E3D.fmt(p.s * 0.7)}" fill="#9fb0c3" text-anchor="middle" font-family="'Noto Sans TC',sans-serif">${txt}</text>`; return ''; };

    items.sort((a, b) => b.depth - a.depth);
    for (const it of items) s += it.svg;
    s += lbl('HOLD', leftX, topY - CELL * 0.2);
    s += lbl('NEXT', rightX, topY - CELL * 0.2);
    svg.innerHTML = s;
  }

  // ================= 主迴圈 =================
  let acc = 0, lastT = 0;
  function tick(now) {
    if (W2 !== innerWidth || H2 !== innerHeight) resize();
    if (!lastT) lastT = now;
    const dt = Math.min(200, now - lastT); lastT = now;
    if (running && !over && !Shell.isPaused()) {
      if (clearing) {
        if (now - clearing.t0 > 340) finishClear();
      } else {
        acc += dt;
        const gm = GRAV[Math.min(level, GRAV.length - 1)];
        while (acc >= gm) {
          acc -= gm;
          if (!move(1, 0)) {
            if (lockTimer === 0) lockTimer = now;
          } else lockTimer = 0;
        }
        if (lockTimer && now - lockTimer > 450) {
          if (collide(cur, cur.r + 1, cur.c, cur.rot)) { lock(); lockTimer = 0; }
          else lockTimer = 0;
        }
      }
    }
    if (dirty) { try { render(); } catch (e) { console.error('render error', e); } dirty = false; }
    schedule();
  }
  function schedule() { if (document.hidden) setTimeout(() => tick(performance.now()), 250); else requestAnimationFrame(tick); }
  schedule();
  document.addEventListener('visibilitychange', () => { if (document.hidden && running && !over) Shell.setPaused(true); });

  // ================= 輸入 =================
  E3D.attachControls(svg, cam, { onChange: () => { dirty = true; } });
  addEventListener('keydown', (e) => {
    if (over || !running) return;
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': move(0, -1); break;
      case 'ArrowRight': case 'd': case 'D': move(0, 1); break;
      case 'ArrowDown': case 's': case 'S': softDrop(); break;
      case 'ArrowUp': case 'x': case 'X': rotateCur(true); break;
      case 'z': case 'Z': rotateCur(false); break;
      case ' ': hardDrop(); break;
      case 'Shift': case 'c': case 'C': hold(); break;
      case 'p': case 'P': Shell.setPaused(!Shell.isPaused()); return;
      default: return;
    }
    e.preventDefault();
  });
  $('dpad').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'left') move(0, -1); else if (a === 'right') move(0, 1);
    else if (a === 'down') softDrop(); else if (a === 'rot') rotateCur(true);
    else if (a === 'up') hardDrop(); else if (a === 'hold') hold();
    e.preventDefault();
  });

  // ================= DBG / Shell =================
  window.DBG = {
    cam, view: () => E3D.makeView(cam, W2, H2),
    state: () => ({ grid: grid.map((r) => r.slice()), cur: cur && { type: cur.type, r: cur.r, c: cur.c, rot: cur.rot }, hold: holdType, next: nextQ.slice(), level, lines, score, over, clearing: clearing && clearing.rows.slice() }),
    reset, move, rotateCur, hardDrop, softDrop, hold, spawn: (t) => { cur = spawn(t); dirty = true; },
    setGridRow: (r, arr) => { grid[r] = arr.slice(); dirty = true; },
    ghostRow, finishClear, lock: () => lock(),
  };

  Shell.init({
    title: '3D 俄羅斯方塊',
    startTitle: '開始遊戲',
    sections: [
      { id: 'level', label: '起始等級（難度）', default: 'normal', options: [
        { id: 'easy', label: '簡單', sub: 'Lv.0 慢' },
        { id: 'normal', label: '普通', sub: 'Lv.3' },
        { id: 'hard', label: '困難', sub: 'Lv.6 快' },
      ] },
    ],
    bar: { pause: true },
    hint: '←→移動 ↓軟降 ↑/X旋轉 空白硬降 C暫存．螢幕按鍵亦可．拖曳環顧',
    rulesHtml: '拼滿整行即消除。旋轉支援踢牆，可用 C 暫存目前方塊。每消 10 行升一級、加速。',
    onStart: (cfg) => { $('dpad').classList.remove('hidden'); reset(cfg); },
    onPause: () => {},
    onResetView: () => { cam.yaw = 0; cam.pitch = 0.32; cam.dist = 30; dirty = true; },
  });
})();
