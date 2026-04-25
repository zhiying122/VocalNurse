# VoiceNursy 智能護理站系統

VoiceNursy 是一個為高壓醫療環境設計的純軟體智能護理站系統，旨在減少護理師的文書負擔並提升醫療安全。系統的核心價值在於將護理師的口語記錄自動轉換為符合醫院評鑑標準的專業 SOAP 格式病歷。

## 專案結構

```
VoiceNursy/
├── backend/                 # Python/FastAPI 後端
│   ├── app/
│   │   ├── api/            # API 端點
│   │   ├── core/           # 核心配置（資料庫、Redis、Storage）
│   │   ├── models/         # 資料庫模型
│   │   ├── schemas/        # Pydantic schemas
│   │   ├── services/       # 業務邏輯服務
│   │   └── main.py         # 應用程式入口
│   ├── alembic/            # 資料庫遷移
│   ├── tests/              # 測試
│   ├── requirements.txt    # Python 依賴
│   └── .env.example        # 環境變數範本
│
├── frontend/               # React Native 前端
│   ├── src/
│   │   ├── components/     # UI 元件
│   │   ├── screens/        # 畫面
│   │   ├── navigation/     # 導航
│   │   ├── services/       # API 服務
│   │   ├── store/          # 狀態管理
│   │   ├── types/          # TypeScript 類型
│   │   └── utils/          # 工具函數
│   ├── package.json        # Node.js 依賴
│   ├── app.json            # Expo 配置
│   └── .env.example        # 環境變數範本
│
├── docker-compose.yml      # Docker 編排
└── README.md               # 專案說明
```

## 技術棧

### 後端
- **Python 3.8+**: 核心語言
- **FastAPI**: Web 框架
- **PostgreSQL**: 主資料庫
- **Redis**: 快取和訊息佇列
- **S3/MinIO**: 音檔儲存
- **OpenAI Whisper**: 語音轉文字
- **LangChain/GPT-4**: SOAP 轉換和驗證

### 前端
- **React Native**: 跨平台行動應用
- **TypeScript**: 類型安全
- **Expo**: 開發工具鏈
- **Zustand**: 狀態管理
- **Axios**: HTTP 客戶端

## 快速開始

### 前置需求

- Python 3.8+
- Node.js 16+
- PostgreSQL 14+
- Redis 7+
- MinIO 或 AWS S3 帳號

### 後端設定

1. 進入後端目錄：
```bash
cd backend
```

2. 建立虛擬環境：
```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
# 或
venv\Scripts\activate  # Windows
```

3. 安裝依賴：
```bash
pip install -r requirements.txt
```

4. 複製環境變數範本並填入實際值：
```bash
cp .env.example .env
# 編輯 .env 檔案，填入資料庫、Redis、Storage 等配置
```

5. 執行資料庫遷移：
```bash
alembic upgrade head
```

6. 啟動後端服務：
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

後端 API 將在 http://localhost:8000 運行

### 前端設定

1. 進入前端目錄：
```bash
cd frontend
```

2. 安裝依賴：
```bash
npm install
# 或
yarn install
```

3. 複製環境變數範本並填入實際值：
```bash
cp .env.example .env
# 編輯 .env 檔案，設定 API_BASE_URL 等配置
```

4. 啟動開發伺服器：
```bash
npm start
# 或
yarn start
```

5. 在模擬器或實體裝置上運行：
```bash
# iOS
npm run ios

# Android
npm run android

# Web
npm run web
```

### 使用 Docker Compose（推薦）

1. 確保已安裝 Docker 和 Docker Compose

2. 啟動所有服務：
```bash
docker-compose up -d
```

這將啟動：
- PostgreSQL (port 5432)
- Redis (port 6379)
- MinIO (port 9000, console: 9001)
- Backend API (port 8000)

3. 查看服務狀態：
```bash
docker-compose ps
```

4. 停止服務：
```bash
docker-compose down
```

## 開發指南

### 後端開發

- API 文件：http://localhost:8000/docs (Swagger UI)
- 資料庫遷移：`alembic revision --autogenerate -m "描述"`
- 執行測試：`pytest`
- 程式碼格式化：`black app/`
- 類型檢查：`mypy app/`

### 前端開發

- 執行測試：`npm test`
- 程式碼格式化：`npm run format`
- Lint 檢查：`npm run lint`

## 測試策略

### 後端測試
- **單元測試**: 測試個別函數和類別
- **屬性測試**: 使用 Hypothesis 進行屬性驗證
- **整合測試**: 測試 API 端點和外部服務整合

執行測試：
```bash
cd backend
pytest                          # 執行所有測試
pytest -m unit                  # 只執行單元測試
pytest -m property_test         # 只執行屬性測試
pytest --cov=app                # 執行測試並生成覆蓋率報告
```

### 前端測試
- **單元測試**: 測試元件和工具函數
- **屬性測試**: 使用 fast-check 進行屬性驗證

執行測試：
```bash
cd frontend
npm test                        # 執行所有測試
npm test -- --watch             # 監視模式
```

## 環境變數說明

### 後端環境變數
詳見 `backend/.env.example`

關鍵配置：
- `DATABASE_URL`: PostgreSQL 連線字串
- `REDIS_URL`: Redis 連線字串
- `STORAGE_*`: S3/MinIO 儲存配置
- `OPENAI_API_KEY`: OpenAI API 金鑰
- `JWT_SECRET_KEY`: JWT 簽章金鑰

### 前端環境變數
詳見 `frontend/.env.example`

關鍵配置：
- `API_BASE_URL`: 後端 API 位址
- `API_TIMEOUT`: API 請求逾時時間

## 部署

### 後端部署

1. 建立 Docker 映像：
```bash
cd backend
docker build -t voicenursy-backend .
```

2. 執行容器：
```bash
docker run -d -p 8000:8000 --env-file .env voicenursy-backend
```

### 前端部署

1. 建置生產版本：
```bash
cd frontend
expo build:android  # Android
expo build:ios      # iOS
```

2. 發布到應用商店或使用 Expo 託管

## 授權

本專案為私有專案，未經授權不得使用或散布。

## 聯絡方式

如有問題或建議，請聯絡開發團隊。
