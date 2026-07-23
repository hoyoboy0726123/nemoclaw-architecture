'use strict';
/* NemoClaw 電路實驗室 — 2D 自由編輯器：拖放元件、拉線、麵包板連通圖、電氣規則檢查 (ERC) */
window.CF = window.CF || {};

CF.Editor = (function () {

  const COLS = 40;
  const TOP_ROWS = ['a', 'b', 'c', 'd', 'e'];
  const BOT_ROWS = ['f', 'g', 'h', 'i', 'j'];
  const RAILS = ['tv', 'tg', 'bg', 'bv'];
  const ROW_SEQ = ['tv', 'tg', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'bg', 'bv'];

  const st = {
    canvas: null, ctx: null, w: 0, h: 0, dpr: 1,
    onChange: null,
    boardId: 'esp32', conn: 'mqtt',
    parts: [],          // {uid, id, c0, side:'top'|'bottom'}
    wires: [],          // {uid, a:{c,r}, b:{c,r}}
    tool: 'select',     // select | wire | delete
    placing: null,      // partId 待放置
    ghost: null,        // {c0, side, ok}
    wireStart: null,    // {c,r}
    hover: null,        // {c,r}
    drag: null,         // {uid, offC}
    sel: null,          // {type:'part'|'wire', uid}
    plan: null,
    uidSeq: 1
  };

  /* ---------------- 幾何 ---------------- */
  function geo() {
    const step = st.w / (COLS + 4);
    const ox = step * 2.5;
    const rowGap = Math.min(step * 1.05, st.h / 19);
    const oy = st.h / 2 - rowGap * 6.6;
    const ys = {};
    let y = oy;
    for (const r of ROW_SEQ) {
      ys[r] = y;
      y += rowGap * (r === 'tg' || r === 'e' || r === 'j' ? 1.7 : 1);
    }
    return { step, ox, ys, rowGap, colX: c => ox + c * step };
  }
  function holeXY(g, c, r) { return [g.colX(c), g.ys[r]]; }

  function boardMeta() {
    const b = CF.BOARDS[st.boardId];
    const b0 = st.boardId === 'esp32cam' ? 6 : st.boardId === 'nano' ? 4 : 3;
    const rows = st.boardId === 'nano' ? ['c', 'h'] : ['b', 'i'];
    return { board: b, b0, rowT: rows[0], rowB: rows[1], n: b.pinsTop.length };
  }
  function boardPinHole(name) {
    const m = boardMeta();
    let i = m.board.pinsTop.findIndex(p => p.trim() === name);
    if (i >= 0) return { c: m.b0 + i, r: m.rowT };
    i = m.board.pinsBottom.findIndex(p => p.trim() === name);
    if (i >= 0) return { c: m.b0 + i, r: m.rowB };
    return null;
  }

  function partPins(part) {
    // 回傳 [{name, t, macro, hole:{c,r}}]
    const def = CF.PARTS[part.id];
    const fp = CF.FOOTPRINTS[part.id];
    if (fp.gap) {
      return [
        { name: 'LEG A', t: 'S', macro: 'BUTTON_PIN', hole: { c: part.c0, r: 'e' } },
        { name: 'LEG B', t: 'G', hole: { c: part.c0 + 2, r: 'f' } }
      ];
    }
    const row = part.side === 'top' ? (st.boardId === 'nano' ? 'b' : 'b') : 'i';
    return def.pins.map((p, i) => ({ name: p.n, t: p.t, macro: p.macro, hole: { c: part.c0 + i, r: row } }));
  }

  /* ---------------- 連通圖（union-find） ---------------- */
  function nodeOf(h) {
    if (RAILS.includes(h.r)) return h.r;
    return (TOP_ROWS.includes(h.r) ? 'T' : 'B') + h.c;
  }
  function makeUF() {
    const p = {};
    const find = x => { while (p[x] !== undefined && p[x] !== x) { p[x] = p[p[x]] ?? p[x]; x = p[x]; } return p[x] === undefined ? (p[x] = x) : x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) p[ra] = rb; };
    return { find, union };
  }

  /* 共用：建立連通圖。withPassive=false 時不含電阻橋接（用於限流電阻檢查） */
  function buildUF(withPassive) {
    const m = boardMeta();
    const uf = makeUF();
    for (const w of st.wires) uf.union(nodeOf(w.a), nodeOf(w.b));
    // 板內部：所有 GND 腳彼此相通
    const gndHoles = [];
    m.board.pinsTop.forEach((n, i) => { if (n.trim() === 'GND') gndHoles.push({ c: m.b0 + i, r: m.rowT }); });
    m.board.pinsBottom.forEach((n, i) => { if (n.trim() === 'GND') gndHoles.push({ c: m.b0 + i, r: m.rowB }); });
    for (let i = 1; i < gndHoles.length; i++) uf.union(nodeOf(gndHoles[0]), nodeOf(gndHoles[i]));
    // 被動元件依「直流導通性」決定是否連通兩端：
    //   電阻/電感/LDR/NTC 導通；電容/電解電容/二極體不導通（DC 阻斷或方向性）；
    //   滑動開關依 ON/OFF 狀態。mode==='noRes' 時額外排除電阻（限流電阻檢查用）。
    if (withPassive) {
      for (const ep of st.parts) {
        const def = CF.PARTS[ep.id];
        if (def.cls !== 'PASSIVE') continue;
        const conducts = def.conduct === 'always' || (def.conduct === 'switch' && ep.closed !== false);
        if (!conducts) continue;
        if (withPassive === 'noRes' && ep.id === 'resistor') continue;
        const pp = partPins(ep);
        uf.union(nodeOf(pp[0].hole), nodeOf(pp[1].hole));
      }
    }
    return { uf, gndHoles };
  }

  /* ---------------- 推導方案 + ERC ---------------- */
  function derive() {
    const m = boardMeta();
    const board = m.board;
    const { uf, gndHoles } = buildUF(true);
    const ufNoP = buildUF('noRes').uf;   // 不經電阻的連通（限流電阻檢查用）

    const gndNet = gndHoles.length ? uf.find(nodeOf(gndHoles[0])) : null;
    const powerNets = {};   // 電壓 → net
    const p33 = boardPinHole('3V3');
    if (p33) powerNets['3V3'] = uf.find(nodeOf(p33));
    const p5 = boardPinHole('5V') || boardPinHole('VIN');
    if (p5) powerNets['5V'] = uf.find(nodeOf(p5));

    // 板上所有 GPIO 腳 → net
    const gpioNets = [];
    const collect = (list, row) => list.forEach((n, i) => {
      const nm = n.trim();
      if (/^(GPIO|D\d|A\d)/.test(nm) && nm !== 'A4' + '_') {
        gpioNets.push({ name: nm, net: uf.find(nodeOf({ c: m.b0 + i, r: row })) });
      }
    });
    collect(board.pinsTop, m.rowT);
    collect(board.pinsBottom, m.rowB);

    const checks = [];
    const err = (name, desc) => checks.push({ status: 'error', name, desc });
    const warn = (name, desc) => checks.push({ status: 'warn', name, desc });
    const info = (name, desc) => checks.push({ status: 'info', name, desc });
    const pass = (name, desc) => checks.push({ status: 'pass', name, desc });

    // 短路檢查
    if (powerNets['3V3'] && powerNets['5V'] && powerNets['3V3'] === powerNets['5V']) err('電源短路', '3V3 與 5V 電源軌被接在一起，通電會損壞穩壓器。');
    for (const [v, net] of Object.entries(powerNets)) {
      if (gndNet && net === gndNet) err('電源對地短路', `${v} 與 GND 直接相連，通電即短路。`);
    }

    // 零件檢查 + 腳位指派
    const parts = [];
    let railUsed = null;
    let sigCount = 0, wired = 0;
    const gpioUse = {};   // gpioName → [pinLabel]
    const seriesCheck = [];  // 需要限流電阻檢查的腳：{def, pinName, hole, assigned, level}
    for (const ep of st.parts) {
      const def = CF.PARTS[ep.id];
      const pins = partPins(ep).map(p => ({ n: p.name, t: normType(def, p), macro: p.macro || findMacro(def, p.name), assigned: null }));
      const raw = partPins(ep);
      raw.forEach((rp, i) => {
        const net = uf.find(nodeOf(rp.hole));
        const pin = pins[i];
        if (pin.t === 'P') return;   // 被動元件端點不做腳位檢查
        if (pin.t === 'V') {
          const hit = Object.entries(powerNets).find(([, n]) => n === net);
          if (!hit) err(`${def.name} 未供電`, `${pin.n} 沒有接到任何電源軌／電源腳。`);
          else {
            railUsed = railUsed || hit[0];
            if (def.needs5V && hit[0] === '3V3') warn(`${def.name} 電壓偏低`, `${pin.n} 接在 3V3，此模組建議 5V 供電。`);
          }
        } else if (pin.t === 'G') {
          if (gndNet === null || net !== gndNet) err(`${def.name} 未接地`, `${pin.n} 沒有接回 GND。`);
        } else {
          sigCount++;
          const hits = gpioNets.filter(g => g.net === net);
          const names = [...new Set(hits.map(h => h.name))];
          if (!names.length) err(`${def.name} 訊號未連接`, `${pin.n} 沒有接到任何 GPIO 腳。`);
          else if (names.length > 1) warn(`${def.name} 訊號節點含多支腳`, `${pin.n} 同時連到 ${names.join('、')}，請確認是否刻意共用。`);
          if (names.length) {
            pin.assigned = names[0];
            wired++;
            const key = names[0] + '|' + busKind(pin);
            (gpioUse[key] = gpioUse[key] || []).push(`${def.name} ${pin.n}`);
            // 類比腳位檢查
            if (pin.t === 'A' && board.analogPool.length && !board.analogPool.includes(names[0])) {
              warn(`${def.name} 需要類比腳位`, `${pin.n} 接在 ${names[0]}，該腳無 ADC 功能，請改接 ${board.analogPool.join('、')}。`);
            }
            // LED／WS2812 限流電阻檢查（稍後用無電阻連通圖判斷）
            if (ep.id === 'led' && pin.n === 'ANODE') seriesCheck.push({ def, pinName: pin.n, hole: rp.hole, assigned: names[0], level: 'warn' });
            if (ep.id === 'ws2812' && pin.n === 'DIN') seriesCheck.push({ def, pinName: pin.n, hole: rp.hole, assigned: names[0], level: 'info' });
          }
        }
      });
      const entry = { id: ep.id, def, pins, side: ep.side, uid: ep.uid };
      if (def.cls === 'PASSIVE') { entry.value = ep.value || def.defaultValue; entry.closed = ep.closed; }
      parts.push(entry);
    }

    // 限流電阻檢查：訊號若「不經電阻」就直達 GPIO → 提醒
    for (const sc of seriesCheck) {
      const gpioHole = boardPinHole(sc.assigned);
      if (!gpioHole) continue;
      const direct = ufNoP.find(nodeOf(sc.hole)) === ufNoP.find(nodeOf(gpioHole));
      if (direct) {
        if (sc.level === 'warn') warn('缺少限流電阻', `${sc.def.name} ${sc.pinName} 直接接到 ${sc.assigned}，請串聯 220Ω 電阻保護 LED 與 GPIO。`);
        else info('建議串接電阻', `${sc.def.name} ${sc.pinName} 建議串 330Ω 電阻，抑制訊號反射。`);
      } else {
        pass('限流電阻', `${sc.def.name} ${sc.pinName} 已透過電阻串接到 ${sc.assigned}。`);
      }
    }
    if (st.parts.some(p => p.id === 'pump')) info('水泵驅動', '實體接線請經繼電器／MOSFET 模組驅動水泵，勿由 GPIO 直接供電。');

    // 極性與開關檢查（電解電容／二極體／滑動開關）
    const onV = n => Object.values(powerNets).includes(n);
    const onG = n => gndNet !== null && n === gndNet;
    for (const ep of st.parts) {
      const def = CF.PARTS[ep.id];
      if (def.cls !== 'PASSIVE') continue;
      const pp = partPins(ep);
      const holes = pp.map(p => `${p.hole.c}|${p.hole.r}`);
      const touched = st.wires.some(w => holes.includes(`${w.a.c}|${w.a.r}`) || holes.includes(`${w.b.c}|${w.b.r}`));
      if (!touched) continue;
      const nA = uf.find(nodeOf(pp[0].hole));
      const nB = uf.find(nodeOf(pp[1].hole));
      if (ep.id === 'diode') {
        if (onV(nA) && onG(nB)) err('二極體順向短路', '陽極 A 接電源、陰極 K 接地＝順向導通直通地，等同短路。反接保護應將 K 朝電源側。');
        else if (onG(nA) && onV(nB)) pass('保護二極體', '二極體反向跨接電源（截止），反接保護方向正確。');
      }
      if (ep.id === 'ecap') {
        if (onG(nA) && onV(nB)) err('電解電容反接', '「＋」極接到 GND、「−」極接到電源——反接會損壞甚至爆裂，請反轉方向。');
        else if (onV(nA) && onG(nB)) pass('去耦電容', '電解電容方向正確，已跨接電源軌儲能。');
      }
      if (ep.id === 'capacitor' && ((onV(nA) && onG(nB)) || (onG(nA) && onV(nB)))) {
        pass('去耦電容', '陶瓷電容已跨接電源與 GND，可吸收高頻雜訊。');
      }
      if (ep.id === 'switch' && ep.closed === false) {
        info('開關為 OFF', '滑動開關目前切在 OFF，經過它的路徑不導通；點兩下可切換。');
      }
    }

    // GPIO 重複（I2C 同號腳共用 SDA/SCL 允許）
    for (const [key, users] of Object.entries(gpioUse)) {
      if (users.length > 1 && !key.endsWith('|SDA') && !key.endsWith('|SCL')) {
        err('GPIO 衝突', `${key.split('|')[0]} 被 ${users.join(' 與 ')} 同時使用。`);
      }
    }
    // I2C 腳一致性：所有 SDA 需同腳、所有 SCL 需同腳
    const sdaPins = new Set(), sclPins = new Set();
    for (const part of parts) for (const pin of part.pins) {
      if (pin.assigned && busKind(pin) === 'SDA') sdaPins.add(pin.assigned);
      if (pin.assigned && busKind(pin) === 'SCL') sclPins.add(pin.assigned);
    }
    if (sdaPins.size > 1) err('I2C 匯流排分裂', `SDA 分別接在 ${[...sdaPins].join('、')}，同一匯流排必須共用同一支腳。`);
    if (sclPins.size > 1) err('I2C 匯流排分裂', `SCL 分別接在 ${[...sclPins].join('、')}，同一匯流排必須共用同一支腳。`);
    if (st.boardId === 'nano' && (sdaPins.size || sclPins.size)) {
      if (![...sdaPins].every(p => p === 'A4') || ![...sclPins].every(p => p === 'A5')) {
        err('Nano I2C 腳位固定', 'Arduino Nano 的硬體 I2C 只能用 A4 (SDA) 與 A5 (SCL)。');
      }
    }

    // strapping pin 提醒
    if (st.boardId !== 'nano') {
      const strap = ['GPIO 0', 'GPIO 2', 'GPIO 12', 'GPIO 15'];
      const hit = [...new Set(parts.flatMap(p => p.pins.map(x => x.assigned)).filter(a => strap.includes(a)))];
      if (hit.length) info('開機腳位提醒', `${hit.join('、')} 為 strapping pin，上電瞬間避免被強制拉高／拉低。`);
    }
    if (parts.some(p => p.id === 'led')) info('LED 限流', '實體接線請於 LED 陽極串聯 220Ω 電阻。');

    const errN = checks.filter(c => c.status === 'error').length;
    if (!st.parts.length) info('空白工作台', '從上方元件盤點選元件放到麵包板，再用拉線工具接電源與訊號。');
    else if (!errN) {
      pass('連通性', `全部 ${st.parts.length} 個元件供電、接地與訊號皆已正確連通。`);
      pass('電氣規則', '無短路、無 GPIO 衝突、電壓相容。');
    }

    // 建立與自動模式相容的 plan（餵 codegen / WIRING / SIM）
    const railV = railUsed || (st.boardId === 'esp32' ? '3V3' : '5V');
    const boardForPlan = Object.assign({}, board);
    if (sdaPins.size === 1 && sclPins.size === 1) {
      boardForPlan.i2c = { sda: [...sdaPins][0], scl: [...sclPins][0] };
    }
    const conn = CF.CONNS[board.wifi ? st.conn : 'none'];
    const nets = [];
    const railVLabel = `麵包板 紅色 ${railV} 正電源軌`;
    for (const part of parts) {
      for (const pin of part.pins) {
        if (pin.t === 'P') continue;   // 被動元件不列入網表
        if (pin.t === 'V') nets.push({ kind: 'V', from: `${part.def.name} ${pin.n}`, to: `→ ${railVLabel}`, note: '電源／共用', badge: 'POWER', locked: true });
        else if (pin.t === 'G') nets.push({ kind: 'G', from: `${part.def.name} ${pin.n}`, to: '→ 麵包板 藍色 GND 負電源軌', note: '電源／共用', badge: 'POWER', locked: true });
        else nets.push({
          kind: 'S', from: `${part.def.name} ${pin.n}`,
          to: pin.assigned ? `→ ${board.name} ${pin.assigned}` : '→ （未連接）',
          note: pin.assigned ? '訊號線（編輯器接線）' : '尚未接到 GPIO', badge: pin.assigned ? 'SIGNAL' : 'OPEN', locked: true
        });
      }
    }
    nets.forEach((n, i) => { n.id = i; });

    const partNames = parts.map(p => p.def.titleName).join(' + ');
    st.plan = {
      spec: { boardId: st.boardId, conn: conn.id, flags: {}, text: '自由接線' },
      board: boardForPlan, parts, nets, railV,
      powerPin: railV === '3V3' ? board.powerPin3V3 : board.powerPin5V,
      conn: conn.id, connLabel: conn.label, connDone: errN ? '接線未完成' : conn.label ? `接線與 ${conn.label} 已建立` : '接線已建立',
      title: `${board.short} · 自由接線${partNames ? '：' + partNames : ''}${conn.label ? ' / ' + conn.label : ''}`,
      tags: ['FREE WIRING'].concat(board.wifi && conn.id !== 'none' ? ['WIFI', conn.label] : []),
      counts: { parts: 1 + parts.length, wires: st.wires.length },
      checks,
      editor: true, errN
    };
    return st.plan;
  }
  function normType(def, p) {
    const dp = def.pins.find(x => x.n === p.name);
    return dp ? (dp.t === 'A' ? 'A' : dp.t) : p.t;
  }
  function findMacro(def, name) {
    const dp = def.pins.find(x => x.n === name);
    return dp && dp.macro;
  }
  function busKind(pin) {
    if (pin.t === 'I2C_SDA' || pin.n === 'SDA') return 'SDA';
    if (pin.t === 'I2C_SCL' || pin.n === 'SCL') return 'SCL';
    return pin.n;
  }

  /* ---------------- 自動匯入目前方案 ---------------- */
  function importPlan(plan) {
    st.boardId = plan.spec.boardId;
    st.conn = plan.conn === 'tm' ? 'web' : plan.conn;
    st.parts = [];
    st.wires = [];
    const m = boardMeta();
    let topCur = m.b0 + m.n + 3;
    let botCur = m.b0 + m.n + 4;
    const botRank = { INPUT: 0, DISPLAY: 1, SENSOR: 2, OUTPUT: 3, ACTUATOR: 4 };
    const tops = plan.parts.filter(p => !p.def.onboard && p.side === 'top');
    const bots = plan.parts.filter(p => !p.def.onboard && p.side !== 'top')
      .slice().sort((a, b) => (botRank[a.def.cls] ?? 9) - (botRank[b.def.cls] ?? 9));
    for (const p of tops) {
      st.parts.push({ uid: st.uidSeq++, id: p.id, c0: Math.min(topCur, COLS - 5), side: 'top', ref: p });
      topCur += (CF.FOOTPRINTS[p.id].bodyW || CF.FOOTPRINTS[p.id].w) + 2;
    }
    for (const p of bots) {
      if (p.def.cls !== 'INPUT' && botCur < topCur + 2) botCur = topCur + 2;
      st.parts.push({ uid: st.uidSeq++, id: p.id, c0: Math.min(botCur, COLS - 5), side: 'bottom', ref: p });
      botCur += (CF.FOOTPRINTS[p.id].bodyW || CF.FOOTPRINTS[p.id].w) + 3;
    }
    // 板子電源 → 上排軌
    const pw = boardPinHole(plan.powerPin) || boardPinHole('3V3');
    const gd = boardPinHole('GND');
    if (pw) addWire(pw, { c: pw.c, r: RAILS.includes(pw.r) ? pw.r : (TOP_ROWS.includes(pw.r) ? 'tv' : 'bv') });
    if (gd) addWire(gd, { c: gd.c, r: 'tg' });
    // 各元件
    let bottomUsed = false;
    for (const ep of st.parts) {
      const pins = partPins(ep);
      const refPins = ep.ref.pins;
      for (const p of pins) {
        const top = TOP_ROWS.includes(p.r = p.hole.r) ? true : false;
        if (p.t === 'V' || (CF.PARTS[ep.id].pins.find(x => x.n === p.name) || {}).t === 'V') {
          addWire(p.hole, { c: p.hole.c, r: top ? 'tv' : 'bv' });
          if (!top) bottomUsed = true;
        } else if (p.t === 'G' || (CF.PARTS[ep.id].pins.find(x => x.n === p.name) || {}).t === 'G') {
          addWire(p.hole, { c: p.hole.c, r: top ? 'tg' : 'bg' });
          if (!top) bottomUsed = true;
        } else {
          const rp = refPins.find(x => x.n === p.name);
          if (rp && rp.assigned) {
            const bh = boardPinHole(rp.assigned);
            if (bh) addWire(p.hole, bh);
          }
        }
      }
    }
    if (bottomUsed) { addWire({ c: 0, r: 'tv' }, { c: 0, r: 'bv' }); addWire({ c: 1, r: 'tg' }, { c: 1, r: 'bg' }); }
    st.parts.forEach(p => delete p.ref);
    st.sel = null; st.wireStart = null; st.placing = null;
    changed();
  }
  function addWire(a, b) { st.wires.push({ uid: st.uidSeq++, a: { c: a.c, r: a.r }, b: { c: b.c, r: b.r } }); }

  /* ---------------- 繪製 ---------------- */
  function wireKindColor(w, uf, powerNets, gndNet) {
    const n = uf.find(nodeOf(w.a));
    if (gndNet && n === gndNet) return '#3b62c4';
    for (const net of Object.values(powerNets)) if (n === net) return '#c2402a';
    return '#b7791f';
  }

  function render() {
    const { ctx } = st;
    if (!ctx) return;
    const g = geo();
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    ctx.clearRect(0, 0, st.w, st.h);

    // 麵包板底
    const bx0 = g.colX(0) - g.step * 1.4, bx1 = g.colX(COLS - 1) + g.step * 1.4;
    const by0 = g.ys.tv - g.rowGap * 1.4, by1 = g.ys.bv + g.rowGap * 1.4;
    ctx.fillStyle = '#f8f3e7';
    ctx.strokeStyle = '#ddd3bd';
    ctx.lineWidth = 1.5;
    roundRect(ctx, bx0, by0, bx1 - bx0, by1 - by0, 10);
    ctx.fill(); ctx.stroke();
    // 中央溝槽
    const gy = (g.ys.e + g.ys.f) / 2;
    ctx.fillStyle = '#e7dcc4';
    ctx.fillRect(bx0, gy - g.rowGap * 0.42, bx1 - bx0, g.rowGap * 0.84);
    // 軌道線
    const railLine = (y, color) => { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx0 + 8, y); ctx.lineTo(bx1 - 8, y); ctx.stroke(); };
    railLine(g.ys.tv - g.rowGap * 0.55, '#d84b31');
    railLine(g.ys.tg + g.rowGap * 0.55, '#3f6bd6');
    railLine(g.ys.bg - g.rowGap * 0.55, '#3f6bd6');
    railLine(g.ys.bv + g.rowGap * 0.55, '#d84b31');
    ctx.font = '600 11px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#c2402a';
    ctx.fillText('+', bx0 - 14, g.ys.tv + 4); ctx.fillText('+', bx0 - 14, g.ys.bv + 4);
    ctx.fillStyle = '#3b62c4';
    ctx.fillText('−', bx0 - 14, g.ys.tg + 4); ctx.fillText('−', bx0 - 14, g.ys.bg + 4);

    // 孔
    for (let c = 0; c < COLS; c++) {
      for (const r of ROW_SEQ) {
        if (RAILS.includes(r) && c % 6 === 5) continue;
        const [x, y] = holeXY(g, c, r);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2, g.step * 0.16), 0, Math.PI * 2);
        ctx.fillStyle = '#c9c0ab';
        ctx.fill();
      }
    }
    // hover 孔
    if (st.hover) {
      const [x, y] = holeXY(g, st.hover.c, st.hover.r);
      ctx.beginPath();
      ctx.arc(x, y, g.step * 0.32, 0, Math.PI * 2);
      ctx.strokeStyle = '#0e7a6e';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // ─ 開發板 ─
    const m = boardMeta();
    const px0 = g.colX(m.b0) - g.step * 0.7, px1 = g.colX(m.b0 + m.n - 1) + g.step * 0.7;
    const pyT = g.ys[m.rowT], pyB = g.ys[m.rowB];
    ctx.fillStyle = '#2c6e4e';
    ctx.strokeStyle = '#1d4c35';
    roundRect(ctx, px0, pyT - g.rowGap * 0.55, px1 - px0, (pyB - pyT) + g.rowGap * 1.1, 8);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e9f2ec';
    ctx.font = '700 12px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(m.board.name, (px0 + px1) / 2, (pyT + pyB) / 2 + 4);
    ctx.textAlign = 'left';
    // 板腳金點
    for (let i = 0; i < m.n; i++) {
      for (const r of [m.rowT, m.rowB]) {
        const [x, y] = holeXY(g, m.b0 + i, r);
        ctx.beginPath(); ctx.arc(x, y, g.step * 0.14, 0, Math.PI * 2);
        ctx.fillStyle = '#c9a53f'; ctx.fill();
      }
    }
    // hover 板腳名稱
    if (st.hover) {
      const i = st.hover.c - m.b0;
      if (i >= 0 && i < m.n && (st.hover.r === m.rowT || st.hover.r === m.rowB)) {
        const nm = (st.hover.r === m.rowT ? m.board.pinsTop : m.board.pinsBottom)[i].trim();
        const [x, y] = holeXY(g, st.hover.c, st.hover.r);
        tooltip(ctx, x, y - 16, nm);
      }
    }

    // ─ 連通圖（供線色） ─
    const uf = buildUF(true).uf;
    const gh = boardPinHole('GND');
    const gndNet = gh ? uf.find(nodeOf(gh)) : null;
    const powerNets = {};
    const p3 = boardPinHole('3V3'); if (p3) powerNets['3V3'] = uf.find(nodeOf(p3));
    const p5 = boardPinHole('5V') || boardPinHole('VIN'); if (p5) powerNets['5V'] = uf.find(nodeOf(p5));

    // ─ 導線 ─
    for (const w of st.wires) {
      const [x1, y1] = holeXY(g, w.a.c, w.a.r);
      const [x2, y2] = holeXY(g, w.b.c, w.b.r);
      const selected = st.sel && st.sel.type === 'wire' && st.sel.uid === w.uid;
      drawWire(ctx, x1, y1, x2, y2, wireKindColor(w, uf, powerNets, gndNet), selected);
    }
    // 拉線預覽
    if (st.wireStart && st.hover) {
      const [x1, y1] = holeXY(g, st.wireStart.c, st.wireStart.r);
      const [x2, y2] = holeXY(g, st.hover.c, st.hover.r);
      ctx.setLineDash([6, 5]);
      drawWire(ctx, x1, y1, x2, y2, '#0e7a6e', false);
      ctx.setLineDash([]);
    }

    // ─ 元件 ─
    for (const ep of st.parts) drawPart(ctx, g, ep, st.sel && st.sel.type === 'part' && st.sel.uid === ep.uid, 1);
    // 放置 ghost
    if (st.placing && st.ghost) {
      drawPart(ctx, g, { id: st.placing, c0: st.ghost.c0, side: st.ghost.side }, false, st.ghost.ok ? 0.55 : 0.3, !st.ghost.ok);
    }
  }

  function drawPart(ctx, g, ep, selected, alpha, bad) {
    const fp = CF.FOOTPRINTS[ep.id];
    const def = CF.PARTS[ep.id];
    ctx.globalAlpha = alpha;
    const pins = partPinsFor(ep);
    // 腳
    for (const p of pins) {
      const [x, y] = holeXY(g, p.hole.c, p.hole.r);
      ctx.beginPath(); ctx.arc(x, y, g.step * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = '#8a8375'; ctx.fill();
    }
    // 本體
    const bw = fp.bodyW || fp.w;
    let x0, y0, w, h;
    if (fp.gap) {
      const gy = (g.ys.e + g.ys.f) / 2;
      x0 = g.colX(ep.c0) - g.step * 0.5; w = g.step * (bw - 1) + g.step;
      y0 = gy - g.rowGap * 1.1; h = g.rowGap * 2.2;
    } else if (fp.passive) {
      // 電阻：平躺橫跨兩孔
      const row = ep.side === 'top' ? 'b' : 'i';
      const py = g.ys[row];
      x0 = g.colX(ep.c0) - g.step * 0.35; w = g.step * (fp.w - 1) + g.step * 0.7;
      h = g.rowGap * 0.9;
      y0 = py - h / 2;
    } else {
      const row = ep.side === 'top' ? 'b' : 'i';
      const py = g.ys[row];
      x0 = g.colX(ep.c0) - g.step * 0.5; w = g.step * (bw - 1) + g.step;
      h = g.rowGap * 2.4;
      y0 = ep.side === 'top' ? py - h - g.rowGap * 0.35 : py + g.rowGap * 0.35;
    }
    ctx.fillStyle = bad ? '#c2402a' : fp.color;
    ctx.strokeStyle = selected ? '#0e7a6e' : 'rgba(0,0,0,.25)';
    ctx.lineWidth = selected ? 2.5 : 1;
    roundRect(ctx, x0, y0, w, h, 6);
    ctx.fill(); ctx.stroke();
    // 腳到本體的短線
    for (const p of pins) {
      const [x, y] = holeXY(g, p.hole.c, p.hole.r);
      ctx.strokeStyle = '#8a8375'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x, y0 > y ? y0 : y0 + h);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.max(9, g.step * 0.55)}px "IBM Plex Mono","Noto Sans TC",monospace`;
    ctx.textAlign = 'center';
    let label = def.titleName;
    if (fp.passive) {
      if (def.conduct === 'switch') label = ep.closed === false ? 'OFF' : 'ON';
      else label = String(ep.value || def.defaultValue || '');
    }
    if (fp.passive && def.conduct === 'switch') {
      ctx.fillStyle = ep.closed === false ? '#e8e4da' : '#7fe8c9';
    }
    ctx.fillText(label, x0 + w / 2, y0 + h / 2 + 4, w - 4);
    ctx.textAlign = 'left';
    // 極性標記：電解電容「+」、二極體「▸」（A→K 方向）
    if (fp.passive && def.polarized) {
      ctx.fillStyle = '#ffd9a0';
      ctx.font = `700 ${Math.max(9, g.step * 0.5)}px "IBM Plex Mono",monospace`;
      ctx.fillText(def.id === 'diode' ? '▸' : '+', x0 + 2, y0 - 3);
    }
    ctx.globalAlpha = 1;
    // hover 腳名
    if (st.hover) {
      const p = pins.find(p => p.hole.c === st.hover.c && p.hole.r === st.hover.r);
      if (p) {
        const [x, y] = holeXY(g, p.hole.c, p.hole.r);
        tooltip(ctx, x, y + 22, `${def.titleName} · ${p.name}`);
      }
    }
    ep._bbox = { x0, y0, w, h };
  }
  function partPinsFor(ep) { return partPins(ep); }

  function drawWire(ctx, x1, y1, x2, y2, color, selected) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(46, len * 0.22);
    const cx = mx - (dy / len) * bow, cy = my + (dx / len) * bow;
    if (selected) {
      ctx.strokeStyle = 'rgba(14,122,110,.35)';
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x1, y1, 3.2, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.beginPath(); ctx.arc(x2, y2, 3.2, 0, Math.PI * 2); ctx.fill();
  }

  function tooltip(ctx, x, y, text) {
    ctx.font = '600 11px "IBM Plex Mono","Noto Sans TC",monospace';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(25,23,19,.92)';
    roundRect(ctx, x - w / 2, y - 9, w, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#f5f2ea';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y + 4);
    ctx.textAlign = 'left';
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------- 互動 ---------------- */
  function pickHole(x, y) {
    const g = geo();
    let best = null, bd = g.step * 0.55;
    for (let c = 0; c < COLS; c++) {
      const hx = g.colX(c);
      if (Math.abs(hx - x) > bd) continue;
      for (const r of ROW_SEQ) {
        if (RAILS.includes(r) && c % 6 === 5) continue;
        const d = Math.hypot(hx - x, g.ys[r] - y);
        if (d < bd) { bd = d; best = { c, r }; }
      }
    }
    return best;
  }
  function pickPart(x, y) {
    for (let i = st.parts.length - 1; i >= 0; i--) {
      const b = st.parts[i]._bbox;
      if (b && x >= b.x0 && x <= b.x0 + b.w && y >= b.y0 && y <= b.y0 + b.h) return st.parts[i];
    }
    return null;
  }
  function pickWire(x, y) {
    const g = geo();
    for (let i = st.wires.length - 1; i >= 0; i--) {
      const w = st.wires[i];
      const [x1, y1] = holeXY(g, w.a.c, w.a.r);
      const [x2, y2] = holeXY(g, w.b.c, w.b.r);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const bow = Math.min(46, len * 0.22);
      const cx = mx - (dy / len) * bow, cy = my + (dx / len) * bow;
      for (let t = 0; t <= 1; t += 0.05) {
        const px = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2;
        const py = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
        if (Math.hypot(px - x, py - y) < 7) return w;
      }
    }
    return null;
  }
  function overlaps(partId, c0, side) {
    const fp = CF.FOOTPRINTS[partId];
    const m = boardMeta();
    const range = [c0, c0 + (fp.bodyW || fp.w) - 1];
    if (c0 < 0 || range[1] > COLS - 1) return true;
    // 與板子重疊
    if (range[1] >= m.b0 && range[0] <= m.b0 + m.n - 1) return true;
    for (const other of st.parts) {
      if (st.drag && other.uid === st.drag.uid) continue;
      const ofp = CF.FOOTPRINTS[other.id];
      const sameZone = ofp.gap || fp.gap ? true : other.side === side;
      const gapMargin = (fp.passive || ofp.passive) ? 0 : 1;   // 被動元件允許緊貼
      const ow = ofp.bodyW || ofp.w;
      if (sameZone && range[1] >= other.c0 - gapMargin && range[0] <= other.c0 + ow - 1 + gapMargin) return true;
    }
    return false;
  }

  function localXY(e) {
    const rect = st.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onMove(e) {
    const [x, y] = localXY(e);
    st.hover = pickHole(x, y);
    if (st.placing) {
      const g = geo();
      const fp = CF.FOOTPRINTS[st.placing];
      const c0 = Math.round((x - g.ox) / g.step - (fp.w - 1) / 2);
      const side = y < (g.ys.e + g.ys.f) / 2 ? 'top' : 'bottom';
      st.ghost = { c0, side, ok: !overlaps(st.placing, c0, side) };
    }
    if (st.drag) {
      const g = geo();
      const ep = st.parts.find(p => p.uid === st.drag.uid);
      const fp = CF.FOOTPRINTS[ep.id];
      const c0 = Math.round((x - g.ox) / g.step - (fp.w - 1) / 2);
      const side = fp.gap ? ep.side : (y < (g.ys.e + g.ys.f) / 2 ? 'top' : 'bottom');
      if (!overlaps(ep.id, c0, side)) { ep.c0 = c0; ep.side = side; st.drag.moved = true; }
    }
    render();
  }

  function onDown(e) {
    const [x, y] = localXY(e);
    if (st.placing) {
      if (st.ghost && st.ghost.ok) {
        const np = { uid: st.uidSeq++, id: st.placing, c0: st.ghost.c0, side: st.ghost.side };
        const pdef = CF.PARTS[st.placing];
        if (pdef.cls === 'PASSIVE') { np.value = pdef.defaultValue; if (pdef.conduct === 'switch') np.closed = true; }
        st.parts.push(np);
        st.placing = null; st.ghost = null;
        changed();
      }
      return;
    }
    if (st.tool === 'wire') {
      const h = pickHole(x, y);
      if (!h) { st.wireStart = null; render(); return; }
      if (!st.wireStart) { st.wireStart = h; render(); return; }
      if (st.wireStart.c !== h.c || st.wireStart.r !== h.r) {
        addWire(st.wireStart, h);
        st.wireStart = null;
        changed();
      }
      return;
    }
    if (st.tool === 'delete') {
      const p = pickPart(x, y);
      if (p) { st.parts = st.parts.filter(q => q.uid !== p.uid); changed(); return; }
      const w = pickWire(x, y);
      if (w) { st.wires = st.wires.filter(q => q.uid !== w.uid); changed(); return; }
      return;
    }
    // select
    const p = pickPart(x, y);
    if (p) { st.sel = { type: 'part', uid: p.uid }; st.drag = { uid: p.uid }; render(); return; }
    const w = pickWire(x, y);
    if (w) { st.sel = { type: 'wire', uid: w.uid }; render(); return; }
    st.sel = null;
    render();
  }
  function onUp() {
    if (st.drag) {
      const moved = st.drag.moved;
      st.drag = null;
      if (moved) changed(); else render();
    }
  }
  function onKey(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
      if (st.sel.type === 'part') st.parts = st.parts.filter(q => q.uid !== st.sel.uid);
      else st.wires = st.wires.filter(q => q.uid !== st.sel.uid);
      st.sel = null;
      changed();
    }
    if (e.key === 'Escape') { st.placing = null; st.wireStart = null; render(); }
  }

  /* 規格值輸入框（自由輸入，例如 4.7k、100nF、470Ω） */
  function openValueEditor(ep) {
    const def = CF.PARTS[ep.id];
    const b = ep._bbox;
    if (!b) return;
    const old = st.canvas.parentElement.querySelector('.pval-input');
    if (old) old.remove();
    const input = document.createElement('input');
    input.className = 'pval-input';
    input.value = ep.value || def.defaultValue || '';
    input.maxLength = 12;
    input.style.left = Math.max(4, b.x0) + 'px';
    input.style.top = Math.max(4, b.y0 - 30) + 'px';
    st.canvas.parentElement.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const commit = ok => {
      if (done) return;
      done = true;
      if (ok) {
        const v = input.value.trim().slice(0, 12);
        if (v) ep.value = v;
      }
      input.remove();
      changed();
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') commit(true);
      if (e.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', () => commit(true));
  }

  function changed() {
    derive();
    render();
    if (st.onChange) st.onChange(st.plan);
  }

  function resize() {
    if (!st.canvas) return;
    const rect = st.canvas.parentElement.getBoundingClientRect();
    st.dpr = Math.min(2, window.devicePixelRatio || 1);
    st.w = Math.max(300, rect.width);
    st.h = Math.max(240, rect.height);
    st.canvas.width = st.w * st.dpr;
    st.canvas.height = st.h * st.dpr;
    st.canvas.style.width = st.w + 'px';
    st.canvas.style.height = st.h + 'px';
    render();
  }

  /* ---------------- Agent 專用：自動放置＋自動接線 ---------------- */
  function agentAddPart(partId) {
    const def = CF.PARTS[partId];
    const fp = CF.FOOTPRINTS[partId];
    if (!def || !fp) return { ok: false, error: `未知元件 ${partId}` };
    const m = boardMeta();
    const side = def.cls === 'SENSOR' && partId !== 'pir' ? 'top' : 'bottom';
    let c0 = m.b0 + m.n + 3;
    while (c0 < COLS - (fp.bodyW || fp.w) && overlaps(partId, c0, side)) c0++;
    if (overlaps(partId, c0, side)) return { ok: false, error: '麵包板空間不足' };
    const np = { uid: st.uidSeq++, id: partId, c0, side };
    if (def.cls === 'PASSIVE') { np.value = def.defaultValue; if (def.conduct === 'switch') np.closed = true; }
    st.parts.push(np);

    const assigned = [];
    if (def.cls !== 'PASSIVE') {
      // 確保板子電源軌已建立
      const uf0 = buildUF(false).uf;
      const pw = boardPinHole(m.board.powerPin5V) || boardPinHole(m.board.powerPin3V3);
      const gd = boardPinHole('GND');
      if (pw && uf0.find(nodeOf(pw)) !== uf0.find('tv')) addWire(pw, { c: pw.c, r: TOP_ROWS.includes(pw.r) ? 'tv' : 'bv' });
      if (gd && uf0.find(nodeOf(gd)) !== uf0.find('tg')) addWire(gd, { c: gd.c, r: 'tg' });
      // 目前已占用的 GPIO
      const cur = derive();
      const used = new Set();
      for (const p of cur.parts) for (const pin of p.pins) if (pin.assigned) used.add(pin.assigned);
      const top = side === 'top';
      for (const p of partPins(np)) {
        const t = normType(def, p);
        if (t === 'V') { addWire(p.hole, { c: p.hole.c, r: top ? 'tv' : 'bv' }); }
        else if (t === 'G') { addWire(p.hole, { c: p.hole.c, r: top ? 'tg' : 'bg' }); }
        else if (t === 'I2C_SDA' || t === 'I2C_SCL') {
          const bp = boardPinHole(t === 'I2C_SDA' ? m.board.i2c.sda : m.board.i2c.scl);
          if (bp) { addWire(p.hole, bp); assigned.push(`${p.name} → ${t === 'I2C_SDA' ? m.board.i2c.sda : m.board.i2c.scl}`); }
        } else {
          const macro = p.macro || findMacro(def, p.name);
          const pool = t === 'A' && m.board.analogPool.length ? m.board.analogPool : m.board.digitalPool;
          let gpio = m.board.prefer[macro];
          if (!gpio || used.has(gpio) || !pool.includes(gpio)) gpio = pool.find(x => !used.has(x));
          if (gpio) {
            used.add(gpio);
            const bp = boardPinHole(gpio);
            if (bp) { addWire(p.hole, bp); assigned.push(`${p.name} → ${gpio}`); }
          }
        }
      }
      // 下排電源軌橋接
      if (side === 'bottom') {
        const uf1 = buildUF(false).uf;
        if (uf1.find('tv') !== uf1.find('bv')) addWire({ c: 0, r: 'tv' }, { c: 0, r: 'bv' });
        if (uf1.find('tg') !== uf1.find('bg')) addWire({ c: 1, r: 'tg' }, { c: 1, r: 'bg' });
      }
    }
    changed();
    return { ok: true, part: def.name, pins: assigned };
  }

  function agentRemovePart(partId) {
    for (let i = st.parts.length - 1; i >= 0; i--) {
      if (st.parts[i].id === partId) {
        const holes = partPins(st.parts[i]).map(p => `${p.hole.c}|${p.hole.r}`);
        st.parts.splice(i, 1);
        st.wires = st.wires.filter(w => !holes.includes(`${w.a.c}|${w.a.r}`) && !holes.includes(`${w.b.c}|${w.b.r}`));
        changed();
        return { ok: true, removed: CF.PARTS[partId].name };
      }
    }
    return { ok: false, error: `工作台上沒有 ${partId}` };
  }

  /* ---------------- 序列化（IndexedDB 持久化用） ---------------- */
  function serialize() {
    return {
      boardId: st.boardId,
      conn: st.conn,
      parts: st.parts.map(p => ({ id: p.id, c0: p.c0, side: p.side, value: p.value, closed: p.closed })),
      wires: st.wires.map(w => ({ a: { c: w.a.c, r: w.a.r }, b: { c: w.b.c, r: w.b.r } }))
    };
  }
  function restore(d) {
    if (!d) return;
    st.boardId = d.boardId || 'esp32';
    st.conn = d.conn || 'mqtt';
    st.parts = (d.parts || []).filter(p => CF.PARTS[p.id]).map(p => ({ uid: st.uidSeq++, id: p.id, c0: p.c0, side: p.side, value: p.value, closed: p.closed }));
    st.wires = (d.wires || []).map(w => ({ uid: st.uidSeq++, a: w.a, b: w.b }));
    st.sel = null; st.wireStart = null; st.placing = null;
    changed();
  }

  /* ---------------- 對外 ---------------- */
  return {
    serialize,
    restore,
    agentAddPart,
    agentRemovePart,
    init(canvas, opts) {
      st.canvas = canvas;
      st.ctx = canvas.getContext('2d');
      st.onChange = opts && opts.onChange;
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('dblclick', e => {
        // 點兩下被動元件：開關切換 ON/OFF，其餘開啟規格值輸入框
        const [x, y] = localXY(e);
        const p = pickPart(x, y);
        if (!p || CF.PARTS[p.id].cls !== 'PASSIVE') return;
        if (CF.PARTS[p.id].conduct === 'switch') {
          p.closed = p.closed === false ? true : false;
          changed();
          return;
        }
        openValueEditor(p);
      });
      canvas.addEventListener('pointerleave', () => { st.hover = null; render(); });
      window.addEventListener('keydown', onKey);
      if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement);
      resize();
      derive();
    },
    importPlan,
    setBoard(id) { st.boardId = id; st.wires = []; st.sel = null; changed(); },
    setConn(id) { st.conn = id; changed(); },
    setTool(t) { st.tool = t; st.placing = null; st.wireStart = null; render(); },
    addPart(id) { st.placing = id; st.tool = 'select'; st.ghost = null; render(); },
    clear() { st.parts = []; st.wires = []; st.sel = null; changed(); },
    getPlan() { return st.plan || derive(); },
    getState() { return { tool: st.tool, placing: st.placing, boardId: st.boardId, conn: st.conn }; },
    getPartBox(partId) {
      const ep = st.parts.find(p => p.id === partId);
      if (!ep || !ep._bbox) return null;
      const b = ep._bbox;
      return { x: b.x0 + b.w / 2, y: b.y0 + b.h / 2 };
    },
    resize
  };
})();
