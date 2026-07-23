'use strict';
/* 焊點 CIRCUIT FORGE — UI 主控 */
(function () {
  const $ = sel => document.querySelector(sel);
  const state = { plan: null, files: [], activeFile: 0, activeTab: 'code', reqIndex: 0, pinLabels: true, panMode: false };

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ---------------- 語法上色 ---------------- */
  function hlCpp(code) {
    return esc(code).replace(
      /(\/\/[^\n]*)|(&quot;(?:[^&\\\n]|\\.|&(?!quot;)[a-z]+;)*&quot;)|(&lt;[\w.\/]+&gt;)|(^#\w+)|\b(void|bool|int|long|float|double|char|unsigned|const|static|volatile|struct|class|if|else|for|while|return|true|false|String|byte)\b|\b(\d+(?:\.\d+)?[fFuUlL]*)\b/gm,
      (m, cm, str, inc, pre, kw, num) => {
        if (cm) return `<span class="tk-cm">${m}</span>`;
        if (str) return `<span class="tk-str">${m}</span>`;
        if (inc) return `<span class="tk-str">${m}</span>`;
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

  /* ---------------- 左欄：案例 ---------------- */
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
          if (group.append) {
            ta.value = ta.value.trim() ? ta.value.trim() + ' + ' + c.text : `ESP32 + ${c.text}，透過 MQTT 回報數據`;
          } else {
            ta.value = c.text;
          }
          generate();
        });
        wrap.appendChild(b);
      }
      if (group.id !== 'quick') groupsEl.appendChild(host);
    }
    $('#supportedList').textContent = CF.SUPPORTED.join(' · ');
    $('#supportedCount').textContent = `SUPPORTED / ${CF.SUPPORTED.length}`;
  }

  /* ---------------- 產生方案 ---------------- */
  function generate() {
    const spec = CF.parseRequirement($('#reqInput').value);
    state.plan = CF.buildPlan(spec);
    state.files = CF.genFiles(state.plan);
    state.activeFile = 0;
    state.reqIndex++;
    $('#reqTag').textContent = 'REQ.' + String(state.reqIndex).padStart(3, '0');
    CF.Board3D.setPlan(state.plan);
    renderStage();
    renderTabs();
  }

  function refreshAfterPinChange() {
    state.files = CF.genFiles(state.plan);
    CF.Board3D.setPlan(state.plan);
    renderCode();
    renderWiring();
    renderChecks();
    renderDocs();
  }

  /* ---------------- 中欄 ---------------- */
  function renderStage() {
    const plan = state.plan;
    $('#planTitle').textContent = plan.title;
    $('#stageTags').textContent = plan.tags.join(' / ');
    $('#statBoard').textContent = plan.board.display;
    $('#statParts').textContent = String(plan.counts.parts).padStart(2, '0');
    $('#statWires').textContent = String(plan.counts.wires).padStart(2, '0');
    $('#statDone').textContent = plan.connDone;
  }

  /* ---------------- 右欄：分頁 ---------------- */
  function renderTabs() { renderCode(); renderWiring(); renderChecks(); renderDocs(); }

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

  function renderWiring() {
    const plan = state.plan;
    $('#netCount').textContent = `${plan.nets.length} CONNECTIONS`;
    const host = $('#netList');
    host.innerHTML = '';
    plan.nets.forEach(net => {
      const el = document.createElement('div');
      el.className = 'net';
      const idx = String(net.id + 1).padStart(2, '0');
      let pinRow = '';
      if (!net.locked) {
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
        refreshAfterPinChange();
      });
    });
  }

  function renderChecks() {
    const plan = state.plan;
    $('#checkCount').textContent = `${plan.checks.length} RULES`;
    const host = $('#checkList');
    host.innerHTML = '';
    for (const c of plan.checks) {
      const el = document.createElement('div');
      el.className = `check st-${c.status}`;
      const icon = c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : 'i';
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

  function renderDocs() {
    const plan = state.plan;
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

  /* ---------------- GROQ 動態分析（選用，金鑰僅存瀏覽器） ---------------- */
  async function runGroq() {
    const key = localStorage.getItem('cf_groq_key');
    const panel = $('#groqPanel');
    if (!key) { panel.hidden = !panel.hidden; return; }
    const btn = $('#groqBtn');
    btn.disabled = true; btn.textContent = '分析中…';
    try {
      const plan = state.plan;
      const summary = {
        title: plan.title, board: plan.board.name, rail: plan.railV,
        parts: plan.parts.map(p => p.def.name),
        pins: plan.nets.filter(n => n.kind === 'S').map(n => `${n.from} -> ${n.boardPin}`)
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
      const text = data.choices && data.choices[0] && data.choices[0].message.content || '（無回應）';
      $('#groqResult').textContent = text;
      $('#groqResult').hidden = false;
      $('#docsMode').textContent = 'GROQ 動態分析';
    } catch (err) {
      $('#groqResult').textContent = 'GROQ 分析失敗：' + err.message + '，已保留內建規則說明。';
      $('#groqResult').hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'GROQ 動態分析';
    }
  }

  /* ---------------- 匯出專案 ---------------- */
  function exportProject() {
    const plan = state.plan;
    const slug = `circuit-forge-${plan.board.id}${plan.conn !== 'none' ? '-' + plan.conn : ''}`;
    const netRows = plan.nets.map(n => `| ${String(n.id + 1).padStart(2, '0')} | ${n.from} | ${n.to.replace(/^→ /, '')} |`).join('\n');
    const readme = [
      `# ${plan.title}`, '',
      '由「焊點 CIRCUIT FORGE」產生的可編譯 PlatformIO 專案。', '',
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

  /* ---------------- 事件繫結 ---------------- */
  function bind() {
    $('#generateBtn').addEventListener('click', generate);
    $('#reqInput').addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generate();
    });

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
        $('#copyBtn').textContent = '已複製';
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = f.content; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
        $('#copyBtn').textContent = '已複製';
      }
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

    $('#exportBtn').addEventListener('click', exportProject);

    $('#groqBtn').addEventListener('click', runGroq);
    $('#groqSaveKey').addEventListener('click', () => {
      const v = $('#groqKeyInput').value.trim();
      if (v) {
        localStorage.setItem('cf_groq_key', v);
        $('#groqPanel').hidden = true;
        runGroq();
      }
    });
    $('#groqClearKey').addEventListener('click', () => {
      localStorage.removeItem('cf_groq_key');
      $('#groqKeyInput').value = '';
      $('#docsMode').textContent = '內建規則';
      $('#groqResult').hidden = true;
    });
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
