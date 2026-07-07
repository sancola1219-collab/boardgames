/* 3D 貪食蛇 — 經典/穿牆模式、三段速度、鍵盤+觸控 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const svg = $('scene');

  // ================= 狀態 =================
  const N = 21, CELL = 1.6, B = N * CELL / 2; // 格數、格距、半寬
  let snake, dir, dirQueue, food, score, best, alive, running, wrap, stepMs, foods;
  best = +(localStorage.getItem('snake_best') || 0);
  alive = false; running = false;
  snake = [[10, 12], [10, 11], [10, 10]]; dir = [0, 1]; food = [10, 16]; score = 0;

  const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  const SPEEDS = { slow: 200, mid: 140, fast: 95 };

  function reset(cfg) {
    wrap = cfg.mode === 'wrap';
    stepMs = SPEEDS[cfg.speed] || 140;
    snake = [[10, 12], [10, 11], [10, 10]];
    dir = [0, 1]; dirQueue = [];
    score = 0; foods = 0; alive = true; running = true;
    placeFood();
    acc = 0;
    updateStatus();
    dirty = true;
  }

  function placeFood() {
    const occ = new Set(snake.map(([r, c]) => r * N + c));
    let i;
    do { i = (Math.random() * N * N) | 0; } while (occ.has(i));
    food = [(i / N) | 0, i % N];
  }

  function setDir(name) {
    const d = DIRS[name];
    if (!d || !alive) return;
    const last = dirQueue.length ? dirQueue[dirQueue.length - 1] : dir;
    if (d[0] === -last[0] && d[1] === -last[1]) return; // 不可回頭
    if (d[0] === last[0] && d[1] === last[1]) return;
    if (dirQueue.length < 3) dirQueue.push(d);
  }

  // 走一步；回傳 false = 死亡
  function step() {
    if (dirQueue.length) dir = dirQueue.shift();
    let [r, c] = snake[0];
    r += dir[0]; c += dir[1];
    if (wrap) { r = (r + N) % N; c = (c + N) % N; }
    else if (r < 0 || r >= N || c < 0 || c >= N) return die();
    if (snake.some(([sr, sc], i) => i < snake.length - 1 && sr === r && sc === c)) return die();
    snake.unshift([r, c]);
    if (r === food[0] && c === food[1]) {
      score += 10; foods++;
      if (foods % 5 === 0 && stepMs > 60) stepMs -= 6; // 漸漸加速
      placeFood();
      if (score > best) { best = score; localStorage.setItem('snake_best', best); }
    } else snake.pop();
    updateStatus();
    dirty = true;
    return true;
  }

  function die() {
    alive = false; running = false;
    updateStatus();
    dirty = true;
    setTimeout(() => Shell.showBanner('遊戲結束', `分數 ${score}｜最高紀錄 ${best}`), 400);
    return false;
  }

  function updateStatus() {
    Shell.setStatus(`分數 <b>${score}</b>｜長度 ${snake.length}｜最高 ${best}${wrap ? '｜穿牆' : ''}`);
  }

  // ================= 渲染 =================
  const cam = E3D.createCamera({ yaw: 0, pitch: 0.72, dist: 36, target: [0, 0, 0], fov: 0.8, minDist: 15, maxDist: 60, minPitch: 0.25, maxPitch: 1.4 });
  let W2 = 0, H2 = 0, dirty = true;
  function resize() { W2 = innerWidth; H2 = innerHeight; svg.setAttribute('viewBox', `0 0 ${W2} ${H2}`); dirty = true; }
  addEventListener('resize', resize); resize();

  const xz = (r, c) => [(c - (N - 1) / 2) * CELL, (r - (N - 1) / 2) * CELL];

  const DEFS = `<defs>${E3D.DEFS}
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8a5a2b"/><stop offset=".5" stop-color="#6e451f"/><stop offset="1" stop-color="#4e2f13"/>
    </linearGradient>
    <linearGradient id="floorA" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3f5a35"/><stop offset="1" stop-color="#324a2b"/>
    </linearGradient>
    <radialGradient id="apple" cx=".35" cy=".3" r=".95">
      <stop offset="0" stop-color="#ff9d8a"/><stop offset=".45" stop-color="#d94b35"/><stop offset="1" stop-color="#7e1d10"/>
    </radialGradient>
  </defs>`;

  function quadS(view, pts3, fill, extra) {
    const ps = pts3.map((p) => view.project(p));
    if (ps.some((p) => !p)) return '';
    return `<path d="${E3D.pathOf(ps, true)}" fill="${fill}"${extra || ''}/>`;
  }

  function render() {
    const view = E3D.makeView(cam, W2, H2);
    const M = 1.1;
    let s = DEFS;

    // 桌面 + 場地
    s += quadS(view, [[-36, -0.6, -32], [36, -0.6, -32], [36, -0.6, 36], [-36, -0.6, 36]], 'url(#wood)');
    s += quadS(view, [[-B - M, 0, -B - M], [B + M, 0, -B - M], [B + M, 0, B + M], [-B - M, 0, B + M]], '#2a3d24');
    s += quadS(view, [[-B, 0.015, -B], [B, 0.015, -B], [B, 0.015, B], [-B, 0.015, B]], 'url(#floorA)');

    // 細格線
    let g = '';
    for (let i = 0; i <= N; i++) {
      const t = -B + i * CELL;
      const a = view.project([t, 0.025, -B]), b = view.project([t, 0.025, B]);
      const c = view.project([-B, 0.025, t]), d = view.project([B, 0.025, t]);
      if (a && b) g += `<line x1="${E3D.fmt(a.x)}" y1="${E3D.fmt(a.y)}" x2="${E3D.fmt(b.x)}" y2="${E3D.fmt(b.y)}"/>`;
      if (c && d) g += `<line x1="${E3D.fmt(c.x)}" y1="${E3D.fmt(c.y)}" x2="${E3D.fmt(d.x)}" y2="${E3D.fmt(d.y)}"/>`;
    }
    s += `<g stroke="rgba(20,32,16,.5)" stroke-width=".7">${g}</g>`;

    // 圍牆（穿牆模式虛化）
    const wallOp = wrap ? .35 : 1;
    const wallC = { top: '#7a5127', side: '#5f3d1c', dark: '#4a2f14' };
    const items = [];
    const wallY = 0, wallH = 1.0, WT = 0.9;
    for (const [x, z, sx, sz] of [
      [0, -B - M + WT / 2, (B + M) * 2, WT], [0, B + M - WT / 2, (B + M) * 2, WT],
      [-B - M + WT / 2, 0, WT, (B + M) * 2 - WT * 2], [B + M - WT / 2, 0, WT, (B + M) * 2 - WT * 2],
    ]) {
      const bx = E3D.box(view, x, wallY, z, sx, wallH, sz, wallC);
      if (bx) items.push({ svg: `<g opacity="${wallOp}">${bx.svg}</g>`, depth: bx.depth + 500 }); // 牆先畫（在最遠層之後、物件之前處理：加大 depth 使其先畫）
    }

    // 蛇（頭亮、身漸暗）+ 食物
    snake.forEach(([r, c], i) => {
      const [x, z] = xz(r, c);
      const head = i === 0;
      const k = Math.max(0, 1 - i * 0.03);
      const gCol = (a) => `rgb(${Math.round(60 * k + a)},${Math.round(150 * k + 30 + a)},${Math.round(90 * k + a)})`;
      const bx = E3D.box(view, x, 0.03, z, CELL * (head ? 0.94 : 0.84), head ? 1.15 : 0.9, CELL * (head ? 0.94 : 0.84), {
        top: gCol(head ? 60 : 30), side: gCol(head ? 20 : 0), dark: gCol(head ? -10 : -25), stroke: 'rgba(10,25,12,.5)',
      });
      if (bx) {
        let extra = '';
        if (head) { // 眼睛：頭頂兩點，沿行進方向前偏、垂直向分開
          for (const sgn of [-1, 1]) {
            const off = dir[1] !== 0
              ? [dir[1] * 0.25, sgn * 0.24]   // 水平移動：x 向前、z 向分開
              : [sgn * 0.24, dir[0] * 0.25];  // 垂直移動：z 向前、x 向分開
            const p = view.project([x + off[0], 1.2, z + off[1]]);
            if (p) extra += `<circle cx="${E3D.fmt(p.x)}" cy="${E3D.fmt(p.y)}" r="${E3D.fmt(p.s * 0.09)}" fill="#101d12"/>`;
          }
        }
        items.push({ svg: bx.svg + extra, depth: bx.depth });
      }
    });
    { // 食物
      const [x, z] = xz(food[0], food[1]);
      const st = E3D.stone(view, x, 0.05, z, CELL * 0.36, { h: CELL * 0.5, fill: 'url(#apple)', rim: 'rgba(80,15,8,.6)', hiA: 0.5 });
      if (st) {
        const stem = view.project([x, CELL * 0.62, z]);
        let extra = '';
        if (stem) extra = `<rect x="${E3D.fmt(stem.x - stem.s * 0.03)}" y="${E3D.fmt(stem.y - stem.s * 0.18)}" width="${E3D.fmt(stem.s * 0.06)}" height="${E3D.fmt(stem.s * 0.2)}" fill="#4a6b2f"/>`;
        items.push({ svg: st.svg + extra, depth: st.depth });
      }
      items.push({ svg: E3D.shadow(view, x, z, CELL * 0.42, 0.4), depth: 9000 });
    }
    // 蛇影
    for (const [r, c] of snake) {
      const [x, z] = xz(r, c);
      items.push({ svg: E3D.shadow(view, x, z, CELL * 0.5, 0.3), depth: 9001 });
    }

    items.sort((a, b) => b.depth - a.depth);
    for (const it of items) s += it.svg;
    svg.innerHTML = s;
  }

  // ================= 主迴圈 =================
  let acc = 0, lastT = 0;
  function tick(now) {
    if (W2 !== innerWidth || H2 !== innerHeight) resize();
    if (!lastT) lastT = now;
    const dt = Math.min(200, now - lastT);
    lastT = now;
    if (running && alive && !Shell.isPaused()) {
      acc += dt;
      while (acc >= stepMs) { acc -= stepMs; if (!step()) break; }
    }
    if (dirty) {
      try { render(); } catch (e) { console.error('render error', e); }
      dirty = false;
    }
    schedule();
  }
  function schedule() { if (document.hidden) setTimeout(() => tick(performance.now()), 250); else requestAnimationFrame(tick); }
  schedule();
  // 切到背景自動暫停
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running && alive) { Shell.setPaused(true); }
  });

  // ================= 輸入 =================
  E3D.attachControls(svg, cam, { onChange: () => { dirty = true; } });
  addEventListener('keydown', (e) => {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
    if (map[e.key]) { setDir(map[e.key]); e.preventDefault(); }
    else if (e.key === 'p' || e.key === 'P') Shell.setPaused(!Shell.isPaused());
  });
  $('dpad').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button');
    if (b) { setDir(b.dataset.d); e.preventDefault(); }
  });

  // ================= Shell =================
  window.DBG = {
    cam, view: () => E3D.makeView(cam, W2, H2),
    state: () => ({ snake: snake.map((s2) => s2.slice()), dir: dir.slice(), food: food.slice(), score, alive, running, stepMs, wrap }),
    setDir, step, reset,
  };

  Shell.init({
    title: '3D 貪食蛇',
    startTitle: '開始遊戲',
    sections: [
      { id: 'mode', label: '模式', default: 'classic', options: [
        { id: 'classic', label: '經典', sub: '撞牆結束' },
        { id: 'wrap', label: '穿牆', sub: '從對面出現' },
      ] },
      { id: 'speed', label: '速度', default: 'mid', options: [
        { id: 'slow', label: '悠閒' }, { id: 'mid', label: '標準' }, { id: 'fast', label: '疾速' },
      ] },
    ],
    bar: { pause: true },
    hint: '方向鍵/WASD 或螢幕按鍵控制．拖曳環顧．滾輪縮放．P 暫停',
    rulesHtml: '吃到蘋果加分並變長，每 5 顆會稍微加速。撞到自己（或經典模式撞牆）即結束。',
    onStart: (cfg) => { $('dpad').classList.remove('hidden'); reset(cfg); },
    onPause: () => {},
    onResetView: () => { cam.yaw = 0; cam.pitch = 0.72; cam.dist = 36; dirty = true; },
  });
})();
