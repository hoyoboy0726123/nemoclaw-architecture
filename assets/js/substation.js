'use strict';
/* NemoClaw 電路實驗室 — 變電所單線圖模式（S/S 運轉操作）
 * 抽象層級：單線圖（一條線代表三相），教的是「變電所運轉」而不是端子接線。
 * 核心規則（真模擬）：
 *   - CB 斷路器可帶載開閉；DS 隔離開關只能在「無電流」或「等電位（並聯迴路存在）」時操作，
 *     判定方式＝拆掉/接上該 DS 後，所有饋線的受電狀態是否改變——改變＝有負載電流經過＝弧光事故。
 *   - 合 DS 到兩個「不同的帶電網」＝非同期併聯＝事故。
 *   - 故障注入 → 主保護 CB 限時跳脫；注入「拒動」缺陷 → 後備保護越級跳脫（保護協調教學）。
 *   - 所有操作自動記錄成「操作票」，可匯出。
 */
window.CF = window.CF || {};

CF.Sub = (function () {

  const LW = 1180, LH = 560;

  const st = {
    canvas: null, ctx: null, w: 0, h: 0, dpr: 1,
    onChange: null, onSim: null,
    sc: null,            // 目前情境（deep copy）
    scId: null,
    sheet: [],           // 操作票 [{n,text}]
    log: [],
    fault: null,         // {target, t, cleared:false}
    taskDone: false,
    everLost: {},        // feederId -> 曾失電
    timer: null,
    blink: false,
    zoom: 1, panX: 0, panY: 0, baseScale: 1, baseOx: 0, baseOy: 0, panDrag: null,
    hover: null,
    builder: { tool: null, pendA: null, drag: null },   // 自由建構：放置工具／待定第一端／節點拖曳
    counters: { n: 0, b: 0, d: {} }                     // 自由建構 id 流水號
  };

  /* ================= 情境庫 ================= */
  /* nodes: {id:[x,y]}；elements: src/cb/ds/tx/feeder/tie 由 a,b 節點連接 */
  function S(def) { return def; }

  const SCENARIOS = [
    S({
      id: 'sub_basic', name: '單母線：停送電順序', tier: 1,
      desc: '基本功：送電順序「先合 DS、再合 CB」、停電反向。把饋線一送電（全程不出事故）。',
      nodes: { nL: [590, 70], n1: [590, 130], n2: [590, 210], busM: [0, 0], n3: [420, 330], n4: [420, 410], n5: [760, 330], n6: [760, 410] },
      buses: [{ id: 'busM', x1: 260, x2: 920, y: 270, label: '11.4kV 母線' }],
      elements: [
        { id: 'L1', type: 'src', node: 'nL', label: '台電 11.4kV' },
        { id: 'DS-1', type: 'ds', a: 'nL', b: 'n1', closed: false, label: 'DS 線路側' },
        { id: 'CB-IN', type: 'cb', a: 'n1', b: 'n2', closed: false, label: 'CB 進線' },
        { id: 'DS-2', type: 'ds', a: 'n2', b: 'busM', closed: false, label: 'DS 母線側' },
        { id: 'DS-3', type: 'ds', a: 'busM', b: 'n3', closed: false, label: 'DS 饋線一' },
        { id: 'CB-F1', type: 'cb', a: 'n3', b: 'n4', closed: false, label: 'CB 饋線一' },
        { id: 'F1', type: 'feeder', node: 'n4', amps: 80, label: '饋線一（廠區）' },
        { id: 'DS-5', type: 'ds', a: 'busM', b: 'n5', closed: false, label: 'DS 饋線二' },
        { id: 'CB-F2', type: 'cb', a: 'n5', b: 'n6', closed: false, label: 'CB 饋線二' },
        { id: 'F2', type: 'feeder', node: 'n6', amps: 45, label: '饋線二（照明）' }
      ],
      task: { text: '把「饋線一」送電（DS→CB 順序，勿帶載操作 DS）', check: api => api.live('F1') }
    }),
    S({
      id: 'sub_section', name: '單母線分段：半邊檢修', tier: 1,
      desc: '母線分段（bus section）：把 B 段母線停電檢修，A 段的饋線一必須維持供電。',
      nodes: { nL: [370, 70], n1: [370, 130], n2: [370, 210], busA: [0, 0], busB: [0, 0], nt1: [590, 330], nt2: [660, 330], n3: [300, 330], n4: [300, 410], n5: [880, 330], n6: [880, 410] },
      buses: [
        { id: 'busA', x1: 180, x2: 560, y: 270, label: 'A 段母線' },
        { id: 'busB', x1: 700, x2: 1010, y: 270, label: 'B 段母線' }
      ],
      elements: [
        { id: 'L1', type: 'src', node: 'nL', label: '台電 11.4kV' },
        { id: 'DS-1', type: 'ds', a: 'nL', b: 'n1', closed: true, label: 'DS 線路側' },
        { id: 'CB-IN', type: 'cb', a: 'n1', b: 'n2', closed: true, label: 'CB 進線' },
        { id: 'DS-2', type: 'ds', a: 'n2', b: 'busA', closed: true, label: 'DS 母線側' },
        { id: 'DS-T1', type: 'ds', a: 'busA', b: 'nt1', closed: true, label: 'DS 分段A' },
        { id: 'CB-TIE', type: 'cb', a: 'nt1', b: 'nt2', closed: true, label: 'CB 分段' },
        { id: 'DS-T2', type: 'ds', a: 'nt2', b: 'busB', closed: true, label: 'DS 分段B' },
        { id: 'DS-3', type: 'ds', a: 'busA', b: 'n3', closed: true, label: 'DS 饋線一' },
        { id: 'CB-F1', type: 'cb', a: 'n3', b: 'n4', closed: true, label: 'CB 饋線一' },
        { id: 'F1', type: 'feeder', node: 'n4', amps: 80, label: '饋線一' },
        { id: 'DS-5', type: 'ds', a: 'busB', b: 'n5', closed: true, label: 'DS 饋線二' },
        { id: 'CB-F2', type: 'cb', a: 'n5', b: 'n6', closed: true, label: 'CB 饋線二' },
        { id: 'F2', type: 'feeder', node: 'n6', amps: 45, label: '饋線二' }
      ],
      task: {
        text: 'B 段母線完全停電且兩側 DS 開路（檢修隔離），饋線一維持供電',
        check: api => api.live('F1') && !api.liveNode('busB') && !api.closed('DS-T2') && !api.closed('DS-5')
      }
    }),
    S({
      id: 'sub_transfer', name: '雙母線：倒母線演練', tier: 2,
      desc: '核心科目：把饋線一從 A 母線倒到 B 母線，全程不斷電。要領：先合母聯（等電位）→ 合 B 側 DS → 開 A 側 DS → 開母聯。',
      nodes: {
        nL: [300, 70], n1: [300, 130], n2: [300, 200], nsel: [300, 240],
        busA: [0, 0], busB: [0, 0],
        nt1: [640, 300], nt2: [640, 350],
        nf: [880, 240], n3: [880, 430], n4: [880, 480]
      },
      buses: [
        { id: 'busA', x1: 160, x2: 1020, y: 280, label: 'A 母線' },
        { id: 'busB', x1: 160, x2: 1020, y: 370, label: 'B 母線' }
      ],
      elements: [
        { id: 'L1', type: 'src', node: 'nL', label: '台電 161kV' },
        { id: 'DS-1', type: 'ds', a: 'nL', b: 'n1', closed: true, label: 'DS 線路側' },
        { id: 'CB-IN', type: 'cb', a: 'n1', b: 'n2', closed: true, label: 'CB 進線' },
        { id: 'DS-A', type: 'ds', a: 'n2', b: 'busA', closed: true, label: 'DS 進線→A', selx: -18 },
        { id: 'DS-B', type: 'ds', a: 'n2', b: 'busB', closed: false, label: 'DS 進線→B', selx: 18 },
        { id: 'DS-TA', type: 'ds', a: 'busA', b: 'nt1', closed: false, label: 'DS 母聯A' },
        { id: 'CB-TIE', type: 'cb', a: 'nt1', b: 'nt2', closed: false, label: 'CB 母聯' },
        { id: 'DS-TB', type: 'ds', a: 'nt2', b: 'busB', closed: false, label: 'DS 母聯B' },
        { id: 'DS-FA', type: 'ds', a: 'busA', b: 'nf', closed: true, label: 'DS 饋線→A', selx: -18 },
        { id: 'DS-FB', type: 'ds', a: 'busB', b: 'nf', closed: false, label: 'DS 饋線→B', selx: 18 },
        { id: 'CB-F1', type: 'cb', a: 'nf', b: 'n3', closed: true, label: 'CB 饋線一', drop: true },
        { id: 'F1', type: 'feeder', node: 'n3', amps: 120, label: '饋線一（重要負載）' }
      ],
      task: {
        text: '饋線一改由 B 母線供電、A 側 DS 與母聯全開，且全程不斷電',
        check: api => api.live('F1') && api.closed('DS-FB') && !api.closed('DS-FA') && !api.closed('CB-TIE') && !api.everLost('F1')
      }
    }),
    S({
      id: 'sub_busfault', name: '雙母線：母線故障復電', tier: 2,
      desc: 'A 母線故障→進線 CB 跳脫全站停電。任務：隔離 A 母線、改走 B 母線復電（按「⚡ 注入故障」開始）。',
      inherit: 'sub_transfer',
      faults: { busA: { primary: 'CB-IN', t1: 0.5, label: 'A 母線' } },
      task: {
        text: 'A 母線兩側 DS 全開（隔離）、饋線一經 B 母線復電',
        check: api => api.live('F1') && !api.closed('DS-A') && !api.closed('DS-FA') && api.closed('DS-B') && api.closed('DS-FB')
      }
    }),
    S({
      id: 'sub_half', name: '一次半斷路器（1½ CB）', tier: 2,
      desc: '樞紐變電所架構：兩串（string）共 6 台 CB 帶 2 回線＋2 饋線。任務：檢修串一的中間 CB-M（先開 CB-M、再開兩側 DS），兩條饋線都不斷電——這就是 1½ 架構的價值。',
      nodes: {
        nL1: [250, 180], p1: [420, 180], pa: [420, 240], pb: [420, 310], p2: [420, 370], f1: [240, 370],
        nL2: [950, 200], r1: [800, 200], r2: [800, 300], f2: [960, 300],
        busT: [0, 0], busD: [0, 0]
      },
      buses: [
        { id: 'busT', x1: 300, x2: 900, y: 110, label: '上母線 345kV' },
        { id: 'busD', x1: 300, x2: 900, y: 450, label: '下母線 345kV' }
      ],
      elements: [
        { id: 'L1', type: 'src', node: 'nL1', label: '回線一 345kV' },
        { id: 'DS-L1', type: 'ds', a: 'nL1', b: 'p1', closed: true, label: 'DS 回線一' },
        { id: 'CB-1T', type: 'cb', a: 'busT', b: 'p1', closed: true, label: 'CB 串一上' },
        { id: 'DS-M1', type: 'ds', a: 'p1', b: 'pa', closed: true, label: 'DS 中上' },
        { id: 'CB-M', type: 'cb', a: 'pa', b: 'pb', closed: true, label: 'CB 中（檢修對象）' },
        { id: 'DS-M2', type: 'ds', a: 'pb', b: 'p2', closed: true, label: 'DS 中下' },
        { id: 'CB-1D', type: 'cb', a: 'p2', b: 'busD', closed: true, label: 'CB 串一下' },
        { id: 'DS-F1', type: 'ds', a: 'p2', b: 'f1', closed: true, label: 'DS 饋線一' },
        { id: 'F1', type: 'feeder', node: 'f1', amps: 200, label: '饋線一' },
        { id: 'L2', type: 'src', node: 'nL2', label: '回線二 345kV' },
        { id: 'DS-L2', type: 'ds', a: 'nL2', b: 'r1', closed: true, label: 'DS 回線二' },
        { id: 'CB-2T', type: 'cb', a: 'busT', b: 'r1', closed: true, label: 'CB 串二上' },
        { id: 'CB-2M', type: 'cb', a: 'r1', b: 'r2', closed: true, label: 'CB 串二中' },
        { id: 'DS-F2', type: 'ds', a: 'r2', b: 'f2', closed: true, label: 'DS 饋線二' },
        { id: 'F2', type: 'feeder', node: 'f2', amps: 160, label: '饋線二' },
        { id: 'CB-2D', type: 'cb', a: 'r2', b: 'busD', closed: true, label: 'CB 串二下' }
      ],
      task: {
        text: 'CB-M 開路且 DS 中上/中下皆開（檢修隔離），兩饋線維持供電、全程不斷電',
        check: api => api.live('F1') && api.live('F2') && !api.closed('CB-M') && !api.closed('DS-M1') && !api.closed('DS-M2') && !api.everLost('F1') && !api.everLost('F2')
      }
    }),
    S({
      id: 'sub_coord', name: '保護協調：饋線故障', tier: 3,
      desc: '饋線一故障→主保護 CB-F1 於 0.5s 跳脫（其餘照常供電）。再試：對 CB-F1「💉 注入拒動」後重新故障→後備 CB-IN 於 1.2s 越級跳脫、全站停電——這就是保護協調。',
      inherit: 'sub_basic',
      init: { 'DS-1': true, 'CB-IN': true, 'DS-2': true, 'DS-3': true, 'CB-F1': true, 'DS-5': true, 'CB-F2': true },
      faults: { F1: { primary: 'CB-F1', backup: 'CB-IN', t1: 0.5, t2: 1.2, label: '饋線一' } },
      task: {
        text: '體驗兩種跳脫後：清除故障、復歸並讓兩條饋線恢復供電',
        check: api => api.live('F1') && api.live('F2') && !api.faultActive()
      }
    }),
    S({
      id: 'sub_txbay', name: '主變壓器隔離檢修', tier: 3,
      desc: '主變年度檢修：依「停電→隔離」順序把主變完全隔離（CB 開、兩側 DS 開），過程勿帶載拉 DS。',
      nodes: { nL: [370, 70], n1: [370, 130], n2: [370, 210], busH: [0, 0], t1: [590, 330], t2: [590, 400], t3: [590, 470], f1: [880, 330], f2: [880, 400] },
      buses: [{ id: 'busH', x1: 220, x2: 1010, y: 270, label: '161kV 母線' }],
      elements: [
        { id: 'L1', type: 'src', node: 'nL', label: '台電 161kV' },
        { id: 'DS-1', type: 'ds', a: 'nL', b: 'n1', closed: true, label: 'DS 線路側' },
        { id: 'CB-IN', type: 'cb', a: 'n1', b: 'n2', closed: true, label: 'CB 進線' },
        { id: 'DS-2', type: 'ds', a: 'n2', b: 'busH', closed: true, label: 'DS 母線側' },
        { id: 'DS-TX1', type: 'ds', a: 'busH', b: 't1', closed: true, label: 'DS 主變上' },
        { id: 'CB-TX', type: 'cb', a: 't1', b: 't2', closed: true, label: 'CB 主變' },
        { id: 'TX1', type: 'tx', a: 't2', b: 't3', label: '主變 161/11.4kV' },
        { id: 'FTX', type: 'feeder', node: 't3', amps: 90, label: '11.4kV 廠內' },
        { id: 'DS-F1', type: 'ds', a: 'busH', b: 'f1', closed: true, label: 'DS 饋線' },
        { id: 'CB-F1', type: 'cb', a: 'f1', b: 'f2', closed: true, label: 'CB 饋線' },
        { id: 'F1', type: 'feeder', node: 'f2', amps: 60, label: '161kV 饋線' }
      ],
      task: {
        text: '主變完全隔離（CB-TX 開、DS 主變上開），161kV 饋線維持供電',
        check: api => api.live('F1') && !api.closed('CB-TX') && !api.closed('DS-TX1')
      }
    }),
    S({
      id: 'sub_loop', name: '環路運轉：解環操作', tier: 3,
      desc: '雙迴路成環（等電位）：環內任一 DS 可以安全開斷——因為另一條路還在。任務：在「DS 環東」處解環，兩饋線不斷電。',
      nodes: { nL: [590, 60], n0: [590, 120], w1: [300, 200], w2: [300, 330], e1: [880, 200], e2: [880, 330], busS: [0, 0], f1: [470, 470], f2: [710, 470] },
      buses: [{ id: 'busS', x1: 240, x2: 950, y: 390, label: '受電母線' }],
      elements: [
        { id: 'L1', type: 'src', node: 'nL', label: '台電 161kV' },
        { id: 'DS-0', type: 'ds', a: 'nL', b: 'n0', closed: true, label: 'DS 電源' },
        { id: 'CB-W', type: 'cb', a: 'n0', b: 'w1', closed: true, label: 'CB 環西', diag: true },
        { id: 'DS-W', type: 'ds', a: 'w1', b: 'w2', closed: true, label: 'DS 環西' },
        { id: 'LK-W', type: 'tx', a: 'w2', b: 'busS', label: '', link: true },
        { id: 'CB-E', type: 'cb', a: 'n0', b: 'e1', closed: true, label: 'CB 環東', diag: true },
        { id: 'DS-E', type: 'ds', a: 'e1', b: 'e2', closed: true, label: 'DS 環東' },
        { id: 'LK-E', type: 'tx', a: 'e2', b: 'busS', label: '', link: true },
        { id: 'DS-F1', type: 'ds', a: 'busS', b: 'f1', closed: true, label: 'DS 饋線一' },
        { id: 'F1', type: 'feeder', node: 'f1', amps: 70, label: '饋線一' },
        { id: 'DS-F2', type: 'ds', a: 'busS', b: 'f2', closed: true, label: 'DS 饋線二' },
        { id: 'F2', type: 'feeder', node: 'f2', amps: 50, label: '饋線二' }
      ],
      task: {
        text: '開斷「DS 環東」解環（等電位操作），兩饋線維持供電',
        check: api => api.live('F1') && api.live('F2') && !api.closed('DS-E')
      }
    }),
    S({
      id: 'sub_arc', name: '事故重現：帶負載拉 DS', tier: 3,
      desc: '負面教材（單線圖版）：饋線一正在供電，直接去開「DS 饋線一」——沒有等電位、也沒有先開 CB，看看會發生什麼。',
      inherit: 'sub_basic',
      init: { 'DS-1': true, 'CB-IN': true, 'DS-2': true, 'DS-3': true, 'CB-F1': true, 'DS-5': true, 'CB-F2': true },
      task: { text: '（觀察用）正確做法：先開 CB-F1 再開 DS——事故後重載情境比較兩種順序', check: () => false, demo: true }
    }),
    S({
      id: 'sub_grand', name: '綜合演練：倒母線＋母線檢修', tier: 4,
      desc: '終極科目：兩條饋線都從 A 母線倒到 B 母線（逐條、全程不斷電），最後把 A 母線完全隔離送檢修。',
      nodes: {
        nL: [260, 70], n1: [260, 130], n2: [260, 200],
        busA: [0, 0], busB: [0, 0],
        nt1: [520, 300], nt2: [520, 350],
        nfa: [760, 240], n3: [760, 430],
        nfb: [990, 240], n4: [990, 430]
      },
      buses: [
        { id: 'busA', x1: 140, x2: 1080, y: 280, label: 'A 母線' },
        { id: 'busB', x1: 140, x2: 1080, y: 370, label: 'B 母線' }
      ],
      elements: [
        { id: 'L1', type: 'src', node: 'nL', label: '台電 161kV' },
        { id: 'DS-1', type: 'ds', a: 'nL', b: 'n1', closed: true, label: 'DS 線路側' },
        { id: 'CB-IN', type: 'cb', a: 'n1', b: 'n2', closed: true, label: 'CB 進線' },
        { id: 'DS-A', type: 'ds', a: 'n2', b: 'busA', closed: true, label: 'DS 進線→A', selx: -18 },
        { id: 'DS-B', type: 'ds', a: 'n2', b: 'busB', closed: false, label: 'DS 進線→B', selx: 18 },
        { id: 'DS-TA', type: 'ds', a: 'busA', b: 'nt1', closed: false, label: 'DS 母聯A' },
        { id: 'CB-TIE', type: 'cb', a: 'nt1', b: 'nt2', closed: false, label: 'CB 母聯' },
        { id: 'DS-TB', type: 'ds', a: 'nt2', b: 'busB', closed: false, label: 'DS 母聯B' },
        { id: 'DS-FA', type: 'ds', a: 'busA', b: 'nfa', closed: true, label: 'DS 饋1→A', selx: -18 },
        { id: 'DS-FB', type: 'ds', a: 'busB', b: 'nfa', closed: false, label: 'DS 饋1→B', selx: 18 },
        { id: 'CB-F1', type: 'cb', a: 'nfa', b: 'n3', closed: true, label: 'CB 饋線一', drop: true },
        { id: 'F1', type: 'feeder', node: 'n3', amps: 120, label: '饋線一' },
        { id: 'DS-GA', type: 'ds', a: 'busA', b: 'nfb', closed: true, label: 'DS 饋2→A', selx: -18 },
        { id: 'DS-GB', type: 'ds', a: 'busB', b: 'nfb', closed: false, label: 'DS 饋2→B', selx: 18 },
        { id: 'CB-F2', type: 'cb', a: 'nfb', b: 'n4', closed: true, label: 'CB 饋線二', drop: true },
        { id: 'F2', type: 'feeder', node: 'n4', amps: 85, label: '饋線二' }
      ],
      task: {
        text: '兩饋線皆由 B 母線供電且不曾斷電、進線走 B、A 母線兩側 DS 全開（隔離完成）',
        check: api => api.live('F1') && api.live('F2') && !api.everLost('F1') && !api.everLost('F2') &&
          api.closed('DS-FB') && api.closed('DS-GB') && api.closed('DS-B') &&
          !api.closed('DS-FA') && !api.closed('DS-GA') && !api.closed('DS-A') && !api.closed('DS-TA')
      }
    }),
    S({
      id: 'sub_seq2', name: '停電操作：全站安全停電', tier: 1,
      desc: '反向基本功：把已在供電的全站安全停電——順序是「先開各 CB、再開各 DS」，任何一步帶載拉 DS 都是事故。',
      inherit: 'sub_basic',
      init: { 'DS-1': true, 'CB-IN': true, 'DS-2': true, 'DS-3': true, 'CB-F1': true, 'DS-5': true, 'CB-F2': true },
      task: {
        text: '全部 CB 與 DS 開路（全站停電隔離），全程無事故',
        check: api => ['DS-1', 'CB-IN', 'DS-2', 'DS-3', 'CB-F1', 'DS-5', 'CB-F2'].every(id => !api.closed(id)) && !api.anyFault()
      }
    })
  ];

  /* ================= 情境載入 ================= */
  function baseOf(def) {
    if (!def.inherit) return def;
    const base = SCENARIOS.find(x => x.id === def.inherit);
    return {
      ...base, ...def,
      nodes: def.nodes || base.nodes,
      buses: def.buses || base.buses,
      elements: def.elements || base.elements
    };
  }

  function loadScenario(id) {
    const def = SCENARIOS.find(x => x.id === id);
    if (!def) return { ok: false, error: '未知情境 ' + id + '。可用：' + SCENARIOS.map(x => x.id).join('、') };
    const full = baseOf(def);
    st.sc = {
      id: full.id, name: full.name, desc: full.desc, task: full.task, faults: full.faults || {},
      nodes: JSON.parse(JSON.stringify(full.nodes)),
      buses: JSON.parse(JSON.stringify(full.buses)),
      elements: JSON.parse(JSON.stringify(full.elements))
    };
    if (full.init) for (const [eid, v] of Object.entries(full.init)) {
      const el = st.sc.elements.find(e => e.id === eid);
      if (el) el.closed = v;
    }
    st.scId = id;
    st.sheet = [];
    st.log = [];
    st.fault = null;
    st.taskDone = false;
    st.everLost = {};
    st._prevF = null;   // 清掉上一情境的饋線狀態，避免誤記 everLost
    st.builder.tool = null;
    st.builder.pendA = null;
    pushLog(`載入情境【${full.name}】`);
    changed();
    return { ok: true, scenario: full.name };
  }

  /* ================= 自由建構（空白單線圖） ================= */
  const clampX = x => Math.max(40, Math.min(LW - 40, Math.round(x)));
  const clampY = y => Math.max(50, Math.min(LH - 70, Math.round(y)));

  function buildStart() {
    st.sc = {
      id: 'custom', name: '自由建構單線圖',
      desc: '空白單線圖：從工具列放電源、母線、CB／DS／變壓器、饋線，接好就能操作測試；注入故障看自動保護協調。',
      task: null, faults: {}, nodes: {}, buses: [], elements: []
    };
    st.scId = 'custom';
    st.sheet = []; st.log = []; st.fault = null; st.taskDone = false; st.everLost = {}; st._prevF = null;
    st.counters = { n: 0, b: 0, d: {} };
    st.builder.tool = null; st.builder.pendA = null; st.builder.drag = null;
    pushLog('已開始自由建構——先放「電源」與「母線」，再用 DS／CB 把它們接起來。');
    changed();
    return { ok: true };
  }
  function recount() {
    // 還原自由建構後，讓流水號接續既有 id，避免撞名
    st.counters = { n: 0, b: 0, d: {} };
    for (const id of Object.keys(st.sc.nodes)) { const m = id.match(/^n(\d+)$/); if (m) st.counters.n = Math.max(st.counters.n, +m[1]); }
    for (const b of st.sc.buses) { const m = b.id.match(/^B(\d+)$/); if (m) st.counters.b = Math.max(st.counters.b, +m[1]); }
    for (const el of st.sc.elements) { const m = el.id.match(/^([A-Z]+)-(\d+)$/); if (m) st.counters.d[m[1]] = Math.max(st.counters.d[m[1]] || 0, +m[2]); }
  }
  const isCustom = () => !!(st.sc && st.sc.id === 'custom');

  function anchorAt(x, y) {
    if (!st.sc) return { kind: 'new', x, y };
    for (const b of st.sc.buses) if (Math.abs(y - b.y) < 14 && x >= b.x1 - 10 && x <= b.x2 + 10) return { kind: 'bus', id: b.id };
    for (const [id, p] of Object.entries(st.sc.nodes)) if (Math.hypot(p[0] - x, p[1] - y) < 15) return { kind: 'node', id };
    return { kind: 'new', x: clampX(x), y: clampY(y) };
  }
  function resolveAnchor(spec) {
    if (spec == null) return null;
    if (typeof spec === 'string') {
      const s = spec.trim();
      if (st.sc.buses.some(b => b.id === s)) return { kind: 'bus', id: s };
      if (st.sc.nodes[s]) return { kind: 'node', id: s };
      const m = s.match(/^(\d+)\s*,\s*(\d+)$/);
      if (m) return anchorAt(+m[1], +m[2]);
      return null;
    }
    if (spec.kind) return spec;
    if (typeof spec.x === 'number' && typeof spec.y === 'number') return anchorAt(spec.x, spec.y);
    return null;
  }
  function anchorNodeId(a) {
    if (a.kind === 'bus' || a.kind === 'node') return a.id;
    const id = 'n' + (++st.counters.n);
    st.sc.nodes[id] = [clampX(a.x), clampY(a.y)];
    return id;
  }
  function devId(prefix) {
    st.counters.d[prefix] = (st.counters.d[prefix] || 0) + 1;
    return `${prefix}-${st.counters.d[prefix]}`;
  }

  function buildAdd(kind, opts) {
    if (!isCustom()) return { ok: false, error: '先開始「自由建構」（載入空白單線圖）才能放元件' };
    opts = opts || {};
    if (kind === 'bus') {
      const id = 'B' + (++st.counters.b);
      const y = clampY(opts.y ?? 270);
      if (st.sc.buses.some(b => Math.abs(b.y - y) < 26)) return { ok: false, error: '離既有母線太近（垂直間隔至少 26）' };
      st.sc.buses.push({ id, x1: 220, x2: 960, y, label: opts.label ? String(opts.label).slice(0, 16) : `${id} 母線` });
      pushLog(`放置母線 ${id}`);
      changed();
      return { ok: true, id };
    }
    if (kind === 'src') {
      const kv = ['345kV', '161kV', '11.4kV'].includes(opts.kv) ? opts.kv : '11.4kV';
      const a = resolveAnchor(opts.at) || anchorAt(opts.x ?? 300, Math.min(opts.y ?? 70, 200));
      if (a.kind === 'bus') return { ok: false, error: '電源請放在空白處，再用 DS 接到母線（實務：進線經隔離開關）' };
      const nid = anchorNodeId(a);
      if (st.sc.elements.some(e => e.type === 'src' && e.node === nid)) return { ok: false, error: '該節點已有電源' };
      const id = devId('SRC');
      st.sc.elements.push({ id, type: 'src', node: nid, label: `台電 ${kv}` });
      pushLog(`放置電源 ${id}（${kv}）`);
      changed();
      return { ok: true, id, node: nid };
    }
    if (kind === 'feeder') {
      const a = resolveAnchor(opts.at) || anchorAt(opts.x ?? 500, Math.max(opts.y ?? 430, 320));
      if (a.kind === 'bus') return { ok: false, error: '饋線請放在空白處，再用 DS／CB 接到母線' };
      const nid = anchorNodeId(a);
      const id = devId('F');
      const amps = Math.max(5, Math.min(600, Math.round(+opts.amps || 60)));
      st.sc.elements.push({ id, type: 'feeder', node: nid, amps, label: opts.label ? String(opts.label).slice(0, 12) : `饋線${st.counters.d.F}` });
      pushLog(`放置饋線 ${id}（${amps}A）`);
      changed();
      return { ok: true, id, node: nid };
    }
    if (kind === 'cb' || kind === 'ds' || kind === 'tx') {
      const a = resolveAnchor(opts.a), b = resolveAnchor(opts.b);
      if (!a || !b) return { ok: false, error: 'a／b 端點無法解析（可用母線 id、節點 id 或 "x,y" 座標）' };
      const na = anchorNodeId(a), nb = anchorNodeId(b);
      if (na === nb) return { ok: false, error: '兩端不能是同一點' };
      if (st.sc.elements.some(e => (e.a === na && e.b === nb) || (e.a === nb && e.b === na))) return { ok: false, error: '這兩點之間已有設備' };
      const prefix = kind === 'cb' ? 'CB' : kind === 'ds' ? 'DS' : 'TX';
      const id = devId(prefix);
      const el = { id, type: kind, a: na, b: nb, label: opts.label ? String(opts.label).slice(0, 12) : id };
      if (kind !== 'tx') el.closed = false;   // 新裝設備一律開路（安全）
      st.sc.elements.push(el);
      pushLog(`放置 ${id}（${kind === 'cb' ? '斷路器' : kind === 'ds' ? '隔離開關' : '變壓器'}）`);
      changed();
      return { ok: true, id, a: na, b: nb };
    }
    return { ok: false, error: `未知元件「${kind}」。可用：bus、src、feeder、cb、ds、tx` };
  }

  function buildRemove(id) {
    if (!isCustom()) return { ok: false, error: '僅自由建構模式可刪除' };
    const bus = st.sc.buses.find(b => b.id === id);
    if (bus) {
      if (st.sc.elements.some(e => e.a === id || e.b === id)) return { ok: false, error: '先刪除接在這條母線上的設備' };
      st.sc.buses = st.sc.buses.filter(b => b.id !== id);
      pushLog(`移除母線 ${id}`);
      cleanupNodes(); changed();
      return { ok: true };
    }
    const el = elById(id);
    if (!el) return { ok: false, error: `找不到「${id}」` };
    st.sc.elements = st.sc.elements.filter(e => e.id !== id);
    pushLog(`移除 ${id}`);
    cleanupNodes(); changed();
    return { ok: true };
  }
  function cleanupNodes() {
    const used = new Set();
    for (const el of st.sc.elements) { if (el.a) used.add(el.a); if (el.b) used.add(el.b); if (el.node) used.add(el.node); }
    for (const id of Object.keys(st.sc.nodes)) if (!used.has(id)) delete st.sc.nodes[id];
  }

  function setBuildTool(tool) {
    const T = ['src345', 'src161', 'src114', 'bus', 'cb', 'ds', 'tx', 'feeder', 'del', null];
    if (!T.includes(tool)) tool = null;
    st.builder.tool = tool;
    st.builder.pendA = null;
    render();
    return { ok: true, tool };
  }

  function buildClick(x, y) {
    const t = st.builder.tool;
    if (t === 'bus') { buildAdd('bus', { y }); return; }
    if (t === 'src345' || t === 'src161' || t === 'src114') {
      buildAdd('src', { kv: t === 'src345' ? '345kV' : t === 'src161' ? '161kV' : '11.4kV', x, y });
      return;
    }
    if (t === 'feeder') { buildAdd('feeder', { x, y }); return; }
    if (t === 'del') {
      const el = pick(x, y) || pickAny(x, y);
      if (el) { const r = buildRemove(el.id); if (!r.ok) pushLog('⚠ ' + r.error); render(); }
      return;
    }
    if (t === 'cb' || t === 'ds' || t === 'tx') {
      const a = anchorAt(x, y);
      if (!st.builder.pendA) { st.builder.pendA = a; render(); return; }
      const r = buildAdd(t, { a: st.builder.pendA, b: a });
      if (!r.ok) pushLog('⚠ ' + r.error);
      st.builder.pendA = null;
      render();
    }
  }
  function pickAny(x, y) {
    // 刪除工具用：除了 CB/DS/TX（pick 可撿），也要能點到電源、饋線與母線
    for (const el of st.sc.elements) {
      if (el.node) { const p = st.sc.nodes[el.node]; if (p && Math.hypot(p[0] - x, p[1] - y) < 22) return el; }
      if (el.type === 'tx' && el.a) { const [mx, my] = midOf(el); if (Math.hypot(mx - x, my - y) < 16) return el; }
    }
    for (const b of st.sc.buses) if (Math.abs(y - b.y) < 12 && x >= b.x1 - 8 && x <= b.x2 + 8) return b;
    return null;
  }

  /* 自動保護協調：由故障點出發，路徑上第一台閉合 CB＝主保護、第二台＝後備 */
  function protectionLayers(fn) {
    const adj = {};
    const link = (a, b, el) => { (adj[a] = adj[a] || []).push({ o: b, el }); (adj[b] = adj[b] || []).push({ o: a, el }); };
    for (const el of st.sc.elements) {
      if (el.type === 'tx') link(el.a, el.b, el);
      else if ((el.type === 'cb' || el.type === 'ds') && el.closed && !el.fault) link(el.a, el.b, el);
    }
    const best = new Map([[fn, 0]]);
    const q = [[fn, 0]];
    const L1 = new Set(), L2 = new Set();
    while (q.length) {
      const [n, c] = q.shift();
      for (const { o, el } of (adj[n] || [])) {
        let nc = c;
        if (el.type === 'cb') {
          if (c === 0) L1.add(el.id);
          else if (c === 1) L2.add(el.id);
          nc = c + 1;
          if (nc >= 2) continue;
        }
        if ((best.get(o) ?? 9) > nc) { best.set(o, nc); q.push([o, nc]); }
      }
    }
    return { L1: [...L1], L2: [...L2] };
  }

  /* ================= 連通與規則 ================= */
  function makeUF() {
    const par = {};
    const find = x => { while (par[x] !== undefined && par[x] !== x) { par[x] = par[par[x]] ?? par[x]; x = par[x]; } return par[x] === undefined ? (par[x] = x) : x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) par[ra] = rb; };
    return { find, union };
  }
  function buildUF(skipId) {
    const uf = makeUF();
    for (const el of st.sc.elements) {
      if (el.id === skipId) continue;
      if (el.type === 'tx' || ((el.type === 'cb' || el.type === 'ds') && el.closed && !el.fault)) uf.union(el.a, el.b);
    }
    return uf;
  }
  function liveSetOf(uf) {
    const roots = new Set();
    for (const el of st.sc.elements) if (el.type === 'src') roots.add(uf.find(el.node));
    return roots;
  }
  function nodeLive(uf, live, node) { return live.has(uf.find(node)); }
  function feederStates(skipId, closeId) {
    // 回傳 {feederId: live} —— skipId 假設開路、closeId 假設閉合
    const uf = makeUF();
    for (const el of st.sc.elements) {
      const closed = el.id === skipId ? false : el.id === closeId ? true : ((el.type === 'tx') || el.closed);
      if (el.id !== skipId && (el.type === 'tx' || ((el.type === 'cb' || el.type === 'ds') && closed && !el.fault))) uf.union(el.a, el.b);
    }
    const live = liveSetOf(uf);
    const out = {};
    for (const el of st.sc.elements) if (el.type === 'feeder') out[el.id] = nodeLive(uf, live, el.node);
    return out;
  }

  function elById(id) { return st.sc && st.sc.elements.find(e => e.id === id); }

  function operate(id) {
    if (!st.sc) return { ok: false, error: '尚未載入情境' };
    const el = elById(id) || st.sc.elements.find(e => e.label === id);
    if (!el) return { ok: false, error: `找不到設備「${id}」。可操作：${st.sc.elements.filter(e => e.type === 'cb' || e.type === 'ds').map(e => e.id).join('、')}` };
    if (el.type === 'src' || el.type === 'feeder' || el.type === 'tx') return { ok: false, error: `${el.label || el.id} 不是可操作的開關設備` };
    if (el.fault) return { ok: false, error: `${el.id} 已弧光損壞——重新載入情境（實務上要更換設備）` };
    const lbl = `${el.id}（${el.label}）`;

    if (el.type === 'ds') {
      const wasClosed = !!el.closed;
      const before = feederStates();
      const after = wasClosed ? feederStates(el.id) : feederStates(null, el.id);
      const delta = Object.keys(before).filter(f => before[f] !== after[f]);
      if (delta.length) {
        el.fault = true;
        el.closed = false;
        sheet(`✗ ${wasClosed ? '開斷' : '投入'} ${lbl} —— 弧光事故！`);
        pushLog(`⚡⚡ ${lbl} ${'帶負載操作'}——DS 沒有滅弧能力，弧光事故！受影響：${delta.join('、')}。正確做法：先以 CB 切斷負載，或建立等電位並聯迴路（母聯／環路）後再操作 DS。`);
        st.everLostMark();
        changed();
        return { ok: true, fault: true, msg: '弧光事故：DS 帶負載操作' };
      }
      if (!el.closed) {
        // 合 DS 到兩個不同帶電網＝非同期併聯
        const uf = buildUF();
        const live = liveSetOf(uf);
        const fa = uf.find(el.a), fb = uf.find(el.b);
        if (live.has(fa) && live.has(fb) && fa !== fb) {
          el.fault = true;
          sheet(`✗ 投入 ${lbl} —— 非同期併聯事故！`);
          pushLog(`⚡⚡ ${lbl} 兩側是「不同的帶電系統」——未經同期檢定直接併聯，事故！`);
          changed();
          return { ok: true, fault: true, msg: '非同期併聯事故' };
        }
      }
      el.closed = !el.closed;
      sheet(`${el.closed ? '投入' : '開斷'} ${lbl}`);
      pushLog(`${lbl} ${el.closed ? '投入 ●' : '開斷 ○'}（${el.closed ? '無載合閘' : '無電流／等電位開斷'} ✓）`);
    } else {
      el.closed = !el.closed;
      el.tripped = false;
      sheet(`${el.closed ? '投入' : '開斷'} ${lbl}`);
      pushLog(`${lbl} ${el.closed ? '投入 ●' : '開斷 ○'}`);
    }
    changed();
    return { ok: true, closed: el.closed };
  }

  /* ================= 故障與保護 ================= */
  function injectFault(target) {
    if (!st.sc) return { ok: false, error: '尚未載入情境' };
    if (st.fault && !st.fault.cleared) return { ok: false, error: '已有故障進行中——先清除故障' };
    if (isCustom()) {
      // 自由建構：任何饋線或母線都能注入，主／後備保護自動判定
      const el = elById(target);
      const bus = st.sc.buses.find(b => b.id === target);
      const key = (el && el.type === 'feeder') ? el.id : bus ? bus.id : null;
      if (!key) {
        const avail = [...st.sc.elements.filter(e => e.type === 'feeder').map(e => e.id), ...st.sc.buses.map(b => b.id)];
        return { ok: false, error: `故障點需是饋線或母線${avail.length ? '：可用 ' + avail.join('、') : '（先放饋線／母線）'}` };
      }
      const label = el ? el.label : bus.label;
      st.fault = { target: key, custom: true, cfg: { label }, t: 0, cleared: false, primaryFired: false, backupFired: false };
      sheet(`⚡ ${label} 發生故障`);
      pushLog(`⚡ ${label} 故障！最近的閉合 CB＝主保護（0.5s）、上一級＝後備（1.2s 越級）。`);
      changed();
      return { ok: true };
    }
    const cfgs = st.sc.faults || {};
    const key = target || Object.keys(cfgs)[0];
    if (!key || !cfgs[key]) return { ok: false, error: `此情境沒有可注入的故障點${Object.keys(cfgs).length ? '：可用 ' + Object.keys(cfgs).join('、') : ''}` };
    st.fault = { target: key, cfg: cfgs[key], t: 0, cleared: false, primaryFired: false, backupFired: false };
    sheet(`⚡ ${cfgs[key].label} 發生故障`);
    pushLog(`⚡ ${cfgs[key].label} 故障！保護啟動計時⋯`);
    changed();
    return { ok: true };
  }
  function clearFault() {
    if (!st.fault) return { ok: false, error: '沒有故障' };
    st.fault = null;
    sheet('故障點修復完成');
    pushLog('🔧 故障已清除（現場修復完成）——可依序復電。');
    changed();
    return { ok: true };
  }
  function toggleDefect(cbId) {
    const el = elById(cbId);
    if (!el || el.type !== 'cb') return { ok: false, error: '拒動缺陷只能注入在 CB 上' };
    el.defect = !el.defect;
    pushLog(el.defect ? `💉 ${el.id} 已注入【拒動】缺陷——保護動作時它不會跳。` : `✨ ${el.id} 拒動缺陷已清除。`);
    changed();
    return { ok: true, defect: !!el.defect };
  }

  function faultNodeOf(key) {
    const el = elById(key);
    if (el) return el.type === 'feeder' ? el.node : (el.a || el.node || null);
    // 母線／節點 id 本身就是 UF 節點
    if (st.sc.buses.some(b => b.id === key) || st.sc.nodes[key]) return key;
    return null;
  }

  function tick() {
    // 畫布隱藏（不在變電所模式）時暫停模擬，避免背景空轉
    if (!st.canvas || st.canvas.offsetParent === null) return;
    st.blink = !st.blink;
    if (st.fault && !st.fault.cleared) {
      const uf = buildUF();
      const live = liveSetOf(uf);
      const fn = faultNodeOf(st.fault.target);
      const hot = fn && nodeLive(uf, live, fn);
      if (hot && st.fault.custom) {
        // 自由建構：自動保護協調
        st.fault.t += 0.3;
        if (!st.fault.primaryFired && st.fault.t >= 0.5) {
          st.fault.primaryFired = true;
          const { L1 } = protectionLayers(fn);
          for (const id of L1) {
            const cb = elById(id);
            if (!cb || !cb.closed) continue;
            if (cb.defect) { pushLog(`${id} 收到跳脫令但【拒動】——等待後備保護⋯`); continue; }
            cb.closed = false; cb.tripped = true;
            sheet(`⚡ ${id} 主保護跳脫（0.5s）`);
            pushLog(`${id} 主保護跳脫！⚡（最近的閉合 CB，t=0.5s）`);
          }
        }
        if (!st.fault.backupFired && st.fault.t >= 1.2) {
          const stillHot = (() => { const uf2 = buildUF(); return nodeLive(uf2, liveSetOf(uf2), fn); })();
          if (stillHot) {
            st.fault.backupFired = true;
            const { L1, L2 } = protectionLayers(fn);
            for (const id of [...L1, ...L2]) {
              const cb = elById(id);
              if (!cb || !cb.closed || cb.defect) continue;
              cb.closed = false; cb.tripped = true;
              const isBak = L2.includes(id);
              sheet(`⚡ ${id} ${isBak ? '後備保護越級跳脫' : '保護跳脫'}（1.2s）`);
              pushLog(`${id} ${isBak ? '後備保護越級跳脫！⚡——主保護拒動時上一級動作，停電範圍擴大。' : '保護跳脫！⚡（1.2s）'}`);
            }
          }
        }
      } else if (hot) {
        st.fault.t += 0.3;
        const { cfg } = st.fault;
        const prim = elById(cfg.primary);
        if (!st.fault.primaryFired && st.fault.t >= cfg.t1) {
          st.fault.primaryFired = true;
          if (prim && !prim.defect && prim.closed) {
            prim.closed = false;
            prim.tripped = true;
            sheet(`⚡ ${prim.id} 主保護跳脫（${cfg.t1}s）`);
            pushLog(`${prim.id} 主保護跳脫！⚡（t=${cfg.t1}s）故障隔離${cfg.backup ? '，其餘迴路維持供電' : ''}。`);
          } else if (prim && prim.defect) {
            pushLog(`${prim.id} 收到跳脫令但【拒動】——等待後備保護⋯`);
          }
        }
        if (cfg.backup && !st.fault.backupFired && st.fault.t >= (cfg.t2 || 1.2)) {
          const bak = elById(cfg.backup);
          const stillHot = (() => { const uf2 = buildUF(); return nodeLive(uf2, liveSetOf(uf2), fn); })();
          if (stillHot && bak && bak.closed) {
            st.fault.backupFired = true;
            bak.closed = false;
            bak.tripped = true;
            sheet(`⚡ ${bak.id} 後備保護越級跳脫（${cfg.t2}s）`);
            pushLog(`${bak.id} 後備保護越級跳脫！⚡（t=${cfg.t2}s）——主保護拒動時上一級動作，代價是停電範圍擴大。`);
          }
        }
      }
    }
    trackFeeders();
    render();
    if (st.onSim) st.onSim();
  }

  function trackFeeders() {
    if (!st.sc) return;
    const states = feederStates();
    for (const [f, liveNow] of Object.entries(states)) {
      if (st._prevF && st._prevF[f] && !liveNow) st.everLost[f] = true;
    }
    st._prevF = states;
    // 任務判定（達成後閂鎖）
    if (!st.taskDone && st.sc.task && !st.sc.task.demo) {
      if (st.sc.task.check(taskApi())) {
        st.taskDone = true;
        sheet('✅ 任務完成');
        pushLog(`✅ 任務完成：${st.sc.task.text}`);
      }
    }
  }
  function taskApi() {
    const uf = buildUF();
    const live = liveSetOf(uf);
    return {
      live: fid => { const el = elById(fid); return !!el && nodeLive(uf, live, el.node); },
      liveNode: n => nodeLive(uf, live, n),
      closed: id => { const el = elById(id); return !!el && !!el.closed; },
      everLost: fid => !!st.everLost[fid],
      faultActive: () => !!(st.fault && !st.fault.cleared) || st.sc.elements.some(e => e.tripped),
      anyFault: () => st.sc.elements.some(e => e.fault)
    };
  }
  st.everLostMark = () => trackFeeders();

  function sheet(text) { st.sheet.push({ n: st.sheet.length + 1, text }); }
  function pushLog(t) { st.log.push(t); if (st.log.length > 40) st.log.shift(); }

  /* ================= 座標與繪製 ================= */
  function nodeXY(id) {
    const bus = st.sc.buses.find(b => b.id === id);
    if (bus) return null;   // 母線由呼叫端處理 x
    return st.sc.nodes[id];
  }
  function segOf(el) {
    // 回傳線段兩端座標；接母線的一端 x 取另一端的 x（垂直落線），selx 為選擇 DS 的水平偏移
    const busA = st.sc.buses.find(b => b.id === el.a);
    const busB = st.sc.buses.find(b => b.id === el.b);
    let pa = nodeXY(el.a), pb = nodeXY(el.b);
    const off = el.selx || 0;
    if (busA && pb) pa = [pb[0] + off, busA.y];
    if (busB && pa) pb = [pa[0] + off, busB.y];
    if (busA && busB) { const x = el.x || (busA.x1 + busA.x2) / 2; pa = [x, busA.y]; pb = [x, busB.y]; }
    if (el.selx && pa && pb) { pa = [pa[0] + off, pa[1]]; pb = [pb[0], pb[1]]; }
    return [pa, pb];
  }
  function midOf(el) {
    const [pa, pb] = segOf(el);
    const t = el.seg !== undefined ? el.seg : 0.5;
    return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
  }

  function render() {
    const { ctx } = st;
    if (!ctx || !st.sc) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, st.canvas.width, st.canvas.height);
    ctx.setTransform(st.dpr * st.scale, 0, 0, st.dpr * st.scale, st.dpr * st.ox, st.dpr * st.oy);

    // 盤面
    ctx.fillStyle = '#eef0f2';
    ctx.strokeStyle = '#c5cad0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(8, 8, LW - 16, LH - 16, 12) : ctx.rect(8, 8, LW - 16, LH - 16);
    ctx.fill(); ctx.stroke();
    ctx.font = '600 12px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#8a8f95';
    ctx.fillText('SINGLE-LINE DIAGRAM · 變電所單線圖', 24, 30);

    const uf = buildUF();
    const live = liveSetOf(uf);
    const hotN = n => nodeLive(uf, live, n);
    const colOf = hot => hot ? '#c2402a' : '#9aa2aa';
    const faultN = st.fault && !st.fault.cleared ? faultNodeOf(st.fault.target) : null;

    // 母線
    for (const b of st.sc.buses) {
      const hot = hotN(b.id);
      ctx.strokeStyle = (faultN === b.id && st.blink) ? '#ffb020' : colOf(hot);
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(b.x1, b.y); ctx.lineTo(b.x2, b.y); ctx.stroke();
      ctx.font = '700 12px "Noto Sans TC", sans-serif';
      ctx.fillStyle = '#3b4046';
      ctx.fillText(b.label, b.x1, b.y - 12);
    }

    // 線段與設備
    for (const el of st.sc.elements) {
      if (el.type === 'src') {
        const [x, y] = st.sc.nodes[el.node];
        const hot = true;
        ctx.strokeStyle = colOf(hot);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x - 10, y - 18); ctx.lineTo(x, y); ctx.lineTo(x + 10, y - 18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y - 30); ctx.lineTo(x, y); ctx.stroke();
        ctx.font = '700 12px "Noto Sans TC", sans-serif';
        ctx.fillStyle = '#7a2a45';
        ctx.textAlign = 'center';
        ctx.fillText(el.label, x, y - 38);
        ctx.textAlign = 'left';
        continue;
      }
      if (el.type === 'feeder') {
        const [x, y] = st.sc.nodes[el.node];
        const hot = hotN(el.node);
        const isF = faultN === el.id;
        ctx.strokeStyle = isF && st.blink ? '#ffb020' : colOf(hot);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 24); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 8, y + 24); ctx.lineTo(x, y + 36); ctx.lineTo(x + 8, y + 24); ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        ctx.font = '12px "Noto Sans TC", sans-serif';
        ctx.fillStyle = hot ? '#1f7a4d' : '#8a8f95';
        ctx.textAlign = 'center';
        ctx.fillText(`${el.label}`, x, y + 54);
        ctx.font = '700 11px monospace';
        ctx.fillText(hot ? `● ${el.amps}A` : '○ 停電', x, y + 70);
        if (isF) { ctx.fillStyle = '#c2402a'; ctx.fillText('⚡故障', x, y + 86); }
        ctx.textAlign = 'left';
        continue;
      }
      // 線段類（cb/ds/tx）
      const [pa, pb] = segOf(el);
      if (!pa || !pb) continue;
      const hotA = hotN(el.a), hotB = hotN(el.b);
      const mid = midOf(el);
      ctx.lineWidth = 3;
      // 兩半段各自著色
      ctx.strokeStyle = colOf(hotA);
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(mid[0], mid[1]); ctx.stroke();
      ctx.strokeStyle = colOf(hotB);
      ctx.beginPath(); ctx.moveTo(mid[0], mid[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();

      const [mx, my] = mid;
      if (el.type === 'cb') {
        ctx.fillStyle = el.fault ? '#c2402a' : el.closed ? (hotA || hotB ? '#c2402a' : '#5a646e') : '#f5f2ea';
        ctx.strokeStyle = el.tripped ? '#ffb020' : '#3b4046';
        ctx.lineWidth = el.tripped ? 3 : 2;
        ctx.fillRect(mx - 9, my - 9, 18, 18);
        ctx.strokeRect(mx - 9, my - 9, 18, 18);
        if (el.defect) { ctx.font = '10px monospace'; ctx.fillStyle = '#ffb020'; ctx.fillText('💉', mx + 11, my - 8); }
        if (el.tripped) { ctx.font = '700 9px monospace'; ctx.fillStyle = '#b0621e'; ctx.fillText('TRIP', mx + 13, my + 4); }
      } else if (el.type === 'ds') {
        ctx.strokeStyle = el.fault ? '#c2402a' : '#3b4046';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(mx, my - 10, 2.5, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(mx, my + 10, 2.5, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx, my + 10);
        if (el.closed && !el.fault) ctx.lineTo(mx, my - 10);
        else ctx.lineTo(mx + 12, my - 6);
        ctx.stroke();
        if (el.fault) { ctx.font = '700 10px monospace'; ctx.fillStyle = '#c2402a'; ctx.fillText('⚡弧光', mx + 12, my + 4); }
      } else if (el.type === 'tx' && !el.link) {
        ctx.strokeStyle = colOf(hotA || hotB);
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(mx, my - 6, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(mx, my + 6, 9, 0, Math.PI * 2); ctx.stroke();
      }
      // 標籤
      if (el.label && el.type !== 'tx') {
        ctx.font = '10.5px "Noto Sans TC", sans-serif';
        ctx.fillStyle = st.hover === el.id ? '#0e7a6e' : '#5a6067';
        ctx.fillText(el.label, mx + 16, my + 4);
      } else if (el.label) {
        ctx.font = '10.5px "Noto Sans TC", sans-serif';
        ctx.fillStyle = '#5a6067';
        ctx.fillText(el.label, mx + 14, my + 4);
      }
    }

    // 自由建構：節點錨點與放置提示
    if (isCustom()) {
      for (const [id, p] of Object.entries(st.sc.nodes)) {
        ctx.fillStyle = st.builder.drag === id ? '#0e7a6e' : 'rgba(60,70,80,.55)';
        ctx.beginPath(); ctx.arc(p[0], p[1], 3.2, 0, Math.PI * 2); ctx.fill();
      }
      const pa = st.builder.pendA;
      if (pa) {
        let px = pa.x, py = pa.y;
        if (pa.kind === 'node') { const p = st.sc.nodes[pa.id]; if (p) { px = p[0]; py = p[1]; } }
        if (pa.kind === 'bus') { const b = st.sc.buses.find(x2 => x2.id === pa.id); if (b) { px = (b.x1 + b.x2) / 2; py = b.y; } }
        if (px !== undefined) {
          ctx.strokeStyle = '#0e7a6e'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.font = '700 13px "Noto Sans TC", sans-serif';
      ctx.fillStyle = '#0e7a6e';
      const t = st.builder.tool;
      const toolTxt = t === 'bus' ? '點畫面放母線（點高度）'
        : t === 'src345' || t === 'src161' || t === 'src114' ? '點空白處放電源'
        : t === 'feeder' ? '點空白處放饋線'
        : t === 'del' ? '點設備或母線刪除'
        : (t === 'cb' || t === 'ds' || t === 'tx') ? (st.builder.pendA ? '再點第二端（母線／節點／空白）完成連接' : '點第一端（母線／節點／空白）')
        : null;
      ctx.fillText(`🏗 自由建構${toolTxt ? '：' + toolTxt : '——用上方工具列放置元件；點 CB/DS 可操作、拖節點可排版'}`, 24, LH - 22);
      return;
    }

    // 任務橫幅
    if (st.sc.task) {
      ctx.font = '700 13px "Noto Sans TC", sans-serif';
      ctx.fillStyle = st.taskDone ? '#1f8a4d' : '#7a5a1e';
      ctx.fillText(`${st.taskDone ? '✅ 任務完成' : '🎯 任務'}：${st.sc.task.text}`, 24, LH - 22);
    }
  }

  /* ================= 互動／縮放 ================= */
  function toLogical(e) {
    const rect = st.canvas.getBoundingClientRect();
    return [(e.clientX - rect.left - st.ox) / st.scale, (e.clientY - rect.top - st.oy) / st.scale];
  }
  function pick(x, y) {
    if (!st.sc) return null;
    for (const el of st.sc.elements) {
      if (el.type !== 'cb' && el.type !== 'ds') continue;
      const [mx, my] = midOf(el);
      if (Math.hypot(mx - x, my - y) < 16) return el;
    }
    return null;
  }
  function applyView() {
    st.scale = st.baseScale * st.zoom;
    st.ox = st.baseOx + st.panX;
    st.oy = st.baseOy + st.panY;
    render();
  }
  function onWheel(e) {
    e.preventDefault();
    const rect = st.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const lx = (cx - st.ox) / st.scale, ly = (cy - st.oy) / st.scale;
    st.zoom = Math.min(4, Math.max(0.5, st.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    st.scale = st.baseScale * st.zoom;
    st.panX = cx - lx * st.scale - st.baseOx;
    st.panY = cy - ly * st.scale - st.baseOy;
    applyView();
  }
  function onDown(e) {
    const [x, y] = toLogical(e);
    if (isCustom() && st.builder.tool) { buildClick(x, y); return; }
    const el = pick(x, y);
    if (el) { operate(el.id); return; }
    if (isCustom()) {
      // 沒點到設備：靠近節點就進入節點拖曳（重新排版）
      const hit = Object.entries(st.sc.nodes).find(([, p]) => Math.hypot(p[0] - x, p[1] - y) < 13);
      if (hit) { st.builder.drag = hit[0]; return; }
    }
    st.panDrag = { x: e.clientX, y: e.clientY };
  }
  function onMove(e) {
    if (st.builder.drag) {
      const [x, y] = toLogical(e);
      st.sc.nodes[st.builder.drag] = [clampX(x), clampY(y)];
      render();
      return;
    }
    if (st.panDrag) {
      const dx = e.clientX - st.panDrag.x, dy = e.clientY - st.panDrag.y;
      if (st.panDrag.on || Math.hypot(dx, dy) > 4) {
        st.panDrag.on = true;
        st.panX += dx; st.panY += dy;
        st.panDrag.x = e.clientX; st.panDrag.y = e.clientY;
        applyView();
        return;
      }
    }
    const [x, y] = toLogical(e);
    const el = pick(x, y);
    const h = el ? el.id : null;
    if (h !== st.hover) { st.hover = h; st.canvas.style.cursor = h ? 'pointer' : 'default'; render(); }
  }
  function onDbl(e) {
    const [x, y] = toLogical(e);
    if (!pick(x, y)) { st.zoom = 1; st.panX = 0; st.panY = 0; applyView(); }
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
    st.baseScale = Math.min(st.w / LW, st.h / LH);
    st.baseOx = (st.w - LW * st.baseScale) / 2;
    st.baseOy = (st.h - LH * st.baseScale) / 2;
    applyView();
  }

  function changed() {
    trackFeeders();
    render();
    if (st.onChange) st.onChange(getPlan());
  }

  /* ================= 方案物件／匯出 ================= */
  function getPlan() {
    const name = st.sc ? st.sc.name : '—';
    const checks = [];
    checks.push({ status: 'info', name: '操作規則', desc: 'CB 可帶載操作；DS 只能在無電流或等電位時操作；合 DS 於兩個不同帶電系統＝非同期併聯事故。' });
    if (st.sc && st.sc.task) checks.push({ status: st.taskDone ? 'pass' : 'info', name: '任務', desc: st.sc.task.text });
    if (st.sc && st.sc.elements.some(e => e.fault)) checks.push({ status: 'error', name: '設備損壞', desc: '有 DS 因不當操作弧光損壞——重新載入情境。' });
    if (st.sc && isCustom()) {
      const feeders = st.sc.elements.filter(e => e.type === 'feeder');
      const srcs = st.sc.elements.filter(e => e.type === 'src');
      if (!srcs.length) checks.push({ status: 'warn', name: '缺電源', desc: '還沒有電源——放一個「台電進線」才有電可送。' });
      if (!feeders.length) checks.push({ status: 'info', name: '無饋線', desc: '放「饋線」代表負載端，任務就是把它送電。' });
      else {
        const uf = buildUF();
        const live = liveSetOf(uf);
        const dead = feeders.filter(f => !nodeLive(uf, live, f.node)).length;
        checks.push(dead
          ? { status: 'info', name: '饋線受電', desc: `${feeders.length - dead}/${feeders.length} 條饋線受電——依「先 DS 後 CB」順序把其餘送電。` }
          : { status: 'pass', name: '饋線受電', desc: `全部 ${feeders.length} 條饋線受電。` });
      }
      checks.push({ status: 'info', name: '自動保護', desc: '注入故障時：離故障點最近的閉合 CB＝主保護（0.5s）、上一級＝後備（1.2s 越級）。' });
    }
    return {
      industrial: true, sub: true,
      spec: { boardId: 'sub', conn: 'none', flags: {} },
      board: { id: 'sub', name: '變電所', display: 'SUBSTATION S/S', wifi: false },
      parts: [], nets: [],
      checks,
      railV: '345/161/11.4kV',
      conn: 'none', connLabel: '',
      connDone: st.taskDone ? '任務完成' : '操作中',
      title: `變電所 · ${name}`,
      tags: ['SINGLE LINE', 'S/S OPS'],
      counts: { parts: st.sc ? st.sc.elements.length : 0, wires: st.sheet.length },
      errN: 0
    };
  }
  function genFiles() {
    const lines = ['# 操作票（自動記錄）', st.sc ? `# 情境：${st.sc.name}` : '', ''];
    st.sheet.forEach(s2 => lines.push(`${String(s2.n).padStart(2, '0')}  ${s2.text}`));
    if (!st.sheet.length) lines.push('（尚無操作）');
    const svg = genSvg();
    return [
      { name: '操作票.txt', lang: 'txt', content: lines.join('\n') + '\n' },
      { name: '單線圖.svg', lang: 'xml', content: svg },
      { name: 'scenario.json', lang: 'json', content: JSON.stringify(serialize(), null, 2) }
    ];
  }
  function genSvg() {
    if (!st.sc) return '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const esc = s2 => String(s2).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const uf = buildUF();
    const live = liveSetOf(uf);
    const col = n => nodeLive(uf, live, n) ? '#c2402a' : '#9aa2aa';
    const el2 = [];
    for (const b of st.sc.buses) el2.push(`<line x1="${b.x1}" y1="${b.y}" x2="${b.x2}" y2="${b.y}" stroke="${col(b.id)}" stroke-width="7" stroke-linecap="round"/><text x="${b.x1}" y="${b.y - 12}" font-size="12" fill="#3b4046">${esc(b.label)}</text>`);
    for (const el of st.sc.elements) {
      if (el.type === 'src') { const [x, y] = st.sc.nodes[el.node]; el2.push(`<text x="${x}" y="${y - 38}" font-size="12" text-anchor="middle" fill="#7a2a45">${esc(el.label)}</text><line x1="${x}" y1="${y - 30}" x2="${x}" y2="${y}" stroke="#c2402a" stroke-width="3"/>`); continue; }
      if (el.type === 'feeder') { const [x, y] = st.sc.nodes[el.node]; el2.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 30}" stroke="${col(el.node)}" stroke-width="3"/><text x="${x}" y="${y + 50}" font-size="12" text-anchor="middle" fill="#5a6067">${esc(el.label)}</text>`); continue; }
      const [pa, pb] = segOf(el);
      if (!pa || !pb) continue;
      const [mx, my] = midOf(el);
      el2.push(`<line x1="${pa[0]}" y1="${pa[1]}" x2="${pb[0]}" y2="${pb[1]}" stroke="${col(el.a)}" stroke-width="3"/>`);
      if (el.type === 'cb') el2.push(`<rect x="${mx - 9}" y="${my - 9}" width="18" height="18" fill="${el.closed ? '#c2402a' : '#f5f2ea'}" stroke="#3b4046" stroke-width="2"/>`);
      if (el.type === 'ds') el2.push(`<line x1="${mx}" y1="${my + 10}" x2="${el.closed ? mx : mx + 12}" y2="${el.closed ? my - 10 : my - 6}" stroke="#3b4046" stroke-width="2.5"/>`);
      if (el.label) el2.push(`<text x="${mx + 16}" y="${my + 4}" font-size="10.5" fill="#5a6067">${esc(el.label)}</text>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LW} ${LH}" font-family="'Noto Sans TC',sans-serif"><rect x="0" y="0" width="${LW}" height="${LH}" fill="#eef0f2"/>${el2.join('')}</svg>\n`;
  }

  function serialize() {
    if (!st.sc) return null;
    if (isCustom()) {
      return {
        scId: 'custom',
        def: JSON.parse(JSON.stringify({ nodes: st.sc.nodes, buses: st.sc.buses, elements: st.sc.elements })),
        sheet: st.sheet.slice(-60),
        everLost: st.everLost
      };
    }
    return {
      scId: st.scId,
      states: Object.fromEntries(st.sc.elements.filter(e => e.type === 'cb' || e.type === 'ds').map(e => [e.id, { closed: !!e.closed, fault: !!e.fault, defect: !!e.defect, tripped: !!e.tripped }])),
      sheet: st.sheet.slice(-60),
      taskDone: st.taskDone,
      everLost: st.everLost
    };
  }
  function restore(d) {
    if (!d || !d.scId) return;
    if (d.scId === 'custom') {
      if (!d.def || typeof d.def !== 'object') return;
      buildStart();
      st.sc.nodes = d.def.nodes && typeof d.def.nodes === 'object' ? d.def.nodes : {};
      st.sc.buses = Array.isArray(d.def.buses) ? d.def.buses : [];
      st.sc.elements = Array.isArray(d.def.elements) ? d.def.elements : [];
      recount();
      st.sheet = Array.isArray(d.sheet) ? d.sheet.slice(-60) : [];
      st.everLost = d.everLost && typeof d.everLost === 'object' ? d.everLost : {};
      st._prevF = null;
      changed();
      return;
    }
    const r = loadScenario(d.scId);
    if (!r.ok) return;
    if (d.states) for (const [id, s2] of Object.entries(d.states)) {
      const el = elById(id);
      if (el && s2 && typeof s2 === 'object') { el.closed = !!s2.closed; el.fault = !!s2.fault; el.defect = !!s2.defect; el.tripped = !!s2.tripped; }
    }
    st.sheet = Array.isArray(d.sheet) ? d.sheet.slice(-60) : [];
    st.taskDone = !!d.taskDone;
    st.everLost = d.everLost && typeof d.everLost === 'object' ? d.everLost : {};
    st._prevF = null;   // 還原後以目前狀態為基準，避免把載入差異誤記為斷電
    changed();
  }

  function status() {
    if (!st.sc) return { scenario: null };
    const uf = buildUF();
    const live = liveSetOf(uf);
    return {
      scenario: st.sc.name,
      task: st.sc.task ? { text: st.sc.task.text, done: st.taskDone } : null,
      fault: st.fault && !st.fault.cleared ? st.fault.cfg.label : null,
      fault_targets: isCustom()
        ? [...st.sc.elements.filter(e => e.type === 'feeder').map(e => e.id), ...st.sc.buses.map(b => b.id)]
        : Object.keys(st.sc.faults || {}),
      custom: isCustom() || undefined,
      switches: st.sc.elements.filter(e => e.type === 'cb' || e.type === 'ds').map(e => ({
        id: e.id, label: e.label, type: e.type.toUpperCase(),
        state: e.fault ? '弧光損壞' : e.tripped ? '跳脫' : e.closed ? '合' : '分',
        defect: !!e.defect
      })),
      feeders: st.sc.elements.filter(e => e.type === 'feeder').map(e => ({ id: e.id, label: e.label, live: nodeLive(uf, live, e.node) })),
      log_tail: st.log.slice(-8),
      sheet_tail: st.sheet.slice(-8).map(s2 => s2.text)
    };
  }

  /* ================= 對外 ================= */
  return {
    SCENARIOS,
    init(canvas, hooks) {
      st.canvas = canvas;
      st.ctx = canvas.getContext('2d');
      st.onChange = hooks && hooks.onChange;
      st.onSim = hooks && hooks.onSim;
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', () => { if (st.builder.drag) { st.builder.drag = null; changed(); } st.panDrag = null; });
      canvas.addEventListener('pointercancel', () => { st.builder.drag = null; st.panDrag = null; });
      canvas.addEventListener('pointerleave', () => { if (st.builder.drag) { st.builder.drag = null; changed(); } st.panDrag = null; st.hover = null; });
      canvas.addEventListener('dblclick', onDbl);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement);
      resize();
      if (!st.sc) loadScenario('sub_basic');
      if (!st.timer) st.timer = setInterval(tick, 300);
    },
    loadScenario, operate, injectFault, clearFault, toggleDefect,
    buildStart, buildAdd, buildRemove, setBuildTool,
    getBuildTool() { return st.builder.tool; },
    isCustom,
    viewInfo() { return { scale: st.scale, ox: st.ox, oy: st.oy }; },
    getPlan, genFiles, serialize, restore, status, resize,
    getLog() { return st.log; },
    getSheet() { return st.sheet; },
    getScenario() { return st.sc; },
    isTaskDone() { return st.taskDone; }
  };
})();
