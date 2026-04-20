# 需求文件：護理聲助手 (VoiceNursy)

## 簡介

VoiceNursy 是一款專為高壓醫療環境設計的純軟體智能護理站，定位為隱形的 AI 護理長。系統透過安裝於行動裝置（平板／手機）的應用程式，在不改變護理師現有巡房習慣的前提下，提供三大核心功能：中英台混合語音辨識轉 SOAP 病歷、主動防呆用藥警示，以及視覺化交班儀表板。

目標市場為 B2B，包含區域醫院、醫學中心及長照機構。

---

## 詞彙表

- **VoiceNursy**：本系統的整體應用程式，運行於 iOS／Android 行動裝置。
- **STT_Engine**：語音轉文字引擎，基於 OpenAI Whisper API，負責處理中英台混合語音輸入。
- **SOAP_Generator**：LLM 模組，負責將 STT_Engine 輸出的文字轉換為符合評鑑標準的 SOAP 結構病歷。
- **Safety_Net**：主動防呆警示模組，負責即時語意分析並偵測異常數值或劑量。
- **Handover_Dashboard**：視覺化交班儀表板模組，負責將 SOAP 紀錄轉化為時間軸與生命徵象趨勢圖。
- **RAG_Engine**：檢索增強生成引擎，存取向量資料庫中的藥典、常規劑量及醫學縮寫字典。
- **Nurse**：使用 VoiceNursy 的護理師，為主要操作者。
- **Patient_Record**：單一病患的完整護理紀錄，包含所有 SOAP 條目。
- **SOAP_Entry**：單筆符合 SOAP 格式（主觀、客觀、評估、計畫）的病歷條目。
- **Shift**：護理班次，包含日班、小夜班、大夜班等。
- **Alert**：Safety_Net 觸發的警示通知，包含視覺（紅色閃爍）與聽覺（提示音）兩種形式。
- **Admin**：醫療機構的系統管理員，負責管理帳號、病房設定及藥典資料。

---

## 需求

### 需求 1：使用者身份驗證與授權

**使用者故事：** 身為護理師，我希望能安全登入系統，以確保病患資料僅限授權人員存取。

#### 驗收標準

1. THE VoiceNursy SHALL 支援以員工編號及密碼進行身份驗證。
2. WHEN Nurse 連續輸入錯誤密碼達 5 次，THE VoiceNursy SHALL 鎖定該帳號 15 分鐘並通知 Admin。
3. WHEN Nurse 成功登入，THE VoiceNursy SHALL 於 30 秒內完成身份驗證並進入主畫面。
4. WHILE Nurse 閒置超過 10 分鐘，THE VoiceNursy SHALL 自動登出並清除畫面上的病患資料。
5. THE VoiceNursy SHALL 依據角色（護理師、護理長、Admin）提供對應的功能存取權限。
6. IF 身份驗證服務無法連線，THEN THE VoiceNursy SHALL 顯示「系統暫時無法連線，請聯繫管理員」的錯誤訊息。

---

### 需求 2：中英台混合語音輸入

**使用者故事：** 身為護理師，我希望能以中文、英文或台語混合說話，以符合臨床實際溝通習慣，不需刻意切換語言。

#### 驗收標準

1. WHEN Nurse 啟動語音錄製，THE STT_Engine SHALL 接受中文、英文及台語三種語言的混合輸入，無需手動切換語言模式。
2. WHEN Nurse 完成語音輸入，THE STT_Engine SHALL 於 5 秒內完成語音轉文字並回傳結果。
3. THE STT_Engine SHALL 正確辨識常見醫學縮寫（如 BP、HR、SpO2、PRN、QD、BID）並保留原始縮寫格式。
4. IF 環境噪音超過 70 dB 或語音訊號品質不足，THEN THE STT_Engine SHALL 顯示「語音品質不佳，請重新錄製」的提示並保留原始錄音供重試。
5. WHEN Nurse 完成語音輸入，THE VoiceNursy SHALL 顯示轉錄文字供 Nurse 確認，並提供逐字修改功能。
6. THE STT_Engine SHALL 支援最長 5 分鐘的連續語音輸入。

---

### 需求 3：自動生成 SOAP 結構病歷

**使用者故事：** 身為護理師，我希望語音輸入能自動轉換為符合評鑑標準的 SOAP 格式病歷，以減少文書時間。

#### 驗收標準

1. WHEN STT_Engine 完成語音轉文字，THE SOAP_Generator SHALL 將轉錄文字分類至 SOAP 四個欄位（Subjective、Objective、Assessment、Plan）。
2. THE SOAP_Generator SHALL 使用 RAG_Engine 查詢醫學縮寫字典，將口語描述標準化為醫療術語。
3. WHEN SOAP_Generator 完成生成，THE VoiceNursy SHALL 於 10 秒內顯示完整 SOAP_Entry 供 Nurse 審閱。
4. WHEN Nurse 審閱 SOAP_Entry 後確認送出，THE VoiceNursy SHALL 將 SOAP_Entry 儲存至 Patient_Record 並記錄時間戳記與 Nurse 識別碼。
5. IF SOAP_Generator 無法將語音內容分類至任一 SOAP 欄位，THEN THE SOAP_Generator SHALL 將該段文字標記為「待確認」並以黃色標示，提示 Nurse 手動分類。
6. THE VoiceNursy SHALL 允許 Nurse 在確認送出前對任一 SOAP 欄位進行文字編輯。
7. THE SOAP_Generator SHALL 生成符合台灣醫療評鑑委員會（JCI 或 JCIA）病歷書寫規範的 SOAP_Entry。

---

### 需求 4：主動防呆用藥警示（Active Safety Net）

**使用者故事：** 身為護理師，我希望系統能在我輸入異常數值或劑量時立即警示，以防止疲勞作業下的給藥錯誤。

#### 驗收標準

1. WHEN SOAP_Generator 生成 SOAP_Entry，THE Safety_Net SHALL 即時分析 SOAP_Entry 中的數值與劑量，並與 RAG_Engine 中的常規劑量範圍進行比對。
2. WHEN Safety_Net 偵測到數值或劑量超出常規範圍，THE Safety_Net SHALL 於 2 秒內觸發紅色閃爍視覺警示與提示音。
3. WHEN Alert 被觸發，THE Safety_Net SHALL 顯示具體的警示內容，包含異常項目名稱、偵測值及常規範圍。
4. WHEN Alert 被觸發，THE VoiceNursy SHALL 要求 Nurse 明確選擇「確認知悉並繼續」或「修改數值」，方可儲存 SOAP_Entry。
5. THE Safety_Net SHALL 偵測以下異常類型：藥物劑量超出常規範圍、生命徵象數值超出警戒值（如收縮壓 > 180 mmHg 或 < 90 mmHg）、藥物交互作用風險。
6. IF RAG_Engine 無法查詢到對應藥物或數值的常規範圍，THEN THE Safety_Net SHALL 顯示「無法驗證，請人工確認」的黃色提示，而非略過警示。
7. THE VoiceNursy SHALL 記錄所有 Alert 的觸發時間、內容及 Nurse 的處置選擇，供後續稽核使用。

---

### 需求 5：視覺化交班儀表板（Visual Handover Dashboard）

**使用者故事：** 身為護理師，我希望交班時能快速瀏覽病患狀況的視覺化摘要，以縮短交班時間並降低資訊遺漏風險。

#### 驗收標準

1. WHEN Nurse 進入 Handover_Dashboard，THE Handover_Dashboard SHALL 顯示當前 Shift 內所有負責病患的狀況摘要，載入時間不超過 5 秒。
2. THE Handover_Dashboard SHALL 以時間軸形式呈現每位病患在當前 Shift 內的 SOAP_Entry 紀錄。
3. THE Handover_Dashboard SHALL 以折線圖呈現每位病患的生命徵象趨勢（體溫、血壓、心跳、血氧），資料點來源為 SOAP_Entry 中的 Objective 欄位。
4. WHEN 病患的生命徵象數值超出警戒值，THE Handover_Dashboard SHALL 以紅色標示該資料點及對應的時間軸事件。
5. THE Handover_Dashboard SHALL 提供依病患優先級（依 Alert 數量及生命徵象異常程度）排序的病患清單。
6. WHEN Nurse 點選特定病患，THE Handover_Dashboard SHALL 展開顯示該病患的完整 SOAP_Entry 時間軸及生命徵象趨勢圖。
7. THE Handover_Dashboard SHALL 支援匯出當前 Shift 的交班摘要為 PDF 格式，供紙本備份使用。

---

### 需求 6：離線模式與資料同步

**使用者故事：** 身為護理師，我希望在網路不穩定的環境下仍能繼續記錄病歷，以確保照護不中斷。

#### 驗收標準

1. WHEN 行動裝置網路連線中斷，THE VoiceNursy SHALL 於 3 秒內偵測到離線狀態並顯示離線模式指示器。
2. WHILE VoiceNursy 處於離線模式，THE VoiceNursy SHALL 允許 Nurse 繼續進行語音錄製與 SOAP_Entry 的本地儲存。
3. WHILE VoiceNursy 處於離線模式，THE Safety_Net SHALL 使用本地快取的 RAG_Engine 資料執行基本的數值範圍警示。
4. WHEN 網路連線恢復，THE VoiceNursy SHALL 於 60 秒內自動將離線期間產生的 SOAP_Entry 同步至後端資料庫，並顯示同步結果通知。
5. IF 離線期間產生的 SOAP_Entry 與後端資料發生衝突，THEN THE VoiceNursy SHALL 保留兩份版本並通知 Nurse 進行人工確認。
6. THE VoiceNursy SHALL 在離線模式下停用需要即時 LLM API 呼叫的 SOAP_Generator 功能，並顯示「AI 生成功能暫時停用，請手動輸入」的提示。

---

### 需求 7：多語言病歷標準化輸出

**使用者故事：** 身為護理師，我希望無論以何種語言輸入，最終病歷都能以標準繁體中文輸出，以符合醫院病歷管理規範。

#### 驗收標準

1. THE SOAP_Generator SHALL 將所有語音輸入（無論中文、英文或台語）轉換為繁體中文的 SOAP_Entry 輸出。
2. THE SOAP_Generator SHALL 保留國際通用的醫學縮寫（如 BP、HR、SpO2）以英文原文呈現於 SOAP_Entry 中。
3. THE SOAP_Generator SHALL 使用 RAG_Engine 中的醫學縮寫字典，將台語或口語描述轉換為對應的標準醫療術語。
4. WHEN SOAP_Generator 遇到無法對應至標準術語的詞彙，THE SOAP_Generator SHALL 保留原始詞彙並以括號標注「待確認術語」。

---

### 需求 8：系統管理與藥典維護

**使用者故事：** 身為系統管理員，我希望能管理使用者帳號及維護藥典資料，以確保系統資料的準確性與時效性。

#### 驗收標準

1. THE VoiceNursy SHALL 提供 Admin 專用的管理介面，用於新增、停用及修改 Nurse 帳號。
2. THE VoiceNursy SHALL 允許 Admin 更新 RAG_Engine 向量資料庫中的藥典資料，更新後 30 分鐘內生效。
3. WHEN Admin 更新藥典資料，THE VoiceNursy SHALL 記錄更新時間、更新者及變更內容，供稽核追蹤。
4. THE VoiceNursy SHALL 提供系統使用統計報表，包含每日語音輸入次數、Alert 觸發次數及平均病歷生成時間。
5. IF Admin 嘗試刪除仍有關聯 Patient_Record 的 Nurse 帳號，THEN THE VoiceNursy SHALL 拒絕刪除並顯示「該帳號仍有關聯病歷，請先轉移紀錄」的錯誤訊息。
