'use strict';
/* NemoClaw 電路實驗室 — 行為模擬器
 * 不模擬 CPU 指令，而是執行「生成韌體的行為語意」：
 * 規則與 codegen.js 產生的 main.cpp 邏輯一一對應（門檻值、配對規則、發布週期皆相同）。
 * ERC 檢查未通過（status === 'error'）時拒絕通電。
 */
window.CF = window.CF || {};

CF.Sim = (function () {
  const S = {
    plan: null, running: false, timer: null,
    t: 0, lastPublish: 0,
    inputs: {},                 // 虛擬感測值
    motionUntil: 0, buttonHeld: false, prevMotion: false, prevButton: false,
    ledUntil: 0, beepUntil: 0, lastBeepAt: 0, stripUntil: 0,
    encoderPos: 0, stripCmd: 'off', pumpCmd: false,
    outputs: { led: false, buzzer: false, relay: false, servo: 0, gateOpen: false, oled: [], lcd: [], flash: false, pump: false, strip: 'off', encoderPos: 0 },
    log: [],
    audioCtx: null, osc: null, gain: null,
    onTick: null, onLog: null
  };
  const TICK = 200;

  const has = id => S.plan && S.plan.parts.some(p => p.id === id);

  function pushLog(dir, topic, payload) {
    S.log.push({ t: Math.round(S.t / 1000), dir, topic, payload });
    if (S.log.length > 40) S.log.shift();
    if (S.onLog) S.onLog(S.log);
  }

  /* ---------------- 載入 / 通電 / 斷電 ---------------- */
  function load(plan) {
    stop();
    S.plan = plan;
    S.t = 0; S.lastPublish = 0; S.log = [];
    S.inputs = {};
    if (plan) {
      for (const part of plan.parts) {
        for (const inp of (CF.SIM_INPUTS[part.id] || [])) S.inputs[inp.key] = inp.init;
      }
    }
    S.motionUntil = 0; S.buttonHeld = false; S.prevMotion = false; S.prevButton = false;
    S.ledUntil = 0; S.beepUntil = 0; S.lastBeepAt = 0; S.stripUntil = 0;
    S.encoderPos = 0; S.stripCmd = 'off'; S.pumpCmd = false;
    S.outputs = { led: false, buzzer: false, relay: false, servo: 0, gateOpen: false, oled: [], lcd: [], flash: false, pump: false, strip: 'off', encoderPos: 0 };
  }

  function start() {
    if (!S.plan) return { ok: false, msg: '尚無方案可模擬' };
    const err = (S.plan.checks || []).find(c => c.status === 'error');
    if (err) return { ok: false, msg: `${err.name} — ${err.desc}` };
    if (S.running) return { ok: true };
    S.running = true;
    ensureAudio();
    S.timer = setInterval(tick, TICK);
    pushLog('sys', 'power', '通電，韌體開始執行（行為模擬）');
    return { ok: true };
  }

  function stop() {
    S.running = false;
    if (S.timer) { clearInterval(S.timer); S.timer = null; }
    if (S.flashT) { clearTimeout(S.flashT); S.flashT = null; }
    setBeep(false);
  }

  /* ---------------- WebAudio 蜂鳴 ---------------- */
  function ensureAudio() {
    if (S.audioCtx) {
      if (S.audioCtx.state === 'suspended') S.audioCtx.resume().catch(() => {});
      return;
    }
    try {
      S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      S.osc = S.audioCtx.createOscillator();
      S.osc.type = 'square';
      S.osc.frequency.value = 2200;
      S.gain = S.audioCtx.createGain();
      S.gain.gain.value = 0;
      S.osc.connect(S.gain).connect(S.audioCtx.destination);
      S.osc.start();
    } catch (e) { /* 無音訊環境 */ }
  }
  function setBeep(on) {
    if (S.gain) S.gain.gain.setTargetAtTime(on ? 0.045 : 0, S.audioCtx.currentTime, 0.01);
  }

  /* ---------------- 主迴圈（對應 loop()） ---------------- */
  function tick() {
    S.t += TICK;
    const inp = S.inputs;
    const out = S.outputs;
    const motion = S.t < S.motionUntil;
    const pressed = S.buttonHeld;

    /* PIR 事件（上升緣）——對應 if (motion && !lastMotion) */
    if (has('pir') && motion && !S.prevMotion) {
      pushLog('sys', 'serial', '[PIR] motion detected');
      if (S.plan.conn === 'mqtt') pushLog('out', 'telemetry', '{"event":"motion"}');
      if (has('led')) S.ledUntil = S.t + 8000;
      if (has('buzzer')) S.beepUntil = S.t + 600;
      if (has('ws2812')) S.stripUntil = S.t + 8000;
      if (has('camera')) { out.flash = true; pushLog('sys', 'camera', '[CAM] motion -> capture（模擬拍照）'); if (S.flashT) clearTimeout(S.flashT); S.flashT = setTimeout(() => { out.flash = false; S.flashT = null; }, 350); }
    }
    S.prevMotion = motion;

    /* 按鈕事件（緣觸發）——對應 if (pressed != lastButtonState) */
    if (has('button') && pressed !== S.prevButton) {
      S.prevButton = pressed;
      if (pressed) {
        pushLog('sys', 'serial', '[BTN] pressed');
        if (S.plan.conn === 'mqtt') pushLog('out', 'telemetry', '{"event":"button"}');
        if (has('servo')) { out.gateOpen = !out.gateOpen; out.servo = out.gateOpen ? 90 : 0; }
        if (has('buzzer') && !has('hcsr04')) S.beepUntil = S.t + 150;
      }
    }

    /* 定時區——每 5 秒 readSensors + 配對規則 + 發布 */
    if (S.t - S.lastPublish >= 5000) {
      S.lastPublish = S.t;
      if (has('buzzer') && has('dht11') && inp.temp >= 32) S.beepUntil = S.t + 400;      // TEMP_ALERT
      if (has('buzzer') && has('mq2') && inp.smoke >= 2200) S.beepUntil = S.t + 400;     // SMOKE_ALERT
      if (has('buzzer') && has('mpu6050') && inp.accel >= 15) S.beepUntil = S.t + 500;   // ACCEL_ALERT
      if (has('led') && has('bh1750')) out.led = inp.lux < 200;
      if (has('led') && has('mq2')) out.led = inp.smoke >= 2200;
      if (has('relay') && has('bh1750')) out.relay = inp.lux < 150;
      if (has('led') && has('soil')) out.led = inp.soil > (S.plan.spec.boardId === 'nano' ? 600 : 2800);
      if (has('led') && has('hcsr04')) out.led = inp.dist > 0 && inp.dist < 30;
      const fields = telemetryFields();
      if (fields && S.plan.conn === 'mqtt') pushLog('out', 'telemetry', fields);
      if (has('camera') && !has('pir') && S.plan.conn === 'mqtt' && S.t % 60000 < 5000) {
        pushLog('out', 'telemetry', '{"event":"interval","bytes":18234}');
      }
    }

    /* 停車雷達——距離越近提示越急促 */
    if (has('buzzer') && has('hcsr04') && inp.dist > 0 && inp.dist < 60) {
      const interval = inp.dist * 8 + 40;
      if (S.t - S.lastBeepAt > interval) { S.lastBeepAt = S.t; S.beepUntil = S.t + 30; }   // 與產生韌體的 30ms 對齊
    }

    /* 輸出狀態 */
    if (has('pir') && has('led')) out.led = S.t < S.ledUntil;
    out.buzzer = has('buzzer') && S.t < S.beepUntil;
    setBeep(out.buzzer);

    /* 水泵：土壤配對優先，否則遠端指令 */
    if (has('pump')) out.pump = has('soil') ? inp.soil > (S.plan.spec.boardId === 'nano' ? 600 : 2800) : S.pumpCmd;

    /* 伺服：電位器 > 編碼器 > 按鈕／指令 */
    if (has('servo')) {
      if (has('pot')) out.servo = Math.round(inp.pot / 4095 * 180);
      else if (has('encoder')) out.servo = Math.max(0, Math.min(180, S.encoderPos * 2));
    }
    out.encoderPos = S.encoderPos;

    /* WS2812 燈條 */
    if (has('ws2812')) {
      if (S.t < S.stripUntil) out.strip = 'red';
      else if (has('bh1750')) out.strip = inp.lux < 200 ? 'warm' : 'off';
      else out.strip = S.stripCmd;
    }

    out.oled = has('oled') ? displayLines(4) : [];
    out.lcd = has('lcd1602') ? displayLines(2) : [];

    if (S.onTick) S.onTick(S);
  }

  function telemetryFields() {
    const inp = S.inputs;
    const f = [];
    if (has('dht11')) f.push(`"temp":${(+inp.temp).toFixed(1)}`, `"humi":${Math.round(inp.humi)}`);
    if (has('bme280')) f.push(`"bme_temp":${(+inp.bmeTemp).toFixed(1)}`, `"pressure":${(+inp.pressure).toFixed(1)}`);
    if (has('bh1750')) f.push(`"lux":${Math.round(inp.lux)}`);
    if (has('hcsr04')) f.push(`"distance":${(+inp.dist).toFixed(1)}`);
    if (has('soil')) f.push(`"soil":${Math.round(inp.soil)}`);
    if (has('ds18b20')) f.push(`"water_temp":${(+inp.waterTemp).toFixed(1)}`);
    if (has('mpu6050')) f.push(`"accel":${(+inp.accel).toFixed(2)}`);
    if (has('mq2')) f.push(`"smoke":${Math.round(inp.smoke)}`);
    if (has('pot')) f.push(`"pot":${Math.round(inp.pot)}`);
    if (has('encoder')) f.push(`"encoder":${S.encoderPos}`);
    if (has('pump')) f.push(`"pump":${S.outputs.pump ? 1 : 0}`);
    if (has('pir')) f.push(`"motion":${S.t < S.motionUntil ? 1 : 0}`);
    if (has('button')) f.push(`"button":${S.buttonHeld ? 1 : 0}`);
    return f.length ? `{${f.join(',')}}` : null;
  }

  function displayLines(max) {
    const inp = S.inputs;
    const lines = [];
    if (has('dht11')) lines.push(['TEMP', `${(+inp.temp).toFixed(1)} C`], ['HUMI', `${Math.round(inp.humi)} %`]);
    else if (has('bme280')) lines.push(['TEMP', `${(+inp.bmeTemp).toFixed(1)} C`]);
    if (has('bme280')) lines.push(['PRES', `${Math.round(inp.pressure)} hPa`]);
    if (has('ds18b20')) lines.push(['WTR', `${(+inp.waterTemp).toFixed(1)} C`]);
    if (has('bh1750')) lines.push(['LUX', `${Math.round(inp.lux)}`]);
    if (has('mpu6050')) lines.push(['ACC', `${(+inp.accel).toFixed(1)}`]);
    if (has('mq2')) lines.push(['SMK', `${Math.round(inp.smoke)}`]);
    if (has('hcsr04')) lines.push(['DIST', `${(+inp.dist).toFixed(1)} cm`]);
    if (has('soil')) lines.push(['SOIL', `${Math.round(inp.soil)}`]);
    return lines.slice(0, max);
  }

  /* ---------------- 遠端指令（對應 mqttCallback） ---------------- */
  function cmd(text) {
    const c = String(text).trim();
    if (!c) return;
    pushLog('in', 'cmd', c);
    const out = S.outputs;
    if (!S.running) { pushLog('sys', 'serial', '（未通電，指令無效）'); return; }
    if (has('relay')) {
      if (c === 'on') out.relay = true;
      if (c === 'off') out.relay = false;
    }
    if (has('servo')) {
      if (c === 'open') { out.gateOpen = true; out.servo = 90; }
      if (c === 'close') { out.gateOpen = false; out.servo = 0; }
      const angle = parseInt(c, 10);
      if (angle > 0 && angle <= 180) out.servo = angle;
    }
    if (has('led') && !has('pir') && !has('bh1750') && !has('hcsr04')) {
      if (c === 'on') out.led = true;
      if (c === 'off') out.led = false;
    }
    if (has('pump') && !has('soil')) {
      if (c === 'on') S.pumpCmd = true;
      if (c === 'off') S.pumpCmd = false;
    }
    if (has('ws2812') && !has('bh1750')) {
      if (c === 'on') S.stripCmd = 'white';
      if (c === 'off') S.stripCmd = 'off';
    }
  }

  return {
    load, start, stop, cmd,
    pulseMotion() { S.motionUntil = S.t + 2500; },
    setButton(v) { S.buttonHeld = !!v; },
    setInput(k, v) { S.inputs[k] = +v; },
    encoderDelta(d) { S.encoderPos += d; },
    encoderPress() { S.encoderPos = 0; },
    state: S,
    setHooks(h) { S.onTick = h.onTick; S.onLog = h.onLog; }
  };
})();
