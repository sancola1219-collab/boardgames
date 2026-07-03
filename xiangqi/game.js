/* 3D 象棋 — 完整規則（將軍/困斃/飛將/重複和棋）、AI（三段難度：迭代加深 α-β + 靜態搜尋）、渲染 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const svg = $('scene');

  // ================= 棋盤/棋子 =================
  // idx = r*9+c；r0 黑方底線（上），r9 紅方底線（下）。紅 = 正值，黑 = 負值。
  // 類型：1將帥 2士仕 3象相 4馬 5車 6炮 7卒兵
  const K = 1, A = 2, E = 3, H = 4, R = 5, C = 6, P = 7;
  const idx = (r, c) => r * 9 + c;
  const ROW = (i) => (i / 9) | 0, COL = (i) => i % 9;
  const NAME = { '1': ['', '帥', '仕', '相', '傌', '俥', '炮', '兵'], '-1': ['', '將', '士', '象', '馬', '車', '砲', '卒'] };
  const SIDE_NAME = { 1: '紅方', '-1': '黑方' };

  function newBoard() {
    const b = new Int8Array(90);
    const back = [R, H, E, A, K, A, E, H, R];
    for (let c = 0; c < 9; c++) { b[idx(0, c)] = -back[c]; b[idx(9, c)] = back[c]; }
    b[idx(2, 1)] = -C; b[idx(2, 7)] = -C; b[idx(7, 1)] = C; b[idx(7, 7)] = C;
    for (let c = 0; c < 9; c += 2) { b[idx(3, c)] = -P; b[idx(6, c)] = P; }
    return b;
  }

  // ================= 走法生成 =================
  const inBoard = (r, c) => r >= 0 && r <= 9 && c >= 0 && c <= 8;
  const inPalace = (r, c, s) => c >= 3 && c <= 5 && (s > 0 ? r >= 7 : r <= 2);
  const ownHalf = (r, s) => (s > 0 ? r >= 5 : r <= 4);
  const crossed = (r, s) => (s > 0 ? r <= 4 : r >= 5);

  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const HOFF = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];

  // 產生偽合法步（不檢查自將）；push move = from*90+to
  function genMoves(bd, s, out) {
    out = out || [];
    for (let i = 0; i < 90; i++) {
      const v = bd[i];
      if (!v || (v > 0) !== (s > 0)) continue;
      const t = Math.abs(v), r = ROW(i), c = COL(i);
      if (t === K) {
        for (const [dr, dc] of ORTH) {
          const nr = r + dr, nc = c + dc;
          if (inPalace(nr, nc, s) && bd[idx(nr, nc)] * s <= 0) out.push(i * 90 + idx(nr, nc));
        }
      } else if (t === A) {
        for (const [dr, dc] of DIAG) {
          const nr = r + dr, nc = c + dc;
          if (inPalace(nr, nc, s) && bd[idx(nr, nc)] * s <= 0) out.push(i * 90 + idx(nr, nc));
        }
      } else if (t === E) {
        for (const [dr, dc] of DIAG) {
          const nr = r + dr * 2, nc = c + dc * 2;
          if (!inBoard(nr, nc) || !ownHalf(nr, s)) continue;
          if (bd[idx(r + dr, c + dc)]) continue; // 塞象眼
          if (bd[idx(nr, nc)] * s <= 0) out.push(i * 90 + idx(nr, nc));
        }
      } else if (t === H) {
        for (const [dr, dc] of HOFF) {
          const nr = r + dr, nc = c + dc;
          if (!inBoard(nr, nc)) continue;
          const lr = r + (Math.abs(dr) === 2 ? dr / 2 : 0), lc = c + (Math.abs(dc) === 2 ? dc / 2 : 0);
          if (bd[idx(lr, lc)]) continue; // 蹩馬腿
          if (bd[idx(nr, nc)] * s <= 0) out.push(i * 90 + idx(nr, nc));
        }
      } else if (t === R) {
        for (const [dr, dc] of ORTH) {
          let nr = r + dr, nc = c + dc;
          while (inBoard(nr, nc)) {
            const tv = bd[idx(nr, nc)];
            if (!tv) out.push(i * 90 + idx(nr, nc));
            else { if (tv * s < 0) out.push(i * 90 + idx(nr, nc)); break; }
            nr += dr; nc += dc;
          }
        }
      } else if (t === C) {
        for (const [dr, dc] of ORTH) {
          let nr = r + dr, nc = c + dc, screen = false;
          while (inBoard(nr, nc)) {
            const tv = bd[idx(nr, nc)];
            if (!screen) {
              if (!tv) out.push(i * 90 + idx(nr, nc));
              else screen = true;
            } else if (tv) { if (tv * s < 0) out.push(i * 90 + idx(nr, nc)); break; }
            nr += dr; nc += dc;
          }
        }
      } else { // P
        const fwd = s > 0 ? -1 : 1;
        const cand = [[r + fwd, c]];
        if (crossed(r, s)) { cand.push([r, c - 1], [r, c + 1]); }
        for (const [nr, nc] of cand) {
          if (inBoard(nr, nc) && bd[idx(nr, nc)] * s <= 0) out.push(i * 90 + idx(nr, nc));
        }
      }
    }
    return out;
  }

  function findKing(bd, s) {
    for (let i = 0; i < 90; i++) if (bd[i] === K * s) return i;
    return -1;
  }

  // (r,c) 是否被 s 方攻擊（含飛將規則：對方將沿直線第一子）
  function attacked(bd, r, c, s) {
    // 直線：車 / 炮（隔一子）/ 將帥（同線第一子，飛將）
    for (const [dr, dc] of ORTH) {
      let nr = r + dr, nc = c + dc, seen = 0;
      while (inBoard(nr, nc)) {
        const v = bd[idx(nr, nc)];
        if (v) {
          seen++;
          if (seen === 1) {
            if (v === R * s) return true;
            if (v === K * s && dc === 0) return true; // 飛將：同一直行第一子是敵將
          } else if (seen === 2) {
            if (v === C * s) return true;
            break;
          }
        }
        nr += dr; nc += dc;
      }
    }
    // 馬（反向蹩腿：腿在目標側）
    for (const [dr, dc] of HOFF) {
      const sr = r + dr, sc = c + dc;
      if (!inBoard(sr, sc) || bd[idx(sr, sc)] !== H * s) continue;
      const lr = r + (Math.abs(dr) === 2 ? dr / 2 : dr), lc = c + (Math.abs(dc) === 2 ? dc / 2 : dc);
      if (!bd[idx(lr, lc)]) return true;
    }
    // 兵卒：s 方的兵在 (r,c) 前方一格或（過河後）左右
    const fwd = s > 0 ? -1 : 1; // s 方前進方向
    if (inBoard(r - fwd, c) && bd[idx(r - fwd, c)] === P * s) return true;
    for (const dc of [-1, 1]) {
      if (inBoard(r, c + dc) && bd[idx(r, c + dc)] === P * s && crossed(r, s)) return true;
    }
    return false;
  }

  function inCheck(bd, s) {
    const k = findKing(bd, s);
    return k < 0 ? true : attacked(bd, ROW(k), COL(k), -s);
  }

  function legalMoves(bd, s) {
    const pseudo = genMoves(bd, s);
    const out = [];
    for (const m of pseudo) {
      const f = (m / 90) | 0, t = m % 90;
      const cap = bd[t];
      bd[t] = bd[f]; bd[f] = 0;
      if (!inCheck(bd, s)) out.push(m);
      bd[f] = bd[t]; bd[t] = cap;
    }
    return out;
  }

  // ================= 評估 =================
  const VAL = [0, 0, 110, 110, 430, 900, 450, 70]; // K,A,E,H,R,C,P（K 由將死判定處理）
  function evalBoard(bd, s) {
    let sc = 0;
    for (let i = 0; i < 90; i++) {
      const v = bd[i];
      if (!v) continue;
      const t = Math.abs(v), sign = v > 0 ? 1 : -1, r = ROW(i), c = COL(i);
      let pt = VAL[t];
      const adv = sign > 0 ? 9 - r : r; // 前進程度 0-9
      if (t === P) {
        if (crossed(r, sign)) pt = 130 + adv * 6 + (c >= 2 && c <= 6 ? 12 : 0);
        else pt = 70 + adv * 2;
      } else if (t === H) {
        pt += (4 - Math.abs(c - 4)) * 4 + (r >= 2 && r <= 7 ? 10 : 0);
      } else if (t === C) {
        const ek = findKing(bd, -sign);
        if (ek >= 0 && COL(ek) === c) pt += 18;
      } else if (t === R) {
        pt += (4 - Math.abs(c - 4)) * 2;
      } else if (t === K) {
        pt += (sign > 0 ? r === 9 : r === 0) ? 8 : 0;
      }
      sc += sign * pt;
    }
    return sc * s;
  }

  // ================= 搜尋 =================
  let nodes = 0, deadline = 0;
  const TIMEOUT = { t: 1 };
  const MATE = 100000;

  function orderMoves(bd, moves, best) {
    const score = (m) => {
      if (m === best) return 1e9;
      const cap = bd[m % 90];
      return cap ? 1000 + VAL[Math.abs(cap)] - VAL[Math.abs(bd[(m / 90) | 0])] / 10 : 0;
    };
    return moves.map((m) => [score(m), m]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  }

  // 靜態搜尋（吃子延伸）
  function quiesce(bd, s, alpha, beta) {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw TIMEOUT;
    const stand = evalBoard(bd, s);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    const caps = genMoves(bd, s).filter((m) => bd[m % 90]);
    caps.sort((a, b) => VAL[Math.abs(bd[b % 90])] - VAL[Math.abs(bd[a % 90])]);
    for (const m of caps) {
      const f = (m / 90) | 0, t = m % 90;
      if (Math.abs(bd[t]) === K) return MATE; // 能吃王 = 對方剛走了非法步
      const cap = bd[t];
      bd[t] = bd[f]; bd[f] = 0;
      const bad = inCheck(bd, s);
      let v;
      if (bad) v = -Infinity;
      else v = -quiesce(bd, -s, -beta, -alpha);
      bd[f] = bd[t]; bd[t] = cap;
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  function negamax(bd, s, depth, alpha, beta, ply) {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw TIMEOUT;
    if (depth <= 0) return quiesce(bd, s, alpha, beta);
    let moves = genMoves(bd, s);
    moves = orderMoves(bd, moves, 0);
    let any = false, best = -Infinity;
    for (const m of moves) {
      const f = (m / 90) | 0, t = m % 90;
      const cap = bd[t];
      bd[t] = bd[f]; bd[f] = 0;
      if (inCheck(bd, s)) { bd[f] = bd[t]; bd[t] = cap; continue; }
      any = true;
      const v = -negamax(bd, -s, depth - 1, -beta, -alpha, ply + 1);
      bd[f] = bd[t]; bd[t] = cap;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    if (!any) return -(MATE - ply); // 困斃或被將死皆輸
    return best;
  }

  const DIFFS = {
    easy: { maxDepth: 1, rand: 0.35, timeMs: 300, quiesce: false },
    mid: { maxDepth: 3, rand: 0.05, timeMs: 900 },
    hard: { maxDepth: 10, rand: 0, timeMs: 1500 },
  };

  function aiPick(bd, s, level) {
    const cfg = DIFFS[level];
    const legal = legalMoves(bd, s);
    if (!legal.length) return 0;
    if (legal.length === 1) return legal[0];
    if (cfg.rand && Math.random() < cfg.rand) {
      // 簡單模式的隨機步：避免白白送掉大子——只從不被立刻吃回的步中挑
      const safe = legal.filter((m) => {
        const f = (m / 90) | 0, t = m % 90;
        const cap = bd[t];
        bd[t] = bd[f]; bd[f] = 0;
        const revenge = attacked(bd, ROW(t), COL(t), -s) && VAL[Math.abs(bd[t])] >= 400;
        bd[f] = bd[t]; bd[t] = cap;
        return !revenge;
      });
      const pool = safe.length ? safe : legal;
      return pool[(Math.random() * pool.length) | 0];
    }

    nodes = 0; deadline = Date.now() + cfg.timeMs;
    const b2 = bd.slice();
    let best = legal[0];
    for (let d = 1; d <= cfg.maxDepth; d++) {
      try {
        let curBest = best, curV = -Infinity;
        for (const m of orderMoves(b2, legal, best)) {
          const f = (m / 90) | 0, t = m % 90;
          const cap = b2[t];
          b2[t] = b2[f]; b2[f] = 0;
          const v = -negamax(b2, -s, d - 1, -Infinity, curV === -Infinity ? Infinity : -curV, 1);
          b2[f] = b2[t]; b2[t] = cap;
          if (v > curV) { curV = v; curBest = m; }
        }
        best = curBest;
        if (curV >= MATE - 50) break; // 已找到將死
      } catch (e) { if (e !== TIMEOUT) throw e; break; }
    }
    return best;
  }

  // ================= 狀態 =================
  let board, player, history, lastMove, gameOver, selected, selDests, repCount;
  let mode = 'ai', diff = 'mid', humanSide = 0, mySide = 0; // 0 紅 1 黑
  let thinking = false, aiTimer = null;
  const sideOf = (pIdx) => (pIdx === 0 ? 1 : -1);

  board = newBoard(); player = 1; history = []; lastMove = 0; gameOver = true; selected = -1; selDests = []; repCount = new Map();

  // ================= 3D 渲染 =================
  const CELL = 2.05, PR = 0.85, PH = 0.52;
  const xz = (i) => [(COL(i) - 4) * CELL, (ROW(i) - 4.5) * CELL];
  const cam = E3D.createCamera({ yaw: 0, pitch: 0.6, dist: 30, target: [0, 0, -0.5], fov: 0.83, minDist: 13, maxDist: 50, minPitch: 0.22, maxPitch: 1.32 });
  let W2 = 0, H2 = 0, dirty = true;
  let moveAnim = null; // {from, to, t0, dur, piece, capture}

  function resize() { W2 = innerWidth; H2 = innerHeight; svg.setAttribute('viewBox', `0 0 ${W2} ${H2}`); dirty = true; }
  addEventListener('resize', resize); resize();

  const DEFS = `<defs>${E3D.DEFS}
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8a5a2b"/><stop offset=".5" stop-color="#6e451f"/><stop offset="1" stop-color="#4e2f13"/>
    </linearGradient>
    <linearGradient id="boardTop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d9b271"/><stop offset="1" stop-color="#b98f4e"/>
    </linearGradient>
    <linearGradient id="pieceSide" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9c6d33"/><stop offset="1" stop-color="#6b4415"/>
    </linearGradient>
    <radialGradient id="pieceTop" cx=".4" cy=".35" r=".9">
      <stop offset="0" stop-color="#efd49b"/><stop offset=".7" stop-color="#dcb877"/><stop offset="1" stop-color="#c39d5c"/>
    </radialGradient>
  </defs>`;

  function quadS(view, pts3, fill, extra) {
    const ps = pts3.map((p) => view.project(p));
    if (ps.some((p) => !p)) return '';
    return `<path d="${E3D.pathOf(ps, true)}" fill="${fill}"${extra || ''}/>`;
  }

  function line3(view, a, b, w, color) {
    const pa = view.project(a), pb = view.project(b);
    if (!pa || !pb) return '';
    return `<line x1="${E3D.fmt(pa.x)}" y1="${E3D.fmt(pa.y)}" x2="${E3D.fmt(pb.x)}" y2="${E3D.fmt(pb.y)}" stroke="${color || 'rgba(60,32,8,.85)'}" stroke-width="${w || 1.2}"/>`;
  }

  function render() {
    const view = E3D.makeView(cam, W2, H2);
    const BW = 4 * CELL, BH = 4.5 * CELL; // 半寬/半高
    const M = 1.2, T = 0.55;
    let s = DEFS;

    // 桌面
    s += quadS(view, [[-32, -T, -28], [32, -T, -28], [32, -T, 32], [-32, -T, 32]], 'url(#wood)');
    // 盤側
    const F = [BW + M, BH + M];
    const sides = [
      [[-F[0], -T, -F[1]], [F[0], -T, -F[1]], [F[0], 0, -F[1]], [-F[0], 0, -F[1]]],
      [[-F[0], -T, F[1]], [F[0], -T, F[1]], [F[0], 0, F[1]], [-F[0], 0, F[1]]],
      [[-F[0], -T, -F[1]], [-F[0], -T, F[1]], [-F[0], 0, F[1]], [-F[0], 0, -F[1]]],
      [[F[0], -T, -F[1]], [F[0], -T, F[1]], [F[0], 0, F[1]], [F[0], 0, -F[1]]],
    ].map((q) => {
      const c = q.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4, a[2] + p[2] / 4], [0, 0, 0]);
      const pr = view.project(c);
      return { q, d: pr ? pr.z : 1e9 };
    }).sort((a, b) => b.d - a.d);
    for (const sd of sides) s += quadS(view, sd.q, '#3a2410');
    // 盤面
    s += quadS(view, [[-F[0], 0, -F[1]], [F[0], 0, -F[1]], [F[0], 0, F[1]], [-F[0], 0, F[1]]], 'url(#boardTop)', ' stroke="#5f3d1c" stroke-width="1.4"');

    // 格線（y=0.02）：橫線 10 條全寬；直線分上下半（河界中斷），邊線全長
    const gy = 0.02;
    const X = (c) => (c - 4) * CELL, Z = (r) => (r - 4.5) * CELL;
    let g = '';
    for (let r = 0; r < 10; r++) g += line3(view, [X(0), gy, Z(r)], [X(8), gy, Z(r)]);
    for (let c = 0; c < 9; c++) {
      if (c === 0 || c === 8) g += line3(view, [X(c), gy, Z(0)], [X(c), gy, Z(9)]);
      else {
        g += line3(view, [X(c), gy, Z(0)], [X(c), gy, Z(4)]);
        g += line3(view, [X(c), gy, Z(5)], [X(c), gy, Z(9)]);
      }
    }
    // 九宮斜線
    g += line3(view, [X(3), gy, Z(0)], [X(5), gy, Z(2)]) + line3(view, [X(5), gy, Z(0)], [X(3), gy, Z(2)]);
    g += line3(view, [X(3), gy, Z(9)], [X(5), gy, Z(7)]) + line3(view, [X(5), gy, Z(9)], [X(3), gy, Z(7)]);
    s += g;

    // 河界文字
    const riv = view.project([0, 0.03, 0]);
    if (riv) {
      const rs = view.project([CELL * 2.2, 0.03, 0]);
      const fs = rs ? Math.hypot(rs.x - riv.x, rs.y - riv.y) * 0.32 : 20;
      s += `<text x="${E3D.fmt(riv.x - fs * 2.2)}" y="${E3D.fmt(riv.y + fs * 0.35)}" font-size="${E3D.fmt(fs)}" fill="rgba(80,46,12,.65)" font-family="'Noto Serif TC',serif" letter-spacing="${E3D.fmt(fs * 0.7)}">楚 河</text>`;
      s += `<text x="${E3D.fmt(riv.x + fs * 1.0)}" y="${E3D.fmt(riv.y + fs * 0.35)}" font-size="${E3D.fmt(fs)}" fill="rgba(80,46,12,.65)" font-family="'Noto Serif TC',serif" letter-spacing="${E3D.fmt(fs * 0.7)}">漢 界</text>`;
    }

    // 最後一手標記
    if (lastMove) {
      for (const i of [(lastMove / 90) | 0, lastMove % 90]) {
        const [x, z] = xz(i);
        const pts = E3D.circle3D(view, x, 0.03, z, 0.98, 4 + 12);
        if (pts.length > 2) s += `<path d="${E3D.pathOf(pts, true)}" fill="none" stroke="rgba(217,164,65,.7)" stroke-width="1.6" stroke-dasharray="4 3"/>`;
      }
    }

    // 可走提示
    if (selected >= 0) {
      for (const m of selDests) {
        const t = m % 90;
        const [x, z] = xz(t);
        if (board[t]) {
          const pts = E3D.circle3D(view, x, 0.04, z, PR + 0.24, 16);
          if (pts.length > 2) s += `<path d="${E3D.pathOf(pts, true)}" fill="none" stroke="#e05a3a" stroke-width="2.4"/>`;
        } else {
          const pts = E3D.circle3D(view, x, 0.04, z, 0.3, 10);
          if (pts.length > 2) s += `<path d="${E3D.pathOf(pts, true)}" fill="rgba(217,164,65,.5)"/>`;
        }
      }
    }

    // 棋子
    const now = performance.now();
    const items = [];
    for (let i = 0; i < 90; i++) {
      if (!board[i]) continue;
      if (moveAnim && i === moveAnim.to) continue; // 動畫中的子另外畫
      const [x, z] = xz(i);
      items.push({ x, z, v: board[i], lift: 0, sel: i === selected });
    }
    if (moveAnim) {
      const t = Math.min(1, (now - moveAnim.t0) / moveAnim.dur);
      const e = E3D.ease.inOutCubic(t);
      const [ax, az] = xz(moveAnim.from), [bx, bz] = xz(moveAnim.to);
      items.push({ x: ax + (bx - ax) * e, z: az + (bz - az) * e, v: moveAnim.piece, lift: Math.sin(t * Math.PI) * 1.1, sel: false });
    }
    for (const it of items) s += E3D.shadow(view, it.x, it.z, PR * 1.12, 0.42);
    items.sort((a, b) => {
      const pa = view.project([a.x, 0, a.z]), pb = view.project([b.x, 0, b.z]);
      return (pb ? pb.z : 0) - (pa ? pa.z : 0);
    });
    for (const it of items) {
      const cyl = E3D.cylinder(view, it.x, 0.02 + it.lift, it.z, PR, PH, {
        side: 'url(#pieceSide)', top: 'url(#pieceTop)', rim: it.sel ? '#d9a441' : '#6d4a1e',
      });
      if (!cyl) continue;
      s += cyl.svg;
      const red = it.v > 0;
      const t = Math.abs(it.v);
      const col = red ? '#b8321f' : '#26221c';
      const { x: tx, y: ty, rx, ry } = cyl.top;
      const squash = Math.max(0.25, Math.min(1, ry / rx));
      // 內圈 + 刻字（隨頂面橢圓壓扁）
      s += `<g transform="translate(${E3D.fmt(tx)} ${E3D.fmt(ty)}) scale(1 ${E3D.fmt(squash)})">`;
      s += `<circle cx="0" cy="0" r="${E3D.fmt(rx * 0.78)}" fill="none" stroke="${col}" stroke-width="${E3D.fmt(rx * 0.055)}" opacity=".85"/>`;
      s += `<text x="0" y="${E3D.fmt(rx * 0.38)}" text-anchor="middle" font-size="${E3D.fmt(rx * 1.05)}" font-weight="700" font-family="'Noto Serif TC','KaiTi','DFKai-SB',serif" fill="${col}">${NAME[red ? '1' : '-1'][t]}</text>`;
      s += `</g>`;
      if (it.sel) {
        const ring = E3D.circle3D(view, it.x, 0.03, it.z, PR + 0.3, 18);
        if (ring.length > 2) s += `<path d="${E3D.pathOf(ring, true)}" fill="none" stroke="#d9a441" stroke-width="2.4"/>`;
      }
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
    if (gameOver) return false;
    const pIdx = player > 0 ? 0 : 1;
    if (mode === '2p') return true;
    if (mode === 'ai') return pIdx === humanSide;
    if (mode === 'net') return pIdx === mySide;
    return false;
  }

  function statusText(extra) {
    let who;
    const pIdx = player > 0 ? 0 : 1;
    if (gameOver) who = '對局結束';
    else if (mode === 'net') who = pIdx === mySide ? `輪到你（${SIDE_NAME[player]}）` : `等待對方（${SIDE_NAME[player]}）…`;
    else who = `輪到 ${SIDE_NAME[player]}`;
    const chk = !gameOver && inCheck(board, player) ? '<b>將軍！</b>｜' : '';
    Shell.setStatus(`${extra ? extra + '｜' : ''}${chk}${who}`);
  }

  function posKey() { return String.fromCharCode(...board.map((v) => v + 8)) + (player > 0 ? 'r' : 'b'); }

  function doMove(m, animate) {
    const f = (m / 90) | 0, t = m % 90;
    history.push({ board: board.slice(), player, lastMove });
    const piece = board[f];
    board[t] = piece; board[f] = 0;
    lastMove = m;
    const mover = player;
    player = -player;
    selected = -1; selDests = [];
    if (animate) moveAnim = { from: f, to: t, t0: performance.now(), dur: 300, piece };
    dirty = true;

    // 終局判定
    const oppLegal = legalMoves(board, player);
    if (!oppLegal.length) { endGame(mover, inCheck(board, player) ? '將死' : '困斃'); return; }
    // 重複局面（同局面第三次出現判和）
    const key = posKey();
    const n = (repCount.get(key) || 0) + 1;
    repCount.set(key, n);
    if (n >= 3) { endGame(0, '重複局面'); return; }
    statusText();
    Shell.setUndoEnabled(history.length > 0 && (mode === '2p' || mode === 'ai') && !thinking);
    scheduleAI();
  }

  function endGame(winnerSide, how) {
    gameOver = true;
    statusText();
    let big, sub;
    if (winnerSide === 0) { big = '和棋'; sub = how; }
    else {
      const wIdx = winnerSide > 0 ? 0 : 1;
      sub = `${how}．${SIDE_NAME[winnerSide]}勝`;
      if (mode === 'ai') big = wIdx === humanSide ? '你贏了！' : '電腦獲勝';
      else if (mode === 'net') big = wIdx === mySide ? '你贏了！' : '對方獲勝';
      else big = `${SIDE_NAME[winnerSide]}獲勝`;
    }
    setTimeout(() => Shell.showBanner(big, sub), 600);
  }

  function isAITurn() {
    if (gameOver) return false;
    const pIdx = player > 0 ? 0 : 1;
    if (mode === 'aivai') return true;
    if (mode === 'ai') return pIdx !== humanSide;
    return false;
  }

  function scheduleAI() {
    if (!isAITurn() || thinking) return;
    if (mode === 'aivai' && Shell.isPaused()) return;
    thinking = true;
    Shell.setStatus(`電腦（${SIDE_NAME[player]}）思考中…`);
    Shell.setUndoEnabled(false);
    const delay = mode === 'aivai' ? Math.max(120, 700 / Shell.speed()) : 420;
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
      if (!isHumanTurn() || thinking) return;
      const view = E3D.makeView(cam, W2, H2);
      const hit = E3D.pickPlane(view, px, py, 0);
      if (!hit) return;
      const c = Math.round(hit[0] / CELL + 4), r = Math.round(hit[2] / CELL + 4.5);
      if (!inBoard(r, c)) { selected = -1; selDests = []; dirty = true; return; }
      const i = idx(r, c);
      if (board[i] && (board[i] > 0) === (player > 0)) {
        selected = i;
        selDests = legalMoves(board, player).filter((m) => ((m / 90) | 0) === i);
        dirty = true;
        return;
      }
      if (selected >= 0) {
        const m = selDests.find((mm) => mm % 90 === i);
        if (m) {
          doMove(m, true);
          if (mode === 'net') Net.send({ type: 'move', m });
          return;
        }
      }
      selected = -1; selDests = []; dirty = true;
    },
  });

  // ================= Shell / 模式 =================
  function resetView() {
    const flip = (mode === 'ai' && humanSide === 1) || (mode === 'net' && mySide === 1);
    cam.yaw = flip ? Math.PI : 0;
    cam.pitch = 0.6; cam.dist = 30;
    dirty = true;
  }

  function startGame(cfg) {
    mode = cfg.mode; diff = cfg.diff; humanSide = cfg.side || 0;
    if (mode === 'net') mySide = cfg.netRole === 'host' ? 0 : 1;
    clearTimeout(aiTimer); thinking = false; moveAnim = null;
    board = newBoard(); player = 1; history = []; lastMove = 0; gameOver = false;
    selected = -1; selDests = []; repCount = new Map();
    resetView();
    statusText();
    Shell.setUndoEnabled(false);
    dirty = true;
    scheduleAI();
  }

  Net.onMessage((msg) => {
    if (msg.type === 'move' && mode === 'net' && !gameOver && (player > 0 ? 0 : 1) !== mySide) {
      if (legalMoves(board, player).includes(msg.m)) doMove(msg.m, true);
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
    xz, idx,
    state: () => ({ board: Array.from(board), player, gameOver, thinking, mode, histLen: history.length, selected }),
    rules: { newBoard, genMoves, legalMoves, inCheck, attacked, aiPick, evalBoard, DIFFS, findKing },
  };

  Shell.init({
    title: '3D 象棋',
    sideLabels: ['紅方（先手）', '黑方（後手）'],
    hint: '拖曳環顧視角．滾輪/雙指縮放．點選棋子再點目的地',
    rulesHtml: '標準象棋規則：將死或困斃判負，同一局面重複三次判和。',
    defaultMode: 'ai',
    onStart: startGame,
    onUndo: () => {
      if (thinking || !history.length) return;
      moveAnim = null;
      if (mode === 'ai') {
        while (history.length) {
          const h = history.pop();
          board = h.board; player = h.player; lastMove = h.lastMove;
          if ((player > 0 ? 0 : 1) === humanSide) break;
        }
      } else {
        const h = history.pop();
        board = h.board; player = h.player; lastMove = h.lastMove;
      }
      gameOver = false; selected = -1; selDests = [];
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
