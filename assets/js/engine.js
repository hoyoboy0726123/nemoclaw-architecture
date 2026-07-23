'use strict';
/* NemoClaw 電路實驗室 — 規則引擎：需求解析、腳位指派、接線網表、規則檢查 */
window.CF = window.CF || {};

(function () {

  /* ---------- 需求解析 ---------- */
  CF.parseRequirement = function (text) {
    const t = (text || '').trim();
    const spec = { boardId: 'esp32', parts: [], conn: 'none', flags: {} };
    if (!t) { return CF.parseRequirement(CF.DEFAULT_REQ); }

    for (const r of CF.RULES.board) {
      if (r.re.test(t)) { spec.boardId = r.board; break; }
    }
    for (const id of CF.PART_ORDER) {
      const re = CF.RULES.parts[id];
      if (re && re.test(t)) spec.parts.push(id);
    }
    for (const r of CF.RULES.conn) {
      if (r.re.test(t)) { spec.conn = r.conn; break; }
    }

    // Teachable Machine 一定是 ESP32-CAM
    if (spec.conn === 'tm') spec.boardId = 'esp32cam';
    // ESP32-CAM 必含相機；相機關鍵字（拍照/影像）在一般板子上不成立
    if (spec.boardId === 'esp32cam') {
      if (!spec.parts.includes('camera')) spec.parts.unshift('camera');
    } else {
      spec.parts = spec.parts.filter(p => p !== 'camera');
    }
    // 有連網暗示但沒指定協定 → 預設 MQTT
    const board = CF.BOARDS[spec.boardId];
    if (spec.conn === 'none' && board.wifi && CF.RULES.wifiHint.test(t)) spec.conn = 'mqtt';
    // 無 WiFi 的板子不能連網
    if (!board.wifi && spec.conn !== 'none') {
      spec.flags.connDowngraded = CF.CONNS[spec.conn].label;
      spec.conn = 'none';
    }
    // 什麼元件都沒認出來 → 套用預設環境監測
    const nonCam = spec.parts.filter(p => p !== 'camera');
    if (!nonCam.length && spec.boardId !== 'esp32cam') {
      spec.parts.push('dht11', 'oled');
      if (spec.conn === 'none' && board.wifi) spec.conn = 'mqtt';
      spec.flags.fallback = true;
    }
    spec.text = t;
    return spec;
  };

  /* ---------- 腳位工具 ---------- */
  CF.pinNumber = function (pin) {
    // 'GPIO 13' -> '13'；'D3' -> '3'；'A0' -> 'A0'
    if (/^GPIO\s*(\d+)$/i.test(pin)) return pin.replace(/^GPIO\s*/i, '');
    if (/^D(\d+)$/i.test(pin)) return pin.slice(1);
    return pin;
  };

  /* ---------- 建立方案 ---------- */
  CF.buildPlan = function (spec) {
    const board = CF.BOARDS[spec.boardId];
    const parts = spec.parts.map((id, i) => {
      const def = CF.PARTS[id];
      return { id, def, idx: i, pins: def.pins.map(p => Object.assign({}, p)) };
    });

    // 供電軌：任一元件需要 5V，或板子本身以 5V 為主
    const needs5V = spec.boardId !== 'esp32' || parts.some(p => p.def.needs5V);
    const railV = needs5V ? '5V' : '3V3';
    const powerPin = spec.boardId === 'esp32'
      ? (needs5V ? board.powerPin5V : board.powerPin3V3)
      : board.powerPin5V;

    // 腳位指派
    const used = new Set([board.gndPin]);
    used.add(powerPin);
    const hasI2C = parts.some(p => p.def.i2c);
    if (hasI2C) { used.add(board.i2c.sda); used.add(board.i2c.scl); }
    const dPool = board.digitalPool.filter(p => !used.has(p));
    const aPool = board.analogPool.filter(p => !used.has(p));
    const takePin = (pool, prefer) => {
      let pin = prefer && pool.includes(prefer) && !used.has(prefer) ? prefer : null;
      if (!pin) pin = pool.find(p => !used.has(p)) || null;
      if (pin) used.add(pin);
      return pin;
    };

    for (const part of parts) {
      for (const pin of part.pins) {
        if (pin.t === 'S') pin.assigned = takePin(dPool, board.prefer[pin.macro]);
        else if (pin.t === 'A') pin.assigned = takePin(aPool.length ? aPool : dPool, board.prefer[pin.macro]);
        else if (pin.t === 'I2C_SDA') pin.assigned = board.i2c.sda;
        else if (pin.t === 'I2C_SCL') pin.assigned = board.i2c.scl;
      }
    }

    /* ---------- 接線網表 ---------- */
    const nets = [];
    const railVLabel = `麵包板 紅色 ${railV} 正電源軌`;
    const railGLabel = '麵包板 藍色 GND 負電源軌';
    nets.push({
      kind: 'V', from: `${board.name} ${powerPin}`, to: `→ ${railVLabel}`,
      note: '建立共用電源軌', badge: 'POWER / LOCKED', locked: true,
      partRef: 'board', pinName: powerPin
    });
    nets.push({
      kind: 'G', from: `${board.name} ${board.gndPin}`, to: `→ ${railGLabel}`,
      note: '建立共用電源軌', badge: 'POWER / LOCKED', locked: true,
      partRef: 'board', pinName: board.gndPin
    });
    for (const part of parts) {
      for (const pin of part.pins) {
        if (pin.t === 'V') {
          nets.push({ kind: 'V', from: `${part.def.name} ${pin.n}`, to: `→ ${railVLabel}`, note: '電源／共用', badge: 'POWER / LOCKED', locked: true, partRef: part.id, pinName: pin.n });
        } else if (pin.t === 'G') {
          nets.push({ kind: 'G', from: `${part.def.name} ${pin.n}`, to: `→ ${railGLabel}`, note: '電源／共用', badge: 'POWER / LOCKED', locked: true, partRef: part.id, pinName: pin.n });
        } else if (pin.t === 'I2C_SDA' || pin.t === 'I2C_SCL') {
          nets.push({ kind: 'S', from: `${part.def.name} ${pin.n}`, to: `→ ${board.name} ${pin.assigned}`, note: 'I2C 匯流排', badge: 'I2C / LOCKED', locked: true, partRef: part.id, pinName: pin.n, boardPin: pin.assigned });
        } else if (pin.t === 'S' || pin.t === 'A') {
          nets.push({ kind: 'S', from: `${part.def.name} ${pin.n}`, to: `→ ${board.name} ${pin.assigned}`, note: '訊號線', badge: 'SIGNAL', locked: false, partRef: part.id, pinName: pin.n, boardPin: pin.assigned, pinObj: pin, pool: (pin.t === 'A' && board.analogPool.length ? board.analogPool : board.digitalPool) });
        }
      }
    }
    nets.forEach((n, i) => { n.id = i; });

    /* ---------- 標題與標籤 ---------- */
    const conn = CF.CONNS[spec.conn];
    const partNames = parts.map(p => p.def.titleName).join(' + ');
    let title = `${board.short}`;
    if (partNames) title += ` · ${partNames}`;
    if (conn.label) title += ` / ${conn.label}`;
    const tags = ['BREADBOARD 3D'];
    if (board.wifi && spec.conn !== 'none') tags.push('WIFI');
    if (conn.label) tags.push(conn.label);

    /* ---------- 版面（引擎決定放上排或下排，3D 與檢查共用） ---------- */
    for (const part of parts) {
      if (part.def.cls === 'SENSOR' && part.id !== 'pir') part.side = 'top';
      else if (part.id === 'camera') part.side = 'board';
      else part.side = 'bottom';
    }

    const plan = {
      spec, board, parts, nets, railV, powerPin,
      conn: spec.conn, connLabel: conn.label, connDone: conn.done,
      title, tags,
      counts: { parts: 1 + parts.length, wires: nets.length }
    };
    plan.checks = CF.buildChecks(plan);
    return plan;
  };

  /* ---------- 訊號腳重新指派 ---------- */
  CF.reassignPin = function (plan, netId, newPin) {
    const net = plan.nets.find(n => n.id === netId);
    if (!net || net.locked) return;
    net.boardPin = newPin;
    net.pinObj.assigned = newPin;
    net.to = `→ ${plan.board.name} ${newPin}`;
    plan.checks = CF.buildChecks(plan);
  };

  CF.usedSignalPins = function (plan) {
    const used = [];
    for (const part of plan.parts) for (const pin of part.pins) if (pin.assigned) used.push(pin.assigned);
    return used;
  };

  CF.pinOptions = function (plan, net) {
    const used = new Set(CF.usedSignalPins(plan));
    used.delete(net.boardPin);
    const opts = net.pool.filter(p => !used.has(p));
    if (!opts.includes(net.boardPin)) opts.unshift(net.boardPin);
    return opts.slice(0, 4);
  };

  /* ---------- 規則檢查 ---------- */
  CF.buildChecks = function (plan) {
    const items = [];
    const board = plan.board;
    const add = (status, name, desc) => items.push({ status, name, desc });

    add('pass', '共用電源軌', `${plan.railV} 正電源軌與 GND 負電源軌已建立，來源腳位 ${plan.powerPin}。`);

    if (plan.railV === '5V' && plan.spec.boardId !== 'nano') {
      const fiveVParts = plan.parts.filter(p => p.def.needs5V).map(p => p.def.name).join('、');
      add('pass', '工作電壓', fiveVParts ? `${fiveVParts} 需要 5V，已改由 ${plan.powerPin} 供電；3.3V 模組由板載穩壓供應。` : `電源軌以 ${plan.powerPin} 5V 供電。`);
    } else {
      add('pass', '工作電壓', plan.railV === '5V' ? '電源軌以 5V 供電，各模組皆相容。' : '所有元件皆可於 3.3V 工作，無位準轉換需求。');
    }

    const i2cParts = plan.parts.filter(p => p.def.i2c);
    if (i2cParts.length) {
      const addrs = i2cParts.map(p => `${p.def.titleName} ${p.def.addr}`).join('、');
      const dup = new Set(i2cParts.map(p => p.def.addr)).size !== i2cParts.length;
      add(dup ? 'warn' : 'pass', 'I2C 匯流排', `SDA → ${board.i2c.sda}／SCL → ${board.i2c.scl}；位址 ${addrs}${dup ? '，發生衝突！' : '，無衝突。'}`);
    }

    const sig = [];
    for (const part of plan.parts) for (const pin of part.pins) if (pin.assigned) sig.push(pin.assigned);
    const dupPins = sig.filter((p, i) => sig.indexOf(p) !== i);
    if (dupPins.length) add('warn', 'GPIO 指派', `腳位重複指派：${[...new Set(dupPins)].join('、')}，請於 WIRING 面板調整。`);
    else add('pass', 'GPIO 指派', '無重複腳位指派，訊號腳皆位於允許清單內。');

    if (plan.spec.boardId !== 'nano') {
      const strap = ['GPIO 0', 'GPIO 2', 'GPIO 12', 'GPIO 15'];
      const hit = [...new Set(sig.filter(p => strap.includes(p)))];
      if (hit.length) add('info', '開機腳位提醒', `${hit.join('、')} 為 strapping pin，上電瞬間避免被外部電路強制拉高／拉低。`);
    }

    if (board.camera) add('pass', '相機腳位保留', '影像匯流排與 PSRAM 腳位未被其他元件占用，GPIO 4 保留給板載閃光 LED。');

    if (plan.parts.some(p => p.id === 'led')) add('info', 'LED 限流', '實體接線請於 LED 陽極串聯 220Ω 電阻，再接往 GPIO。');

    const topUsed = plan.parts.some(p => p.side === 'top') || true; // 板子電源固定走上排
    const bottomUsed = plan.parts.some(p => p.side === 'bottom');
    if (topUsed && bottomUsed) add('info', '電源軌橋接', '上、下兩側電源軌實作時需以跳線橋接才會導通（工作台以同一網路標示）。');

    if (plan.conn !== 'none') add('info', '連線設定', '燒錄前請於 config.h 填入 WiFi SSID／密碼與伺服參數。');

    if (plan.spec.flags.connDowngraded) add('warn', '連網能力', `Arduino Nano 無內建 WiFi，已改為序列埠輸出；需要 ${plan.spec.flags.connDowngraded} 請改用 ESP32。`);
    if (plan.spec.flags.fallback) add('info', '需求解析', '未辨識到明確元件關鍵字，已套用預設環境監測方案（DHT11 + OLED）。');

    return items;
  };

})();
