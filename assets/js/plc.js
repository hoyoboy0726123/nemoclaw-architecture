'use strict';
/* NemoClaw 電路實驗室 — PLC 梯形圖引擎＋編輯器
 * 程式模型：每階（rung）＝若干「欄」串聯，每欄可疊 1–2 個接點（疊＝並聯 OR），
 * 最後一欄是線圈：OUT（Y/M）、TON（T，秒）、CTU（C，次）、RST（復歸 T/C）。
 * 掃描：讀 X → 由上而下逐階求值（後階可見前階寫入）→ 寫 Y。與配電盤求解器以 120ms 週期串接。
 */
window.CF = window.CF || {};

CF.Plc = (function () {

  const LIM = { X: 8, Y: 8, M: 8, T: 4, C: 4 };
  const COLS = 4;             // 每階接點欄數（另加線圈欄）
  const COIL_TYPES = { out: 'OUT', ton: 'TON', ctu: 'CTU', rst: 'RST' };

  let prog = { rungs: [] };
  let rt = null;               // runtime bits
  let lastEval = [];           // 每階通電狀態（編輯器亮線用）
  let onChange = null;

  function reset() { rt = { bits: {}, acc: {}, cnt: {}, edge: {} }; lastEval = []; }
  reset();

  /* ================= 求值 ================= */
  const bit = addr => !!rt.bits[addr];
  const cellVal = c => c ? (c.t === 'nc' ? !bit(c.addr) : bit(c.addr)) : null;

  function scan(xin, dtMs) {
    for (const k in xin) rt.bits[k] = !!xin[k];
    lastEval = [];
    for (const r of prog.rungs) {
      let power = true;
      const live = [];
      for (const col of (r.cols || [])) {
        const cells = (col || []).filter(Boolean);
        const cv = cells.length ? cells.some(cellVal) : true;
        live.push(cells.map(c => power && !!cellVal(c)));
        power = power && cv;
      }
      const co = r.coil;
      if (co && co.addr) {
        if (co.t === 'out') rt.bits[co.addr] = power;
        else if (co.t === 'ton') {
          rt.acc[co.addr] = power ? (rt.acc[co.addr] || 0) + dtMs : 0;
          rt.bits[co.addr] = rt.acc[co.addr] >= (co.preset || 3) * 1000;
        } else if (co.t === 'ctu') {
          if (power && !rt.edge[co.addr]) rt.cnt[co.addr] = (rt.cnt[co.addr] || 0) + 1;
          rt.edge[co.addr] = power;
          rt.bits[co.addr] = (rt.cnt[co.addr] || 0) >= (co.preset || 3);
        } else if (co.t === 'rst') {
          if (power) { rt.acc[co.addr] = 0; rt.cnt[co.addr] = 0; rt.bits[co.addr] = false; }
        }
      }
      lastEval.push({ on: power, live });
    }
    const out = {};
    for (let i = 0; i < LIM.Y; i++) out['Y' + i] = !!rt.bits['Y' + i];
    if (editorOpen) refreshLive();
    return out;
  }

  /* ================= 驗證 ================= */
  function checkAddr(addr, kinds) {
    const m = String(addr || '').toUpperCase().match(/^([XYMTC])([0-9])$/);
    if (!m) return `位址「${addr}」格式錯誤（例：X0、Y1、M2、T0、C0）`;
    if (!kinds.includes(m[1])) return `位址「${addr}」類型不符，此處僅接受 ${kinds.join('/')}`;
    if (+m[2] >= LIM[m[1]]) return `位址「${addr}」超出範圍（${m[1]}0–${m[1]}${LIM[m[1]] - 1}）`;
    return null;
  }
  function validateProgram(p) {
    const errs = [];
    if (!p || !Array.isArray(p.rungs)) return { ok: false, errors: ['程式需為 {rungs:[...]} 格式'] };
    const outs = {};
    p.rungs.forEach((r, i) => {
      const at = `第 ${i + 1} 階`;
      if (!Array.isArray(r.cols)) { errs.push(`${at}：缺 cols 陣列`); return; }
      if (r.cols.length > COLS) errs.push(`${at}：欄數上限 ${COLS}`);
      let contactN = 0;
      for (const col of r.cols) for (const c of (Array.isArray(col) ? col : [col])) {
        if (!c || typeof c !== 'object') continue;
        contactN++;
        if (c.t !== 'no' && c.t !== 'nc') errs.push(`${at}：接點型別需為 no（-| |-）或 nc（-|/|-）`);
        const e = checkAddr(c.addr, ['X', 'Y', 'M', 'T', 'C']);
        if (e) errs.push(`${at}：${e}`);
      }
      if (!contactN && r.coil && r.coil.t === 'out') errs.push(`${at}：沒有任何接點——線圈恆得電（若非刻意請加入條件接點）`);
      const co = r.coil;
      if (!co || !co.addr) { errs.push(`${at}：缺線圈`); return; }
      if (!COIL_TYPES[co.t]) { errs.push(`${at}：線圈型別需為 out/ton/ctu/rst`); return; }
      const kinds = co.t === 'out' ? ['Y', 'M'] : co.t === 'ton' ? ['T'] : co.t === 'ctu' ? ['C'] : ['T', 'C'];
      const e = checkAddr(co.addr, kinds);
      if (e) errs.push(`${at}：${e}`);
      else if (co.t !== 'rst') {
        const key = co.t + ':' + co.addr.toUpperCase();
        if (outs[key] !== undefined) errs.push(`${at}：${co.addr} 重複輸出（雙線圈）——後階會覆蓋前階（第 ${outs[key] + 1} 階），請合併成同一階的並聯欄`);
        outs[key] = i;
      }
      if ((co.t === 'ton' || co.t === 'ctu') && !(co.preset > 0)) errs.push(`${at}：${co.t.toUpperCase()} 需要 preset（${co.t === 'ton' ? '秒數' : '次數'}）`);
    });
    return { ok: !errs.length, errors: errs };
  }
  /* 給配電盤 ERC 用：只回警告，不擋通電（雙線圈是警告級） */
  function validateAll() {
    const v = validateProgram(prog);
    return { rungs: prog.rungs.length, warnings: v.errors };
  }

  function normalizeProgram(p) {
    return {
      rungs: p.rungs.map(r => ({
        cols: (r.cols || []).slice(0, COLS).map(col =>
          (Array.isArray(col) ? col : [col]).slice(0, 2).map(c =>
            c ? { t: c.t === 'nc' ? 'nc' : 'no', addr: String(c.addr).toUpperCase() } : null)),
        coil: { t: r.coil.t, addr: String(r.coil.addr).toUpperCase(), preset: (v => (isFinite(v) && v > 0 && v <= 6000) ? v : undefined)(parseFloat(r.coil.preset)) }
      }))
    };
  }
  function setProgram(p) {
    const v = validateProgram(p);
    // 雙線圈／恆得電是可執行的警告，不阻擋載入；格式／位址錯誤才拒絕
    const hard = v.errors.filter(e => !e.includes('雙線圈') && !e.includes('恆得電'));
    if (hard.length) return { ok: false, errors: hard };
    prog = normalizeProgram(p);
    reset();
    if (editorOpen) renderRungs();
    if (onChange) onChange();
    return { ok: true, rungs: prog.rungs.length, warnings: v.errors.filter(e => e.includes('雙線圈')) };
  }
  function getProgram() { return JSON.parse(JSON.stringify(prog)); }
  function serialize() { return getProgram(); }
  function restoreProgram(p) {
    if (!p || !Array.isArray(p.rungs)) return;
    try {
      const norm = normalizeProgram(p);
      const v = validateProgram(norm);
      const hard = v.errors.filter(e => !e.includes('雙線圈') && !e.includes('恆得電'));
      if (hard.length) { prog = { rungs: [] }; reset(); return; }   // 損毀存檔：丟棄，不執行不明程式
      prog = norm;
      reset();
    } catch (e) { prog = { rungs: [] }; reset(); }
  }

  /* ================= ST 匯出（IEC 61131-3） ================= */
  function colExpr(col) {
    const cells = (col || []).filter(Boolean);
    if (!cells.length) return null;
    const term = c => {
      const ref = /^[TC]/.test(c.addr) ? c.addr + '.Q' : c.addr;
      return c.t === 'nc' ? 'NOT ' + ref : ref;
    };
    return cells.length === 1 ? term(cells[0]) : '(' + cells.map(term).join(' OR ') + ')';
  }
  function rungExpr(r) {
    const es = (r.cols || []).map(colExpr).filter(Boolean);
    return es.length ? es.join(' AND ') : 'TRUE';
  }
  function exportST() {
    const used = { X: new Set(), Y: new Set(), M: new Set(), T: new Set(), C: new Set() };
    for (const r of prog.rungs) {
      for (const col of (r.cols || [])) for (const c of (col || [])) if (c) used[c.addr[0]].add(c.addr);
      if (r.coil && r.coil.addr) used[r.coil.addr[0]].add(r.coil.addr);
    }
    const L = ['PROGRAM PanelLogic', 'VAR'];
    [...used.X].sort().forEach(a => L.push(`  ${a} : BOOL;  (* 實體輸入 *)`));
    [...used.Y].sort().forEach(a => L.push(`  ${a} : BOOL;  (* 實體輸出 *)`));
    [...used.M].sort().forEach(a => L.push(`  ${a} : BOOL;  (* 內部繼電器 *)`));
    [...used.T].sort().forEach(a => L.push(`  ${a} : TON;`));
    [...used.C].sort().forEach(a => L.push(`  ${a} : CTU;`));
    L.push('END_VAR', '');
    // RST 併入對應 FB 的呼叫（TON 無 R 腳→併入 IN 條件；CTU 用標準 R 腳）
    const rstFor = {};
    prog.rungs.forEach(r => {
      if (r.coil && r.coil.t === 'rst' && r.coil.addr) {
        const e = rungExpr(r);
        rstFor[r.coil.addr] = rstFor[r.coil.addr] ? `(${rstFor[r.coil.addr]}) OR (${e})` : e;
      }
    });
    prog.rungs.forEach((r, i) => {
      L.push(`(* Rung ${i + 1} *)`);
      const e = rungExpr(r), co = r.coil;
      if (co.t === 'out') L.push(`${co.addr} := ${e};`);
      else if (co.t === 'ton') L.push(`${co.addr}(IN := ${rstFor[co.addr] ? `(${e}) AND NOT (${rstFor[co.addr]})` : e}, PT := T#${co.preset || 3}s);`);
      else if (co.t === 'ctu') L.push(`${co.addr}(CU := ${e}, R := ${rstFor[co.addr] || 'FALSE'}, PV := ${co.preset || 3});`);
      else if (co.t === 'rst') L.push(`(* RST ${co.addr}：復歸條件已併入 ${co.addr} 的 FB 呼叫 *)`);
      L.push('');
    });
    L.push('END_PROGRAM');
    return L.join('\n') + '\n';
  }

  /* ================= 編輯器（自建 modal） ================= */
  let modal = null, editorOpen = false, popover = null;

  function ensureModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'ladder-overlay';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="ladder-modal">
        <div class="ladder-head">
          <b>PLC 梯形圖編輯器</b>
          <span class="ladder-hint">點格子放接點（-| |- 常開／-|/|- 常閉），最右欄是線圈；同一欄上下疊＝並聯（OR）</span>
          <button type="button" class="ladder-x" data-close>✕</button>
        </div>
        <div class="ladder-rungs" data-rungs></div>
        <div class="ladder-foot">
          <button type="button" class="btn-sm" data-add>＋ 新增階</button>
          <button type="button" class="btn-sm" data-clear>清空程式</button>
          <span class="ladder-warn" data-warn></span>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.closest('[data-close]')) { closeEditor(); return; }
      if (e.target.closest('[data-add]')) {
        // 預設線圈用內部繼電器 M：空階恆通電，若預設 Y 會在模擬中直接驅動外部負載
        prog.rungs.push({ cols: [[null, null], [null, null], [null, null], [null, null]], coil: { t: 'out', addr: nextFreeM() } });
        commit();
        return;
      }
      if (e.target.closest('[data-clear]')) {
        if (prog.rungs.length && !window.confirm('清空整個梯形圖程式？')) return;
        prog.rungs = [];
        commit();
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) { prog.rungs.splice(+del.dataset.del, 1); commit(); return; }
      const cell = e.target.closest('[data-cell]');
      if (cell) { openCellEditor(cell); return; }
      const coil = e.target.closest('[data-coil]');
      if (coil) { openCoilEditor(coil); return; }
      closePopover();
    });
  }

  function nextFreeM() {
    const used = new Set(prog.rungs.filter(r => r.coil && r.coil.t === 'out').map(r => r.coil.addr));
    for (let i = 0; i < LIM.M; i++) if (!used.has('M' + i)) return 'M' + i;
    return 'M0';
  }

  function commit() {
    prog = normalizeProgram(prog);
    reset();
    renderRungs();
    if (onChange) onChange();
  }

  const escH = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cellTxt = c => !c ? '─' : (c.t === 'nc' ? `─|/|─<b>${escH(c.addr)}</b>` : `─| |─<b>${escH(c.addr)}</b>`);
  const coilTxt = co => {
    if (co.t === 'out') return `─( )─<b>${escH(co.addr)}</b>`;
    if (co.t === 'ton') return `TON <b>${escH(co.addr)}</b> ${escH(co.preset || 3)}s`;
    if (co.t === 'ctu') return `CTU <b>${escH(co.addr)}</b> ×${escH(co.preset || 3)}`;
    return `RST <b>${escH(co.addr)}</b>`;
  };

  function renderRungs() {
    if (!modal) return;
    const host = modal.querySelector('[data-rungs]');
    if (!prog.rungs.length) {
      host.innerHTML = '<div class="ladder-empty">尚無程式。按「＋ 新增階」開始，或載入 PLC 範例（左欄）。</div>';
    } else {
      host.innerHTML = prog.rungs.map((r, ri) => {
        const cols = r.cols.map((col, ci) => `
          <div class="lr-col">
            <button type="button" class="lr-cell" data-cell data-r="${ri}" data-c="${ci}" data-i="0">${cellTxt(col[0])}</button>
            <button type="button" class="lr-cell sub" data-cell data-r="${ri}" data-c="${ci}" data-i="1">${cellTxt(col[1])}</button>
          </div>`).join('');
        return `<div class="lr-rung" data-rung="${ri}">
          <span class="lr-no">${ri + 1}</span>
          <span class="lr-rail">│</span>${cols}
          <button type="button" class="lr-coil" data-coil data-r="${ri}">${coilTxt(r.coil)}</button>
          <span class="lr-rail">│</span>
          <button type="button" class="lr-del" data-del="${ri}" title="刪除此階">🗑</button>
        </div>`;
      }).join('');
    }
    const v = validateProgram(prog);
    modal.querySelector('[data-warn]').textContent = v.errors.length ? '⚠ ' + v.errors[0] : '';
    refreshLive();
  }

  function refreshLive() {
    if (!modal || modal.hidden) return;
    modal.querySelectorAll('.lr-rung').forEach(rEl => {
      const ri = +rEl.dataset.rung;
      const ev = lastEval[ri];
      rEl.classList.toggle('on', !!(ev && ev.on));
      rEl.querySelectorAll('[data-cell]').forEach(cEl => {
        const c = prog.rungs[ri] && prog.rungs[ri].cols[+cEl.dataset.c][+cEl.dataset.i];
        const liveArr = ev && ev.live[+cEl.dataset.c];
        // live 只含非空 cell；index 對映：上格在前
        let hot = false;
        if (c && liveArr) {
          const cellsInCol = prog.rungs[ri].cols[+cEl.dataset.c].filter(Boolean);
          const pos = cellsInCol.indexOf(c);
          hot = !!liveArr[pos];
        }
        cEl.classList.toggle('hot', hot);
      });
    });
  }

  function closePopover() { if (popover) { popover.remove(); popover = null; } }

  function openCellEditor(cellEl) {
    closePopover();
    const ri = +cellEl.dataset.r, ci = +cellEl.dataset.c, ii = +cellEl.dataset.i;
    const cur = prog.rungs[ri].cols[ci][ii];
    popover = document.createElement('div');
    popover.className = 'ladder-pop';
    popover.innerHTML = `
      <div class="lp-row">
        <button type="button" data-t="no" class="${cur && cur.t === 'no' ? 'sel' : ''}">─| |─ 常開</button>
        <button type="button" data-t="nc" class="${cur && cur.t === 'nc' ? 'sel' : ''}">─|/|─ 常閉</button>
        <button type="button" data-t="del">清除</button>
      </div>
      <div class="lp-row"><input type="text" placeholder="位址 X0/Y0/M0/T0/C0" value="${cur ? escH(cur.addr) : ''}" maxlength="2"><button type="button" data-ok>套用</button></div>
      <div class="lp-err"></div>`;
    placePopover(cellEl);
    const input = popover.querySelector('input');
    let type = cur ? cur.t : 'no';
    popover.addEventListener('click', e => {
      const tb = e.target.closest('[data-t]');
      if (tb) {
        if (tb.dataset.t === 'del') { prog.rungs[ri].cols[ci][ii] = null; closePopover(); commit(); return; }
        type = tb.dataset.t;
        popover.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('sel', b === tb));
        return;
      }
      if (e.target.closest('[data-ok]')) apply();
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
    input.focus();
    function apply() {
      const addr = input.value.trim().toUpperCase();
      const err = checkAddr(addr, ['X', 'Y', 'M', 'T', 'C']);
      if (err) { popover.querySelector('.lp-err').textContent = err; return; }
      prog.rungs[ri].cols[ci][ii] = { t: type, addr };
      closePopover();
      commit();
    }
  }

  function openCoilEditor(coilEl) {
    closePopover();
    const ri = +coilEl.dataset.r;
    const cur = prog.rungs[ri].coil;
    popover = document.createElement('div');
    popover.className = 'ladder-pop';
    popover.innerHTML = `
      <div class="lp-row">
        ${Object.entries(COIL_TYPES).map(([k, lbl]) => `<button type="button" data-t="${k}" class="${cur.t === k ? 'sel' : ''}">${lbl}</button>`).join('')}
      </div>
      <div class="lp-row">
        <input type="text" data-addr placeholder="位址" value="${escH(cur.addr || '')}" maxlength="2">
        <input type="number" data-preset placeholder="秒/次" value="${cur.preset || ''}" min="1" max="600" step="0.5">
        <button type="button" data-ok>套用</button>
      </div>
      <div class="lp-hint">OUT→Y/M・TON→T（秒）・CTU→C（次）・RST→T/C</div>
      <div class="lp-err"></div>`;
    placePopover(coilEl);
    let type = cur.t;
    const addrIn = popover.querySelector('[data-addr]'), preIn = popover.querySelector('[data-preset]');
    popover.addEventListener('click', e => {
      const tb = e.target.closest('[data-t]');
      if (tb) {
        type = tb.dataset.t;
        popover.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('sel', b === tb));
        return;
      }
      if (e.target.closest('[data-ok]')) apply();
    });
    addrIn.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
    addrIn.focus();
    function apply() {
      const addr = addrIn.value.trim().toUpperCase();
      const kinds = type === 'out' ? ['Y', 'M'] : type === 'ton' ? ['T'] : type === 'ctu' ? ['C'] : ['T', 'C'];
      const err = checkAddr(addr, kinds);
      if (err) { popover.querySelector('.lp-err').textContent = err; return; }
      const preset = parseFloat(preIn.value) || undefined;
      if ((type === 'ton' || type === 'ctu') && !(preset > 0)) { popover.querySelector('.lp-err').textContent = (type === 'ton' ? 'TON 需要秒數' : 'CTU 需要次數'); return; }
      prog.rungs[ri].coil = { t: type, addr, preset };
      closePopover();
      commit();
    }
  }

  function placePopover(anchor) {
    const box = modal.querySelector('.ladder-modal');
    box.appendChild(popover);
    const ar = anchor.getBoundingClientRect(), br = box.getBoundingClientRect();
    popover.style.left = Math.min(ar.left - br.left, br.width - 250) + 'px';
    popover.style.top = (ar.bottom - br.top + 6) + 'px';
  }

  function openEditor() {
    ensureModal();
    modal.hidden = false;
    editorOpen = true;
    renderRungs();
  }
  function closeEditor() {
    closePopover();
    if (modal) modal.hidden = true;
    editorOpen = false;
  }

  return {
    reset, scan, validateAll, setProgram, getProgram, serialize, restoreProgram, exportST,
    openEditor, closeEditor,
    isOpen: () => editorOpen,
    setOnChange(fn) { onChange = fn; },
    getRuntime() {
      return {
        bits: Object.assign({}, rt.bits),
        timers: Object.fromEntries(Object.entries(rt.acc).map(([k, v]) => [k, Math.round(v / 100) / 10])),
        counters: Object.assign({}, rt.cnt)
      };
    }
  };
})();
