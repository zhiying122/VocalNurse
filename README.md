<p align="center">
  <img src="safety-ui/logo.png" alt="VoiceNursy Logo" width="120">
</p>

<h1 align="center">🏥 VoiceNursy 護理聲助手</h1>

<p align="center">
  <strong>語音驅動的智慧護理紀錄系統 — 用科技守護每一份照護的溫暖</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-blue?logo=python" alt="Python">
  <img src="https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/Ollama-Llama_3.2-orange?logo=meta" alt="Ollama">
  <img src="https://img.shields.io/badge/Whisper-本地STT-green?logo=openai" alt="Whisper">
  <img src="https://img.shields.io/badge/Tests-122_passed-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/SDGs-3·8·9-blue" alt="SDGs">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

---

## 專案簡介

> **一句話描述：** 護理師在床邊口述，系統自動辨識語音、生成 SOAP 病歷、攔截異常劑量，全程本地運行，資料不出院。

### 慈悲科技理念

> 「每天下班後，我還要花兩個小時補寫護理紀錄。回到家，孩子已經睡了。我選擇護理這份工作，是因為想照顧人，不是想當文書人員。」— 某醫學中心護理師的真實心聲

VoiceNursy 以**慈悲為本、科技為用**，把時間還給護理師，讓他們回歸照護的初心。

台灣護理師每天花費 **2–3 小時** 手寫或打字輸入護理紀錄。VoiceNursy 讓護理師只需在床邊口述，系統就能：

1. 🎙️ 自動辨識語音（支援中英台混合口述）
2. 🧠 AI 生成結構化 SOAP 護理紀錄
3. 🛡️ 即時攔截劑量異常、過敏藥物、危險交互作用
4. 📊 自動產出視覺化交班報告

**從口述到歸檔，只需 30 秒。**

---

## 核心功能

| 功能 | 說明 |
|------|------|
| 🎙️ 語音輸入 | Web Audio API 瀏覽器即時錄音，WebM Opus 編碼，支援暫停/繼續 |
| 🔊 語音辨識 | OpenAI Whisper 本地 CPU 推論，醫療術語 Prompt 優化（50+ 關鍵詞注入） |
| 🧹 文字前處理 | 藥名標準化（30+ 映射）、醫學縮寫統一（18 種）、PII 個資遮罩 |
| 🧠 SOAP 生成 | Ollama + Llama 3.2:3b 本地推論，Gemini 2.0 Flash / GPT-4o 備援 |
| 🛡️ 藥物安全防呆 | 35 種藥物資料庫、25 組交互作用、單次/每日劑量檢查、過敏原交叉比對 |
| 📊 生命徵象監測 | BP / HR / SpO2 / BT / RR 五項警戒值，支援中英文格式輸入 |
| 👥 共享護理紀錄 | 跨護理師、跨班別、跨裝置共享，所有紀錄即時同步 |
| 📋 交班儀表板 | 統計摘要、疼痛趨勢圖、給藥時間軸、列印功能 |
| 🔒 安全認證 | JWT Token + PBKDF2-SHA256 600,000 次迭代 + 登入速率限制（5 次/15 分鐘） |
| 📱 離線支援 | IndexedDB 本地暫存，網路恢復自動同步，斷網照用 |
| 📝 操作紀錄 | Audit Log 完整記錄所有操作，跨登入階段持久化保存，供安全稽核 |
| 💝 關懷提醒 | 自動分析病患紀錄，產生有溫度的關懷建議 |

---

## 系統架構

```
┌─────────────────────────────────────────────────────────────┐
│                    🎙️ 語音輸入層                             │
│  Web Audio API → WebM Opus → Whisper STT → 文字前處理       │
├─────────────────────────────────────────────────────────────┤
│                    🧠 AI 處理層                              │
│  PII 遮罩 → Prompt Engineering → Ollama LLM → SOAP JSON    │
├─────────────────────────────────────────────────────────────┤
│                    🛡️ 安全防呆層                             │
│  劑量閾值比對 → 過敏原交叉檢查 → 藥物交互作用 → 生命徵象警戒  │
└─────────────────────────────────────────────────────────────┘
```

**前端**（`safety-ui/`）：HTML5 / CSS3 / Vanilla JS，零框架依賴，任何瀏覽器直接開啟

**後端**（`brain/`）：Python 3.11+ / FastAPI，非同步高效能 API 伺服器

---

## 快速開始

### 前置需求

| 軟體 | 版本 | 用途 |
|------|------|------|
| [Python](https://www.python.org/downloads/) | 3.11+ | 後端 API 伺服器 |
| [Node.js](https://nodejs.org/) | 18+ | 前端測試工具（vitest） |
| [Ollama](https://ollama.com) | 最新版 | 本地 LLM 推論引擎 |
| [ffmpeg](https://ffmpeg.org/) | 最新版 | 音檔格式轉換（WebM → WAV） |

### 步驟一：安裝 Ollama 並下載模型

```bash
# 到 https://ollama.com 下載並安裝 Ollama，然後：
ollama pull llama3.2:3b
```

### 步驟二：安裝後端依賴

```bash
cd brain
pip install -r requirements.txt
```

### 步驟三：設定環境變數

```bash
cd brain
cp .env.example .env
```

編輯 `brain/.env`，填入 JWT 密鑰（**必填**）：

```bash
# 產生隨機密鑰：
python -c "import secrets; print(secrets.token_hex(32))"
```

`.env` 範例：

```env
LLM_PROVIDER=ollama
OLLAMA_MODEL=llama3.2:3b
OLLAMA_BASE_URL=http://localhost:11434
WHISPER_MODEL_SIZE=base
JWT_SECRET_KEY=你的隨機密鑰貼在這裡
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

### 步驟四：啟動後端

```bash
cd brain
uvicorn api:app --reload --port 8001
```

看到 `Uvicorn running on http://0.0.0.0:8001` 即啟動成功。

### 步驟五：啟動前端

```bash
cd safety-ui
python -m http.server 3000
```

### 步驟六：開啟瀏覽器

```
http://localhost:3000
```

API 文件：`http://localhost:8001/docs`

---

## 使用流程

```
1. 註冊 / 登入
2. 新增病患（姓名、床號、年齡、診斷、過敏藥物）
3. 選擇病患 → 點擊 🎙️ 錄音 → 口述護理觀察
4. 系統自動辨識語音 → 生成 SOAP 護理紀錄
5. 🛡️ 安全防呆自動檢查（劑量 / 過敏 / 交互作用 / 生命徵象）
6. 確認存檔 → 紀錄自動共享給所有護理師
7. 交班時 → 切換到交班儀表板查看摘要
```

---

## API 文件

### 認證

| 方法 | 端點 | 說明 |
|------|------|------|
| `POST` | `/auth/register` | 護理師註冊 |
| `POST` | `/auth/login` | 登入，回傳 JWT |

### 病患管理

| 方法 | 端點 | 說明 |
|------|------|------|
| `GET` | `/patients` | 取得所有病患 |
| `POST` | `/patients` | 新增病患 |
| `DELETE` | `/patients/{id}` | 刪除病患 |

### 語音辨識 & SOAP 生成

| 方法 | 端點 | 說明 |
|------|------|------|
| `POST` | `/stt/transcribe` | 音檔 → 語音辨識 |
| `POST` | `/brain/process` | 文字 → SOAP 生成 |
| `POST` | `/pipeline/full` | 音檔 → STT → SOAP 一站式 |

### 護理紀錄（需 JWT）

| 方法 | 端點 | 說明 |
|------|------|------|
| `POST` | `/records` | 儲存 SOAP 紀錄 |
| `GET` | `/records/patient/{id}` | 查詢病患紀錄 |
| `GET` | `/records` | 查詢所有紀錄（支援日期篩選+分頁） |
| `PUT` | `/records/{id}` | 編輯紀錄 |

---

## 安全措施

| 措施 | 實作方式 |
|------|----------|
| 密碼儲存 | PBKDF2-SHA256，600,000 次迭代（OWASP 2024） |
| JWT 認證 | HS256 簽章，8 小時有效期 |
| 登入速率限制 | 5 次失敗 / 15 分鐘，超過回傳 HTTP 429 |
| CORS 限制 | 允許來源從環境變數讀取 |
| PII 個資遮罩 | 自動偵測並遮罩身分證字號、電話、Email |
| 全程本地運行 | STT 和 LLM 都在本機執行，病歷資料不出院 |
| 輸入驗證 | Pydantic Schema 強制型別檢查 |

---

## 測試

本專案採用**屬性測試（Property-Based Testing）**方法論。

### 後端（pytest + hypothesis）

```bash
cd brain
python -m pytest test_records.py -v
```

### 前端（vitest + fast-check）

```bash
cd safety-ui
npx vitest run
```

### 測試結果

```
後端：9 tests passed ✅
前端：122 tests passed ✅（含 Audit Log 持久化 PBT）
總計：131 tests ALL PASSED ✅
```

---

## 專案結構

```
VoiceNursy/
├── README.md
├── brain/                    # 後端 API（FastAPI）
│   ├── api.py                #   API 路由
│   ├── auth.py               #   JWT + PBKDF2 認證
│   ├── brain.py              #   SOAP 生成主邏輯
│   ├── llm_client.py         #   LLM 客戶端（Ollama/Gemini/OpenAI）
│   ├── prompts.py            #   SOAP Prompt 模板
│   ├── schemas.py            #   Pydantic 資料模型
│   ├── stt_service.py        #   Whisper 語音辨識
│   ├── correction_dict.py    #   醫療術語校正字典
│   ├── pii_redactor.py       #   PII 個資遮罩
│   ├── patients.py           #   病患 CRUD
│   ├── records.py            #   護理紀錄管理
│   ├── drug_safety_db.json   #   藥物安全資料庫（35 種）
│   └── requirements.txt
│
├── safety-ui/                # 前端介面（Vanilla JS）
│   ├── index.html
│   ├── app.js                #   應用主邏輯（含 Audit Log 持久化）
│   ├── safety_check.js       #   防呆引擎
│   ├── charts.js             #   Chart.js 視覺化
│   ├── offline_sync.js       #   IndexedDB 離線同步
│   ├── styles.css
│   ├── drug_safety_db.json
│   └── __tests__/            #   前端測試（16 個測試檔案）
│
├── input/                    # 獨立語音處理模組
│   ├── pipeline.py           #   完整流程：錄音→降噪→修剪→STT
│   ├── recorder.py
│   ├── denoiser.py
│   ├── stt.py
│   └── requirements.txt
│
└── docs/                     # 比賽文件
```

---

## 與直接使用 ChatGPT 的差異

| 比較項目 | ❌ 直接用 ChatGPT | ✅ VoiceNursy |
|----------|-------------------|---------------|
| 隱私安全 | 病歷資料上傳雲端，違反醫療個資法 | 全程本地運行，資料不出院 |
| 語音辨識 | 無法辨識台語和醫療口語 | Whisper + 醫療術語 Prompt 優化 |
| 劑量防呆 | 無劑量檢查 | 35 種藥物即時閾值比對，2 秒內攔截 |
| 過敏檢查 | 無過敏原交叉檢查 | Penicillin / NSAIDs 交叉過敏自動偵測 |
| 藥物交互作用 | 需手動詢問 | 25 組危險配對自動比對 |
| 離線使用 | 需要網路 | IndexedDB 離線暫存，斷網照用 |
| 費用 | ChatGPT Plus $20 USD/月 | 完全免費，本地運行 |

---

## SDGs 永續發展目標

| SDG | 連結說明 |
|-----|---------|
| **SDG 3 良好健康與福祉** | 藥物安全防呆即時攔截異常劑量；共享紀錄確保照護連續性 |
| **SDG 8 良好工作及經濟成長** | 減少護理師 70% 紀錄時間，改善醫療職業環境 |
| **SDG 9 工業、創新及基礎建設** | 語音辨識 + 本地 LLM + 即時防呆引擎創新應用於醫療場域 |

---

## 環保 5R 實踐

| 原則 | 實踐方式 |
|------|---------|
| 📉 Reduce | 數位化取代手寫病歷，全台 17 萬護理師每年可減少 **5.1 億張紙** |
| 🔋 Reduce | 全程本地運行，碳足跡相比雲端 AI 減少超過 **90%** |
| 🚫 Refuse | 拒絕雲端服務，利用現有電腦即可運行 |
| ♻️ Reuse | 交班報告自動生成，跨班別重複使用 |
| 🔧 Repair | 開源架構，醫院 IT 可自行維護 |

---

## 團隊資訊

| 角色 | 姓名 | 負責項目 |
|------|------|----------|
| 👨‍💻 開發者 | （請填入） | （請填入） |
| 👩‍💻 開發者 | （請填入） | （請填入） |
| 🎨 設計師 | （請填入） | （請填入） |
| 📋 指導老師 | （請填入） | （請填入） |

---

## 授權

本專案採用 [MIT License](LICENSE) 授權。

---

<p align="center">
  <strong>🏥 VoiceNursy — 讓護理師回歸照護，讓 AI 處理文書</strong>
</p>
