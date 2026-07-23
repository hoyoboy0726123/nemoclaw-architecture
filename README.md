# 焊點 · CIRCUIT FORGE

用一句話描述 IoT 應用，系統會產生受控接線、3D 麵包板工作台與可編譯程式。

**純前端、零依賴**——沒有框架、沒有建置步驟、沒有外部 3D 函式庫，`index.html` 直接打開即可使用，也可直接部署到 GitHub Pages。

## 功能

- **規則引擎**：中文／英文關鍵字解析（DHT11、BME280、BH1750、PIR、HC-SR04、土壤濕度、OLED、按鈕、LED、蜂鳴器、伺服、繼電器、相機…），自動選板（ESP32 DevKit V1／AI Thinker ESP32-CAM／Arduino Nano）、自動配腳位。
- **3D 麵包板**：純 Canvas 自寫透視投影＋畫家演算法渲染，可拖曳旋轉、滾輪縮放、上下平移、PIN 標籤開關。
- **CODE**：依方案生成 `main.cpp`（WiFi／MQTT／HTTP REST／Web Server／ESP32-CAM 串流＋Teachable Machine）、`platformio.ini`、`config.h`、`circuit.json`，含語法上色與一鍵複製。
- **WIRING**：接線網表（電源軌／GND／訊號），訊號腳可用下拉選單改 GPIO，程式碼與 3D 即時同步。
- **CHECKS**：電源軌、工作電壓、I2C 位址衝突、GPIO 重複、strapping pin、相機保留腳位等規則檢查。
- **說明**：每個元件的目前腳位、選用理由與替代方案；可選接 Groq API 做動態分析（金鑰僅存瀏覽器 localStorage）。
- **匯出專案**：一鍵下載完整 PlatformIO 專案 ZIP（純 JS 打包，無外部依賴）。

## 專案結構

```
index.html            頁面骨架
assets/styles.css     整體樣式（深色工業風）
assets/js/data.js     開發板／元件庫／案例庫／關鍵字規則
assets/js/engine.js   需求解析、腳位指派、接線網表、規則檢查
assets/js/codegen.js  main.cpp / platformio.ini / config.h / circuit.json 產生器
assets/js/board3d.js  3D 麵包板渲染器（Canvas）
assets/js/zip.js      極簡 ZIP 打包器
assets/js/app.js      UI 主控
```

## 本機開發

```bash
python3 -m http.server 8000
# 打開 http://localhost:8000
```

（直接雙擊 `index.html` 也能運作。）

## 部署

推送到 `master` 後由 `.github/workflows/pages.yml` 自動部署至 GitHub Pages；或於 repo 設定中選擇「Deploy from a branch」。
