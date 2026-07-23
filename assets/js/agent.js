'use strict';
/* NemoClaw 電路實驗室 — LAB AGENT
 * BYOK（自帶 Google API Key）的內建助手：透過 @google/genai 以 function calling
 * 操作全站工具（生成方案、改腳位、自由編輯加減元件、模擬、匯出）。
 * 預設模型 gemma-4-31b-it（Gemini API 免費層），可切換模型清單。
 */
(function () {
  const LS_KEY = 'cf_gemini_key';
  const LS_MODEL = 'cf_agent_model';
  const DEFAULT_MODELS = ['gemma-4-31b-it', 'gemma-4-26b-a4b-it', 'gemini-2.5-flash', 'gemini-2.5-pro'];
  const MAX_TOOL_ROUNDS = 6;

  const st = {
    open: false, busy: false,
    history: [],          // Gemini contents 格式
    display: [],          // 畫面訊息 {who:'user'|'agent'|'tool', text}（IndexedDB 還原用）
    sdkPromise: null,
    els: {}
  };

  /* ---- 對話持久化 ---- */
  function trimHistory(list, max) {
    let out = list.slice(-max);
    // 避免開頭落在 functionCall/functionResponse 中間（API 會拒絕）
    while (out.length && !(out[0].role === 'user' && out[0].parts && out[0].parts[0] && out[0].parts[0].text)) out.shift();
    return out;
  }
  function saveChat() {
    if (!window.CF || !CF.Store) return;
    CF.Store.set('chat', { history: trimHistory(st.history, 40), display: st.display.slice(-60) });
  }
  async function restoreChat() {
    if (!window.CF || !CF.Store) return;
    const saved = await CF.Store.get('chat');
    if (!saved || !saved.display || !saved.display.length) return;
    st.history = saved.history || [];
    st.display = saved.display;
    for (const e of st.display) {
      if (e.who === 'tool') renderChipDom(e.text);
      else renderMsgDom(e.who, e.text);
    }
  }

  const getKey = () => localStorage.getItem(LS_KEY) || '';
  const getModel = () => localStorage.getItem(LS_MODEL) || DEFAULT_MODELS[0];

  /* ================= 工具定義 ================= */
  const TOOLS = [
    {
      name: 'generate_plan',
      description: '依一句需求描述自動生成完整電路方案（選板、接線、程式碼、規則檢查），並切換到 3D 檢視。適合從零開始或整組重做。',
      parameters: { type: 'object', properties: { requirement: { type: 'string', description: '需求語句，例如「ESP32 + DHT11 + OLED，透過 MQTT 回報溫溼度」' } }, required: ['requirement'] },
      run: a => CF.App.generateFromText(String(a.requirement || ''))
    },
    {
      name: 'get_state',
      description: '取得目前畫面狀態：模式、方案標題、元件與腳位、規則檢查結果、模擬是否執行中。回答使用者關於現況的問題前先呼叫。',
      parameters: { type: 'object', properties: {} },
      run: () => CF.App.getState()
    },
    {
      name: 'set_signal_pin',
      description: '在 3D 檢視（自動生成）模式下，把某元件的訊號腳改接到另一支 GPIO。',
      parameters: {
        type: 'object',
        properties: {
          part_id: { type: 'string', description: '元件 id，例如 dht11、button、pir' },
          pin_name: { type: 'string', description: '腳位名稱，例如 DATA、OUT、LEG A（可省略，取該元件第一支可調腳）' },
          gpio: { type: 'string', description: '目標腳位，格式如 "GPIO 14" 或 "D5"' }
        },
        required: ['part_id', 'gpio']
      },
      run: a => CF.App.setSignalPin(a.part_id, a.pin_name, a.gpio)
    },
    {
      name: 'switch_mode',
      description: '切換工作台模式：view＝3D 檢視（自動生成結果）、edit＝自由編輯（2D 麵包板手動接線）、ind＝工業配線（配電盤：NFB/MC/TH-RY/按鈕/馬達，自保持模擬）。',
      parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['view', 'edit', 'ind'] } }, required: ['mode'] },
      run: a => CF.App.setMode(a.mode)
    },
    {
      name: 'editor_add_part',
      description: '在自由編輯模式的麵包板上放一個元件，並自動接好電源、GND 與訊號腳（含電源軌橋接）。會自動切到編輯模式。',
      parameters: { type: 'object', properties: { part_id: { type: 'string', description: '元件 id，見系統能力清單' } }, required: ['part_id'] },
      run: a => CF.App.editorAddPart(a.part_id)
    },
    {
      name: 'editor_remove_part',
      description: '從自由編輯工作台移除一個元件（連同其接線）。',
      parameters: { type: 'object', properties: { part_id: { type: 'string' } }, required: ['part_id'] },
      run: a => CF.App.editorRemovePart(a.part_id)
    },
    {
      name: 'editor_load_current_plan',
      description: '把目前自動生成的方案匯入自由編輯器（含全部接線），讓使用者或你在其上繼續修改。',
      parameters: { type: 'object', properties: {} },
      run: () => CF.App.editorLoadPlan()
    },
    {
      name: 'editor_clear',
      description: '清空自由編輯工作台（元件與接線全部移除）。破壞性操作，須使用者明確要求。',
      parameters: { type: 'object', properties: {} },
      run: () => CF.App.editorClear()
    },
    {
      name: 'get_part_info',
      description: '查詢單一元件的完整知識：腳位、工作電壓、選用理由、接法備註、替代方案。回答元件相關問題或動手前不確定接法時呼叫。',
      parameters: { type: 'object', properties: { part_id: { type: 'string', description: '元件 id，例如 dht11、pir、ecap、ldr' } }, required: ['part_id'] },
      run: a => {
        const pid = CF.App.normalizePartId(a.part_id);
        const d = pid && CF.PARTS[pid];
        if (!d) return { error: `未知元件 ${a.part_id}，請用系統能力清單中的 part_id` };
        return {
          id: d.id, name: d.name, class: d.cls,
          pins: d.pins.map(p => p.n).join(', ') || '板載',
          needs_5v: !!d.needs5V,
          i2c_addr: d.addr || null,
          why: d.why, wiring_note: d.pinNote || null,
          alternatives: (d.alts || []).map(x => `${x[0]}：${x[1]}`),
          conduct: d.conduct || null, polarized: !!d.polarized, default_value: d.defaultValue || null
        };
      }
    },
    {
      name: 'get_code',
      description: '取得目前方案生成的程式碼內容。',
      parameters: { type: 'object', properties: { file_name: { type: 'string', description: 'main.cpp / platformio.ini / config.h / circuit.json，省略為 main.cpp' } } },
      run: a => CF.App.getCode(a.file_name)
    },
    {
      name: 'control_sim',
      description: '控制行為模擬器：start 通電（ERC 未過會失敗；回傳會確認 running）、stop 斷電、set_input 調虛擬感測值（key 限：temp/humi/bmeTemp/pressure/lux/dist/soil/smoke/pot/waterTemp/accel；立即生效，滑桿、3D OLED 與輸出會即時更新）、event 觸發事件（motion 人體、button 按鈕）。改完數值可用 get_state 確認 sim_running。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'stop', 'set_input', 'event'] },
          key: { type: 'string' },
          value: { type: 'number' },
          event: { type: 'string', enum: ['motion', 'button'] }
        },
        required: ['action']
      },
      run: a => CF.App.sim(a.action, a.key, a.value, a.event)
    },
    {
      name: 'export_project',
      description: '把目前方案匯出成 PlatformIO 專案 ZIP 下載給使用者。',
      parameters: { type: 'object', properties: {} },
      run: () => CF.App.exportProject()
    },
    {
      name: 'ind_load_preset',
      description: '在工業配線模式載入經典迴路範例（會覆蓋盤面），共 30 個分三級。基礎：doorbell 門鈴、selfhold 自保持、jog 寸動、joghold 寸動/連續切換、twolamp 指示燈、twoplace 兩處控制、mkpilot MK中繼、delaystart 暖機延時、seq 順序啟動、alarm 過載警報。進階/電力：fwdrev 正逆轉、ydelta Y-Δ、seqdelay 延時順序、pumps 雙泵選擇、flasher 閃爍警報、co51 過電流保護、meterpanel 受電儀表盤、capbank 功因電容、ats1 停電自動切換、ats2 受電盤總和。PLC：plc_selfhold、plc_jog、plc_timer、plc_counter 計數啟動、plc_flash 交替閃爍、plc_fwdrev、plc_seq、plc_ydelta、plc_conveyor 輸送帶、plc_alarm 斷續警報。',
      parameters: { type: 'object', properties: { preset_id: { type: 'string' } }, required: ['preset_id'] },
      run: a => {
        CF.App.setMode('ind');
        const r = CF.Ind.loadPreset(String(a.preset_id || '').toLowerCase().trim());
        if (!r.ok) r.available = CF.Ind.PRESETS.map(p => p.id);
        return r;
      }
    },
    {
      name: 'ind_add_part',
      description: '在配電盤加入一個工業元件。part_id：nfb、mc、tr（限時電驛）、mk（電力電驛）、thry、pb_nc（STOP）、pb_no（START）、cos（選擇開關）、pl_g（綠燈）、pl_r（紅燈）、bz（蜂鳴器）、motor、motor6（Y-Δ 六出線馬達）、plc。加入後用 ind_wire 接線。',
      parameters: { type: 'object', properties: { part_id: { type: 'string' } }, required: ['part_id'] },
      run: a => {
        CF.App.setMode('ind');
        const id = String(a.part_id || '').toLowerCase().trim();
        const r = CF.Ind.addPart(id);
        if (!r.ok && !CF.Ind.DEFS[id]) return { ok: false, error: `未知元件「${a.part_id}」。可用：${Object.keys(CF.Ind.DEFS).filter(k => k !== 'source').join('、')}` };
        return r;
      }
    },
    {
      name: 'ind_wire',
      description: '在配電盤兩個端子之間接線（或拆線）。端子寫法「元件標籤:端子」，例如 POWER:C1、NFB:1、MC1:13、START:4、TH-RY:95、M 3~:U、PLC:X0。接完會回傳 ERC 錯誤清單，有錯必須修正。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '起點，如 MC1:A1' },
          to: { type: 'string', description: '終點，如 TH-RY:95' },
          remove: { type: 'boolean', description: 'true＝拆掉這條線，預設 false＝接線' }
        },
        required: ['from', 'to']
      },
      run: a => { CF.App.setMode('ind'); return a.remove ? CF.Ind.agentUnwire(a.from, a.to) : CF.Ind.agentWire(a.from, a.to); }
    },
    {
      name: 'ind_control',
      description: '操作配電盤模擬：start 通電（ERC 有錯會失敗）、stop 斷電、press 按一下按鈕（按下再放開）、toggle_nfb 切 NFB、toggle_cos 切選擇開關、trip 令 TH-RY 過載跳脫／復歸、set_timer 改 TR 秒數。target 用元件標籤（如 START1、NFB、COS）。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'stop', 'press', 'toggle_nfb', 'toggle_cos', 'trip', 'set_timer', 'set_param', 'outage'] },
          target: { type: 'string', description: '元件標籤，press/trip/set_timer/set_param 需要' },
          seconds: { type: 'number', description: 'set_timer 用，1–60' },
          value: { type: 'number', description: 'set_param 用：TR 秒數、TH-RY/CO 整定電流、馬達運轉電流、POWER 線電壓、GEN 起動延時、SC 電容電流' }
        },
        required: ['action']
      },
      run: async a => {
        CF.App.setMode('ind');
        const find = lbl => CF.Ind.getParts().find(p => p.label.toLowerCase() === String(lbl || '').toLowerCase().trim());
        if (a.action === 'start') return CF.Ind.simStart();
        if (a.action === 'stop') { CF.Ind.simStop(); return { ok: true }; }
        if (a.action === 'outage') return CF.Ind.toggleOutage();
        if (a.action === 'press') {
          const p = find(a.target);
          if (!p || !p.def.momentary) return { ok: false, error: `找不到按鈕「${a.target}」。可按：${CF.Ind.getParts().filter(x => x.def.momentary).map(x => x.label).join('、') || '無'}` };
          CF.Ind.pressPB(p.uid, true);
          await new Promise(r => setTimeout(r, 400));
          CF.Ind.pressPB(p.uid, false);
          await new Promise(r => setTimeout(r, 300));
          return { ok: true, pressed: p.label, status_after: CF.Ind.agentStatus() };
        }
        if (a.action === 'toggle_nfb') { CF.Ind.toggleNfb(find(a.target) && find(a.target).uid); return { ok: true }; }
        if (a.action === 'toggle_cos') return CF.Ind.toggleCos(find(a.target) && find(a.target).uid);
        if (a.action === 'trip') { CF.Ind.tripThry(find(a.target) && find(a.target).uid); return { ok: true }; }
        if (a.action === 'set_timer') return CF.Ind.setTrPreset(find(a.target) && find(a.target).uid, a.seconds);
        if (a.action === 'set_param') {
          const p = find(a.target);
          if (!p) return { ok: false, error: `找不到元件「${a.target}」。目前盤上：${CF.Ind.getParts().map(x => x.label).join('、')}` };
          return CF.Ind.setParam(p.uid, a.value !== undefined ? a.value : a.seconds);
        }
        return { ok: false, error: '未知動作' };
      }
    },
    {
      name: 'ind_status',
      description: '取得配電盤現況：每個元件的標籤／端子／狀態、接線數、ERC 結果、事件紀錄。工業模式下回答問題或接線前先呼叫。',
      parameters: { type: 'object', properties: {} },
      run: () => CF.Ind.agentStatus()
    },
    {
      name: 'plc_program',
      description: '讀取或寫入 PLC 梯形圖程式。action=get 讀取；action=set 需附 program_json（JSON 字串）。格式：{"rungs":[{"cols":[[{"t":"no","addr":"X0"},{"t":"no","addr":"Y0"}],[{"t":"nc","addr":"X1"},null]],"coil":{"t":"out","addr":"Y0"}}]}——cols 每欄最多疊 2 個接點（疊＝並聯 OR），欄與欄串聯 AND；t：no 常開／nc 常閉；coil.t：out（Y/M）、ton（T，preset 秒）、ctu（C，preset 次）、rst。寫入後用 ind_control start＋press 測試。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['get', 'set'] },
          program_json: { type: 'string', description: 'action=set 時必填，梯形圖 JSON 字串' }
        },
        required: ['action']
      },
      run: a => {
        if (!CF.Plc) return { ok: false, error: 'PLC 引擎未載入' };
        if (a.action === 'get') return { program: CF.Plc.getProgram(), runtime: CF.Plc.getRuntime() };
        let p;
        try { p = JSON.parse(a.program_json); } catch (e) { return { ok: false, error: 'program_json 不是合法 JSON：' + e.message }; }
        const r = CF.Plc.setProgram(p);
        if (r.ok && !CF.Ind.getParts().some(x => x.def.plc)) r.note = '注意：盤面還沒有 PLC 元件，請先 ind_add_part plc 並接好 L/N/COM/X/Y。';
        return r;
      }
    }
  ];

  const DECLS = TOOLS.map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));

  async function runTool(name, args) {
    const t = TOOLS.find(x => x.name === name);
    if (!t) return { error: `未知工具 ${name}` };
    try { return (await t.run(args || {})) ?? { ok: true }; }
    catch (e) { return { error: String(e.message || e) }; }
  }

  /* ================= 系統提示（依元件庫即時生成） ================= */
  function systemPrompt() {
    const parts = CF.PART_ORDER.filter(id => id !== 'camera').map(id => `${id}（${CF.PARTS[id].titleName}）`).join('、');
    return [
      '你是「NemoClaw 電路實驗室」的內建助手 LAB AGENT。一律使用繁體中文，回覆精簡務實，不用 markdown 標題。',
      '',
      '【可用能力，嚴格限制】',
      '開發板：esp32（ESP32 DevKit V1）、esp32cam（AI Thinker ESP32-CAM，含 OV2640 相機）、nano（Arduino Nano，無 WiFi）。',
      `元件（part_id）：${parts}。`,
      '被動元件（僅自由編輯模式，點兩下可改規格值）：resistor（電阻）、capacitor（陶瓷電容）、ecap（電解電容，有極性）、diode（二極體，有方向）、inductor（電感）、ldr（光敏電阻）、ntc（熱敏電阻）、switch（滑動開關，可切 ON/OFF）。電容與二極體不導通直流，ERC 會如實反映。',
      '連線方式：MQTT、HTTP REST、Web Server、Teachable Machine（僅 ESP32 系列可連網）。',
      '',
      '【開發板要點】',
      'esp32（DevKit V1）：3.3V 邏輯；感測預設由 3V3 供電，需 5V 的元件（PIR、伺服、繼電器、HC-SR04、MQ-2、水泵、WS2812、LCD1602）會改走 VIN 5V；類比讀值用 GPIO 32–35（0–4095）；GPIO 0/2/12/15 是開機腳位避免佔用；I2C 預設 SDA=GPIO 21、SCL=GPIO 22。腳位最充裕，元件多就選它。',
      'esp32cam（AI Thinker）：相機占走大部分內部腳位，可自由使用的只有 GPIO 13/14/15（GPIO 4 是板載閃光燈）——最多再接一兩個簡單元件（如 PIR）；5V 供電；適合影像類應用（拍照、串流、Teachable Machine）。',
      'nano（Arduino Nano）：無 WiFi，凡是要 MQTT/HTTP/連網的需求一律建議改用 esp32；5V 邏輯；I2C 固定 A4(SDA)/A5(SCL)；類比 A0–A7（0–1023）；適合離線的顯示、警報、伺服小專案。',
      '',
      '【工業配線模式（ind）】台灣工配（丙級／乙級）教學：雙電壓域＝三相主迴路（R/S/T）＋110V 控制迴路（C1/C2），兩域不可混接。',
      '元件與端子：POWER（R/S/T/C1/C2，線電壓可調，可模擬停電）、NFB（1-2/3-4/5-6，雙擊開關）、FUSE 保險絲（同 NFB 端子，常通）、MC 電磁接觸器（主 1-2/3-4/5-6；線圈 A1-A2；輔助 a 13-14、b 21-22）、TR 限時電驛（A1-A2；延時 b 55-56、延時 a 67-68；秒數可調）、MK 電力電驛（A1-A2；a 13-14/23-24；b 21-22）、TH-RY（主串接；b 95-96；a 97-98 跳脫閉合；過載整定可調，電流超過會真的熱跳脫）、CO 過電流電驛 51（同 TH-RY 端子，跳脫更快，整定可調）、STOP＝pb_nc（1-2）、START＝pb_no（3-4）、COS（A 位 1-2／B 位 3-4）、GL/RL/BZ（X1/X2）、motor（U/V/W，運轉電流可調——調大會讓保護電驛跳脫）、motor6（U1V1W1＋U2V2W2）、VM 電壓表（P1/P2 跨兩相）、AM 電流表（1-2 串一相）、SC 電容器組（U/V/W）、TX 控制變壓器（P1/P2 跨兩相→S1/S2 出 110V 控制電源）、ATS（常用 1/3/5、備用 7/9/11、輸出 2/4/6，自動切換）、GEN 發電機（GR/GS/GT，停電自動起動 AMF，起動延時可調）、PLC（L/N、COM→X0-X7、C0＋Y0-Y7）。',
      '接線鐵則：控制迴路從 C1（或 TX 的 S1）出發：STOP（b）串 START（a）串 MC 線圈 A1，A2 經 TH-RY 95-96 回 C2（或 S2）；自保持＝MC 13-14 並聯 START；正逆轉／Y-Δ 的兩顆 MC 線圈必須互串對方 21-22（電氣互鎖）。發電機絕不可與市電直接相連，必須經 ATS；受電盤的控制電源（TX）要取在 ATS 之後。工具：ind_load_preset 載入 30 個三級範例、ind_add_part／ind_wire 自由配線（「標籤:端子」如 MC1:13）、ind_control 通電操作（含 outage 模擬停電、set_param 調參數）、ind_status 看現況（含各元件可調參數）。接線後 ERC 有 error 必須修到通過才能通電。',
      '',
      '【PLC】梯形圖模型：每階＝欄串聯（AND），每欄可疊 2 個接點（並聯 OR），線圈在最右。位址：X0-X7 輸入、Y0-Y7 輸出、M0-M7 內部繼電器、T0-T3 TON 計時器（秒）、C0-C3 CTU 計數器。自保持範式：(X0 OR Y0) AND X1 → OUT Y0（STOP 實體接 b 接點、程式用常開 X1）。用 plc_program 讀寫程式；盤面要有 plc 元件且 L/N 接 C1/C2 才會執行；輸出 Y 得電＝Y 端子與 C0 導通。匯出檔含 IEC 61131-3 ST（program.st）與 IO 對照表。',
      '',
      '【電路常識】LED 必須串 220Ω 限流電阻；LDR/NTC 要與定值電阻分壓後接類比腳；電解電容「＋」接高電位、二極體 K 朝電源側做反接保護；模組電源腳旁可加 100nF 陶瓷電容去耦；水泵/大電流負載要經繼電器或 MOSFET，不可由 GPIO 直接驅動。不確定某元件細節時先呼叫 get_part_info。',
      '',
      '【行為守則】',
      '1. 使用者要求的功能若能用上述元件組合實現，就用工具直接完成；若超出範圍（如 GPS、藍牙、4G、資料庫、螢幕觸控等），明確回答「目前的元件庫無法實現」並說明缺什麼，切勿硬做或假裝完成。',
      '2. 使用者「提問或請教」時：先簡短解釋，結尾問「需要我直接幫你做嗎？」，取得同意才動手。使用者下「明確指令」（幫我做／生成／加上／改成／測試）時直接動手，不再確認。',
      '3. 動手後用一兩句總結：方案標題、關鍵腳位、檢查是否全過；工具回傳的 checks 有 ERROR 時必須告知並給修法。',
      '4. 你看不到畫面；回答現況相關問題前先呼叫 get_state。',
      '5. 使用者在自由編輯途中求助時，優先用 editor_add_part／editor_remove_part 等小步驟工具幫忙，不要擅自 generate_plan 蓋掉他的作品；要整組重做前先確認。',
      '6. 模擬通電失敗代表接線有誤，轉述失敗原因並提供修正建議。'
    ].join('\n');
  }

  /* ================= 模型呼叫（@google/genai，REST 備援） ================= */
  function loadSdk() {
    if (!st.sdkPromise) {
      st.sdkPromise = import('https://esm.run/@google/genai')
        .catch(() => import('https://cdn.jsdelivr.net/npm/@google/genai/+esm'))
        .catch(() => null);
    }
    return st.sdkPromise;
  }

  async function callModel(contents) {
    const key = getKey();
    const model = getModel();
    const config = { systemInstruction: systemPrompt(), tools: [{ functionDeclarations: DECLS }] };
    const mod = await loadSdk();
    if (mod && mod.GoogleGenAI) {
      const ai = new mod.GoogleGenAI({ apiKey: key });
      const r = await ai.models.generateContent({ model, contents, config });
      const content = (r.candidates && r.candidates[0] && r.candidates[0].content) || { role: 'model', parts: [{ text: r.text || '' }] };
      return { text: r.text || '', functionCalls: r.functionCalls || [], content };
    }
    // REST 備援（無法載入 SDK 時，走同一個 v1beta 端點）
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt() }] },
        tools: [{ functionDeclarations: DECLS }]
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`API ${res.status}：${t.slice(0, 220)}`);
    }
    const data = await res.json();
    const content = (data.candidates && data.candidates[0] && data.candidates[0].content) || { role: 'model', parts: [] };
    const parts = content.parts || [];
    return {
      text: parts.filter(p => p.text).map(p => p.text).join(''),
      functionCalls: parts.filter(p => p.functionCall).map(p => p.functionCall),
      content
    };
  }

  /* ================= 對話迴圈 ================= */
  async function send(userText) {
    if (st.busy) return;
    if (!getKey()) { toggleSettings(true); note('請先輸入 Google API Key 啟用助手（金鑰只存在你的瀏覽器）。'); return; }
    st.busy = true;
    setBusyUi(true);
    addMsg('user', userText);
    st.history.push({ role: 'user', parts: [{ text: userText }] });
    try {
      let rounds = 0;
      for (;;) {
        const r = await callModel(st.history);
        st.history.push(r.content);
        if (r.functionCalls.length && rounds < MAX_TOOL_ROUNDS) {
          rounds++;
          const responses = [];
          for (const fc of r.functionCalls) {
            addToolChip(fc.name);
            const result = await runTool(fc.name, fc.args);
            responses.push({ functionResponse: { name: fc.name, response: { result } } });
          }
          st.history.push({ role: 'user', parts: responses });
          continue;
        }
        addMsg('agent', r.text || '（完成）');
        break;
      }
    } catch (e) {
      let msg = String(e.message || e);
      if (/API 400/.test(msg) && /API key/i.test(msg)) msg = 'API Key 無效，請檢查後重新輸入。';
      if (/API 40[13]/.test(msg)) msg = 'API Key 無效或無權限，請檢查後重新輸入。';
      if (/API 429/.test(msg)) msg = '已達免費層速率上限，稍等一下再試。';
      addMsg('agent', '⚠ ' + msg);
    } finally {
      st.busy = false;
      setBusyUi(false);
      saveChat();
    }
  }

  /* ================= 模型清單 ================= */
  async function refreshModels() {
    const key = getKey();
    if (!key) { note('先輸入 API Key 才能載入模型清單。'); return; }
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const names = (data.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''))
        .filter(n => /gemma|gemini/.test(n));
      if (names.length) {
        fillModels([...new Set([...names])]);
        note(`已載入 ${names.length} 個可用模型。`);
      }
    } catch (e) {
      note('載入模型清單失敗：' + (e.message || e));
    }
  }

  function fillModels(list) {
    const sel = st.els.modelSel;
    const cur = getModel();
    sel.innerHTML = '';
    const all = [...new Set([cur, ...list])];
    for (const m of all) {
      const o = document.createElement('option');
      o.value = m; o.textContent = m;
      sel.appendChild(o);
    }
    sel.value = cur;
  }

  /* ================= UI ================= */
  function h(tag, cls, html) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html !== undefined) el.innerHTML = html;
    return el;
  }
  const escT = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function renderMsgDom(who, text) {
    const el = h('div', 'ag-msg ag-' + who);
    el.innerHTML = escT(text).replace(/\n/g, '<br>');
    st.els.msgs.appendChild(el);
    st.els.msgs.scrollTop = st.els.msgs.scrollHeight;
  }
  function renderChipDom(name) {
    const el = h('div', 'ag-tool', `⚙ ${escT(name)}`);
    st.els.msgs.appendChild(el);
    st.els.msgs.scrollTop = st.els.msgs.scrollHeight;
  }
  function addMsg(who, text) {
    renderMsgDom(who, text);
    st.display.push({ who, text });
    if (st.display.length > 80) st.display.shift();
  }
  function addToolChip(name) {
    renderChipDom(name);
    st.display.push({ who: 'tool', text: name });
  }
  function note(text) { addMsg('agent', text); }

  function setBusyUi(busy) {
    st.els.sendBtn.disabled = busy;
    st.els.input.disabled = busy;
    st.els.typing.hidden = !busy;
    if (!busy) st.els.input.focus();
  }

  function toggleSettings(force) {
    const s = st.els.settings;
    s.hidden = force === true ? false : force === false ? true : !s.hidden;
  }

  function buildUi() {
    const fab = h('button', 'ag-fab');
    fab.type = 'button';
    fab.title = 'LAB AGENT 助手';
    fab.innerHTML = '<svg viewBox="0 0 40 40" width="26" height="26"><circle cx="20" cy="25" r="6.5" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M14.5 19 L9 9 M20 17.5 L20 6 M25.5 19 L31 9" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="9" cy="9" r="2" fill="currentColor"/><circle cx="20" cy="6" r="2" fill="currentColor"/><circle cx="31" cy="9" r="2" fill="currentColor"/></svg>';

    const panel = h('div', 'ag-panel');
    panel.hidden = true;
    panel.innerHTML = `
      <div class="ag-head">
        <span class="ag-title">LAB AGENT</span>
        <span class="ag-model-tag" data-modeltag></span>
        <button type="button" class="ag-icon" data-gear title="設定">⚙</button>
        <button type="button" class="ag-icon" data-close title="關閉">✕</button>
      </div>
      <div class="ag-settings" data-settings hidden>
        <label>Google API Key（僅存於瀏覽器 localStorage）</label>
        <div class="ag-row">
          <input type="password" data-key placeholder="AIza...">
          <button type="button" data-savekey>儲存</button>
          <button type="button" data-clearkey>清除</button>
        </div>
        <label>模型</label>
        <div class="ag-row">
          <select data-model></select>
          <button type="button" data-refresh title="從 API 載入可用模型">↻ 清單</button>
          <button type="button" data-clearchat title="清除對話紀錄">🗑 對話</button>
        </div>
        <p class="ag-hint">預設 gemma-4-31b-it（Gemini API 免費層、支援 function calling）。金鑰可於 aistudio.google.com 免費取得。</p>
      </div>
      <div class="ag-msgs" data-msgs></div>
      <div class="ag-typing" data-typing hidden><span></span><span></span><span></span> 思考中</div>
      <div class="ag-inputrow">
        <textarea data-input rows="1" placeholder="例：幫我做一個土壤過乾自動澆水並回報的裝置"></textarea>
        <button type="button" data-send>送出</button>
      </div>`;

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    st.els = {
      fab, panel,
      msgs: panel.querySelector('[data-msgs]'),
      input: panel.querySelector('[data-input]'),
      sendBtn: panel.querySelector('[data-send]'),
      typing: panel.querySelector('[data-typing]'),
      settings: panel.querySelector('[data-settings]'),
      keyInput: panel.querySelector('[data-key]'),
      modelSel: panel.querySelector('[data-model]'),
      modelTag: panel.querySelector('[data-modeltag]')
    };
    fillModels(DEFAULT_MODELS);
    st.els.modelTag.textContent = getModel();

    fab.addEventListener('click', () => {
      st.open = !st.open;
      panel.hidden = !st.open;
      if (st.open) {
        if (!st.els.msgs.children.length) {
          if (!getKey()) { toggleSettings(true); note('嗨，我是 LAB AGENT。先在上方輸入 Google API Key（免費，aistudio.google.com 可取得）即可啟用。之後可以叫我：「幫我做一個煙霧警報器」、「PIR 改接 GPIO 15」、「通電測試看看」。'); }
          else note('嗨，我是 LAB AGENT，這個實驗室的所有工具我都能操作。可以叫我生成方案、改腳位、加元件、通電模擬或匯出專案；也可以隨時問我問題。');
        }
        st.els.input.focus();
      }
    });
    panel.querySelector('[data-close]').addEventListener('click', () => { st.open = false; panel.hidden = true; });
    panel.querySelector('[data-gear]').addEventListener('click', () => toggleSettings());
    panel.querySelector('[data-savekey]').addEventListener('click', () => {
      const v = st.els.keyInput.value.trim();
      if (v) { localStorage.setItem(LS_KEY, v); toggleSettings(false); note('金鑰已儲存，助手已啟用。'); refreshModels(); }
    });
    panel.querySelector('[data-clearkey]').addEventListener('click', () => {
      localStorage.removeItem(LS_KEY);
      st.els.keyInput.value = '';
      note('金鑰已清除。');
    });
    panel.querySelector('[data-refresh]').addEventListener('click', refreshModels);
    panel.querySelector('[data-clearchat]').addEventListener('click', () => {
      st.history = [];
      st.display = [];
      st.els.msgs.innerHTML = '';
      if (window.CF && CF.Store) CF.Store.del('chat');
      note('對話紀錄已清除。');
    });
    st.els.modelSel.addEventListener('change', () => {
      localStorage.setItem(LS_MODEL, st.els.modelSel.value);
      st.els.modelTag.textContent = st.els.modelSel.value;
    });

    const doSend = () => {
      const v = st.els.input.value.trim();
      if (!v || st.busy) return;
      st.els.input.value = '';
      send(v);
    };
    st.els.sendBtn.addEventListener('click', doSend);
    st.els.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });

    restoreChat();   // 還原上次的對話紀錄（IndexedDB）
  }

  document.addEventListener('DOMContentLoaded', buildUi);
})();
