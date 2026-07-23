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
      outage: true,   // 模擬面板可切「市電停電」
      param: { key: 'volt', name: '線電壓', unit: 'V', min: 110, max: 480, def: 380 },
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
      color: '#5a4a28', trip: true, autotrip: 2000,
      param: { key: 'setA', name: '過載整定', unit: 'A', min: 1, max: 50, def: 8 },
      terms: [
        { n: '1', dx: 20, dy: 0, dom: 'main' }, { n: '3', dx: 44, dy: 0, dom: 'main' }, { n: '5', dx: 68, dy: 0, dom: 'main' },
        { n: '2', dx: 20, dy: 84, dom: 'main' }, { n: '4', dx: 44, dy: 84, dom: 'main' }, { n: '6', dx: 68, dy: 84, dom: 'main' },
        { n: '95', dx: 100, dy: 12, dom: 'ctrl' }, { n: '96', dx: 100, dy: 30, dom: 'ctrl' },
        { n: '97', dx: 100, dy: 52, dom: 'ctrl' }, { n: '98', dx: 100, dy: 70, dom: 'ctrl' }
      ],
      bridges: inst => inst.tripped ? [['97', '98']] : [['1', '2'], ['3', '4'], ['5', '6'], ['95', '96']],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6'], ['95', '96'], ['97', '98']],
      why: '馬達過載保護：過載跳脫時切斷主迴路，b 接點（95-96）同時斷開控制迴路讓 MC 釋放；a 接點（97-98）跳脫時閉合，可接警報。',
      pinNote: '主迴路串接 1-2/3-4/5-6；95-96 串入 MC 線圈迴路；97-98 接蜂鳴器／警示燈',
      alts: [['電子式過載電驛', '設定精確、可通訊'], ['馬達保護斷路器 MMS', 'NFB＋過載二合一']]
    },
    fuse: {
      id: 'fuse', name: 'FUSE 栓型保險絲', label: 'FUSE', cls: 'PROTECT', w: 84, h: 84, row: 0,
      color: '#4a4438',
      terms: [
        { n: '1', dx: 18, dy: 0, dom: 'main' }, { n: '3', dx: 42, dy: 0, dom: 'main' }, { n: '5', dx: 66, dy: 0, dom: 'main' },
        { n: '2', dx: 18, dy: 84, dom: 'main' }, { n: '4', dx: 42, dy: 84, dom: 'main' }, { n: '6', dx: 66, dy: 84, dom: 'main' }
      ],
      bridges: () => [['1', '2'], ['3', '4'], ['5', '6']],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6']],
      why: '受電端的後備短路保護：熔絲熔斷即斷路。受電盤習慣串在最前端。',
      pinNote: '1/3/5 進、2/4/6 出',
      alts: [['NFB', '可復歸，不用換熔絲'], ['PF 電力熔絲', '高壓側用']]
    },
    co: {
      id: 'co', name: 'CO 過電流電驛（51）', label: 'CO', cls: 'PROTECT', w: 100, h: 84, row: 0,
      color: '#5a3030', trip: true, autotrip: 600,
      param: { key: 'setA', name: '跳脫整定', unit: 'A', min: 1, max: 100, def: 10 },
      terms: [
        { n: '1', dx: 20, dy: 0, dom: 'main' }, { n: '3', dx: 44, dy: 0, dom: 'main' }, { n: '5', dx: 68, dy: 0, dom: 'main' },
        { n: '2', dx: 20, dy: 84, dom: 'main' }, { n: '4', dx: 44, dy: 84, dom: 'main' }, { n: '6', dx: 68, dy: 84, dom: 'main' },
        { n: '95', dx: 100, dy: 12, dom: 'ctrl' }, { n: '96', dx: 100, dy: 30, dom: 'ctrl' },
        { n: '97', dx: 100, dy: 52, dom: 'ctrl' }, { n: '98', dx: 100, dy: 70, dom: 'ctrl' }
      ],
      bridges: inst => inst.tripped ? [['97', '98']] : [['1', '2'], ['3', '4'], ['5', '6'], ['95', '96']],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6'], ['95', '96'], ['97', '98']],
      why: '過電流保護電驛（ANSI 51）：迴路電流超過整定值即跳脫——受電盤等級的保護，取代（或搭配）分路的 TH-RY。b 接點 95-96 切控制迴路、a 接點 97-98 觸發警報。',
      pinNote: '主迴路串接；95-96 串控制迴路、97-98 接警報。模擬面板可手動跳脫／復歸',
      alts: [['數位保護電驛', '51/50/59/27 多功能'], ['TH-RY', '分路馬達過載用']]
    },
    tr: {
      id: 'tr', name: 'TR 限時電驛（通電延時）', label: 'TR', cls: 'CONTROL', w: 96, h: 96, row: 0,
      color: '#4a3560', coil: ['A1', 'A2'], timed: true,
      param: { key: 'preset', name: '延時', unit: '秒', min: 1, max: 60, def: 3 },
      terms: [
        { n: 'A1', dx: 0, dy: 20, dom: 'ctrl' }, { n: 'A2', dx: 0, dy: 44, dom: 'ctrl' },
        { n: '55', dx: 96, dy: 14, dom: 'ctrl' }, { n: '56', dx: 96, dy: 32, dom: 'ctrl' },
        { n: '67', dx: 96, dy: 58, dom: 'ctrl' }, { n: '68', dx: 96, dy: 76, dom: 'ctrl' }
      ],
      bridges: inst => (st.timerDone && st.timerDone[inst.uid]) ? [['67', '68']] : [['55', '56']],
      allPairs: [['55', '56'], ['67', '68']],
      why: '通電延時（ON-delay）電驛：線圈得電開始計時，到達設定秒數後「延時 b」55-56 打開、「延時 a」67-68 閉合。Y-Δ 降壓啟動的計時核心。點兩下可改秒數。',
      pinNote: '線圈 A1-A2；55-56 延時斷（b）、67-68 延時通（a）；預設 3 秒，雙擊修改',
      alts: [['電子式計時器', '數位設定、多段模式'], ['PLC TON 計時器', '程式化，本模式的 PLC 也支援']]
    },
    mk: {
      id: 'mk', name: 'MK 電力電驛', label: 'MK', cls: 'CONTROL', w: 88, h: 88, row: 0,
      color: '#2e4a5a', coil: ['A1', 'A2'],
      terms: [
        { n: 'A1', dx: 0, dy: 20, dom: 'ctrl' }, { n: 'A2', dx: 0, dy: 44, dom: 'ctrl' },
        { n: '13', dx: 88, dy: 10, dom: 'ctrl' }, { n: '14', dx: 88, dy: 26, dom: 'ctrl' },
        { n: '23', dx: 88, dy: 42, dom: 'ctrl' }, { n: '24', dx: 88, dy: 58, dom: 'ctrl' },
        { n: '21', dx: 88, dy: 74, dom: 'ctrl' }, { n: '22', dx: 88, dy: 88, dom: 'ctrl' }
      ],
      bridges: (inst, en) => en ? [['13', '14'], ['23', '24']] : [['21', '22']],
      allPairs: [['13', '14'], ['23', '24'], ['21', '22']],
      why: '小型控制電驛：線圈得電時 a 接點（13-14、23-24）閉合、b 接點（21-22）打開。用來擴充接點數或做控制邏輯中繼。',
      pinNote: '線圈 A1-A2；兩組 a：13-14／23-24；一組 b：21-22',
      alts: [['MC 電磁接觸器', '要切大電流負載時'], ['PLC 內部繼電器 M', '程式化邏輯']]
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
      id: 'pl_g', name: 'PL 指示燈（綠・運轉）', label: 'GL', cls: 'OUTPUT', w: 56, h: 66, row: 1,
      color: '#24513a', load: ['X1', 'X2'], lamp: '#3ddc84',
      terms: [{ n: 'X1', dx: 16, dy: 66, dom: 'ctrl' }, { n: 'X2', dx: 40, dy: 66, dom: 'ctrl' }],
      bridges: () => [], allPairs: [],
      why: '運轉指示：與 MC 線圈並聯，吸持時亮起。',
      pinNote: 'X1/X2 與線圈並聯（或接 MC 輔助接點）',
      alts: [['紅色 PL', '停止／故障指示'], ['蜂鳴器 BZ', '聲音告警']]
    },
    pl_r: {
      id: 'pl_r', name: 'PL 指示燈（紅・警示）', label: 'RL', cls: 'OUTPUT', w: 56, h: 66, row: 1,
      color: '#5c2822', load: ['X1', 'X2'], lamp: '#ff5348',
      terms: [{ n: 'X1', dx: 16, dy: 66, dom: 'ctrl' }, { n: 'X2', dx: 40, dy: 66, dom: 'ctrl' }],
      bridges: () => [], allPairs: [],
      why: '停止指示：經 MC 輔助 b 接點（21-22）取電，MC 釋放時亮起。',
      pinNote: 'X1/X2 串接 MC 的 21-22 後跨接控制電源',
      alts: [['黃色 PL', '過載／異常指示']]
    },
    cos: {
      id: 'cos', name: 'COS 選擇開關', label: 'COS', cls: 'INPUT', w: 64, h: 66, row: 1,
      color: '#54503a', selector: true,
      terms: [
        { n: '1', dx: 8, dy: 66, dom: 'ctrl' }, { n: '2', dx: 24, dy: 66, dom: 'ctrl' },
        { n: '3', dx: 40, dy: 66, dom: 'ctrl' }, { n: '4', dx: 56, dy: 66, dom: 'ctrl' }
      ],
      bridges: inst => inst.on ? [['3', '4']] : [['1', '2']],
      allPairs: [['1', '2'], ['3', '4']],
      why: '兩段選擇開關（保持型）：位置 A 導通 1-2、位置 B 導通 3-4。手動／自動或運轉選擇用。點兩下切換位置。',
      pinNote: '位置 A：1-2；位置 B：3-4；雙擊切換',
      alts: [['三段 COS', '中間 OFF 檔'], ['鑰匙開關', '需要權限管制時']]
    },
    bz: {
      id: 'bz', name: 'BZ 蜂鳴器', label: 'BZ', cls: 'OUTPUT', w: 56, h: 66, row: 1,
      color: '#5a4420', load: ['X1', 'X2'], lamp: '#ffb020', buzzer: true,
      terms: [{ n: 'X1', dx: 16, dy: 66, dom: 'ctrl' }, { n: 'X2', dx: 40, dy: 66, dom: 'ctrl' }],
      bridges: () => [], allPairs: [],
      why: '聲音警報：X1/X2 得電即鳴響（模擬會真的出聲）。常經 TH-RY 的 97-98 a 接點做過載警報。',
      pinNote: 'X1/X2 跨接控制電源（經警報接點）',
      alts: [['閃光警示燈', '嘈雜環境用視覺告警'], ['聲光一體警報器', '兩者兼具']]
    },
    motor: {
      id: 'motor', name: '三相感應馬達', label: 'M 3~', cls: 'LOAD', w: 112, h: 92, row: 2,
      color: '#3a4a5c', motor: true,
      param: { key: 'loadA', name: '運轉電流', unit: 'A', min: 0.5, max: 60, def: 6.4 },
      terms: [{ n: 'U', dx: 26, dy: 0, dom: 'main' }, { n: 'V', dx: 56, dy: 0, dom: 'main' }, { n: 'W', dx: 86, dy: 0, dom: 'main' }],
      bridges: () => [], allPairs: [],
      why: '被控負載。U/V/W 三相齊備才會運轉；缺相會燒毀馬達（ERC 會擋）。',
      pinNote: 'U/V/W 接 TH-RY 出線側 2/4/6',
      alts: [['單相馬達', '小型負載'], ['變頻器＋馬達', '需要調速時（未支援）']]
    },
    motor6: {
      id: 'motor6', name: '三相馬達（Y-Δ 六出線）', label: 'M 3~ 6T', cls: 'LOAD', w: 168, h: 92, row: 2,
      color: '#3a4a5c', motor: true, motor6: true, motorTerms: ['U1', 'V1', 'W1'],
      param: { key: 'loadA', name: '運轉電流', unit: 'A', min: 0.5, max: 60, def: 6.4 },
      terms: [
        { n: 'U1', dx: 22, dy: 0, dom: 'main' }, { n: 'V1', dx: 50, dy: 0, dom: 'main' }, { n: 'W1', dx: 78, dy: 0, dom: 'main' },
        { n: 'W2', dx: 110, dy: 0, dom: 'main' }, { n: 'U2', dx: 136, dy: 0, dom: 'main' }, { n: 'V2', dx: 162, dy: 0, dom: 'main' }
      ],
      bridges: () => [], allPairs: [],
      why: '六出線馬達：U1-U2／V1-V2／W1-W2 三組繞組。U2V2W2 短接＝星形（Y，降壓啟動）；U2V2W2 接到相鄰相＝三角形（Δ，全壓運轉）。',
      pinNote: 'U1/V1/W1 接主 MC 出線；U2/V2/W2 由 MCS 短接（Y）或 MCD 換相供電（Δ）',
      alts: [['三出線馬達', '不需 Y-Δ 時較單純'], ['軟啟動器', '電子式降壓啟動']]
    },
    vm: {
      id: 'vm', name: 'VM 電壓表', label: 'VM', cls: 'METER', w: 64, h: 64, row: 1,
      color: '#2e3e4e', meter: 'V',
      terms: [{ n: 'P1', dx: 16, dy: 0, dom: 'main' }, { n: 'P2', dx: 48, dy: 0, dom: 'main' }],
      bridges: () => [], allPairs: [],
      why: '線電壓量測：P1/P2 跨接兩相，通電顯示 380V（模擬值）。高阻抗並聯，不影響迴路。',
      pinNote: 'P1/P2 跨接任兩相（如 R-S）',
      alts: [['切換式 VM＋VS', '一只表看三個線電壓'], ['數位電表', '多功能量測']]
    },
    am: {
      id: 'am', name: 'AM 電流表', label: 'AM', cls: 'METER', w: 64, h: 64, row: 1,
      color: '#2e3e4e', meter: 'A',
      terms: [{ n: '1', dx: 16, dy: 0, dom: 'main' }, { n: '2', dx: 48, dy: 0, dom: 'main' }],
      bridges: () => [['1', '2']],
      allPairs: [['1', '2']],
      why: '負載電流量測：串接在一相中，負載運轉時顯示電流（模擬值）。實務上大電流經 CT 比流器量測。',
      pinNote: '串接在單一相（如 R 相）中：1 進 2 出',
      alts: [['CT＋AM', '大電流間接量測'], ['勾表', '免拆線量測']]
    },
    sc: {
      id: 'sc', name: 'SC 電容器組（功因改善）', label: 'SC', cls: 'LOAD', w: 100, h: 92, row: 2,
      color: '#3e3a52', capbank: true,
      param: { key: 'ampsA', name: '電容電流', unit: 'A', min: 0.5, max: 30, def: 2.1 },
      terms: [{ n: 'U', dx: 22, dy: 0, dom: 'main' }, { n: 'V', dx: 50, dy: 0, dom: 'main' }, { n: 'W', dx: 78, dy: 0, dom: 'main' }],
      bridges: () => [], allPairs: [],
      why: '並聯電容器組：改善感應負載造成的落後功因（模擬顯示 PF 0.72→0.98），降低線損與電費。經 MC 投入／切離。',
      pinNote: 'U/V/W 並接三相母線（經 MC 控制投切）',
      alts: [['APFR 自動功因調整器', '依負載自動投切多組'], ['SVG 靜態無效功率補償', '電力電子式']]
    },
    tx: {
      id: 'tx', name: 'TX 控制變壓器', label: 'TX', cls: 'SOURCE', w: 96, h: 88, row: 0,
      color: '#41414d', tx: true,
      terms: [
        { n: 'P1', dx: 24, dy: 0, dom: 'main' }, { n: 'P2', dx: 60, dy: 0, dom: 'main' },
        { n: 'S1', dx: 24, dy: 88, dom: 'ctrl' }, { n: 'S2', dx: 60, dy: 88, dom: 'ctrl' }
      ],
      bridges: () => [], allPairs: [],
      why: '從主迴路兩相降壓產生 110V 控制電源（S1/S2）。受電盤把控制電源取在 ATS 之後，停電切換到發電機時控制迴路才有電。',
      pinNote: 'P1/P2 跨接兩相（380V 側）；S1/S2 輸出 110V 控制電源',
      alts: [['POWER C1/C2', '教學用固定控制電源'], ['UPS／電池', '控制電源不斷電']]
    },
    ats: {
      id: 'ats', name: 'ATS 自動切換開關', label: 'ATS', cls: 'CONTROL', w: 170, h: 104, row: 0,
      color: '#31434f', ats: true,
      terms: [
        { n: '1', dx: 18, dy: 0, dom: 'main' }, { n: '3', dx: 42, dy: 0, dom: 'main' }, { n: '5', dx: 66, dy: 0, dom: 'main' },
        { n: '7', dx: 104, dy: 0, dom: 'main' }, { n: '9', dx: 128, dy: 0, dom: 'main' }, { n: '11', dx: 152, dy: 0, dom: 'main' },
        { n: '2', dx: 50, dy: 104, dom: 'main' }, { n: '4', dx: 84, dy: 104, dom: 'main' }, { n: '6', dx: 118, dy: 104, dom: 'main' }
      ],
      bridges: inst => {
        const pos = st._ats && st._ats[inst.uid];
        return pos === 'N' ? [['1', '2'], ['3', '4'], ['5', '6']]
          : pos === 'E' ? [['7', '2'], ['9', '4'], ['11', '6']] : [];
      },
      allPairs: [['1', '2'], ['3', '4'], ['5', '6']],
      allPairsE: [['7', '2'], ['9', '4'], ['11', '6']],
      why: '雙電源自動切換：常用側（1/3/5，市電）有電就接常用；市電斷電且備用側（7/9/11，發電機）有電時自動切到備用。機械連鎖保證兩側永不同時投入。',
      pinNote: '1/3/5 常用（市電）、7/9/11 備用（發電機）、2/4/6 輸出至負載母線',
      alts: [['MTS 手動切換', '便宜但需人到場'], ['閉路式 CTTS', '同步併聯零中斷（未支援）']]
    },
    gen: {
      id: 'gen', name: 'GEN 柴油發電機（AMF）', label: 'GEN', cls: 'SOURCE', w: 132, h: 92, row: 2,
      color: '#3d4a3f', gen: true,
      param: { key: 'startDelay', name: 'AMF 起動延時', unit: '秒', min: 0.5, max: 10, def: 1.2 },
      terms: [{ n: 'GR', dx: 24, dy: 0, dom: 'main' }, { n: 'GS', dx: 52, dy: 0, dom: 'main' }, { n: 'GT', dx: 80, dy: 0, dom: 'main' }],
      bridges: () => [], allPairs: [],
      why: '備用電源：內建 AMF 控制器——市電停電約 1.2 秒後自動起動供電、復電後自動停機。輸出 GR/GS/GT 接 ATS 備用側，絕不可與市電直接併聯（ERC 會擋）。',
      pinNote: 'GR/GS/GT → ATS 的 7/9/11 備用側',
      alts: [['UPS', '零中斷但容量小'], ['雙迴路受電', '向電力公司申請第二迴路']]
    },
    /* ── 高壓受電（11.4kV，dom:'hv'） ── */
    hvin: {
      id: 'hvin', name: '台電高壓進線（11.4kV）', label: 'HV-IN', cls: 'SOURCE', w: 96, h: 64, row: 0,
      color: '#4a2440', hvsrc: true, outage: true, single: true,
      srcTerms: ['H1', 'H2', 'H3'], srcDom: 'hv', setName: '台電11.4kV',
      terms: [{ n: 'H1', dx: 20, dy: 64, dom: 'hv' }, { n: 'H2', dx: 48, dy: 64, dom: 'hv' }, { n: 'H3', dx: 76, dy: 64, dom: 'hv' }],
      bridges: () => [], allPairs: [],
      why: '台電 11.4kV 三相高壓引入。高壓域（紫色端子）絕不可與低壓主迴路或控制迴路直接相接。模擬面板可切「台電停電」。',
      pinNote: 'H1/H2/H3 經避雷器、DS、VCB（或 LBS＋PF）後進變壓器一次側',
      alts: [['22.8kV 進線', '較大容量用戶'], ['雙迴路受電', '重要負載供電可靠度']]
    },
    la: {
      id: 'la', name: 'LA 避雷器', label: 'LA', cls: 'PROTECT', w: 56, h: 72, row: 0,
      color: '#3d3448',
      terms: [{ n: 'L1', dx: 12, dy: 0, dom: 'hv' }, { n: 'L2', dx: 28, dy: 0, dom: 'hv' }, { n: 'L3', dx: 44, dy: 0, dom: 'hv' }],
      bridges: () => [], allPairs: [],
      why: '突波保護：雷擊或開關突波時把過電壓洩放到大地，保護變壓器與開關設備。並聯在進線端，正常時不導通。',
      pinNote: 'L1/L2/L3 並接於進線側（DS 之前）',
      alts: [['GIS 內建避雷器', '氣體絕緣設備'], ['突波吸收器', '低壓側用']]
    },
    ds: {
      id: 'ds', name: 'DS 隔離開關', label: 'DS', cls: 'CONTROL', w: 76, h: 84, row: 0,
      color: '#41374f', dsw: true,
      terms: [
        { n: '1', dx: 16, dy: 0, dom: 'hv' }, { n: '3', dx: 38, dy: 0, dom: 'hv' }, { n: '5', dx: 60, dy: 0, dom: 'hv' },
        { n: '2', dx: 16, dy: 84, dom: 'hv' }, { n: '4', dx: 38, dy: 84, dom: 'hv' }, { n: '6', dx: 60, dy: 84, dom: 'hv' }
      ],
      bridges: inst => (inst.on && !inst.fault) ? [['1', '2'], ['3', '4'], ['5', '6']] : [],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6']],
      why: '隔離開關「只能無載操作」——它沒有滅弧能力，帶負載開斷會發生弧光事故（模擬會真的炸給你看）。停電作業時提供明顯的隔離點。送電順序：先合 DS 再合 VCB；停電順序：先開 VCB 再開 DS。',
      pinNote: '1/3/5 電源側、2/4/6 負載側。雙擊或模擬面板分合；帶載開斷＝弧光事故',
      alts: [['接地開關 ES', '檢修時三相接地'], ['LBS', '可帶載開閉']]
    },
    lbs: {
      id: 'lbs', name: 'LBS 負載啟斷開關', label: 'LBS', cls: 'CONTROL', w: 76, h: 84, row: 0,
      color: '#374a44', loadbreak: true,
      param: { key: 'rateA', name: '額定啟斷電流', unit: 'A', min: 10, max: 630, def: 630 },
      terms: [
        { n: '1', dx: 16, dy: 0, dom: 'hv' }, { n: '3', dx: 38, dy: 0, dom: 'hv' }, { n: '5', dx: 60, dy: 0, dom: 'hv' },
        { n: '2', dx: 16, dy: 84, dom: 'hv' }, { n: '4', dx: 38, dy: 84, dom: 'hv' }, { n: '6', dx: 60, dy: 84, dom: 'hv' }
      ],
      bridges: inst => inst.on ? [['1', '2'], ['3', '4'], ['5', '6']] : [],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6']],
      why: '可帶額定負載電流開閉的開關（有滅弧室），常與 PF 電力熔絲組成小容量用戶的簡易受電設備，取代 VCB。無法啟斷故障電流——那是熔絲的工作。',
      pinNote: '1/3/5 電源側、2/4/6 負載側；搭配 PF 使用',
      alts: [['VCB', '可啟斷故障電流'], ['DS', '純隔離、無載操作']]
    },
    vcb: {
      id: 'vcb', name: 'VCB 真空斷路器', label: 'VCB', cls: 'CONTROL', w: 88, h: 84, row: 0,
      color: '#2e3d54', breaker: true,
      terms: [
        { n: '1', dx: 16, dy: 0, dom: 'hv' }, { n: '3', dx: 40, dy: 0, dom: 'hv' }, { n: '5', dx: 64, dy: 0, dom: 'hv' },
        { n: '2', dx: 16, dy: 84, dom: 'hv' }, { n: '4', dx: 40, dy: 84, dom: 'hv' }, { n: '6', dx: 64, dy: 84, dom: 'hv' },
        { n: 'TC1', dx: 88, dy: 28, dom: 'ctrl' }, { n: 'TC2', dx: 88, dy: 48, dom: 'ctrl' }
      ],
      bridges: inst => (inst.on && !inst.tripped) ? [['1', '2'], ['3', '4'], ['5', '6']] : [],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6']],
      why: '高壓主開關：真空滅弧室可啟斷負載與故障電流。跳脫線圈（TC1/TC2）接保護電驛 RY 的出口接點——過電流時由電驛令 VCB 跳脫。',
      pinNote: '1/3/5 電源側、2/4/6 負載側；TC1/TC2 接 RY 的 T1/T2',
      alts: [['GCB 氣體斷路器', '更高電壓等級'], ['LBS＋PF', '小容量簡易受電']]
    },
    pf: {
      id: 'pf', name: 'PF 電力熔絲', label: 'PF', cls: 'PROTECT', w: 64, h: 84, row: 0,
      color: '#4a3f30', fusehv: true,
      param: { key: 'setA', name: '額定電流（一次）', unit: 'A', min: 0.2, max: 20, def: 2 },
      terms: [
        { n: '1', dx: 14, dy: 0, dom: 'hv' }, { n: '3', dx: 32, dy: 0, dom: 'hv' }, { n: '5', dx: 50, dy: 0, dom: 'hv' },
        { n: '2', dx: 14, dy: 84, dom: 'hv' }, { n: '4', dx: 32, dy: 84, dom: 'hv' }, { n: '6', dx: 50, dy: 84, dom: 'hv' }
      ],
      bridges: inst => inst.tripped ? [] : [['1', '2'], ['3', '4'], ['5', '6']],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6']],
      why: '高壓熔絲：電流超過額定即熔斷（模擬會真的斷），提供變壓器短路保護。熔斷後要換熔絲筒（模擬面板可復歸）。與 LBS 組成簡易受電標準配置。',
      pinNote: '串接於 LBS 之後、變壓器之前；額定可調',
      alts: [['VCB＋RY51', '可復歸、保護協調彈性'], ['限流熔絲', '更快遮斷']]
    },
    cthv: {
      id: 'cthv', name: 'CT 比流器', label: 'CT', cls: 'METER', w: 64, h: 84, row: 0,
      color: '#33424e', ctsig: true,
      param: { key: 'ratio', name: 'CT 一次額定', unit: 'A', min: 5, max: 600, def: 50 },
      terms: [
        { n: '1', dx: 14, dy: 0, dom: 'hv' }, { n: '3', dx: 32, dy: 0, dom: 'hv' }, { n: '5', dx: 50, dy: 0, dom: 'hv' },
        { n: '2', dx: 14, dy: 84, dom: 'hv' }, { n: '4', dx: 32, dy: 84, dom: 'hv' }, { n: '6', dx: 50, dy: 84, dom: 'hv' },
        { n: 'k', dx: 64, dy: 28, dom: 'ctrl' }, { n: 'l', dx: 64, dy: 48, dom: 'ctrl' }
      ],
      bridges: () => [['1', '2'], ['3', '4'], ['5', '6']],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6']],
      why: '把高壓側大電流按比例變換成 5A 以下的二次電流給保護電驛與電流表。k/l 端子接 RY 的 S1/S2。二次側絕不可開路（實務會產生高壓）。',
      pinNote: '主迴路串接；k/l → RY51 的 S1/S2',
      alts: [['MOF', '計量用 CT＋PT 合一'], ['零相 ZCT', '接地故障偵測']]
    },
    pt: {
      id: 'pt', name: 'PT 比壓器（控制電源）', label: 'PT', cls: 'SOURCE', w: 80, h: 88, row: 0,
      color: '#3f3a50', tx: true,
      terms: [
        { n: 'P1', dx: 20, dy: 0, dom: 'hv' }, { n: 'P2', dx: 52, dy: 0, dom: 'hv' },
        { n: 'S1', dx: 20, dy: 88, dom: 'ctrl' }, { n: 'S2', dx: 52, dy: 88, dom: 'ctrl' }
      ],
      bridges: () => [], allPairs: [],
      why: '從高壓側兩相取壓，降成 110V 供表計與控制迴路（S1/S2）。高壓盤的 VCB 跳脫迴路、指示燈電源多取自 PT。',
      pinNote: 'P1/P2 跨接高壓兩相；S1/S2 輸出 110V',
      alts: [['MOF', '計量專用'], ['TX 控制變壓器', '低壓側取電']]
    },
    hvtr: {
      id: 'hvtr', name: '配電變壓器（11.4kV→380V）', label: 'TR-3φ', cls: 'SOURCE', w: 110, h: 92, row: 0,
      color: '#54432e', hvtr: true, xfmr: { from: 'hv', to: 'main', ratio: 30, disp: '11.4k/380' },
      param: { key: 'kva', name: '容量', unit: 'kVA', min: 50, max: 2000, def: 500 },
      terms: [
        { n: '1', dx: 22, dy: 0, dom: 'hv' }, { n: '3', dx: 55, dy: 0, dom: 'hv' }, { n: '5', dx: 88, dy: 0, dom: 'hv' },
        { n: '2', dx: 22, dy: 92, dom: 'main' }, { n: '4', dx: 55, dy: 92, dom: 'main' }, { n: '6', dx: 88, dy: 92, dom: 'main' }
      ],
      bridges: () => [], allPairs: [],
      why: '把 11.4kV 降成 380V 低壓主迴路。一次側三相有電，二次側（2/4/6）就成為低壓電源——後面接 NFB、MC、馬達照舊。一次電流≈二次電流÷30，保護電驛的整定要換算到一次側。',
      pinNote: '1/3/5 接高壓（經 VCB/PF）；2/4/6 出 380V 低壓主迴路',
      alts: [['模鑄式變壓器', '免油、防火'], ['雙變壓器分列', '重要負載分段供電']]
    },
    /* ── 特高壓（161kV dom:'ehv'／345kV dom:'uhv'） ── */
    ehvin161: {
      id: 'ehvin161', name: '台電特高壓進線（161kV）', label: '161kV-IN', cls: 'SOURCE', w: 96, h: 64, row: 0,
      color: '#24304f', hvsrc: true, outage: true, single: true,
      srcTerms: ['E1', 'E2', 'E3'], srcDom: 'ehv', setName: '台電161kV',
      terms: [{ n: 'E1', dx: 20, dy: 64, dom: 'ehv' }, { n: 'E2', dx: 48, dy: 64, dom: 'ehv' }, { n: 'E3', dx: 76, dy: 64, dom: 'ehv' }],
      bridges: () => [], allPairs: [],
      why: '台電 161kV 特高壓引入（科技廠、鋼鐵廠等特高壓用戶）。經 DS161→GCB161→主變降至 11.4kV。可模擬台電停電。',
      pinNote: 'E1/E2/E3 → DS161 → GCB161 → 主變 161kV/11.4kV',
      alts: [['雙迴路 161kV', '重要用戶標準'], ['69kV 受電', '中型用戶']]
    },
    ehvin345: {
      id: 'ehvin345', name: '台電超高壓進線（345kV）', label: '345kV-IN', cls: 'SOURCE', w: 96, h: 64, row: 0,
      color: '#4f2430', hvsrc: true, outage: true, single: true,
      srcTerms: ['U1', 'U2', 'U3'], srcDom: 'uhv', setName: '台電345kV',
      terms: [{ n: 'U1', dx: 20, dy: 64, dom: 'uhv' }, { n: 'U2', dx: 48, dy: 64, dom: 'uhv' }, { n: 'U3', dx: 76, dy: 64, dom: 'uhv' }],
      bridges: () => [], allPairs: [],
      why: '台電 345kV 超高壓輸電進線（E/S 超高壓變電所）。經 GCB345 與聯絡主變降至 161kV，再逐級降壓。',
      pinNote: 'U1/U2/U3 → DS345 → GCB345 → 主變 345kV/161kV',
      alts: [['GIS 全套', '氣體絕緣變電所'], ['雙母線＋一次半斷路器', '樞紐變電所架構（規劃中）']]
    },
    ds161: {
      id: 'ds161', name: 'DS 隔離開關（161kV）', label: 'DS-161', cls: 'CONTROL', w: 76, h: 84, row: 0,
      color: '#2e3a54', dsw: true,
      terms: [
        { n: '1', dx: 16, dy: 0, dom: 'ehv' }, { n: '3', dx: 38, dy: 0, dom: 'ehv' }, { n: '5', dx: 60, dy: 0, dom: 'ehv' },
        { n: '2', dx: 16, dy: 84, dom: 'ehv' }, { n: '4', dx: 38, dy: 84, dom: 'ehv' }, { n: '6', dx: 60, dy: 84, dom: 'ehv' }
      ],
      bridges: inst => (inst.on && !inst.fault) ? [['1', '2'], ['3', '4'], ['5', '6']] : [],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6']],
      why: '161kV 隔離開關：同樣只能無載操作——特高壓帶載開斷的弧光比 11.4kV 更劇烈。送電 DS→GCB、停電 GCB→DS。',
      pinNote: '1/3/5 電源側、2/4/6 負載側；無載操作！',
      alts: [['接地開關', '停電檢修接地'], ['GIS 內建 DS', '氣體絕緣']]
    },
    ds345: {
      id: 'ds345', name: 'DS 隔離開關（345kV）', label: 'DS-345', cls: 'CONTROL', w: 76, h: 84, row: 0,
      color: '#542e3a', dsw: true,
      terms: [
        { n: '1', dx: 16, dy: 0, dom: 'uhv' }, { n: '3', dx: 38, dy: 0, dom: 'uhv' }, { n: '5', dx: 60, dy: 0, dom: 'uhv' },
        { n: '2', dx: 16, dy: 84, dom: 'uhv' }, { n: '4', dx: 38, dy: 84, dom: 'uhv' }, { n: '6', dx: 60, dy: 84, dom: 'uhv' }
      ],
      bridges: inst => (inst.on && !inst.fault) ? [['1', '2'], ['3', '4'], ['5', '6']] : [],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6']],
      why: '345kV 隔離開關：無載操作專用，提供檢修隔離點。',
      pinNote: '1/3/5 電源側、2/4/6 負載側；無載操作！',
      alts: [['GIS 內建 DS', '氣體絕緣變電所']]
    },
    gcb161: {
      id: 'gcb161', name: 'GCB 氣體斷路器（161kV）', label: 'GCB-161', cls: 'CONTROL', w: 88, h: 84, row: 0,
      color: '#1f3a4f', breaker: true,
      terms: [
        { n: '1', dx: 16, dy: 0, dom: 'ehv' }, { n: '3', dx: 40, dy: 0, dom: 'ehv' }, { n: '5', dx: 64, dy: 0, dom: 'ehv' },
        { n: '2', dx: 16, dy: 84, dom: 'ehv' }, { n: '4', dx: 40, dy: 84, dom: 'ehv' }, { n: '6', dx: 64, dy: 84, dom: 'ehv' },
        { n: 'TC1', dx: 88, dy: 28, dom: 'ctrl' }, { n: 'TC2', dx: 88, dy: 48, dom: 'ctrl' }
      ],
      bridges: inst => (inst.on && !inst.tripped) ? [['1', '2'], ['3', '4'], ['5', '6']] : [],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6']],
      why: 'SF6 氣體滅弧的特高壓斷路器：161kV 系統的主開關，可啟斷負載與故障電流。跳脫線圈 TC1/TC2 接保護電驛出口。',
      pinNote: '1/3/5 電源側、2/4/6 負載側；TC1/TC2 ← RY51 T1/T2',
      alts: [['真空 VCB', '較低電壓等級'], ['GIS 整套', '含 DS/CT/PT 一體']]
    },
    gcb345: {
      id: 'gcb345', name: 'GCB 氣體斷路器（345kV）', label: 'GCB-345', cls: 'CONTROL', w: 88, h: 84, row: 0,
      color: '#4f1f2e', breaker: true,
      terms: [
        { n: '1', dx: 16, dy: 0, dom: 'uhv' }, { n: '3', dx: 40, dy: 0, dom: 'uhv' }, { n: '5', dx: 64, dy: 0, dom: 'uhv' },
        { n: '2', dx: 16, dy: 84, dom: 'uhv' }, { n: '4', dx: 40, dy: 84, dom: 'uhv' }, { n: '6', dx: 64, dy: 84, dom: 'uhv' },
        { n: 'TC1', dx: 88, dy: 28, dom: 'ctrl' }, { n: 'TC2', dx: 88, dy: 48, dom: 'ctrl' }
      ],
      bridges: inst => (inst.on && !inst.tripped) ? [['1', '2'], ['3', '4'], ['5', '6']] : [],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6']],
      why: '345kV 超高壓斷路器：E/S 變電所的主開關。',
      pinNote: '1/3/5 電源側、2/4/6 負載側；TC1/TC2 ← 保護電驛',
      alts: [['一次半斷路器配置', '樞紐變電所（規劃中）']]
    },
    ct161: {
      id: 'ct161', name: 'CT 比流器（161kV）', label: 'CT-161', cls: 'METER', w: 64, h: 84, row: 0,
      color: '#2a3a48', ctsig: true,
      param: { key: 'ratio', name: 'CT 一次額定', unit: 'A', min: 1, max: 2000, def: 600 },
      terms: [
        { n: '1', dx: 14, dy: 0, dom: 'ehv' }, { n: '3', dx: 32, dy: 0, dom: 'ehv' }, { n: '5', dx: 50, dy: 0, dom: 'ehv' },
        { n: '2', dx: 14, dy: 84, dom: 'ehv' }, { n: '4', dx: 32, dy: 84, dom: 'ehv' }, { n: '6', dx: 50, dy: 84, dom: 'ehv' },
        { n: 'k', dx: 64, dy: 28, dom: 'ctrl' }, { n: 'l', dx: 64, dy: 48, dom: 'ctrl' }
      ],
      bridges: () => [['1', '2'], ['3', '4'], ['5', '6']],
      allPairs: [['1', '2'], ['3', '4'], ['5', '6']],
      why: '161kV 比流器：k/l 接保護電驛。特高壓側電流很小（161kV 的 1A ≈ 380V 側 424A），整定值要按變比換算。',
      pinNote: '主迴路串接；k/l → RY51 的 S1/S2',
      alts: [['GIS 內建 CT', '氣體絕緣'], ['光學 CT', '數位變電所']]
    },
    mtx161: {
      id: 'mtx161', name: '主變壓器（161kV→11.4kV）', label: 'MTX-161', cls: 'SOURCE', w: 110, h: 92, row: 0,
      color: '#3e3652', hvtr2: true, xfmr: { from: 'ehv', to: 'hv', ratio: 14.12, disp: '161k/11.4k' },
      param: { key: 'kva', name: '容量', unit: 'MVA', min: 5, max: 60, def: 25 },
      terms: [
        { n: '1', dx: 22, dy: 0, dom: 'ehv' }, { n: '3', dx: 55, dy: 0, dom: 'ehv' }, { n: '5', dx: 88, dy: 0, dom: 'ehv' },
        { n: '2', dx: 22, dy: 92, dom: 'hv' }, { n: '4', dx: 55, dy: 92, dom: 'hv' }, { n: '6', dx: 88, dy: 92, dom: 'hv' }
      ],
      bridges: () => [], allPairs: [],
      why: '特高壓用戶主變：161kV 降至 11.4kV 廠內配電。一次電流≈二次÷14.1。之後接 11.4kV 的 VCB／變壓器照舊。',
      pinNote: '1/3/5 接 161kV（經 GCB）；2/4/6 出 11.4kV 廠內母線',
      alts: [['雙主變分列', '重要負載'], ['有載調壓 OLTC', '電壓調整']]
    },
    mtx345: {
      id: 'mtx345', name: '聯絡主變（345kV→161kV）', label: 'MTX-345', cls: 'SOURCE', w: 110, h: 92, row: 0,
      color: '#52363e', hvtr2: true, xfmr: { from: 'uhv', to: 'ehv', ratio: 2.14, disp: '345k/161k' },
      param: { key: 'kva', name: '容量', unit: 'MVA', min: 100, max: 1000, def: 500 },
      terms: [
        { n: '1', dx: 22, dy: 0, dom: 'uhv' }, { n: '3', dx: 55, dy: 0, dom: 'uhv' }, { n: '5', dx: 88, dy: 0, dom: 'uhv' },
        { n: '2', dx: 22, dy: 92, dom: 'ehv' }, { n: '4', dx: 55, dy: 92, dom: 'ehv' }, { n: '6', dx: 88, dy: 92, dom: 'ehv' }
      ],
      bridges: () => [], allPairs: [],
      why: 'E/S 超高壓變電所的聯絡主變：345kV 輸電降至 161kV 供區域變電所與特高壓用戶。一次電流≈二次÷2.14。',
      pinNote: '1/3/5 接 345kV（經 GCB345）；2/4/6 出 161kV 母線',
      alts: [['自耦變壓器', '345/161 常用型式'], ['三繞組', '含三次側電抗補償']]
    },
    ry: {
      id: 'ry', name: 'RY 過電流電驛（51 反時限）', label: 'RY51', cls: 'CONTROL', w: 88, h: 66, row: 1,
      color: '#4e3040',
      param: { key: 'pickup', name: '始動電流（一次）', unit: 'A', min: 0.01, max: 100, def: 0.5 },
      terms: [
        { n: 'S1', dx: 20, dy: 0, dom: 'ctrl' }, { n: 'S2', dx: 44, dy: 0, dom: 'ctrl' },
        { n: 'T1', dx: 20, dy: 66, dom: 'ctrl' }, { n: 'T2', dx: 44, dy: 66, dom: 'ctrl' }
      ],
      bridges: () => [], allPairs: [],
      why: '反時限過電流保護（ANSI 51）：電流越大跳得越快（t ≈ TMS×3/(I/Ip−1)，TMS=0.2）。S1/S2 接 CT 的 k/l 讀電流，T1/T2 接 VCB 的 TC1/TC2 出口跳脫。始動電流以一次側安培整定。',
      pinNote: 'S1/S2 ← CT k/l；T1/T2 → VCB TC1/TC2',
      alts: [['數位複合電驛', '50/51/51N/27/59 一體'], ['LCO', '感應圓盤式']]
    },
    /* ── 設備試驗（竣工／維護）：儀器探棒 dom:'any' 可接任何電壓域端子 ── */
    gnd: {
      id: 'gnd', name: '接地排', label: 'GND', cls: 'SOURCE', w: 64, h: 56, row: 1,
      color: '#3a4438', earth: true,
      terms: [{ n: 'G1', dx: 16, dy: 56, dom: 'any' }, { n: 'G2', dx: 44, dy: 56, dom: 'any' }],
      bridges: () => [['G1', 'G2']], allPairs: [['G1', 'G2']],
      why: '試驗與接地共用端子排。絕緣電阻／耐壓試驗的回路端（E／R 探棒）接這裡。',
      pinNote: 'G1/G2 內部相通',
      alts: [['接地棒', '現場打入大地'], ['等電位聯結', '盤體接地']]
    },
    meg: {
      id: 'meg', name: 'MEG 絕緣電阻計（Megger）', label: 'MEG', cls: 'METER', w: 96, h: 76, row: 1,
      color: '#28404a', tester: 'meg',
      param: { key: 'volt', name: '測試電壓', unit: 'V', min: 250, max: 5000, def: 1000 },
      terms: [{ n: 'L', dx: 24, dy: 76, dom: 'any' }, { n: 'E', dx: 64, dy: 76, dom: 'any' }],
      bridges: () => [], allPairs: [],
      why: '絕緣電阻試驗：L 探棒接受試設備端子、E 探棒接接地排，施加直流測試電壓讀 MΩ 值。判定基準（簡化）：低壓 ≥1MΩ、高壓 ≥10MΩ。試驗前必須停電。',
      pinNote: 'L → 受試設備端子；E → GND 接地排。雙擊改測試電壓',
      alts: [['5kV 絕緣計', '特高壓設備'], ['PI 極化指數', '10min/1min 比值判斷受潮']]
    },
    hipot: {
      id: 'hipot', name: 'HIPOT 耐壓試驗器', label: 'HIPOT', cls: 'METER', w: 96, h: 76, row: 1,
      color: '#4a3040', tester: 'hipot',
      param: { key: 'volt', name: '試驗電壓', unit: 'kV', min: 1, max: 50, def: 22 },
      terms: [{ n: 'H', dx: 24, dy: 76, dom: 'any' }, { n: 'R', dx: 64, dy: 76, dom: 'any' }],
      bridges: () => [], allPairs: [],
      why: 'AC 耐壓試驗：升壓至試驗電壓（例：11.4kV 級 ≈ 2E 倍）保持一分鐘，觀察洩漏電流與有無閃絡。絕緣有缺陷會在升壓途中崩潰——模擬會真的炸。',
      pinNote: 'H → 受試設備端子；R → GND。試驗電壓雙擊可調',
      alts: [['DC 耐壓', '電纜常用'], ['VLF 0.1Hz', '長電纜容量性負載']]
    },
    ctt: {
      id: 'ctt', name: 'CTT CT 測試器（變比／極性）', label: 'CTT', cls: 'METER', w: 110, h: 76, row: 1,
      color: '#3a4430', tester: 'ctt',
      param: { key: 'inject', name: '注入電流', unit: 'A', min: 1, max: 100, def: 10 },
      terms: [
        { n: 'P1', dx: 18, dy: 76, dom: 'any' }, { n: 'P2', dx: 44, dy: 76, dom: 'any' },
        { n: 'S1', dx: 70, dy: 76, dom: 'any' }, { n: 'S2', dx: 96, dy: 76, dom: 'any' }
      ],
      bridges: () => [], allPairs: [],
      why: 'CT 竣工試驗：一次側注入已知電流、量二次側輸出——驗證變比與極性。極性接反的 CT 會讓保護電驛誤動作或拒動。',
      pinNote: 'P1/P2 → CT 一次側（1/2）；S1/S2 → CT 的 k/l',
      alts: [['激磁曲線試驗', '鐵芯飽和特性'], ['負擔試驗', '二次迴路阻抗']]
    },
    rts: {
      id: 'rts', name: 'RTS 電驛測試器（注入）', label: 'RTS', cls: 'METER', w: 96, h: 76, row: 1,
      color: '#443040', tester: 'rts',
      param: { key: 'inject', name: '注入電流（一次換算）', unit: 'A', min: 0.01, max: 100, def: 1 },
      terms: [{ n: 'I1', dx: 24, dy: 76, dom: 'any' }, { n: 'I2', dx: 64, dy: 76, dom: 'any' }],
      bridges: () => [], allPairs: [],
      why: '保護電驛注入測試：對 RY51 注入模擬電流、量測實際動作時間，跟反時限曲線 t=TMS×3/(M−1) 比對（±10% 合格）。跳脫出口有接斷路器的話會真的跳給你看。',
      pinNote: 'I1/I2 → RY 的 S1/S2（取代 CT）。注入電流雙擊可調',
      alts: [['三相電驛測試儀', '差動／方向性電驛'], ['一次注入', '連 CT 一起驗']]
    },
    plc: {
      id: 'plc', name: 'PLC 可程式控制器', label: 'PLC', cls: 'CONTROL', w: 264, h: 104, row: 1,
      color: '#23405c', plc: true, single: true,
      terms: [
        { n: 'L', dx: 20, dy: 0, dom: 'ctrl' }, { n: 'N', dx: 42, dy: 0, dom: 'ctrl' }, { n: 'COM', dx: 70, dy: 0, dom: 'ctrl' },
        { n: 'X0', dx: 98, dy: 0, dom: 'ctrl' }, { n: 'X1', dx: 120, dy: 0, dom: 'ctrl' }, { n: 'X2', dx: 142, dy: 0, dom: 'ctrl' }, { n: 'X3', dx: 164, dy: 0, dom: 'ctrl' },
        { n: 'X4', dx: 186, dy: 0, dom: 'ctrl' }, { n: 'X5', dx: 208, dy: 0, dom: 'ctrl' }, { n: 'X6', dx: 230, dy: 0, dom: 'ctrl' }, { n: 'X7', dx: 252, dy: 0, dom: 'ctrl' },
        { n: 'C0', dx: 20, dy: 104, dom: 'ctrl' },
        { n: 'Y0', dx: 60, dy: 104, dom: 'ctrl' }, { n: 'Y1', dx: 86, dy: 104, dom: 'ctrl' }, { n: 'Y2', dx: 112, dy: 104, dom: 'ctrl' }, { n: 'Y3', dx: 138, dy: 104, dom: 'ctrl' },
        { n: 'Y4', dx: 164, dy: 104, dom: 'ctrl' }, { n: 'Y5', dx: 190, dy: 104, dom: 'ctrl' }, { n: 'Y6', dx: 216, dy: 104, dom: 'ctrl' }, { n: 'Y7', dx: 242, dy: 104, dom: 'ctrl' }
      ],
      bridges: inst => {
        const o = st.plcOut[inst.uid];
        return o ? Object.keys(o).filter(k => o[k]).map(k => [k, 'C0']) : [];
      },
      allPairs: ['Y0', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7'].map(y => [y, 'C0']),
      why: '小型 PLC（8 DI／8 DO，繼電器輸出）：控制邏輯寫在梯形圖裡，取代硬接線。輸入 X 由 COM 經按鈕接點觸發；輸出 Y 得電時與 C0 導通，可驅動 MC 線圈或指示燈。點兩下開啟梯形圖編輯器。',
      pinNote: 'L/N 接 C1/C2 電源；COM→按鈕→X0..X7；C0 接 C1、Y0..Y7 接負載（MC 線圈／PL）',
      alts: [['純電驛邏輯', '接點少時傳統工配即可'], ['大型 PLC＋HMI', '點數多、需人機介面時']]
    }
  };
  const PALETTE = ['nfb', 'mc', 'tr', 'mk', 'thry', 'pb_nc', 'pb_no', 'cos', 'pl_g', 'pl_r', 'bz', 'motor', 'motor6', 'plc',
    'fuse', 'co', 'vm', 'am', 'sc', 'tx', 'ats', 'gen',
    'hvin', 'la', 'ds', 'lbs', 'vcb', 'pf', 'cthv', 'pt', 'hvtr', 'ry',
    'ehvin161', 'ds161', 'gcb161', 'ct161', 'mtx161', 'ehvin345', 'ds345', 'gcb345', 'mtx345',
    'gnd', 'meg', 'hipot', 'ctt', 'rts'];

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
    plan: null, uidSeq: 1, log: [],
    timerDone: {},   // TR 計時到達 {uid:bool}
    plcOut: {},      // PLC 輸出 {uid:{Y0:bool,...}}
    zoom: 1, panX: 0, panY: 0, baseScale: 1, baseOx: 0, baseOy: 0,   // 縮放／平移
    panDrag: null
  };

  function defOf(p) { return DEFS[p.id]; }
  function byUid(uid) { return st.parts.find(p => p.uid === uid); }
  function termPos(p, name) {
    if (!p || !defOf(p)) return null;
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
   *       'wires'＝只算導線，不含任何接點（實體併接檢查）
   *       'all-skip:<id>'＝全閉但略過某元件「型號」的主接點（保護串接檢查）
   *       'all-skipaux:<uid>'＝全閉但略過某「實例」的 21-22 輔助 b 接點（互鎖檢查） */
  function buildUF(mode, coilMap, opts) {
    const uf = makeUF();
    for (const w of st.wires) uf.union(tid(w.a.uid, w.a.term), tid(w.b.uid, w.b.term));
    if (mode === 'wires') return uf;
    const isMain = x => x[0] >= '1' && x[0] <= '6' && x[0].length === 1;
    for (const p of st.parts) {
      const d = defOf(p);
      let pairs;
      if (mode === 'state') pairs = d.bridges(p, !!(coilMap && coilMap[p.uid]));
      else {
        pairs = (d.ats && opts && opts.atsE) ? d.allPairsE : d.allPairs;
        if (mode.startsWith('all-skip:') && p.id === mode.slice(9)) pairs = pairs.filter(x => !isMain(x));
        if (mode.startsWith('all-skipaux:') && String(p.uid) === mode.slice(12)) pairs = pairs.filter(x => x[0] !== '21');
        // 互鎖群組：一次只允許一顆 MC 的主接點閉合（正逆轉檢查情境）
        if (opts && opts.skipMainsUids && opts.skipMainsUids.has(p.uid)) pairs = pairs.filter(x => !isMain(x));
      }
      for (const [a, b] of pairs) uf.union(tid(p.uid, a), tid(p.uid, b));
    }
    return uf;
  }

  /* 需互鎖的 MC 判定：只閉合某「一對」MC（其餘 MC 主接點開路）就會相間短路
   * ＝這對 MC 不可同時投入（正逆轉換相、Y-Δ 星角）。輸出併聯與經馬達端子的
   * 短路路徑都涵蓋；順序啟動等各帶各負載的組合不會誤判。 */
  /* 各電源三相組（假設路徑用）：市電＋發電機＋高壓進線＋各變壓器二次側 */
  function trioNetsOf(uf) {
    const src = sourcePart();
    const list = [['R', 'S', 'T'].map(t => uf.find(tid(src.uid, t)))];
    for (const g of st.parts) {
      const d2 = defOf(g);
      if (d2.gen) list.push(['GR', 'GS', 'GT'].map(t => uf.find(tid(g.uid, t))));
      if (d2.hvsrc) list.push(d2.srcTerms.map(t => uf.find(tid(g.uid, t))));
      if (d2.xfmr) list.push(['2', '4', '6'].map(t => uf.find(tid(g.uid, t))));
    }
    return list;
  }
  /* 控制電源節點集合（假設路徑用）：POWER C1/C2 ＋ 各 TX/PT 二次側 */
  function ctrlNodeSet(uf) {
    const src = sourcePart();
    const set = new Set([uf.find(tid(src.uid, 'C1')), uf.find(tid(src.uid, 'C2'))]);
    for (const q of st.parts) {
      if (defOf(q).tx) { set.add(uf.find(tid(q.uid, 'S1'))); set.add(uf.find(tid(q.uid, 'S2'))); }
    }
    return set;
  }
  function shortedPhases(uf) {
    // 任一電源三相組內部被併網＝相間短路（涵蓋變壓器二次側母線上的正逆轉）
    return trioNetsOf(uf).some(([a, b, c]) => a === b || b === c || a === c);
  }
  function mcPairShorts(A, B, mcs) {
    const skip = new Set(mcs.filter(m => m !== A && m !== B).map(m => m.uid));
    return shortedPhases(buildUF('all', null, { skipMainsUids: skip }));
  }
  function tiedMcGroup() {
    const mcs = st.parts.filter(p => p.id === 'mc');
    if (mcs.length < 2) return [];
    const tied = new Set();
    for (let i = 0; i < mcs.length; i++) {
      for (let j = i + 1; j < mcs.length; j++) {
        if (mcPairShorts(mcs[i], mcs[j], mcs)) { tied.add(mcs[i].uid); tied.add(mcs[j].uid); }
      }
    }
    return [...tied];
  }

  function sourcePart() { return st.parts.find(p => p.id === 'source'); }

  /* 多電源求解：市電（可停電）＋運轉中的發電機各自成一組相位網；
   * 控制電源＝POWER C1/C2 ＋ 一次側跨在有電兩相上的 TX 二次側。
   * ATS 位置（常用/備用）與線圈狀態一起進定點迭代。 */
  function solve(coilSeed) {
    const src = sourcePart();
    let coil = Object.assign({}, coilSeed);
    let atsPos = Object.assign({}, st.atsPrev || {});
    let result = null;
    const gens = st.parts.filter(p => defOf(p).gen);
    for (let iter = 0; iter < 12; iter++) {
      st._ats = atsPos;
      const uf = buildUF('state', coil);
      // 有電的電源組（相位網三元組）：市電、發電機、台電高壓、變壓器二次側（衍生）
      const sets = [];
      if (!src.outage) sets.push({ name: '市電', dom: 'main', nets: ['R', 'S', 'T'].map(t => uf.find(tid(src.uid, t))) });
      for (const g of gens) if (g.running) sets.push({ name: labelOf(g.uid, '').trim(), dom: 'main', nets: ['GR', 'GS', 'GT'].map(t => uf.find(tid(g.uid, t))) });
      for (const p of st.parts) {
        const d0 = defOf(p);
        if (d0.hvsrc && !p.outage) sets.push({ name: d0.setName, dom: d0.srcDom, nets: d0.srcTerms.map(t => uf.find(tid(p.uid, t))) });
      }
      // 變壓器逐級衍生（345→161→11.4→380 串級，最多 4 輪至穩定）
      const fedNow = new Set();
      for (let xp = 0; xp < 4; xp++) {
        let added = false;
        for (const p of st.parts) {
          const xf = defOf(p).xfmr;
          if (!xf || fedNow.has(p.uid)) continue;
          const pn = ['1', '3', '5'].map(t => uf.find(tid(p.uid, t)));
          const feed = sets.find(s2 => s2.dom === xf.from && pn.every(n => s2.nets.includes(n)) && new Set(pn).size === 3);
          if (feed) {
            fedNow.add(p.uid);
            sets.push({ name: labelOf(p.uid, '').trim() + '二次', dom: xf.to, nets: ['2', '4', '6'].map(t => uf.find(tid(p.uid, t))) });
            added = true;
          }
        }
        if (!added) break;
      }
      for (const p of st.parts) if (defOf(p).xfmr) p._hvLive = fedNow.has(p.uid);
      // 有電的控制電源對
      const pairs = [];
      if (!src.outage) pairs.push([uf.find(tid(src.uid, 'C1')), uf.find(tid(src.uid, 'C2'))]);
      for (const p of st.parts) {
        const d = defOf(p);
        if (!d.tx) continue;
        const n1 = uf.find(tid(p.uid, 'P1')), n2 = uf.find(tid(p.uid, 'P2'));
        const live = sets.some(s => { const i = s.nets.indexOf(n1), j = s.nets.indexOf(n2); return i >= 0 && j >= 0 && i !== j; });
        p._txLive = live;
        if (live) pairs.push([uf.find(tid(p.uid, 'S1')), uf.find(tid(p.uid, 'S2'))]);
      }
      const energized = (u, ta, tb) => {
        const a = uf.find(tid(u, ta)), b = uf.find(tid(u, tb));
        return pairs.some(([c1, c2]) => c1 !== c2 && ((a === c1 && b === c2) || (a === c2 && b === c1)));
      };
      const nextCoil = {}, nextAts = {};
      for (const p of st.parts) {
        const d = defOf(p);
        if (d.coil) nextCoil[p.uid] = energized(p.uid, d.coil[0], d.coil[1]);
        if (d.ats) {
          const live3 = ts => {
            const ns = ts.map(t => uf.find(tid(p.uid, t)));
            return sets.some(s => ns.every(n => s.nets.includes(n)) && new Set(ns).size === 3);
          };
          nextAts[p.uid] = live3(['1', '3', '5']) ? 'N' : live3(['7', '9', '11']) ? 'E' : null;
        }
      }
      const stable = st.parts.every(p =>
        (nextCoil[p.uid] || false) === (coil[p.uid] || false) &&
        (nextAts[p.uid] || null) === (atsPos[p.uid] || null));
      coil = nextCoil;
      atsPos = nextAts;
      if (stable) { result = { uf, coil, atsPos, sets, pairs, oscillating: false }; break; }
      if (iter === 11) result = { uf, coil, atsPos, sets, pairs, oscillating: true };
    }
    st._ats = result.atsPos;
    const { uf, sets, pairs } = result;
    const nC1 = uf.find(tid(src.uid, 'C1')), nC2 = uf.find(tid(src.uid, 'C2'));
    const nR = uf.find(tid(src.uid, 'R')), nS = uf.find(tid(src.uid, 'S')), nT = uf.find(tid(src.uid, 'T'));
    // 短路偵測
    const shorts = [];
    for (const s of sets) {
      const [a, b, c] = s.nets;
      if (a === b || b === c || a === c) shorts.push(`相間短路（${s.name} R/S/T 直通）`);
    }
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
      if (sets[i].nets.some(n => sets[j].nets.includes(n))) shorts.push(`雙電源併聯（${sets[i].name} 與 ${sets[j].name} 未經切換直接相連）`);
    }
    for (const [c1, c2] of pairs) if (c1 === c2) shorts.push('控制迴路短路（C1-C2 直通）');
    // 負載狀態
    const lit = {}, motorRun = {}, motorMode = {}, meterVals = {}, scOn = {};
    const litOf = (u, ta, tb) => {
      const a = uf.find(tid(u, ta)), b = uf.find(tid(u, tb));
      return pairs.some(([c1, c2]) => c1 !== c2 && ((a === c1 && b === c2) || (a === c2 && b === c1)));
    };
    const trio = ns => sets.some(s => ns.every(n => s.nets.includes(n)) && new Set(ns).size === 3);
    for (const p of st.parts) {
      const d = defOf(p);
      if (d.load) lit[p.uid] = litOf(p.uid, d.load[0], d.load[1]);
      if (d.capbank) scOn[p.uid] = trio(['U', 'V', 'W'].map(t => uf.find(tid(p.uid, t))));
      if (d.motor6) {
        // 六出線：U1V1W1 三相齊備＋（U2V2W2 短接成星點＝Y／U2V2W2 各接一相＝Δ）
        const n1 = ['U1', 'V1', 'W1'].map(t => uf.find(tid(p.uid, t)));
        const n2 = ['U2', 'V2', 'W2'].map(t => uf.find(tid(p.uid, t)));
        const inPhase = n => sets.some(s => s.nets.includes(n));
        const okIn = trio(n1);
        const star = n2[0] === n2[1] && n2[1] === n2[2] && n2.every(n => !inPhase(n));
        const delta = trio(n2);
        motorRun[p.uid] = okIn && (star || delta);
        motorMode[p.uid] = okIn ? (star ? 'Y' : delta ? 'Δ' : null) : null;
      } else if (d.motor) {
        motorRun[p.uid] = trio(['U', 'V', 'W'].map(t => uf.find(tid(p.uid, t))));
      }
    }
    // 電流估算（真模擬：依各負載「可調的」運轉電流累加同節點電流）
    const ampsAt = n => {
      let amps = 0;
      for (const q of st.parts) {
        const qd = defOf(q);
        if (qd.motor && motorRun[q.uid]) {
          const ts = (qd.motorTerms || ['U', 'V', 'W']).concat(qd.motor6 ? ['U2', 'V2', 'W2'] : []);
          if (ts.some(t => uf.find(tid(q.uid, t)) === n)) amps += (q.loadA || 6.4);
        }
        if (qd.capbank && scOn[q.uid] && ['U', 'V', 'W'].some(t => uf.find(tid(q.uid, t)) === n)) amps += (q.ampsA || 2.1);
      }
      return amps;
    };
    // 高壓側電流串級：由低壓往上逐級換算（一次電流＝二次側電流÷變比）
    const XF_ORDER = { main: 0, hv: 1, ehv: 2, uhv: 3 };
    const hvNetAmps = {};
    const netA = n => (hvNetAmps[n] !== undefined ? hvNetAmps[n] : ampsAt(n));
    const xfs = st.parts.filter(p => defOf(p).xfmr && p._hvLive)
      .sort((a, b) => XF_ORDER[defOf(a).xfmr.to] - XF_ORDER[defOf(b).xfmr.to]);
    for (const p of xfs) {
      const xf = defOf(p).xfmr;
      const secA = Math.max(...['2', '4', '6'].map(t => netA(uf.find(tid(p.uid, t)))));
      const priA = secA / xf.ratio;
      for (const t of ['1', '3', '5']) {
        const n = uf.find(tid(p.uid, t));
        hvNetAmps[n] = (hvNetAmps[n] || 0) + priA;
      }
    }
    // 高壓串接設備（DS/LBS/VCB/GCB/PF/CT）流過的電流
    const hvAmps = {};
    for (const p of st.parts) {
      const d = defOf(p);
      if (d.dsw || d.loadbreak || d.breaker || d.fusehv || d.ctsig) {
        hvAmps[p.uid] = Math.max(hvNetAmps[uf.find(tid(p.uid, '1'))] || 0, hvNetAmps[uf.find(tid(p.uid, '2'))] || 0);
      }
    }
    // 儀表讀值：VM 跨兩相＝該電源的線電壓（可調）；AM 讀所在節點電流
    const tripAmps = {};
    for (const p of st.parts) {
      const d = defOf(p);
      if (d.meter === 'V') {
        const n1 = uf.find(tid(p.uid, 'P1')), n2 = uf.find(tid(p.uid, 'P2'));
        const hit = sets.find(s => { const i = s.nets.indexOf(n1), j = s.nets.indexOf(n2); return i >= 0 && j >= 0 && i !== j; });
        meterVals[p.uid] = hit ? (hit.name === '市電' ? (src.volt || 380) : 380) : 0;
      } else if (d.meter === 'A') {
        meterVals[p.uid] = ampsAt(uf.find(tid(p.uid, '1')));
      }
      // 保護元件流過電流（自動跳脫用）：取出線側 2/4/6 最大值
      if (d.trip) tripAmps[p.uid] = Math.max(...['2', '4', '6'].map(t => ampsAt(uf.find(tid(p.uid, t)))));
    }
    return {
      uf, coil: result.coil, atsPos: result.atsPos, lit, motorRun, motorMode, meterVals, scOn, tripAmps, hvAmps,
      shorts, oscillating: result.oscillating, sets, pairs,
      nets: { nC1, nC2, nR, nS, nT }
    };
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
    const DOMN = { main: '低壓主迴路（380V）', ctrl: '控制迴路（110V）', hv: '高壓（11.4kV）', ehv: '特高壓（161kV）', uhv: '超高壓（345kV）' };
    for (const w of st.wires) {
      const pa = termPos(byUid(w.a.uid), w.a.term), pb = termPos(byUid(w.b.uid), w.b.term);
      if (pa && pb && pa.dom !== pb.dom && pa.dom !== 'any' && pb.dom !== 'any') {
        err('電壓域混接', `${labelOf(w.a.uid, w.a.term)} ↔ ${labelOf(w.b.uid, w.b.term)}：${DOMN[pa.dom]} 與 ${DOMN[pb.dom]} 不可直接相接。`);
      }
    }

    if (!st.wires.length) {
      info('空白配電盤', '從元件盤加入元件，用「拉線」點兩個端子接線；或載入「自保持範例」。');
      return checks;
    }

    // 試驗台模式：儀器在盤上＝停電試驗情境，跳過受電路徑類檢查
    const testerMode = st.parts.some(p => defOf(p).tester);
    if (testerMode) {
      info('試驗台模式', '盤上有試驗器：受試設備不需接電源，通電功能已鎖定。接好探棒後到右欄「模擬」分頁執行試驗。');
      const ufW0 = buildUF('wires');
      for (const p of st.parts) {
        const d = defOf(p);
        if (!d.tester) continue;
        const wired = d.terms.some(t => st.wires.some(w => (w.a.uid === p.uid && w.a.term === t.n) || (w.b.uid === p.uid && w.b.term === t.n)));
        if (!wired) warn(`${labelOf(p.uid, '').trim()} 未接線`, '把探棒接到受試設備端子（與 GND）後才能執行試驗。');
      }
      void ufW0;
      pass('電壓域', '試驗探棒（灰色端子）可接任何電壓域。');
      return checks;
    }
    // 靜態短路（NFB 強制 ON、其餘接點依「全閉」假設檢查最壞情況；線圈未激磁）
    const rest = solve({});
    if (rest.shorts.length) rest.shorts.forEach(s => err('短路', s + '——通電將立即跳電。'));

    // 路徑存在性（全接點閉合假設）
    const ufAll = buildUF('all');
    const nC1 = ufAll.find(tid(src.uid, 'C1')), nC2 = ufAll.find(tid(src.uid, 'C2'));
    const nR = ufAll.find(tid(src.uid, 'R')), nS = ufAll.find(tid(src.uid, 'S')), nT = ufAll.find(tid(src.uid, 'T'));
    // 控制電源節點集合：POWER C1/C2 ＋ 各 TX/PT 二次側 S1/S2
    const ctrlNodes = new Set([nC1, nC2]);
    for (const q of st.parts) {
      if (defOf(q).tx) { ctrlNodes.add(ufAll.find(tid(q.uid, 'S1'))); ctrlNodes.add(ufAll.find(tid(q.uid, 'S2'))); }
    }
    // 電源三相組（路徑假設下）：市電＋發電機＋台電高壓＋變壓器二次側
    const trioSources = uf2 => {
      const list = [{ name: '市電', nets: ['R', 'S', 'T'].map(t => uf2.find(tid(src.uid, t))) }];
      for (const g of st.parts) {
        const d2 = defOf(g);
        if (d2.gen) list.push({ name: labelOf(g.uid, '').trim(), nets: ['GR', 'GS', 'GT'].map(t => uf2.find(tid(g.uid, t))) });
        if (d2.hvsrc) list.push({ name: d2.setName, nets: d2.srcTerms.map(t => uf2.find(tid(g.uid, t))) });
        if (d2.xfmr) list.push({ name: labelOf(g.uid, '').trim() + '二次', xfUid: g.uid, nets: ['2', '4', '6'].map(t => uf2.find(tid(g.uid, t))) });
      }
      return list;
    };
    for (const p of st.parts) {
      const d = defOf(p);
      if (d.coil) {
        const a = ufAll.find(tid(p.uid, d.coil[0])), b = ufAll.find(tid(p.uid, d.coil[1]));
        if (!ctrlNodes.has(a) || !ctrlNodes.has(b) || a === b) err(`${d.name} 線圈迴路不通`, `A1/A2 無法各自到達控制電源兩端（C1/C2 或 TX 的 S1/S2，即使所有接點閉合）。檢查 STOP／START／95-96 的串接。`);
      }
      if (d.motor) {
        // 正逆轉等互鎖群組：兩顆 MC 輸出併聯，全閉假設會把相位短接成同一節點造成誤報。
        // 改成「一次只閉合一顆 MC」逐情境檢查——任一情境三相齊備即通過。
        const tied = tiedMcGroup();
        const soloSets = tied.length >= 2
          ? tied.map(uid => new Set(tied.filter(u => u !== uid)))
          : [null];
        const mts = d.motorTerms || ['U', 'V', 'W'];
        let anyFull = false, anyDistinct = false, firstHit = null;
        for (const skip of soloSets) {
          const uf2 = skip ? buildUF('all', null, { skipMainsUids: skip }) : ufAll;
          const trios = trioSources(uf2);
          const ns = mts.map(t => uf2.find(tid(p.uid, t)));
          for (const tr of trios) {
            const idx = ns.map(n => tr.nets.indexOf(n));
            if (idx.every(i => i >= 0)) {
              anyFull = true;
              if (new Set(idx).size === 3) anyDistinct = true;
              if (!firstHit) firstHit = idx.map(i => 'RST'[i] || '?');
            }
          }
          if (!firstHit && ns.some(n => trios.some(tr => tr.nets.includes(n)))) firstHit = ns.map(n => trios.some(tr => tr.nets.includes(n)) ? '有' : '無');
        }
        if (!anyFull) err('馬達缺相', `${mts.join('/')} 有端子接不到任何電源相（即使所有接點閉合）——缺相運轉會燒毀馬達。`);
        else if (!anyDistinct) err('馬達相別重複', `${mts.join('/')} 接到了重複的相（${(firstHit || []).join('/')}），請檢查主迴路配線。`);
        else {
          // 保護串接：拿掉某保護設備主接點後馬達應該斷電（互鎖群組同樣只閉合一顆 MC）
          const soloOpts = tied.length >= 2 ? { skipMainsUids: new Set(tied.slice(1)) } : undefined;
          const SKIP_LBL = { thry: 'TH-RY', nfb: 'NFB', fuse: 'FUSE', co: 'CO' };
          const checkSerial = (skipId, okName, warnName, warnDesc) => {
            const ufSkip = buildUF('all-skip:' + skipId, null, soloOpts);
            const trios2 = trioSources(ufSkip);
            const ph2 = mts.map(t => ufSkip.find(tid(p.uid, t)));
            const still = ph2.every(n => trios2.some(tr => tr.nets.includes(n)));
            if (still) warn(warnName, warnDesc);
            else pass(okName, `${SKIP_LBL[skipId]} 已正確串接於馬達主迴路。`);
          };
          if (st.parts.some(q => q.id === 'thry' || q.id === 'co')) {
            if (st.parts.some(q => q.id === 'thry')) checkSerial('thry', '過載保護', '過載保護未串接', 'TH-RY 沒有串在馬達主迴路上，過載時無法斷電。');
            if (st.parts.some(q => q.id === 'co')) checkSerial('co', '過電流保護', 'CO 未串接', 'CO 過電流電驛沒有串在主迴路上，短路／過載時不會跳脫。');
          } else if (st.parts.some(q => q.id === 'ry')) pass('過載保護', '由高壓側 RY51 反時限電驛承擔（CT → RY → VCB 跳脫）。');
          else if (st.parts.some(q => q.id === 'pf')) pass('過載保護', '由高壓側 PF 電力熔絲承擔（過電流熔斷）。');
          else warn('缺過載保護', '主迴路沒有 TH-RY／CO（低壓）或 RY51／PF（高壓），馬達過載時無保護。');
          if (st.parts.some(q => q.id === 'nfb')) checkSerial('nfb', '短路保護', 'NFB 未串接', 'NFB 沒有串在馬達主迴路上，失去開關與短路保護。');
          else if (st.parts.some(q => q.id === 'fuse')) checkSerial('fuse', '保險絲保護', 'FUSE 未串接', '保險絲沒有串在主迴路上，失去後備保護。');
          else warn('缺 NFB', '主迴路沒有 NFB，無法斷電與短路保護。');
        }
      }
    }

    // PLC：電源與梯形圖
    const plcP = st.parts.find(p => defOf(p).plc);
    if (plcP) {
      const nL = ufAll.find(tid(plcP.uid, 'L')), nN = ufAll.find(tid(plcP.uid, 'N'));
      const cSet = ctrlNodeSet(ufAll);
      const powered = nL !== nN && cSet.has(nL) && cSet.has(nN);
      if (powered) pass('PLC 電源', 'L/N 已接上 110V 控制電源（C1/C2 或 TX/PT 二次側）。');
      else warn('PLC 未供電', 'L/N 沒有分別接到控制電源兩端（C1/C2 或 TX 的 S1/S2）——通電後 PLC 不會運作。');
      if (window.CF && CF.Plc) {
        const v = CF.Plc.validateAll();
        if (!v.rungs) info('梯形圖空白', '雙擊 PLC（或按工具列「梯形圖」）撰寫程式；空程式時輸出全部 OFF。');
        else v.warnings.forEach(m => warn('梯形圖', m));
      }
    }

    // TX 控制變壓器／PT 比壓器：一次側需跨接同一電源的兩個不同相
    const spannedIn = (uf2, p) => {
      const n1 = uf2.find(tid(p.uid, 'P1')), n2 = uf2.find(tid(p.uid, 'P2'));
      return n1 !== n2 && trioSources(uf2).some(tr => tr.nets.includes(n1) && tr.nets.includes(n2));
    };
    for (const p of st.parts) {
      if (!defOf(p).tx) continue;
      const ok = spannedIn(ufAll, p) || spannedIn(buildUF('all', null, { atsE: true }), p);
      if (ok) pass(p.id === 'pt' ? 'PT 比壓器' : '控制變壓器', `${labelOf(p.uid, '').trim()} 一次側正確跨接兩相，S1/S2 可供控制電源。`);
      else warn(p.id === 'pt' ? 'PT 未跨相' : '控制變壓器未跨相', `${labelOf(p.uid, '').trim()} 的 P1/P2 沒有分別接到兩個不同相——二次側不會有電。`);
    }

    // 高壓／特高壓受電：各級路徑、遮斷設備、電驛迴路、操作順序
    const xfParts = st.parts.filter(p => defOf(p).xfmr);
    const xfFedIn = (uf2, p) => {
      const pn = ['1', '3', '5'].map(t => uf2.find(tid(p.uid, t)));
      return new Set(pn).size === 3 && trioSources(uf2).some(tr => tr.xfUid !== p.uid && pn.every(n => tr.nets.includes(n)));
    };
    for (const p of xfParts) {
      if (xfFedIn(ufAll, p)) pass(`${labelOf(p.uid, '').trim()} 受電路徑`, '變壓器一次側可經開關設備受電（全閉假設）。');
      else warn(`${labelOf(p.uid, '').trim()} 一次側未受電`, '上一級電源經 DS／斷路器到變壓器 1/3/5 的路徑不通。');
    }
    // 各級電源需存在：某級變壓器的 from 域必須有進線或上一級主變供電
    const domSrcOk = dom => st.parts.some(q => defOf(q).srcDom === dom) || xfParts.some(q => defOf(q).xfmr.to === dom);
    const DOM_LVL = { hv: '11.4kV', ehv: '161kV', uhv: '345kV' };
    for (const dom of ['hv', 'ehv', 'uhv']) {
      if (xfParts.some(q => defOf(q).xfmr.from === dom) && !domSrcOk(dom)) {
        warn(`缺${DOM_LVL[dom]}電源`, `有 ${DOM_LVL[dom]} 一次側的變壓器，但該電壓等級沒有進線也沒有上一級主變。`);
      }
    }
    // 各級遮斷設備與串接
    const LVL_CFG = [
      { srcId: 'hvin', brks: ['vcb', 'pf'], fromDom: 'hv', lvl: '11.4kV' },
      { srcId: 'ehvin161', brks: ['gcb161'], fromDom: 'ehv', lvl: '161kV' },
      { srcId: 'ehvin345', brks: ['gcb345'], fromDom: 'uhv', lvl: '345kV' }
    ];
    for (const cfg of LVL_CFG) {
      if (!st.parts.some(q => q.id === cfg.srcId)) continue;
      const present = cfg.brks.filter(b => st.parts.some(q => q.id === b));
      if (!present.length) { warn(`缺${cfg.lvl}遮斷設備`, `${cfg.lvl} 側沒有 ${cfg.brks.join('／').toUpperCase()}——故障時無法遮斷（DS 無滅弧能力，不算）。`); continue; }
      const lvlXf = xfParts.filter(q => defOf(q).xfmr.from === cfg.fromDom);
      for (const b of present) {
        if (!lvlXf.length) break;
        const ufSkip = buildUF('all-skip:' + b);
        const still = lvlXf.some(q => xfFedIn(ufSkip, q));
        if (!still) pass(`${cfg.lvl} 遮斷`, `${b.toUpperCase()} 已正確串接於 ${cfg.lvl} 受電路徑。`);
        else warn(`${b.toUpperCase()} 未串接`, `${b.toUpperCase()} 沒有串在 ${cfg.lvl} 主迴路上，跳脫也切不斷電源。`);
      }
    }
    // RY51 迴路：S 側接 CT、T 側接斷路器跳脫線圈（VCB/GCB 通用）
    if (st.parts.some(q => q.id === 'ry')) {
      const ufW2 = buildUF('wires');
      for (const p of st.parts.filter(q => q.id === 'ry')) {
        const sN = [ufW2.find(tid(p.uid, 'S1')), ufW2.find(tid(p.uid, 'S2'))];
        const tN = [ufW2.find(tid(p.uid, 'T1')), ufW2.find(tid(p.uid, 'T2'))];
        const hasCt = st.parts.some(q => defOf(q).ctsig && [ufW2.find(tid(q.uid, 'k')), ufW2.find(tid(q.uid, 'l'))].some(n => sN.includes(n)));
        const hasTrip = st.parts.some(q => defOf(q).breaker && [ufW2.find(tid(q.uid, 'TC1')), ufW2.find(tid(q.uid, 'TC2'))].some(n => tN.includes(n)));
        if (hasCt && hasTrip) pass('過電流保護迴路', `${labelOf(p.uid, '').trim()}：CT → 電驛 → 斷路器跳脫迴路接妥（反時限 51）。`);
        else {
          if (!hasCt) warn('RY 未接 CT', `${labelOf(p.uid, '').trim()} 的 S1/S2 沒接到任何 CT 的 k/l——電驛量不到電流。`);
          if (!hasTrip) warn('RY 未接跳脫迴路', `${labelOf(p.uid, '').trim()} 的 T1/T2 沒接到 VCB/GCB 的 TC1/TC2——動作了也跳不了脫。`);
        }
      }
    }
    if (st.parts.some(q => defOf(q).dsw) && st.parts.some(q => defOf(q).breaker)) {
      info('停送電順序', '送電：先合 DS、再合斷路器（VCB/GCB）。停電：先開斷路器、再開 DS。帶載操作 DS 會發生弧光事故（模擬會如實呈現）。');
    }

    // ATS／發電機：常用與備用路徑、雙電源併聯
    const atsList = st.parts.filter(p => defOf(p).ats);
    const genList = st.parts.filter(p => defOf(p).gen);
    for (const g of genList) {
      const gn = ['GR', 'GS', 'GT'].map(t => ufAll.find(tid(g.uid, t)));
      if (gn.some(n => [nR, nS, nT].includes(n))) err('雙電源併聯', `${labelOf(g.uid, '').trim()} 的輸出與市電相位網直接相連——發電機起動時將與市電併聯短路。必須經 ATS 切換。`);
    }
    if (atsList.length) {
      const ufE = genList.length ? buildUF('all', null, { atsE: true }) : null;
      for (const at of atsList) {
        const la = labelOf(at.uid, '').trim();
        const nLive = ['2', '4', '6'].map(t => ufAll.find(tid(at.uid, t)));
        const nOk = new Set(nLive).size === 3 && trioSources(ufAll).some(tr => nLive.every(n => tr.nets.includes(n)));
        if (nOk) pass('常用電源路徑', `${la} 常用側（1/3/5）接自常用電源，輸出三相齊備。`);
        else warn('ATS 常用側未接妥', `${la} 的 1/3/5 沒有從常用電源接入三相。`);
        if (ufE) {
          const eOut = ['2', '4', '6'].map(t => ufE.find(tid(at.uid, t)));
          const eOk = genList.some(g => {
            const gn = ['GR', 'GS', 'GT'].map(t => ufE.find(tid(g.uid, t)));
            return eOut.every(n => gn.includes(n)) && new Set(eOut).size === 3;
          });
          if (eOk) pass('備用電源路徑', `${la} 備用側（7/9/11）接自發電機，停電時可切換供電。`);
          else warn('ATS 備用側未接妥', `${la} 的 7/9/11 沒有接到發電機 GR/GS/GT——停電時無法切換。`);
        }
      }
      if (!genList.length) info('無備用電源', '有 ATS 但沒有發電機；加入 GEN 並接到 7/9/11 才能演練停電切換。');
    } else if (genList.length) warn('發電機未經 ATS', '有發電機但沒有 ATS——無法安全切換雙電源。');

    // 電氣互鎖：同時投入會相間短路的 MC 配對（正逆轉、Y-Δ），線圈必須互經對方 21-22 b 接點
    const mcs = st.parts.filter(p => p.id === 'mc');
    if (mcs.length >= 2) {
      const coilReach = uf2 => {
        // 檢查每顆 MC 線圈在該假設下是否仍可達控制電源（含 TX/PT 二次側）
        const cSet2 = ctrlNodeSet(uf2);
        return p => {
          const a = uf2.find(tid(p.uid, 'A1')), b = uf2.find(tid(p.uid, 'A2'));
          return cSet2.has(a) && cSet2.has(b) && a !== b;
        };
      };
      for (let i = 0; i < mcs.length; i++) {
        for (let j = i + 1; j < mcs.length; j++) {
          const A = mcs[i], B = mcs[j];
          if (!mcPairShorts(A, B, mcs)) continue;   // 同時投入不短路（如順序啟動各帶各的馬達）
          const aNeedsB = !coilReach(buildUF('all-skipaux:' + B.uid))(A);
          const bNeedsA = !coilReach(buildUF('all-skipaux:' + A.uid))(B);
          const la = labelOf(A.uid, '').trim(), lb = labelOf(B.uid, '').trim();
          if (aNeedsB && bNeedsA) pass('電氣互鎖', `${la} 與 ${lb} 線圈互經對方 21-22 b 接點，互鎖正確。`);
          else err('缺電氣互鎖', `${la} 與 ${lb} 同時投入會相間短路（換相／星角），但線圈迴路未互鎖。請將各線圈串接對方的 21-22 b 接點。`);
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
    if (st.running) return { ok: false, msg: '模擬已在執行中' };
    if (st.parts.some(p => defOf(p).tester)) {
      return { ok: false, msg: '盤上有試驗器——試驗接線狀態不可通電（安全規定）。試驗完成後請清空或載入其他範例再通電。' };
    }
    const checks = st.plan ? st.plan.checks : buildChecks();
    const e = checks.find(c => c.status === 'error');
    if (e) return { ok: false, msg: `${e.name} — ${e.desc}` };
    st.running = true;
    st.coilPrev = {};
    st.log = [];
    st.timerDone = {};
    st.plcOut = {};
    if (window.CF && CF.Plc) CF.Plc.reset();
    pushLog('通電。掃描求解器啟動（120ms／週期）。');
    st.timer = setInterval(tick, 120);
    return { ok: true };
  }
  function simStop() {
    st.running = false;
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    st.live = null;
    st.timerDone = {};
    st.plcOut = {};
    st.atsPrev = {};
    st._ats = {};
    setBuzz(false);
    for (const p of st.parts) {
      p.energized = false; p.lit = false; p.run = false; p.tOn = null;
      p.powered = false; p.di = null; p.mode = null;
      p.running = false; p.startAt = null; p.stopAt = null;   // 發電機
      p.pos = null; p.reading = 0; p.otAt = null; p.scEn = false; p._txLive = false;
      p.ryAcc = 0; p.ryFired = false;
      if (defOf(p).outage) p.outage = false;                  // 市電復歸
    }
    render();
    if (st.onSim) st.onSim();
  }
  function toggleOutage(uid) {
    const p = (uid && byUid(uid))
      || st.parts.find(x => defOf(x).hvsrc && defOf(x).outage)
      || st.parts.find(x => defOf(x).outage);
    if (!p || !defOf(p).outage) return { ok: false, error: '盤上沒有電源' };
    const name = defOf(p).hvsrc ? '台電高壓' : '市電';
    p.outage = !p.outage;
    pushLog(p.outage ? `🔌 模擬${name}停電！` : `🔌 ${name}復電。`);
    render();
    return { ok: true, outage: p.outage };
  }

  /* 蜂鳴器音效（WebAudio） */
  let audio = null;
  function setBuzz(on) {
    try {
      if (on && !audio) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        g.gain.value = 0.05;
        osc.type = 'square';
        osc.frequency.value = 1568;
        osc.connect(g); g.connect(ctx.destination);
        osc.start();
        audio = { ctx, osc };
      } else if (!on && audio) {
        audio.osc.stop();
        audio.ctx.close();
        audio = null;
      }
    } catch (e) { audio = null; }
  }
  function pushLog(text) {
    st.log.push(text);
    if (st.log.length > 30) st.log.shift();
  }

  function tick() {
    if (!st.running) return;
    const now = Date.now();
    const src = sourcePart();
    // TR 計時（依上一掃描的線圈狀態累計）
    for (const p of st.parts) {
      const d = defOf(p);
      if (!d.timed) continue;
      if (p.energized) {
        if (!p.tOn) p.tOn = now;
        const done = now - p.tOn >= (p.preset || 3) * 1000;
        if (done && !st.timerDone[p.uid]) pushLog(`${labelOf(p.uid, '').trim()} 計時到達 ⏱（${p.preset || 3}s）——55-56 開、67-68 閉`);
        st.timerDone[p.uid] = done;
      } else {
        p.tOn = null;
        st.timerDone[p.uid] = false;
      }
    }
    // 發電機 AMF：任一電源（市電或台電高壓）停電（可調延時後）自動起動、復電自動停機
    const utilityDead = st.parts.some(p => defOf(p).outage && p.outage);
    for (const p of st.parts) {
      if (!defOf(p).gen) continue;
      const delay = (p.startDelay || 1.2) * 1000;
      if (utilityDead) {
        p.stopAt = null;
        if (!p.running) {
          if (!p.startAt) { p.startAt = now; pushLog(`市電停電——${labelOf(p.uid, '').trim()} AMF 起動程序（${(delay / 1000).toFixed(1)}s）⋯`); }
          if (now - p.startAt >= delay) { p.running = true; p.startAt = null; pushLog(`${labelOf(p.uid, '').trim()} 發電機建立電壓，開始供電 ⚙`); }
        }
      } else {
        p.startAt = null;
        if (p.running) {
          if (!p.stopAt) p.stopAt = now;
          if (now - p.stopAt >= 1000) { p.running = false; p.stopAt = null; pushLog(`市電復電——${labelOf(p.uid, '').trim()} 冷卻停機。`); }
        }
      }
    }
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
      if (d.coil && en !== !!p.energized) pushLog(`${labelOf(p.uid, '').trim()} ${en ? '吸持 🧲' : '釋放'}`);
      p.energized = en;
      if (d.load) p.lit = !!r.lit[p.uid];
      if (d.motor) {
        const run = !!r.motorRun[p.uid];
        const mode = d.motor6 ? (r.motorMode[p.uid] || null) : null;
        if (run !== !!p.run) pushLog(`馬達 ${run ? '運轉 ▶' : '停止 ■'}${run && mode ? `（${mode === 'Y' ? 'Y 星形啟動' : 'Δ 三角形'}）` : ''}`);
        else if (run && mode && mode !== p.mode) pushLog(`馬達切換 ${mode === 'Y' ? 'Y 星形' : 'Δ 三角形全壓'} 運轉 🔁`);
        p.run = run;
        p.mode = mode;
        if (run) st.motorAngle += 0.5;
      }
    }
    // 保護電驛自動跳脫（真模擬：流過電流 > 整定值，經熱延遲後跳脫）
    for (const p of st.parts) {
      const d = defOf(p);
      if (!d.autotrip || p.tripped) { if (d.trip) p.otAt = null; continue; }
      const amps = (r.tripAmps && r.tripAmps[p.uid]) || 0;
      const setA = p.setA !== undefined ? p.setA : d.param.def;
      if (amps > setA) {
        if (!p.otAt) { p.otAt = now; pushLog(`${labelOf(p.uid, '').trim()} 過電流 ${amps.toFixed(1)}A > 整定 ${setA}A——${d.autotrip >= 1000 ? '熱積累中' : '即將跳脫'}⋯`); }
        if (now - p.otAt >= d.autotrip) {
          p.tripped = true;
          p.otAt = null;
          pushLog(`${labelOf(p.uid, '').trim()} 跳脫！⚡（${amps.toFixed(1)}A > ${setA}A）`);
        }
      } else p.otAt = null;
    }
    // PF 電力熔絲：電流超過額定即熔斷
    for (const p of st.parts) {
      const d = defOf(p);
      if (!d.fusehv || p.tripped) continue;
      const amps = (r.hvAmps && r.hvAmps[p.uid]) || 0;
      const setA = p.setA !== undefined ? p.setA : d.param.def;
      if (amps > setA) {
        p.tripped = true;
        pushLog(`${labelOf(p.uid, '').trim()} 熔斷！💥（${amps.toFixed(2)}A > 額定 ${setA}A）——請更換熔絲筒（模擬面板可復歸）。`);
      }
    }
    // RY51 反時限過電流：讀 CT 電流，越大跳越快，出口跳脫 VCB
    for (const p of st.parts) {
      if (p.id !== 'ry') continue;
      const sNet = r.uf.find(tid(p.uid, 'S1')), sNet2 = r.uf.find(tid(p.uid, 'S2'));
      const ct = st.parts.find(q => defOf(q).ctsig &&
        [r.uf.find(tid(q.uid, 'k')), r.uf.find(tid(q.uid, 'l'))].some(n => n === sNet || n === sNet2));
      if (!ct) continue;
      const amps = (r.hvAmps && r.hvAmps[ct.uid]) || 0;
      const pickup = p.pickup !== undefined ? p.pickup : defOf(p).param.def;
      if (amps > pickup) {
        if (p.ryFired) continue;   // 已出口：電流未消失前不重複動作（防 log 洗版）
        const M = amps / pickup;
        const tTrip = Math.min(30, Math.max(0.15, 0.2 * 3 / (M - 1)));
        if (!p.ryAcc) pushLog(`${labelOf(p.uid, '').trim()} 啟動！I=${amps.toFixed(2)}A > 整定 ${pickup}A（預計 ${tTrip.toFixed(1)}s 後跳脫）`);
        p.ryAcc = (p.ryAcc || 0) + 0.12;
        if (p.ryAcc >= tTrip) {
          p.ryAcc = 0;
          p.ryFired = true;
          const tNet = r.uf.find(tid(p.uid, 'T1')), tNet2 = r.uf.find(tid(p.uid, 'T2'));
          const vcbT = st.parts.find(q => defOf(q).breaker &&
            [r.uf.find(tid(q.uid, 'TC1')), r.uf.find(tid(q.uid, 'TC2'))].some(n => n === tNet || n === tNet2));
          if (vcbT) {
            vcbT.tripped = true;
            vcbT.on = false;
            pushLog(`${labelOf(p.uid, '').trim()} 出口動作 → ${labelOf(vcbT.uid, '').trim()} 跳脫！⚡（過電流保護）——復歸後需重新投入`);
          } else pushLog(`${labelOf(p.uid, '').trim()} 出口動作，但 T1/T2 沒接到任何 VCB 的跳脫線圈——無法跳脫！`);
        }
      } else { p.ryAcc = 0; p.ryFired = false; }
    }
    // ATS 切換紀錄
    for (const p of st.parts) {
      if (!defOf(p).ats) continue;
      const pos = (r.atsPos && r.atsPos[p.uid]) || null;
      if (pos !== (p.pos || null)) {
        pushLog(pos === 'N' ? 'ATS 切換至【常用】市電側 🔁' : pos === 'E' ? 'ATS 切換至【備用】發電機側 🔁' : 'ATS 兩側均無電——開路。');
        p.pos = pos;
      }
    }
    // 儀表與電容器組
    for (const p of st.parts) {
      const d = defOf(p);
      if (d.meter) p.reading = (r.meterVals && r.meterVals[p.uid]) || 0;
      if (d.capbank) {
        const on = !!(r.scOn && r.scOn[p.uid]);
        if (on !== !!p.scEn) pushLog(on ? `${labelOf(p.uid, '').trim()} 電容器組投入——功因 0.72 → 0.98 ✦` : `${labelOf(p.uid, '').trim()} 電容器組切離。`);
        p.scEn = on;
      }
    }
    // PLC 掃描：讀輸入 → 執行梯形圖 → 寫輸出（輸出下一掃描生效）
    for (const p of st.parts) {
      const d = defOf(p);
      if (!d.plc) continue;
      const nL = r.uf.find(tid(p.uid, 'L')), nN = r.uf.find(tid(p.uid, 'N'));
      const powered = r.pairs.some(([c1, c2]) => c1 !== c2 && ((nL === c1 && nN === c2) || (nL === c2 && nN === c1)));
      if (powered !== !!p.powered) {
        pushLog(`PLC ${powered ? '上電 RUN ▶' : '失電 STOP ■'}`);
        if (!powered && window.CF && CF.Plc) CF.Plc.reset();
      }
      p.powered = powered;
      let out = {};
      if (powered && window.CF && CF.Plc) {
        const nCom = r.uf.find(tid(p.uid, 'COM'));
        const xin = {};
        for (let i = 0; i < 8; i++) xin['X' + i] = r.uf.find(tid(p.uid, 'X' + i)) === nCom;
        p.di = xin;
        out = CF.Plc.scan(xin, 120);
      } else p.di = null;
      const prev = st.plcOut[p.uid] || {};
      for (let i = 0; i < 8; i++) {
        const k = 'Y' + i;
        if (!!out[k] !== !!prev[k]) pushLog(`PLC ${k} ${out[k] ? 'ON' : 'OFF'}`);
      }
      st.plcOut[p.uid] = out;
    }
    setBuzz(st.parts.some(p => defOf(p).buzzer && p.lit));
    st.coilPrev = r.coil;
    st.atsPrev = r.atsPos;
    st.live = r;
    render();
    if (st.onSim) st.onSim();
  }

  /* ================= 畫布 ================= */
  function render() {
    const { ctx } = st;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, st.canvas.width, st.canvas.height);
    ctx.setTransform(st.dpr * st.scale, 0, 0, st.dpr * st.scale, st.dpr * st.ox, st.dpr * st.oy);

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
    if (pa.dom === 'any') return '#6a7a72';
    if (pa.dom === 'hv') return '#8a3b9f';
    if (pa.dom === 'ehv') return '#2e6bd0';
    if (pa.dom === 'uhv') return '#c02a50';
    if (pa.dom === 'ctrl') {
      if (st.running && st.live && st.live.pairs) {
        const n = st.live.uf.find(tid(w.a.uid, w.a.term));
        if (st.live.pairs.some(pr => pr[0] === n || pr[1] === n)) return '#f0a020';
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
      if (d.motor6 && p.run && p.mode) {
        ctx.fillStyle = '#3ddc84';
        ctx.font = '700 14px monospace';
        ctx.fillText(p.mode, cx + r + 8, cy + 5);
      }
    }
    if (d.timed) {  // TR 倒數
      const total = p.preset || 3;
      const rem = p.tOn ? Math.max(0, total - (Date.now() - p.tOn) / 1000) : total;
      ctx.textAlign = 'center';
      ctx.fillStyle = (st.timerDone && st.timerDone[p.uid]) ? '#3ddc84' : '#e8c97a';
      ctx.font = '700 13px monospace';
      ctx.fillText(`⏱ ${rem.toFixed(1)}s`, p.x + d.w / 2, p.y + d.h / 2 + 16);
      ctx.font = '9px "Noto Sans TC", sans-serif';
      ctx.fillStyle = 'rgba(242,244,246,.6)';
      ctx.fillText(`設定 ${total}s・雙擊修改`, p.x + d.w / 2, p.y + d.h / 2 + 32);
      ctx.textAlign = 'left';
    }
    if (d.selector) {  // COS 旋鈕
      const cx = p.x + d.w / 2, cy = p.y + d.h / 2 + 4;
      ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#2a2e33'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(p.on ? Math.PI / 5 : -Math.PI / 5);
      ctx.strokeStyle = '#e8d9a0'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, -11); ctx.stroke();
      ctx.restore();
      ctx.font = '8px monospace';
      ctx.fillStyle = p.on ? 'rgba(242,244,246,.4)' : '#e8d9a0';
      ctx.fillText('A', cx - 22, cy - 8);
      ctx.fillStyle = p.on ? '#e8d9a0' : 'rgba(242,244,246,.4)';
      ctx.fillText('B', cx + 17, cy - 8);
    }
    if (d.plc) {  // PLC 面板：狀態螢幕＋X/Y LED
      ctx.fillStyle = '#101820';
      roundRect(ctx, p.x + 12, p.y + 44, 68, 42, 4); ctx.fill();
      ctx.font = '700 12px monospace';
      ctx.fillStyle = p.powered ? '#3ddc84' : '#5a646e';
      ctx.fillText(st.running ? (p.powered ? 'RUN' : 'NO PWR') : 'STOP', p.x + 20, p.y + 62);
      ctx.font = '8px monospace';
      ctx.fillStyle = '#7a94ac';
      ctx.fillText('雙擊開梯形圖', p.x + 18, p.y + 78);
      ctx.font = '8px monospace';
      ctx.fillStyle = 'rgba(242,244,246,.6)';
      ctx.fillText('X', p.x + 90, p.y + 57);
      ctx.fillText('Y', p.x + 90, p.y + 73);
      const out = st.plcOut[p.uid] || {};
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = (p.di && p.di['X' + i]) ? '#ffb020' : '#31404e';
        ctx.fillRect(p.x + 100 + i * 19, p.y + 50, 11, 7);
        ctx.fillStyle = out['Y' + i] ? '#3ddc84' : '#31404e';
        ctx.fillRect(p.x + 100 + i * 19, p.y + 66, 11, 7);
      }
    }
    if (d.outage) {  // 電源：電壓＋停電狀態
      ctx.font = '10px monospace';
      ctx.fillStyle = p.outage ? '#ff5348' : 'rgba(242,244,246,.7)';
      ctx.textAlign = 'center';
      ctx.fillText(p.outage ? '✕ 停電中' : `3Φ ${p.volt || 380}V`, p.x + d.w / 2, p.y + 50);
      ctx.textAlign = 'left';
    }
    if (d.meter) {  // 儀表：圓表頭＋讀值
      const cx = p.x + d.w / 2, cy = p.y + d.h / 2 + 6;
      ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2);
      ctx.fillStyle = '#101820'; ctx.fill();
      ctx.strokeStyle = '#5a646e'; ctx.lineWidth = 1.5; ctx.stroke();
      const v = p.reading || 0;
      ctx.save();
      ctx.translate(cx, cy);
      const frac = d.meter === 'V' ? Math.min(1, v / 480) : Math.min(1, v / 30);
      ctx.rotate(-Math.PI * 0.75 + frac * Math.PI * 1.5);
      ctx.strokeStyle = v > 0 ? '#3ddc84' : '#5a646e';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -12); ctx.stroke();
      ctx.restore();
      ctx.font = '700 9px monospace';
      ctx.fillStyle = v > 0 ? '#3ddc84' : 'rgba(242,244,246,.5)';
      ctx.textAlign = 'center';
      ctx.fillText(d.meter === 'V' ? `${Math.round(v)}V` : `${v.toFixed(1)}A`, cx, cy + 26);
      ctx.textAlign = 'left';
    }
    if (d.capbank) {  // 電容器組
      ctx.strokeStyle = p.scEn ? '#8fd8b0' : '#5a646e';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const cx = p.x + 26 + i * 25;
        ctx.beginPath(); ctx.moveTo(cx, p.y + 46); ctx.lineTo(cx, p.y + 58); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 7, p.y + 62); ctx.lineTo(cx + 7, p.y + 62); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 7, p.y + 68); ctx.lineTo(cx + 7, p.y + 68); ctx.stroke();
      }
      ctx.font = '700 10px monospace';
      ctx.fillStyle = p.scEn ? '#3ddc84' : 'rgba(242,244,246,.5)';
      ctx.textAlign = 'center';
      ctx.fillText(p.scEn ? 'PF 0.98 ✦' : 'PF 0.72', p.x + d.w / 2, p.y + d.h - 8);
      ctx.textAlign = 'left';
    }
    if (d.tx) {  // 變壓器雙圈
      const cx = p.x + d.w / 2, cy = p.y + d.h / 2 + 6;
      ctx.strokeStyle = p._txLive && st.running ? '#f0a020' : '#7a828a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx - 7, cy, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + 7, cy, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '8px monospace';
      ctx.fillStyle = 'rgba(242,244,246,.6)';
      ctx.textAlign = 'center';
      ctx.fillText(d.id === 'pt' ? '11.4kV→110V' : '380→110V', cx, cy + 24);
      ctx.textAlign = 'left';
    }
    if (d.ats) {  // ATS 位置指示
      const cx = p.x + d.w / 2, cy = p.y + d.h / 2 + 10;
      ctx.font = '700 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.pos === 'N' ? '#3ddc84' : 'rgba(242,244,246,.35)';
      ctx.fillText('常用 N', cx - 34, cy);
      ctx.fillStyle = p.pos === 'E' ? '#ffb020' : 'rgba(242,244,246,.35)';
      ctx.fillText('備用 E', cx + 34, cy);
      ctx.strokeStyle = '#e8d9a0'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, cy + 14);
      ctx.lineTo(cx + (p.pos === 'E' ? 22 : p.pos === 'N' ? -22 : 0), cy - 6);
      ctx.stroke();
      ctx.textAlign = 'left';
    }
    if (d.gen) {  // 發電機
      const cx = p.x + 40, cy = p.y + d.h / 2 + 10;
      ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.fillStyle = '#242e38'; ctx.fill();
      ctx.strokeStyle = p.running ? '#3ddc84' : '#5a646e'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.font = '700 11px monospace';
      ctx.fillStyle = p.running ? '#3ddc84' : 'rgba(242,244,246,.6)';
      ctx.textAlign = 'center';
      ctx.fillText('G', cx, cy + 4);
      ctx.font = '9px monospace';
      ctx.fillText(p.running ? 'RUN ⚙' : (p.startAt ? '起動中⋯' : 'AMF 待機'), p.x + d.w / 2 + 22, cy + 4);
      ctx.textAlign = 'left';
    }
    if (d.hvsrc) {  // 高壓／特高壓進線
      ctx.font = '700 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.outage ? '#ff5348' : (d.srcDom === 'uhv' ? '#f0a0b8' : d.srcDom === 'ehv' ? '#7db0e8' : '#d9a0f0');
      ctx.fillText(p.outage ? '✕ 停電中' : '⚡ ' + d.setName.replace('台電', ''), p.x + d.w / 2, p.y + 50);
      ctx.textAlign = 'left';
    }
    if (d.id === 'la') {  // 避雷器：洩流箭頭＋接地
      const cx = p.x + d.w / 2;
      ctx.strokeStyle = '#9a8ab0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, p.y + 40); ctx.lineTo(cx, p.y + 56); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 4, p.y + 50); ctx.lineTo(cx, p.y + 58); ctx.lineTo(cx + 4, p.y + 50); ctx.stroke();
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(cx - 8 + i * 3, p.y + 62 + i * 3); ctx.lineTo(cx + 8 - i * 3, p.y + 62 + i * 3); ctx.stroke(); }
    }
    if (d.dsw || d.loadbreak || d.breaker) {  // 開關刀片
      const on = p.on && !p.tripped && !p.fault;
      ctx.strokeStyle = p.fault ? '#ff5348' : on ? '#3ddc84' : '#8a8f95';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const x = p.x + d.w / 2 - 20 + i * 20;
        ctx.beginPath();
        ctx.moveTo(x, p.y + d.h / 2 + 18);
        if (on) ctx.lineTo(x, p.y + d.h / 2 - 6);
        else ctx.lineTo(x + 10, p.y + d.h / 2 - 2);
        ctx.stroke();
      }
      ctx.font = '700 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.fault ? '#ff5348' : p.tripped ? '#ffb020' : on ? '#3ddc84' : 'rgba(242,244,246,.6)';
      ctx.fillText(p.fault ? '⚡ 弧光損壞' : p.tripped ? 'TRIP ⚡' : on ? '合 ●' : '分 ○', p.x + d.w / 2, p.y + d.h - 8);
      ctx.textAlign = 'left';
    }
    if (d.fusehv) {  // 電力熔絲筒
      for (let i = 0; i < 3; i++) {
        const x = p.x + 14 + i * 18;
        ctx.fillStyle = p.tripped ? '#5a4444' : '#7a6a4a';
        ctx.fillRect(x - 4, p.y + d.h / 2 - 10, 8, 24);
        if (p.tripped) {
          ctx.strokeStyle = '#ff5348'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x - 5, p.y + d.h / 2 - 2); ctx.lineTo(x + 5, p.y + d.h / 2 + 6); ctx.stroke();
        }
      }
      if (p.tripped) {
        ctx.font = '700 9px monospace'; ctx.fillStyle = '#ff5348'; ctx.textAlign = 'center';
        ctx.fillText('熔斷', p.x + d.w / 2, p.y + d.h - 6);
        ctx.textAlign = 'left';
      }
    }
    if (d.id === 'cthv') {  // 比流器環
      for (let i = 0; i < 3; i++) {
        const x = p.x + 14 + i * 18;
        ctx.strokeStyle = '#7a94ac'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, p.y + d.h / 2 + 2, 7, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (d.xfmr) {  // 變壓器（各級）
      const cx = p.x + d.w / 2, cy = p.y + d.h / 2 + 2;
      ctx.strokeStyle = p._hvLive && st.running ? '#3ddc84' : '#8a7a5a';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy - 7, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy + 7, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '9px monospace';
      ctx.fillStyle = 'rgba(242,244,246,.7)';
      ctx.textAlign = 'center';
      ctx.fillText(`${p.kva !== undefined ? p.kva : d.param.def}${d.param.unit} ${d.xfmr.disp}`, cx, p.y + d.h - 22);
      ctx.textAlign = 'left';
    }
    if (d.id === 'ry') {  // 保護電驛
      ctx.font = '700 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.ryAcc > 0 ? '#ffb020' : 'rgba(242,244,246,.7)';
      ctx.fillText(`I> ${p.pickup !== undefined ? p.pickup : 0.5}A`, p.x + d.w / 2, p.y + d.h / 2 + 8);
      if (p.ryAcc > 0) ctx.fillText('動作中⋯', p.x + d.w / 2, p.y + d.h / 2 + 22);
      ctx.textAlign = 'left';
    }
    if (d.tester) {  // 試驗器螢幕
      ctx.fillStyle = '#101820';
      roundRect(ctx, p.x + 10, p.y + 30, d.w - 20, 26, 4); ctx.fill();
      ctx.font = '700 10px monospace';
      ctx.textAlign = 'center';
      const msg = p.testing ? '試驗中⋯' : (p.testMsg || 'READY');
      ctx.fillStyle = p.testing ? '#ffb020' : msg.includes('✕') ? '#ff5348' : msg.includes('✓') ? '#3ddc84' : '#7a94ac';
      ctx.fillText(msg.slice(0, 14), p.x + d.w / 2, p.y + 47);
      ctx.textAlign = 'left';
    }
    if (p.defect) {  // 缺陷標記（教學注入）
      ctx.font = '700 12px monospace';
      ctx.fillStyle = '#ffb020';
      ctx.fillText('💉', p.x + d.w - 16, p.y + 14);
    }
    if (d.earth) {  // 接地符號
      const cx = p.x + d.w / 2;
      ctx.strokeStyle = '#8fa89a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, p.y + 24); ctx.lineTo(cx, p.y + 34); ctx.stroke();
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(cx - 9 + i * 3, p.y + 36 + i * 4); ctx.lineTo(cx + 9 - i * 3, p.y + 36 + i * 4); ctx.stroke(); }
    }
    if (d.param && (d.trip || d.motor)) {  // 整定值／負載電流（可調參數提示）
      const v = p[d.param.key] !== undefined ? p[d.param.key] : d.param.def;
      ctx.font = '9px monospace';
      ctx.fillStyle = 'rgba(242,244,246,.65)';
      ctx.textAlign = 'center';
      ctx.fillText(`${d.trip ? '整定' : '負載'} ${v}${d.param.unit === '秒' ? 's' : d.param.unit}`, p.x + d.w / 2, p.y + d.h - (d.motor ? 44 : 22));
      ctx.textAlign = 'left';
    }

    // 端子
    for (const t of d.terms) {
      const x = p.x + t.dx, y = p.y + t.dy;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = t.dom === 'main' ? '#d8dce0' : t.dom === 'hv' ? '#d9a0f0' : t.dom === 'ehv' ? '#7db0e8' : t.dom === 'uhv' ? '#f0a0b8' : t.dom === 'any' ? '#f2f4f6' : '#ffd9a0';
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
        const txt = `${labelOf(p.uid, t.n)}（${t.dom === 'main' ? '主迴路' : t.dom === 'hv' ? '高壓11.4kV' : t.dom === 'ehv' ? '161kV' : t.dom === 'uhv' ? '345kV' : t.dom === 'any' ? '試驗探棒' : '控制'}）`;
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

  /* 縮放／平移 */
  function applyView() {
    st.scale = st.baseScale * st.zoom;
    st.ox = st.baseOx + st.panX;
    st.oy = st.baseOy + st.panY;
    render();
  }
  function resetView() {
    st.zoom = 1; st.panX = 0; st.panY = 0;
    applyView();
  }
  function onWheel(e) {
    e.preventDefault();
    const rect = st.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const lx = (cx - st.ox) / st.scale, ly = (cy - st.oy) / st.scale;
    const z2 = Math.min(4, Math.max(0.5, st.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    st.zoom = z2;
    st.scale = st.baseScale * st.zoom;
    st.panX = cx - lx * st.scale - st.baseOx;
    st.panY = cy - ly * st.scale - st.baseOy;
    applyView();
  }
  function onMove(e) {
    if (st.panDrag) {
      const dx = e.clientX - st.panDrag.x, dy = e.clientY - st.panDrag.y;
      if (st.panDrag.on || Math.hypot(dx, dy) > 4) {
        st.panDrag.on = true;
        st.panX += e.clientX - st.panDrag.x;
        st.panY += e.clientY - st.panDrag.y;
        st.panDrag.x = e.clientX; st.panDrag.y = e.clientY;
        applyView();
        return;
      }
    }
    const [x, y] = toLogical(e);
    st.hover = pickTerm(x, y);
    if (st.hover) { st.hover.x = x; st.hover.y = y; }
    render();
  }
  function onUp() { st.panDrag = null; }
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
      st.panDrag = { x: e.clientX, y: e.clientY };
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
    st.panDrag = { x: e.clientX, y: e.clientY };   // 空白處拖曳＝平移
    render();
  }
  function onDbl(e) {
    const [x, y] = toLogical(e);
    const p = pickPart(x, y);
    if (!p) { resetView(); return; }   // 雙擊空白處：重置縮放平移
    const d = defOf(p);
    if (d.dsw || d.loadbreak || d.breaker) { operateSwitch(p.uid); return; }
    if (d.toggle || d.selector) {
      p.on = !p.on;
      if (st.running) render(); else changed();
      return;
    }
    if (d.param) {
      const pr = d.param;
      const cur = p[pr.key] !== undefined ? p[pr.key] : pr.def;
      const v = parseFloat(window.prompt(`${labelOf(p.uid, '').trim()} ${pr.name}（${pr.min}–${pr.max} ${pr.unit}）`, cur));
      if (v >= pr.min && v <= pr.max) {
        p[pr.key] = Math.round(v * 10) / 10;
        if (st.running) render(); else changed();
      }
      return;
    }
    if (d.plc && st.onLadder) st.onLadder(p.uid);
  }
  /* 高壓開關操作（DS 帶載開斷＝弧光事故；LBS 超過額定＝損壞） */
  function operateSwitch(uid) {
    const p = byUid(uid);
    if (!p) return { ok: false, error: '找不到開關' };
    const d = defOf(p);
    if (!(d.dsw || d.loadbreak || d.breaker)) return { ok: false, error: `${labelOf(p.uid, '').trim()} 不是開關設備` };
    const lbl = labelOf(p.uid, '').trim();
    if (p.fault) return { ok: false, error: `${lbl} 已弧光損壞，無法操作——請重新載入範例（實務上要整組更換）` };
    if (d.breaker && p.tripped) return { ok: false, error: `${lbl} 處於跳脫狀態，請先「復歸」再投入` };
    let amps = 0;
    if (st.running) {
      const live = solve(st.coilPrev);   // 即時求解，不用 120ms 前的快照
      amps = (live.hvAmps && live.hvAmps[p.uid]) || 0;
    }
    if (p.on && amps > 0.004) {
      if (d.dsw) {
        p.fault = true;
        p.on = false;
        pushLog(`⚡⚡ ${lbl} 帶載開斷（${amps.toFixed(2)}A）——弧光事故！開關燒毀、全盤停電。停電順序應為：先開 VCB、再開 DS。`);
        render();
        if (st.onSim) st.onSim();
        return { ok: true, fault: true, msg: '弧光事故！DS 不可帶載操作' };
      }
      if (d.loadbreak && amps > (p.rateA !== undefined ? p.rateA : d.param.def)) {
        p.fault = true;
        p.on = false;
        pushLog(`⚡ ${lbl} 開斷電流超過額定——滅弧失敗、開關損壞！`);
        render();
        if (st.onSim) st.onSim();
        return { ok: true, fault: true };
      }
    }
    p.on = !p.on;
    pushLog(`${lbl} ${p.on ? '投入 ●' : '開斷 ○'}`);
    if (st.running) render(); else changed();
    return { ok: true, on: p.on };
  }
  function resetProtection(uid) {
    const p = byUid(uid) || st.parts.find(x => (defOf(x).breaker || defOf(x).fusehv) && x.tripped);
    if (!p) return { ok: false, error: '沒有需要復歸的保護設備' };
    const d = defOf(p);
    if (!p.tripped) return { ok: false, error: `${labelOf(p.uid, '').trim()} 沒有跳脫` };
    p.tripped = false;
    pushLog(`${labelOf(p.uid, '').trim()} ${d.fusehv ? '熔絲已更換' : '復歸（開路狀態，需再投入）'}。`);
    if (st.running) render(); else changed();
    return { ok: true };
  }

  /* ================= 設備試驗（竣工／維護） ================= */
  function probeTarget(instUid, probeTerm, filterFn) {
    // 探棒所在的「純導線」網上，找第一個非儀器的元件
    const ufW = buildUF('wires');
    const n = ufW.find(tid(instUid, probeTerm));
    for (const p of st.parts) {
      if (p.uid === instUid) continue;
      const d = defOf(p);
      if (d.tester) continue;
      if (filterFn && !filterFn(p, d)) continue;
      if (d.terms.some(t => ufW.find(tid(p.uid, t.n)) === n)) return p;
    }
    return null;
  }
  function testLog(msg) { pushLog(msg); render(); if (st.onSim) st.onSim(); }
  const delay = ms => new Promise(r => setTimeout(r, ms));

  async function runTest(uid) {
    const inst = byUid(uid);
    if (!inst || !defOf(inst).tester) return { ok: false, error: '找不到試驗器' };
    if (st.running) return { ok: false, error: '通電中不可進行試驗——先按「斷電」再試驗（安全第一）。' };
    if (inst.testing) return { ok: false, error: '試驗進行中' };
    const kind = defOf(inst).tester;
    const lbl = labelOf(inst.uid, '').trim();
    const pv = k => inst[k] !== undefined ? inst[k] : defOf(inst).param.def;
    inst.testing = true;
    inst.testMsg = '試驗中⋯';
    const gen0 = st.gen || 0;
    const stale = () => (st.gen || 0) !== gen0 || !byUid(uid);
    try {
      if (kind === 'meg') {
        const tgt = probeTarget(uid, 'L');
        const earth = probeTarget(uid, 'E', (p, d) => d.earth);
        if (!tgt) return { ok: false, error: 'L 探棒沒有接到受試設備端子' };
        if (!earth) return { ok: false, error: 'E 探棒沒有接到 GND 接地排' };
        const tl = labelOf(tgt.uid, '').trim();
        testLog(`${lbl}：對 ${tl} 施加 DC ${pv('volt')}V 絕緣測試⋯`);
        await delay(1200);
        if (stale()) return { ok: false, error: '盤面已變更，試驗中止' };
        const ins = insulOf(tgt) * (0.9 + Math.random() * 0.2);
        const need = insulNeed(tgt);
        const okV = ins >= need;
        inst.testMsg = `${ins >= 1000 ? Math.round(ins) : ins.toFixed(1)}MΩ ${okV ? '✓合格' : '✕不合格'}`;
        testLog(okV
          ? `${lbl}：${tl} 絕緣電阻 ${Math.round(ins)}MΩ ≥ ${need}MΩ——判定【合格】✓`
          : `${lbl}：${tl} 絕緣電阻僅 ${ins.toFixed(2)}MΩ < ${need}MΩ——判定【不合格】✕ 絕緣受潮或劣化，禁止加壓！`);
        return { ok: true, target: tl, mohm: +ins.toFixed(2), pass: okV };
      }
      if (kind === 'hipot') {
        const tgt = probeTarget(uid, 'H');
        const earth = probeTarget(uid, 'R', (p, d) => d.earth);
        if (!tgt) return { ok: false, error: 'H 探棒沒有接到受試設備端子' };
        if (!earth) return { ok: false, error: 'R 探棒沒有接到 GND 接地排' };
        const tl = labelOf(tgt.uid, '').trim();
        const kv = pv('volt');
        testLog(`${lbl}：${tl} AC 耐壓試驗，升壓至 ${kv}kV⋯`);
        for (const pct of [25, 50, 75]) {
          await delay(600);
          if (stale()) return { ok: false, error: '盤面已變更，試驗中止' };
          if (tgt.defect === 'insulation' && pct >= 50) {
            inst.testMsg = `${(kv * pct / 100).toFixed(1)}kV 閃絡 ✕`;
            testLog(`⚡ ${lbl}：升壓至 ${(kv * pct / 100).toFixed(1)}kV 時 ${tl} 絕緣崩潰閃絡！——判定【不合格】✕ 該設備不得投入運轉。`);
            return { ok: true, target: tl, pass: false, breakdown_kV: +(kv * pct / 100).toFixed(1) };
          }
          testLog(`${lbl}：${(kv * pct / 100).toFixed(1)}kV⋯`);
        }
        await delay(800);
        if (stale()) return { ok: false, error: '盤面已變更，試驗中止' };
        const leak = +(kv / insulOf(tgt) * 8).toFixed(2);
        inst.testMsg = `${kv}kV 保持 ✓（${leak}mA）`;
        testLog(`${lbl}：${kv}kV 保持 60 秒（模擬），洩漏電流 ${leak}mA——判定【合格】✓`);
        return { ok: true, target: tl, pass: true, leak_mA: leak };
      }
      if (kind === 'ctt') {
        const tgt = probeTarget(uid, 'P1', (p, d) => d.ctsig);
        if (!tgt) return { ok: false, error: 'P1/P2 沒有接到 CT 的一次側端子' };
        const ufW = buildUF('wires');
        const sNet = [ufW.find(tid(uid, 'S1')), ufW.find(tid(uid, 'S2'))];
        const sOk = [ufW.find(tid(tgt.uid, 'k')), ufW.find(tid(tgt.uid, 'l'))].some(n => sNet.includes(n));
        if (!sOk) return { ok: false, error: 'S1/S2 沒有接到同一顆 CT 的 k/l 二次端子' };
        const tl = labelOf(tgt.uid, '').trim();
        const inj = pv('inject');
        const nameplate = tgt.ratio !== undefined ? tgt.ratio : defOf(tgt).param.def;
        testLog(`${lbl}：對 ${tl} 一次側注入 ${inj}A⋯`);
        await delay(1200);
        if (stale()) return { ok: false, error: '盤面已變更，試驗中止' };
        if (tgt.defect === 'polarity') {
          inst.testMsg = '極性【反】✕';
          testLog(`${lbl}：${tl} 二次輸出相位相反——【極性接反】✕ 保護電驛會誤動作，必須改正 k/l。`);
          return { ok: true, target: tl, pass: false, fault: 'polarity' };
        }
        const err2 = tgt.defect === 'ratio' ? 0.22 : (Math.random() * 0.01 - 0.005);
        const sec = +(inj / (nameplate / 5) * (1 + err2)).toFixed(3);
        const measured = +(inj / sec * 5).toFixed(1);
        const okR = Math.abs(measured - nameplate) / nameplate < 0.05;
        inst.testMsg = `${measured}/5A ${okR ? '✓' : '✕'}`;
        testLog(okR
          ? `${lbl}：${tl} 實測變比 ${measured}/5A（銘牌 ${nameplate}/5A）、極性正確——判定【合格】✓`
          : `${lbl}：${tl} 實測變比 ${measured}/5A 與銘牌 ${nameplate}/5A 偏差超過 5%——判定【不合格】✕`);
        return { ok: true, target: tl, pass: okR, measured_ratio: measured, nameplate };
      }
      if (kind === 'rts') {
        const ufW = buildUF('wires');
        const iNet = [ufW.find(tid(uid, 'I1')), ufW.find(tid(uid, 'I2'))];
        const ryP = st.parts.find(q => q.id === 'ry' &&
          [ufW.find(tid(q.uid, 'S1')), ufW.find(tid(q.uid, 'S2'))].some(n => iNet.includes(n)));
        if (!ryP) return { ok: false, error: 'I1/I2 沒有接到 RY51 的 S1/S2' };
        const tl = labelOf(ryP.uid, '').trim();
        const inj = pv('inject');
        const pickup = ryP.pickup !== undefined ? ryP.pickup : defOf(ryP).param.def;
        testLog(`${lbl}：對 ${tl} 注入 ${inj}A（一次換算，整定 ${pickup}A）⋯`);
        await delay(600);
        if (stale()) return { ok: false, error: '盤面已變更，試驗中止' };
        if (inj <= pickup) {
          inst.testMsg = '未動作（<整定）✓';
          testLog(`${lbl}：注入 ${inj}A ≤ 始動值 ${pickup}A，電驛不動作——低於整定不動作屬正常 ✓（要驗曲線請注入更大電流）`);
          return { ok: true, target: tl, pass: true, note: 'below-pickup' };
        }
        const M = inj / pickup;
        const expected = Math.min(30, Math.max(0.15, 0.2 * 3 / (M - 1)));
        const factor = ryP.defect === 'slow' ? 1.6 : (0.96 + Math.random() * 0.08);
        const measured = +(expected * factor).toFixed(2);
        await delay(Math.min(2500, expected * 1000));
        if (stale()) return { ok: false, error: '盤面已變更，試驗中止' };
        // 出口有接斷路器就真的跳給你看
        const tNet = [ufW.find(tid(ryP.uid, 'T1')), ufW.find(tid(ryP.uid, 'T2'))];
        const brk = st.parts.find(q => defOf(q).breaker &&
          [ufW.find(tid(q.uid, 'TC1')), ufW.find(tid(q.uid, 'TC2'))].some(n => tNet.includes(n)));
        if (brk && brk.on) { brk.tripped = true; brk.on = false; testLog(`${labelOf(brk.uid, '').trim()} 由電驛出口跳脫（試驗注入）⚡`); }
        const okT = Math.abs(measured - expected) / expected <= 0.10;
        inst.testMsg = `t=${measured}s ${okT ? '✓' : '✕'}`;
        testLog(okT
          ? `${lbl}：${tl} 於 ${measured}s 動作（曲線期望 ${expected.toFixed(2)}s，M=${M.toFixed(2)}）——判定【合格】✓`
          : `${lbl}：${tl} 於 ${measured}s 動作，偏離曲線期望 ${expected.toFixed(2)}s 超過 ±10%——判定【不合格】✕ 電驛需校驗或汰換。`);
        return { ok: true, target: tl, pass: okT, measured_s: measured, expected_s: +expected.toFixed(2) };
      }
      return { ok: false, error: '未知試驗器' };
    } finally {
      inst.testing = false;
      if (inst.testMsg === '試驗中⋯') inst.testMsg = 'READY';
      render();
      if (st.onSim) st.onSim();
    }
  }

  function injectDefect(uid) {
    const p = byUid(uid);
    if (!p) return { ok: false, error: '找不到元件' };
    const d = defOf(p);
    if (d.ctsig) p.defect = p.defect === null || p.defect === undefined ? 'polarity' : p.defect === 'polarity' ? 'ratio' : null;
    else if (p.id === 'ry') p.defect = p.defect ? null : 'slow';
    else if (INSUL[p.id] !== undefined) p.defect = p.defect ? null : 'insulation';
    else return { ok: false, error: `${labelOf(p.uid, '').trim()} 不支援缺陷注入` };
    pushLog(p.defect
      ? `💉 已對 ${labelOf(p.uid, '').trim()} 注入缺陷【${p.defect === 'insulation' ? '絕緣劣化' : p.defect === 'polarity' ? 'CT 極性反' : p.defect === 'ratio' ? '變比異常' : '動作遲緩'}】——試驗時會被抓出來。`
      : `✨ ${labelOf(p.uid, '').trim()} 缺陷已清除（設備健康）。`);
    render();
    if (st.onSim) st.onSim();
    return { ok: true, defect: p.defect };
  }

  /* Agent／模擬面板共用：設定元件參數 */
  function setParam(uid, value) {
    const p = byUid(uid);
    if (!p) return { ok: false, error: '找不到元件' };
    const pr = defOf(p).param;
    if (!pr) return { ok: false, error: `${labelOf(p.uid, '').trim()} 沒有可調參數` };
    const v = parseFloat(value);
    if (!(v >= pr.min && v <= pr.max)) return { ok: false, error: `${pr.name}需在 ${pr.min}–${pr.max} ${pr.unit} 之間` };
    p[pr.key] = Math.round(v * 10) / 10;
    if (st.running) render(); else changed();
    return { ok: true, param: pr.name, value: p[pr.key], unit: pr.unit };
  }

  /* ================= 操作 API ================= */
  function addPart(id) {
    const d = DEFS[id];
    if (!d) return { ok: false, error: '未知元件 ' + id };
    if (d.single && st.parts.some(p => p.id === id)) return { ok: false, error: d.name + ' 只能放一顆' };
    const row = d.row;
    let x = 30;
    for (const p of st.parts) {
      const pd = defOf(p);
      const pRow = p._row !== undefined ? p._row : pd.row;
      if (pRow === row) x = Math.max(x, p.x + pd.w + 42);
    }
    if (x + d.w > LW - 20) return { ok: false, error: '此列已無空間' };
    const np = { uid: st.uidSeq++, id, x, y: ROW_Y[row] - (row === 0 ? 0 : d.h - 46) };
    if (d.toggle) np.on = true;
    st.parts.push(np);
    changed();
    return { ok: true, part: d.name };
  }

  /* ================= 經典迴路範例庫（三級） ================= */
  const PRESETS = [
    // ── 基礎工配（丙級） ──
    { id: 'doorbell', tier: 'basic', name: '門鈴（按鈕直控）', desc: '第 0 課：按鈕 a 接點直接控制蜂鳴器——認識控制迴路與端子接線。' },
    { id: 'selfhold', tier: 'basic', name: '自保持啟動／停止', desc: 'START 吸持、STOP 釋放，MC 13-14 自保持——工配第一課。' },
    { id: 'jog', tier: 'basic', name: '寸動（點動）控制', desc: '按住 START 才轉、放開即停，無自保持迴路。' },
    { id: 'joghold', tier: 'basic', name: '寸動／連續切換（COS）', desc: 'COS 串在自保持迴路：位置 A＝連續運轉、位置 B＝寸動——一盤兩用。' },
    { id: 'twolamp', tier: 'basic', name: '運轉／停止指示燈', desc: '綠燈並聯線圈、紅燈經 MC 的 21-22 b 接點，吸持與釋放互換點亮。' },
    { id: 'twoplace', tier: 'basic', name: '兩處啟動／停止', desc: '兩顆 STOP 串聯、兩顆 START 並聯——雙地點都能控制。' },
    { id: 'mkpilot', tier: 'basic', name: 'MK 電驛中繼控制', desc: '按鈕先驅動 MK 小電驛自保持，再由 MK 的 a 接點帶動 MC——接點擴充的基本功。' },
    { id: 'delaystart', tier: 'basic', name: '暖機延時啟動（MK＋TR）', desc: 'START 後 MK 自保持、TR 開始計時，時間到才投入 MC——通電延時的標準應用。' },
    { id: 'seq', tier: 'basic', name: '順序啟動（兩台馬達）', desc: 'M2 啟動迴路取自 MC1 吸持節點，M1 未運轉時 M2 按了也不會動。' },
    { id: 'alarm', tier: 'basic', name: '過載警報（BZ＋紅燈）', desc: 'TH-RY 97-98 跳脫時蜂鳴器響＋紅燈亮。把馬達負載調到超過整定值，會「真的」熱跳脫。' },
    // ── 進階／電力配電（乙級・受電盤） ──
    { id: 'fwdrev', tier: 'adv', name: '正逆轉（電氣互鎖）', desc: '雙 MC 換相供電＋互鎖 b 接點；運轉中按反向不動作，STOP 後才能換向。' },
    { id: 'ydelta', tier: 'adv', name: 'Y-Δ 降壓啟動（TR 計時）', desc: '三顆 MC＋TR：星形降壓啟動，計時到自動換三角形全壓；MCS/MCD 互鎖。' },
    { id: 'seqdelay', tier: 'adv', name: '延時順序啟動（TR 接力）', desc: '按一次 START，M1 先起、TR 計時後 M2 自動跟上——輸送帶標準做法。' },
    { id: 'pumps', tier: 'adv', name: '雙泵選擇運轉（COS）', desc: 'COS 選 1 號泵或 2 號泵，各自獨立過載保護——交替使用平均磨損。' },
    { id: 'flasher', tier: 'adv', name: '閃爍警報（雙 TR 振盪）', desc: '兩顆 TR 互相計時形成振盪器，紅燈＋蜂鳴器規律閃響——故障警示迴路。' },
    { id: 'co51', tier: 'adv', name: '過電流保護（CO 51）', desc: '受電盤等級保護：CO 電驛串主迴路＋AM 電流表。把馬達負載調超過整定值看它跳脫。' },
    { id: 'meterpanel', tier: 'adv', name: '受電儀表盤（VM／AM／TX）', desc: 'FUSE 受電＋電壓表＋電流表＋控制變壓器帶受電指示燈——量測的基本盤。' },
    { id: 'capbank', tier: 'adv', name: '功因改善電容器組', desc: 'COS 控制 MC 投切 SC 電容器組，功因 0.72→0.98——電費的秘密。' },
    { id: 'ats1', tier: 'adv', name: '停電自動切換（ATS＋GEN）', desc: '市電→ATS→馬達；模擬停電後發電機 AMF 自起、ATS 切備用、復電切回——電力公司等級。' },
    { id: 'ats2', tier: 'adv', name: '受電盤總和演練（ATS＋TX＋儀表）', desc: '全套：NFB 受電、ATS 雙電源、TX 控制電源取自 ATS 之後、MC 自保持、VM/AM 量測。' },
    // ── 高壓受電（11.4kV） ──
    { id: 'hv_std', tier: 'hv', name: '標準高壓受電單線', desc: '台電 11.4kV→LA→DS→VCB→CT→變壓器→NFB→負載，RY51 過電流保護——高壓用戶的標準受電構成。' },
    { id: 'hv_seq', tier: 'hv', name: '停送電操作演練', desc: 'DS/VCB 全開狀態起步：送電先合 DS 再合 VCB；停電先開 VCB 再開 DS。順序做錯會出事（見下一題）。' },
    { id: 'hv_arc', tier: 'hv', name: '事故重現：帶載拉 DS', desc: '負面教材：運轉中直接開斷 DS——隔離開關沒有滅弧能力，看弧光事故怎麼發生。' },
    { id: 'hv_relay', tier: 'hv', name: 'RY51 反時限保護', desc: '馬達預設 20A 過載：通電後看電驛啟動→計時→跳 VCB。把始動電流或負載調大調小，跳脫時間跟著變。' },
    { id: 'hv_pf', tier: 'hv', name: '簡易受電（LBS＋PF）', desc: '小容量用戶標準配置：負載啟斷開關＋電力熔絲取代 VCB＋電驛。' },
    { id: 'hv_fuse', tier: 'hv', name: 'PF 熔斷保護', desc: '馬達 20A 過載＋熔絲額定 0.5A：通電即熔斷，到模擬面板更換熔絲筒再送電。' },
    { id: 'hv_pt', tier: 'hv', name: 'PT 控制電源＋受電指示', desc: 'PT 從高壓側取 110V：受電指示燈電源不靠低壓側——高壓盤的標準做法。' },
    { id: 'hv_2tr', tier: 'hv', name: '雙變壓器分列運轉', desc: '一路高壓進線、兩台變壓器各帶一段低壓母線——重要負載分段供電。' },
    { id: 'hv_atsgen', tier: 'hv', name: '高壓停電＋ATS/GEN 聯動', desc: '台電高壓停電→發電機 AMF 自起→低壓 ATS 切備用；復電自動切回——全鏈路演練。' },
    { id: 'hv_full', tier: 'hv', name: '受電盤總和演練', desc: '全套：DS/VCB/CT/RY51/變壓器/NFB/MC 自保持/VM——從 11.4kV 到馬達啟停一氣呵成。' },
    { id: 'ehv_161', tier: 'hv', name: '161kV 特高壓受電（串級）', desc: '科技廠等級：161kV→DS→GCB→CT→主變 11.4kV→VCB→配電變壓器→380V 馬達——三級電壓一氣串起。' },
    { id: 'ehv_345', tier: 'hv', name: '345kV E/S 超高壓變電所', desc: '345kV 輸電→GCB345→聯絡主變 161kV→GCB161→主變 11.4kV→配電變壓器→馬達：四級電壓完整串級。' },
    { id: 'ehv_seq', tier: 'hv', name: '161kV 停送電順序演練', desc: '全開狀態起步：由電源側往負載側 DS-161→GCB-161→VCB 逐級投入；停電反向操作。' },
    { id: 'ehv_arc', tier: 'hv', name: '事故重現：161kV 帶載拉 DS', desc: '特高壓帶載開斷的弧光比 11.4kV 更劇烈——負面教材，運轉中拉 DS-161 看後果。' },
    { id: 'ehv_relay', tier: 'hv', name: '161kV CT＋RY51 保護', desc: '特高壓側電流極小（÷424）：CT-161 讀值、始動 0.03A 一次、反時限跳 GCB——整定換算的教學。' },
    // ── 設備試驗（竣工／維護） ──
    { id: 'test_meg_motor', tier: 'test', name: '馬達絕緣電阻測試', desc: '第一課：Megger L 探棒接馬達、E 接地，1000V 測絕緣——低壓設備 ≥1MΩ 合格。' },
    { id: 'test_meg_bad', tier: 'test', name: '缺陷判讀：受潮馬達', desc: '這顆馬達已注入絕緣劣化（💉）：跑一次測試看「不合格」判定長什麼樣，再清除缺陷重測對照。' },
    { id: 'test_meg_tr', tier: 'test', name: '變壓器絕緣測試（高壓級）', desc: '11.4kV 配電變壓器：判定門檻提高到 ≥10MΩ——電壓等級越高要求越嚴。' },
    { id: 'test_hipot_tr', tier: 'test', name: '變壓器 AC 耐壓試驗', desc: '升壓 22kV 保持一分鐘（模擬加速）、看洩漏電流——竣工送電前的最後關卡。' },
    { id: 'test_hipot_bad', tier: 'test', name: '耐壓崩潰重現', desc: '受試變壓器已注入缺陷：升壓到一半就閃絡給你看——這就是為什麼耐壓前要先量絕緣電阻。' },
    { id: 'test_ct_ratio', tier: 'test', name: 'CT 變比試驗', desc: '一次注入 10A、量二次輸出：實測變比與銘牌比對（±5%）。' },
    { id: 'test_ct_bad', tier: 'test', name: '缺陷判讀：CT 極性反', desc: '這顆 CT 的 k/l 接反了（💉）：測試會抓出極性錯誤——接反的 CT 會讓保護誤動作。' },
    { id: 'test_relay_inject', tier: 'test', name: 'RY51 注入測試', desc: '注入 1A（整定 0.5A、M=2）：量實際動作時間與反時限曲線比對 ±10%；出口接著 VCB 會真的跳。' },
    { id: 'test_relay_bad', tier: 'test', name: '缺陷判讀：電驛動作遲緩', desc: '這顆電驛已注入「動作遲緩」（💉）：實測時間偏離曲線 60%——校驗不合格的典型樣態。' },
    { id: 'test_full', tier: 'test', name: '竣工試驗總和演練', desc: '完整試驗台：Megger＋CT 測試器＋電驛測試器對整組受電設備逐項驗收——全部合格才能送電。' },
    // ── PLC 可程式控制 ──
    { id: 'plc_selfhold', tier: 'plc', name: 'PLC 自保持（梯形圖）', desc: '按鈕接 PLC 輸入、Y0 驅動 MC：自保持邏輯寫在梯形圖裡，雙擊 PLC 開編輯器。' },
    { id: 'plc_jog', tier: 'plc', name: 'PLC 寸動', desc: '最小程式：X0 常開直通 Y0——按著才轉。跟硬體寸動對照。' },
    { id: 'plc_timer', tier: 'plc', name: 'PLC 延時啟動（TON）', desc: 'START 後綠燈先亮、TON 計時 3 秒才投入馬達——TR 的程式化版本。' },
    { id: 'plc_counter', tier: 'plc', name: 'PLC 計數啟動（CTU）', desc: '按 START 三次才啟動馬達，STOP 復歸計數——計數器與 RST 的用法。' },
    { id: 'plc_flash', tier: 'plc', name: 'PLC 交替閃爍（雙 TON）', desc: '兩顆 TON 互鎖成振盪器，綠紅燈輪流亮——看板燈／警示燈程式。' },
    { id: 'plc_fwdrev', tier: 'plc', name: 'PLC 正逆轉（程式＋硬體互鎖）', desc: 'X0 正轉、X1 逆轉、X2 停止；程式互鎖＋MC 21-22 硬體互鎖雙保險。' },
    { id: 'plc_seq', tier: 'plc', name: 'PLC 順序啟動（TON 接力）', desc: '一鍵啟動：M1 即起、TON 3 秒後 M2 自動跟上。' },
    { id: 'plc_ydelta', tier: 'plc', name: 'PLC 控制 Y-Δ 啟動', desc: 'PLC 三個輸出帶 MCM/MCS/MCD，TON 控制星角切換時機；硬體互鎖保留。' },
    { id: 'plc_conveyor', tier: 'plc', name: 'PLC 輸送帶（雙向延時）', desc: '啟動：M1 先轉、M2 延時 2 秒跟上；停止：M2 先停、M1 延時 2 秒才停——防止物料堆積。' },
    { id: 'plc_alarm', tier: 'plc', name: 'PLC 過載斷續警報', desc: 'TH-RY 97-98 接 X2：跳脫即停機，蜂鳴器以 0.5 秒斷續鳴響＋紅燈——雙 TON 節拍器。' }
  ];

  function loadPreset(pid) {
    if (!PRESETS.some(x => x.id === pid)) return { ok: false, error: '未知範例 ' + pid };
    st.parts = [];
    st.wires = [];
    st.uidSeq = 1;
    st.gen = (st.gen || 0) + 1;   // 世代序號：讓進行中的 runTest 失效
    if (window.CF && CF.Plc && !pid.startsWith('plc_')) CF.Plc.setProgram({ rungs: [] });
    ensureSource();
    const S = st.parts[0].uid;
    const A = id => addPartSilent(id);
    const W = (au, at, bu, bt) => st.wires.push({ uid: st.uidSeq++, a: { uid: au, term: at }, b: { uid: bu, term: bt } });
    // 單 MC 標準主迴路：R/S/T → NFB → MC → TH-RY → 馬達
    const mainChain = (N, M, H, MO) => {
      W(S, 'R', N, '1'); W(S, 'S', N, '3'); W(S, 'T', N, '5');
      W(N, '2', M, '1'); W(N, '4', M, '3'); W(N, '6', M, '5');
      W(M, '2', H, '1'); W(M, '4', H, '3'); W(M, '6', H, '5');
      W(H, '2', MO, 'U'); W(H, '4', MO, 'V'); W(H, '6', MO, 'W');
    };

    if (pid === 'selfhold' || pid === 'twolamp') {
      const N = A('nfb'), M = A('mc'), H = A('thry'), ST = A('pb_nc'), GO = A('pb_no'), PL = A('pl_g');
      const PR = pid === 'twolamp' ? A('pl_r') : null;
      const MO = A('motor');
      mainChain(N, M, H, MO);
      W(S, 'C1', ST, '1'); W(ST, '2', GO, '3'); W(GO, '4', M, 'A1');
      W(M, 'A2', H, '95'); W(H, '96', S, 'C2');
      W(M, '13', GO, '3'); W(M, '14', GO, '4');
      W(PL, 'X1', M, 'A1'); W(PL, 'X2', M, 'A2');
      if (PR) { W(S, 'C1', M, '21'); W(M, '22', PR, 'X1'); W(PR, 'X2', S, 'C2'); }
    } else if (pid === 'jog') {
      const N = A('nfb'), M = A('mc'), H = A('thry'), GO = A('pb_no'), MO = A('motor');
      mainChain(N, M, H, MO);
      W(S, 'C1', GO, '3'); W(GO, '4', M, 'A1');
      W(M, 'A2', H, '95'); W(H, '96', S, 'C2');
    } else if (pid === 'twoplace') {
      const N = A('nfb'), M = A('mc'), H = A('thry');
      const ST1 = A('pb_nc'), ST2 = A('pb_nc'), GO1 = A('pb_no'), GO2 = A('pb_no');
      const MO = A('motor');
      mainChain(N, M, H, MO);
      W(S, 'C1', ST1, '1'); W(ST1, '2', ST2, '1'); W(ST2, '2', GO1, '3');
      W(GO1, '3', GO2, '3'); W(GO1, '4', GO2, '4');       // START 並聯
      W(GO1, '4', M, 'A1');
      W(M, '13', GO1, '3'); W(M, '14', GO1, '4');          // 自保持
      W(M, 'A2', H, '95'); W(H, '96', S, 'C2');
    } else if (pid === 'fwdrev') {
      const N = A('nfb'), MF = A('mc'), MR = A('mc'), H = A('thry');
      const ST = A('pb_nc'), GOF = A('pb_no'), GOR = A('pb_no'), MO = A('motor');
      W(S, 'R', N, '1'); W(S, 'S', N, '3'); W(S, 'T', N, '5');
      // MF 正相、MR 換 R↔T 相
      W(N, '2', MF, '1'); W(N, '4', MF, '3'); W(N, '6', MF, '5');
      W(N, '6', MR, '1'); W(N, '4', MR, '3'); W(N, '2', MR, '5');
      // 兩 MC 輸出併聯後進 TH-RY
      W(MF, '2', H, '1'); W(MF, '4', H, '3'); W(MF, '6', H, '5');
      W(MR, '2', H, '1'); W(MR, '4', H, '3'); W(MR, '6', H, '5');
      W(H, '2', MO, 'U'); W(H, '4', MO, 'V'); W(H, '6', MO, 'W');
      // 控制：STOP 共用，FWD/REV 各自啟動，互經對方 21-22（電氣互鎖）
      W(S, 'C1', ST, '1');
      W(ST, '2', GOF, '3'); W(ST, '2', GOR, '3');
      W(GOF, '4', MR, '21'); W(MR, '22', MF, 'A1');
      W(GOR, '4', MF, '21'); W(MF, '22', MR, 'A1');
      W(MF, 'A2', H, '95'); W(MR, 'A2', H, '95'); W(H, '96', S, 'C2');
      W(MF, '13', GOF, '3'); W(MF, '14', GOF, '4');
      W(MR, '13', GOR, '3'); W(MR, '14', GOR, '4');
    } else if (pid === 'seq') {
      const N = A('nfb'), M1 = A('mc'), M2 = A('mc'), H1 = A('thry'), H2 = A('thry');
      const ST = A('pb_nc'), GO1 = A('pb_no'), GO2 = A('pb_no');
      const MO1 = A('motor'), MO2 = A('motor');
      W(S, 'R', N, '1'); W(S, 'S', N, '3'); W(S, 'T', N, '5');
      W(N, '2', M1, '1'); W(N, '4', M1, '3'); W(N, '6', M1, '5');
      W(N, '2', M2, '1'); W(N, '4', M2, '3'); W(N, '6', M2, '5');
      W(M1, '2', H1, '1'); W(M1, '4', H1, '3'); W(M1, '6', H1, '5');
      W(H1, '2', MO1, 'U'); W(H1, '4', MO1, 'V'); W(H1, '6', MO1, 'W');
      W(M2, '2', H2, '1'); W(M2, '4', H2, '3'); W(M2, '6', H2, '5');
      W(H2, '2', MO2, 'U'); W(H2, '4', MO2, 'V'); W(H2, '6', MO2, 'W');
      // 控制：M2 的啟動電源取自 M1 吸持節點（GO1.4）
      W(S, 'C1', ST, '1'); W(ST, '2', GO1, '3');
      W(GO1, '4', M1, 'A1'); W(M1, '13', GO1, '3'); W(M1, '14', GO1, '4');
      W(M1, 'A2', H1, '95'); W(H1, '96', S, 'C2');
      W(GO1, '4', GO2, '3');
      W(GO2, '4', M2, 'A1'); W(M2, '13', GO2, '3'); W(M2, '14', GO2, '4');
      W(M2, 'A2', H2, '95'); W(H2, '96', S, 'C2');
    } else if (pid === 'ydelta') {
      const N = A('nfb'), MM = A('mc'), MS = A('mc'), MD = A('mc'), H = A('thry'), TR = A('tr');
      const ST = A('pb_nc'), GO = A('pb_no'), MO = A('motor6');
      // 主 MC：R/S/T → NFB → MCM → TH-RY → U1/V1/W1
      W(S, 'R', N, '1'); W(S, 'S', N, '3'); W(S, 'T', N, '5');
      W(N, '2', MM, '1'); W(N, '4', MM, '3'); W(N, '6', MM, '5');
      W(MM, '2', H, '1'); W(MM, '4', H, '3'); W(MM, '6', H, '5');
      W(H, '2', MO, 'U1'); W(H, '4', MO, 'V1'); W(H, '6', MO, 'W1');
      // Δ MC：換相供 U2/V2/W2（U2←S、V2←T、W2←R，讓每組繞組吃到線電壓）
      W(N, '2', MD, '1'); W(N, '4', MD, '3'); W(N, '6', MD, '5');
      W(MD, '4', MO, 'U2'); W(MD, '6', MO, 'V2'); W(MD, '2', MO, 'W2');
      // Y MC：U2/V2/W2 → MCS，出線側短接成星點
      W(MO, 'U2', MS, '1'); W(MO, 'V2', MS, '3'); W(MO, 'W2', MS, '5');
      W(MS, '2', MS, '4'); W(MS, '4', MS, '6');
      // 控制：START 自保持 → MM＋TR；TR 55-56（延時b）→ MCS、67-68（延時a）→ MCD；MCS/MCD 互鎖
      W(S, 'C1', ST, '1'); W(ST, '2', GO, '3'); W(GO, '4', MM, 'A1');
      W(MM, '13', GO, '3'); W(MM, '14', GO, '4');
      W(MM, 'A2', H, '95'); W(H, '96', S, 'C2');
      W(GO, '4', TR, 'A1'); W(TR, 'A2', H, '95');
      W(GO, '4', TR, '55'); W(TR, '56', MD, '21'); W(MD, '22', MS, 'A1'); W(MS, 'A2', H, '95');
      W(GO, '4', TR, '67'); W(TR, '68', MS, '21'); W(MS, '22', MD, 'A1'); W(MD, 'A2', H, '95');
    } else if (pid === 'alarm') {
      const N = A('nfb'), M = A('mc'), H = A('thry'), ST = A('pb_nc'), GO = A('pb_no');
      const PL = A('pl_g'), PR = A('pl_r'), BZ = A('bz'), MO = A('motor');
      mainChain(N, M, H, MO);
      W(S, 'C1', ST, '1'); W(ST, '2', GO, '3'); W(GO, '4', M, 'A1');
      W(M, 'A2', H, '95'); W(H, '96', S, 'C2');
      W(M, '13', GO, '3'); W(M, '14', GO, '4');
      W(PL, 'X1', M, 'A1'); W(PL, 'X2', M, 'A2');
      // 過載警報：TH-RY 97-98（跳脫時閉合）→ BZ＋紅燈
      W(S, 'C1', H, '97'); W(H, '98', BZ, 'X1'); W(BZ, 'X2', S, 'C2');
      W(H, '98', PR, 'X1'); W(PR, 'X2', S, 'C2');
    } else if (pid === 'plc_selfhold' || pid === 'plc_timer') {
      const N = A('nfb'), P = A('plc'), M = A('mc'), H = A('thry');
      const ST = A('pb_nc'), GO = A('pb_no'), MO = A('motor');
      const PL = pid === 'plc_timer' ? A('pl_g') : null;
      mainChain(N, M, H, MO);
      W(S, 'C1', P, 'L'); W(P, 'N', S, 'C2');            // PLC 電源
      W(P, 'COM', GO, '3'); W(GO, '4', P, 'X0');         // START(a) → X0
      W(P, 'COM', ST, '1'); W(ST, '2', P, 'X1');         // STOP(b) → X1（未按＝ON）
      W(S, 'C1', P, 'C0'); W(P, 'Y0', M, 'A1');          // Y0 → MC 線圈
      W(M, 'A2', H, '95'); W(H, '96', S, 'C2');
      if (PL) { W(P, 'Y1', PL, 'X1'); W(PL, 'X2', S, 'C2'); }
      if (window.CF && CF.Plc) {
        CF.Plc.setProgram(pid === 'plc_selfhold'
          ? { rungs: [
              { cols: [[{ t: 'no', addr: 'X0' }, { t: 'no', addr: 'Y0' }], [{ t: 'no', addr: 'X1' }, null]], coil: { t: 'out', addr: 'Y0' } }
            ] }
          : { rungs: [
              { cols: [[{ t: 'no', addr: 'X0' }, { t: 'no', addr: 'M0' }], [{ t: 'no', addr: 'X1' }, null]], coil: { t: 'out', addr: 'M0' } },
              { cols: [[{ t: 'no', addr: 'M0' }, null]], coil: { t: 'ton', addr: 'T0', preset: 3 } },
              { cols: [[{ t: 'no', addr: 'M0' }, null], [{ t: 'nc', addr: 'T0' }, null]], coil: { t: 'out', addr: 'Y1' } },
              { cols: [[{ t: 'no', addr: 'T0' }, null]], coil: { t: 'out', addr: 'Y0' } }
            ] });
      }
    } else if (pid === 'doorbell') {
      const GO = A('pb_no'), BZ = A('bz');
      W(S, 'C1', GO, '3'); W(GO, '4', BZ, 'X1'); W(BZ, 'X2', S, 'C2');
    } else if (pid === 'joghold') {
      const N = A('nfb'), M = A('mc'), H = A('thry'), ST = A('pb_nc'), GO = A('pb_no'), CS = A('cos'), MO = A('motor');
      mainChain(N, M, H, MO);
      W(S, 'C1', ST, '1'); W(ST, '2', GO, '3'); W(GO, '4', M, 'A1');
      W(M, 'A2', H, '95'); W(H, '96', S, 'C2');
      // 自保持迴路經 COS 位置 A（1-2）：切到 B 即變寸動
      W(M, '13', GO, '3'); W(M, '14', CS, '1'); W(CS, '2', GO, '4');
    } else if (pid === 'mkpilot') {
      const N = A('nfb'), M = A('mc'), MK = A('mk'), H = A('thry'), ST = A('pb_nc'), GO = A('pb_no'), MO = A('motor');
      mainChain(N, M, H, MO);
      W(S, 'C1', ST, '1'); W(ST, '2', GO, '3'); W(GO, '4', MK, 'A1'); W(MK, 'A2', S, 'C2');
      W(MK, '13', GO, '3'); W(MK, '14', GO, '4');            // MK 自保持
      W(S, 'C1', MK, '23'); W(MK, '24', M, 'A1');            // MK a 接點帶 MC
      W(M, 'A2', H, '95'); W(H, '96', S, 'C2');
    } else if (pid === 'delaystart') {
      const N = A('nfb'), M = A('mc'), MK = A('mk'), TR = A('tr'), H = A('thry'), ST = A('pb_nc'), GO = A('pb_no'), PL = A('pl_g'), MO = A('motor');
      mainChain(N, M, H, MO);
      W(S, 'C1', ST, '1'); W(ST, '2', GO, '3');
      W(GO, '4', MK, 'A1'); W(MK, 'A2', H, '95'); W(H, '96', S, 'C2');
      W(MK, '13', GO, '3'); W(MK, '14', GO, '4');            // MK 自保持撐住整條
      W(GO, '4', TR, 'A1'); W(TR, 'A2', H, '95');            // TR 同時開始計時
      W(GO, '4', TR, '67'); W(TR, '68', M, 'A1');            // 時間到才投入 MC
      W(M, 'A2', H, '95');
      W(PL, 'X1', M, 'A1'); W(PL, 'X2', M, 'A2');
    } else if (pid === 'seqdelay') {
      const N = A('nfb'), M1 = A('mc'), M2 = A('mc'), TR = A('tr'), H1 = A('thry'), H2 = A('thry');
      const ST = A('pb_nc'), GO = A('pb_no'), MO1 = A('motor'), MO2 = A('motor');
      W(S, 'R', N, '1'); W(S, 'S', N, '3'); W(S, 'T', N, '5');
      W(N, '2', M1, '1'); W(N, '4', M1, '3'); W(N, '6', M1, '5');
      W(N, '2', M2, '1'); W(N, '4', M2, '3'); W(N, '6', M2, '5');
      W(M1, '2', H1, '1'); W(M1, '4', H1, '3'); W(M1, '6', H1, '5');
      W(H1, '2', MO1, 'U'); W(H1, '4', MO1, 'V'); W(H1, '6', MO1, 'W');
      W(M2, '2', H2, '1'); W(M2, '4', H2, '3'); W(M2, '6', H2, '5');
      W(H2, '2', MO2, 'U'); W(H2, '4', MO2, 'V'); W(H2, '6', MO2, 'W');
      W(S, 'C1', ST, '1'); W(ST, '2', GO, '3'); W(GO, '4', M1, 'A1');
      W(M1, '13', GO, '3'); W(M1, '14', GO, '4');
      W(M1, 'A2', H1, '95'); W(H1, '96', S, 'C2');
      W(GO, '4', TR, 'A1'); W(TR, 'A2', H1, '95');
      W(GO, '4', TR, '67'); W(TR, '68', M2, 'A1');
      W(M2, 'A2', H2, '95'); W(H2, '96', S, 'C2');
    } else if (pid === 'pumps') {
      const N = A('nfb'), M1 = A('mc'), M2 = A('mc'), H1 = A('thry'), H2 = A('thry');
      const ST = A('pb_nc'), CS = A('cos'), MO1 = A('motor'), MO2 = A('motor');
      W(S, 'R', N, '1'); W(S, 'S', N, '3'); W(S, 'T', N, '5');
      W(N, '2', M1, '1'); W(N, '4', M1, '3'); W(N, '6', M1, '5');
      W(N, '2', M2, '1'); W(N, '4', M2, '3'); W(N, '6', M2, '5');
      W(M1, '2', H1, '1'); W(M1, '4', H1, '3'); W(M1, '6', H1, '5');
      W(H1, '2', MO1, 'U'); W(H1, '4', MO1, 'V'); W(H1, '6', MO1, 'W');
      W(M2, '2', H2, '1'); W(M2, '4', H2, '3'); W(M2, '6', H2, '5');
      W(H2, '2', MO2, 'U'); W(H2, '4', MO2, 'V'); W(H2, '6', MO2, 'W');
      W(S, 'C1', ST, '1'); W(ST, '2', CS, '1'); W(ST, '2', CS, '3');
      W(CS, '2', M1, 'A1'); W(M1, 'A2', H1, '95'); W(H1, '96', S, 'C2');
      W(CS, '4', M2, 'A1'); W(M2, 'A2', H2, '95'); W(H2, '96', S, 'C2');
    } else if (pid === 'flasher') {
      const T1 = A('tr'), T2 = A('tr'), CS = A('cos'), RL = A('pl_r'), BZ = A('bz');
      byUid(T1).preset = 0.6; byUid(T2).preset = 0.6;
      W(S, 'C1', CS, '1');
      W(CS, '2', T2, '55'); W(T2, '56', T1, 'A1'); W(T1, 'A2', S, 'C2');   // TR1 經 TR2 延時 b
      W(CS, '2', T1, '67'); W(T1, '68', T2, 'A1'); W(T2, 'A2', S, 'C2');   // TR2 經 TR1 延時 a
      W(RL, 'X1', T1, '68'); W(RL, 'X2', S, 'C2');
      W(BZ, 'X1', T1, '68'); W(BZ, 'X2', S, 'C2');
    } else if (pid === 'co51') {
      const FU = A('fuse'), CO = A('co'), M = A('mc'), AMm = A('am'), VMm = A('vm');
      const ST = A('pb_nc'), GO = A('pb_no'), BZ = A('bz'), RL = A('pl_r'), MO = A('motor');
      W(S, 'R', FU, '1'); W(S, 'S', FU, '3'); W(S, 'T', FU, '5');
      W(FU, '2', CO, '1'); W(FU, '4', CO, '3'); W(FU, '6', CO, '5');
      W(CO, '2', AMm, '1'); W(AMm, '2', M, '1');
      W(CO, '4', M, '3'); W(CO, '6', M, '5');
      W(M, '2', MO, 'U'); W(M, '4', MO, 'V'); W(M, '6', MO, 'W');
      W(VMm, 'P1', CO, '2'); W(VMm, 'P2', CO, '4');
      W(S, 'C1', ST, '1'); W(ST, '2', GO, '3'); W(GO, '4', M, 'A1');
      W(M, '13', GO, '3'); W(M, '14', GO, '4');
      W(M, 'A2', CO, '95'); W(CO, '96', S, 'C2');
      W(S, 'C1', CO, '97'); W(CO, '98', BZ, 'X1'); W(BZ, 'X2', S, 'C2');
      W(CO, '98', RL, 'X1'); W(RL, 'X2', S, 'C2');
    } else if (pid === 'meterpanel') {
      const FU = A('fuse'), TX = A('tx'), VMm = A('vm'), AMm = A('am'), SC = A('sc'), GL = A('pl_g');
      W(S, 'R', FU, '1'); W(S, 'S', FU, '3'); W(S, 'T', FU, '5');
      W(FU, '2', AMm, '1'); W(AMm, '2', SC, 'U');
      W(FU, '4', SC, 'V'); W(FU, '6', SC, 'W');
      W(VMm, 'P1', FU, '2'); W(VMm, 'P2', FU, '4');
      W(TX, 'P1', FU, '2'); W(TX, 'P2', FU, '4');
      W(TX, 'S1', GL, 'X1'); W(GL, 'X2', TX, 'S2');
    } else if (pid === 'capbank') {
      const N = A('nfb'), M = A('mc'), SC = A('sc'), CS = A('cos'), GL = A('pl_g');
      W(S, 'R', N, '1'); W(S, 'S', N, '3'); W(S, 'T', N, '5');
      W(N, '2', M, '1'); W(N, '4', M, '3'); W(N, '6', M, '5');
      W(M, '2', SC, 'U'); W(M, '4', SC, 'V'); W(M, '6', SC, 'W');
      W(S, 'C1', CS, '3'); W(CS, '4', M, 'A1'); W(M, 'A2', S, 'C2');   // COS 切到 B 即投入
      W(GL, 'X1', M, 'A1'); W(GL, 'X2', M, 'A2');
    } else if (pid === 'ats1') {
      const N = A('nfb'), AT = A('ats'), G = A('gen'), H = A('thry'), VMm = A('vm'), MO = A('motor');
      W(S, 'R', N, '1'); W(S, 'S', N, '3'); W(S, 'T', N, '5');
      W(N, '2', AT, '1'); W(N, '4', AT, '3'); W(N, '6', AT, '5');
      W(G, 'GR', AT, '7'); W(G, 'GS', AT, '9'); W(G, 'GT', AT, '11');
      W(AT, '2', H, '1'); W(AT, '4', H, '3'); W(AT, '6', H, '5');
      W(H, '2', MO, 'U'); W(H, '4', MO, 'V'); W(H, '6', MO, 'W');
      W(VMm, 'P1', AT, '2'); W(VMm, 'P2', AT, '4');
    } else if (pid === 'ats2') {
      const N = A('nfb'), AT = A('ats'), G = A('gen'), TX = A('tx'), M = A('mc'), H = A('thry');
      const ST = A('pb_nc'), GO = A('pb_no'), VMm = A('vm'), AMm = A('am'), GL = A('pl_g'), MO = A('motor');
      W(S, 'R', N, '1'); W(S, 'S', N, '3'); W(S, 'T', N, '5');
      W(N, '2', AT, '1'); W(N, '4', AT, '3'); W(N, '6', AT, '5');
      W(G, 'GR', AT, '7'); W(G, 'GS', AT, '9'); W(G, 'GT', AT, '11');
      W(AT, '2', AMm, '1'); W(AMm, '2', M, '1');
      W(AT, '4', M, '3'); W(AT, '6', M, '5');
      W(M, '2', H, '1'); W(M, '4', H, '3'); W(M, '6', H, '5');
      W(H, '2', MO, 'U'); W(H, '4', MO, 'V'); W(H, '6', MO, 'W');
      W(TX, 'P1', AT, '2'); W(TX, 'P2', AT, '4');            // 控制電源取自 ATS 之後
      W(VMm, 'P1', AT, '2'); W(VMm, 'P2', AT, '4');
      W(TX, 'S1', ST, '1'); W(ST, '2', GO, '3'); W(GO, '4', M, 'A1');
      W(M, '13', GO, '3'); W(M, '14', GO, '4');
      W(M, 'A2', H, '95'); W(H, '96', TX, 'S2');
      W(GL, 'X1', M, 'A1'); W(GL, 'X2', M, 'A2');
    } else if (pid.startsWith('test_')) {
      const G = A('gnd');
      if (pid === 'test_meg_motor' || pid === 'test_meg_bad') {
        const M = A('meg'), MO = A('motor');
        W(M, 'L', MO, 'U'); W(M, 'E', G, 'G1');
        if (pid === 'test_meg_bad') byUid(MO).defect = 'insulation';
      } else if (pid === 'test_meg_tr') {
        const M = A('meg'), T = A('hvtr');
        W(M, 'L', T, '1'); W(M, 'E', G, 'G1');
        byUid(M).volt = 5000;
      } else if (pid === 'test_hipot_tr' || pid === 'test_hipot_bad') {
        const H = A('hipot'), T = A('hvtr');
        W(H, 'H', T, '1'); W(H, 'R', G, 'G1');
        if (pid === 'test_hipot_bad') byUid(T).defect = 'insulation';
      } else if (pid === 'test_ct_ratio' || pid === 'test_ct_bad') {
        const C = A('ctt'), T = A('cthv');
        W(C, 'P1', T, '1'); W(C, 'P2', T, '2');
        W(C, 'S1', T, 'k'); W(C, 'S2', T, 'l');
        if (pid === 'test_ct_bad') byUid(T).defect = 'polarity';
      } else if (pid === 'test_relay_inject' || pid === 'test_relay_bad') {
        const R = A('rts'), RY = A('ry'), V = A('vcb');
        W(R, 'I1', RY, 'S1'); W(R, 'I2', RY, 'S2');
        W(RY, 'T1', V, 'TC1'); W(RY, 'T2', V, 'TC2');
        byUid(V).on = true;
        byUid(R).inject = 1;
        if (pid === 'test_relay_bad') byUid(RY).defect = 'slow';
      } else if (pid === 'test_full') {
        const M = A('meg'), C = A('ctt'), R = A('rts');
        const T = A('hvtr'), CT2 = A('cthv'), RY = A('ry'), V = A('vcb'), MO = A('motor');
        W(M, 'L', T, '1'); W(M, 'E', G, 'G1');
        W(C, 'P1', CT2, '1'); W(C, 'P2', CT2, '2'); W(C, 'S1', CT2, 'k'); W(C, 'S2', CT2, 'l');
        W(R, 'I1', RY, 'S1'); W(R, 'I2', RY, 'S2');
        W(RY, 'T1', V, 'TC1'); W(RY, 'T2', V, 'TC2');
        byUid(V).on = true;
        byUid(R).inject = 1;
        void MO;
      }
    } else if (pid.startsWith('ehv_')) {
      // 161kV 串級：161→(DS161→GCB161→CT161)→MTX161→11.4kV→(VCB)→HVTR→380V→NFB→馬達
      const chain161 = closed => {
        const E = A('ehvin161'), D = A('ds161'), G = A('gcb161'), C = A('ct161'), MX = A('mtx161');
        const V = addPartSilent('vcb', 1), T = addPartSilent('hvtr', 1), N = addPartSilent('nfb', 1);
        const MO = A('motor'), R = A('ry');
        W(E, 'E1', D, '1'); W(E, 'E2', D, '3'); W(E, 'E3', D, '5');
        W(D, '2', G, '1'); W(D, '4', G, '3'); W(D, '6', G, '5');
        W(G, '2', C, '1'); W(G, '4', C, '3'); W(G, '6', C, '5');
        W(C, '2', MX, '1'); W(C, '4', MX, '3'); W(C, '6', MX, '5');
        W(MX, '2', V, '1'); W(MX, '4', V, '3'); W(MX, '6', V, '5');
        W(V, '2', T, '1'); W(V, '4', T, '3'); W(V, '6', T, '5');
        W(T, '2', N, '1'); W(T, '4', N, '3'); W(T, '6', N, '5');
        W(N, '2', MO, 'U'); W(N, '4', MO, 'V'); W(N, '6', MO, 'W');
        W(C, 'k', R, 'S1'); W(C, 'l', R, 'S2');
        W(R, 'T1', G, 'TC1'); W(R, 'T2', G, 'TC2');
        byUid(R).pickup = 0.03;
        if (closed) { byUid(D).on = true; byUid(G).on = true; byUid(V).on = true; }
        return { D, G, C, MX, V, T, N, MO, R };
      };
      if (pid === 'ehv_161' || pid === 'ehv_seq' || pid === 'ehv_arc' || pid === 'ehv_relay') {
        const c = chain161(pid !== 'ehv_seq');
        if (pid === 'ehv_relay') byUid(c.MO).loadA = 20;
      } else if (pid === 'ehv_345') {
        const U = A('ehvin345'), D3 = A('ds345'), G3 = A('gcb345'), M3 = A('mtx345');
        const G1 = addPartSilent('gcb161', 1), M1 = addPartSilent('mtx161', 1), V = addPartSilent('vcb', 1), T = addPartSilent('hvtr', 1), N = addPartSilent('nfb', 1);
        const MO = A('motor');
        W(U, 'U1', D3, '1'); W(U, 'U2', D3, '3'); W(U, 'U3', D3, '5');
        W(D3, '2', G3, '1'); W(D3, '4', G3, '3'); W(D3, '6', G3, '5');
        W(G3, '2', M3, '1'); W(G3, '4', M3, '3'); W(G3, '6', M3, '5');
        W(M3, '2', G1, '1'); W(M3, '4', G1, '3'); W(M3, '6', G1, '5');
        W(G1, '2', M1, '1'); W(G1, '4', M1, '3'); W(G1, '6', M1, '5');
        W(M1, '2', V, '1'); W(M1, '4', V, '3'); W(M1, '6', V, '5');
        W(V, '2', T, '1'); W(V, '4', T, '3'); W(V, '6', T, '5');
        W(T, '2', N, '1'); W(T, '4', N, '3'); W(T, '6', N, '5');
        W(N, '2', MO, 'U'); W(N, '4', MO, 'V'); W(N, '6', MO, 'W');
        for (const u of [D3, G3, G1, V]) byUid(u).on = true;
      }
    } else if (pid.startsWith('hv_')) {
      const HV = A('hvin');
      // 共用：高壓鏈 → 變壓器 → NFB → 馬達
      const hvChainStd = (withLa, closed) => {
        const LAp = withLa ? A('la') : null;
        const D = A('ds'), V = A('vcb'), C = A('cthv'), T = A('hvtr'), N = A('nfb');
        W(HV, 'H1', D, '1'); W(HV, 'H2', D, '3'); W(HV, 'H3', D, '5');
        if (LAp) { W(LAp, 'L1', HV, 'H1'); W(LAp, 'L2', HV, 'H2'); W(LAp, 'L3', HV, 'H3'); }
        W(D, '2', V, '1'); W(D, '4', V, '3'); W(D, '6', V, '5');
        W(V, '2', C, '1'); W(V, '4', C, '3'); W(V, '6', C, '5');
        W(C, '2', T, '1'); W(C, '4', T, '3'); W(C, '6', T, '5');
        W(T, '2', N, '1'); W(T, '4', N, '3'); W(T, '6', N, '5');
        if (closed) { byUid(D).on = true; byUid(V).on = true; }
        return { D, V, C, T, N };
      };
      const wireRy = (C, V) => {
        const R = A('ry');
        W(C, 'k', R, 'S1'); W(C, 'l', R, 'S2');
        W(R, 'T1', V, 'TC1'); W(R, 'T2', V, 'TC2');
        return R;
      };
      if (pid === 'hv_std' || pid === 'hv_seq' || pid === 'hv_arc' || pid === 'hv_relay') {
        const { D, V, C, N } = hvChainStd(true, pid !== 'hv_seq');
        const MO = A('motor');
        W(N, '2', MO, 'U'); W(N, '4', MO, 'V'); W(N, '6', MO, 'W');
        wireRy(C, V);
        if (pid === 'hv_relay') byUid(MO).loadA = 20;
        void D;
      } else if (pid === 'hv_pf' || pid === 'hv_fuse') {
        const LAp = A('la'), L = A('lbs'), F = A('pf'), T = A('hvtr'), N = A('nfb'), MO = A('motor');
        W(LAp, 'L1', HV, 'H1'); W(LAp, 'L2', HV, 'H2'); W(LAp, 'L3', HV, 'H3');
        W(HV, 'H1', L, '1'); W(HV, 'H2', L, '3'); W(HV, 'H3', L, '5');
        W(L, '2', F, '1'); W(L, '4', F, '3'); W(L, '6', F, '5');
        W(F, '2', T, '1'); W(F, '4', T, '3'); W(F, '6', T, '5');
        W(T, '2', N, '1'); W(T, '4', N, '3'); W(T, '6', N, '5');
        W(N, '2', MO, 'U'); W(N, '4', MO, 'V'); W(N, '6', MO, 'W');
        byUid(L).on = true;
        if (pid === 'hv_fuse') { byUid(MO).loadA = 20; byUid(F).setA = 0.5; }
      } else if (pid === 'hv_pt') {
        const { V, C, N } = hvChainStd(false, true);
        const P = A('pt'), GL = A('pl_g'), MO = A('motor');
        W(N, '2', MO, 'U'); W(N, '4', MO, 'V'); W(N, '6', MO, 'W');
        wireRy(C, V);
        W(P, 'P1', V, '2'); W(P, 'P2', V, '4');            // PT 取自 VCB 之後
        W(P, 'S1', GL, 'X1'); W(GL, 'X2', P, 'S2');        // 受電指示燈
      } else if (pid === 'hv_2tr') {
        const D = A('ds'), V = A('vcb'), T1 = A('hvtr'), T2 = A('hvtr'), N1 = A('nfb'), N2 = A('nfb');
        const MO1 = A('motor'), MO2 = A('motor');
        W(HV, 'H1', D, '1'); W(HV, 'H2', D, '3'); W(HV, 'H3', D, '5');
        W(D, '2', V, '1'); W(D, '4', V, '3'); W(D, '6', V, '5');
        W(V, '2', T1, '1'); W(V, '4', T1, '3'); W(V, '6', T1, '5');
        W(V, '2', T2, '1'); W(V, '4', T2, '3'); W(V, '6', T2, '5');
        W(T1, '2', N1, '1'); W(T1, '4', N1, '3'); W(T1, '6', N1, '5');
        W(N1, '2', MO1, 'U'); W(N1, '4', MO1, 'V'); W(N1, '6', MO1, 'W');
        W(T2, '2', N2, '1'); W(T2, '4', N2, '3'); W(T2, '6', N2, '5');
        W(N2, '2', MO2, 'U'); W(N2, '4', MO2, 'V'); W(N2, '6', MO2, 'W');
        byUid(D).on = true; byUid(V).on = true;
      } else if (pid === 'hv_atsgen') {
        const D = A('ds'), V = A('vcb'), C = A('cthv'), T = A('hvtr'), N = A('nfb'), AT = A('ats');
        const G = A('gen'), MO = A('motor');
        W(HV, 'H1', D, '1'); W(HV, 'H2', D, '3'); W(HV, 'H3', D, '5');
        W(D, '2', V, '1'); W(D, '4', V, '3'); W(D, '6', V, '5');
        W(V, '2', C, '1'); W(V, '4', C, '3'); W(V, '6', C, '5');
        W(C, '2', T, '1'); W(C, '4', T, '3'); W(C, '6', T, '5');
        W(T, '2', N, '1'); W(T, '4', N, '3'); W(T, '6', N, '5');
        W(N, '2', AT, '1'); W(N, '4', AT, '3'); W(N, '6', AT, '5');
        W(G, 'GR', AT, '7'); W(G, 'GS', AT, '9'); W(G, 'GT', AT, '11');
        W(AT, '2', MO, 'U'); W(AT, '4', MO, 'V'); W(AT, '6', MO, 'W');
        wireRy(C, V);
        byUid(D).on = true; byUid(V).on = true;
      } else if (pid === 'hv_full') {
        const { V, C, N } = hvChainStd(false, true);
        const M = A('mc'), ST = A('pb_nc'), GO = A('pb_no'), VMm = A('vm'), MO = A('motor');
        W(N, '2', M, '1'); W(N, '4', M, '3'); W(N, '6', M, '5');
        W(M, '2', MO, 'U'); W(M, '4', MO, 'V'); W(M, '6', MO, 'W');
        wireRy(C, V);
        W(VMm, 'P1', N, '2'); W(VMm, 'P2', N, '4');
        W(S, 'C1', ST, '1'); W(ST, '2', GO, '3'); W(GO, '4', M, 'A1');
        W(M, '13', GO, '3'); W(M, '14', GO, '4');
        W(M, 'A2', S, 'C2');
      }
    } else if (['plc_jog', 'plc_counter', 'plc_flash', 'plc_fwdrev', 'plc_seq', 'plc_ydelta', 'plc_conveyor', 'plc_alarm'].includes(pid)) {
      const P = A('plc');
      W(S, 'C1', P, 'L'); W(P, 'N', S, 'C2');
      W(S, 'C1', P, 'C0');
      const c = (t, addr) => ({ t, addr });
      let prog = null;
      if (pid === 'plc_jog') {
        const N = A('nfb'), M = A('mc'), H = A('thry'), GO = A('pb_no'), MO = A('motor');
        mainChain(N, M, H, MO);
        W(P, 'COM', GO, '3'); W(GO, '4', P, 'X0');
        W(P, 'Y0', M, 'A1'); W(M, 'A2', H, '95'); W(H, '96', S, 'C2');
        prog = { rungs: [{ cols: [[c('no', 'X0'), null]], coil: { t: 'out', addr: 'Y0' } }] };
      } else if (pid === 'plc_counter') {
        const N = A('nfb'), M = A('mc'), H = A('thry'), ST = A('pb_nc'), GO = A('pb_no'), MO = A('motor');
        mainChain(N, M, H, MO);
        W(P, 'COM', GO, '3'); W(GO, '4', P, 'X0');
        W(P, 'COM', ST, '1'); W(ST, '2', P, 'X1');
        W(P, 'Y0', M, 'A1'); W(M, 'A2', H, '95'); W(H, '96', S, 'C2');
        prog = { rungs: [
          { cols: [[c('no', 'X0'), null]], coil: { t: 'ctu', addr: 'C0', preset: 3 } },
          { cols: [[c('no', 'C0'), null]], coil: { t: 'out', addr: 'Y0' } },
          { cols: [[c('nc', 'X1'), null]], coil: { t: 'rst', addr: 'C0' } }
        ] };
      } else if (pid === 'plc_flash') {
        const GL = A('pl_g'), RL = A('pl_r');
        W(P, 'Y0', GL, 'X1'); W(GL, 'X2', S, 'C2');
        W(P, 'Y1', RL, 'X1'); W(RL, 'X2', S, 'C2');
        prog = { rungs: [
          { cols: [[c('nc', 'T1'), null]], coil: { t: 'ton', addr: 'T0', preset: 0.5 } },
          { cols: [[c('no', 'T0'), null]], coil: { t: 'ton', addr: 'T1', preset: 0.5 } },
          { cols: [[c('nc', 'T0'), null]], coil: { t: 'out', addr: 'Y0' } },
          { cols: [[c('no', 'T0'), null]], coil: { t: 'out', addr: 'Y1' } }
        ] };
      } else if (pid === 'plc_fwdrev') {
        const N = A('nfb'), MF = A('mc'), MR = A('mc'), H = A('thry');
        const GOF = A('pb_no'), GOR = A('pb_no'), ST = A('pb_nc'), MO = A('motor');
        W(S, 'R', N, '1'); W(S, 'S', N, '3'); W(S, 'T', N, '5');
        W(N, '2', MF, '1'); W(N, '4', MF, '3'); W(N, '6', MF, '5');
        W(N, '6', MR, '1'); W(N, '4', MR, '3'); W(N, '2', MR, '5');
        W(MF, '2', H, '1'); W(MF, '4', H, '3'); W(MF, '6', H, '5');
        W(MR, '2', H, '1'); W(MR, '4', H, '3'); W(MR, '6', H, '5');
        W(H, '2', MO, 'U'); W(H, '4', MO, 'V'); W(H, '6', MO, 'W');
        W(P, 'COM', GOF, '3'); W(GOF, '4', P, 'X0');
        W(P, 'COM', GOR, '3'); W(GOR, '4', P, 'X1');
        W(P, 'COM', ST, '1'); W(ST, '2', P, 'X2');
        W(P, 'Y0', MR, '21'); W(MR, '22', MF, 'A1');           // 硬體互鎖保留
        W(P, 'Y1', MF, '21'); W(MF, '22', MR, 'A1');
        W(MF, 'A2', H, '95'); W(MR, 'A2', H, '95'); W(H, '96', S, 'C2');
        prog = { rungs: [
          { cols: [[c('no', 'X0'), c('no', 'Y0')], [c('no', 'X2'), null], [c('nc', 'Y1'), null]], coil: { t: 'out', addr: 'Y0' } },
          { cols: [[c('no', 'X1'), c('no', 'Y1')], [c('no', 'X2'), null], [c('nc', 'Y0'), null]], coil: { t: 'out', addr: 'Y1' } }
        ] };
      } else if (pid === 'plc_seq' || pid === 'plc_conveyor') {
        const N = A('nfb'), M1 = A('mc'), M2 = A('mc'), H1 = A('thry'), H2 = A('thry');
        const ST = A('pb_nc'), GO = A('pb_no'), MO1 = A('motor'), MO2 = A('motor');
        W(S, 'R', N, '1'); W(S, 'S', N, '3'); W(S, 'T', N, '5');
        W(N, '2', M1, '1'); W(N, '4', M1, '3'); W(N, '6', M1, '5');
        W(N, '2', M2, '1'); W(N, '4', M2, '3'); W(N, '6', M2, '5');
        W(M1, '2', H1, '1'); W(M1, '4', H1, '3'); W(M1, '6', H1, '5');
        W(H1, '2', MO1, 'U'); W(H1, '4', MO1, 'V'); W(H1, '6', MO1, 'W');
        W(M2, '2', H2, '1'); W(M2, '4', H2, '3'); W(M2, '6', H2, '5');
        W(H2, '2', MO2, 'U'); W(H2, '4', MO2, 'V'); W(H2, '6', MO2, 'W');
        W(P, 'COM', GO, '3'); W(GO, '4', P, 'X0');
        W(P, 'COM', ST, '1'); W(ST, '2', P, 'X1');
        W(P, 'Y0', M1, 'A1'); W(M1, 'A2', H1, '95'); W(H1, '96', S, 'C2');
        W(P, 'Y1', M2, 'A1'); W(M2, 'A2', H2, '95'); W(H2, '96', S, 'C2');
        prog = pid === 'plc_seq'
          ? { rungs: [
              { cols: [[c('no', 'X0'), c('no', 'M0')], [c('no', 'X1'), null]], coil: { t: 'out', addr: 'M0' } },
              { cols: [[c('no', 'M0'), null]], coil: { t: 'ton', addr: 'T0', preset: 3 } },
              { cols: [[c('no', 'M0'), null]], coil: { t: 'out', addr: 'Y0' } },
              { cols: [[c('no', 'T0'), null]], coil: { t: 'out', addr: 'Y1' } }
            ] }
          : { rungs: [
              { cols: [[c('no', 'X0'), c('no', 'M0')], [c('no', 'X1'), null]], coil: { t: 'out', addr: 'M0' } },
              { cols: [[c('no', 'M0'), null]], coil: { t: 'ton', addr: 'T0', preset: 2 } },
              { cols: [[c('no', 'M0'), c('no', 'Y0')], [c('nc', 'T1'), null]], coil: { t: 'out', addr: 'Y0' } },
              { cols: [[c('nc', 'M0'), null], [c('no', 'Y0'), null]], coil: { t: 'ton', addr: 'T1', preset: 2 } },
              { cols: [[c('no', 'M0'), null], [c('no', 'T0'), null]], coil: { t: 'out', addr: 'Y1' } }
            ] };
      } else if (pid === 'plc_ydelta') {
        const N = A('nfb'), MM = A('mc'), MS = A('mc'), MD = A('mc'), H = A('thry');
        const ST = A('pb_nc'), GO = A('pb_no'), MO = A('motor6');
        W(S, 'R', N, '1'); W(S, 'S', N, '3'); W(S, 'T', N, '5');
        W(N, '2', MM, '1'); W(N, '4', MM, '3'); W(N, '6', MM, '5');
        W(MM, '2', H, '1'); W(MM, '4', H, '3'); W(MM, '6', H, '5');
        W(H, '2', MO, 'U1'); W(H, '4', MO, 'V1'); W(H, '6', MO, 'W1');
        W(N, '2', MD, '1'); W(N, '4', MD, '3'); W(N, '6', MD, '5');
        W(MD, '4', MO, 'U2'); W(MD, '6', MO, 'V2'); W(MD, '2', MO, 'W2');
        W(MO, 'U2', MS, '1'); W(MO, 'V2', MS, '3'); W(MO, 'W2', MS, '5');
        W(MS, '2', MS, '4'); W(MS, '4', MS, '6');
        W(P, 'COM', GO, '3'); W(GO, '4', P, 'X0');
        W(P, 'COM', ST, '1'); W(ST, '2', P, 'X1');
        W(P, 'Y0', MM, 'A1'); W(MM, 'A2', H, '95'); W(H, '96', S, 'C2');
        W(P, 'Y1', MD, '21'); W(MD, '22', MS, 'A1'); W(MS, 'A2', H, '95');
        W(P, 'Y2', MS, '21'); W(MS, '22', MD, 'A1'); W(MD, 'A2', H, '95');
        prog = { rungs: [
          { cols: [[c('no', 'X0'), c('no', 'M0')], [c('no', 'X1'), null]], coil: { t: 'out', addr: 'M0' } },
          { cols: [[c('no', 'M0'), null]], coil: { t: 'ton', addr: 'T0', preset: 3 } },
          { cols: [[c('no', 'M0'), null], [c('nc', 'T0'), null]], coil: { t: 'out', addr: 'Y1' } },
          { cols: [[c('no', 'M0'), null], [c('no', 'T0'), null]], coil: { t: 'out', addr: 'Y2' } },
          { cols: [[c('no', 'M0'), null]], coil: { t: 'out', addr: 'Y0' } }
        ] };
      } else if (pid === 'plc_alarm') {
        const N = A('nfb'), M = A('mc'), H = A('thry'), ST = A('pb_nc'), GO = A('pb_no');
        const BZ = A('bz'), RL = A('pl_r'), MO = A('motor');
        mainChain(N, M, H, MO);
        W(P, 'COM', GO, '3'); W(GO, '4', P, 'X0');
        W(P, 'COM', ST, '1'); W(ST, '2', P, 'X1');
        W(P, 'COM', H, '97'); W(H, '98', P, 'X2');             // 過載 a 接點進 PLC
        W(P, 'Y0', M, 'A1'); W(M, 'A2', H, '95'); W(H, '96', S, 'C2');
        W(P, 'Y1', BZ, 'X1'); W(BZ, 'X2', S, 'C2');
        W(P, 'Y2', RL, 'X1'); W(RL, 'X2', S, 'C2');
        prog = { rungs: [
          { cols: [[c('no', 'X0'), c('no', 'Y0')], [c('no', 'X1'), null], [c('nc', 'X2'), null]], coil: { t: 'out', addr: 'Y0' } },
          { cols: [[c('no', 'X2'), null], [c('nc', 'T1'), null]], coil: { t: 'ton', addr: 'T0', preset: 0.5 } },
          { cols: [[c('no', 'T0'), null]], coil: { t: 'ton', addr: 'T1', preset: 0.5 } },
          { cols: [[c('no', 'X2'), null], [c('nc', 'T0'), null]], coil: { t: 'out', addr: 'Y1' } },
          { cols: [[c('no', 'X2'), null]], coil: { t: 'out', addr: 'Y2' } }
        ] };
      }
      if (prog && window.CF && CF.Plc) CF.Plc.setProgram(prog);
    }
    changed();
    return { ok: true, preset: PRESETS.find(x => x.id === pid).name };
  }
  function loadExample() { return loadPreset('selfhold'); }

  function addPartSilent(id, rowOverride) {
    const d = DEFS[id];
    const row = rowOverride !== undefined ? rowOverride : d.row;
    let x = 30;
    for (const p of st.parts) {
      const pd = defOf(p);
      const pRow = p._row !== undefined ? p._row : pd.row;
      if (pRow === row) x = Math.max(x, p.x + pd.w + 42);
    }
    const np = { uid: st.uidSeq++, id, x, y: ROW_Y[row] - (row === 0 ? 0 : d.h - 46), _row: row };
    if (d.toggle) np.on = true;
    st.parts.push(np);
    return np.uid;
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
        note: pa && pa.dom === 'main' ? '主迴路（三相）' : pa && pa.dom === 'hv' ? '高壓（11.4kV）' : '控制迴路（110V）',
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
      // 互鎖群組只閉合一顆 MC，避免相別著色被全閉假設短接汙染
      restUf: (() => {
        const tied = tiedMcGroup();
        return buildUF('all', null, tied.length >= 2 ? { skipMainsUids: new Set(tied.slice(1)) } : undefined);
      })()
    };
    return st.plan;
  }

  /* ================= 迴路圖 SVG ================= */
  function genSvg() {
    const escT = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const el = [];
    el.push(`<rect x="8" y="8" width="${LW - 16}" height="${LH - 16}" rx="12" fill="#e8eaec" stroke="#c5cad0" stroke-width="2"/>`);
    for (const y of ROW_Y) el.push(`<rect x="20" y="${y + 18}" width="${LW - 40}" height="14" fill="#cdd3d8"/>`);
    const restUf = st.plan && st.plan.restUf;
    const src = sourcePart();
    for (const w of st.wires) {
      const pa = termPos(byUid(w.a.uid), w.a.term), pb = termPos(byUid(w.b.uid), w.b.term);
      if (!pa || !pb) continue;
      const mx = (pa.x + pb.x) / 2;
      const sag = Math.min(60, Math.abs(pa.x - pb.x) * 0.15 + Math.abs(pa.y - pb.y) * 0.1 + 18);
      const my = Math.max(pa.y, pb.y) + sag;
      let color = pa.dom === 'hv' ? '#8a3b9f' : pa.dom === 'ehv' ? '#2e6bd0' : pa.dom === 'uhv' ? '#c02a50' : '#c98418';
      if (pa.dom === 'main') {
        color = '#7a4040';
        if (restUf && src) {
          const n = restUf.find(tid(w.a.uid, w.a.term));
          if (n === restUf.find(tid(src.uid, 'R'))) color = '#c2402a';
          else if (n === restUf.find(tid(src.uid, 'S'))) color = '#8a8f95';
          else if (n === restUf.find(tid(src.uid, 'T'))) color = '#3b62c4';
        }
      }
      el.push(`<path d="M ${pa.x} ${pa.y} Q ${mx} ${my} ${pb.x} ${pb.y}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`);
    }
    for (const p of st.parts) {
      const d = defOf(p);
      el.push(`<rect x="${p.x}" y="${p.y}" width="${d.w}" height="${d.h}" rx="8" fill="${d.color}" stroke="rgba(0,0,0,.3)" stroke-width="1.5"/>`);
      el.push(`<text x="${p.x + d.w / 2}" y="${p.y + 22}" text-anchor="middle" fill="#f2f4f6" font-size="14" font-weight="700">${escT(labelOf(p.uid, '').trim())}</text>`);
      for (const t of d.terms) {
        const x = p.x + t.dx, y = p.y + t.dy;
        el.push(`<circle cx="${x}" cy="${y}" r="5" fill="${t.dom === 'main' ? '#d8dce0' : t.dom === 'hv' ? '#d9a0f0' : t.dom === 'ehv' ? '#7db0e8' : t.dom === 'uhv' ? '#f0a0b8' : '#ffd9a0'}" stroke="rgba(0,0,0,.4)"/>`);
        el.push(`<text x="${x}" y="${t.dy === 0 ? y - 8 : t.dy >= d.h ? y + 16 : y - 8}" text-anchor="middle" fill="#3b4046" font-size="9">${escT(t.n)}</text>`);
      }
    }
    el.push(`<text x="${LW - 24}" y="${LH - 20}" text-anchor="end" fill="#8a8f95" font-size="11">NemoClaw 電路實驗室 · 配電盤迴路圖</text>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LW} ${LH}" font-family="'IBM Plex Mono',monospace">${el.join('')}</svg>\n`;
  }

  function genFiles() {
    const plan = st.plan || derive();
    const wiring = ['# 接線表（配電盤）', ''];
    st.wires.forEach((w, i) => {
      const pa = termPos(byUid(w.a.uid), w.a.term);
      wiring.push(`${String(i + 1).padStart(2, '0')}  ${labelOf(w.a.uid, w.a.term)}  →  ${labelOf(w.b.uid, w.b.term)}   [${pa && pa.dom === 'main' ? '主' : pa && pa.dom === 'hv' ? '高壓' : pa && pa.dom === 'ehv' ? '161kV' : pa && pa.dom === 'uhv' ? '345kV' : '控'}]`);
    });
    const bom = ['# 元件表（BOM）', ''];
    const cnt = {};
    for (const p of st.parts) cnt[p.id] = (cnt[p.id] || 0) + 1;
    for (const [id, n] of Object.entries(cnt)) bom.push(`${DEFS[id].name}  × ${n}`);
    const files = [
      { name: '接線表.txt', lang: 'txt', content: wiring.join('\n') + '\n' },
      { name: '元件表.txt', lang: 'txt', content: bom.join('\n') + '\n' },
      { name: '迴路圖.svg', lang: 'xml', content: genSvg() }
    ];
    const plcP = st.parts.find(p => defOf(p).plc);
    if (plcP && window.CF && CF.Plc) {
      files.push({ name: 'program.st', lang: 'txt', content: CF.Plc.exportST() });
      const io = ['# PLC IO 對照表', ''];
      for (const t of defOf(plcP).terms) {
        if (!/^[XY]\d$/.test(t.n)) continue;
        const ends = st.wires
          .filter(w => (w.a.uid === plcP.uid && w.a.term === t.n) || (w.b.uid === plcP.uid && w.b.term === t.n))
          .map(w => (w.a.uid === plcP.uid && w.a.term === t.n) ? labelOf(w.b.uid, w.b.term) : labelOf(w.a.uid, w.a.term));
        if (ends.length) io.push(`${t.n}  ${t.n[0] === 'X' ? '←' : '→'}  ${ends.join('、')}`);
      }
      files.push({ name: 'IO對照表.txt', lang: 'txt', content: io.join('\n') + '\n' });
    }
    files.push({ name: 'panel.json', lang: 'json', content: JSON.stringify(serialize(), null, 2) });
    return files;
  }

  /* ================= 持久化 ================= */
  const PARAM_KEYS = ['preset', 'setA', 'loadA', 'ampsA', 'volt', 'startDelay', 'rateA', 'ratio', 'kva', 'pickup', 'inject'];
  /* 受試設備的健康絕緣值（MΩ）與判定門檻；注入缺陷後絕緣掉到 0.4MΩ */
  const INSUL = { motor: 2000, motor6: 2000, mc: 1000, hvtr: 5000, mtx161: 8000, mtx345: 8000, cthv: 3000, ct161: 3000, vcb: 5000, gcb161: 6000, gcb345: 6000 };
  const insulOf = p => (p.defect === 'insulation' ? 0.4 : (INSUL[p.id] || 1500));
  const insulNeed = p => {
    const doms = defOf(p).terms.map(t => t.dom);
    return (doms.includes('uhv') || doms.includes('ehv') || doms.includes('hv')) ? 10 : 1;
  };
  function serialize() {
    return {
      parts: st.parts.map(p => {
        const o = { uid: p.uid, id: p.id, x: p.x, y: p.y, on: p.on, tripped: p.tripped };
        if (p.fault) o.fault = true;
        if (p.defect) o.defect = p.defect;
        if (p._row !== undefined) o._row = p._row;
        for (const k of PARAM_KEYS) if (p[k] !== undefined) o[k] = p[k];
        return o;
      }),
      wires: st.wires.map(w => ({ a: w.a, b: w.b })),
      uidSeq: st.uidSeq,
      program: (window.CF && CF.Plc) ? CF.Plc.serialize() : null
    };
  }
  function restore(d) {
    if (!d || !d.parts) return;
    st.parts = d.parts.filter(p => DEFS[p.id]).map(p => {
      const o = { uid: p.uid, id: p.id, x: p.x, y: p.y, on: p.on, tripped: p.tripped };
      if (p.fault) o.fault = true;
      if (typeof p.defect === 'string' && p.defect.length < 20) o.defect = p.defect;
      if (p._row !== undefined) o._row = p._row;
      // 參數逐鍵消毒：非數值丟棄；元件自身的可調參數再以 min/max 夾取
      const pr = DEFS[p.id].param;
      for (const k of PARAM_KEYS) {
        if (p[k] === undefined) continue;
        const v = parseFloat(p[k]);
        if (!isFinite(v)) continue;
        o[k] = (pr && pr.key === k) ? Math.min(pr.max, Math.max(pr.min, v)) : v;
      }
      return o;
    });
    const have = new Set(st.parts.map(p => p.uid));
    st.wires = (d.wires || []).filter(w => have.has(w.a.uid) && have.has(w.b.uid)).map(w => ({ uid: st.uidSeq++, a: w.a, b: w.b }));
    st.uidSeq = Math.max(d.uidSeq || 1, st.uidSeq);
    st.gen = (st.gen || 0) + 1;
    if (window.CF && CF.Plc) {
      if (d.program) CF.Plc.restoreProgram(d.program);
      else CF.Plc.setProgram({ rungs: [] });
    }
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
    st.baseScale = Math.min(st.w / LW, st.h / LH);
    st.baseOx = (st.w - LW * st.baseScale) / 2;
    st.baseOy = (st.h - LH * st.baseScale) / 2;
    applyView();
  }

  /* ================= 對外 ================= */
  return {
    DEFS, PALETTE,
    init(canvas, hooks) {
      st.canvas = canvas;
      st.ctx = canvas.getContext('2d');
      st.onChange = hooks && hooks.onChange;
      st.onSim = hooks && hooks.onSim;
      st.onLadder = hooks && hooks.onLadder;
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      canvas.addEventListener('dblclick', onDbl);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('pointerleave', () => { st.hover = null; st.panDrag = null; render(); });
      if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement);
      resize();
      ensureSource();
      derive();
    },
    PRESETS, loadPreset,
    addPart, loadExample, restore, serialize, genFiles, resize,
    setTool(t) { st.tool = t; st.wireStart = null; render(); },
    clear() { st.parts = []; st.wires = []; st.uidSeq = 1; st.gen = (st.gen || 0) + 1; if (window.CF && CF.Plc) CF.Plc.setProgram({ rungs: [] }); ensureSource(); changed(); },
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
    toggleCos(uid) {
      const p = byUid(uid) || st.parts.find(x => defOf(x).selector);
      if (p) { p.on = !p.on; if (!st.running) changed(); else render(); return { ok: true, position: p.on ? 'B' : 'A' }; }
      return { ok: false, error: '盤上沒有 COS 選擇開關' };
    },
    setTrPreset(uid, seconds) {
      const p = byUid(uid) || st.parts.find(x => defOf(x).timed);
      if (!p) return { ok: false, error: '盤上沒有 TR 限時電驛' };
      return setParam(p.uid, seconds);
    },
    setParam(uid, value) { return setParam(uid, value); },
    toggleOutage,
    operateSwitch,
    resetProtection,
    runTest,
    injectDefect,
    viewInfo() { return { scale: st.scale, ox: st.ox, oy: st.oy, zoom: st.zoom }; },
    termScreenXY(uid, term) {
      const p = byUid(uid);
      const t = p && termPos(p, term);
      return t ? { x: t.x * st.scale + st.ox, y: t.y * st.scale + st.oy } : null;
    },
    /* Agent 用：以「標籤:端子」找端子（模糊容錯＋錯誤時列出可用值） */
    resolveRef(s) {
      const m = String(s || '').trim().match(/^(.+?)[\s:.\-–—]+([A-Za-z0-9]+)$/);
      const partsList = this.getParts();
      if (!m) return { error: `格式錯誤「${s}」——請用「元件標籤:端子」，例如 MC1:13、START:4、POWER:C1` };
      const lbl = m[1].trim().toLowerCase().replace(/\s+/g, '');
      const p = partsList.find(x => x.label.toLowerCase().replace(/\s+/g, '') === lbl)
        || partsList.find(x => x.label.toLowerCase().replace(/\s+/g, '').startsWith(lbl));
      if (!p) return { error: `找不到元件「${m[1]}」。目前盤上：${partsList.map(x => x.label).join('、')}` };
      const t = p.def.terms.find(t => t.n.toLowerCase() === m[2].toLowerCase());
      if (!t) return { error: `${p.label} 沒有端子「${m[2]}」。可用端子：${p.def.terms.map(t => t.n).join('、')}` };
      return { uid: p.uid, term: t.n, label: p.label };
    },
    agentWire(from, to) {
      const a = this.resolveRef(from), b = this.resolveRef(to);
      if (a.error) return { ok: false, error: a.error };
      if (b.error) return { ok: false, error: b.error };
      if (a.uid === b.uid && a.term === b.term) return { ok: false, error: '兩端不能是同一個端子' };
      st.wires.push({ uid: st.uidSeq++, a: { uid: a.uid, term: a.term }, b: { uid: b.uid, term: b.term } });
      changed();
      const errs = st.plan.checks.filter(c => c.status === 'error').map(c => c.name);
      return { ok: true, wire: `${a.label} ${a.term} → ${b.label} ${b.term}`, erc_errors: errs };
    },
    agentUnwire(from, to) {
      const a = this.resolveRef(from), b = this.resolveRef(to);
      if (a.error) return { ok: false, error: a.error };
      if (b.error) return { ok: false, error: b.error };
      const idx = st.wires.findIndex(w =>
        (w.a.uid === a.uid && w.a.term === a.term && w.b.uid === b.uid && w.b.term === b.term) ||
        (w.a.uid === b.uid && w.a.term === b.term && w.b.uid === a.uid && w.b.term === a.term));
      if (idx < 0) return { ok: false, error: '這兩個端子之間沒有接線' };
      st.wires.splice(idx, 1);
      changed();
      return { ok: true };
    },
    agentStatus() {
      const plan = st.plan || derive();
      return {
        running: st.running,
        parts: this.getParts().map(p => ({
          label: p.label, name: p.def.name,
          terms: p.def.terms.map(t => t.n).join(','),
          param: p.def.param ? `${p.def.param.name} ${p.paramVal}${p.def.param.unit}（可用 set_param 調整 ${p.def.param.min}–${p.def.param.max}）` : undefined,
          state: p.def.coil ? (p.energized ? '吸持' : '釋放')
            : p.def.motor ? (p.run ? '運轉' + (p.mode ? `（${p.mode}）` : '') : '停止')
            : p.def.load ? (p.lit ? '亮' : '暗')
            : p.def.outage ? (p.outage ? '停電中' : '市電正常')
            : p.def.toggle ? (p.on ? 'ON' : 'OFF')
            : p.def.selector ? (p.on ? '位置B' : '位置A')
            : p.def.trip ? (p.tripped ? '跳脫' : '正常')
            : p.def.meter ? `${p.def.meter === 'V' ? Math.round(p.reading || 0) + 'V' : (p.reading || 0).toFixed(1) + 'A'}`
            : p.def.gen ? (p.running ? '發電中' : '待機')
            : p.def.ats ? (p.pos === 'E' ? '備用側' : p.pos === 'N' ? '常用側' : '未定')
            : p.def.capbank ? (p.scEn ? '投入' : '切離')
            : p.def.plc ? (p.powered ? 'RUN' : (st.running ? '未供電' : '停止')) : ''
        })),
        wires: st.wires.length,
        checks: plan.checks.map(c => `${c.status.toUpperCase()}: ${c.name}`),
        log_tail: st.log.slice(-8)
      };
    },
    tripThry(uid, tripped) {
      const p = byUid(uid) || st.parts.find(x => x.id === 'thry');
      if (p) {
        p.tripped = tripped === undefined ? !p.tripped : tripped;
        pushLog(p.tripped ? 'TH-RY 過載跳脫！⚡' : 'TH-RY 復歸。');
        if (!st.running) changed(); else render();
      }
    },
    getParts() {
      return st.parts.map(p => {
        const d = defOf(p);
        const same = st.parts.filter(q => q.id === p.id);
        const label = d.label + (same.length > 1 ? same.indexOf(p) + 1 : '');
        const paramVal = d.param ? (p[d.param.key] !== undefined ? p[d.param.key] : d.param.def) : undefined;
        return {
          uid: p.uid, id: p.id, def: d, label, pressed: p.pressed, on: p.on, tripped: p.tripped,
          energized: p.energized, lit: p.lit, run: p.run, mode: p.mode, powered: p.powered,
          preset: p.preset, reading: p.reading, pos: p.pos, running: p.running, startAt: p.startAt,
          outage: p.outage, scEn: p.scEn, paramVal, fault: p.fault, ryOn: p.ryAcc > 0,
          testMsg: p.testMsg, testing: p.testing, defect: p.defect
        };
      });
    }
  };
})();
