# 需求文件：Safety & UI Layer 增強

## 簡介

本文件定義 VoiceNursy 安全防呆與前端介面層的增強需求。現有原型已具備基礎巡房模式、SOAP 卡片顯示、單次劑量檢查、過敏原比對、生命徵象警戒及疼痛趨勢圖。本次增強聚焦於：給藥時間軸視覺化、進階防呆邏輯（每日累積劑量追蹤、藥物交互作用）、藥品安全資料庫擴充、無障礙與響應式設計改善，以及前端測試基礎設施建立。

## 詞彙表

- **Safety_Engine**：前端防呆引擎模組，負責劑量、過敏、生命徵象及藥物交互作用的即時檢查（對應 `safety_check.js`）
- **UI_Layer**：前端使用者介面層，包含巡房模式、SOAP 卡片、圖表及警示元件（對應 `index.html`、`app.js`、`styles.css`）
- **Chart_Module**：圖表視覺化模組，負責疼痛趨勢圖與給藥時間軸的繪製（對應 `charts.js`）
- **Drug_Safety_DB**：藥品安全資料庫，以 JSON 格式儲存藥品劑量閾值、別名、警示語及交互作用資訊（對應 `drug_safety_db.json`）
- **Dose_Parser**：劑量解析器，負責將文字劑量與單位轉換為標準化毫克數值（對應 `parseDose()` 函式）
- **Vital_Sign_Parser**：生命徵象解析器，負責從自由文字中擷取血壓、心跳、血氧、體溫等數值（對應 `checkVitalSigns()` 函式）
- **BrainOutput**：後端 SOAP 生成引擎回傳的結構化資料，包含 SOAP 欄位、藥物清單、疼痛指數及警示（對應 `brain/schemas.py` 的 `BrainOutput`）
- **Medication_Timeline**：給藥時間軸元件，以視覺化方式呈現病患的給藥歷程
- **Daily_Dose_Tracker**：每日累積劑量追蹤器，負責加總同一藥品當日所有給藥紀錄的劑量
- **Drug_Interaction_Checker**：藥物交互作用檢查器，負責比對同時使用的藥物是否存在已知交互作用風險

## 需求

### 需求 1：給藥時間軸視覺化

**使用者故事：** 身為護理師，我希望在巡房模式中看到病患的給藥時間軸圖表，以便快速掌握給藥歷程與間隔。

#### 驗收條件

1. WHEN 使用者選擇一位病患且該病患有給藥紀錄時，THE Chart_Module SHALL 在側面板中渲染一條水平時間軸，橫軸為時間、每個給藥事件以節點標示藥名與劑量。
2. WHEN 某筆給藥紀錄觸發了 Safety_Engine 的警示時，THE Medication_Timeline SHALL 將該節點以紅色標示並附加警示圖示。
3. WHEN 使用者將滑鼠懸停於時間軸節點上時，THE Medication_Timeline SHALL 顯示工具提示（tooltip），內容包含藥名、劑量、單位、給藥途徑及時間。
4. WHEN 病患尚無任何給藥紀錄時，THE Medication_Timeline SHALL 顯示「尚無給藥紀錄」的佔位文字。
5. WHEN 新的 SOAP 紀錄被確認存檔時，THE Medication_Timeline SHALL 在不重新載入頁面的情況下即時更新。

### 需求 2：每日累積劑量追蹤

**使用者故事：** 身為護理師，我希望系統能自動追蹤同一藥品的每日累積劑量，以便在累積劑量接近或超過每日上限時收到警示。

#### 驗收條件

1. WHEN Safety_Engine 執行劑量檢查時，THE Daily_Dose_Tracker SHALL 加總當日（以日曆日計算）同一病患、同一藥品的所有已存檔給藥紀錄劑量。
2. WHEN 某藥品的每日累積劑量超過 Drug_Safety_DB 中定義的 max_daily_dose_mg 時，THE Safety_Engine SHALL 產生一筆 severity 為 "critical" 的 "daily_dose_exceeded" 類型警示。
3. WHEN 某藥品的每日累積劑量達到 max_daily_dose_mg 的 80% 時，THE Safety_Engine SHALL 產生一筆 severity 為 "warning" 的 "daily_dose_approaching" 類型警示。
4. THE Daily_Dose_Tracker SHALL 僅計算當日（00:00 至 23:59）的紀錄，不跨日累計。

### 需求 3：藥物交互作用檢查

**使用者故事：** 身為護理師，我希望系統能在開立多種藥物時自動檢查藥物交互作用，以便避免危險的藥物組合。

#### 驗收條件

1. THE Drug_Safety_DB SHALL 包含一個 "interactions" 陣列，每筆交互作用紀錄包含兩種藥物名稱、嚴重程度（"critical" 或 "warning"）及描述文字。
2. WHEN BrainOutput 包含兩種以上藥物時，THE Drug_Interaction_Checker SHALL 檢查所有藥物兩兩組合是否存在於 Drug_Safety_DB 的 interactions 清單中。
3. WHEN 偵測到藥物交互作用時，THE Safety_Engine SHALL 產生一筆 "drug_interaction" 類型警示，包含涉及的藥物名稱、嚴重程度及描述。
4. THE Drug_Interaction_Checker SHALL 使用藥品別名進行比對，確保中文藥名與英文藥名均能正確匹配。

### 需求 4：藥品安全資料庫擴充

**使用者故事：** 身為護理師，我希望藥品安全資料庫涵蓋更多常用藥品，以便系統能檢查更廣泛的藥物安全性。

#### 驗收條件

1. THE Drug_Safety_DB SHALL 包含至少 20 種常用藥品的安全劑量資訊，每筆包含藥名、別名陣列、最大單次劑量（mg）、最大每日劑量（mg）、常用劑量（mg）、給藥途徑及警示語。
2. THE Drug_Safety_DB SHALL 包含至少 5 筆常見藥物交互作用紀錄。
3. THE Drug_Safety_DB SHALL 通過 JSON Schema 驗證，確保每筆藥品紀錄的必要欄位完整且資料型別正確。
4. FOR ALL Drug_Safety_DB 中的藥品紀錄，將 JSON 序列化再反序列化後 SHALL 產生與原始資料等價的物件（round-trip 屬性）。

### 需求 5：劑量解析器強化

**使用者故事：** 身為護理師，我希望系統能正確解析各種劑量表示格式，以便防呆引擎能準確比對劑量。

#### 驗收條件

1. WHEN 劑量單位為 "g" 時，THE Dose_Parser SHALL 將數值乘以 1000 轉換為毫克。
2. WHEN 劑量單位為 "mcg" 或 "μg" 時，THE Dose_Parser SHALL 將數值除以 1000 轉換為毫克。
3. WHEN 劑量文字包含非數字字元（如 "500mg"、"1.5 g"）時，THE Dose_Parser SHALL 正確擷取數值部分。
4. WHEN 劑量文字為空值、null 或無法解析的字串時，THE Dose_Parser SHALL 回傳 null 而非拋出錯誤。
5. FOR ALL 有效的劑量與單位組合，解析後的毫克數值 SHALL 為非負數。
6. FOR ALL 有效的劑量與單位組合，將毫克數值轉回原始單位再重新解析 SHALL 產生等價的毫克數值（round-trip 屬性）。

### 需求 6：生命徵象解析器強化

**使用者故事：** 身為護理師，我希望系統能從各種格式的客觀描述文字中正確擷取生命徵象數值，以便防呆引擎能準確判斷異常。

#### 驗收條件

1. THE Vital_Sign_Parser SHALL 從自由文字中擷取以下生命徵象：收縮壓（BP systolic）、舒張壓（BP diastolic）、心跳（HR）、血氧（SpO2）、體溫（BT）、呼吸速率（RR）。
2. WHEN 文字中包含 "BP 140/90" 或 "BP140/90" 等格式時，THE Vital_Sign_Parser SHALL 正確擷取收縮壓與舒張壓。
3. WHEN 擷取的生命徵象數值超出 Drug_Safety_DB 中定義的正常範圍時，THE Safety_Engine SHALL 產生對應的 "vital_abnormal" 類型警示。
4. WHEN 文字中不包含任何可辨識的生命徵象格式時，THE Vital_Sign_Parser SHALL 回傳空陣列而非拋出錯誤。
5. THE Vital_Sign_Parser SHALL 支援呼吸速率（RR）的解析，目前的實作尚未包含此項。

### 需求 7：危險狀態 UI 回饋

**使用者故事：** 身為護理師，我希望在偵測到危險劑量或嚴重警示時，畫面能有明顯的視覺與聽覺回饋，以便我能立即注意到異常。

#### 驗收條件

1. WHEN Safety_Engine 產生 severity 為 "critical" 的警示時，THE UI_Layer SHALL 將警示覆蓋層（alert overlay）顯示於畫面最上層，背景以紅色閃爍動畫提示。
2. WHEN 警示覆蓋層顯示時，THE UI_Layer SHALL 播放一段警示音效（持續時間不超過 500 毫秒）。
3. WHEN 使用者點擊「確認知悉並繼續」按鈕時，THE UI_Layer SHALL 關閉警示覆蓋層並記錄使用者的確認動作。
4. WHEN 存在多筆警示時，THE UI_Layer SHALL 依序逐一顯示每筆警示，使用者確認一筆後才顯示下一筆。
5. WHEN Safety_Engine 產生 severity 為 "warning" 的警示時，THE UI_Layer SHALL 在 SOAP 卡片區域上方顯示黃色警示橫幅，不阻擋操作流程。

### 需求 8：無障礙設計改善

**使用者故事：** 身為護理師，我希望介面支援鍵盤操作與螢幕閱讀器，以便在各種情境下都能順利使用系統。

#### 驗收條件

1. THE UI_Layer SHALL 為所有互動元素（按鈕、輸入欄位、可編輯區域）提供適當的 ARIA 標籤（aria-label 或 aria-labelledby）。
2. THE UI_Layer SHALL 確保所有互動元素可透過 Tab 鍵依邏輯順序聚焦。
3. WHEN 警示覆蓋層顯示時，THE UI_Layer SHALL 將焦點鎖定（focus trap）在覆蓋層內，防止使用者操作背景元素。
4. THE UI_Layer SHALL 確保所有文字與背景的色彩對比度符合 WCAG 2.1 AA 等級（對比度至少 4.5:1）。
5. WHEN SOAP 卡片內容更新時，THE UI_Layer SHALL 使用 aria-live 區域通知螢幕閱讀器內容已變更。

### 需求 9：響應式設計改善

**使用者故事：** 身為護理師，我希望在平板裝置上也能順暢操作巡房模式，以便在病房中使用平板進行巡房紀錄。

#### 驗收條件

1. WHEN 螢幕寬度小於 768px 時，THE UI_Layer SHALL 將主內容區域從雙欄佈局切換為單欄堆疊佈局。
2. WHEN 螢幕寬度小於 768px 時，THE UI_Layer SHALL 將側面板（疼痛趨勢圖、時間軸）移至 SOAP 卡片下方。
3. THE UI_Layer SHALL 確保錄音按鈕在所有螢幕尺寸下的觸控目標至少為 44×44 像素。
4. WHEN 螢幕寬度小於 480px 時，THE UI_Layer SHALL 將頂部導覽列改為可收合的漢堡選單。

### 需求 10：前端測試基礎設施

**使用者故事：** 身為開發者，我希望建立前端測試基礎設施，以便能對防呆邏輯與解析器進行自動化測試。

#### 驗收條件

1. THE 測試環境 SHALL 使用 Vitest 作為測試執行器，並支援 property-based testing（使用 fast-check 函式庫）。
2. THE 測試套件 SHALL 包含 Dose_Parser 的 property-based test，驗證 round-trip 屬性（解析 → 轉回 → 重新解析產生等價結果）。
3. THE 測試套件 SHALL 包含 Safety_Engine 的 checkDrugDosage 函式測試，驗證對於所有 Drug_Safety_DB 中的藥品，超過 max_single_dose_mg 的劑量均產生 "dosage_exceeded" 警示。
4. THE 測試套件 SHALL 包含 Drug_Interaction_Checker 的測試，驗證所有已知交互作用組合均被正確偵測。
5. THE 測試套件 SHALL 包含 Vital_Sign_Parser 的測試，驗證各種格式的生命徵象文字均能正確解析。
6. IF 測試執行過程中發生非預期錯誤，THEN 測試框架 SHALL 輸出清楚的錯誤訊息與失敗的測試案例。

### 需求 11：後端 API 整合強化

**使用者故事：** 身為護理師，我希望前端能穩定地與後端 API 整合，以便在網路不穩定時也能正常運作。

#### 驗收條件

1. WHEN 後端 API 回傳錯誤（HTTP 4xx 或 5xx）時，THE UI_Layer SHALL 顯示使用者可理解的錯誤訊息，而非技術性錯誤碼。
2. WHEN 網路連線中斷時，THE UI_Layer SHALL 自動切換至離線模式，將 SOAP 紀錄暫存於 IndexedDB。
3. WHEN 網路連線恢復時，THE UI_Layer SHALL 自動將暫存的紀錄同步至後端，並在同步完成後通知使用者。
4. WHEN API 請求超過 10 秒未回應時，THE UI_Layer SHALL 顯示逾時提示並提供重試選項。

### 需求 12：確認存檔動畫

**使用者故事：** 身為護理師，我希望在確認存檔時看到明確的視覺回饋，以便確認紀錄已成功儲存。

#### 驗收條件

1. WHEN 使用者點擊「確認存檔」按鈕時，THE UI_Layer SHALL 播放一段存檔成功動畫（包含打勾圖示與淡入效果），持續時間為 2 至 3 秒。
2. WHILE 存檔動畫播放期間，THE UI_Layer SHALL 禁用「確認存檔」按鈕以防止重複提交。
3. WHEN 存檔因網路錯誤而失敗時，THE UI_Layer SHALL 顯示存檔失敗提示並提供「重試」與「離線暫存」兩個選項。
4. WHEN 存檔成功後，THE UI_Layer SHALL 自動清除 SOAP 卡片區域，準備下一筆紀錄的輸入。
