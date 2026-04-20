# 護理聲助手 VoiceNursy

> 專為高壓醫療環境設計的 AI 智能護理站——讓護理師專注照護，而非文書。

---

## 專案簡介

VoiceNursy 是一款純軟體的行動應用程式，定位為「隱形的 AI 護理長」。系統在不改變護理師現有巡房習慣的前提下，透過語音輸入自動完成病歷記錄，並主動攔截潛在的給藥錯誤。

**解決的三大痛點：**
- 護理師每日花費 2-3 小時以上在文書作業
- 輪班疲勞下的給藥劑量錯誤風險
- 傳統交班資訊不直覺、容易遺漏

---

## 核心功能

### 🎙️ Voice-to-SOAP 語音病歷生成
護理師在床邊口述（支援中文、英文、台語混合），系統自動生成符合醫院評鑑標準的 SOAP 格式病歷。巡房結束，紀錄即完成。

### 🚨 Active Safety Net 主動防呆警示
即時分析語音內容中的數值與劑量，偵測到異常時（如普拿疼 5000mg）立即觸發紅色閃爍警示與提示音，強制護理師確認後方可儲存。

### 📊 Visual Handover Dashboard 視覺化交班儀表板
自動將一整班的 SOAP 紀錄轉化為病患狀態時間軸與生命徵象趨勢圖，接班護理師幾秒內即可掌握全班狀況。

---

## 技術架構

```
行動裝置 (React Native)
    │
    ├── 語音輸入 → OpenAI Whisper API (STT)
    ├── SOAP 生成 → Google Gemini 1.5 Pro / Ollama Llama 3.1 (備援)
    ├── 防呆警示 → RAG Engine (pgvector + 藥典知識庫)
    └── 離線模式 → SQLite 本地儲存 + 自動同步
    │
後端服務 (Python FastAPI)
    │
    └── PostgreSQL 16 + pgvector
```

| 層級 | 技術 |
|------|------|
| 前端 | React Native (TypeScript) |
| STT | OpenAI Whisper API (large-v3) |
| LLM | Google Gemini 1.5 Pro / Ollama + Llama 3.1 |
| RAG | pgvector (PostgreSQL 擴充) |
| 後端 | Python FastAPI |
| 資料庫 | PostgreSQL 16 + pgvector |
| 本地儲存 | SQLite (expo-sqlite) |

---

## 快速開始

### 環境需求

- Node.js 20+
- Python 3.11+
- PostgreSQL 16（含 pgvector 擴充）
- Expo CLI

### 後端啟動

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# 設定環境變數
cp .env.example .env
# 填入 OPENAI_API_KEY、GEMINI_API_KEY、DATABASE_URL

# 資料庫初始化
python scripts/init_db.py

# 啟動服務
uvicorn main:app --reload --port 8000
```

### 前端啟動

```bash
cd mobile
npm install
npx expo start
```

---

## 專案結構

```
voice-nursy/
├── backend/                  # FastAPI 後端
│   ├── services/
│   │   ├── auth/             # 認證服務
│   │   ├── stt/              # 語音轉文字服務
│   │   ├── soap/             # SOAP 生成服務
│   │   ├── safety/           # Safety Net 防呆服務
│   │   ├── handover/         # 交班儀表板服務
│   │   ├── sync/             # 離線同步服務
│   │   └── admin/            # 管理服務
│   ├── rag/                  # RAG 引擎（藥典/縮寫字典）
│   ├── models/               # 資料庫模型
│   └── tests/                # 測試（Pytest + Hypothesis）
├── mobile/                   # React Native 前端
│   ├── components/
│   │   ├── AudioRecorder/
│   │   ├── SOAPViewer/
│   │   ├── AlertOverlay/
│   │   └── HandoverDashboard/
│   ├── store/                # Zustand 狀態管理
│   └── hooks/                # React Query hooks
└── .kiro/specs/voice-nursy/  # 規格文件
    ├── requirements.md
    ├── design.md
    └── tasks.md
```

---

## API 文件

後端啟動後可於 `http://localhost:8000/docs` 查看完整 Swagger UI 文件。

主要端點：

| 服務 | 路徑 | 說明 |
|------|------|------|
| 認證 | `POST /auth/login` | 員工編號登入 |
| STT | `POST /stt/transcribe` | 語音轉文字 |
| SOAP | `POST /soap/generate` | 生成 SOAP 病歷 |
| 防呆 | `POST /safety/check` | 數值/劑量警示檢查 |
| 交班 | `GET /handover/dashboard` | 取得交班儀表板 |
| 同步 | `POST /sync/push` | 離線資料同步 |

---

## 測試

```bash
cd backend
# 單元測試
pytest tests/unit/

# 屬性測試（Hypothesis）
pytest tests/property/

# 全部測試
pytest --cov=. tests/
```

---

## 商業模式

- **SaaS 訂閱制**：依護理站或帳號數量收取月費/年費
- **地端部署**：醫學中心專用，搭配本地 LLM 確保病歷不出院
- **HIS/NIS 介接**：與醫院現有資訊系統 API 串接專案費用

目標客戶：區域醫院、醫學中心、大型連鎖長照機構

---

## 開發時程

| 階段 | 時程 | 目標 |
|------|------|------|
| Phase 1 | Month 1-2 | Whisper STT + Gemini SOAP 核心 MVP |
| Phase 2 | Month 3-4 | RAG 防呆機制 + 前端介面 |
| Phase 3 | Month 5-6 | 交班儀表板 + 封閉測試 |

---

## 授權

本專案為私有商業軟體，版權所有。
