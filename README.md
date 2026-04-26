# VoiceNursy 護理聲助手

專為台灣醫療環境設計的 AI 護理記錄系統。護理師在床邊口述，系統自動生成 SOAP 病歷、攔截異常劑量、產出視覺化交班報告。

## 核心功能

**語音轉 SOAP 病歷** — 支援中英台混合口述，Whisper 本地辨識後由 LLM 自動分類為 S/O/A/P 四欄結構

**主動防呆警示** — 即時比對藥品安全劑量資料庫，劑量超標或過敏藥物立即紅色警示攔截

**視覺化交班儀表板** — 疼痛趨勢圖、給藥時間軸，接班護理師幾秒內掌握全班狀況

**全程本地運行** — STT 和 LLM 都在本機執行，病歷資料不出院，符合醫療個資法

## 技術架構

| 元件 | 技術 |
|------|------|
| 語音辨識 | OpenAI Whisper（本地） |
| SOAP 生成 | Ollama + Llama 3.1 8B（本地） |
| 後端 API | Python FastAPI |
| 前端 | 原生 HTML/CSS/JS + Chart.js |
| 資料儲存 | JSON 檔案 + IndexedDB（離線） |

## 啟動方式

需要先安裝：Python 3.11+、Ollama、ffmpeg

```bash
# 1. 安裝 Ollama 並下載模型
ollama pull llama3.1:8b

# 2. 安裝後端套件
cd brain
pip install -r requirements.txt

# 3. 設定環境變數
cp .env.example .env

# 4. 啟動後端（終端機 1）
python -m uvicorn api:app --reload --port 8001

# 5. 啟動前端（終端機 2）
cd ..
python -m http.server 3000 --directory safety-ui
```

瀏覽器打開 http://localhost:3000

## 使用流程

1. 註冊帳號 → 登入
2. 新增病患（姓名、床號、診斷、過敏藥物）
3. 選擇病患 → 點麥克風錄音 → 口述護理內容
4. 系統自動辨識語音 → 生成 SOAP 病歷
5. 若劑量異常或過敏藥物 → 紅色警示跳出
6. 確認存檔 → 切到交班儀表板查看摘要

## 專案結構

```
brain/          # 後端 API（FastAPI）
├── api.py              # API 路由
├── auth.py             # 註冊/登入（JWT）
├── patients.py         # 病患 CRUD
├── stt_service.py      # Whisper 語音辨識
├── brain.py            # SOAP 生成主邏輯
├── llm_client.py       # Ollama/Gemini/OpenAI 切換
├── prompts.py          # SOAP 分類 Prompt
├── correction_dict.py  # 醫療術語校正字典
├── pii_redactor.py     # 個資遮罩
├── schemas.py          # 資料格式定義
└── drug_safety_db.json # 藥品安全劑量表

safety-ui/      # 前端介面
├── index.html          # 主頁面
├── app.js              # 應用邏輯
├── safety_check.js     # 防呆檢查引擎
├── charts.js           # 疼痛趨勢圖
├── offline_sync.js     # IndexedDB 離線同步
└── styles.css          # 樣式

input/          # 獨立語音處理模組（供 A 角色參考）
```
