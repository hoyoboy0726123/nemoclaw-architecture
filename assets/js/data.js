'use strict';
/* 焊點 CIRCUIT FORGE — 資料層：開發板、元件庫、案例庫、關鍵字規則 */
window.CF = window.CF || {};

/* ---------------- 開發板 ---------------- */
CF.BOARDS = {
  esp32: {
    id: 'esp32', short: 'ESP32', name: 'ESP32 DevKit V1', display: 'ESP32 DEVKIT V1',
    wifi: true, camera: false,
    pio: { platform: 'espressif32', board: 'esp32doit-devkit-v1' },
    // 30-pin DevKit V1 實際腳位（上排＝天線朝左時的左列）
    pinsTop: ['3V3', 'GND', 'GPIO 15', 'GPIO 2', 'GPIO 4', 'GPIO 16', 'GPIO 17', 'GPIO 5', 'GPIO 18', 'GPIO 19', 'GPIO 21', 'RX0', 'TX0', 'GPIO 22', 'GPIO 23'],
    pinsBottom: ['VIN', 'GND', 'GPIO 13', 'GPIO 12', 'GPIO 14', 'GPIO 27', 'GPIO 26', 'GPIO 25', 'GPIO 33', 'GPIO 32', 'GPIO 35', 'GPIO 34', 'VN', 'VP', 'EN'],
    i2c: { sda: 'GPIO 21', scl: 'GPIO 22' },
    digitalPool: ['GPIO 4', 'GPIO 27', 'GPIO 26', 'GPIO 25', 'GPIO 33', 'GPIO 32', 'GPIO 13', 'GPIO 14', 'GPIO 5', 'GPIO 18', 'GPIO 19', 'GPIO 23'],
    analogPool: ['GPIO 34', 'GPIO 35', 'GPIO 32', 'GPIO 33'],
    prefer: { DHT_PIN: 'GPIO 4', BUTTON_PIN: 'GPIO 27', BUZZER_PIN: 'GPIO 26', LED_PIN: 'GPIO 25', SERVO_PIN: 'GPIO 13', RELAY_PIN: 'GPIO 32', TRIG_PIN: 'GPIO 5', ECHO_PIN: 'GPIO 18', PIR_PIN: 'GPIO 14', SOIL_PIN: 'GPIO 34' },
    powerPin3V3: '3V3', powerPin5V: 'VIN', gndPin: 'GND',
    model: 'esp32devkit'
  },
  esp32cam: {
    id: 'esp32cam', short: 'ESP32-CAM', name: 'AI Thinker ESP32-CAM', display: 'AI THINKER ESP32-CAM',
    wifi: true, camera: true,
    pio: { platform: 'espressif32', board: 'esp32cam' },
    pinsTop: ['5V', 'GND', 'GPIO 12', 'GPIO 13', 'GPIO 15', 'GPIO 14', 'GPIO 2', 'GPIO 4'],
    pinsBottom: ['3V3', 'GPIO 16', 'GPIO 0', 'GND', 'VCC', 'U0R', 'U0T', 'GND '],
    i2c: { sda: 'GPIO 14', scl: 'GPIO 15' },
    digitalPool: ['GPIO 13', 'GPIO 14', 'GPIO 15'],
    analogPool: ['GPIO 13', 'GPIO 14'],
    prefer: { PIR_PIN: 'GPIO 13', BUTTON_PIN: 'GPIO 14', BUZZER_PIN: 'GPIO 14', LED_PIN: 'GPIO 15', DHT_PIN: 'GPIO 13' },
    powerPin3V3: '3V3', powerPin5V: '5V', gndPin: 'GND',
    model: 'esp32cam'
  },
  nano: {
    id: 'nano', short: 'Arduino Nano', name: 'Arduino Nano', display: 'ARDUINO NANO',
    wifi: false, camera: false,
    pio: { platform: 'atmelavr', board: 'nanoatmega328new' },
    pinsTop: ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN'],
    pinsBottom: ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RST', 'RX0', 'TX1'],
    i2c: { sda: 'A4', scl: 'A5' },
    digitalPool: ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12'],
    analogPool: ['A0', 'A1', 'A2', 'A3', 'A6', 'A7'],
    prefer: { DHT_PIN: 'D2', BUTTON_PIN: 'D3', BUZZER_PIN: 'D8', LED_PIN: 'D6', SERVO_PIN: 'D9', RELAY_PIN: 'D7', TRIG_PIN: 'D4', ECHO_PIN: 'D5', PIR_PIN: 'D2', SOIL_PIN: 'A0' },
    powerPin3V3: '3V3', powerPin5V: '5V', gndPin: 'GND',
    model: 'nano'
  }
};

/* ---------------- 元件庫 ----------------
 * pins: t = 'V'(電源) | 'G'(接地) | 'S'(數位訊號) | 'A'(類比訊號) | 'I2C_SDA' | 'I2C_SCL'
 */
CF.PARTS = {
  camera: {
    id: 'camera', name: 'OV2640 Camera', titleName: 'OV2640 Camera', cls: 'CAMERA',
    pins: [], onboard: true, needs5V: false,
    why: '板載 200 萬畫素鏡頭模組，提供影像擷取與串流來源，是所有視覺應用的基礎。',
    pinNote: '內建排線 → 板載相機介面',
    alts: [['OV5640', '畫素與畫質較佳，但需更換支援板與驅動'], ['更換廣角鏡頭', '同為 OV2640，改用 120°+ 鏡頭可涵蓋更大範圍']]
  },
  dht11: {
    id: 'dht11', name: 'DHT11 模組', titleName: 'DHT11 模組', cls: 'SENSOR', needs5V: false,
    pins: [{ n: 'VCC', t: 'V' }, { n: 'DATA', t: 'S', macro: 'DHT_PIN' }, { n: 'GND', t: 'G' }],
    libs: ['adafruit/DHT sensor library@^1.4.6', 'adafruit/Adafruit Unified Sensor@^1.1.14'],
    why: '以低成本提供基本溫濕度資料，適合教學與室內概念驗證。',
    alts: [['DHT22', '範圍與精度較佳，價格稍高'], ['SHT31', '更新更快且穩定，但需要 I2C 與額外函式庫']]
  },
  bme280: {
    id: 'bme280', name: 'BME280 模組', titleName: 'BME280', cls: 'SENSOR', needs5V: false, i2c: true, addr: '0x76',
    pins: [{ n: 'VCC', t: 'V' }, { n: 'GND', t: 'G' }, { n: 'SCL', t: 'I2C_SCL' }, { n: 'SDA', t: 'I2C_SDA' }],
    libs: ['adafruit/Adafruit BME280 Library@^2.2.4', 'adafruit/Adafruit Unified Sensor@^1.1.14'],
    why: '單一模組同時量測溫度、濕度與大氣壓力，精度高、I2C 介面省腳位。',
    alts: [['BMP280', '少了濕度但更便宜'], ['SHT31 + BMP180', '拆成兩顆感測器，取得更好的濕度精度']]
  },
  bh1750: {
    id: 'bh1750', name: 'BH1750 光照模組', titleName: 'BH1750', cls: 'SENSOR', needs5V: false, i2c: true, addr: '0x23',
    pins: [{ n: 'VCC', t: 'V' }, { n: 'GND', t: 'G' }, { n: 'SCL', t: 'I2C_SCL' }, { n: 'SDA', t: 'I2C_SDA' }],
    libs: ['claws/BH1750@^1.3.0'],
    why: '直接輸出 lux 照度值，不需查表換算，適合照明與植栽光照監測。',
    alts: [['TSL2561', '動態範圍更廣，可切換增益'], ['光敏電阻', '最便宜，但只能得到相對亮暗']]
  },
  pir: {
    id: 'pir', name: 'HC-SR501 PIR', titleName: 'HC-SR501 PIR', cls: 'SENSOR', needs5V: true,
    pins: [{ n: 'VCC', t: 'V' }, { n: 'OUT', t: 'S', macro: 'PIR_PIN' }, { n: 'GND', t: 'G' }],
    libs: [],
    why: '以熱釋電原理偵測人體紅外線變化，低功耗、免程式校正，輸出乾淨的數位訊號。',
    alts: [['RCWL-0516 微波雷達', '可穿透薄板偵測、不受溫度影響，但較易誤觸發'], ['AMG8833 熱像陣列', '能取得 8×8 溫度分布，可判斷方位，但成本高許多']]
  },
  hcsr04: {
    id: 'hcsr04', name: 'HC-SR04 超音波', titleName: 'HC-SR04', cls: 'SENSOR', needs5V: true,
    pins: [{ n: 'VCC', t: 'V' }, { n: 'TRIG', t: 'S', macro: 'TRIG_PIN' }, { n: 'ECHO', t: 'S', macro: 'ECHO_PIN' }, { n: 'GND', t: 'G' }],
    libs: [],
    why: '以超音波飛行時間量測 2–400cm 距離，便宜可靠，是距離／水位類應用的首選。',
    alts: [['VL53L0X 雷射 ToF', '體積小、量測窄視角，I2C 介面'], ['JSN-SR04T 防水型', '探頭防水，適合水箱與戶外']]
  },
  soil: {
    id: 'soil', name: '土壤濕度感測', titleName: '土壤濕度', cls: 'SENSOR', needs5V: false,
    pins: [{ n: 'VCC', t: 'V' }, { n: 'AO', t: 'A', macro: 'SOIL_PIN' }, { n: 'GND', t: 'G' }],
    libs: [],
    why: '量測土壤介電值換算含水量，讓澆水決策有數據依據。建議選電容式以避免電極腐蝕。',
    alts: [['電阻式探針', '更便宜，但電極會電解腐蝕，壽命短'], ['DFRobot 電容式 V2', '鍍層完整、輸出穩定，適合長期部署']]
  },
  oled: {
    id: 'oled', name: 'SSD1306 OLED', titleName: 'OLED', cls: 'DISPLAY', needs5V: false, i2c: true, addr: '0x3C',
    pins: [{ n: 'VCC', t: 'V' }, { n: 'GND', t: 'G' }, { n: 'SCL', t: 'I2C_SCL' }, { n: 'SDA', t: 'I2C_SDA' }],
    libs: ['adafruit/Adafruit SSD1306@^2.5.10', 'adafruit/Adafruit GFX Library@^1.11.11'],
    why: '讓裝置在沒有手機或電腦時，也能就地查看感測結果與狀態。',
    alts: [['LCD1602 I2C', '字體較大且便宜，但顯示資訊量較少'], ['TFT 彩色螢幕', '資訊與圖形更豐富，但耗電與程式複雜度較高']]
  },
  button: {
    id: 'button', name: 'Push Button', titleName: 'Push Button', cls: 'INPUT', needs5V: false,
    pins: [{ n: 'LEG A', t: 'S', macro: 'BUTTON_PIN' }, { n: 'LEG B', t: 'G' }],
    libs: [],
    why: '提供最直接的現場輸入：觸發、確認或切換模式，搭配內部上拉電阻免外接零件。',
    pinNote: 'LEG A → {PIN}（INPUT_PULLUP）',
    alts: [['TTP223 觸摸模組', '無機械磨損、可隔面板觸發'], ['旋轉編碼器', '可輸入多段數值，適合選單操作']]
  },
  led: {
    id: 'led', name: 'LED 指示燈', titleName: 'LED', cls: 'OUTPUT', needs5V: false,
    pins: [{ n: 'ANODE', t: 'S', macro: 'LED_PIN' }, { n: 'CATHODE', t: 'G' }],
    libs: [],
    why: '最低成本的狀態回饋：告警、動作確認或夜間照明示意，一眼即知系統狀態。',
    alts: [['WS2812 智慧燈珠', '單線控制多顆全彩，適合豐富狀態表達'], ['繼電器＋燈具', '驅動市電照明，做真正的補光／照明']]
  },
  buzzer: {
    id: 'buzzer', name: '蜂鳴器', titleName: '蜂鳴器', cls: 'OUTPUT', needs5V: false,
    pins: [{ n: 'SIG', t: 'S', macro: 'BUZZER_PIN' }, { n: 'GND', t: 'G' }],
    libs: [],
    why: '用聲音把事件推到「不用看螢幕」的層級，警報類應用的必備輸出。',
    alts: [['被動蜂鳴器', '可用 PWM 播放不同音調'], ['MP3 模組 + 喇叭', '可播放語音提示，體驗更好']]
  },
  servo: {
    id: 'servo', name: 'SG90 伺服馬達', titleName: '伺服馬達', cls: 'ACTUATOR', needs5V: true,
    pins: [{ n: 'VCC', t: 'V' }, { n: 'SIG', t: 'S', macro: 'SERVO_PIN' }, { n: 'GND', t: 'G' }],
    libsEsp32: ['madhephaestus/ESP32Servo@^3.0.5'], libsAvr: ['arduino-libraries/Servo@^1.2.1'],
    why: '以 PWM 控制 0–180° 角度，讓系統能真正「動起來」：閘門、旋鈕、指針都靠它。',
    alts: [['MG90S 金屬齒', '扭力與耐用度較佳'], ['步進馬達 + 驅動板', '可連續旋轉與精確定位，但接線與程式較複雜']]
  },
  relay: {
    id: 'relay', name: '繼電器模組', titleName: '繼電器', cls: 'OUTPUT', needs5V: true,
    pins: [{ n: 'VCC', t: 'V' }, { n: 'IN', t: 'S', macro: 'RELAY_PIN' }, { n: 'GND', t: 'G' }],
    libs: [],
    why: '以小訊號切換大電流負載（燈具、風扇、水泵），是 IoT 控制實體電器的橋樑。',
    alts: [['MOSFET 模組', '無接點壽命長、可 PWM 調光，限直流負載'], ['固態繼電器 SSR', '無聲、切換快，適合交流負載']]
  }
};

CF.PART_ORDER = ['camera', 'dht11', 'bme280', 'bh1750', 'pir', 'hcsr04', 'soil', 'oled', 'button', 'led', 'buzzer', 'servo', 'relay'];

/* ---------------- 連線方式 ---------------- */
CF.CONNS = {
  mqtt: { id: 'mqtt', label: 'MQTT', done: '接線與 MQTT 已建立' },
  http: { id: 'http', label: 'HTTP REST', done: '接線與 HTTP REST 已建立' },
  web:  { id: 'web',  label: 'WEB SERVER', done: '接線與 WEB SERVER 已建立' },
  tm:   { id: 'tm',   label: 'TEACHABLE MACHINE', done: '接線與 TEACHABLE MACHINE 已建立' },
  none: { id: 'none', label: '', done: '接線已建立' }
};

/* ---------------- 關鍵字規則 ---------------- */
CF.RULES = {
  board: [
    { re: /esp32[\s-]?cam|esp[\s-]?cam|ai\s?thinker/i, board: 'esp32cam' },
    { re: /nano|arduino/i, board: 'nano' }
  ],
  parts: {
    dht11:  /dht\s?11|dht\s?22|dht|溫溼|溫濕|溫度|濕度|溼度|冷鏈/i,
    bme280: /bme\s?280|氣壓|大氣|舒適度/i,
    bh1750: /bh\s?1750|光照|照度|光線|光感/i,
    pir:    /hc-?sr501|pir|人體|人流|紅外線?感應|入侵/i,
    hcsr04: /hc-?sr04|超音波|距離|測距|水位|倒車|雷達/i,
    soil:   /土壤|soil|植栽|盆栽|澆水/i,
    oled:   /oled|ssd1306|顯示|螢幕|儀表|看板/i,
    button: /按鈕|按鍵|button|門鈴/i,
    led:    /\bled\b|亮燈|指示燈/i,
    buzzer: /蜂鳴|警報器|警報|buzzer/i,
    servo:  /伺服|servo|舵機|閘門/i,
    relay:  /繼電器|relay|電源開關|遠端開關|補光|照明/i,
    camera: /拍照|攝影|影像|鏡頭|camera|ov2640|辨識/i
  },
  conn: [
    { re: /teachable/i, conn: 'tm' },
    { re: /mqtt/i, conn: 'mqtt' },
    { re: /http|rest|api/i, conn: 'http' },
    { re: /web\s?server|網頁|web/i, conn: 'web' }
  ],
  wifiHint: /wifi|連網|遠端|通知|回報|上傳|發布|串流/i
};

/* ---------------- 案例庫 ---------------- */
CF.DEFAULT_REQ = 'ESP32 + DHT11 + OLED + 按鈕，透過 WiFi 使用 MQTT 傳送溫溼度與按鈕狀態';

CF.CASE_GROUPS = [
  {
    id: 'quick', title: null, style: 'quick',
    cases: [
      { label: 'MQTT 環境站', text: CF.DEFAULT_REQ },
      { label: '警示按鈕', text: 'ESP32 + 按鈕 + 蜂鳴器，按下按鈕透過 MQTT 發布警示並鳴響蜂鳴器' },
      { label: '伺服控制', text: 'ESP32 + 伺服馬達，透過 MQTT 遠端控制伺服角度' }
    ]
  },
  {
    id: 'nano', title: 'Arduino Nano 應用案例', style: 'solid',
    cases: [
      { label: '環境顯示器', text: 'Arduino Nano + DHT11 + OLED，即時顯示溫溼度' },
      { label: '停車雷達', text: 'Arduino Nano + HC-SR04 + 蜂鳴器，距離越近提示越急促' },
      { label: '伺服閘門', text: 'Arduino Nano + 按鈕 + 伺服馬達，按下按鈕開合閘門' },
      { label: '土壤乾燥提醒', text: 'Arduino Nano + 土壤濕度感測 + LED，土壤過乾時亮燈提醒' },
      { label: '人體感應燈', text: 'Arduino Nano + PIR + LED，偵測人體自動亮燈' },
      { label: '高溫警報', text: 'Arduino Nano + DHT11 + 蜂鳴器，高溫時鳴響警報' }
    ]
  },
  {
    id: 'esp32net', title: 'ESP32 連網案例', style: 'solid',
    cases: [
      { label: 'MQTT 發布訂閱', text: 'ESP32 + DHT11，透過 MQTT 定時發布溫溼度並訂閱遠端指令' },
      { label: 'HTTP REST', text: 'ESP32 + BME280，提供 HTTP REST API 查詢溫度與氣壓' },
      { label: '區域 Web Server', text: 'ESP32 + DHT11 + LED，架設區域網頁伺服器顯示數據並控制 LED' }
    ]
  },
  {
    id: 'common', title: '常用應用案例', style: 'solid',
    cases: [
      { label: '智慧植栽', text: 'ESP32 + 土壤濕度 + BH1750，透過 MQTT 監測植栽土壤與光照' },
      { label: '人體警報', text: 'ESP32 + PIR + 蜂鳴器，偵測人體透過 MQTT 發布警報' },
      { label: '光照紀錄', text: 'ESP32 + BH1750，透過 MQTT 定時記錄光照強度' },
      { label: '距離警示', text: 'ESP32 + HC-SR04 + LED，距離過近時亮燈警示' },
      { label: '室內儀表板', text: 'ESP32 + BME280 + OLED，室內溫度氣壓儀表顯示' },
      { label: '遠端開關', text: 'ESP32 + 繼電器，透過 MQTT 遠端控制電源開關' }
    ]
  },
  {
    id: 'extended', title: '延伸實作案例', style: 'dashed',
    cases: [
      { label: '冷鏈監測', text: 'ESP32 + DHT11 + OLED，透過 MQTT 回報冷鏈倉儲溫度' },
      { label: '倉儲警戒', text: 'ESP32 + PIR + HC-SR04，透過 MQTT 回報倉儲入侵警戒' },
      { label: '水箱水位', text: 'ESP32 + HC-SR04，透過 MQTT 量測水箱水位並回報' },
      { label: '連網門鈴', text: 'ESP32 + 按鈕 + 蜂鳴器，按鈕門鈴透過 MQTT 連網通知' },
      { label: '溫室儀表', text: 'ESP32 + DHT11 + BH1750 + OLED，溫室環境儀表板' },
      { label: '停車雷達', text: 'ESP32 + HC-SR04 + 蜂鳴器，倒車距離警示' },
      { label: '展場人流', text: 'ESP32 + PIR，透過 MQTT 統計展場人流' },
      { label: '光控照明', text: 'ESP32 + BH1750 + 繼電器，光線不足自動開燈' }
    ]
  },
  {
    id: 'cam', title: 'ESP32-CAM 影像案例', style: 'solid',
    cases: [
      { label: 'MQTT 定時拍照', text: 'ESP32-CAM 定時拍照並透過 MQTT 發布通知' },
      { label: 'PIR 拍照警報', text: 'ESP32-CAM + HC-SR501 PIR，偵測人體觸發拍照並透過 MQTT 發布警報' },
      { label: 'Teachable Machine', text: 'ESP32-CAM + HC-SR501 PIR，串流影像給 Teachable Machine 分類' },
      { label: 'AI 智慧門口', text: 'ESP32-CAM + PIR，門口影像串流與人體偵測，透過 MQTT 通知' }
    ]
  },
  {
    id: 'newcase', title: '新增情境案例', style: 'accent',
    cases: [
      { label: '高溫警報', text: 'ESP32 + DHT11 + 蜂鳴器，高溫透過 MQTT 發布警報' },
      { label: '遠端閘門', text: 'ESP32 + 伺服馬達，透過 MQTT 遠端控制閘門' },
      { label: '溫室補光', text: 'ESP32 + BH1750 + 繼電器，光照不足透過 MQTT 回報並自動補光' },
      { label: '教室舒適度', text: 'ESP32 + DHT11 + BME280 + OLED，教室舒適度指數顯示' }
    ]
  },
  {
    id: 'sensors', title: '常用感測元件', style: 'dim', append: true,
    cases: [
      { label: 'BME280', text: 'BME280' },
      { label: 'BH1750', text: 'BH1750' },
      { label: 'PIR', text: 'PIR' },
      { label: 'HC-SR04', text: 'HC-SR04' },
      { label: '土壤濕度', text: '土壤濕度' }
    ]
  }
];

CF.SUPPORTED = ['ESP32', 'ESP32-CAM', 'ARDUINO NANO', 'CAMERA', 'DHT', 'BME280', 'BH1750', 'PIR', 'HC-SR04', 'SOIL', 'OLED', 'BUTTON', 'LED', 'BUZZER', 'SERVO', 'RELAY', 'MQTT', 'HTTP', 'WEB SERVER', 'TEACHABLE MACHINE'];
