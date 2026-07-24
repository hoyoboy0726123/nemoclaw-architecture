'use strict';
/* NemoClaw 電路實驗室 — UI 主控 */
(function () {
  const $ = sel => document.querySelector(sel);
  const state = {
    plan: null,               // 自動模式方案
    mode: 'view',             // view | edit
    reqText: CF.DEFAULT_REQ,  // 目前需求語句（下拉/chips/Agent 設定）
    files: [], activeFile: 0, activeTab: 'code',
    pinLabels: true, panMode: false,
    editorInited: false,
    indInited: false,
    savedInd: null,
    subInited: false,
    savedSub: null,
    simRefs: null,
    indRefs: null,
    subRefs: null,
    pinOverrides: {},         // `${partId}|${pinName}` → gpio（跨重整保留腳位修改）
    precheck: null,           // 匯出前 AI 檢查 {report, sig, title, model, when}
    codeOverride: null,       // AI/實機除錯後的程式碼覆寫 {reqText, files:{name:content}}
    projId: null, projName: null,   // 目前開啟的專案（另存/載入後記住）
    lastGenText: null,
    savedEditor: null,        // 開機時從 IndexedDB 載入的編輯器快照
    booted: false
  };

  /* ---------------- 持久化（IndexedDB） ---------------- */
  let persistTimer = null;
  function persistNow() {
    if (!state.booted || !window.CF.Store) return;
    CF.Store.set('app', { reqText: state.reqText, mode: state.mode, pinOverrides: state.pinOverrides, codeOverride: state.codeOverride, projId: state.projId, projName: state.projName });
    if (state.editorInited) CF.Store.set('editor', CF.Editor.serialize());
    if (state.indInited) CF.Store.set('ind', CF.Ind.serialize());
    if (state.subInited) CF.Store.set('sub', CF.Sub.serialize());
  }
  function persist() {
    if (!state.booted || !window.CF.Store) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 400);
  }
  // 關頁／切背景時立即落盤，避免 debounce 期間的最後修改遺失
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clearTimeout(persistTimer); persistNow(); } });

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const currentPlan = () => state.mode === 'edit' ? CF.Editor.getPlan() : state.mode === 'ind' ? CF.Ind.getPlan() : state.mode === 'sub' ? CF.Sub.getPlan() : state.plan;

  /* ---------------- 語法上色 ---------------- */
  function hlCpp(code) {
    return esc(code).replace(
      /(\/\/[^\n]*)|(&quot;(?:[^&\\\n]|\\.|&(?!quot;)[a-z]+;)*&quot;)|(&lt;[\w.\/]+&gt;)|(^#\w+)|\b(void|bool|int|long|float|double|char|unsigned|const|static|volatile|struct|class|if|else|for|while|return|true|false|String|byte)\b|\b(\d+(?:\.\d+)?[fFuUlL]*)\b/gm,
      (m, cm, str, inc, pre, kw, num) => {
        if (cm) return `<span class="tk-cm">${m}</span>`;
        if (str || inc) return `<span class="tk-str">${m}</span>`;
        if (pre) return `<span class="tk-pre">${m}</span>`;
        if (kw) return `<span class="tk-kw">${m}</span>`;
        if (num) return `<span class="tk-num">${m}</span>`;
        return m;
      });
  }
  function hlIni(code) {
    return esc(code).split('\n').map(l => {
      if (/^\s*;/.test(l)) return `<span class="tk-cm">${l}</span>`;
      if (/^\s*\[/.test(l)) return `<span class="tk-kw">${l}</span>`;
      return l.replace(/^(\s*[\w.]+)(\s*=)/, '<span class="tk-pre">$1</span>$2');
    }).join('\n');
  }
  function hlJson(code) {
    return esc(code).replace(/(&quot;(?:[^&]|&(?!quot;)[a-z]+;)*&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?)\b|\b(true|false|null)\b/g,
      (m, str, colon, num, kw) => {
        if (str) return colon ? `<span class="tk-pre">${str}</span>${colon}` : `<span class="tk-str">${str}</span>`;
        if (num) return `<span class="tk-num">${m}</span>`;
        if (kw) return `<span class="tk-kw">${m}</span>`;
        return m;
      });
  }
  const HL = { cpp: hlCpp, ini: hlIni, json: hlJson };

  /* ---------------- 左欄 ---------------- */
  function buildLeftPanel() {
    const quick = $('#quickChips');
    const groupsEl = $('#caseGroups');
    for (const group of CF.CASE_GROUPS) {
      const host = group.id === 'quick' ? quick : document.createElement('section');
      if (group.id !== 'quick') {
        host.className = 'case-group';
        const h = document.createElement('div');
        h.className = 'case-title';
        h.textContent = group.title;
        host.appendChild(h);
      }
      const wrap = group.id === 'quick' ? quick : document.createElement('div');
      if (group.id !== 'quick') { wrap.className = 'chip-wrap'; host.appendChild(wrap); }
      for (const c of group.cases) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `chip chip-${group.style}`;
        b.textContent = c.label;
        b.addEventListener('click', () => {
          if (group.append) {
            const base = state.plan ? state.plan.spec.text : 'ESP32';
            state.reqText = `${base} + ${c.text}`;
          } else {
            state.reqText = c.text;
          }
          setMode('view');
          generate();
        });
        wrap.appendChild(b);
      }
      if (group.id !== 'quick') groupsEl.appendChild(host);
    }

    // 快速生成下拉選單（彙整全部案例）
    const sel = $('#quickGen');
    for (const group of CF.CASE_GROUPS) {
      if (group.append) continue;
      const og = document.createElement('optgroup');
      og.label = group.title || '快速方案';
      for (const c of group.cases) {
        const o = document.createElement('option');
        o.value = c.text;
        o.textContent = c.label;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      state.reqText = sel.value;
      setMode('view');
      generate();
      sel.selectedIndex = 0;   // 還原提示文字，方便下次選擇
    });
    $('#supportedList').textContent = CF.SUPPORTED.join(' · ');
    $('#supportedCount').textContent = `SUPPORTED / ${CF.SUPPORTED.length}`;

    // 編輯器元件盤（分類摺疊）
    const PALETTE_GROUPS = [
      { t: '感測', ids: ['dht11', 'ds18b20', 'bme280', 'bh1750', 'mpu6050', 'mq2', 'pir', 'hcsr04', 'soil'] },
      { t: '顯示', ids: ['oled', 'lcd1602'] },
      { t: '輸入', ids: ['button', 'encoder', 'pot'] },
      { t: '輸出／動作', ids: ['led', 'ws2812', 'buzzer', 'servo', 'relay', 'pump'] },
      { t: '被動元件', ids: ['resistor', 'capacitor', 'ecap', 'diode', 'inductor', 'ldr', 'ntc', 'switch'] }
    ];
    const pal = $('#partPalette');
    for (const group of PALETTE_GROUPS) {
      const g = document.createElement('div');
      g.className = 'pal-group';
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'pal-head';
      head.innerHTML = `<span class="tri">▾</span>${group.t}`;
      const row = document.createElement('div');
      row.className = 'pal-row';
      head.addEventListener('click', () => {
        g.classList.toggle('collapsed');
        head.querySelector('.tri').textContent = g.classList.contains('collapsed') ? '▸' : '▾';
      });
      for (const id of group.ids) {
        const def = CF.PARTS[id];
        const fp = CF.FOOTPRINTS[id];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'part-chip';
        b.dataset.part = id;
        b.innerHTML = `<i style="background:${fp.color}"></i>${def.titleName}`;
        b.addEventListener('click', () => {
          CF.Editor.addPart(id);
          pal.querySelectorAll('.part-chip').forEach(x => x.classList.toggle('placing', x === b));
          setTimeout(() => b.classList.remove('placing'), 2500);
        });
        row.appendChild(b);
      }
      g.appendChild(head);
      g.appendChild(row);
      pal.appendChild(g);
    }
  }

  /* ---------------- 產生（自動模式） ---------------- */
  function generate() {
    if (state.lastGenText !== null && state.lastGenText !== state.reqText) state.pinOverrides = {};
    state.lastGenText = state.reqText;
    const spec = CF.parseRequirement(state.reqText);
    state.plan = CF.buildPlan(spec);
    applyPinOverrides();
    if (state.mode === 'view') CF.Board3D.setPlan(state.plan);
    refreshAll();
  }

  function applyPinOverrides() {
    for (const [key, gpio] of Object.entries(state.pinOverrides)) {
      const [partId, pinName] = key.split('|');
      const net = state.plan.nets.find(n => !n.locked && n.partRef === partId && n.pinName === pinName);
      if (net && CF.pinOptions(state.plan, net).includes(gpio)) CF.reassignPin(state.plan, net.id, gpio);
    }
  }

  /* ---------------- 程式碼覆寫（實機除錯迴圈：AI 修改後的檔案蓋過模板） ---------------- */
  const OVERRIDABLE = ['main.cpp', 'config.h', 'platformio.ini'];
  function applyCodeOverride(files) {
    const ov = state.codeOverride;
    // 需求語句一變＝方案重生，舊覆寫自動作廢（避免蓋掉新方案的程式碼）
    if (!ov || ov.reqText !== state.reqText) return files;
    return files.map(f => ov.files && ov.files[f.name] !== undefined ? { ...f, content: ov.files[f.name], overridden: true } : f);
  }
  function setCodeOverride(fileName, content) {
    const plan = currentPlan();
    if (!plan || plan.industrial) return { ok: false, error: '程式碼覆寫僅適用 MCU 方案（3D 檢視／自由編輯）' };
    const name = String(fileName || 'main.cpp').trim();
    if (!OVERRIDABLE.includes(name)) return { ok: false, error: `只能覆寫 ${OVERRIDABLE.join('、')}` };
    if (typeof content !== 'string' || !content.trim()) return { ok: false, error: 'content 不可為空' };
    if (content.length > 60000) return { ok: false, error: '檔案過大（上限 60000 字元）' };
    if (!state.codeOverride || state.codeOverride.reqText !== state.reqText) state.codeOverride = { reqText: state.reqText, files: {} };
    state.codeOverride.files[name] = content;
    refreshAll();
    return { ok: true, file: name, note: '已覆寫並標示「已修改（脫離模板）」；匯出與匯出前檢查都會使用覆寫版。改需求重新生成方案時覆寫會自動作廢。' };
  }
  function clearCodeOverride(fileName) {
    if (!state.codeOverride) return { ok: true, note: '目前沒有覆寫' };
    if (fileName) {
      delete state.codeOverride.files[String(fileName).trim()];
      if (!Object.keys(state.codeOverride.files).length) state.codeOverride = null;
    } else {
      state.codeOverride = null;
    }
    refreshAll();
    return { ok: true };
  }

  function refreshAll() {
    const plan = currentPlan();
    if (!plan) return;
    state.files = plan.sub ? CF.Sub.genFiles() : plan.industrial ? CF.Ind.genFiles() : applyCodeOverride(CF.genFiles(plan));
    if (state.activeFile >= state.files.length) state.activeFile = 0;
    renderStage(plan);
    renderCode();
    renderWiring(plan);
    renderChecks(plan);
    renderDocs(plan);
    if (plan.sub) {
      renderSubSimPanel();
    } else if (plan.industrial) {
      renderIndSimPanel();
    } else {
      CF.Sim.load(plan);
      renderSimPanel(plan);
    }
    persist();
  }

  /* ---------------- 模式切換 ---------------- */
  function setMode(mode) {
    if (!['view', 'edit', 'ind', 'sub'].includes(mode)) return;
    if (state.mode === mode) return;
    state.mode = mode;
    CF.Sim.stop();
    if (state.indInited && mode !== 'ind') CF.Ind.simStop();
    $('#modeViewBtn').classList.toggle('active', mode === 'view');
    $('#modeEditBtn').classList.toggle('active', mode === 'edit');
    $('#modeIndBtn').classList.toggle('active', mode === 'ind');
    $('#modeSubBtn').classList.toggle('active', mode === 'sub');
    $('#viewToolbar').hidden = mode !== 'view';
    $('#editToolbar').hidden = mode !== 'edit';
    $('#indToolbar').hidden = mode !== 'ind';
    $('#leftMcu').hidden = mode === 'ind' || mode === 'sub';
    $('#leftInd').hidden = mode !== 'ind';
    $('#leftSub').hidden = mode !== 'sub';
    $('#stage3d').hidden = mode !== 'view';
    $('#stage2d').hidden = mode !== 'edit';
    $('#stageInd').hidden = mode !== 'ind';
    $('#stageSub').hidden = mode !== 'sub';
    if (mode === 'edit') {
      if (!state.editorInited) {
        CF.Editor.init($('#editor2d'), { onChange: () => refreshAll() });
        state.editorInited = true;
        if (state.savedEditor) {
          CF.Editor.restore(state.savedEditor);   // 還原上次重整前的接線
          state.savedEditor = null;
        } else {
          CF.Editor.importPlan(state.plan);
        }
        $('#editBoardSel').value = CF.Editor.getState().boardId;
        $('#editConnSel').value = CF.Editor.getState().conn;
      } else {
        CF.Editor.resize();
      }
    } else if (mode === 'ind') {
      if (!state.indInited) {
        CF.Ind.init($('#indCanvas'), {
          onChange: () => refreshAll(),
          onSim: () => updateIndSimUi(),
          onLadder: () => openLadder()
        });
        if (CF.Plc) CF.Plc.setOnChange(() => { if (state.mode === 'ind') refreshAll(); });
        state.indInited = true;
        if (state.savedInd) {
          CF.Ind.restore(state.savedInd);
          state.savedInd = null;
        }
      } else {
        CF.Ind.resize();
      }
    } else if (mode === 'sub') {
      if (!state.subInited) {
        CF.Sub.init($('#subCanvas'), {
          onChange: () => refreshAll(),
          onSim: () => updateSubSimUi()
        });
        state.subInited = true;
        if (state.savedSub) {
          CF.Sub.restore(state.savedSub);
          state.savedSub = null;
        }
      } else {
        CF.Sub.resize();
      }
    } else {
      CF.Board3D.setPlan(state.plan);
    }
    refreshAll();
  }

  /* ---------------- 中欄 ---------------- */
  function renderStage(plan) {
    $('#planTitle').textContent = plan.title;
    $('#stageTags').textContent = plan.tags.join(' / ');
    $('#statBoard').textContent = plan.board.display;
    $('#statParts').textContent = String(plan.counts.parts).padStart(2, '0');
    $('#statWires').textContent = String(plan.counts.wires).padStart(2, '0');
    $('#statDone').textContent = plan.connDone;
    const bad = !!(plan.editor && plan.errN > 0);
    $('.stat-done').classList.toggle('bad', bad);
    $('#doneBox').textContent = bad ? '✕' : '✓';
    const badge = $('#ercBadge');
    if (plan.editor) {
      badge.textContent = plan.errN ? `ERC ✕ ${plan.errN} 項錯誤` : 'ERC ✓ 全部通過';
      badge.className = 'erc-badge ' + (plan.errN ? 'erc-bad' : 'erc-ok');
    }
    if (plan.industrial) {
      const ib = $('#indErc');
      ib.textContent = plan.errN ? `ERC ✕ ${plan.errN} 項錯誤` : 'ERC ✓ 全部通過';
      ib.className = 'erc-badge ' + (plan.errN ? 'erc-bad' : 'erc-ok');
      $('.stat-done').classList.toggle('bad', plan.errN > 0);
      $('#doneBox').textContent = plan.errN > 0 ? '✕' : '✓';
    }
  }

  /* ---------------- 右欄 ---------------- */
  function renderCode() {
    const tabs = $('#fileTabs');
    tabs.innerHTML = '';
    state.files.forEach((f, i) => {
      const b = document.createElement('button');
      b.className = 'file-tab' + (i === state.activeFile ? ' active' : '') + (f.overridden ? ' overridden' : '');
      b.textContent = (f.overridden ? '⚠ ' : '') + f.name;
      b.title = f.overridden ? '已修改（脫離模板）——匯出用此版本' : f.name;
      b.addEventListener('click', () => { state.activeFile = i; renderCode(); });
      tabs.appendChild(b);
    });
    const f = state.files[state.activeFile];
    $('#codeName').textContent = f.name + (f.overridden ? '　⚠ 已修改（脫離模板）' : '');
    $('#codeRestoreBtn').hidden = !f.overridden;
    $('#codeView').innerHTML = (HL[f.lang] || esc)(f.content);
  }

  function renderWiring(plan) {
    $('#netCount').textContent = `${plan.nets.length} CONNECTIONS`;
    const host = $('#netList');
    host.innerHTML = '';
    plan.nets.forEach(net => {
      const el = document.createElement('div');
      el.className = 'net';
      const idx = String(net.id + 1).padStart(2, '0');
      let pinRow = '';
      if (!net.locked && !plan.editor) {
        const opts = CF.pinOptions(plan, net)
          .map(p => `<option value="${p}"${p === net.boardPin ? ' selected' : ''}>${p}</option>`).join('');
        pinRow = `<div class="net-pin"><span>BOARD PIN</span><select data-net="${net.id}">${opts}</select></div>`;
      }
      el.innerHTML = `
        <div class="net-idx">${idx}</div>
        <div class="net-bars kind-${net.kind}"><i></i><i></i></div>
        <div class="net-body">
          <div class="net-from">${esc(net.from)}</div>
          <div class="net-to">${esc(net.to)}</div>
          <div class="net-note">${esc(net.note)}</div>
          ${pinRow}
          <div class="net-badge">${esc(net.badge)}</div>
        </div>`;
      host.appendChild(el);
    });
    host.querySelectorAll('select[data-net]').forEach(sel => {
      sel.addEventListener('change', () => {
        const netObj = state.plan.nets.find(n => n.id === Number(sel.dataset.net));
        if (netObj) state.pinOverrides[`${netObj.partRef}|${netObj.pinName}`] = sel.value;
        CF.reassignPin(state.plan, Number(sel.dataset.net), sel.value);
        state.files = CF.genFiles(state.plan);
        CF.Board3D.setPlan(state.plan);
        renderCode();
        renderWiring(state.plan);
        renderChecks(state.plan);
        renderDocs(state.plan);
        CF.Sim.load(state.plan);
        renderSimPanel(state.plan);
        persist();
      });
    });
  }

  function renderChecks(plan) {
    $('#checkCount').textContent = `${plan.checks.length} RULES`;
    const host = $('#checkList');
    host.innerHTML = '';
    for (const c of plan.checks) {
      const el = document.createElement('div');
      el.className = `check st-${c.status}`;
      const icon = c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : c.status === 'error' ? '✕' : 'i';
      el.innerHTML = `
        <div class="check-icon">${icon}</div>
        <div class="check-main">
          <div class="check-name">${esc(c.name)}</div>
          <div class="check-desc">${esc(c.desc)}</div>
        </div>
        <div class="check-chip">${c.status.toUpperCase()}</div>`;
      host.appendChild(el);
    }
  }

  function docPinLines(part) {
    const lines = [];
    for (const pin of part.pins) {
      if (pin.assigned) {
        let l = `${pin.n} → ${pin.assigned}`;
        if (part.id === 'button' && pin.n === 'LEG A') l += '（INPUT_PULLUP）';
        lines.push(l);
      }
    }
    if (!lines.length && part.def.pinNote) lines.push(part.def.pinNote);
    if (!lines.length) lines.push('電源軌供電');
    return lines;
  }

  function renderDocs(plan) {
    const parts = plan.parts;
    $('#docCount').textContent = `${parts.length} PARTS`;
    $('#docsIntro').textContent = `${plan.title} 的元件選用理由與可替換方向。替代前仍需重新確認工作電壓、腳位與函式庫。`;
    const host = $('#docParts');
    host.innerHTML = '';
    parts.forEach((part, i) => {
      const el = document.createElement('div');
      el.className = 'doc-part';
      const alts = part.def.alts.map(a => `<li><b>${esc(a[0])}</b>：${esc(a[1])}</li>`).join('');
      el.innerHTML = `
        <div class="doc-kicker">${String(i + 1).padStart(2, '0')} / ${part.def.cls}</div>
        <h3>${esc(part.def.name)}</h3>
        <div class="doc-row"><div class="doc-k">目前腳位</div><div class="doc-v doc-mono">${docPinLines(part).map(esc).join('<br>')}</div></div>
        <div class="doc-row"><div class="doc-k">為何需要</div><div class="doc-v">${esc(part.def.why)}</div></div>
        <div class="doc-row"><div class="doc-k">替代方案</div><div class="doc-v"><ul>${alts}</ul></div></div>`;
      host.appendChild(el);
    });
  }

  /* ---------------- 模擬面板 ---------------- */
  function renderSimPanel(plan) {
    const host = $('#simBody');
    host.innerHTML = '';
    state.simRefs = null;
    state.indRefs = null;
    state.subRefs = null;
    if (!plan) return;
    const has = id => plan.parts.some(p => p.id === id);
    const refs = { sliders: {}, outs: {} };

    const powerRow = document.createElement('div');
    powerRow.className = 'sim-power-row';
    powerRow.innerHTML = `<button id="simPowerBtn" class="sim-power" type="button">通電 ▶</button>
      <span class="sim-note">通電前會先跑 ERC，接錯不給電。</span>`;
    host.appendChild(powerRow);

    const blocked = document.createElement('div');
    blocked.className = 'sim-blocked';
    blocked.hidden = true;
    host.appendChild(blocked);
    refs.blocked = blocked;

    /* 輸入 */
    const inputParts = plan.parts.filter(p => CF.SIM_INPUTS[p.id]);
    if (inputParts.length || has('pir') || has('button')) {
      const sec = document.createElement('div');
      sec.className = 'sim-sec';
      sec.textContent = 'INPUTS / 虛擬感測';
      host.appendChild(sec);
      for (const part of inputParts) {
        for (const inp of CF.SIM_INPUTS[part.id]) {
          const el = document.createElement('div');
          el.className = 'sim-slider';
          el.innerHTML = `<div class="lbl"><span>${esc(inp.label)}</span><span class="val" data-val>${inp.init}${inp.unit}</span></div>
            <input type="range" min="${inp.min}" max="${inp.max}" step="${inp.step}" value="${inp.init}">`;
          const range = el.querySelector('input');
          const val = el.querySelector('[data-val]');
          range.addEventListener('input', () => {
            CF.Sim.setInput(inp.key, range.value);
            val.textContent = `${range.value}${inp.unit}`;
          });
          refs.sliders[inp.key] = { range, val, unit: inp.unit };
          host.appendChild(el);
        }
      }
      const evRow = document.createElement('div');
      evRow.className = 'sim-ev-row';
      if (has('pir')) {
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = '👋 模擬人體經過';
        b.addEventListener('click', () => CF.Sim.pulseMotion());
        evRow.appendChild(b);
      }
      if (has('button')) {
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = '⬇ 按住按鈕';
        b.addEventListener('pointerdown', () => { CF.Sim.setButton(true); b.classList.add('held'); });
        const up = () => { CF.Sim.setButton(false); b.classList.remove('held'); };
        b.addEventListener('pointerup', up);
        b.addEventListener('pointerleave', up);
        evRow.appendChild(b);
      }
      if (has('encoder')) {
        const mk = (txt, fn) => {
          const b = document.createElement('button');
          b.className = 'sim-ev'; b.type = 'button';
          b.textContent = txt;
          b.addEventListener('click', fn);
          return b;
        };
        evRow.appendChild(mk('⟲ 逆轉', () => CF.Sim.encoderDelta(-3)));
        evRow.appendChild(mk('⟳ 順轉', () => CF.Sim.encoderDelta(3)));
        evRow.appendChild(mk('◉ 按下歸零', () => CF.Sim.encoderPress()));
        const posEl = document.createElement('span');
        posEl.className = 'sim-enc-pos';
        posEl.textContent = 'POS 0';
        evRow.appendChild(posEl);
        refs.encPos = posEl;
      }
      if (evRow.children.length) host.appendChild(evRow);
    }

    /* 輸出 */
    const outSec = document.createElement('div');
    outSec.className = 'sim-sec';
    outSec.textContent = 'OUTPUTS / 電路反應';
    host.appendChild(outSec);
    const outs = document.createElement('div');
    outs.className = 'sim-outs';
    host.appendChild(outs);
    const addOut = (key, label, inner) => {
      const el = document.createElement('div');
      el.className = 'sim-out';
      el.innerHTML = `<div class="k">${label}</div>${inner}`;
      outs.appendChild(el);
      refs.outs[key] = el;
      return el;
    };
    if (has('led')) addOut('led', 'LED', '<div class="sim-led" data-el></div>');
    if (has('buzzer')) addOut('buzzer', 'BUZZER', '<div class="sim-buz" data-el>🔔</div>');
    if (has('relay')) addOut('relay', 'RELAY', '<div class="sim-chipval" data-el>OFF</div>');
    if (has('servo')) addOut('servo', 'SERVO', '<div class="sim-servo"><div class="sim-needle" data-el></div></div><div class="sim-chipval" data-deg>0°</div>');
    if (has('camera')) addOut('flash', 'FLASH', '<div class="sim-led" data-el style="border-radius:6px"></div>');
    if (has('pump')) addOut('pump', 'PUMP 水泵', '<div class="sim-pump" data-el>💧</div>');
    if (has('ws2812')) {
      addOut('strip', 'WS2812 燈條', '<div class="sim-strip" data-el>' + '<i></i>'.repeat(6) + '</div>');
    }
    if (has('lcd1602')) {
      const el = document.createElement('div');
      el.className = 'sim-out';
      el.innerHTML = '<div class="k">LCD1602</div><div class="sim-lcd" data-el><div>— POWER OFF —</div></div>';
      outs.appendChild(el);
      refs.outs.lcd = el;
    }
    if (has('oled')) {
      const el = document.createElement('div');
      el.className = 'sim-out';
      el.innerHTML = '<div class="k">SSD1306 OLED</div><div class="sim-oled" data-el><div class="ol">— POWER OFF —</div></div>';
      outs.appendChild(el);
      refs.outs.oled = el;
    }
    if (!outs.children.length) {
      const n = document.createElement('div');
      n.className = 'sim-note';
      n.textContent = '此方案沒有輸出元件；感測值會定期發布到下方主控台。';
      host.appendChild(n);
    }

    /* MQTT / 序列主控台 */
    const conSec = document.createElement('div');
    conSec.className = 'sim-sec';
    conSec.textContent = plan.conn === 'mqtt' ? 'MQTT CONSOLE / 虛擬 broker' : 'CONSOLE / 序列輸出';
    host.appendChild(conSec);
    const con = document.createElement('div');
    con.className = 'sim-mqtt';
    con.innerHTML = `<div class="sim-log" data-log></div>` +
      (plan.conn === 'mqtt'
        ? `<div class="sim-cmd-row"><input data-cmd placeholder="送出指令到 cmd 主題：on / off / open / close / 90"><button data-send type="button">發布</button></div>`
        : '');
    host.appendChild(con);
    refs.log = con.querySelector('[data-log]');
    const cmdInput = con.querySelector('[data-cmd]');
    if (cmdInput) {
      const send = () => { if (cmdInput.value.trim()) { CF.Sim.cmd(cmdInput.value); cmdInput.value = ''; } };
      con.querySelector('[data-send]').addEventListener('click', send);
      cmdInput.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    }

    $('#simPowerBtn').addEventListener('click', () => {
      if (CF.Sim.state.running) {
        CF.Sim.stop();
        updateSimUi();
        return;
      }
      const r = CF.Sim.start();
      if (!r.ok) {
        blocked.hidden = false;
        blocked.textContent = `⚡ 無法通電 — ${r.msg}`;
      } else {
        blocked.hidden = true;
      }
      updateSimUi();
    });

    state.simRefs = refs;
    updateSimUi();
  }

  function updateSimUi() {
    const refs = state.simRefs;
    if (!refs) return;
    const S = CF.Sim.state;
    const btn = $('#simPowerBtn');
    if (btn) {
      btn.textContent = S.running ? '斷電 ■' : '通電 ▶';
      btn.classList.toggle('off', S.running);
    }
    $('#simStatus').textContent = S.running ? 'RUNNING' : 'POWER OFF';
    const o = S.outputs;
    const set = (key, fn) => { const el = refs.outs[key]; if (el) fn(el); };
    set('led', el => el.querySelector('[data-el]').classList.toggle('on', S.running && o.led));
    set('flash', el => el.querySelector('[data-el]').classList.toggle('on', S.running && o.flash));
    set('buzzer', el => el.querySelector('[data-el]').classList.toggle('on', S.running && o.buzzer));
    set('relay', el => {
      const v = el.querySelector('[data-el]');
      v.textContent = S.running && o.relay ? 'ON' : 'OFF';
      v.classList.toggle('on', S.running && o.relay);
    });
    set('servo', el => {
      el.querySelector('[data-el]').style.transform = `rotate(${(S.running ? o.servo : 0) - 90}deg)`;
      el.querySelector('[data-deg]').textContent = `${S.running ? o.servo : 0}°`;
    });
    set('oled', el => {
      const scr = el.querySelector('[data-el]');
      if (!S.running) scr.innerHTML = '<div class="ol">— POWER OFF —</div>';
      else if (o.oled.length) scr.innerHTML = o.oled.map(l => `<div class="ol">${esc(l[0])}<b>${esc(l[1])}</b></div>`).join('');
      else scr.innerHTML = '<div class="ol">NEMOCLAW LAB READY</div>';
    });
    // 3D 檢視的 OLED 同步顯示模擬即時值
    if (CF.Board3D.setOledLines) CF.Board3D.setOledLines(state.mode === 'view' && S.running ? o.oled : null);
    set('lcd', el => {
      const scr = el.querySelector('[data-el]');
      if (!S.running) scr.innerHTML = '<div>— POWER OFF —</div>';
      else if (o.lcd.length) scr.innerHTML = o.lcd.map(l => `<div>${esc(l[0])} <b>${esc(l[1])}</b></div>`).join('');
      else scr.innerHTML = '<div>NEMOCLAW LAB</div>';
    });
    set('pump', el => el.querySelector('[data-el]').classList.toggle('on', S.running && o.pump));
    set('strip', el => {
      const strip = el.querySelector('[data-el]');
      const color = !S.running || o.strip === 'off' ? '#d8d2c2'
        : o.strip === 'red' ? '#ff4433'
        : o.strip === 'warm' ? '#ffb055'
        : '#f5f2ea';
      const glow = S.running && o.strip !== 'off';
      strip.querySelectorAll('i').forEach(i => {
        i.style.background = color;
        i.style.boxShadow = glow ? `0 0 9px ${color}` : 'none';
      });
    });
    if (refs.encPos) refs.encPos.textContent = 'POS ' + o.encoderPos;
  }

  /* ---------------- 工業配線模擬面板 ---------------- */
  function openLadder() {
    if (!CF.Plc) return;
    const hasPlc = CF.Ind.getParts().some(p => p.def.plc);
    if (!hasPlc) {
      const r = CF.Ind.addPart('plc');
      if (!r.ok) { window.alert('無法加入 PLC：' + r.error); return; }
    }
    CF.Plc.openEditor();
  }

  function renderIndSimPanel() {
    const host = $('#simBody');
    host.innerHTML = '';
    state.indRefs = null;
    state.simRefs = null;
    state.subRefs = null;
    if (!state.indInited) return;
    // 面板重建會失去按鈕的 pointerup——把仍按著的 PB 全部放開，避免卡在按下狀態
    for (const p of CF.Ind.getParts()) if (p.def.momentary && p.pressed) CF.Ind.pressPB(p.uid, false);
    const refs = {};

    const powerRow = document.createElement('div');
    powerRow.className = 'sim-power-row';
    powerRow.innerHTML = `<button id="indPowerBtn" class="sim-power" type="button">通電 ▶</button>
      <span class="sim-note">通電前會先跑 ERC；相間短路會立即跳電。</span>`;
    host.appendChild(powerRow);
    const blocked = document.createElement('div');
    blocked.className = 'sim-blocked';
    blocked.hidden = true;
    host.appendChild(blocked);
    refs.blocked = blocked;

    const opSec = document.createElement('div');
    opSec.className = 'sim-sec';
    opSec.textContent = 'OPERATE / 盤面操作';
    host.appendChild(opSec);
    const ops = document.createElement('div');
    ops.className = 'sim-ev-row';
    host.appendChild(ops);
    for (const p of CF.Ind.getParts()) {
      if (p.def.momentary) {
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = `⬇ 按住 ${p.label}`;
        const up = () => { CF.Ind.pressPB(p.uid, false); b.classList.remove('held'); };
        b.addEventListener('pointerdown', () => {
          CF.Ind.pressPB(p.uid, true);
          b.classList.add('held');
          window.addEventListener('pointerup', up, { once: true });   // 面板重建也放得開
        });
        b.addEventListener('pointerleave', up);
        ops.appendChild(b);
      }
      if (p.def.toggle) {
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = '🔌 NFB 切換';
        b.addEventListener('click', () => { CF.Ind.toggleNfb(p.uid); updateIndSimUi(); });
        ops.appendChild(b);
      }
      if (p.def.trip) {
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = `⚡ ${p.label} 過載跳脫／復歸`;
        b.addEventListener('click', () => { CF.Ind.tripThry(p.uid); updateIndSimUi(); });
        ops.appendChild(b);
      }
      if (p.def.selector) {
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = `🔀 ${p.label} 切換位置`;
        b.addEventListener('click', () => { CF.Ind.toggleCos(p.uid); updateIndSimUi(); });
        ops.appendChild(b);
      }
      if (p.def.plc) {
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = '📋 開啟梯形圖';
        b.addEventListener('click', () => openLadder());
        ops.appendChild(b);
      }
      if (p.def.outage) {
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = p.def.hvsrc ? '🔌 台電高壓停電／復電' : '🔌 模擬市電停電／復電';
        b.addEventListener('click', () => { CF.Ind.toggleOutage(p.uid); updateIndSimUi(); });
        ops.appendChild(b);
      }
      if (p.def.dsw || p.def.loadbreak || p.def.breaker) {
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = `🔧 ${p.label} 分／合`;
        b.addEventListener('click', () => {
          const r = CF.Ind.operateSwitch(p.uid);
          if (!r.ok) window.alert(r.error);
          updateIndSimUi();
        });
        ops.appendChild(b);
        if (p.def.breaker) {
          const rb = document.createElement('button');
          rb.className = 'sim-ev'; rb.type = 'button';
          rb.textContent = `↺ ${p.label} 復歸`;
          rb.addEventListener('click', () => { CF.Ind.resetProtection(p.uid); updateIndSimUi(); });
          ops.appendChild(rb);
        }
      }
      if (p.def.fusehv) {
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = `🔩 ${p.label} 更換熔絲`;
        b.addEventListener('click', () => { CF.Ind.resetProtection(p.uid); updateIndSimUi(); });
        ops.appendChild(b);
      }
      if (p.def.tester) {
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = `🧪 執行 ${p.label} 試驗`;
        b.addEventListener('click', async () => {
          b.disabled = true;
          const r = await CF.Ind.runTest(p.uid);
          b.disabled = false;
          if (!r.ok) window.alert(r.error);
          updateIndSimUi();
        });
        ops.appendChild(b);
      }
    }
    // 缺陷注入（教學）：盤上有試驗器時，對受試設備提供注入按鈕
    if (CF.Ind.getParts().some(p => p.def.tester)) {
      for (const p of CF.Ind.getParts()) {
        if (p.def.tester || p.def.earth || p.id === 'source') continue;
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = `💉 ${p.label} 缺陷注入/清除`;
        b.addEventListener('click', () => {
          const r = CF.Ind.injectDefect(p.uid);
          if (!r.ok) window.alert(r.error);
          updateIndSimUi();
        });
        ops.appendChild(b);
      }
    }
    if (!ops.children.length) {
      const n = document.createElement('div');
      n.className = 'sim-note';
      n.textContent = '盤面沒有可操作元件；請先加入按鈕／NFB，或載入自保持範例。';
      host.appendChild(n);
    }

    // 參數整定（可調參數的元件都列出來，改了即時生效；畫布上雙擊元件也可以改）
    const paramParts = CF.Ind.getParts().filter(p => p.def.param);
    if (paramParts.length) {
      const pSec = document.createElement('div');
      pSec.className = 'sim-sec';
      pSec.textContent = 'SETTINGS / 參數整定（即時生效）';
      host.appendChild(pSec);
      const pBox = document.createElement('div');
      pBox.className = 'ind-params';
      for (const p of paramParts) {
        const pr = p.def.param;
        const row = document.createElement('label');
        row.className = 'ind-param-row';
        row.innerHTML = `<span class="ipr-name">${p.label}<em>${pr.name}</em></span>
          <input type="number" value="${p.paramVal}" min="${pr.min}" max="${pr.max}" step="${pr.min < 1 ? 0.1 : 0.5}">
          <span class="ipr-unit">${pr.unit}</span>`;
        const inp = row.querySelector('input');
        inp.addEventListener('change', () => {
          const r = CF.Ind.setParam(p.uid, inp.value);
          if (!r.ok) { inp.value = p.paramVal; inp.title = r.error; }
          else inp.value = r.value;
          updateIndSimUi();
        });
        pBox.appendChild(row);
      }
      host.appendChild(pBox);
      const note = document.createElement('div');
      note.className = 'sim-note';
      note.textContent = '例：把馬達運轉電流調到超過 TH-RY／CO 的整定值，保護電驛會真的跳脫。';
      host.appendChild(note);
    }

    const stSec = document.createElement('div');
    stSec.className = 'sim-sec';
    stSec.textContent = 'STATUS / 器件狀態';
    host.appendChild(stSec);
    const stat = document.createElement('div');
    stat.className = 'sim-outs';
    host.appendChild(stat);
    refs.status = stat;

    const logSec = document.createElement('div');
    logSec.className = 'sim-sec';
    logSec.textContent = 'LOG / 事件紀錄';
    host.appendChild(logSec);
    const logBox = document.createElement('div');
    logBox.className = 'sim-mqtt';
    logBox.innerHTML = '<div class="sim-log" data-log></div>';
    host.appendChild(logBox);
    refs.log = logBox.querySelector('[data-log]');

    $('#indPowerBtn').addEventListener('click', () => {
      if (CF.Ind.isRunning()) { CF.Ind.simStop(); updateIndSimUi(); return; }
      const r = CF.Ind.simStart();
      if (!r.ok) { blocked.hidden = false; blocked.textContent = `⚡ 無法通電 — ${r.msg}`; }
      else blocked.hidden = true;
      updateIndSimUi();
    });

    state.indRefs = refs;
    updateIndSimUi();
  }

  function updateIndSimUi() {
    const refs = state.indRefs;
    if (!refs) return;
    const running = CF.Ind.isRunning();
    const btn = $('#indPowerBtn');
    if (btn) { btn.textContent = running ? '斷電 ■' : '通電 ▶'; btn.classList.toggle('off', running); }
    $('#simStatus').textContent = running ? 'RUNNING' : 'POWER OFF';
    const chips = [];
    for (const p of CF.Ind.getParts()) {
      if (p.def.coil) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval ${p.energized ? 'on' : ''}">${p.energized ? '吸持 🧲' : '釋放'}</div></div>`);
      if (p.def.motor) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval ${p.run ? 'on' : ''}">${p.run ? `RUN${p.mode ? ' ' + p.mode : ''} ▶` : 'STOP ■'}</div></div>`);
      if (p.def.load) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-led ${p.lit ? 'on' : ''}" style="margin:0 auto;${p.lit ? `background:${p.def.lamp};border-color:rgba(0,0,0,.25);box-shadow:0 0 14px ${p.def.lamp};` : ''}"></div></div>`);
      if (p.def.toggle) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval ${p.on ? 'on' : ''}">${p.on ? 'ON' : 'OFF'}</div></div>`);
      if (p.def.selector) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval on">位置 ${p.on ? 'B' : 'A'}</div></div>`);
      if (p.def.trip && p.tripped) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval" style="color:var(--amber)">TRIP ⚡</div></div>`);
      if (p.def.plc) chips.push(`<div class="sim-out"><div class="k">PLC</div><div class="sim-chipval ${p.powered ? 'on' : ''}">${running ? (p.powered ? 'RUN ▶' : '未供電') : 'STOP ■'}</div></div>`);
      if (p.def.outage && p.outage) chips.push(`<div class="sim-out"><div class="k">市電</div><div class="sim-chipval" style="color:var(--amber)">停電 ✕</div></div>`);
      if (p.def.meter) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval ${(p.reading || 0) > 0 ? 'on' : ''}">${p.def.meter === 'V' ? Math.round(p.reading || 0) + ' V' : (p.reading || 0).toFixed(1) + ' A'}</div></div>`);
      if (p.def.gen) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval ${p.running ? 'on' : ''}">${p.running ? '發電中 ⚙' : (p.startAt ? '起動中⋯' : '待機')}</div></div>`);
      if (p.def.ats) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval ${p.pos ? 'on' : ''}">${p.pos === 'N' ? '常用 N' : p.pos === 'E' ? '備用 E' : '開路'}</div></div>`);
      if (p.def.capbank) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval ${p.scEn ? 'on' : ''}">${p.scEn ? 'PF 0.98 ✦' : '切離'}</div></div>`);
      if (p.def.hvsrc && p.outage) chips.push(`<div class="sim-out"><div class="k">台電11.4kV</div><div class="sim-chipval" style="color:var(--amber)">停電 ✕</div></div>`);
      if (p.def.dsw || p.def.loadbreak || p.def.breaker) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval ${p.fault ? '' : (p.on && !p.tripped) ? 'on' : ''}" ${p.fault || p.tripped ? 'style="color:var(--amber)"' : ''}>${p.fault ? '弧光 ⚡' : p.tripped ? 'TRIP ⚡' : p.on ? '合 ●' : '分 ○'}</div></div>`);
      if (p.def.fusehv && p.tripped) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval" style="color:var(--amber)">熔斷 💥</div></div>`);
      if (p.def.hvtr) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval ${running && p.fault === undefined ? '' : ''}">${p.paramVal}kVA</div></div>`);
      if (p.id === 'ry' && p.ryOn) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval" style="color:var(--amber)">51 動作中</div></div>`);
      if (p.def.tester && p.testMsg) chips.push(`<div class="sim-out"><div class="k">${p.label}</div><div class="sim-chipval ${p.testMsg.includes('✓') ? 'on' : ''}" ${p.testMsg.includes('✕') ? 'style="color:var(--amber)"' : ''}>${esc(p.testMsg)}</div></div>`);
    }
    refs.status.innerHTML = chips.join('') || '<div class="sim-note">尚無器件。</div>';
    refs.log.innerHTML = CF.Ind.getLog().map(l => `<div class="lg-sys">${esc(l)}</div>`).join('');
    refs.log.scrollTop = refs.log.scrollHeight;
  }

  /* ---------------- 變電所模擬面板 ---------------- */
  function renderSubSimPanel() {
    const host = $('#simBody');
    host.innerHTML = '';
    state.simRefs = null;
    state.indRefs = null;
    state.subRefs = null;
    if (!state.subInited) return;
    const sc = CF.Sub.getScenario();
    if (!sc) return;
    const refs = {};

    const head = document.createElement('div');
    head.className = 'sim-note';
    head.textContent = sc.desc;
    host.appendChild(head);

    const taskBox = document.createElement('div');
    taskBox.className = 'sub-task';
    host.appendChild(taskBox);
    refs.task = taskBox;

    const opSec = document.createElement('div');
    opSec.className = 'sim-sec';
    opSec.textContent = 'OPERATE / 開關操作（也可直接點單線圖符號）';
    host.appendChild(opSec);
    const ops = document.createElement('div');
    ops.className = 'sim-ev-row';
    host.appendChild(ops);
    for (const el of sc.elements) {
      if (el.type !== 'cb' && el.type !== 'ds') continue;
      const b = document.createElement('button');
      b.className = 'sim-ev'; b.type = 'button';
      b.dataset.sw = el.id;
      b.title = el.label;
      b.addEventListener('click', () => { CF.Sub.operate(el.id); });
      ops.appendChild(b);
    }
    const rl = document.createElement('button');
    rl.className = 'sim-ev'; rl.type = 'button';
    rl.textContent = '↺ 重載情境';
    rl.addEventListener('click', () => CF.Sub.loadScenario(sc.id));
    ops.appendChild(rl);
    refs.ops = ops;

    const fkeys = Object.keys(sc.faults || {});
    if (fkeys.length) {
      const fSec = document.createElement('div');
      fSec.className = 'sim-sec';
      fSec.textContent = 'FAULT / 故障與保護演練';
      host.appendChild(fSec);
      const fRow = document.createElement('div');
      fRow.className = 'sim-ev-row';
      host.appendChild(fRow);
      for (const k of fkeys) {
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = `⚡ ${sc.faults[k].label} 故障`;
        b.addEventListener('click', () => { const r = CF.Sub.injectFault(k); if (!r.ok) window.alert(r.error); });
        fRow.appendChild(b);
      }
      const cbtn = document.createElement('button');
      cbtn.className = 'sim-ev'; cbtn.type = 'button';
      cbtn.textContent = '🔧 清除故障（修復完成）';
      cbtn.addEventListener('click', () => { const r = CF.Sub.clearFault(); if (!r.ok) window.alert(r.error); });
      fRow.appendChild(cbtn);
      const dset = new Set();
      for (const k of fkeys) if (sc.faults[k].primary) dset.add(sc.faults[k].primary);
      for (const id of dset) {
        const b = document.createElement('button');
        b.className = 'sim-ev'; b.type = 'button';
        b.textContent = `💉 ${id} 拒動注入/清除`;
        b.addEventListener('click', () => { CF.Sub.toggleDefect(id); });
        fRow.appendChild(b);
      }
    }

    const stSec = document.createElement('div');
    stSec.className = 'sim-sec';
    stSec.textContent = 'STATUS / 饋線受電';
    host.appendChild(stSec);
    const stat = document.createElement('div');
    stat.className = 'sim-outs';
    host.appendChild(stat);
    refs.status = stat;

    const shSec = document.createElement('div');
    shSec.className = 'sim-sec';
    shSec.textContent = 'SWITCHING ORDER / 操作票（自動記錄）';
    host.appendChild(shSec);
    const shBox = document.createElement('div');
    shBox.className = 'sim-mqtt';
    shBox.innerHTML = '<div class="sim-log" data-sheet></div>';
    host.appendChild(shBox);
    refs.sheet = shBox.querySelector('[data-sheet]');

    const logSec = document.createElement('div');
    logSec.className = 'sim-sec';
    logSec.textContent = 'LOG / 事件紀錄';
    host.appendChild(logSec);
    const logBox = document.createElement('div');
    logBox.className = 'sim-mqtt';
    logBox.innerHTML = '<div class="sim-log" data-log></div>';
    host.appendChild(logBox);
    refs.log = logBox.querySelector('[data-log]');

    state.subRefs = refs;
    updateSubSimUi();
  }

  function updateSubSimUi() {
    const refs = state.subRefs;
    if (!refs || state.mode !== 'sub') return;
    const s = CF.Sub.status();
    if (!s.scenario) return;
    $('#simStatus').textContent = s.task && s.task.done ? 'TASK ✓' : s.fault ? 'FAULT ⚡' : 'OPERATING';
    refs.task.textContent = s.task ? `${s.task.done ? '✅ 任務完成' : '🎯 任務'}：${s.task.text}` : '（自由操作）';
    refs.task.classList.toggle('done', !!(s.task && s.task.done));
    for (const b of refs.ops.querySelectorAll('[data-sw]')) {
      const sw = s.switches.find(x => x.id === b.dataset.sw);
      if (!sw) continue;
      b.textContent = `${sw.state === '合' ? '●' : sw.state === '分' ? '○' : '⚡'} ${sw.id} ${sw.state}${sw.defect ? ' 💉' : ''}`;
      b.disabled = sw.state === '弧光損壞';
    }
    const chips = s.feeders.map(f => `<div class="sim-out"><div class="k">${esc(f.label)}</div><div class="sim-chipval ${f.live ? 'on' : ''}">${f.live ? '受電 ●' : '停電 ○'}</div></div>`);
    if (s.fault) chips.push(`<div class="sim-out"><div class="k">故障中</div><div class="sim-chipval" style="color:var(--amber)">${esc(s.fault)} ⚡</div></div>`);
    refs.status.innerHTML = chips.join('') || '<div class="sim-note">—</div>';
    const sheet2 = CF.Sub.getSheet();
    refs.sheet.innerHTML = sheet2.map(x => `<div class="lg-sys">${String(x.n).padStart(2, '0')}　${esc(x.text)}</div>`).join('') || '<div class="lg-sys">（尚無操作）</div>';
    refs.sheet.scrollTop = refs.sheet.scrollHeight;
    refs.log.innerHTML = CF.Sub.getLog().map(l => `<div class="lg-sys">${esc(l)}</div>`).join('');
    refs.log.scrollTop = refs.log.scrollHeight;
  }

  function updateSimLog(log) {
    const refs = state.simRefs;
    if (!refs || !refs.log) return;
    refs.log.innerHTML = log.map(e =>
      `<div class="lg-${e.dir}"><span class="tt">${String(e.t).padStart(3, '0')}s</span>${e.dir === 'out' ? '▲ ' : e.dir === 'in' ? '▼ ' : ''}${esc(e.topic)} ${esc(e.payload)}</div>`
    ).join('');
    refs.log.scrollTop = refs.log.scrollHeight;
  }

  /* ---------------- GROQ 動態分析 ---------------- */
  async function runGroq() {
    const key = localStorage.getItem('cf_groq_key');
    const panel = $('#groqPanel');
    if (!key) { panel.hidden = !panel.hidden; return; }
    const btn = $('#groqBtn');
    btn.disabled = true; btn.textContent = '分析中…';
    try {
      const plan = currentPlan();
      const summary = {
        title: plan.title, board: plan.board.name, rail: plan.railV,
        parts: plan.parts.map(p => p.def.name),
        pins: plan.nets.filter(n => n.kind === 'S').map(n => `${n.from} ${n.to}`)
      };
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.4,
          max_tokens: 900,
          messages: [
            { role: 'system', content: '你是嵌入式硬體導師。以繁體中文回覆，純文字不用 markdown 符號。依序給出：1) 整體電路評估（兩三句）2) 每個元件一段：選用是否合理與風險 3) 最多三點改進建議。' },
            { role: 'user', content: JSON.stringify(summary) }
          ]
        })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      $('#groqResult').textContent = (data.choices && data.choices[0] && data.choices[0].message.content) || '（無回應）';
      $('#groqResult').hidden = false;
      $('#docsMode').textContent = 'AI 設計評析';
    } catch (err) {
      $('#groqResult').textContent = 'AI 設計評析失敗：' + err.message + '，已保留內建規則說明。';
      $('#groqResult').hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'AI 設計評析';
    }
  }

  /* ---------------- 匯出前 AI 檢查（BYOK Gemini，簽核報告） ---------------- */
  const MODE_LABEL = () => state.mode === 'sub' ? '變電所單線圖' : state.mode === 'ind' ? '工業配線' : state.mode === 'edit' ? '自由編輯' : '3D 檢視（自動生成）';
  function filesSig() {
    return state.mode + '|' + state.files.map(f => f.name + ':' + f.content.length).join('|');
  }
  const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '\n…(截斷)' : s; };

  function buildPrecheckPayload() {
    const plan = currentPlan();
    const checks = plan.checks.map(c => `[${c.status.toUpperCase()}] ${c.name}：${c.desc}`);
    const fileOf = n => { const f = state.files.find(x => x.name === n); return f ? f.content : null; };
    if (plan.sub) {
      const s = CF.Sub.status();
      return {
        sections: ['1 操作票順序審查', '2 運轉風險', '3 操作前檢查清單', '4 預期結果'],
        role: '你是變電所運轉值班主任，審查一份操作票。',
        rules: 'CB 可帶載開閉；DS 只能在無電流或等電位時操作（帶載拉 DS＝弧光事故）；合 DS 於兩個不同帶電系統＝非同期併聯；送電先 DS 後 CB、停電反向；主保護先於後備保護。',
        data: {
          情境: s.scenario, 任務: s.task, 開關現況: s.switches, 饋線: s.feeders,
          操作票全文: CF.Sub.getSheet().map(x => `${x.n}. ${x.text}`),
          確定性檢查: checks
        }
      };
    }
    if (plan.industrial) {
      return {
        sections: ['1 迴路一致性', '2 保護整定與操作風險', '3 送電前檢查清單', '4 通電後預期行為'],
        role: '你是配電盤竣工查驗技師，做送電前簽核。',
        rules: '控制迴路 STOP(b)串START(a)串MC線圈、TH-RY 95-96 回 C2；正逆轉/Y-Δ 必須電氣互鎖；發電機必須經 ATS；DS 不可帶載操作；試驗必須停電進行。',
        data: {
          方案: plan.title, 電壓: plan.railV,
          接線表: cut(fileOf('接線表.txt'), 5000),
          元件表: cut(fileOf('元件表.txt'), 2500),
          確定性檢查ERC: checks
        }
      };
    }
    return {
      sections: ['1 接線與程式碼不一致', '2 編譯風險', '3 燒錄前檢查清單', '4 上電後預期行為'],
      role: '你是嵌入式硬體審查員，做燒錄前簽核。',
      rules: 'LED 串限流電阻；5V 元件不可接 3V3 邏輯輸入無準位轉換（本板已依規則配置）；大電流負載須經繼電器/MOSFET；I2C 需同一匯流排；腳位以接線表為準逐一核對程式碼 #define。',
      data: {
        方案: plan.title, 開發板: plan.board.name, 電源: plan.railV,
        接線表: plan.nets.map(n => `${n.from} → ${n.to}`),
        確定性檢查ERC: checks,
        'main.cpp': cut(fileOf('main.cpp'), 7000),
        'config.h': cut(fileOf('config.h'), 1500),
        'platformio.ini': cut(fileOf('platformio.ini'), 1200)
      }
    };
  }

  function precheckPrompt(p) {
    return [
      p.role + ' 一律使用繁體中文、純文字（不用 markdown 符號）。',
      '以下資料由系統自動彙整，其中「確定性檢查」是規則引擎已驗證過的結果——你的任務是【驗證與補充】，找出規則引擎抓不到的問題，不要重複它已列出的項目，也不要臆測資料中沒有的東西；沒有問題的段落明確寫「未發現問題」。',
      '領域規則：' + p.rules,
      '',
      '固定輸出四段，每段以【' + p.sections.join('】【') + '】為標題，各段 1～6 條、每條一行：',
      '',
      '=== 資料 ===',
      JSON.stringify(p.data, null, 1)
    ].join('\n');
  }

  async function runPrecheck(force) {
    const overlay = $('#precheckOverlay');
    const statusEl = $('#precheckStatus');
    const resultEl = $('#precheckResult');
    overlay.hidden = false;
    const key = localStorage.getItem('cf_gemini_key');
    if (!key) {
      statusEl.className = 'precheck-status err';
      statusEl.textContent = '尚未設定 Google API Key——點右下角 🐾 助手 → ⚙ 設定貼上金鑰（aistudio.google.com 免費申請，金鑰只存在你的瀏覽器）。設定後回來按「重新檢查」。';
      resultEl.hidden = true;
      return;
    }
    const sig = filesSig();
    // 已有針對目前版本的報告：直接顯示，不重打 API
    if (!force && state.precheck && state.precheck.sig === sig) {
      statusEl.className = 'precheck-status';
      statusEl.textContent = `✓ 報告對應目前版本（${state.precheck.when}，模型 ${state.precheck.model}）——匯出 ZIP 會附上 檢查報告.md。AI 審查屬建議性質，請以 CHECKS 的確定性結果為準。`;
      resultEl.textContent = state.precheck.report;
      resultEl.hidden = false;
      return;
    }
    const model = localStorage.getItem('cf_agent_model') || 'gemma-4-31b-it';
    statusEl.className = 'precheck-status';
    statusEl.textContent = `檢查中⋯（模型 ${model}，資料只送到你自己的 Google API）`;
    resultEl.hidden = true;
    const btn = $('#precheckBtn');
    btn.disabled = true;
    try {
      const prompt = precheckPrompt(buildPrecheckPayload());
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] })
      });
      if (!res.ok) {
        const msg = res.status === 400 || res.status === 403 ? '金鑰無效或沒有權限' :
          res.status === 429 ? '額度已用完，稍後再試' :
          res.status === 404 ? `模型 ${model} 不存在（到助手 ⚙ 換一個）` : 'HTTP ' + res.status;
        throw new Error(msg);
      }
      const data = await res.json();
      const report = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [])
        .map(x => x.text || '').join('').trim();
      if (!report) throw new Error('模型沒有回覆內容');
      state.precheck = { report, sig, title: currentPlan().title, modeLabel: MODE_LABEL(), model, when: new Date().toLocaleString('zh-TW') };
      statusEl.textContent = `✓ 檢查完成（${state.precheck.when}）——匯出 ZIP 會附上 檢查報告.md。AI 審查屬建議性質，請以 CHECKS 的確定性結果為準。`;
      resultEl.textContent = report;
      resultEl.hidden = false;
    } catch (err) {
      statusEl.className = 'precheck-status err';
      statusEl.textContent = '檢查失敗：' + err.message;
    } finally {
      btn.disabled = false;
    }
  }

  function precheckEntry(prefix) {
    // 匯出 ZIP 附上檢查報告（僅當報告對應目前版本）
    if (!state.precheck || state.precheck.sig !== filesSig()) return null;
    const p = state.precheck;
    const content = [
      '# 匯出前 AI 檢查報告', '',
      `- 方案：${p.title}`, `- 模式：${p.modeLabel}`, `- 模型：${p.model}`, `- 產生時間：${p.when}`, '',
      '> 本報告由 AI 產生，屬審查建議、非執行驗證；接線／ERC 請以應用內 CHECKS 的確定性結果為準。', '',
      p.report, ''
    ].join('\n');
    return { name: `${prefix}/檢查報告.md`, content };
  }

  /* ---------------- 專案管理（多專案 IndexedDB 存取＋.json 匯出入） ---------------- */
  const Proj = {
    async list() { return (await CF.Store.get('projlist')) || []; },
    async setList(list) { await CF.Store.set('projlist', list); },
    snapshot() {
      return {
        v: 1,
        app: { reqText: state.reqText, mode: state.mode, pinOverrides: state.pinOverrides, codeOverride: state.codeOverride },
        editor: state.editorInited ? CF.Editor.serialize() : state.savedEditor,
        ind: state.indInited ? CF.Ind.serialize() : state.savedInd,
        sub: state.subInited ? CF.Sub.serialize() : state.savedSub,
        chat: (window.CF.Agent && CF.Agent.serialize()) || null
      };
    },
    validate(snap) {
      return !!(snap && typeof snap === 'object' && snap.v === 1 && snap.app && typeof snap.app === 'object' && typeof snap.app.reqText === 'string');
    },
    async saveAs(name) {
      name = String(name || '').trim().slice(0, 40) || '未命名專案';
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await CF.Store.set('proj:' + id, this.snapshot());
      const list = await this.list();
      list.unshift({ id, name, updated: Date.now() });
      await this.setList(list.slice(0, 60));
      state.projId = id; state.projName = name;
      persist();
      return { ok: true, id, name };
    },
    async overwrite(id) {
      const list = await this.list();
      const row = list.find(x => x.id === id);
      if (!row) return { ok: false, error: '專案不存在' };
      await CF.Store.set('proj:' + id, this.snapshot());
      row.updated = Date.now();
      await this.setList(list);
      state.projId = id; state.projName = row.name;
      persist();
      return { ok: true, name: row.name };
    },
    async load(id, withChat) {
      const snap = await CF.Store.get('proj:' + id);
      if (!this.validate(snap)) return { ok: false, error: '專案資料損毀或不存在' };
      const list = await this.list();
      const row = list.find(x => x.id === id);
      this.apply(snap, withChat !== false);
      state.projId = id; state.projName = row ? row.name : null;
      persist();
      return { ok: true, name: state.projName };
    },
    apply(snap, withChat) {
      state.reqText = snap.app.reqText;
      state.lastGenText = snap.app.reqText;
      state.pinOverrides = snap.app.pinOverrides && typeof snap.app.pinOverrides === 'object' ? snap.app.pinOverrides : {};
      state.codeOverride = snap.app.codeOverride || null;
      state.precheck = null;
      generate();
      if (state.editorInited) { if (snap.editor) CF.Editor.restore(snap.editor); else CF.Editor.clear(); }
      else state.savedEditor = snap.editor || null;
      if (state.indInited) { if (snap.ind) CF.Ind.restore(snap.ind); else CF.Ind.clear(); }
      else state.savedInd = snap.ind || null;
      if (state.subInited) { if (snap.sub) CF.Sub.restore(snap.sub); else CF.Sub.loadScenario('sub_basic'); }
      else state.savedSub = snap.sub || null;
      if (withChat && snap.chat && window.CF.Agent) CF.Agent.restore(snap.chat);
      const m = ['view', 'edit', 'ind', 'sub'].includes(snap.app.mode) ? snap.app.mode : 'view';
      if (state.mode === m) refreshAll(); else setMode(m);
    },
    async rename(id, name) {
      const list = await this.list();
      const row = list.find(x => x.id === id);
      if (!row) return { ok: false, error: '專案不存在' };
      row.name = String(name || '').trim().slice(0, 40) || row.name;
      await this.setList(list);
      if (state.projId === id) { state.projName = row.name; persist(); }
      return { ok: true };
    },
    async remove(id) {
      await CF.Store.del('proj:' + id);
      await this.setList((await this.list()).filter(x => x.id !== id));
      if (state.projId === id) { state.projId = null; state.projName = null; persist(); }
      return { ok: true };
    },
    async duplicate(id) {
      const snap = await CF.Store.get('proj:' + id);
      if (!this.validate(snap)) return { ok: false, error: '專案資料損毀' };
      const list = await this.list();
      const row = list.find(x => x.id === id);
      const nid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await CF.Store.set('proj:' + nid, snap);
      list.unshift({ id: nid, name: ((row && row.name) || '專案') + '（複本）', updated: Date.now() });
      await this.setList(list.slice(0, 60));
      return { ok: true };
    },
    async exportJson(id) {
      const snap = await CF.Store.get('proj:' + id);
      if (!this.validate(snap)) return { ok: false, error: '專案資料損毀' };
      const row = (await this.list()).find(x => x.id === id);
      const name = (row && row.name) || '專案';
      const blob = new Blob([JSON.stringify({ nemoclaw: 'project', name, exportedAt: new Date().toISOString(), snapshot: snap }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `nemoclaw-${name.replace(/[\\/:*?"<>|\s]+/g, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      return { ok: true };
    },
    async importJson(text) {
      let d;
      try { d = JSON.parse(text); } catch (e) { return { ok: false, error: '不是合法的 JSON 檔' }; }
      const snap = d && d.nemoclaw === 'project' ? d.snapshot : d;   // 也接受直接匯出的快照
      if (!this.validate(snap)) return { ok: false, error: '不是 NemoClaw 專案檔（缺少必要欄位）' };
      const name = ((d && d.name) || '匯入的專案') + '';
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await CF.Store.set('proj:' + id, snap);
      const list = await this.list();
      list.unshift({ id, name: name.slice(0, 40), updated: Date.now() });
      await this.setList(list.slice(0, 60));
      return { ok: true, id, name };
    }
  };

  const fmtTime = t => new Date(t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  async function renderProjModal() {
    const cur = $('#projCur');
    if (state.projId && state.projName) {
      cur.hidden = false;
      cur.innerHTML = `目前專案：<b>${esc(state.projName)}</b>　<button type="button" class="proj-act" data-act="overwrite" data-id="${esc(state.projId)}">💾 覆存目前進度</button>`;
    } else {
      cur.hidden = false;
      cur.innerHTML = '目前工作區尚未存成專案（工作區本身會自動續存，但只有一份——想保留多個作品請「另存新專案」）。';
    }
    const host = $('#projList');
    const list = await Proj.list();
    host.innerHTML = list.length ? '' : '<div class="sim-note">還沒有專案。</div>';
    for (const row of list) {
      const el = document.createElement('div');
      el.className = 'proj-row' + (row.id === state.projId ? ' cur' : '');
      el.innerHTML = `<div class="proj-meta"><b>${esc(row.name)}</b><em>${fmtTime(row.updated)}</em></div>
        <div class="proj-acts">
          <button type="button" class="proj-act" data-act="load" data-id="${esc(row.id)}">📥 載入</button>
          <button type="button" class="proj-act" data-act="overwrite" data-id="${esc(row.id)}">💾 覆存</button>
          <button type="button" class="proj-act" data-act="rename" data-id="${esc(row.id)}">✏ 改名</button>
          <button type="button" class="proj-act" data-act="duplicate" data-id="${esc(row.id)}">⧉ 複製</button>
          <button type="button" class="proj-act" data-act="export" data-id="${esc(row.id)}">⬇ 匯出</button>
          <button type="button" class="proj-act proj-del" data-act="remove" data-id="${esc(row.id)}">🗑</button>
        </div>`;
      host.appendChild(el);
    }
  }
  async function projAction(act, id) {
    if (act === 'load') {
      if (!window.confirm('載入會覆蓋目前工作區（含對話紀錄）。尚未另存的變更會遺失，確定載入？')) return;
      const r = await Proj.load(id, true);
      if (!r.ok) window.alert(r.error);
      else $('#projOverlay').hidden = true;
      return;
    }
    if (act === 'overwrite') {
      const r = await Proj.overwrite(id);
      if (!r.ok) window.alert(r.error);
    } else if (act === 'rename') {
      const row = (await Proj.list()).find(x => x.id === id);
      const name = window.prompt('新名稱：', row ? row.name : '');
      if (name !== null) await Proj.rename(id, name);
    } else if (act === 'duplicate') {
      await Proj.duplicate(id);
    } else if (act === 'export') {
      const r = await Proj.exportJson(id);
      if (!r.ok) window.alert(r.error);
    } else if (act === 'remove') {
      if (!window.confirm('刪除這個專案？（無法復原）')) return;
      await Proj.remove(id);
    }
    renderProjModal();
  }

  /* ---------------- 匯出 ---------------- */
  function exportProject() {
    const plan = currentPlan();
    if (plan.industrial) {
      const entries = state.files.map(f => ({ name: `nemoclaw-panel/${f.name}`, content: f.content }));
      const rep = precheckEntry('nemoclaw-panel');
      if (rep) entries.push(rep);
      const blob = CF.makeZip(entries);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'nemoclaw-panel.zip';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      return;
    }
    const slug = `nemoclaw-lab-${plan.board.id}${plan.conn !== 'none' ? '-' + plan.conn : ''}`;
    const netRows = plan.nets.map(n => `| ${String(n.id + 1).padStart(2, '0')} | ${n.from} | ${n.to.replace(/^→ /, '')} |`).join('\n');
    const readme = [
      `# ${plan.title}`, '',
      '由「NemoClaw 電路實驗室」產生的可編譯 PlatformIO 專案。', '',
      '## 接線表', '', '| # | 來源 | 目的 |', '| --- | --- | --- |', netRows, '',
      '## 使用方式', '',
      '1. 以 VS Code + PlatformIO 開啟本資料夾。',
      plan.board.wifi && plan.conn !== 'none' ? '2. 編輯 `include/config.h` 填入 WiFi 與伺服參數。' : '2. 依接線表完成麵包板接線。',
      '3. `pio run -t upload` 燒錄，`pio device monitor` 觀察輸出。', ''
    ].join('\n');
    const entries = [{ name: `${slug}/README.md`, content: readme }];
    for (const f of state.files) {
      let path = f.name;
      if (f.name === 'main.cpp') path = 'src/main.cpp';
      if (f.name === 'config.h') path = 'include/config.h';
      entries.push({ name: `${slug}/${path}`, content: f.content });
    }
    const rep = precheckEntry(slug);
    if (rep) entries.push(rep);
    const blob = CF.makeZip(entries);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}.zip`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    $('#helpBtn').addEventListener('click', () => { $('#helpOverlay').hidden = false; });
    $('#helpClose').addEventListener('click', () => { $('#helpOverlay').hidden = true; });
    $('#helpOverlay').addEventListener('click', e => { if (e.target === $('#helpOverlay')) $('#helpOverlay').hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#helpOverlay').hidden = true; $('#precheckOverlay').hidden = true; $('#projOverlay').hidden = true; } });

    // 專案管理
    $('#projBtn').addEventListener('click', () => { $('#projOverlay').hidden = false; renderProjModal(); });
    $('#projClose').addEventListener('click', () => { $('#projOverlay').hidden = true; });
    $('#projOverlay').addEventListener('click', e => { if (e.target === $('#projOverlay')) $('#projOverlay').hidden = true; });
    $('#projSaveAs').addEventListener('click', async () => {
      const name = $('#projName').value.trim();
      if (!name) { $('#projName').focus(); return; }
      await Proj.saveAs(name);
      $('#projName').value = '';
      renderProjModal();
    });
    $('#projImportBtn').addEventListener('click', () => $('#projFile').click());
    $('#projFile').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const r = await Proj.importJson(await file.text());
      if (!r.ok) window.alert('匯入失敗：' + r.error);
      renderProjModal();
    });
    $('#projList').addEventListener('click', e => {
      const b = e.target.closest('.proj-act');
      if (b) projAction(b.dataset.act, b.dataset.id);
    });
    $('#projCur').addEventListener('click', e => {
      const b = e.target.closest('.proj-act');
      if (b) projAction(b.dataset.act, b.dataset.id);
    });

    // 程式碼覆寫還原
    $('#codeRestoreBtn').addEventListener('click', () => {
      const f = state.files[state.activeFile];
      if (f && window.confirm(`把 ${f.name} 還原成模板生成的版本？（覆寫內容會消失）`)) clearCodeOverride(f.name);
    });

    // 匯出前 AI 檢查
    $('#precheckBtn').addEventListener('click', () => runPrecheck(false));
    $('#precheckRerun').addEventListener('click', () => runPrecheck(true));
    $('#precheckClose').addEventListener('click', () => { $('#precheckOverlay').hidden = true; });
    $('#precheckOverlay').addEventListener('click', e => { if (e.target === $('#precheckOverlay')) $('#precheckOverlay').hidden = true; });

    // 開機還原（IndexedDB await）完成前先不切模式，避免競態蓋掉已存檔的工作
    $('#modeViewBtn').addEventListener('click', () => { if (state.booted) setMode('view'); });
    $('#modeEditBtn').addEventListener('click', () => { if (state.booted) setMode('edit'); });
    $('#modeIndBtn').addEventListener('click', () => { if (state.booted) setMode('ind'); });
    $('#modeSubBtn').addEventListener('click', () => { if (state.booted) setMode('sub'); });

    // 工業配線工具列
    $('#indToolWire').addEventListener('click', () => {
      CF.Ind.setTool('wire');
      $('#indToolWire').classList.add('active');
      $('#indToolDelete').classList.remove('active');
    });
    $('#indToolDelete').addEventListener('click', () => {
      CF.Ind.setTool('delete');
      $('#indToolDelete').classList.add('active');
      $('#indToolWire').classList.remove('active');
    });
    $('#indExample').addEventListener('click', () => CF.Ind.loadExample());
    $('#indLadderBtn').addEventListener('click', () => openLadder());
    $('#indClear').addEventListener('click', () => CF.Ind.clear());
    // 左欄：工業模式經典迴路範例卡（三級分區，可摺疊）
    const ipHost = $('#indPresets');
    const IND_TIERS = [
      ['basic', '基礎工配（丙級）', false],
      ['adv', '進階／電力配電（乙級・受電盤）', true],
      ['hv', '高壓／特高壓受電（11.4kV–345kV）', true],
      ['test', '設備試驗（竣工／維護）', true],
      ['plc', 'PLC 可程式控制', true]
    ];
    for (const [tier, title, collapsed] of IND_TIERS) {
      const list = CF.Ind.PRESETS.filter(p => p.tier === tier);
      const g = document.createElement('div');
      g.className = 'ind-tier' + (collapsed ? ' collapsed' : '');
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'ind-tier-head';
      head.innerHTML = `<span class="tri">▾</span>${title}<em>${list.length}</em>`;
      const body = document.createElement('div');
      body.className = 'ind-tier-body';
      head.addEventListener('click', () => g.classList.toggle('collapsed'));
      for (const pr of list) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'preset-card';
        card.innerHTML = `<b>${pr.name}</b><span>${pr.desc}</span>`;
        card.addEventListener('click', () => CF.Ind.loadPreset(pr.id));
        body.appendChild(card);
      }
      g.appendChild(head);
      g.appendChild(body);
      ipHost.appendChild(g);
    }

    // 左欄：變電所情境卡（依難度分區，可摺疊）
    const spHost = $('#subScenarios');
    const SUB_TIERS = [
      [1, '基本功：停送電順序', false],
      [2, '雙母線／一次半斷路器', false],
      [3, '保護協調與檢修隔離', true],
      [4, '綜合演練', true]
    ];
    for (const [tier, title, collapsed] of SUB_TIERS) {
      const list = CF.Sub.SCENARIOS.filter(s => s.tier === tier);
      if (!list.length) continue;
      const g = document.createElement('div');
      g.className = 'ind-tier' + (collapsed ? ' collapsed' : '');
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'ind-tier-head';
      head.innerHTML = `<span class="tri">▾</span>${title}<em>${list.length}</em>`;
      const body = document.createElement('div');
      body.className = 'ind-tier-body';
      head.addEventListener('click', () => g.classList.toggle('collapsed'));
      for (const sc of list) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'preset-card';
        card.innerHTML = `<b>${sc.name}</b><span>${sc.desc}</span>`;
        card.addEventListener('click', () => CF.Sub.loadScenario(sc.id));
        body.appendChild(card);
      }
      g.appendChild(head);
      g.appendChild(body);
      spHost.appendChild(g);
    }

    const ipal = $('#indPalette');
    for (const id of CF.Ind.PALETTE) {
      const d = CF.Ind.DEFS[id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'part-chip';
      b.innerHTML = `<i style="background:${d.color}"></i>${d.name.split('（')[0]}`;
      b.addEventListener('click', () => CF.Ind.addPart(id));
      ipal.appendChild(b);
    }

    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
        state.activeTab = t.dataset.tab;
        document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.id !== 'tab-' + state.activeTab; });
      });
    });

    $('#copyBtn').addEventListener('click', async () => {
      const f = state.files[state.activeFile];
      try {
        await navigator.clipboard.writeText(f.content);
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = f.content; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      $('#copyBtn').textContent = '已複製';
      setTimeout(() => { $('#copyBtn').textContent = '複製'; }, 1200);
    });

    $('#pinLabelBtn').addEventListener('click', () => {
      state.pinLabels = !state.pinLabels;
      $('#pinLabelBtn').classList.toggle('on', state.pinLabels);
      $('#pinLabelBtn .state').textContent = state.pinLabels ? 'ON' : 'OFF';
      CF.Board3D.setOpts({ pinLabels: state.pinLabels });
    });
    $('#panBtn').addEventListener('click', () => {
      state.panMode = !state.panMode;
      $('#panBtn').classList.toggle('on', state.panMode);
      $('#panBtn .state').textContent = state.panMode ? 'ON' : 'OFF';
      CF.Board3D.setOpts({ panMode: state.panMode });
    });
    $('#resetViewBtn').addEventListener('click', () => CF.Board3D.resetView());

    // 編輯器工具列
    $('#editBoardSel').addEventListener('change', e => CF.Editor.setBoard(e.target.value));
    $('#editConnSel').addEventListener('change', e => CF.Editor.setConn(e.target.value));
    const tools = { toolSelect: 'select', toolWire: 'wire', toolDelete: 'delete' };
    for (const [id, tool] of Object.entries(tools)) {
      $('#' + id).addEventListener('click', () => {
        CF.Editor.setTool(tool);
        for (const other of Object.keys(tools)) $('#' + other).classList.toggle('active', other === id);
      });
    }
    $('#editImport').addEventListener('click', () => {
      CF.Editor.importPlan(state.plan);
      $('#editBoardSel').value = CF.Editor.getState().boardId;
      $('#editConnSel').value = CF.Editor.getState().conn;
    });
    $('#editClear').addEventListener('click', () => CF.Editor.clear());

    $('#exportBtn').addEventListener('click', exportProject);

    $('#groqBtn').addEventListener('click', runGroq);
    $('#groqSaveKey').addEventListener('click', () => {
      const v = $('#groqKeyInput').value.trim();
      if (v) { localStorage.setItem('cf_groq_key', v); $('#groqPanel').hidden = true; runGroq(); }
    });
    $('#groqClearKey').addEventListener('click', () => {
      localStorage.removeItem('cf_groq_key');
      $('#groqKeyInput').value = '';
      $('#docsMode').textContent = '內建規則';
      $('#groqResult').hidden = true;
    });

    CF.Sim.setHooks({ onTick: updateSimUi, onLog: updateSimLog });
  }

  /* ---------------- Agent 橋接層：把全站操作包成可呼叫 API ---------------- */
  function planSummary(plan) {
    if (!plan) return { error: '尚無方案' };
    return {
      title: plan.title,
      board: plan.board.name,
      connectivity: plan.connLabel || '不連網',
      power_rail: plan.railV,
      parts: plan.parts.map(p => ({
        id: p.id, name: p.def.name,
        pins: p.pins.filter(x => x.assigned).map(x => `${x.n}→${x.assigned}`).join(', ') || (p.def.onboard ? '板載' : '電源軌')
      })),
      checks: plan.checks.map(c => `[${c.status.toUpperCase()}] ${c.name}：${c.desc}`),
      erc_errors: plan.checks.filter(c => c.status === 'error').length,
      counts: plan.counts
    };
  }

  /* 識別字正規化：模型常用別名/中文/不同大小寫，寬容接受、失敗時列出可用值 */
  const PART_ALIAS = {
    dht: 'dht11', dht22: 'dht11', hcsr501: 'pir', sr501: 'pir', sr04: 'hcsr04',
    ssd1306: 'oled', lcd: 'lcd1602', neopixel: 'ws2812', ws2812b: 'ws2812',
    pushbutton: 'button', potentiometer: 'pot', rotaryencoder: 'encoder',
    sg90: 'servo', motor: 'servo', waterpump: 'pump', soilmoisture: 'soil',
    cap: 'capacitor', electrolytic: 'ecap', photoresistor: 'ldr', thermistor: 'ntc',
    slideswitch: 'switch', res: 'resistor', ov2640: 'camera'
  };
  function normalizePartId(x) {
    if (!x) return null;
    const s = String(x).trim().toLowerCase().replace(/[\s_\-－]/g, '');
    if (CF.PARTS[s]) return s;
    if (PART_ALIAS[s]) return PART_ALIAS[s];
    const hit = Object.values(CF.PARTS).find(d =>
      d.titleName.toLowerCase().replace(/[\s\-]/g, '') === s ||
      d.name.toLowerCase().replace(/[\s\-]/g, '').includes(s) ||
      (s.length >= 3 && d.id.includes(s)));
    return hit ? hit.id : null;
  }
  function normalizeGpio(x, board) {
    const raw = String(x || '').trim().toUpperCase().replace(/\s+/g, '');
    if (/^GPIO\d+$/.test(raw)) return 'GPIO ' + raw.slice(4);
    if (/^IO\d+$/.test(raw)) return 'GPIO ' + raw.slice(2);
    if (/^A\d+$/.test(raw)) return raw;
    if (/^D\d+$/.test(raw)) return board.id === 'nano' ? raw : 'GPIO ' + raw.slice(1);
    if (/^\d+$/.test(raw)) return board.id === 'nano' ? 'D' + raw : 'GPIO ' + raw;
    return String(x).trim();
  }
  const partIdError = x => ({ ok: false, error: `無法辨識元件「${x}」。可用 part_id：${CF.PART_ORDER.filter(i => i !== 'camera').join('、')}、resistor、capacitor、ecap、diode、inductor、ldr、ntc、switch` });

  CF.App = {
    normalizePartId,
    generateFromText(text) {
      state.reqText = text;
      setMode('view');
      generate();
      return planSummary(state.plan);
    },
    getState() {
      const plan = currentPlan();
      return {
        mode: state.mode === 'sub' ? '變電所單線圖' : state.mode === 'ind' ? '工業配線' : state.mode === 'edit' ? '自由編輯' : '3D 檢視（自動生成）',
        sim_running: state.mode === 'sub' ? true : state.mode === 'ind' ? (state.indInited && CF.Ind.isRunning()) : CF.Sim.state.running,
        plan: planSummary(plan)
      };
    },
    setMode(mode) { setMode(mode); return { ok: true, mode }; },
    setSignalPin(partId, pinName, gpio) {
      if (state.mode !== 'view') return { ok: false, error: '改腳位工具僅適用於 3D 檢視模式；自由編輯請用接線工具' };
      const pid = normalizePartId(partId);
      if (!pid) return partIdError(partId);
      const pn = pinName ? String(pinName).trim().toUpperCase() : null;
      const net = state.plan.nets.find(n => !n.locked && n.partRef === pid && (!pn || n.pinName.toUpperCase() === pn));
      if (!net) {
        const adjustable = state.plan.nets.filter(n => !n.locked).map(n => `${n.partRef}.${n.pinName}`);
        return { ok: false, error: `找不到 ${pid} 的可調訊號腳。可調腳位：${adjustable.join('、') || '（無）'}` };
      }
      gpio = normalizeGpio(gpio, state.plan.board);
      // 用完整腳位池驗證（UI 下拉僅顯示前幾個，agent 可用全部空腳）
      const used = new Set(CF.usedSignalPins(state.plan));
      used.delete(net.boardPin);
      const free = net.pool.filter(p => !used.has(p));
      if (!free.includes(gpio)) return { ok: false, error: `${gpio} 不可用，可選：${free.join('、')}` };
      state.pinOverrides[`${net.partRef}|${net.pinName}`] = gpio;
      CF.reassignPin(state.plan, net.id, gpio);
      state.files = applyCodeOverride(CF.genFiles(state.plan));
      CF.Board3D.setPlan(state.plan);
      renderTabsAll();
      persist();
      return { ok: true, changed: `${net.from} → ${gpio}` };
    },
    editorAddPart(partId) {
      const pid = normalizePartId(partId);
      if (!pid) return partIdError(partId);
      setMode('edit');
      const r = CF.Editor.agentAddPart(pid);
      return Object.assign(r, { state: planSummary(CF.Editor.getPlan()) });
    },
    editorRemovePart(partId) {
      const pid = normalizePartId(partId);
      if (!pid) return partIdError(partId);
      setMode('edit');
      return CF.Editor.agentRemovePart(pid);
    },
    editorLoadPlan() {
      setMode('edit');
      CF.Editor.importPlan(state.plan);
      $('#editBoardSel').value = CF.Editor.getState().boardId;
      $('#editConnSel').value = CF.Editor.getState().conn;
      return planSummary(CF.Editor.getPlan());
    },
    editorClear() {
      setMode('edit');
      CF.Editor.clear();
      return { ok: true };
    },
    getCode(fileName) {
      let f;
      if (!fileName) f = state.files[0];
      else {
        const q = String(fileName).trim().toLowerCase();
        f = state.files.find(x => x.name.toLowerCase() === q)
          || state.files.find(x => x.name.toLowerCase().includes(q) || q.includes(x.name.toLowerCase().replace(/\.\w+$/, '')));
        if (!f) return { ok: false, error: `沒有「${fileName}」這個檔案。可用檔案：${state.files.map(x => x.name).join('、')}` };
      }
      return { file: f.name, content: f.content.length > 7000 ? f.content.slice(0, 7000) + '\n…(截斷)' : f.content };
    },
    sim(action, key, value, event) {
      if (state.mode === 'ind') return { ok: false, error: '工業模式請改用 ind_control（start/stop/press…）操作配電盤模擬' };
      if (action === 'start') {
        document.querySelector('.tab[data-tab="sim"]').click();
        const r = CF.Sim.start();
        updateSimUi();
        return r.ok ? { ok: true, status: '模擬執行中' } : { ok: false, error: r.msg };
      }
      if (action === 'stop') { CF.Sim.stop(); updateSimUi(); return { ok: true }; }
      if (action === 'set_input') {
        // 接受常見別名與大小寫差異（模型常用 humidity/temperature/distance…）
        const ALIAS = {
          humidity: 'humi', rh: 'humi', hum: 'humi',
          temperature: 'temp', temp_c: 'temp',
          distance: 'dist', range: 'dist',
          light: 'lux', illuminance: 'lux', brightness: 'lux',
          water_temp: 'waterTemp', watertemp: 'waterTemp', watertemperature: 'waterTemp',
          acceleration: 'accel', vibration: 'accel',
          bme_temp: 'bmeTemp', bmetemp: 'bmeTemp',
          soil_moisture: 'soil', moisture: 'soil',
          smoke_level: 'smoke', gas: 'smoke',
          pot_value: 'pot', potentiometer: 'pot', knob: 'pot'
        };
        const sliders = (state.simRefs && state.simRefs.sliders) || {};
        let k = String(key || '').trim();
        k = ALIAS[k.toLowerCase()] || k;
        if (!sliders[k]) {
          const ci = Object.keys(sliders).find(s => s.toLowerCase() === k.toLowerCase());
          if (ci) k = ci;
        }
        const sl = sliders[k];
        if (!sl) return { ok: false, error: `此方案沒有「${key}」這個輸入。可用輸入：${Object.keys(sliders).join('、') || '（無）'}` };
        CF.Sim.setInput(k, value);
        sl.range.value = value;
        sl.val.textContent = `${value}${sl.unit}`;
        updateSimUi();
        return { ok: true, [k]: value, running: CF.Sim.state.running, note: CF.Sim.state.running ? '已生效，OLED／輸出會在下一個週期反映' : '已記錄；目前尚未通電，start 後生效' };
      }
      if (action === 'event') {
        const plan = currentPlan();
        const has = id => plan.parts.some(p => p.id === id);
        if (event === 'motion') {
          if (!has('pir')) return { ok: false, error: '此方案沒有 PIR，觸發 motion 不會有任何效果' };
          CF.Sim.pulseMotion();
        } else if (event === 'button') {
          if (!has('button')) return { ok: false, error: '此方案沒有按鈕，觸發 button 不會有任何效果' };
          CF.Sim.setButton(true);
          setTimeout(() => CF.Sim.setButton(false), 500);
        } else {
          return { ok: false, error: `未知事件「${event}」，可用：motion、button` };
        }
        return { ok: true, event, running: CF.Sim.state.running };
      }
      return { ok: false, error: '未知動作' };
    },
    exportProject() { exportProject(); return { ok: true, note: 'ZIP 已開始下載' }; },
    setCodeOverride,
    clearCodeOverride,
    async projSave(name) {
      // 有同名專案就覆存，否則另存——符合「幫我存檔」的直覺
      const list = await Proj.list();
      const hit = name && list.find(x => x.name === String(name).trim());
      return hit ? Proj.overwrite(hit.id) : Proj.saveAs(name);
    },
    async projList() {
      const list = await Proj.list();
      return { current: state.projName, projects: list.map(x => ({ name: x.name, updated: new Date(x.updated).toISOString() })) };
    },
    async projLoad(name) {
      const list = await Proj.list();
      const hit = list.find(x => x.name === String(name || '').trim()) || list.find(x => x.name.includes(String(name || '').trim()));
      if (!hit) return { ok: false, error: `找不到專案「${name}」。現有：${list.map(x => x.name).join('、') || '（無）'}` };
      return Proj.load(hit.id, false);   // 工具載入不動對話（避免清掉進行中的討論）
    }
  };
  function renderTabsAll() {
    renderCode();
    renderWiring(state.plan);
    renderChecks(state.plan);
    renderDocs(state.plan);
    CF.Sim.load(state.plan);
    renderSimPanel(state.plan);
  }

  /* ---------------- 啟動（含 IndexedDB 還原） ---------------- */
  document.addEventListener('DOMContentLoaded', async () => {
    buildLeftPanel();
    CF.Board3D.init($('#board3d'));
    bind();
    try {
      const saved = await CF.Store.get('app');
      state.savedEditor = await CF.Store.get('editor');
      state.savedInd = await CF.Store.get('ind');
      state.savedSub = await CF.Store.get('sub');
      if (saved && saved.reqText) {
        state.reqText = saved.reqText;
        state.pinOverrides = saved.pinOverrides || {};
        state.lastGenText = saved.reqText;   // 沿用需求文字，保留腳位覆寫
        state.codeOverride = saved.codeOverride || null;
        state.projId = saved.projId || null;
        state.projName = saved.projName || null;
      }
      generate();
      if (saved && saved.mode === 'edit' && state.savedEditor) setMode('edit');
      else if (saved && saved.mode === 'ind' && state.savedInd) setMode('ind');
      else if (saved && saved.mode === 'sub' && state.savedSub) setMode('sub');
    } catch (e) {
      // 還原資料損毀：丟棄壞存檔、回到乾淨的 3D 檢視，確保本次工作階段可用且能持久化
      try { CF.Store.del && CF.Store.del('editor'); CF.Store.del && CF.Store.del('ind'); CF.Store.del && CF.Store.del('sub'); } catch (e2) { /* ignore */ }
      state.savedEditor = null;
      state.savedInd = null;
      state.savedSub = null;
      state.mode = 'view';
      try { generate(); } catch (e3) { /* 最後防線：保持頁面存活 */ }
    }
    state.booted = true;
    persist();
  });
})();
