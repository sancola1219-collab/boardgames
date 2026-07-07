/* shell.js — 共用遊戲外殼：頂欄、開局對話框（模式/難度/先後手）、連線配對、勝負橫幅
   依賴 net.js（連線對戰）。 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let CFG = null;
  let sel = { mode: 'ai', diff: 'mid', side: 0 };
  let selCustom = {};       // 自訂區段（CFG.sections）的選擇
  let paused = false, speed = 1;

  function seg(id, opts, cur, cls) {
    return `<div class="seg" id="${id}">` + opts.map((o) =>
      `<button class="opt${o.id === cur ? ' sel' : ''}" data-v="${o.id}">${o.label}${o.sub ? `<small>${o.sub}</small>` : ''}</button>`
    ).join('') + '</div>';
  }

  function wireSeg(id, onPick) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('.opt');
      if (!b) return;
      [...$(id).children].forEach((c) => c.classList.remove('sel'));
      b.classList.add('sel');
      onPick(b.dataset.v);
    });
  }

  // ---------- 開局對話框（自訂區段版）----------
  function renderStartCustom() {
    let html = `<div class="dialog"><h2>${esc(CFG.startTitle || '開始遊戲')}</h2>`;
    for (const sec of CFG.sections) {
      if (selCustom[sec.id] === undefined) selCustom[sec.id] = sec.default;
      html += `<div class="lbl">${esc(sec.label)}</div>` + seg('sec_' + sec.id, sec.options, selCustom[sec.id]);
    }
    if (CFG.rulesHtml) html += `<div class="desc">${CFG.rulesHtml}</div>`;
    html += `<div class="row"><button class="btn primary" id="btnGo">開始</button></div></div>`;
    $('dlgStart').innerHTML = html;
    for (const sec of CFG.sections) wireSeg('sec_' + sec.id, (v) => { selCustom[sec.id] = v; });
    $('btnGo').addEventListener('click', () => {
      $('dlgStart').classList.add('hidden');
      hideBanner();
      CFG.onStart(Object.assign({}, selCustom));
      refreshBar();
    });
  }

  // ---------- 開局對話框 ----------
  function renderStart() {
    if (CFG.customStart) {
      CFG.customStart($('dlgStart'), (cfg) => {
        $('dlgStart').classList.add('hidden');
        hideBanner();
        CFG.onStart(cfg);
        refreshBar();
      });
      return;
    }
    if (CFG.sections) { renderStartCustom(); return; }
    const MODES = [
      { id: '2p', label: '雙人對戰' },
      { id: 'ai', label: '與電腦對戰' },
      { id: 'aivai', label: '電腦對電腦' },
      { id: 'net', label: '連線對戰', sub: '免伺服器' },
    ];
    const DIFFS = [
      { id: 'easy', label: '簡單' },
      { id: 'mid', label: '中等' },
      { id: 'hard', label: '困難' },
    ];
    const SIDES = [
      { id: '0', label: CFG.sideLabels[0] },
      { id: '1', label: CFG.sideLabels[1] },
    ];
    $('dlgStart').innerHTML = `<div class="dialog">
      <h2>開始對局</h2>
      <div class="lbl">模式</div>${seg('segMode', MODES, sel.mode)}
      <div id="rowDiff"><div class="lbl">電腦難度</div>${seg('segDiff', DIFFS, sel.diff)}</div>
      <div id="rowSide"><div class="lbl">我方執子</div>${seg('segSide', SIDES, String(sel.side))}</div>
      ${CFG.rulesHtml ? `<div class="desc">${CFG.rulesHtml}</div>` : ''}
      <div class="row"><button class="btn primary" id="btnGo">開始</button></div>
    </div>`;
    wireSeg('segMode', (v) => { sel.mode = v; refreshRows(); });
    wireSeg('segDiff', (v) => { sel.diff = v; });
    wireSeg('segSide', (v) => { sel.side = +v; });
    $('btnGo').addEventListener('click', () => {
      if (sel.mode === 'net') { openNet(); return; }
      $('dlgStart').classList.add('hidden');
      hideBanner();
      CFG.onStart({ mode: sel.mode, diff: sel.diff, side: sel.side });
      refreshBar();
    });
    refreshRows();
  }

  function refreshRows() {
    $('rowDiff').style.display = (sel.mode === 'ai' || sel.mode === 'aivai') ? '' : 'none';
    $('rowSide').style.display = (sel.mode === 'ai') ? '' : 'none';
  }

  // ---------- 連線配對 ----------
  let netRole = null;
  function openNet() {
    $('dlgStart').classList.add('hidden');
    $('dlgNet').classList.remove('hidden');
    netRole = null;
    $('dlgNet').innerHTML = `<div class="dialog">
      <h2>連線對戰</h2>
      <div class="desc">兩台裝置各開啟本頁。一方「建立房間」把邀請碼傳給對方（LINE、訊息皆可），對方「加入房間」貼上後把回應碼傳回來即可連線。點對點直連，不經過伺服器。</div>
      <div class="row">
        <button class="btn" id="btnHost">建立房間</button>
        <button class="btn" id="btnJoin">加入房間</button>
      </div>
      <div id="netBody"></div>
      <div class="row"><button class="btn" id="btnNetCancel">返回</button></div>
    </div>`;
    $('btnNetCancel').addEventListener('click', () => {
      Net.close();
      $('dlgNet').classList.add('hidden');
      $('dlgStart').classList.remove('hidden');
    });
    $('btnHost').addEventListener('click', hostFlow);
    $('btnJoin').addEventListener('click', joinFlow);
    Net.onOpen(onNetOpen);
  }

  let netStarted = false;
  function onNetOpen() {
    if (netStarted) return;
    netStarted = true;
    $('dlgNet').classList.add('hidden');
    hideBanner();
    CFG.onStart({ mode: 'net', diff: sel.diff, side: netRole === 'host' ? 0 : 1, netRole });
    refreshBar();
  }

  async function hostFlow() {
    netRole = 'host'; netStarted = false;
    const body = $('netBody');
    body.innerHTML = `<div class="netstep"><b>步驟 1</b>｜把這段邀請碼傳給對方：</div>
      <textarea class="code" id="taOffer" readonly>產生中…</textarea>
      <div class="row"><button class="btn small" id="btnCopyOffer">複製邀請碼</button></div>
      <div class="netstep"><b>步驟 2</b>｜貼上對方傳回的回應碼：</div>
      <textarea class="code" id="taAnswer" placeholder="貼上回應碼…"></textarea>
      <div class="row"><button class="btn primary" id="btnConnect">連線</button></div>
      <div class="netstep" id="netMsg"></div>`;
    $('btnCopyOffer').addEventListener('click', () => copyTa('taOffer', 'btnCopyOffer'));
    $('btnConnect').addEventListener('click', async () => {
      try {
        $('netMsg').textContent = '連線中…';
        await Net.acceptAnswer($('taAnswer').value);
      } catch (e) { $('netMsg').textContent = '回應碼無效，請確認後重貼。'; }
    });
    try {
      $('taOffer').value = await Net.host();
    } catch (e) { body.querySelector('#netMsg').textContent = '無法建立連線（瀏覽器不支援 WebRTC？）'; }
  }

  async function joinFlow() {
    netRole = 'join'; netStarted = false;
    const body = $('netBody');
    body.innerHTML = `<div class="netstep"><b>步驟 1</b>｜貼上對方的邀請碼：</div>
      <textarea class="code" id="taOffer" placeholder="貼上邀請碼…"></textarea>
      <div class="row"><button class="btn primary" id="btnMakeAnswer">產生回應碼</button></div>
      <div id="ansArea"></div>
      <div class="netstep" id="netMsg"></div>`;
    $('btnMakeAnswer').addEventListener('click', async () => {
      try {
        $('netMsg').textContent = '產生中…';
        const ans = await Net.join($('taOffer').value);
        $('ansArea').innerHTML = `<div class="netstep"><b>步驟 2</b>｜把回應碼傳回給對方，等待連線：</div>
          <textarea class="code" id="taAnswer" readonly></textarea>
          <div class="row"><button class="btn small" id="btnCopyAns">複製回應碼</button></div>`;
        $('taAnswer').value = ans;
        $('btnCopyAns').addEventListener('click', () => copyTa('taAnswer', 'btnCopyAns'));
        $('netMsg').textContent = '等待對方連線中…';
      } catch (e) { $('netMsg').textContent = '邀請碼無效，請確認後重貼。'; }
    });
  }

  function copyTa(taId, btnId) {
    const ta = $(taId);
    ta.select();
    const done = () => { $(btnId).textContent = '已複製 ✓'; setTimeout(() => { $(btnId).textContent = $(btnId).textContent.replace('已複製 ✓', taId === 'taOffer' ? '複製邀請碼' : '複製回應碼'); }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(done, () => { document.execCommand('copy'); done(); });
    else { document.execCommand('copy'); done(); }
  }

  // ---------- 頂欄 ----------
  let curMode = null;
  function renderBar() {
    $('topbar').innerHTML = `
      <h1><a href="../index.html" title="回遊戲大廳">◱</a> ${esc(CFG.title)}</h1>
      <span id="status"></span>
      <button class="btn small" id="btnPause">暫停</button>
      <button class="btn small" id="btnSpeed">1x</button>
      <button class="btn small" id="btnUndo">悔棋</button>
      <button class="btn small" id="btnView">視角</button>
      <button class="btn small primary" id="btnNew">新對局</button>`;
    $('btnNew').addEventListener('click', () => {
      if (curMode === 'net' && Net.connected()) Net.send({ type: 'bye' });
      Net.close();
      openStart();
    });
    $('btnUndo').addEventListener('click', () => CFG.onUndo && CFG.onUndo());
    $('btnView').addEventListener('click', () => CFG.onResetView && CFG.onResetView());
    $('btnPause').addEventListener('click', () => {
      paused = !paused;
      $('btnPause').textContent = paused ? '繼續 ▶' : '暫停';
      CFG.onPause && CFG.onPause(paused);
    });
    $('btnSpeed').addEventListener('click', () => {
      speed = speed >= 4 ? 1 : speed * 2;
      $('btnSpeed').textContent = speed + 'x';
      CFG.onSpeed && CFG.onSpeed(speed);
    });
  }

  function refreshBar() {
    if (CFG.sections || CFG.customStart) { // 自訂遊戲：依 CFG.bar 顯示
      const bar = CFG.bar || {};
      $('btnPause').style.display = bar.pause ? '' : 'none';
      $('btnSpeed').style.display = bar.speed ? '' : 'none';
      $('btnUndo').style.display = bar.undo ? '' : 'none';
      paused = false; $('btnPause').textContent = '暫停';
      return;
    }
    curMode = sel.mode === 'net' && netRole ? 'net' : sel.mode;
    const aivai = curMode === 'aivai';
    $('btnPause').style.display = aivai ? '' : 'none';
    $('btnSpeed').style.display = aivai ? '' : 'none';
    $('btnUndo').style.display = (curMode === '2p' || curMode === 'ai') ? '' : 'none';
    paused = false; $('btnPause').textContent = '暫停';
  }

  // ---------- 橫幅 ----------
  function showBanner(big, sub) {
    $('banner').classList.remove('hidden');
    $('banner').innerHTML = `<div class="big">${esc(big)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
      <div class="actions"><button class="btn primary" id="btnAgain">再來一局</button></div>`;
    $('btnAgain').addEventListener('click', () => {
      if (curMode === 'net' && Net.connected()) { hideBanner(); CFG.onRematch && CFG.onRematch(); }
      else { Net.close(); openStart(); }
    });
  }
  function hideBanner() { $('banner').classList.add('hidden'); $('banner').innerHTML = ''; }

  function openStart() {
    hideBanner();
    netStarted = false;
    renderStart();
    $('dlgStart').classList.remove('hidden');
    $('dlgNet').classList.add('hidden');
  }

  window.Shell = {
    init(cfg) {
      CFG = cfg;
      sel.mode = cfg.defaultMode || 'ai';
      document.title = cfg.title;
      renderBar();
      $('hint').textContent = cfg.hint || '拖曳環顧視角．滾輪/雙指縮放';
      openStart();
    },
    setStatus(html) { $('status').innerHTML = html; },
    setUndoEnabled(b) { $('btnUndo').disabled = !b; },
    setPaused(b) { paused = b; $('btnPause').textContent = b ? '繼續 ▶' : '暫停'; },
    showBanner, hideBanner, openStart,
    isPaused: () => paused,
    speed: () => speed,
    mode: () => curMode,
  };
})();
