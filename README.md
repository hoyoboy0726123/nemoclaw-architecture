# NemoClaw · 電路實驗室 CIRCUIT LAB

用一句話生成 IoT 電路方案，或直接在麵包板上自由接線——電氣規則檢查（ERC）告訴你哪裡不通，行為模擬器讓電路先動起來再燒錄。

**純前端、零依賴**——沒有框架、沒有建置步驟、沒有外部 3D 函式庫，`index.html` 直接打開即可使用。

## LAB AGENT（內建 AI 助手）

右下角浮動按鈕開啟對話框。BYOK：輸入 Google API Key（僅存瀏覽器 localStorage）即可啟用，
預設模型 `gemma-4-31b-it`（Gemini API 免費層），可從清單切換或載入帳號可用模型。
助手透過 `@google/genai` 的 function calling 操作全站工具：一句話生成方案、改腳位、
在自由編輯模式加減元件並自動接線、通電模擬、匯出專案；需求超出元件庫能力時會直接告知無法實現。
支援「先問後做」：解說類問題會先回答，經同意才動手；也支援邊編輯邊求助。

## 三種工作模式

1. **自動生成（3D 檢視）**：輸入需求關鍵字 → 規則引擎選板、配腳位、產生接線與可編譯程式碼，3D 麵包板呈現。
2. **自由編輯**：2D 麵包板上拖放元件、逐孔拉線。底層是真實的麵包板連通模型（同一直排 5 孔導通、電源軌整條導通），ERC 即時檢查：短路、未供電、未接地、訊號腳懸空、GPIO 衝突、I2C 匯流排分裂、strapping pin……接對就通，接錯就報錯。
3. **行為模擬（通電）**：通電前先跑 ERC，接錯不給電。通電後以「生成韌體的行為語意」驅動：拉桿調感測值 → OLED 即時顯示、高溫觸發蜂鳴器（真的出聲）、PIR 觸發 LED 與事件、虛擬 MQTT broker 收發 telemetry 與指令。

## 工業配線模式（配電盤＋電力配電＋PLC）

台灣工配（丙級／乙級）到受電盤等級的教學情境：三相主迴路（R/S/T）＋110V 控制迴路雙電壓域、DIN 軌端子接線。

- **元件庫 22 種**：NFB、FUSE、MC 電磁接觸器、TR 限時電驛、MK 電力電驛、TH-RY 積熱電驛、CO 過電流電驛（51）、STOP/START 按鈕、COS 選擇開關、GL/RL 指示燈、BZ 蜂鳴器（會出聲）、三相馬達、六出線 Y-Δ 馬達、VM 電壓表、AM 電流表、SC 電容器組（功因改善）、TX 控制變壓器、**ATS 自動切換開關、GEN 柴油發電機（AMF 停電自起）**、小型 PLC（8 DI／8 DO）
- **真模擬、參數可調（雙擊元件）**：馬達運轉電流、保護電驛整定值、TR 秒數、線電壓、發電機起動延時——電流超過整定值會真的熱積累跳脫，儀表讀值跟著迴路實況
- **多電源求解器**：市電（可模擬停電）＋發電機各自成相位網，ATS 位置與線圈狀態一起定點迭代；TX 讓控制電源可取自 ATS 之後——完整演練「停電→AMF 自起→ATS 切備用→復電切回」
- **ERC**：電壓域混接、相間短路、**雙電源併聯**、馬達缺相／相別重複、保護串接（TH-RY/CO/NFB/FUSE）、**電氣互鎖**（以「同時投入是否短路」判定正逆轉與 Y-Δ）、ATS 常用／備用路徑、TX 跨相
- **30 個範例（三級各 10 個）**：基礎工配（門鈴→自保持→寸動→MK 中繼→暖機延時⋯）、進階／電力配電（正逆轉、Y-Δ、雙 TR 閃爍、CO51、受電儀表盤、功因電容、ATS 停電切換、受電盤總和演練）、PLC（自保持、TON、CTU 計數、交替閃爍、正逆轉、Y-Δ、輸送帶雙向延時、斷續警報）
- **PLC 梯形圖編輯器**：常開／常閉接點、欄疊＝並聯、OUT／TON／CTU／RST 線圈，通電路徑即時亮線；掃描週期與配電盤求解器串接（Y 輸出驅動 MC 線圈）
- **匯出**：接線表、元件表（BOM）、迴路圖 SVG、IEC 61131-3 結構化文字（program.st）、PLC IO 對照表

## 其他功能

- **CODE**：`main.cpp`（MQTT／HTTP REST／Web Server／ESP32-CAM 串流＋Teachable Machine）、`platformio.ini`、`config.h`、`circuit.json`
- **WIRING**：接線網表；自動模式下訊號腳可下拉改 GPIO，全面同步
- **CHECKS**：設計規則檢查（pass／warn／info／error 四級）
- **說明**：元件選用理由與替代方案；可選接 Groq API 動態分析（金鑰僅存瀏覽器）
- **匯出專案**：一鍵下載完整 PlatformIO 專案 ZIP

## 專案結構

```
index.html            頁面骨架
assets/styles.css     淺色主題樣式
assets/js/data.js     開發板／元件庫／案例庫／footprint／模擬輸入定義
assets/js/engine.js   需求解析、腳位指派、網表、規則檢查
assets/js/codegen.js  韌體與設定檔產生器
assets/js/board3d.js  3D 麵包板渲染器（Canvas）
assets/js/editor.js   2D 自由編輯器：連通圖（union-find）＋ ERC
assets/js/industrial.js 工業配線模式：配電盤畫布＋受控接點求解器＋工配 ERC＋範例庫
assets/js/plc.js      PLC 梯形圖引擎＋編輯器＋IEC 61131-3 ST 匯出
assets/js/sim.js      行為模擬器（規則與生成韌體語意一一對應）
assets/js/zip.js      極簡 ZIP 打包器
assets/js/app.js      UI 主控
```

## 本機開發

```bash
python3 -m http.server 8000   # http://localhost:8000
```

## 部署

推送到 `master` 由 `.github/workflows/pages.yml` 自動部署至 GitHub Pages。
