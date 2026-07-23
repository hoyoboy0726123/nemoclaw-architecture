'use strict';
/* NemoClaw 電路實驗室 — 程式碼產生器：main.cpp / platformio.ini / config.h / circuit.json */
window.CF = window.CF || {};

(function () {
  const Q = '\\"'; // C 字串中的跳脫雙引號

  const pinVal = pin => CF.pinNumber(pin || '0');
  const has = (plan, id) => plan.parts.some(p => p.id === id);
  const macroPin = (plan, macro) => {
    for (const part of plan.parts) for (const pin of part.pins) if (pin.macro === macro) return pin.assigned;
    return null;
  };

  /* ================= 通用韌體 ================= */
  function genGeneric(plan) {
    const P = id => has(plan, id);
    const esp32 = plan.spec.boardId !== 'nano';
    const wifi = plan.conn !== 'none';
    const mqtt = plan.conn === 'mqtt';
    const http = plan.conn === 'http';
    const web = plan.conn === 'web';
    const i2c = plan.parts.some(p => p.def.i2c);

    const inc = [];
    const needWire = () => { if (!inc.includes('#include <Wire.h>')) inc.push('#include <Wire.h>'); };
    const defs = [];
    const globals = [];
    const helpers = [];
    const setup = [];
    const timed = [];   // 每 5 秒
    const fast = [];    // 每圈
    const jsonF = [];   // {k, fmt, arg}
    const oledF = [];   // {label, arg, digits, unit}

    /* ---- 感測與輸出元件 ---- */
    if (P('dht11')) {
      inc.push('#include <DHT.h>');
      defs.push(`#define DHT_PIN ${pinVal(macroPin(plan, 'DHT_PIN'))}`, '#define DHT_TYPE DHT11', 'DHT dht(DHT_PIN, DHT_TYPE);');
      globals.push('float valTemperature = 0, valHumidity = 0;');
      setup.push('  dht.begin();');
      timed.push('  valTemperature = dht.readTemperature();', '  valHumidity = dht.readHumidity();');
      jsonF.push({ k: 'temp', fmt: '%.1f', arg: 'valTemperature' }, { k: 'humi', fmt: '%.0f', arg: 'valHumidity' });
      oledF.push({ label: 'TEMP ', arg: 'valTemperature', digits: 1, unit: ' C' }, { label: 'HUMI ', arg: 'valHumidity', digits: 0, unit: ' %' });
    }
    if (P('bme280')) {
      needWire();
      inc.push('#include <Adafruit_BME280.h>');
      defs.push('Adafruit_BME280 bme;');
      globals.push('float valBmeTemp = 0, valPressure = 0;');
      setup.push('  if (!bme.begin(0x76)) Serial.println("[BME280] not found, check wiring");');
      timed.push('  valBmeTemp = bme.readTemperature();', '  valPressure = bme.readPressure() / 100.0F;');
      jsonF.push({ k: 'bme_temp', fmt: '%.1f', arg: 'valBmeTemp' }, { k: 'pressure', fmt: '%.1f', arg: 'valPressure' });
      oledF.push({ label: 'PRES ', arg: 'valPressure', digits: 0, unit: ' hPa' });
      if (!P('dht11')) oledF.unshift({ label: 'TEMP ', arg: 'valBmeTemp', digits: 1, unit: ' C' });
    }
    if (P('bh1750')) {
      needWire();
      inc.push('#include <BH1750.h>');
      defs.push('BH1750 lightMeter;');
      globals.push('float valLux = 0;');
      setup.push('  lightMeter.begin();');
      timed.push('  valLux = lightMeter.readLightLevel();');
      jsonF.push({ k: 'lux', fmt: '%.0f', arg: 'valLux' });
      oledF.push({ label: 'LUX  ', arg: 'valLux', digits: 0, unit: '' });
    }
    if (P('hcsr04')) {
      defs.push(`#define TRIG_PIN ${pinVal(macroPin(plan, 'TRIG_PIN'))}`, `#define ECHO_PIN ${pinVal(macroPin(plan, 'ECHO_PIN'))}`);
      globals.push('float valDistance = -1;');
      setup.push('  pinMode(TRIG_PIN, OUTPUT);', '  pinMode(ECHO_PIN, INPUT);');
      helpers.push(
        'float readDistanceCm() {',
        '  digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);',
        '  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);',
        '  digitalWrite(TRIG_PIN, LOW);',
        '  long duration = pulseIn(ECHO_PIN, HIGH, 30000UL);',
        '  if (duration == 0) return -1;',
        '  return duration * 0.0343f / 2.0f;',
        '}');
      timed.push('  valDistance = readDistanceCm();');
      jsonF.push({ k: 'distance', fmt: '%.1f', arg: 'valDistance' });
      oledF.push({ label: 'DIST ', arg: 'valDistance', digits: 1, unit: ' cm' });
    }
    if (P('soil')) {
      defs.push(`#define SOIL_PIN ${pinVal(macroPin(plan, 'SOIL_PIN'))}`, `#define SOIL_DRY_RAW ${esp32 ? 2800 : 600}  // 高於此原始值視為過乾`);
      globals.push('int valSoil = 0;');
      timed.push('  valSoil = analogRead(SOIL_PIN);');
      jsonF.push({ k: 'soil', fmt: '%d', arg: 'valSoil' });
      oledF.push({ label: 'SOIL ', arg: 'valSoil', digits: -1, unit: '' });
    }
    if (P('pir')) {
      defs.push(`#define PIR_PIN ${pinVal(macroPin(plan, 'PIR_PIN'))}`);
      globals.push('bool lastMotion = false;');
      setup.push('  pinMode(PIR_PIN, INPUT);');
      jsonF.push({ k: 'motion', fmt: '%d', arg: '(int)lastMotion' });
    }
    if (P('button')) {
      defs.push(`#define BUTTON_PIN ${pinVal(macroPin(plan, 'BUTTON_PIN'))}`);
      globals.push('bool lastButtonState = false;');
      setup.push('  pinMode(BUTTON_PIN, INPUT_PULLUP);');
      jsonF.push({ k: 'button', fmt: '%d', arg: '(int)lastButtonState' });
    }
    if (P('led')) {
      defs.push(`#define LED_PIN ${pinVal(macroPin(plan, 'LED_PIN'))}`);
      setup.push('  pinMode(LED_PIN, OUTPUT);');
      if (P('pir')) globals.push('unsigned long ledUntil = 0;');
    }
    if (P('buzzer')) {
      defs.push(`#define BUZZER_PIN ${pinVal(macroPin(plan, 'BUZZER_PIN'))}`);
      globals.push('unsigned long beepUntil = 0;');
      setup.push('  pinMode(BUZZER_PIN, OUTPUT);');
      if (P('hcsr04')) globals.push('unsigned long lastBeepAt = 0;');
      if (P('dht11')) defs.push('#define TEMP_ALERT 32.0  // 高溫警報門檻 (C)');
    }
    if (P('servo')) {
      inc.push(esp32 ? '#include <ESP32Servo.h>' : '#include <Servo.h>');
      defs.push(`#define SERVO_PIN ${pinVal(macroPin(plan, 'SERVO_PIN'))}`, 'Servo gateServo;');
      globals.push('bool gateOpen = false;');
      setup.push('  gateServo.attach(SERVO_PIN);', '  gateServo.write(0);');
    }
    if (P('relay')) {
      defs.push(`#define RELAY_PIN ${pinVal(macroPin(plan, 'RELAY_PIN'))}`);
      globals.push('bool relayState = false;');
      setup.push('  pinMode(RELAY_PIN, OUTPUT);');
    }
    if (P('oled')) {
      needWire();
      inc.push('#include <Adafruit_GFX.h>', '#include <Adafruit_SSD1306.h>');
      defs.push('#define SCREEN_WIDTH 128', '#define SCREEN_HEIGHT 64', 'Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);');
      setup.push(
        '  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("[OLED] not found, check wiring");',
        '  display.clearDisplay();',
        '  display.setTextSize(1);',
        '  display.setTextColor(SSD1306_WHITE);',
        '  display.setCursor(0, 0);',
        '  display.print("NEMOCLAW LAB READY");',
        '  display.display();');
    }
    /* ---- 連線堆疊 ---- */
    if (wifi) {
      inc.push('#include <WiFi.h>');
      if (mqtt) inc.push('#include <PubSubClient.h>');
      if (http || web) inc.push('#include <WebServer.h>');
      inc.push('#include "config.h"');
      globals.unshift('unsigned long lastWifiAttempt = 0;');
      if (mqtt) {
        globals.unshift(
          'WiFiClient wifiClient;',
          'PubSubClient mqtt(wifiClient);',
          'unsigned long lastPublish = 0;',
          'unsigned long lastMqttAttempt = 0;',
          'bool remoteEnabled = false;');
      }
      if (http || web) globals.unshift('WebServer server(80);');
    }

    /* ---- readSensors / buildJson ---- */
    const readFn = ['void readSensors() {', ...timed];
    for (const f of jsonF) {
      if (f.fmt === '%d') readFn.push(`  Serial.print("${f.k}: "); Serial.println(${f.arg});`);
      else readFn.push(`  Serial.print("${f.k}: "); Serial.println(${f.arg}, 1);`);
    }
    readFn.push('}');

    const jsonFn = [];
    if (jsonF.length) {
      const fmt = '{' + jsonF.map(f => `${Q}${f.k}${Q}:${f.fmt}`).join(',') + '}';
      jsonFn.push(
        'String buildJson() {',
        '  char buf[192];',
        `  snprintf(buf, sizeof(buf), "${fmt}",`,
        '           ' + jsonF.map(f => f.arg).join(', ') + ');',
        '  return String(buf);',
        '}');
    }

    /* ---- OLED 更新 ---- */
    const oledFn = [];
    if (P('oled')) {
      oledFn.push('void updateDisplay() {', '  display.clearDisplay();', '  display.setTextSize(1);', '  display.setTextColor(SSD1306_WHITE);');
      oledF.slice(0, 4).forEach((f, i) => {
        oledFn.push(`  display.setCursor(0, ${i * 14});`);
        oledFn.push(`  display.print("${f.label}");`);
        oledFn.push(f.digits >= 0 ? `  display.print(${f.arg}, ${f.digits});` : `  display.print(${f.arg});`);
        if (f.unit) oledFn.push(`  display.print("${f.unit}");`);
      });
      if (!oledF.length) oledFn.push('  display.setCursor(0, 0);', '  display.print("RUNNING");');
      oledFn.push('  display.display();', '}');
    }

    /* ---- WiFi / MQTT / Server helpers ---- */
    const conn = [];
    if (wifi) {
      conn.push(
        'void connectWiFi() {',
        '  if (WiFi.status() == WL_CONNECTED) return;',
        '  if (millis() - lastWifiAttempt < 5000) return;',
        '  lastWifiAttempt = millis();',
        '  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);',
        '  Serial.println("[WiFi] connecting...");',
        '}');
    }
    if (mqtt) {
      const cb = ['void mqttCallback(char* topic, byte* payload, unsigned int length) {',
        '  String cmd;',
        '  for (unsigned int i = 0; i < length; i++) cmd += (char)payload[i];',
        '  Serial.print("[MQTT] cmd: "); Serial.println(cmd);'];
      if (P('relay')) cb.push('  if (cmd == "on")  { relayState = true;  digitalWrite(RELAY_PIN, HIGH); }', '  if (cmd == "off") { relayState = false; digitalWrite(RELAY_PIN, LOW); }');
      if (P('servo')) cb.push('  if (cmd == "open")  { gateOpen = true;  gateServo.write(90); }', '  if (cmd == "close") { gateOpen = false; gateServo.write(0); }', '  int angle = cmd.toInt();', '  if (angle > 0 && angle <= 180) gateServo.write(angle);');
      if (P('led') && !P('pir') && !P('bh1750') && !P('hcsr04')) cb.push('  if (cmd == "on")  digitalWrite(LED_PIN, HIGH);', '  if (cmd == "off") digitalWrite(LED_PIN, LOW);');
      cb.push('  remoteEnabled = (cmd == "1" || cmd == "on");', '}');
      conn.push(...cb, '',
        'void connectMqtt() {',
        '  if (WiFi.status() != WL_CONNECTED || mqtt.connected()) return;',
        '  if (millis() - lastMqttAttempt < 5000) return;',
        '  lastMqttAttempt = millis();',
        '  mqtt.setServer(MQTT_HOST, MQTT_PORT);',
        '  mqtt.setCallback(mqttCallback);',
        '  if (mqtt.connect(DEVICE_ID)) {',
        '    mqtt.subscribe(MQTT_CMD_TOPIC);',
        '    Serial.println("[MQTT] connected");',
        '  }',
        '}');
    }
    if (http || web) {
      conn.push('void handleData() {', '  server.send(200, "application/json", buildJson());', '}');
      if (web) {
        const page = [
          '<!DOCTYPE html><html lang=zh-Hant><meta charset=utf-8>',
          '<meta name=viewport content="width=device-width,initial-scale=1">',
          '<title>NEMOCLAW LAB NODE</title>',
          '<style>body{background:#0b0a08;color:#e8e4da;font-family:monospace;padding:24px}',
          'h1{color:#ff5a3c;font-size:18px}#data{font-size:15px;line-height:1.8}',
          'button{background:#ff5a3c;border:0;color:#160502;padding:8px 14px;font-family:monospace;cursor:pointer}</style>',
          '<h1>NEMOCLAW LAB / LOCAL NODE</h1><pre id=data>loading...</pre>'
        ];
        if (P('led')) page.push('<button onclick="cmd(1)">LED ON</button> <button onclick="cmd(0)">LED OFF</button>');
        page.push(
          '<script>',
          'function tick(){fetch("/api/data").then(function(r){return r.json()}).then(function(j){',
          'document.getElementById("data").textContent=JSON.stringify(j,null,2)})}',
          P('led') ? 'function cmd(v){fetch("/api/led?state="+v)}' : '',
          'setInterval(tick,2000);tick();',
          '</scr' + 'ipt>');
        conn.push('', 'void handleRoot() {', '  server.send(200, "text/html", F(R"rawliteral(', ...page.filter(Boolean), ')rawliteral"));', '}');
        if (P('led')) conn.push('', 'void handleLed() {', '  digitalWrite(LED_PIN, server.arg("state") == "1" ? HIGH : LOW);', '  server.send(200, "text/plain", "ok");', '}');
      }
    }

    /* ---- setup ---- */
    const setupFn = ['void setup() {', '  Serial.begin(115200);'];
    if (i2c) setupFn.push(esp32 ? `  Wire.begin(${pinVal(plan.board.i2c.sda)}, ${pinVal(plan.board.i2c.scl)});` : '  Wire.begin();');
    setupFn.push(...setup);
    if (wifi) setupFn.push('  WiFi.mode(WIFI_STA);', '  connectWiFi();');
    if (http || web) {
      if (web) setupFn.push('  server.on("/", handleRoot);');
      setupFn.push('  server.on("/api/data", handleData);');
      if (web && P('led')) setupFn.push('  server.on("/api/led", handleLed);');
      setupFn.push('  server.begin();', '  Serial.println("[HTTP] server started on port 80");');
    }
    setupFn.push('}');

    /* ---- loop ---- */
    const loopFn = ['void loop() {'];
    if (wifi) loopFn.push('  connectWiFi();');
    if (mqtt) loopFn.push('  connectMqtt();', '  mqtt.loop();');
    if (http || web) loopFn.push('  server.handleClient();');
    loopFn.push('', `  if (millis() - ${mqtt ? 'lastPublish' : 'lastRead'} >= 5000) {`, `    ${mqtt ? 'lastPublish' : 'lastRead'} = millis();`, '    readSensors();');
    if (P('oled')) loopFn.push('    updateDisplay();');
    if (mqtt && jsonF.length) loopFn.push('    if (mqtt.connected()) mqtt.publish(MQTT_TOPIC, buildJson().c_str());');
    // 定時區的配對邏輯
    if (P('buzzer') && P('dht11')) loopFn.push('    if (valTemperature >= TEMP_ALERT) beepUntil = millis() + 400;  // 高溫警報');
    if (P('led') && P('bh1750')) loopFn.push('    digitalWrite(LED_PIN, valLux < 200 ? HIGH : LOW);  // 光線不足亮燈');
    if (P('relay') && P('bh1750')) loopFn.push('    relayState = valLux < 150;  // 光照不足自動補光', '    digitalWrite(RELAY_PIN, relayState ? HIGH : LOW);');
    if (P('led') && P('soil')) loopFn.push('    digitalWrite(LED_PIN, valSoil > SOIL_DRY_RAW ? HIGH : LOW);  // 土壤過乾提醒');
    if (P('led') && P('hcsr04')) loopFn.push('    digitalWrite(LED_PIN, (valDistance > 0 && valDistance < 30) ? HIGH : LOW);  // 距離過近警示');
    loopFn.push('  }');

    // 每圈快速邏輯
    if (P('pir')) {
      loopFn.push('', '  bool motion = digitalRead(PIR_PIN) == HIGH;', '  if (motion && !lastMotion) {', '    Serial.println("[PIR] motion detected");');
      if (mqtt) loopFn.push(`    if (mqtt.connected()) mqtt.publish(MQTT_TOPIC, "{${Q}event${Q}:${Q}motion${Q}}");`);
      if (P('led')) loopFn.push('    ledUntil = millis() + 8000;');
      if (P('buzzer')) loopFn.push('    beepUntil = millis() + 600;');
      loopFn.push('  }', '  lastMotion = motion;');
      if (P('led')) loopFn.push('  digitalWrite(LED_PIN, millis() < ledUntil ? HIGH : LOW);');
    }
    if (P('button')) {
      loopFn.push('', '  bool pressed = digitalRead(BUTTON_PIN) == LOW;', '  if (pressed != lastButtonState) {', '    lastButtonState = pressed;', '    if (pressed) {', '      Serial.println("[BTN] pressed");');
      if (mqtt) loopFn.push(`      if (mqtt.connected()) mqtt.publish(MQTT_TOPIC, "{${Q}event${Q}:${Q}button${Q}}");`);
      if (P('servo')) loopFn.push('      gateOpen = !gateOpen;', '      gateServo.write(gateOpen ? 90 : 0);');
      if (P('buzzer') && !P('hcsr04')) loopFn.push('      beepUntil = millis() + 150;');
      loopFn.push('    }', '  }');
    }
    if (P('buzzer') && P('hcsr04')) {
      loopFn.push('', '  if (valDistance > 0 && valDistance < 60) {  // 距離越近，提示越急促',
        '    unsigned long interval = (unsigned long)(valDistance * 8) + 40;',
        '    if (millis() - lastBeepAt > interval) { lastBeepAt = millis(); beepUntil = millis() + 30; }',
        '  }');
    }
    if (P('buzzer')) loopFn.push('  digitalWrite(BUZZER_PIN, millis() < beepUntil ? HIGH : LOW);');
    loopFn.push('}');

    if (!mqtt) globals.push('unsigned long lastRead = 0;');

    const out = [
      ...inc, '',
      ...globals, '',
      ...defs, '',
      ...helpers, helpers.length ? '' : null,
      ...readFn, '',
      ...jsonFn, jsonFn.length ? '' : null,
      ...oledFn, oledFn.length ? '' : null,
      ...conn, conn.length ? '' : null,
      ...setupFn, '',
      ...loopFn, ''
    ].filter(l => l !== null);
    return out.join('\n');
  }

  /* ================= ESP32-CAM：串流 / Teachable Machine ================= */
  function genCamServer(plan, tmMode) {
    const pir = has(plan, 'pir');
    const pirPin = pir ? pinVal(macroPin(plan, 'PIR_PIN')) : null;
    const lines = [
      '#include <WiFi.h>',
      '#include <WebServer.h>',
      '#include "esp_camera.h"',
      '#include "config.h"',
      '',
      '// AI Thinker ESP32-CAM 相機腳位',
      '#define PWDN_GPIO_NUM  32', '#define RESET_GPIO_NUM -1', '#define XCLK_GPIO_NUM   0',
      '#define SIOD_GPIO_NUM  26', '#define SIOC_GPIO_NUM  27',
      '#define Y9_GPIO_NUM    35', '#define Y8_GPIO_NUM    34', '#define Y7_GPIO_NUM    39', '#define Y6_GPIO_NUM    36',
      '#define Y5_GPIO_NUM    21', '#define Y4_GPIO_NUM    19', '#define Y3_GPIO_NUM    18', '#define Y2_GPIO_NUM     5',
      '#define VSYNC_GPIO_NUM 25', '#define HREF_GPIO_NUM  23', '#define PCLK_GPIO_NUM  22',
      ''
    ];
    if (pir) lines.push(`#define PIR_PIN ${pirPin}`, 'volatile unsigned long lastMotionAt = 0;', 'bool lastMotion = false;', '');
    lines.push(
      'WebServer server(80);',
      'unsigned long lastWifiAttempt = 0;',
      '',
      'bool initCamera() {',
      '  camera_config_t config;',
      '  config.ledc_channel = LEDC_CHANNEL_0;',
      '  config.ledc_timer   = LEDC_TIMER_0;',
      '  config.pin_d0 = Y2_GPIO_NUM;  config.pin_d1 = Y3_GPIO_NUM;',
      '  config.pin_d2 = Y4_GPIO_NUM;  config.pin_d3 = Y5_GPIO_NUM;',
      '  config.pin_d4 = Y6_GPIO_NUM;  config.pin_d5 = Y7_GPIO_NUM;',
      '  config.pin_d6 = Y8_GPIO_NUM;  config.pin_d7 = Y9_GPIO_NUM;',
      '  config.pin_xclk = XCLK_GPIO_NUM;',
      '  config.pin_pclk = PCLK_GPIO_NUM;',
      '  config.pin_vsync = VSYNC_GPIO_NUM;',
      '  config.pin_href = HREF_GPIO_NUM;',
      '  config.pin_sccb_sda = SIOD_GPIO_NUM;',
      '  config.pin_sccb_scl = SIOC_GPIO_NUM;',
      '  config.pin_pwdn = PWDN_GPIO_NUM;',
      '  config.pin_reset = RESET_GPIO_NUM;',
      '  config.xclk_freq_hz = 20000000;',
      '  config.pixel_format = PIXFORMAT_JPEG;',
      '  config.frame_size = psramFound() ? FRAMESIZE_VGA : FRAMESIZE_QVGA;',
      '  config.jpeg_quality = 12;',
      '  config.fb_count = psramFound() ? 2 : 1;',
      '  return esp_camera_init(&config) == ESP_OK;',
      '}',
      '',
      'void handleCapture() {',
      '  camera_fb_t* fb = esp_camera_fb_get();',
      '  if (!fb) { server.send(503, "text/plain", "capture failed"); return; }',
      '  server.sendHeader("Cache-Control", "no-store");',
      '  server.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);',
      '  esp_camera_fb_return(fb);',
      '}',
      '');
    if (pir) lines.push(
      'void handleStatus() {',
      `  String json = "{${Q}motion_ms_ago${Q}:";`,
      '  json += (lastMotionAt == 0) ? -1 : (long)(millis() - lastMotionAt);',
      '  json += "}";',
      '  server.send(200, "application/json", json);',
      '}',
      '');

    // 首頁（含 Teachable Machine 前端整合）
    const page = [
      '<!DOCTYPE html><html lang=zh-Hant><meta charset=utf-8>',
      '<meta name=viewport content="width=device-width,initial-scale=1">',
      '<title>ESP32-CAM ' + (tmMode ? '/ TEACHABLE MACHINE' : 'STREAM') + '</title>',
      '<style>body{background:#0b0a08;color:#e8e4da;font-family:monospace;padding:24px;max-width:720px;margin:auto}',
      'h1{color:#ff5a3c;font-size:16px;letter-spacing:.08em}img{width:100%;border:1px solid #2a2721}',
      'input{width:70%;background:#141310;border:1px solid #2a2721;color:#e8e4da;padding:8px;font-family:monospace}',
      'button{background:#ff5a3c;border:0;color:#160502;padding:8px 14px;font-family:monospace;cursor:pointer}',
      '#label{font-size:20px;color:#4ade80;margin-top:12px}#motion{color:#f5c33b}</style>',
      '<h1>NEMOCLAW LAB / ESP32-CAM' + (tmMode ? ' + TEACHABLE MACHINE' : '') + '</h1>',
      '<img id=cam src=/capture>'
    ];
    if (pir) page.push('<div id=motion>PIR: --</div>');
    if (tmMode) {
      page.push(
        '<p>1. 於 <b>teachablemachine.withgoogle.com</b> 訓練影像模型並匯出（上傳）取得模型網址。<br>',
        '2. 貼上網址後按「載入模型」，本頁會持續擷取影像並就地分類。</p>',
        '<input id=murl placeholder="https://teachablemachine.withgoogle.com/models/xxxx/">',
        '<button onclick=loadModel()>載入模型</button>',
        '<div id=label>MODEL NOT LOADED</div>',
        '<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4/dist/tf.min.js"></scr' + 'ipt>',
        '<script src="https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8/dist/teachablemachine-image.min.js"></scr' + 'ipt>');
    }
    page.push('<script>', 'var model=null;', 'var img=document.getElementById("cam");',
      'function refresh(){img.src="/capture?t="+Date.now();}',
      'img.onload=function(){' + (tmMode ? 'classify();' : '') + 'setTimeout(refresh,600);};',
      'img.onerror=function(){setTimeout(refresh,1500);};');
    if (tmMode) page.push(
      'function loadModel(){var u=document.getElementById("murl").value.trim();if(u.slice(-1)!=="/")u+="/";',
      'tmImage.load(u+"model.json",u+"metadata.json").then(function(m){model=m;',
      'document.getElementById("label").textContent="MODEL READY";});}',
      'function classify(){if(!model)return;model.predict(img).then(function(r){',
      'r.sort(function(a,b){return b.probability-a.probability});',
      'document.getElementById("label").textContent=r[0].className+"  "+(r[0].probability*100).toFixed(1)+"%";});}');
    if (pir) page.push(
      'setInterval(function(){fetch("/status").then(function(r){return r.json()}).then(function(j){',
      'var s=j.motion_ms_ago;document.getElementById("motion").textContent=',
      '"PIR: "+(s<0?"no motion yet":(s<4000?"MOTION!":Math.round(s/1000)+"s ago"));});},1000);');
    page.push('</scr' + 'ipt>');

    lines.push('void handleRoot() {', '  server.send(200, "text/html", F(R"rawliteral(', ...page, ')rawliteral"));', '}', '');
    lines.push(
      'void setup() {',
      '  Serial.begin(115200);');
    if (pir) lines.push('  pinMode(PIR_PIN, INPUT);');
    lines.push(
      '  if (!initCamera()) Serial.println("[CAM] init failed");',
      '  WiFi.mode(WIFI_STA);',
      '  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);',
      '  while (WiFi.status() != WL_CONNECTED && millis() < 15000) delay(200);',
      '  server.on("/", handleRoot);',
      '  server.on("/capture", handleCapture);');
    if (pir) lines.push('  server.on("/status", handleStatus);');
    lines.push(
      '  server.begin();',
      '  Serial.print("[HTTP] open http://"); Serial.println(WiFi.localIP());',
      '}',
      '',
      'void loop() {',
      '  server.handleClient();');
    if (pir) lines.push(
      '  bool motion = digitalRead(PIR_PIN) == HIGH;',
      '  if (motion && !lastMotion) {',
      '    lastMotionAt = millis();',
      '    Serial.println("[PIR] motion detected");',
      '  }',
      '  lastMotion = motion;');
    lines.push('  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiAttempt > 5000) {', '    lastWifiAttempt = millis();', '    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);', '  }', '}', '');
    return lines.join('\n');
  }

  /* ================= ESP32-CAM：MQTT 拍照 ================= */
  function genCamMqtt(plan) {
    const pir = has(plan, 'pir');
    const pirPin = pir ? pinVal(macroPin(plan, 'PIR_PIN')) : null;
    const lines = [
      '#include <WiFi.h>',
      '#include <PubSubClient.h>',
      '#include "esp_camera.h"',
      '#include "config.h"',
      '',
      '// AI Thinker ESP32-CAM 相機腳位（完整定義見 circuit.json）',
      '#define PWDN_GPIO_NUM  32', '#define RESET_GPIO_NUM -1', '#define XCLK_GPIO_NUM   0',
      '#define SIOD_GPIO_NUM  26', '#define SIOC_GPIO_NUM  27',
      '#define Y9_GPIO_NUM    35', '#define Y8_GPIO_NUM    34', '#define Y7_GPIO_NUM    39', '#define Y6_GPIO_NUM    36',
      '#define Y5_GPIO_NUM    21', '#define Y4_GPIO_NUM    19', '#define Y3_GPIO_NUM    18', '#define Y2_GPIO_NUM     5',
      '#define VSYNC_GPIO_NUM 25', '#define HREF_GPIO_NUM  23', '#define PCLK_GPIO_NUM  22',
      '#define FLASH_PIN 4',
      ''
    ];
    if (pir) lines.push(`#define PIR_PIN ${pirPin}`, 'bool lastMotion = false;', '');
    lines.push(
      'WiFiClient wifiClient;',
      'PubSubClient mqtt(wifiClient);',
      'unsigned long lastWifiAttempt = 0;',
      'unsigned long lastMqttAttempt = 0;',
      pir ? 'unsigned long lastAlertAt = 0;' : 'unsigned long lastShotAt = 0;',
      '',
      'bool initCamera() {',
      '  camera_config_t config;',
      '  config.ledc_channel = LEDC_CHANNEL_0;',
      '  config.ledc_timer   = LEDC_TIMER_0;',
      '  config.pin_d0 = Y2_GPIO_NUM;  config.pin_d1 = Y3_GPIO_NUM;',
      '  config.pin_d2 = Y4_GPIO_NUM;  config.pin_d3 = Y5_GPIO_NUM;',
      '  config.pin_d4 = Y6_GPIO_NUM;  config.pin_d5 = Y7_GPIO_NUM;',
      '  config.pin_d6 = Y8_GPIO_NUM;  config.pin_d7 = Y9_GPIO_NUM;',
      '  config.pin_xclk = XCLK_GPIO_NUM;   config.pin_pclk = PCLK_GPIO_NUM;',
      '  config.pin_vsync = VSYNC_GPIO_NUM; config.pin_href = HREF_GPIO_NUM;',
      '  config.pin_sccb_sda = SIOD_GPIO_NUM;',
      '  config.pin_sccb_scl = SIOC_GPIO_NUM;',
      '  config.pin_pwdn = PWDN_GPIO_NUM;   config.pin_reset = RESET_GPIO_NUM;',
      '  config.xclk_freq_hz = 20000000;',
      '  config.pixel_format = PIXFORMAT_JPEG;',
      '  config.frame_size = psramFound() ? FRAMESIZE_VGA : FRAMESIZE_QVGA;',
      '  config.jpeg_quality = 12;',
      '  config.fb_count = psramFound() ? 2 : 1;',
      '  return esp_camera_init(&config) == ESP_OK;',
      '}',
      '',
      'void connectWiFi() {',
      '  if (WiFi.status() == WL_CONNECTED) return;',
      '  if (millis() - lastWifiAttempt < 5000) return;',
      '  lastWifiAttempt = millis();',
      '  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);',
      '}',
      '',
      'void connectMqtt() {',
      '  if (WiFi.status() != WL_CONNECTED || mqtt.connected()) return;',
      '  if (millis() - lastMqttAttempt < 5000) return;',
      '  lastMqttAttempt = millis();',
      '  mqtt.setServer(MQTT_HOST, MQTT_PORT);',
      '  if (mqtt.connect(DEVICE_ID)) Serial.println("[MQTT] connected");',
      '}',
      '',
      '// 拍照並發布事件（影像本體可另存 SD 或上傳伺服器）',
      'void captureAndPublish(const char* reason) {',
      '  digitalWrite(FLASH_PIN, HIGH);',
      '  camera_fb_t* fb = esp_camera_fb_get();',
      '  digitalWrite(FLASH_PIN, LOW);',
      '  if (!fb) { Serial.println("[CAM] capture failed"); return; }',
      '  char msg[128];',
      `  snprintf(msg, sizeof(msg), "{${Q}event${Q}:${Q}%s${Q},${Q}bytes${Q}:%u,${Q}uptime_s${Q}:%lu}",`,
      '           reason, fb->len, millis() / 1000UL);',
      '  esp_camera_fb_return(fb);',
      '  if (mqtt.connected()) mqtt.publish(MQTT_TOPIC, msg);',
      '  Serial.println(msg);',
      '}',
      '',
      'void setup() {',
      '  Serial.begin(115200);',
      '  pinMode(FLASH_PIN, OUTPUT);');
    if (pir) lines.push('  pinMode(PIR_PIN, INPUT);');
    lines.push(
      '  if (!initCamera()) Serial.println("[CAM] init failed");',
      '  WiFi.mode(WIFI_STA);',
      '  connectWiFi();',
      '}',
      '',
      'void loop() {',
      '  connectWiFi();',
      '  connectMqtt();',
      '  mqtt.loop();');
    if (pir) lines.push(
      '',
      '  bool motion = digitalRead(PIR_PIN) == HIGH;',
      '  if (motion && !lastMotion && millis() - lastAlertAt > 10000) {  // 10 秒冷卻',
      '    lastAlertAt = millis();',
      '    Serial.println("[PIR] motion -> capture");',
      '    captureAndPublish("motion");',
      '  }',
      '  lastMotion = motion;');
    else lines.push(
      '',
      '  if (millis() - lastShotAt >= 60000) {  // 每分鐘定時拍照',
      '    lastShotAt = millis();',
      '    captureAndPublish("interval");',
      '  }');
    lines.push('}', '');
    return lines.join('\n');
  }

  /* ================= platformio.ini / config.h / circuit.json ================= */
  function genPio(plan) {
    const libs = new Set();
    for (const part of plan.parts) {
      (part.def.libs || []).forEach(l => libs.add(l));
      if (part.id === 'servo') (plan.spec.boardId === 'nano' ? part.def.libsAvr : part.def.libsEsp32).forEach(l => libs.add(l));
    }
    if (plan.conn === 'mqtt' || (plan.board.camera && plan.conn === 'mqtt')) libs.add('knolleary/PubSubClient@^2.8');
    const lines = [
      `; NemoClaw 電路實驗室 產生 — ${plan.title}`,
      `[env:${plan.board.pio.board}]`,
      `platform = ${plan.board.pio.platform}`,
      `board = ${plan.board.pio.board}`,
      'framework = arduino',
      'monitor_speed = 115200'
    ];
    if (plan.spec.boardId === 'esp32cam') lines.push('board_build.f_cpu = 240000000L', 'build_flags = -DBOARD_HAS_PSRAM');
    if (libs.size) {
      lines.push('lib_deps =');
      [...libs].forEach(l => lines.push(`\t${l}`));
    }
    lines.push('');
    return lines.join('\n');
  }

  function genConfig(plan) {
    const lines = [
      '#pragma once',
      '',
      '// ---- WiFi ----',
      '#define WIFI_SSID     "YOUR_WIFI_SSID"',
      '#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"',
      '',
      `#define DEVICE_ID "nemoclaw-${plan.board.id}-01"`
    ];
    if (plan.conn === 'mqtt') {
      lines.push(
        '',
        '// ---- MQTT ----',
        '#define MQTT_HOST "broker.hivemq.com"',
        '#define MQTT_PORT 1883',
        `#define MQTT_TOPIC     "nemoclaw-lab/${plan.board.id}/telemetry"`,
        `#define MQTT_CMD_TOPIC "nemoclaw-lab/${plan.board.id}/cmd"`);
    }
    lines.push('');
    return lines.join('\n');
  }

  function genCircuitJson(plan) {
    const data = {
      generator: 'nemoclaw-circuit-lab',
      version: 1,
      title: plan.title,
      board: { id: plan.board.id, name: plan.board.name },
      power_rail: plan.railV,
      connectivity: plan.connLabel || 'NONE',
      parts: plan.parts.map(p => ({ id: p.id, name: p.def.name, class: p.def.cls })),
      nets: plan.nets.map(n => ({
        id: n.id + 1,
        kind: n.kind === 'V' ? 'POWER_V' : n.kind === 'G' ? 'POWER_GND' : 'SIGNAL',
        from: n.from,
        to: n.to.replace(/^→ /, ''),
        board_pin: n.boardPin || null,
        locked: !!n.locked
      }))
    };
    return JSON.stringify(data, null, 2);
  }

  CF.genFiles = function (plan) {
    const files = [];
    let main;
    if (plan.board.camera) {
      if (plan.conn === 'mqtt') main = genCamMqtt(plan);
      else main = genCamServer(plan, plan.conn === 'tm');
    } else {
      main = genGeneric(plan);
    }
    files.push({ name: 'main.cpp', lang: 'cpp', content: main });
    files.push({ name: 'platformio.ini', lang: 'ini', content: genPio(plan) });
    if (plan.board.wifi && (plan.conn !== 'none' || plan.board.camera)) files.push({ name: 'config.h', lang: 'cpp', content: genConfig(plan) });
    files.push({ name: 'circuit.json', lang: 'json', content: genCircuitJson(plan) });
    return files;
  };

})();
