/* cards3d.js — 3D 平放卡牌繪製輔助（UNO 與撲克共用）
   卡牌平躺在桌面 y=0，中心 (cx,cz)，寬 w（沿 x）、深 d（沿 z）；rot=0 或 90（在桌面內旋轉） */
(function () {
  'use strict';
  const F = E3D.fmt;

  // 回傳卡牌四角世界座標（依 rot）
  function corners(cx, cz, w, d, rot) {
    const hw = w / 2, hd = d / 2;
    let pts;
    if (rot === 90) pts = [[-hd, hw], [hd, hw], [hd, -hw], [-hd, -hw]];
    else pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    return pts.map(([dx, dz]) => [cx + dx, cz + dz]);
  }

  // 命中測試：世界 (x,z) 是否落在卡牌矩形內
  function hit(cx, cz, w, d, rot, x, z) {
    const ww = rot === 90 ? d : w, dd = rot === 90 ? w : d;
    return Math.abs(x - cx) <= ww / 2 && Math.abs(z - cz) <= dd / 2;
  }

  // 繪製一張卡牌（平放），face=null 為牌背
  // face: {bg, ink, big, small, corner} 由各遊戲提供
  function draw(view, cx, cz, w, d, rot, face, opts) {
    opts = opts || {};
    const y = opts.y || 0.02;
    const lift = opts.lift || 0;
    const cs = corners(cx, cz, w, d, rot).map(([x, z]) => view.project([x, y + lift, z]));
    if (cs.some((p) => !p)) return null;
    const center = view.project([cx, y + lift, cz]);
    const depth = center ? center.z : 0;
    let s = '';
    // 陰影
    if (opts.shadow !== false) s += E3D.shadow(view, cx, cz, Math.max(w, d) * 0.5, 0.32);
    // 底板（圓角以內縮多邊形近似）
    const path = E3D.pathOf(cs, true);
    if (!face) {
      // 牌背
      s += `<path d="${path}" fill="#7a2230" stroke="#3a0f16" stroke-width="1"/>`;
      // 內框菱形
      const inner = corners(cx, cz, w * 0.62, d * 0.62, rot).map(([x, z]) => view.project([x, y + lift, z]));
      if (!inner.some((p) => !p)) s += `<path d="${E3D.pathOf(inner, true)}" fill="none" stroke="#e0b0b8" stroke-width="1.4" opacity=".8"/>`;
      if (center) s += `<text x="${F(center.x)}" y="${F(center.y + center.s * 0.28)}" font-size="${F(center.s * 0.9)}" fill="#e8c0c8" text-anchor="middle" font-family="serif" font-weight="700" transform="rotate(${opts.textRot || 0} ${F(center.x)} ${F(center.y)})">${opts.backGlyph || '★'}</text>`;
      return { svg: s, depth, center };
    }
    s += `<path d="${path}" fill="${face.bg}" stroke="${face.edge || 'rgba(0,0,0,.35)'}" stroke-width="1.1"/>`;
    // 中央白底橢圓（UNO 風）或留白
    if (face.oval) {
      const ov = E3D.circle3D(view, cx, y + lift + 0.01, cz, Math.min(w, d) * 0.4, 16);
      // 橢圓需照卡牌比例，用縮放的多邊形
      const ovp = corners(cx, cz, w * 0.7, d * 0.82, rot);
      // 用中心 + 半徑近似橢圓：投影 12 點
      const el = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const rx = (rot === 90 ? d : w) * 0.36, rz = (rot === 90 ? w : d) * 0.42;
        const p = view.project([cx + Math.cos(a) * rx, y + lift + 0.01, cz + Math.sin(a) * rz]);
        if (p) el.push(p);
      }
      if (el.length > 3) s += `<path d="${E3D.pathOf(el, true)}" fill="${face.ovalFill || 'rgba(255,255,255,.92)'}"/>`;
    }
    // 中央大字/符號
    if (center && face.big != null) {
      s += `<text x="${F(center.x)}" y="${F(center.y + center.s * (face.bigDy != null ? face.bigDy : 0.34))}" font-size="${F(center.s * (face.bigSize || 1.0))}" fill="${face.ink}" text-anchor="middle" font-family="${face.font || "'Arial Black',Arial,sans-serif'"}" font-weight="900" transform="rotate(${opts.textRot || 0} ${F(center.x)} ${F(center.y)})">${face.big}</text>`;
    }
    // 角落小字
    if (face.corner != null) {
      const cor = corners(cx, cz, w * 0.72, d * 0.78, rot);
      for (const k of [0, 2]) {
        const p = view.project([cor[k][0], y + lift + 0.01, cor[k][1]]);
        if (p) s += `<text x="${F(p.x)}" y="${F(p.y + p.s * 0.16)}" font-size="${F(p.s * 0.32)}" fill="${face.cornerInk || face.ink}" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" transform="rotate(${opts.textRot || 0} ${F(p.x)} ${F(p.y)})">${face.corner}</text>`;
      }
    }
    return { svg: s, depth, center };
  }

  window.Cards3D = { draw, hit, corners };
})();
