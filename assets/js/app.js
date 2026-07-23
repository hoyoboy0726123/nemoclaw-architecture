'use strict';
/* NemoClaw 電路實驗室 — UI 主控 */
(function () {
  const $ = sel => document.querySelector(sel);
  const state = {
    plan: null,               // 自動模式方案
    mode: 'view',             // view | edit
    files: [], activeFile: 0, activeTab: 'code',
    reqIndex: 0, pinLabels: true, panMode: false,
    editorInited: false,
    simRefs: null
  };

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const currentPlan = () => state.mode === 'edit' ? CF.Editor.getPlan() : state.plan;

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
          const ta = $('#reqInput');
          if (group.append) ta.value = ta.value.trim() ? ta.value.trim() + ' + ' + c.text : `ESP32 + ${c.text}，透過 MQTT 回報數據`;
          else ta.value = c.text;
          setMode('view');
          generate();
        });
        wrap.appendChild(b);
      }
      if (group.id !== 'quick') groupsEl.appendChild(host);
    }
    $('#supportedList').textContent = CF.SUPPORTED.join(' · ');
    $('#supportedCount').textContent = `SUPPORTED / ${CF.SUPPORTED.length}`;

    // 編輯器元件盤
    const pal = $('#partPalette');
    for (const id of CF.PART_ORDER) {
      if (id === 'camera') continue;
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
      pal.appendChild(b);
    }
  }

  /* ---------------- 產生（自動模式） ---------------- */
  function generate() {
    const spec = CF.parseRequirement($('#reqInput').value);
    state.plan = CF.buildPlan(spec);
    state.reqIndex++;
    $('#reqTag').textContent = 'REQ.' + String(state.reqIndex).padStart(3, '0');
    if (state.mode === 'view') CF.Board3D.setPlan(state.plan);
    refreshAll();
  }

  function refreshAll() {
    const plan = currentPlan();
    if (!plan) return;
    state.files = CF.genFiles(plan);
    if (state.activeFile >= state.files.length) state.activeFile = 0;
    renderStage(plan);
    renderCode();
    renderWiring(plan);
    renderChecks(plan);
    renderDocs(plan);
    CF.Sim.load(plan);
    renderSimPanel(plan);
  }

  /* ---------------- 模式切換 ---------------- */
  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    CF.Sim.stop();
    $('#modeViewBtn').classList.toggle('active', mode === 'view');
    $('#modeEditBtn').classList.toggle('active', mode === 'edit');
    $('#viewToolbar').hidden = mode !== 'view';
    $('#editToolbar').hidden = mode !== 'edit';
    $('#stage3d').hidden = mode !== 'view';
    $('#stage2d').hidden = mode !== 'edit';
    if (mode === 'edit') {
      if (!state.editorInited) {
        CF.Editor.init($('#editor2d'), { onChange: () => refreshAll() });
        state.editorInited = true;
        CF.Editor.importPlan(state.plan);
        $('#editBoardSel').value = CF.Editor.getState().boardId;
        $('#editConnSel').value = CF.Editor.getState().conn;
      } else {
        CF.Editor.resize();
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
  }

  /* ---------------- 右欄 ---------------- */
  function renderCode() {
    const tabs = $('#fileTabs');
    tabs.innerHTML = '';
    state.files.forEach((f, i) => {
      const b = document.createElement('button');
      b.className = 'file-tab' + (i === state.activeFile ? ' active' : '');
      b.textContent = f.name;
      b.addEventListener('click', () => { state.activeFile = i; renderCode(); });
      tabs.appendChild(b);
    });
    const f = state.files[state.activeFile];
    $('#codeName').textContent = f.name;
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
        CF.reassignPin(state.plan, Number(sel.dataset.net), sel.value);
        state.files = CF.genFiles(state.plan);
        CF.Board3D.setPlan(state.plan);
        renderCode();
        renderWiring(state.plan);
        renderChecks(state.plan);
        renderDocs(state.plan);
        CF.Sim.load(state.plan);
        renderSimPanel(state.plan);
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
      $('#docsMode').textContent = 'GROQ 動態分析';
    } catch (err) {
      $('#groqResult').textContent = 'GROQ 分析失敗：' + err.message + '，已保留內建規則說明。';
      $('#groqResult').hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'GROQ 動態分析';
    }
  }

  /* ---------------- 匯出 ---------------- */
  function exportProject() {
    const plan = currentPlan();
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
    $('#generateBtn').addEventListener('click', () => { setMode('view'); generate(); });
    $('#reqInput').addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { setMode('view'); generate(); }
    });

    $('#modeViewBtn').addEventListener('click', () => setMode('view'));
    $('#modeEditBtn').addEventListener('click', () => setMode('edit'));

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

  /* ---------------- 啟動 ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    buildLeftPanel();
    CF.Board3D.init($('#board3d'));
    $('#reqInput').value = CF.DEFAULT_REQ;
    bind();
    generate();
  });
})();
