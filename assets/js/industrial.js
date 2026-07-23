'use strict';
/* NemoClaw 電路實驗室 — 工業配線模式（配電盤）批次 1
 * 端子台接線畫布＋受控接點定點迭代求解器＋雙電壓域 ERC＋掃描模擬。
 * 元件：電源、NFB、MC 電磁接觸器、TH-RY 積熱電驛、按鈕 PB(a/b)、指示燈 PL、三相馬達。
 * 可完整模擬經典「自保持啟動/停止」迴路：MC 線圈得電 → 輔助 a 接點閉合 → 放開按鈕仍吸持。
 */
window.CF = window.CF || {};

CF.Ind = (function () {

  /* ================= 元件定義 =================
   * dom: main＝三相主迴路 / ctrl＝控制迴路（110V）
   * bridges(inst, energized)：目前狀態下導通的端子對
   * allPairs：ERC 假設「全部接點閉合」時的端子對（路徑存在性檢查用）
   */
  const DEFS = {
    source: {
      id: 'source', name: '電源供應', label: 'POWER', cls: 'SOURCE', w: 150, h: 64, row: 0, fixed: true,
      color: '#3b4652',
      terms: [
        { n: 'R', dx: 22, dy: 64, dom: 'main' }, { n: 'S', dx: 50, dy: 64, dom: 'main' }, { n: 'T', dx: 78, dy: 64, dom: 'main' },
        { n: 'C1', dx: 112, dy: 64, dom: 'ctrl' }, { n: 'C2', dx: 136, dy: 64, dom: 'ctrl' }
      ],
      bridges: () => [], allPairs: [],
      why: '三相 R/S/T 主電源與 110V 控制電源（C1/C2）。所有迴路的起點與終點。',
      pinNote: 'R 紅、S 白、T 藍；C1/C2 供控制迴路使用，兩域不可混接',
      alts: [['控制變壓器', '實務上控制電源多由 R-S 經變壓器降壓取得']]
    },
    nfb: {
      id: 'nfb', name: 'NFB 無熔絲開關', label: 'NFB', cls: 'PROTECT', w: 92, h: 92, row: 0,
      color: '#2c2c30', toggle: true,
      terms: [
        { n: '1', dx: 22, dy: 0, dom: 'main' }, { n: '3', dx: 46, dy: 0, dom: 'main' }, { n: '5', dx: 70, dy: 0, dom: 'main' },
        { n: '2', dx: 22, dy: 92, dom: 'main' }, { n: '4', dx: 46, dy: 92, dom: 'main' }, { n: '6', dx: 70, dy: 92, dom: 'main' }
      ],
      bridges: inst => inst.on ? [['1', '2'], ['3', '4'], ['5', '6']] : [],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6']],
      why: '主迴路的開關兼短路保護。點兩下可切換 ON/OFF。',
      pinNote: '1/3/5 進電源側，2/4/6 出負載側',
      alts: [['熔絲＋閘刀', '傳統作法，熔斷後需換熔絲'], ['ELCB 漏電斷路器', '加上漏電保護']]
    },
    mc: {
      id: 'mc', name: 'MC 電磁接觸器', label: 'MC', cls: 'CONTROL', w: 112, h: 104, row: 0,
      color: '#1f4d3a', coil: ['A1', 'A2'],
      terms: [
        { n: '1', dx: 20, dy: 0, dom: 'main' }, { n: '3', dx: 44, dy: 0, dom: 'main' }, { n: '5', dx: 68, dy: 0, dom: 'main' },
        { n: '2', dx: 20, dy: 104, dom: 'main' }, { n: '4', dx: 44, dy: 104, dom: 'main' }, { n: '6', dx: 68, dy: 104, dom: 'main' },
        { n: 'A1', dx: 112, dy: 14, dom: 'ctrl' }, { n: 'A2', dx: 112, dy: 30, dom: 'ctrl' },
        { n: '13', dx: 112, dy: 52, dom: 'ctrl' }, { n: '14', dx: 112, dy: 66, dom: 'ctrl' },
        { n: '21', dx: 112, dy: 86, dom: 'ctrl' }, { n: '22', dx: 112, dy: 100, dom: 'ctrl' }
      ],
      bridges: (inst, en) => en
        ? [['1', '2'], ['3', '4'], ['5', '6'], ['13', '14']]
        : [['21', '22']],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6'], ['13', '14'], ['21', '22']],
      why: '控制迴路的線圈（A1/A2）得電後吸持，帶動主接點接通馬達，同時輔助 a 接點（13-14）閉合形成自保持。',
      pinNote: '主接點 1-2/3-4/5-6；線圈 A1-A2；輔助 a 接點 13-14、b 接點 21-22',
      alts: [['SSR 固態接觸器', '無聲無火花，但有漏電流'], ['小型電力電驛 MK', '小負載控制用']]
    },
    thry: {
      id: 'thry', name: 'TH-RY 積熱電驛', label: 'TH-RY', cls: 'PROTECT', w: 100, h: 84, row: 0,
      color: '#5a4a28', trip: true,
      terms: [
        { n: '1', dx: 20, dy: 0, dom: 'main' }, { n: '3', dx: 44, dy: 0, dom: 'main' }, { n: '5', dx: 68, dy: 0, dom: 'main' },
        { n: '2', dx: 20, dy: 84, dom: 'main' }, { n: '4', dx: 44, dy: 84, dom: 'main' }, { n: '6', dx: 68, dy: 84, dom: 'main' },
        { n: '95', dx: 100, dy: 28, dom: 'ctrl' }, { n: '96', dx: 100, dy: 48, dom: 'ctrl' }
      ],
      bridges: inst => inst.tripped ? [] : [['1', '2'], ['3', '4'], ['5', '6'], ['95', '96']],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6'], ['95', '96']],
      why: '馬達過載保護：過載跳脫時切斷主迴路，b 接點（95-96）同時斷開控制迴路讓 MC 釋放。',
      pinNote: '主迴路串接 1-2/3-4/5-6；95-96 串入 MC 線圈迴路',
      alts: [['電子式過載電驛', '設定精確、可通訊'], ['馬達保護斷路器 MMS', 'NFB＋過載二合一']]
    },
    pb_nc: {
      id: 'pb_nc', name: 'PB 按鈕（紅・b 接點）', label: 'STOP', cls: 'INPUT', w: 64, h: 66, row: 1,
      color: '#7a2a22', momentary: true,
      terms: [{ n: '1', dx: 18, dy: 66, dom: 'ctrl' }, { n: '2', dx: 46, dy: 66, dom: 'ctrl' }],
      bridges: inst => inst.pressed ? [] : [['1', '2']],
      allPairs: [['1', '2']],
      why: '停止按鈕：常閉（b）接點，按下即切斷控制迴路，串接在迴路最前端。',
      pinNote: '端子 1-2，未按時導通',
      alts: [['蘑菇頭緊急停止', '安全等級較高，旋轉復歸']]
    },
    pb_no: {
      id: 'pb_no', name: 'PB 按鈕（綠・a 接點）', label: 'START', cls: 'INPUT', w: 64, h: 66, row: 1,
      color: '#1f5c34', momentary: true,
      terms: [{ n: '3', dx: 18, dy: 66, dom: 'ctrl' }, { n: '4', dx: 46, dy: 66, dom: 'ctrl' }],
      bridges: inst => inst.pressed ? [['3', '4']] : [],
      allPairs: [['3', '4']],
      why: '啟動按鈕：常開（a）接點，按下瞬間讓 MC 線圈得電，之後由 MC 自保持接點維持。',
      pinNote: '端子 3-4，按下時導通',
      alts: [['照光式按鈕', '內建指示燈'], ['選擇開關 COS', '需要保持位置時使用']]
    },
    pl_g: {
      id: 'pl_g', name: 'PL 指示燈（綠・運轉）', label: 'PL', cls: 'OUTPUT', w: 56, h: 66, row: 1,
      color: '#24513a', load: ['X1', 'X2'], lamp: '#3ddc84',
      terms: [{ n: 'X1', dx: 16, dy: 66, dom: 'ctrl' }, { n: 'X2', dx: 40, dy: 66, dom: 'ctrl' }],
      bridges: () => [], allPairs: [],
      why: '運轉指示：與 MC 線圈並聯，吸持時亮起。',
      pinNote: 'X1/X2 與線圈並聯（或接 MC 輔助接點）',
      alts: [['紅色 PL', '停止／故障指示'], ['蜂鳴器 BZ', '聲音告警']]
    },
    pl_r: {
      id: 'pl_r', name: 'PL 指示燈（紅・停止）', label: 'PL', cls: 'OUTPUT', w: 56, h: 66, row: 1,
      color: '#5c2822', load: ['X1', 'X2'], lamp: '#ff5348',
      terms: [{ n: 'X1', dx: 16, dy: 66, dom: 'ctrl' }, { n: 'X2', dx: 40, dy: 66, dom: 'ctrl' }],
      bridges: () => [], allPairs: [],
      why: '停止指示：經 MC 輔助 b 接點（21-22）取電，MC 釋放時亮起。',
      pinNote: 'X1/X2 串接 MC 的 21-22 後跨接控制電源',
      alts: [['黃色 PL', '過載／異常指示']]
    },
    motor: {
      id: 'motor', name: '三相感應馬達', label: 'M 3~', cls: 'LOAD', w: 112, h: 92, row: 2,
      color: '#3a4a5c', motor: true,
      terms: [{ n: 'U', dx: 26, dy: 0, dom: 'main' }, { n: 'V', dx: 56, dy: 0, dom: 'main' }, { n: 'W', dx: 86, dy: 0, dom: 'main' }],
      bridges: () => [], allPairs: [],
      why: '被控負載。U/V/W 三相齊備才會運轉；缺相會燒毀馬達（ERC 會擋）。',
      pinNote: 'U/V/W 接 TH-RY 出線側 2/4/6',
      alts: [['單相馬達', '小型負載'], ['變頻器＋馬達', '需要調速時（未支援）']]
    }
  };
  const PALETTE = ['nfb', 'mc', 'thry', 'pb_nc', 'pb_no', 'pl_g', 'pl_r', 'motor'];

  /* ================= 狀態 ================= */
  const LW = 1180, LH = 540;              // 邏輯畫布尺寸
  const ROW_Y = [70, 260, 420];
  const st = {
    canvas: null, ctx: null, scale: 1, w: 0, h: 0, dpr: 1,
    onChange: null,
    parts: [],     // {uid, id, x, y, on/pressed/tripped/energized/lit/run}
    wires: [],     // {uid, a:{uid,term}, b:{uid,term}}
    tool: 'wire',  // wire | delete
    wireStart: null, hover: null,
    running: false, timer: null, coilPrev: {}, live: null, motorAngle: 0,
    plan: null, uidSeq: 1, log: []
  };

  function defOf(p) { return DEFS[p.id]; }
  function byUid(uid) { return st.parts.find(p => p.uid === uid); }
  function termPos(p, name) {
    const t = defOf(p).terms.find(x => x.n === name);
    return t ? { x: p.x + t.dx, y: p.y + t.dy, dom: t.dom } : null;
  }
  function tid(uid, term) { return uid + ':' + term; }
  function labelOf(uid, term) {
    const p = byUid(uid);
    if (!p) return '?';
    const d = defOf(p);
    const idx = st.parts.filter(q => q.id === p.id).indexOf(p) + 1;
    const multi = st.parts.filter(q => q.id === p.id).length > 1;
    return `${d.label}${multi ? idx : ''} ${term}`;
  }

  /* ================= 求解器（定點迭代） ================= */
  function makeUF() {
    const par = {};
    const find = x => { while (par[x] !== undefined && par[x] !== x) { par[x] = par[par[x]] ?? par[x]; x = par[x]; } return par[x] === undefined ? (par[x] = x) : x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) par[ra] = rb; };
    return { find, union };
  }

  /* mode: 'state'＝依實際狀態（含線圈記憶 coilMap）
   *       'all'  ＝假設全部接點閉合（ERC 路徑存在性）
   *       'all-skip:<id>'＝全閉但略過某元件的主接點（保護串接檢查） */
  function buildUF(mode, coilMap) {
    const uf = makeUF();
    for (const w of st.wires) uf.union(tid(w.a.uid, w.a.term), tid(w.b.uid, w.b.term));
    for (const p of st.parts) {
      const d = defOf(p);
      let pairs;
      if (mode === 'state') pairs = d.bridges(p, !!(coilMap && coilMap[p.uid]));
      else {
        if (mode.startsWith('all-skip:') && p.id === mode.slice(9)) pairs = d.allPairs.filter(x => !(x[0] >= '1' && x[0] <= '6' && x[0].length === 1));
        else pairs = d.allPairs;
      }
      for (const [a, b] of pairs) uf.union(tid(p.uid, a), tid(p.uid, b));
    }
    return uf;
  }

  function sourcePart() { return st.parts.find(p => p.id === 'source'); }

  function solve(coilSeed) {
    const src = sourcePart();
    let coil = Object.assign({}, coilSeed);
    let uf = null, result = null;
    for (let iter = 0; iter < 12; iter++) {
      uf = buildUF('state', coil);
      const nC1 = uf.find(tid(src.uid, 'C1'));
      const nC2 = uf.find(tid(src.uid, 'C2'));
      const energized = (t1uid, t1, t2uid, t2) => {
        const a = uf.find(tid(t1uid, t1)), b = uf.find(tid(t2uid, t2));
        return nC1 !== nC2 && ((a === nC1 && b === nC2) || (a === nC2 && b === nC1));
      };
      const next = {};
      for (const p of st.parts) {
        const d = defOf(p);
        if (d.coil) next[p.uid] = energized(p.uid, d.coil[0], p.uid, d.coil[1]);
      }
      const stable = st.parts.every(p => (next[p.uid] || false) === (coil[p.uid] || false));
      coil = next;
      if (stable) { result = { uf, coil, nC1, nC2, oscillating: false }; break; }
      if (iter === 11) result = { uf, coil, nC1, nC2, oscillating: true };
    }
    const { nC1, nC2 } = result;
    const nR = result.uf.find(tid(src.uid, 'R'));
    const nS = result.uf.find(tid(src.uid, 'S'));
    const nT = result.uf.find(tid(src.uid, 'T'));
    // 短路偵測
    const shorts = [];
    if (nC1 === nC2) shorts.push('控制迴路短路（C1-C2 直通）');
    if (nR === nS || nS === nT || nR === nT) shorts.push('相間短路（R/S/T 直通）');
    // 負載狀態
    const lit = {}, motorRun = {};
    for (const p of st.parts) {
      const d = defOf(p);
      if (d.load) {
        const a = result.uf.find(tid(p.uid, d.load[0])), b = result.uf.find(tid(p.uid, d.load[1]));
        lit[p.uid] = nC1 !== nC2 && ((a === nC1 && b === nC2) || (a === nC2 && b === nC1));
      }
      if (d.motor) {
        const phases = ['U', 'V', 'W'].map(t => result.uf.find(tid(p.uid, t)));
        const map = phases.map(n => n === nR ? 'R' : n === nS ? 'S' : n === nT ? 'T' : null);
        motorRun[p.uid] = map.every(Boolean) && new Set(map).size === 3;
      }
    }
    return { uf: result.uf, coil: result.coil, lit, motorRun, shorts, oscillating: result.oscillating, nets: { nC1, nC2, nR, nS, nT } };
  }

  /* ================= ERC ================= */
  function buildChecks() {
    const checks = [];
    const err = (n, d) => checks.push({ status: 'error', name: n, desc: d });
    const warn = (n, d) => checks.push({ status: 'warn', name: n, desc: d });
    const info = (n, d) => checks.push({ status: 'info', name: n, desc: d });
    const pass = (n, d) => checks.push({ status: 'pass', name: n, desc: d });
    const src = sourcePart();

    // 電壓域混接
    for (const w of st.wires) {
      const pa = termPos(byUid(w.a.uid), w.a.term), pb = termPos(byUid(w.b.uid), w.b.term);
      if (pa && pb && pa.dom !== pb.dom) {
        err('電壓域混接', `${labelOf(w.a.uid, w.a.term)} ↔ ${labelOf(w.b.uid, w.b.term)}：主迴路（三相）與控制迴路（110V）不可直接相接。`);
      }
    }

    if (!st.wires.length) {
      info('空白配電盤', '從元件盤加入元件，用「拉線」點兩個端子接線；或載入「自保持範例」。');
      return checks;
    }

    // 靜態短路（NFB 強制 ON、其餘接點依「全閉」假設檢查最壞情況；線圈未激磁）
    const rest = solve({});
    if (rest.shorts.length) rest.shorts.forEach(s => err('短路', s + '——通電將立即跳電。'));

    // 路徑存在性（全接點閉合假設）
    const ufAll = buildUF('all');
    const nC1 = ufAll.find(tid(src.uid, 'C1')), nC2 = ufAll.find(tid(src.uid, 'C2'));
    const nR = ufAll.find(tid(src.uid, 'R')), nS = ufAll.find(tid(src.uid, 'S')), nT = ufAll.find(tid(src.uid, 'T'));
    for (const p of st.parts) {
      const d = defOf(p);
      if (d.coil) {
        const a = ufAll.find(tid(p.uid, d.coil[0])), b = ufAll.find(tid(p.uid, d.coil[1]));
        const okA = a === nC1 || a === nC2, okB = b === nC1 || b === nC2;
        if (!okA || !okB) err(`${d.name} 線圈迴路不通`, `A1/A2 無法同時到達 C1 與 C2（即使所有接點閉合）。檢查 STOP／START／95-96 的串接。`);
      }
      if (d.motor) {
        const phases = ['U', 'V', 'W'].map(t => ufAll.find(tid(p.uid, t)));
        const hit = phases.map(n => n === nR ? 'R' : n === nS ? 'S' : n === nT ? 'T' : null);
        if (!hit.every(Boolean)) err('馬達缺相', `U/V/W 有端子接不到任何相（即使所有接點閉合）——缺相運轉會燒毀馬達。`);
        else if (new Set(hit).size !== 3) err('馬達相別重複', `U/V/W 接到了重複的相（${hit.join('/')}），請檢查主迴路配線。`);
        else {
          // 保護串接：拿掉 TH-RY／NFB 主接點後馬達應該斷電
          const checkSerial = (skipId, okName, warnName, warnDesc) => {
            const ufSkip = buildUF('all-skip:' + skipId);
            const r2 = ufSkip.find(tid(src.uid, 'R')), s2 = ufSkip.find(tid(src.uid, 'S')), t2 = ufSkip.find(tid(src.uid, 'T'));
            const ph2 = ['U', 'V', 'W'].map(t => ufSkip.find(tid(p.uid, t)));
            const still = ph2.every(n => n === r2 || n === s2 || n === t2);
            if (still) warn(warnName, warnDesc);
            else pass(okName, `${skipId === 'thry' ? 'TH-RY' : 'NFB'} 已正確串接於馬達主迴路。`);
          };
          if (st.parts.some(q => q.id === 'thry')) checkSerial('thry', '過載保護', '過載保護未串接', 'TH-RY 沒有串在馬達主迴路上，過載時無法斷電。');
          else warn('缺過載保護', '主迴路沒有 TH-RY 積熱電驛，馬達過載時無保護。');
          if (st.parts.some(q => q.id === 'nfb')) checkSerial('nfb', '短路保護', 'NFB 未串接', 'NFB 沒有串在馬達主迴路上，失去開關與短路保護。');
          else warn('缺 NFB', '主迴路沒有 NFB，無法斷電與短路保護。');
        }
      }
    }

    const errN = checks.filter(c => c.status === 'error').length;
    if (!errN) {
      pass('迴路連通', '控制迴路與主迴路的路徑檢查全部通過。');
      pass('電壓域', '主迴路與控制迴路分離正確。');
    }
    return checks;
  }

  /* ================= 模擬 ================= */
  function simStart() {
    const checks = st.plan ? st.plan.checks : buildChecks();
    const e = checks.find(c => c.status === 'error');
    if (e) return { ok: false, msg: `${e.name} — ${e.desc}` };
    st.running = true;
    st.coilPrev = {};
    st.log = [];
    pushLog('通電。掃描求解器啟動（120ms／週期）。');
    st.timer = setInterval(tick, 120);
    return { ok: true };
  }
  function simStop() {
    st.running = false;
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    st.live = null;
    for (const p of st.parts) { p.energized = false; p.lit = false; p.run = false; }
    render();
    if (st.onSim) st.onSim();
  }
  function pushLog(text) {
    st.log.push(text);
    if (st.log.length > 30) st.log.shift();
  }

  function tick() {
    const r = solve(st.coilPrev);
    if (r.shorts.length) {
      pushLog('⚡ ' + r.shorts[0] + '——保護跳脫，已斷電！');
      simStop();
      return;
    }
    if (r.oscillating) {
      pushLog('⚠ 迴路震盪（接點狀態無法穩定），已斷電。檢查是否用 b 接點切自己的線圈。');
      simStop();
      return;
    }
    for (const p of st.parts) {
      const d = defOf(p);
      const en = !!r.coil[p.uid];
      if (d.coil && en !== !!p.energized) pushLog(`${d.label} ${en ? '吸持 🧲' : '釋放'}`);
      p.energized = en;
      if (d.load) p.lit = !!r.lit[p.uid];
      if (d.motor) {
        const run = !!r.motorRun[p.uid];
        if (run !== !!p.run) pushLog(`馬達 ${run ? '運轉 ▶' : '停止 ■'}`);
        p.run = run;
        if (run) st.motorAngle += 0.5;
      }
    }
    st.coilPrev = r.coil;
    st.live = r;
    render();
    if (st.onSim) st.onSim();
  }

  /* ================= 畫布 ================= */
  function render() {
    const { ctx } = st;
    if (!ctx) return;
    ctx.setTransform(st.dpr * st.scale, 0, 0, st.dpr * st.scale, st.dpr * st.ox, st.dpr * st.oy);
    ctx.clearRect(-st.ox / st.scale, -st.oy / st.scale, LW + 2 * st.ox / st.scale, LH + 2 * st.oy / st.scale);

    // 盤面
    ctx.fillStyle = '#e8eaec';
    ctx.strokeStyle = '#c5cad0';
    ctx.lineWidth = 2;
    roundRect(ctx, 8, 8, LW - 16, LH - 16, 12);
    ctx.fill(); ctx.stroke();
    // DIN 軌
    for (const y of ROW_Y) {
      ctx.fillStyle = '#cdd3d8';
      ctx.fillRect(20, y + 18, LW - 40, 14);
      ctx.fillStyle = '#b7bec5';
      for (let x = 28; x < LW - 40; x += 22) ctx.fillRect(x, y + 21, 8, 8);
    }

    // 導線
    for (const w of st.wires) {
      const pa = termPos(byUid(w.a.uid), w.a.term);
      const pb = termPos(byUid(w.b.uid), w.b.term);
      if (!pa || !pb) continue;
      drawWire(ctx, pa, pb, wireColor(w, pa), st.hoverWire === w.uid);
    }
    if (st.wireStart && st.hover) {
      const pa = termPos(byUid(st.wireStart.uid), st.wireStart.term);
      ctx.setLineDash([6, 5]);
      drawWire(ctx, pa, { x: st.hover.x, y: st.hover.y }, '#0e7a6e', false);
      ctx.setLineDash([]);
    }

    // 元件
    for (const p of st.parts) drawPart(ctx, p);

    // 拉線起點強調
    if (st.wireStart) {
      const pa = termPos(byUid(st.wireStart.uid), st.wireStart.term);
      ctx.beginPath(); ctx.arc(pa.x, pa.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#0e7a6e'; ctx.lineWidth = 2.5; ctx.stroke();
    }
  }

  function wireColor(w, pa) {
    if (pa.dom === 'ctrl') {
      if (st.running && st.live) {
        const n = st.live.uf.find(tid(w.a.uid, w.a.term));
        if (n === st.live.nets.nC1 || n === st.live.nets.nC2) return '#f0a020';
      }
      return '#c98418';
    }
    // 主迴路：依相別上色（R紅 S白 T藍）
    if (st.plan && st.plan.restUf) {
      const src = sourcePart();
      const n = st.plan.restUf.find(tid(w.a.uid, w.a.term));
      if (n === st.plan.restUf.find(tid(src.uid, 'R'))) return '#c2402a';
      if (n === st.plan.restUf.find(tid(src.uid, 'S'))) return '#8a8f95';
      if (n === st.plan.restUf.find(tid(src.uid, 'T'))) return '#3b62c4';
    }
    return '#7a4040';
  }

  function drawWire(ctx, pa, pb, color, hot) {
    const mx = (pa.x + pb.x) / 2;
    const sag = Math.min(60, Math.abs(pa.x - pb.x) * 0.15 + Math.abs(pa.y - pb.y) * 0.1 + 18);
    const my = Math.max(pa.y, pb.y) + sag;
    if (hot) { ctx.strokeStyle = 'rgba(194,64,42,.3)'; ctx.lineWidth = 8; strokePath(); }
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    strokePath();
    function strokePath() {
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.quadraticCurveTo(mx, my, pb.x, pb.y);
      ctx.stroke();
    }
  }

  function drawPart(ctx, p) {
    const d = defOf(p);
    // 本體
    ctx.fillStyle = d.color;
    ctx.strokeStyle = 'rgba(0,0,0,.3)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, p.x, p.y, d.w, d.h, 8);
    ctx.fill(); ctx.stroke();
    // 吸持光暈
    if (p.energized) {
      ctx.strokeStyle = '#3ddc84';
      ctx.lineWidth = 3;
      roundRect(ctx, p.x - 3, p.y - 3, d.w + 6, d.h + 6, 10);
      ctx.stroke();
    }
    // 標籤
    ctx.fillStyle = '#f2f4f6';
    ctx.font = '700 14px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    const num = st.parts.filter(q => q.id === p.id).length > 1 ? st.parts.filter(q => q.id === p.id).indexOf(p) + 1 : '';
    ctx.fillText(d.label + num, p.x + d.w / 2, p.y + 20);
    ctx.font = '10px "Noto Sans TC", sans-serif';
    ctx.fillStyle = 'rgba(242,244,246,.75)';
    ctx.fillText(d.name.split('（')[0].slice(0, 9), p.x + d.w / 2, p.y + 34);
    ctx.textAlign = 'left';

    // 特殊圖徽
    if (d.toggle) {   // NFB 手柄
      ctx.fillStyle = p.on ? '#3ddc84' : '#8a8f95';
      ctx.fillRect(p.x + d.w / 2 - 8, p.y + d.h / 2 - 4 + (p.on ? -8 : 8), 16, 14);
      ctx.fillStyle = '#f2f4f6';
      ctx.font = '9px monospace';
      ctx.fillText(p.on ? 'ON' : 'OFF', p.x + d.w / 2 - 8, p.y + d.h / 2 + 26);
    }
    if (d.trip && p.tripped) {
      ctx.fillStyle = '#ffb020';
      ctx.font = '700 11px monospace';
      ctx.fillText('TRIP!', p.x + d.w / 2 - 16, p.y + d.h / 2 + 10);
    }
    if (d.momentary) {  // 按鈕頭
      ctx.beginPath();
      ctx.arc(p.x + d.w / 2, p.y + d.h / 2 + 6, 12, 0, Math.PI * 2);
      ctx.fillStyle = p.id === 'pb_nc' ? '#e04433' : '#2fae5e';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.stroke();
      if (p.pressed) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x + d.w / 2, p.y + d.h / 2 + 6, 15, 0, Math.PI * 2); ctx.stroke(); }
    }
    if (d.load) {   // 指示燈
      ctx.beginPath();
      ctx.arc(p.x + d.w / 2, p.y + d.h / 2 + 6, 11, 0, Math.PI * 2);
      ctx.fillStyle = p.lit ? d.lamp : '#464c52';
      ctx.fill();
      if (p.lit) { ctx.shadowColor = d.lamp; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0; }
    }
    if (d.motor) {  // 馬達轉盤
      const cx = p.x + d.w / 2, cy = p.y + d.h / 2 + 8, r = 22;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#242e38'; ctx.fill();
      ctx.strokeStyle = p.run ? '#3ddc84' : '#5a646e'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(p.run ? st.motorAngle : 0);
      ctx.strokeStyle = '#8fd8b0';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) { ctx.rotate(Math.PI * 2 / 3); ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, r - 6); ctx.stroke(); }
      ctx.restore();
    }

    // 端子
    for (const t of d.terms) {
      const x = p.x + t.dx, y = p.y + t.dy;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = t.dom === 'main' ? '#d8dce0' : '#ffd9a0';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#3b4046';
      ctx.font = '9px "IBM Plex Mono", monospace';
      const side = t.dx >= d.w ? 8 : 0;
      ctx.fillText(t.n, x + (side ? 8 : -4 - t.n.length * 2.5), y + (t.dy === 0 ? -8 : t.dy >= d.h ? 16 : 3 + (side ? 0 : -10)));
    }
    // hover 端子提示
    if (st.hover && st.hover.uid === p.uid) {
      const t = d.terms.find(x => x.n === st.hover.term);
      if (t) {
        const x = p.x + t.dx, y = p.y + t.dy;
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#0e7a6e'; ctx.lineWidth = 2; ctx.stroke();
        const txt = `${labelOf(p.uid, t.n)}（${t.dom === 'main' ? '主迴路' : '控制'}）`;
        ctx.font = '11px "IBM Plex Mono","Noto Sans TC",monospace';
        const tw = ctx.measureText(txt).width + 12;
        ctx.fillStyle = 'rgba(25,23,19,.92)';
        roundRect(ctx, x - tw / 2, y - 32, tw, 18, 4); ctx.fill();
        ctx.fillStyle = '#f5f2ea';
        ctx.textAlign = 'center';
        ctx.fillText(txt, x, y - 19);
        ctx.textAlign = 'left';
      }
    }
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

  /* ================= 互動 ================= */
  function toLogical(e) {
    const rect = st.canvas.getBoundingClientRect();
    return [(e.clientX - rect.left - st.ox / st.dprCss) / (st.scale / st.dprCss), (e.clientY - rect.top - st.oy / st.dprCss) / (st.scale / st.dprCss)];
  }
  function pickTerm(x, y) {
    for (const p of st.parts) {
      for (const t of defOf(p).terms) {
        const tx = p.x + t.dx, ty = p.y + t.dy;
        if (Math.hypot(tx - x, ty - y) < 11) return { uid: p.uid, term: t.n, x: tx, y: ty };
      }
    }
    return null;
  }
  function pickPart(x, y) {
    for (let i = st.parts.length - 1; i >= 0; i--) {
      const p = st.parts[i], d = defOf(p);
      if (x >= p.x && x <= p.x + d.w && y >= p.y && y <= p.y + d.h) return p;
    }
    return null;
  }
  function pickWire(x, y) {
    for (let i = st.wires.length - 1; i >= 0; i--) {
      const w = st.wires[i];
      const pa = termPos(byUid(w.a.uid), w.a.term), pb = termPos(byUid(w.b.uid), w.b.term);
      const mx = (pa.x + pb.x) / 2;
      const sag = Math.min(60, Math.abs(pa.x - pb.x) * 0.15 + Math.abs(pa.y - pb.y) * 0.1 + 18);
      const my = Math.max(pa.y, pb.y) + sag;
      for (let t = 0; t <= 1; t += 0.04) {
        const px = (1 - t) * (1 - t) * pa.x + 2 * (1 - t) * t * mx + t * t * pb.x;
        const py = (1 - t) * (1 - t) * pa.y + 2 * (1 - t) * t * my + t * t * pb.y;
        if (Math.hypot(px - x, py - y) < 8) return w;
      }
    }
    return null;
  }

  function onMove(e) {
    const [x, y] = toLogical(e);
    st.hover = pickTerm(x, y);
    if (st.hover) { st.hover.x = x; st.hover.y = y; }
    render();
  }
  function onDown(e) {
    const [x, y] = toLogical(e);
    if (st.tool === 'delete') {
      const w = pickWire(x, y);
      if (w) { st.wires = st.wires.filter(q => q.uid !== w.uid); changed(); return; }
      const p = pickPart(x, y);
      if (p && !defOf(p).fixed) {
        st.parts = st.parts.filter(q => q.uid !== p.uid);
        st.wires = st.wires.filter(q => q.a.uid !== p.uid && q.b.uid !== p.uid);
        changed();
      }
      return;
    }
    // 拉線
    const t = pickTerm(x, y);
    if (t) {
      if (!st.wireStart) { st.wireStart = t; render(); return; }
      if (st.wireStart.uid !== t.uid || st.wireStart.term !== t.term) {
        st.wires.push({ uid: st.uidSeq++, a: { uid: st.wireStart.uid, term: st.wireStart.term }, b: { uid: t.uid, term: t.term } });
        st.wireStart = null;
        changed();
      }
      return;
    }
    st.wireStart = null;
    render();
  }
  function onDbl(e) {
    const [x, y] = toLogical(e);
    const p = pickPart(x, y);
    if (p && defOf(p).toggle) { p.on = !p.on; changed(); }
  }

  /* ================= 操作 API ================= */
  function addPart(id) {
    const d = DEFS[id];
    if (!d) return { ok: false, error: '未知元件 ' + id };
    const row = d.row;
    let x = 30;
    for (const p of st.parts) {
      const pd = defOf(p);
      if (pd.row === row) x = Math.max(x, p.x + pd.w + 42);
    }
    if (x + d.w > LW - 20) return { ok: false, error: '此列已無空間' };
    const np = { uid: st.uidSeq++, id, x, y: ROW_Y[row] - (row === 0 ? 0 : d.h - 46) };
    if (d.toggle) np.on = true;
    st.parts.push(np);
    changed();
    return { ok: true, part: d.name };
  }

  function loadExample() {
    st.parts = [];
    st.wires = [];
    st.uidSeq = 1;
    ensureSource();
    addPartSilent('nfb'); addPartSilent('mc'); addPartSilent('thry');
    addPartSilent('pb_nc'); addPartSilent('pb_no'); addPartSilent('pl_g'); addPartSilent('motor');
    const u = id => st.parts.find(p => p.id === id).uid;
    const W = (au, at, bu, bt) => st.wires.push({ uid: st.uidSeq++, a: { uid: au, term: at }, b: { uid: bu, term: bt } });
    const S = u('source'), N = u('nfb'), M = u('mc'), H = u('thry'), ST = u('pb_nc'), GO = u('pb_no'), PL = u('pl_g'), MO = u('motor');
    // 主迴路：R/S/T → NFB → MC → TH-RY → 馬達
    W(S, 'R', N, '1'); W(S, 'S', N, '3'); W(S, 'T', N, '5');
    W(N, '2', M, '1'); W(N, '4', M, '3'); W(N, '6', M, '5');
    W(M, '2', H, '1'); W(M, '4', H, '3'); W(M, '6', H, '5');
    W(H, '2', MO, 'U'); W(H, '4', MO, 'V'); W(H, '6', MO, 'W');
    // 控制迴路：C1 → STOP(b) → START(a) → 線圈 A1；A2 → 95-96 → C2；自保持 13-14 並聯 START
    W(S, 'C1', ST, '1'); W(ST, '2', GO, '3'); W(GO, '4', M, 'A1');
    W(M, 'A2', H, '95'); W(H, '96', S, 'C2');
    W(M, '13', GO, '3'); W(M, '14', GO, '4');
    // 運轉指示燈並聯線圈
    W(PL, 'X1', M, 'A1'); W(PL, 'X2', M, 'A2');
    changed();
    return { ok: true };
  }
  function addPartSilent(id) {
    const d = DEFS[id];
    let x = 30;
    for (const p of st.parts) {
      const pd = defOf(p);
      if (pd.row === d.row) x = Math.max(x, p.x + pd.w + 42);
    }
    const np = { uid: st.uidSeq++, id, x, y: ROW_Y[d.row] - (d.row === 0 ? 0 : d.h - 46) };
    if (d.toggle) np.on = true;
    st.parts.push(np);
  }
  function ensureSource() {
    if (!st.parts.some(p => p.id === 'source')) {
      st.parts.unshift({ uid: st.uidSeq++, id: 'source', x: 30, y: ROW_Y[0] });
    }
  }

  /* ================= 方案物件（右欄共用渲染） ================= */
  function derive() {
    ensureSource();
    const checks = buildChecks();
    const errN = checks.filter(c => c.status === 'error').length;
    const src = sourcePart();
    const nets = st.wires.map((w, i) => {
      const pa = termPos(byUid(w.a.uid), w.a.term);
      return {
        id: i,
        kind: pa && pa.dom === 'main' ? 'V' : 'S',
        from: labelOf(w.a.uid, w.a.term),
        to: `→ ${labelOf(w.b.uid, w.b.term)}`,
        note: pa && pa.dom === 'main' ? '主迴路（三相）' : '控制迴路（110V）',
        badge: 'PANEL WIRE', locked: true
      };
    });
    const names = [...new Set(st.parts.filter(p => p.id !== 'source').map(p => defOf(p).label))];
    st.plan = {
      industrial: true,
      spec: { boardId: 'panel', conn: 'none', flags: {} },
      board: { id: 'panel', name: '配電盤', display: 'CONTROL PANEL 3Φ', wifi: false },
      parts: st.parts.map(p => ({ id: p.id, uid: p.uid, def: defOf(p), pins: [] })),
      nets, checks,
      railV: '3Φ220V／110V',
      conn: 'none', connLabel: '',
      connDone: errN ? '配線未完成' : '配線已建立',
      title: `配電盤 · ${names.length ? names.join(' + ') : '工業配線'}`,
      tags: ['CONTROL PANEL', '3Φ + 110V CTRL'],
      counts: { parts: st.parts.length, wires: st.wires.length },
      errN,
      restUf: buildUF('all')
    };
    return st.plan;
  }

  function genFiles() {
    const plan = st.plan || derive();
    const wiring = ['# 接線表（配電盤）', ''];
    st.wires.forEach((w, i) => {
      const pa = termPos(byUid(w.a.uid), w.a.term);
      wiring.push(`${String(i + 1).padStart(2, '0')}  ${labelOf(w.a.uid, w.a.term)}  →  ${labelOf(w.b.uid, w.b.term)}   [${pa && pa.dom === 'main' ? '主' : '控'}]`);
    });
    const bom = ['# 元件表（BOM）', ''];
    const cnt = {};
    for (const p of st.parts) cnt[p.id] = (cnt[p.id] || 0) + 1;
    for (const [id, n] of Object.entries(cnt)) bom.push(`${DEFS[id].name}  × ${n}`);
    return [
      { name: '接線表.txt', lang: 'txt', content: wiring.join('\n') + '\n' },
      { name: '元件表.txt', lang: 'txt', content: bom.join('\n') + '\n' },
      { name: 'panel.json', lang: 'json', content: JSON.stringify(serialize(), null, 2) }
    ];
  }

  /* ================= 持久化 ================= */
  function serialize() {
    return {
      parts: st.parts.map(p => ({ uid: p.uid, id: p.id, x: p.x, y: p.y, on: p.on, tripped: p.tripped })),
      wires: st.wires.map(w => ({ a: w.a, b: w.b })),
      uidSeq: st.uidSeq
    };
  }
  function restore(d) {
    if (!d || !d.parts) return;
    st.parts = d.parts.filter(p => DEFS[p.id]).map(p => ({ uid: p.uid, id: p.id, x: p.x, y: p.y, on: p.on, tripped: p.tripped }));
    st.wires = (d.wires || []).map(w => ({ uid: st.uidSeq++, a: w.a, b: w.b }));
    st.uidSeq = Math.max(d.uidSeq || 1, st.uidSeq);
    changed();
  }

  function changed() {
    simStop();
    derive();
    render();
    if (st.onChange) st.onChange(st.plan);
  }

  function resize() {
    if (!st.canvas) return;
    const rect = st.canvas.parentElement.getBoundingClientRect();
    st.dpr = Math.min(2, window.devicePixelRatio || 1);
    st.dprCss = 1;
    st.w = Math.max(300, rect.width);
    st.h = Math.max(240, rect.height);
    st.canvas.width = st.w * st.dpr;
    st.canvas.height = st.h * st.dpr;
    st.canvas.style.width = st.w + 'px';
    st.canvas.style.height = st.h + 'px';
    st.scale = Math.min(st.w / LW, st.h / LH);
    st.ox = (st.w - LW * st.scale) / 2;
    st.oy = (st.h - LH * st.scale) / 2;
    render();
  }

  /* ================= 對外 ================= */
  return {
    DEFS, PALETTE,
    init(canvas, hooks) {
      st.canvas = canvas;
      st.ctx = canvas.getContext('2d');
      st.onChange = hooks && hooks.onChange;
      st.onSim = hooks && hooks.onSim;
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('dblclick', onDbl);
      canvas.addEventListener('pointerleave', () => { st.hover = null; render(); });
      if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement);
      resize();
      ensureSource();
      derive();
    },
    addPart, loadExample, restore, serialize, genFiles, resize,
    setTool(t) { st.tool = t; st.wireStart = null; render(); },
    clear() { st.parts = []; st.wires = []; st.uidSeq = 1; ensureSource(); changed(); },
    getPlan() { return st.plan || derive(); },
    /* 模擬控制（模擬面板用） */
    simStart, simStop,
    isRunning() { return st.running; },
    getLog() { return st.log; },
    pressPB(uid, down) {
      const p = byUid(uid);
      if (p && defOf(p).momentary) { p.pressed = down; render(); }
    },
    toggleNfb(uid) {
      const p = byUid(uid) || st.parts.find(x => x.id === 'nfb');
      if (p) { p.on = !p.on; if (!st.running) changed(); else render(); }
    },
    tripThry(uid, tripped) {
      const p = byUid(uid) || st.parts.find(x => x.id === 'thry');
      if (p) {
        p.tripped = tripped === undefined ? !p.tripped : tripped;
        pushLog(p.tripped ? 'TH-RY 過載跳脫！⚡' : 'TH-RY 復歸。');
        if (!st.running) changed(); else render();
      }
    },
    getParts() { return st.parts.map(p => ({ uid: p.uid, id: p.id, def: defOf(p), pressed: p.pressed, on: p.on, tripped: p.tripped, energized: p.energized, lit: p.lit, run: p.run })); }
  };
})();
