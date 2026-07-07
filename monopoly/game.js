/* 3D 大富翁 — 28 格台灣主題、2-4 人（各可人類/電腦）、骰子/移動動畫 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const svg = $('scene');

  // ================= 棋盤資料 =================
  const G = { A: '#c85a4f', B: '#e2934e', C: '#e2c14e', D: '#7cc576', E: '#4fb0b0', F: '#5a8fe0', G2: '#a06fd0' };
  // type: start/prop/chance/fate/tax/jail/parking/gojail
  const TILES = [
    { t: 'start', name: '起點' },
    { t: 'prop', name: '台北', grp: 'A', price: 1200 },
    { t: 'fate', name: '命運' },
    { t: 'prop', name: '新北', grp: 'A', price: 1400 },
    { t: 'tax', name: '所得稅', amount: 1500 },
    { t: 'prop', name: '基隆', grp: 'B', price: 1600 },
    { t: 'chance', name: '機會' },
    { t: 'jail', name: '探監' },
    { t: 'prop', name: '桃園', grp: 'B', price: 1800 },
    { t: 'prop', name: '新竹', grp: 'C', price: 2000 },
    { t: 'fate', name: '命運' },
    { t: 'prop', name: '苗栗', grp: 'C', price: 2200 },
    { t: 'prop', name: '台中', grp: 'C', price: 2600 },
    { t: 'chance', name: '機會' },
    { t: 'parking', name: '免費停車' },
    { t: 'prop', name: '彰化', grp: 'D', price: 2800 },
    { t: 'prop', name: '南投', grp: 'D', price: 3000 },
    { t: 'fate', name: '命運' },
    { t: 'prop', name: '雲林', grp: 'E', price: 3200 },
    { t: 'tax', name: '奢侈稅', amount: 2000 },
    { t: 'prop', name: '嘉義', grp: 'E', price: 3400 },
    { t: 'gojail', name: '入獄' },
    { t: 'prop', name: '台南', grp: 'F', price: 3800 },
    { t: 'chance', name: '機會' },
    { t: 'prop', name: '高雄', grp: 'F', price: 4200 },
    { t: 'prop', name: '屏東', grp: 'G2', price: 4600 },
    { t: 'fate', name: '命運' },
    { t: 'prop', name: '花蓮', grp: 'G2', price: 5200 },
  ];
  const N = TILES.length; // 28
  const RENT_MULT = [1, 3, 6, 11, 18]; // 0~4 房
  const houseCost = (price) => Math.round(price / 2 / 100) * 100;
  const baseRent = (price) => Math.round(price * 0.12 / 10) * 10;
  const SALARY = 2000, START_CASH = 15000, JAIL_FINE = 1000;
  const PCOL = ['#c85a4f', '#e2b93b', '#7cc576', '#5a8fe0'];
  const PNAME = ['紅', '黃', '綠', '藍'];

  // ================= 狀態 =================
  let players, cur, owner, houses, over, winner, diff, phase, dice, doublesRun, turnCount;
  const TURN_CAP = 240; // 安全上限（總步數）：達到則資產最多者勝
  // owner[tileIdx] = playerIdx or -1；houses[tileIdx]=0..4
  let aiTimer = null;
  const fate = [], chance = [];
  let moveAnim = null; // {pi, from, steps, i, t0}
  let diceAnim = null;

  function buildCards() {
    fate.length = 0; chance.length = 0;
    const F = [
      { text: '中發票中獎，獲得 $2000', money: 2000 },
      { text: '繳交健保費，支付 $1200', money: -1200 },
      { text: '生日快樂！每位玩家送你 $500', collect: 500 },
      { text: '路邊撿到 $800', money: 800 },
      { text: '汽車故障維修，支付 $1000', money: -1000 },
      { text: '股票大漲，獲得 $3000', money: 3000 },
      { text: '違規停車罰款 $600', money: -600 },
      { text: '前進到起點，領 $2000', goto: 0 },
    ];
    const C = [
      { text: '搭高鐵前進三格', move: 3 },
      { text: '被送進監獄！', jail: true },
      { text: '退稅，獲得 $1500', money: 1500 },
      { text: '請客吃飯，支付 $900', money: -900 },
      { text: '中樂透，獲得 $4000', money: 4000 },
      { text: '倒退兩格', move: -2 },
      { text: '慈善捐款 $1000', money: -1000 },
      { text: '公司分紅 $2500', money: 2500 },
    ];
    for (const x of F) fate.push(x);
    for (const x of C) chance.push(x);
    shuffle(fate); shuffle(chance);
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function reset(cfg) {
    diff = cfg.diff || 'normal';
    players = cfg.seats.map((s, i) => ({ ai: s === 'ai', name: (s === 'ai' ? '電腦' : '玩家') + (i + 1), col: PCOL[i], pos: 0, cash: START_CASH, jail: 0, bankrupt: false }));
    owner = new Array(N).fill(-1); houses = new Array(N).fill(0);
    cur = 0; over = false; winner = -1; phase = 'roll'; dice = [1, 1]; doublesRun = 0; turnCount = 0;
    moveAnim = null; diceAnim = null;
    buildCards();
    status();
    dirty = true;
    beginTurn();
  }

  // ================= 幾何 =================
  const BS = 9, TILE = (2 * BS) / 7;
  function tileCenter(idx) {
    // 0..6 底邊(z=BS,x:BS→-BS)；7..13 左(x=-BS,z:BS→-BS)；14..20 上(z=-BS,x:-BS→BS)；21..27 右(x=BS,z:-BS→BS)
    const side = Math.floor(idx / 7), k = idx % 7, f = k / 7;
    if (side === 0) return [BS - 2 * BS * f, BS];
    if (side === 1) return [-BS, BS - 2 * BS * f];
    if (side === 2) return [-BS + 2 * BS * f, -BS];
    return [BS, -BS + 2 * BS * f];
  }
  function tokenPos(pi, pos) {
    const [x, z] = tileCenter(pos);
    const ox = (pi % 2) * 0.7 - 0.35, oz = (Math.floor(pi / 2)) * 0.7 - 0.35;
    return [x + ox, z + oz];
  }

  // ================= 渲染 =================
  const cam = E3D.createCamera({ yaw: 0, pitch: 0.86, dist: 34, target: [0, 0, 0], fov: 0.8, minDist: 16, maxDist: 56, minPitch: 0.3, maxPitch: 1.4 });
  let W2 = 0, H2 = 0, dirty = true;
  function resize() { W2 = innerWidth; H2 = innerHeight; svg.setAttribute('viewBox', `0 0 ${W2} ${H2}`); dirty = true; }
  addEventListener('resize', resize); resize();

  const DEFS = `<defs>${E3D.DEFS}
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6e451f"/><stop offset="1" stop-color="#3c250e"/></linearGradient>
    <linearGradient id="boardBase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9dcc0"/><stop offset="1" stop-color="#d3c19a"/></linearGradient>
  </defs>`;
  function quadS(view, pts3, fill, extra) {
    const ps = pts3.map((p) => view.project(p)); if (ps.some((p) => !p)) return '';
    return `<path d="${E3D.pathOf(ps, true)}" fill="${fill}"${extra || ''}/>`;
  }
  const grpColor = (g) => G[g] || '#999';

  function drawDie(view, cx, cz, val, spin) {
    const sz = 1.0;
    const b = E3D.box(view, cx, 0.1, cz, sz, sz, sz, { top: '#f4efe4', side: '#ddd4c2', dark: '#c4baa4', stroke: 'rgba(80,60,30,.4)' });
    if (!b) return null;
    // 頂面 pip
    const layout = {
      1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]],
      4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
      6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
    }[val] || [[0, 0]];
    let pips = '';
    for (const [px, pz] of layout) {
      const p = view.project([cx + px * sz * 0.28, 0.1 + sz + 0.01, cz + pz * sz * 0.28]);
      if (p) pips += `<circle cx="${E3D.fmt(p.x)}" cy="${E3D.fmt(p.y)}" r="${E3D.fmt(p.s * 0.09)}" fill="#33241a"/>`;
    }
    return { svg: b.svg + pips, depth: b.depth };
  }

  function render() {
    const view = E3D.makeView(cam, W2, H2);
    let s = DEFS;
    s += quadS(view, [[-34, -0.5, -30], [34, -0.5, -30], [34, -0.5, 34], [-34, -0.5, 34]], 'url(#wood)');
    // 板底
    s += quadS(view, [[-BS - TILE / 2, 0, -BS - TILE / 2], [BS + TILE / 2, 0, -BS - TILE / 2], [BS + TILE / 2, 0, BS + TILE / 2], [-BS - TILE / 2, 0, BS + TILE / 2]], 'url(#boardBase)', ' stroke="#8a6a3a" stroke-width="1.5"');
    // 中央
    const cc = view.project([0, 0.02, 0]);
    if (cc) s += `<text x="${E3D.fmt(cc.x)}" y="${E3D.fmt(cc.y)}" font-size="${E3D.fmt(cc.s * 2.4)}" fill="rgba(120,90,50,.35)" text-anchor="middle" font-family="'Noto Serif TC',serif" font-weight="900" transform="rotate(-30 ${E3D.fmt(cc.x)} ${E3D.fmt(cc.y)})">大富翁</text>`;

    const items = [];
    // 格子
    for (let i = 0; i < N; i++) {
      const [x, z] = tileCenter(i);
      const T = TILES[i];
      const corner = i % 7 === 0;
      const w = corner ? TILE * 1.02 : TILE * 0.94, d = w;
      let topCol = '#f2ead6';
      if (T.t === 'prop') topCol = '#efe7d2';
      else if (T.t === 'chance') topCol = '#dbe8f2';
      else if (T.t === 'fate') topCol = '#f2e6db';
      else if (T.t === 'tax') topCol = '#e8dede';
      else if (corner) topCol = '#d8c9a6';
      const b = E3D.box(view, x, 0.02, z, w, 0.18, d, { top: topCol, side: '#c9b98f', dark: '#b0a078', stroke: 'rgba(90,70,40,.5)' });
      if (!b) continue;
      let extra = '';
      // 產權色帶
      if (T.t === 'prop') {
        const bandZ = z + (z > 0 ? -1 : z < 0 ? 1 : 0) * 0;
        const band = E3D.box(view, x, 0.21, z, w * 0.8, 0.06, d * 0.24, { top: grpColor(T.grp), side: grpColor(T.grp), dark: grpColor(T.grp), stroke: 'rgba(0,0,0,.2)' });
        if (band) extra += band.svg;
      }
      // 名稱與價格/房子
      const pc = view.project([x, 0.24, z]);
      if (pc) {
        extra += `<text x="${E3D.fmt(pc.x)}" y="${E3D.fmt(pc.y + pc.s * 0.1)}" font-size="${E3D.fmt(pc.s * 0.5)}" fill="#4a3420" text-anchor="middle" font-family="'Noto Sans TC',sans-serif" font-weight="700">${T.name}</text>`;
        if (T.t === 'prop') {
          const own = owner[i];
          if (own < 0) extra += `<text x="${E3D.fmt(pc.x)}" y="${E3D.fmt(pc.y + pc.s * 0.55)}" font-size="${E3D.fmt(pc.s * 0.36)}" fill="#6a5232" text-anchor="middle" font-family="sans-serif">$${T.price}</text>`;
          else extra += `<text x="${E3D.fmt(pc.x)}" y="${E3D.fmt(pc.y + pc.s * 0.55)}" font-size="${E3D.fmt(pc.s * 0.36)}" fill="${PCOL[own]}" text-anchor="middle" font-family="sans-serif" font-weight="700">${PNAME[own]}${'●'.repeat(houses[i])}</text>`;
        }
      }
      items.push({ svg: b.svg + extra, depth: b.depth });
    }

    // 玩家棋子
    for (let pi = 0; pi < players.length; pi++) {
      const p = players[pi];
      if (p.bankrupt) continue;
      let pos = p.pos, lift = 0;
      let [tx, tz] = tokenPos(pi, pos);
      if (moveAnim && moveAnim.pi === pi) {
        const prog = moveAnim.i + moveAnim.frac;
        const curPos = (moveAnim.from + Math.floor(prog)) % N;
        const nextPos = (curPos + 1) % N;
        const f = prog - Math.floor(prog);
        const a = tokenPos(pi, curPos), b = tokenPos(pi, nextPos);
        tx = a[0] + (b[0] - a[0]) * f; tz = a[1] + (b[1] - a[1]) * f;
        lift = Math.sin(f * Math.PI) * 0.8;
      }
      items.push({ svg: E3D.shadow(view, tx, tz, 0.5, 0.4), depth: 9000 });
      const st = E3D.stone(view, tx, 0.22 + lift, tz, 0.42, { h: 0.7, fill: p.col, rim: 'rgba(0,0,0,.45)', hiA: 0.5 });
      if (st) items.push({ svg: st.svg, depth: st.depth });
    }

    // 骰子
    const dpos = [[-1.1, 1.6], [1.1, 1.6]];
    for (let k = 0; k < 2; k++) {
      let val = dice[k];
      if (diceAnim) { const t = (performance.now() - diceAnim.t0) / diceAnim.dur; if (t < 1) val = 1 + (((diceAnim.seed + k * 7 + Math.floor(t * 12)) % 6)); }
      const die = drawDie(view, dpos[k][0], dpos[k][1], val);
      if (die) items.push({ svg: die.svg, depth: die.depth - 100 });
    }

    items.sort((a, b) => b.depth - a.depth);
    for (const it of items) s += it.svg;
    svg.innerHTML = s;
  }

  function tick() {
    if (W2 !== innerWidth || H2 !== innerHeight) resize();
    const now = performance.now();
    // 骰子動畫
    if (diceAnim && now - diceAnim.t0 > diceAnim.dur) { diceAnim = null; dirty = true; }
    // 移動動畫
    if (moveAnim) {
      const el = now - moveAnim.t0;
      const perStep = 180;
      moveAnim.i = Math.floor(el / perStep);
      moveAnim.frac = (el % perStep) / perStep;
      if (moveAnim.i >= moveAnim.steps) { const done = moveAnim.done; moveAnim = null; dirty = true; if (done) done(); }
      dirty = true;
    }
    if (dirty || diceAnim) { try { render(); } catch (e) { console.error('render', e); } dirty = !!(diceAnim || moveAnim); }
    schedule();
  }
  function schedule() { if (document.hidden) setTimeout(tick, 200); else requestAnimationFrame(tick); }
  schedule();

  // ================= 流程 =================
  function status(msg) {
    if (over) { Shell.setStatus(`${players[winner].name} 獲勝！`); }
    else Shell.setStatus(`${msg ? msg + '｜' : ''}輪到 <b style="color:${players[cur].col}">${players[cur].name}</b>`);
    renderPanel();
  }
  function renderPanel() {
    $('panel').innerHTML = players.map((p, i) => {
      const props = owner.map((o, t) => o === i ? TILES[t].name + (houses[t] ? '·' + houses[t] : '') : null).filter(Boolean);
      return `<div class="pl ${i === cur && !over ? 'cur' : ''} ${p.bankrupt ? 'dead' : ''}"><span class="dot" style="background:${p.col}"></span>${p.name}${p.jail ? '🔒' : ''}　<span class="money">$${p.cash}</span><div class="props">${props.join('、') || '（無地產）'}</div></div>`;
    }).join('');
  }

  const alive = () => players.filter((p) => !p.bankrupt);
  function netWorth(p) {
    let w = p.cash;
    const pi = players.indexOf(p);
    for (let i = 0; i < N; i++) if (owner[i] === pi) w += TILES[i].price + houses[i] * houseCost(TILES[i].price);
    return w;
  }
  function endByWealth() {
    over = true;
    const av = alive();
    let best = av[0];
    for (const p of av) if (netWorth(p) > netWorth(best)) best = p;
    winner = players.indexOf(best);
    status(); setButtons(null);
    setTimeout(() => Shell.showBanner(players[winner].name + ' 獲勝！', '資產最多（$' + netWorth(best) + '）'), 500);
  }
  function nextPlayer() {
    if (doublesRun > 0 && !players[cur].bankrupt && !players[cur].jail) { /* 連莊：同一人 */ }
    else { do { cur = (cur + 1) % players.length; } while (players[cur].bankrupt); }
  }

  function beginTurn() {
    if (over) return;
    phase = 'roll';
    const p = players[cur];
    if (p.jail) { jailTurn(); return; }
    if (p.ai) { setButtons(null); aiTimer = setTimeout(rollDice, 700); }
    else setButtons([{ label: '🎲 擲骰', primary: true, on: rollDice }]);
    status();
  }

  function rollDice() {
    if (phase !== 'roll') return;
    phase = 'moving';
    setButtons(null);
    const d1 = 1 + (Math.random() * 6 | 0), d2 = 1 + (Math.random() * 6 | 0);
    diceAnim = { t0: performance.now(), dur: 600, seed: (Math.random() * 6) | 0 };
    aiTimer = setTimeout(() => {
      dice = [d1, d2];
      const isDouble = d1 === d2;
      doublesRun = isDouble ? doublesRun + 1 : 0;
      if (isDouble && doublesRun >= 3) { goToJail(players[cur]); endTurn(); return; }
      const steps = d1 + d2;
      const p = players[cur];
      const from = p.pos;
      moveAnim = { pi: cur, from, steps, i: 0, frac: 0, t0: performance.now(), done: () => {
        // 經過起點
        p.pos = (from + steps) % N;
        if (from + steps >= N) gain(p, SALARY, '經過起點');
        landOn(p.pos);
      } };
    }, 650);
  }

  function jailTurn() {
    const p = players[cur];
    p.jail++;
    const tryRoll = () => {
      const d1 = 1 + (Math.random() * 6 | 0), d2 = 1 + (Math.random() * 6 | 0);
      dice = [d1, d2];
      if (d1 === d2) { p.jail = 0; flash(`${p.name} 擲出雙${d1}，出獄！`); moveSteps(p, d1 + d2); }
      else if (p.jail >= 3) { pay(p, JAIL_FINE, '罰金出獄'); if (!p.bankrupt) { p.jail = 0; moveSteps(p, d1 + d2); } else endTurn(); }
      else { flash(`${p.name} 未擲出雙數，留在監獄`); endTurn(); }
    };
    const payOut = () => { pay(p, JAIL_FINE, '繳保釋金'); if (!p.bankrupt) { p.jail = 0; phase = 'roll'; beginTurn(); } else endTurn(); };
    if (p.ai) {
      setButtons(null);
      aiTimer = setTimeout(() => { if (p.cash > 4000) payOut(); else tryRoll(); }, 700);
    } else {
      setButtons([
        { label: '🎲 擲雙數出獄', primary: true, on: () => { setButtons(null); tryRoll(); } },
        { label: `付 $${JAIL_FINE} 出獄`, disabled: p.cash < JAIL_FINE, on: () => { setButtons(null); payOut(); } },
      ]);
    }
    status(`${p.name} 在監獄（第 ${p.jail} 回）`);
  }

  function moveSteps(p, steps) {
    phase = 'moving'; setButtons(null);
    const from = p.pos;
    moveAnim = { pi: cur, from, steps, i: 0, frac: 0, t0: performance.now(), done: () => {
      p.pos = (from + steps) % N;
      if (from + steps >= N) gain(p, SALARY, '經過起點');
      landOn(p.pos);
    } };
  }

  function gain(p, amt, why) { p.cash += amt; flash(`${p.name} ${why} +$${amt}`); }
  function pay(p, amt, why, toPlayer) {
    p.cash -= amt;
    if (toPlayer != null) players[toPlayer].cash += amt;
    flash(`${p.name} ${why} -$${amt}`);
    if (p.cash < 0) bankrupt(p);
  }

  function landOn(pos) {
    const p = players[cur];
    const T = TILES[pos];
    dirty = true; renderPanel();
    if (T.t === 'prop') {
      if (owner[pos] < 0) offerBuy(pos);
      else if (owner[pos] !== cur) {
        const rent = baseRent(T.price) * RENT_MULT[houses[pos]];
        pay(p, rent, `付 ${players[owner[pos]].name} 租金`, owner[pos]);
        endTurn();
      } else { offerBuild(pos); }
    } else if (T.t === 'tax') { pay(p, T.amount, T.name); endTurn(); }
    else if (T.t === 'gojail') { goToJail(p); endTurn(); }
    else if (T.t === 'chance' || T.t === 'fate') { drawCard(T.t === 'fate' ? fate : chance, T.name); }
    else endTurn(); // start / parking / jail(visiting)
  }

  function goToJail(p) { p.pos = 7; p.jail = 1; flash(`${p.name} 入獄！`); doublesRun = 0; }

  function offerBuy(pos) {
    const T = TILES[pos], p = players[cur];
    if (p.cash < T.price) { flash(`${p.name} 現金不足，無法購買`); endTurn(); return; }
    if (p.ai) {
      setButtons(null);
      aiTimer = setTimeout(() => {
        const want = p.cash > T.price * (diff === 'hard' ? 1.3 : 1.8);
        if (want) buy(pos);
        else { flash(`${p.name} 放棄購買 ${T.name}`); endTurn(); }
      }, 650);
    } else {
      phase = 'decide';
      setButtons([
        { label: `買下 ${T.name}（$${T.price}）`, primary: true, on: () => buy(pos) },
        { label: '不買', on: () => { endTurn(); } },
      ]);
      status(`要購買 ${T.name} 嗎？`);
    }
  }
  function buy(pos) {
    const T = TILES[pos], p = players[cur];
    p.cash -= T.price; owner[pos] = cur;
    flash(`${p.name} 買下 ${T.name}`);
    endTurn();
  }

  function offerBuild(pos) {
    const T = TILES[pos], p = players[cur];
    const cost = houseCost(T.price);
    if (houses[pos] >= 4 || p.cash < cost) { endTurn(); return; }
    if (p.ai) {
      setButtons(null);
      aiTimer = setTimeout(() => {
        if (p.cash > cost * (diff === 'hard' ? 2.2 : 3.2)) { houses[pos]++; flash(`${p.name} 在 ${T.name} 蓋房`); }
        endTurn();
      }, 500);
    } else {
      phase = 'decide';
      setButtons([
        { label: `蓋房（$${cost}，第 ${houses[pos] + 1} 棟）`, primary: true, on: () => { p.cash -= cost; houses[pos]++; flash('蓋房完成'); endTurn(); } },
        { label: '略過', on: () => endTurn() },
      ]);
      status(`在 ${T.name} 蓋房？`);
    }
  }

  function drawCard(pile, kind) {
    const card = pile.shift(); pile.push(card);
    const p = players[cur];
    const finish = () => {
      if (card.money) { p.cash += card.money; if (p.cash < 0) bankrupt(p); }
      else if (card.collect) { for (const q of players) if (q !== p && !q.bankrupt) { q.cash -= card.collect; p.cash += card.collect; } }
      else if (card.jail) { goToJail(p); }
      else if (card.goto != null) { const from = p.pos; p.pos = card.goto; if (card.goto <= from) gain(p, SALARY, '經過起點'); }
      else if (card.move != null) { const from = p.pos; p.pos = (p.pos + card.move + N) % N; }
      renderPanel(); dirty = true;
      // 移動類卡片需再結算落點
      if ((card.goto != null || card.move != null) && !card.jail) { landOn(p.pos); }
      else endTurn();
    };
    if (p.ai) { flash(`${kind}：${card.text}`); aiTimer = setTimeout(finish, 900); }
    else {
      $('dlgCard').classList.remove('hidden');
      $('dlgCard').innerHTML = `<div class="dialog" style="max-width:300px;text-align:center"><h2>${kind}</h2><p style="font-size:14px;margin:14px 0;line-height:1.6">${card.text}</p><button class="btn primary" id="cardOk" style="width:100%;padding:10px">確定</button></div>`;
      $('cardOk').onclick = () => { $('dlgCard').classList.add('hidden'); finish(); };
    }
  }

  function bankrupt(p) {
    p.bankrupt = true; p.cash = 0;
    for (let i = 0; i < N; i++) if (owner[i] === players.indexOf(p)) { owner[i] = -1; houses[i] = 0; }
    flash(`${p.name} 破產出局！`);
    renderPanel();
  }

  function endTurn() {
    if (over) return;
    // 勝負
    if (alive().length <= 1) { over = true; winner = players.indexOf(alive()[0]); status(); setButtons(null); setTimeout(() => Shell.showBanner(players[winner].name + ' 獲勝！', '大富翁'), 500); return; }
    turnCount++;
    if (turnCount >= TURN_CAP) { endByWealth(); return; }
    // 連莊（雙數且未入獄）
    const p = players[cur];
    if (doublesRun > 0 && !p.jail && !p.bankrupt) { beginTurn(); return; }
    doublesRun = 0;
    nextPlayer();
    beginTurn();
  }

  let flashT = 0, flashMsg = '';
  function flash(m) { flashMsg = m; flashT = performance.now(); const h = $('hint'); h.textContent = m; h.style.opacity = '1'; }

  // 動作按鈕
  function setButtons(btns) {
    const bar = $('actbar2');
    if (!btns || !btns.length) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
    bar.classList.remove('hidden');
    bar.innerHTML = btns.map((b, i) => `<button data-i="${i}"${b.disabled ? ' disabled' : ''} class="${b.primary ? 'primary' : ''}">${b.label}</button>`).join('');
    [...bar.children].forEach((el, i) => el.addEventListener('click', btns[i].on));
  }

  // ================= 輸入 / 相機 =================
  E3D.attachControls(svg, cam, { onChange: () => { dirty = true; } });

  // ================= 自訂開局對話框 =================
  function customStart(container, commit) {
    let count = 2;
    const seats = ['human', 'ai', 'ai', 'ai'];
    let diffSel = 'normal';
    function draw() {
      let h = `<div class="dialog"><h2>大富翁設定</h2><div class="lbl">玩家人數</div>`;
      h += `<div class="seg" id="cnt">${[2, 3, 4].map((n) => `<button class="opt${n === count ? ' sel' : ''}" data-n="${n}">${n} 人</button>`).join('')}</div>`;
      h += `<div class="lbl">每位玩家</div><div id="setup">`;
      for (let i = 0; i < count; i++) {
        h += `<div class="prow"><span class="dot" style="width:12px;height:12px;border-radius:50%;background:${PCOL[i]};display:inline-block"></span><span class="nm">玩家 ${i + 1}</span>
          <div class="seg" data-seat="${i}"><button class="opt${seats[i] === 'human' ? ' sel' : ''}" data-s="human">真人</button><button class="opt${seats[i] === 'ai' ? ' sel' : ''}" data-s="ai">電腦</button></div></div>`;
      }
      h += `</div><div class="lbl">電腦難度</div><div class="seg" id="dif">${[['normal', '普通'], ['hard', '精明']].map(([v, l]) => `<button class="opt${v === diffSel ? ' sel' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
      h += `<div class="row"><button class="btn primary" id="go">開始遊戲</button></div></div>`;
      container.innerHTML = h;
      container.querySelectorAll('#cnt .opt').forEach((el) => el.onclick = () => { count = +el.dataset.n; draw(); });
      container.querySelectorAll('[data-seat] .opt').forEach((el) => el.onclick = () => { const seatEl = el.closest('[data-seat]'); seats[+seatEl.dataset.seat] = el.dataset.s; draw(); });
      container.querySelectorAll('#dif .opt').forEach((el) => el.onclick = () => { diffSel = el.dataset.v; draw(); });
      container.querySelector('#go').onclick = () => {
        const chosen = seats.slice(0, count);
        if (!chosen.includes('human')) chosen[0] = 'human'; // 至少一名真人？允許全電腦亦可，這裡不強制
        commit({ seats: seats.slice(0, count), diff: diffSel });
      };
    }
    draw();
  }

  // ================= DBG =================
  window.DBG = {
    cam, view: () => E3D.makeView(cam, W2, H2),
    state: () => ({ players: players.map((p) => ({ name: p.name, cash: p.cash, pos: p.pos, jail: p.jail, bankrupt: p.bankrupt, ai: p.ai })), owner: owner.slice(), houses: houses.slice(), cur, over, winner, phase }),
    reset,
    // 測試：跳過動畫的快速一步（骰子固定值）
    forceRoll: (d1, d2) => {
      if (over) return 'over';
      const p = players[cur];
      if (p.jail) { p.jail = 0; }
      dice = [d1, d2];
      const from = p.pos, steps = d1 + d2;
      p.pos = (from + steps) % N;
      if (from + steps >= N) p.cash += SALARY;
      moveAnim = null;
      landOnSync(p.pos);
      return DBG.state();
    },
    tiles: TILES,
    // 測試真實 landOn（跳過移動動畫）：把當前玩家放到某格並結算
    landTest: (pos) => { players[cur].pos = pos; landOn(pos); return { buttons: [...$('actbar2').querySelectorAll('button')].map((b) => b.textContent), phase, cash: players.map((p) => p.cash), owner: owner.slice() }; },
    forceLandOn: (pos) => { players[cur].pos = pos; landOn(pos); },
  };
  // 同步版 landOn（測試用，AI 決策即時、無計時器）
  function landOnSync(pos) {
    const p = players[cur], T = TILES[pos];
    if (T.t === 'prop') {
      if (owner[pos] < 0) { if (p.cash > T.price * 1.3) { p.cash -= T.price; owner[pos] = cur; } }
      else if (owner[pos] !== cur) { const rent = baseRent(T.price) * RENT_MULT[houses[pos]]; p.cash -= rent; players[owner[pos]].cash += rent; if (p.cash < 0) bankrupt(p); }
      else if (houses[pos] < 4 && p.cash > houseCost(T.price) * 2.5) { p.cash -= houseCost(T.price); houses[pos]++; }
    } else if (T.t === 'tax') { p.cash -= T.amount; if (p.cash < 0) bankrupt(p); }
    else if (T.t === 'gojail') { p.pos = 7; p.jail = 1; }
    else if (T.t === 'chance' || T.t === 'fate') { const pile = T.t === 'fate' ? fate : chance; const c = pile.shift(); pile.push(c); if (c.money) { p.cash += c.money; if (p.cash < 0) bankrupt(p); } else if (c.jail) { p.pos = 7; p.jail = 1; } }
    // 換手
    if (alive().length <= 1) { over = true; winner = players.indexOf(alive()[0]); return; }
    turnCount++;
    if (turnCount >= TURN_CAP) { endByWealth(); return; }
    do { cur = (cur + 1) % players.length; } while (players[cur].bankrupt);
  }

  Shell.init({
    title: '3D 大富翁',
    customStart,
    bar: {},
    hint: '擲骰移動．購地收租．拖曳環顧視角．滾輪縮放',
    onStart: reset,
    onResetView: () => { cam.yaw = 0; cam.pitch = 0.86; cam.dist = 34; dirty = true; },
  });
})();
