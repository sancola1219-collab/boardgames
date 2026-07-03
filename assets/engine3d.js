/* engine3d.js — 共用 3D 引擎：透視相機、拖曳環顧、縮放、點擊拾取、SVG 繪製輔助
   零依賴。世界座標：y 向上，棋盤放在 y=0 平面。 */
(function () {
  'use strict';

  // ---------- 向量 ----------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // ---------- 相機 ----------
  function createCamera(opts) {
    return Object.assign({
      yaw: 0,            // 繞 y 軸（0 = 從 +z 看向原點）
      pitch: 0.5,        // 仰角（弧度，越大越俯視）
      dist: 24,
      target: [0, 0.5, 0],
      fov: 0.9,
      minPitch: 0.16, maxPitch: 1.35,
      minDist: 8, maxDist: 60,
      minYaw: -Infinity, maxYaw: Infinity,
    }, opts || {});
  }

  function camPos(cam) {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    return [
      cam.target[0] + cam.dist * cp * Math.sin(cam.yaw),
      cam.target[1] + cam.dist * sp,
      cam.target[2] + cam.dist * cp * Math.cos(cam.yaw),
    ];
  }

  // 建立當前視圖：project(p)->螢幕座標、ray(px,py)->射線
  function makeView(cam, w, h) {
    const eye = camPos(cam);
    const f = norm(sub(cam.target, eye));
    let r = cross(f, [0, 1, 0]);
    if (len(r) < 1e-6) r = [1, 0, 0];
    r = norm(r);
    const u = cross(r, f);
    const focal = (Math.min(w, h) / 2) / Math.tan(cam.fov / 2);
    return {
      eye, w, h, focal, cam,
      project(p) {
        const d = sub(p, eye);
        const z = dot(d, f);
        if (z < 0.05) return null;
        const s = focal / z;
        return { x: w / 2 + dot(d, r) * s, y: h / 2 - dot(d, u) * s, z, s };
      },
      ray(px, py) {
        const x = px - w / 2, y = h / 2 - py;
        return { o: eye, d: norm(add(add(mul(r, x), mul(u, -(-y))), mul(f, focal))) };
      },
    };
  }

  // 射線與水平面 y=planeY 交點，回傳世界座標或 null
  function pickPlane(view, px, py, planeY) {
    const { o, d } = view.ray(px, py);
    if (Math.abs(d[1]) < 1e-8) return null;
    const t = ((planeY || 0) - o[1]) / d[1];
    if (t <= 0) return null;
    return [o[0] + d[0] * t, planeY || 0, o[2] + d[2] * t];
  }

  // ---------- 互動控制：拖曳環顧、滾輪縮放、雙指縮放、點擊 ----------
  function attachControls(el, cam, handlers) {
    const H = Object.assign({ onChange() {}, onTap() {}, tapDist: 7 }, handlers || {});
    const pointers = new Map();
    let dragging = false, moved = 0, sx = 0, sy = 0, lastX = 0, lastY = 0, pinchD = 0;

    const clamp = () => {
      cam.pitch = Math.min(cam.maxPitch, Math.max(cam.minPitch, cam.pitch));
      cam.dist = Math.min(cam.maxDist, Math.max(cam.minDist, cam.dist));
      cam.yaw = Math.min(cam.maxYaw, Math.max(cam.minYaw, cam.yaw));
    };

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 1) {
        dragging = true; moved = 0;
        sx = lastX = e.clientX; sy = lastY = e.clientY;
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        pinchD = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      }
      e.preventDefault();
    });

    el.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
        if (pinchD > 0) { cam.dist *= pinchD / d; clamp(); H.onChange(); }
        pinchD = d; moved = 99;
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > H.tapDist) {
        cam.yaw -= dx * 0.0055;
        cam.pitch += dy * 0.005;
        clamp(); H.onChange();
      }
    });

    const up = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchD = 0;
      if (dragging && pointers.size === 0) {
        dragging = false;
        if (moved <= H.tapDist) {
          const rect = el.getBoundingClientRect();
          H.onTap(sx - rect.left, sy - rect.top);
        }
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      cam.dist *= Math.pow(1.1, e.deltaY / 100);
      clamp(); H.onChange();
    }, { passive: false });

    el.style.touchAction = 'none';
  }

  // ---------- SVG 字串繪製輔助 ----------
  const fmt = (n) => Math.round(n * 100) / 100;

  function pathOf(pts, close) {
    if (!pts.length) return '';
    let s = 'M' + fmt(pts[0].x) + ' ' + fmt(pts[0].y);
    for (let i = 1; i < pts.length; i++) s += 'L' + fmt(pts[i].x) + ' ' + fmt(pts[i].y);
    return s + (close ? 'Z' : '');
  }

  // 水平圓 → 投影後的點陣列
  function circle3D(view, cx, cy, cz, r, segs) {
    const n = segs || 20, out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = view.project([cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r]);
      if (p) out.push(p);
    }
    return out;
  }

  // 凸包（Andrew monotone chain），輸入/輸出 {x,y}
  function hull(points) {
    const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return pts;
    const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [], upper = [];
    for (const p of pts) {
      while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // 柔和陰影（貼地橢圓）
  function shadow(view, x, z, r, opacity) {
    const pts = circle3D(view, x, 0.015, z, r, 18);
    if (pts.length < 3) return '';
    return `<path d="${pathOf(pts, true)}" fill="url(#e3dShadow)" opacity="${opacity == null ? 0.5 : opacity}"/>`;
  }

  /* 棋石（扁球，圍棋/黑白棋/彈珠風格）
     opts: {fill(漸層id或色), rim(邊色), h(石高), squash, extra(附加svg)} */
  function stone(view, x, yBase, z, r, opts) {
    const o = Object.assign({ h: r * 0.62, fill: '#222', rim: 'rgba(0,0,0,.35)', hi: true }, opts || {});
    const cy = yBase + o.h / 2;
    const pc = view.project([x, cy, z]);
    if (!pc) return '';
    // 螢幕半徑：取相機右方向上的位移
    const eye = view.eye;
    const rightWorld = norm(cross(sub([x, cy, z], eye), [0, 1, 0]));
    const pr = view.project(add([x, cy, z], mul(rightWorld, r)));
    if (!pr) return '';
    const rx = Math.hypot(pr.x - pc.x, pr.y - pc.y);
    const pTop = view.project([x, yBase + o.h, z]);
    const pBot = view.project([x, yBase, z]);
    const vert = pTop && pBot ? Math.hypot(pTop.x - pBot.x, pTop.y - pBot.y) / 2 : rx * 0.4;
    const ry = Math.max(rx * 0.34, Math.min(rx, vert + rx * 0.32));
    let s = `<ellipse cx="${fmt(pc.x)}" cy="${fmt(pc.y)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${o.fill}" stroke="${o.rim}" stroke-width="${fmt(rx * 0.03)}"/>`;
    if (o.hi) {
      s += `<ellipse cx="${fmt(pc.x - rx * 0.3)}" cy="${fmt(pc.y - ry * 0.42)}" rx="${fmt(rx * 0.34)}" ry="${fmt(ry * 0.22)}" fill="rgba(255,255,255,${o.hiA == null ? 0.35 : o.hiA})"/>`;
    }
    return { svg: s, cx: pc.x, cy: pc.y, rx, ry, depth: pc.z };
  }

  /* 圓柱（象棋棋子）：回傳 {svg, top:{x,y,rx,ry}, depth} */
  function cylinder(view, x, yBase, z, r, h, opts) {
    const o = Object.assign({ side: '#a8763e', sideDark: '#7a5127', top: '#c99a5b', rim: '#5f3d1c' }, opts || {});
    const bot = circle3D(view, x, yBase, z, r, 22);
    const top = circle3D(view, x, yBase + h, z, r, 22);
    if (bot.length < 3 || top.length < 3) return null;
    const hl = hull(bot.concat(top));
    const pc = view.project([x, yBase + h, z]);
    const pcm = view.project([x, yBase + h / 2, z]);
    let s = `<path d="${pathOf(hl, true)}" fill="${o.side}"/>`;
    s += `<path d="${pathOf(top, true)}" fill="${o.top}" stroke="${o.rim}" stroke-width="${fmt((pc ? pc.s : 1) * r * 0.06)}"/>`;
    // 頂面橢圓幾何（供刻字用）
    const eye = view.eye;
    const rightWorld = norm(cross(sub([x, yBase + h, z], eye), [0, 1, 0]));
    const pr = view.project(add([x, yBase + h, z], mul(rightWorld, r)));
    const rx = pr && pc ? Math.hypot(pr.x - pc.x, pr.y - pc.y) : 10;
    let minY = 1e9, maxY = -1e9;
    for (const p of top) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    const ry = (maxY - minY) / 2;
    return { svg: s, top: { x: pc.x, y: pc.y, rx, ry }, depth: pcm ? pcm.z : (pc ? pc.z : 0) };
  }

  // 共用 defs（陰影漸層）
  const DEFS = `<radialGradient id="e3dShadow"><stop offset="0%" stop-color="rgba(0,0,0,.55)"/><stop offset="70%" stop-color="rgba(0,0,0,.28)"/><stop offset="100%" stop-color="rgba(0,0,0,0)"/></radialGradient>`;

  // ---------- 緩動 ----------
  const ease = {
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outBack: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outBounceSmall: (t) => 1 - Math.abs(Math.cos(t * Math.PI * 1.5)) * (1 - t),
  };

  window.E3D = {
    createCamera, camPos, makeView, pickPlane, attachControls,
    pathOf, circle3D, hull, shadow, stone, cylinder,
    DEFS, ease, fmt,
    vec: { sub, add, mul, dot, cross, len, norm },
  };
})();
