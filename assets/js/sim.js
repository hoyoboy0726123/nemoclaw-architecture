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
    ledUntil: 0, beepUntil: 0, lastBeepAt: 0,
    outputs: { led: false, buzzer: false, relay: false, servo: 0, gateOpen: false, oled: [], flash: false },
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
    S.ledUntil = 0; S.beepUntil = 0; S.lastBeepAt = 0;
    S.outputs = { led: false, buzzer: false, relay: false, servo: 0, gateOpen: false, oled: [], flash: false };
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
    setBeep(false);
  }

  /* ---------------- WebAudio 蜂鳴 ---------------- */
  function ensureAudio() {
    if (S.audioCtx) return;
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
      if (has('camera')) { out.flash = true; pushLog('sys', 'camera', '[CAM] motion -> capture（模擬拍照）'); setTimeout(() => { out.flash = false; }, 350); }
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
      if (has('led') && has('bh1750')) out.led = inp.lux < 200;
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
      if (S.t - S.lastBeepAt > interval) { S.lastBeepAt = S.t; S.beepUntil = S.t + 60; }
    }

    /* 輸出狀態 */
    if (has('pir') && has('led')) out.led = S.t < S.ledUntil;
    out.buzzer = has('buzzer') && S.t < S.beepUntil;
    setBeep(out.buzzer);
    out.oled = oledLines();

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
    if (has('pir')) f.push(`"motion":${S.t < S.motionUntil ? 1 : 0}`);
    if (has('button')) f.push(`"button":${S.buttonHeld ? 1 : 0}`);
    return f.length ? `{${f.join(',')}}` : null;
  }

  function oledLines() {
    if (!has('oled')) return [];
    const inp = S.inputs;
    const lines = [];
    if (has('dht11')) lines.push(['TEMP', `${(+inp.temp).toFixed(1)} C`], ['HUMI', `${Math.round(inp.humi)} %`]);
    else if (has('bme280')) lines.push(['TEMP', `${(+inp.bmeTemp).toFixed(1)} C`]);
    if (has('bme280')) lines.push(['PRES', `${Math.round(inp.pressure)} hPa`]);
    if (has('bh1750')) lines.push(['LUX', `${Math.round(inp.lux)}`]);
    if (has('hcsr04')) lines.push(['DIST', `${(+inp.dist).toFixed(1)} cm`]);
    if (has('soil')) lines.push(['SOIL', `${Math.round(inp.soil)}`]);
    return lines.slice(0, 4);
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
  }

  return {
    load, start, stop, cmd,
    pulseMotion() { S.motionUntil = S.t + 2500; },
    setButton(v) { S.buttonHeld = !!v; },
    setInput(k, v) { S.inputs[k] = +v; },
    state: S,
    setHooks(h) { S.onTick = h.onTick; S.onLog = h.onLog; }
  };
})();
