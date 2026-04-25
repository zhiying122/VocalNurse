# VoiceNursy 專案設定指南

本文件說明 VoiceNursy 智能護理站系統的專案架構和設定步驟。

## 專案架構概覽

### 已建立的目錄結構

```
VoiceNursy/
├── backend/                          # Python/FastAPI 後端
│   ├── app/
│   │   ├── api/v1/                  # API 路由（待實作）
│   │   ├── core/                    # 核心配置
│   │   │   ├── config.py           # ✅ 應用程式配置
│   │   │   ├── database.py         # ✅ PostgreSQL 連線
│   │   │   ├── redis_client.py     # ✅ Redis 客戶端
│   │   │   └── storage.py          # ✅ S3/MinIO 儲存服務
│   │   ├── models/                  # 資料庫模型（待實作）
│   │   ├── schemas/                 # Pydantic schemas（待實作）
│   │   ├── services/                # 業務邏輯服務（待實作）
│   │   ├── __init__.py             # ✅ 套件初始化
│   │   └── main.py                 # ✅ FastAPI 應用程式入口
│   ├── alembic/                     # 資料庫遷移
│   │   ├── versions/               # 遷移版本
│   │   ├── env.py                  # ✅ Alembic 環境配置
│   │   └── script.py.mako          # ✅ 遷移腳本範本
│   ├── tests/                       # 測試
│   │   ├── __init__.py             # ✅ 測試套件初始化
│   │   └── conftest.py             # ✅ Pytest 配置和 fixtures
│   ├── .dockerignore               # ✅ Docker 忽略檔案
│   ├── .env.example                # ✅ 環境變數範本
│   ├── .gitignore                  # ✅ Git 忽略檔案
│   ├── alembic.ini                 # ✅ Alembic 配置
│   ├── Dockerfile                  # ✅ Docker 映像定義
│   ├── pytest.ini                  # ✅ Pytest 配置
│   └── requirements.txt            # ✅ Python 依賴清單
│
├── frontend/                        # React Native 前端
│   ├── src/
│   │   ├── components/             # UI 元件（待實作）
│   │   ├── navigation/
│   │   │   └── AppNavigator.tsx   # ✅ 應用程式導航
│   │   ├── screens/                # 畫面（待實作）
│   │   ├── services/
│   │   │   └── api.ts             # ✅ API 服務客戶端
│   │   ├── store/                  # 狀態管理（待實作）
│   │   ├── types/
│   │   │   └── index.ts           # ✅ TypeScript 類型定義
│   │   └── utils/                  # 工具函數（待實作）
│   ├── .env.example                # ✅ 環境變數範本
│   ├── .gitignore                  # ✅ Git 忽略檔案
│   ├── app.json                    # ✅ Expo 配置
│   ├── App.tsx                     # ✅ 應用程式入口
│   ├── package.json                # ✅ Node.js 依賴清單
│   └── tsconfig.json               # ✅ TypeScript 配置
│
├── docker-compose.yml              # ✅ Docker 編排配置
├── README.md                       # ✅ 專案說明文件
├── setup.sh                        # ✅ Linux/Mac 設定腳本
└── setup.bat                       # ✅ Windows 設定腳本
```

## 已完成的配置

### 後端配置 ✅

1. **核心基礎設施**
   - ✅ FastAPI 應用程式架構
   - ✅ PostgreSQL 資料庫連線（使用 SQLAlchemy async）
   - ✅ Redis 快取和訊息佇列客戶端
   - ✅ S3/MinIO 物件儲存服務
   - ✅ 環境變數管理（使用 pydantic-settings）

2. **開發工具**
   - ✅ Alembic 資料庫遷移設定
   - ✅ Pytest 測試框架配置
   - ✅ Docker 容器化支援
   - ✅ 程式碼品質工具（black, flake8, mypy）

3. **依賴套件**
   - ✅ Web 框架：FastAPI, Uvicorn
   - ✅ 資料庫：SQLAlchemy, psycopg2-binary, alembic
   - ✅ 快取：redis, hiredis
   - ✅ 儲存：boto3, minio
   - ✅ 音訊處理：pydub, librosa, soundfile
   - ✅ AI 服務：openai, faster-whisper, langchain
   - ✅ 安全：python-jose, passlib, cryptography
   - ✅ 測試：pytest, hypothesis

### 前端配置 ✅

1. **應用程式架構**
   - ✅ React Native + Expo 專案結構
   - ✅ TypeScript 類型系統
   - ✅ 導航架構（React Navigation）
   - ✅ API 服務客戶端（Axios）
   - ✅ 類型定義（完整的 TypeScript interfaces）

2. **開發工具**
   - ✅ TypeScript 配置
   - ✅ Expo 配置（iOS/Android 權限設定）
   - ✅ 測試框架（Jest, fast-check）
   - ✅ 程式碼品質工具（ESLint, Prettier）

3. **依賴套件**
   - ✅ 核心：React, React Native, Expo
   - ✅ 導航：React Navigation
   - ✅ 音訊：expo-av
   - ✅ 網路：axios
   - ✅ 儲存：async-storage
   - ✅ 圖表：react-native-chart-kit
   - ✅ 狀態管理：zustand
   - ✅ 測試：fast-check（屬性測試）

### 基礎設施配置 ✅

1. **Docker Compose**
   - ✅ PostgreSQL 14 容器
   - ✅ Redis 7 容器
   - ✅ MinIO 物件儲存容器
   - ✅ 健康檢查配置
   - ✅ 網路和資料卷設定

2. **環境變數範本**
   - ✅ 後端環境變數（資料庫、Redis、Storage、OpenAI、安全設定）
   - ✅ 前端環境變數（API 配置、音訊設定、功能開關）

## 快速開始

### 自動設定（推薦）

**Linux/Mac:**
```bash
chmod +x setup.sh
./setup.sh
```

**Windows:**
```cmd
setup.bat
```

### 手動設定

#### 1. 啟動基礎設施服務

```bash
docker-compose up -d postgres redis minio
```

服務將在以下端口運行：
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- MinIO: `localhost:9000` (Console: `localhost:9001`)

#### 2. 設定後端

```bash
cd backend

# 建立虛擬環境
python -m venv venv
source venv/bin/activate  # Linux/Mac
# 或 venv\Scripts\activate  # Windows

# 安裝依賴
pip install -r requirements.txt

# 複製並編輯環境變數
cp .env.example .env
# 編輯 .env 檔案，填入實際配置

# 執行資料庫遷移
alembic upgrade head

# 啟動開發伺服器
uvicorn app.main:app --reload
```

後端 API 將在 http://localhost:8000 運行
API 文件：http://localhost:8000/docs

#### 3. 設定前端

```bash
cd frontend

# 安裝依賴
npm install

# 複製並編輯環境變數
cp .env.example .env
# 編輯 .env 檔案，設定 API_BASE_URL

# 啟動開發伺服器
npm start

# 在模擬器或裝置上運行
npm run ios      # iOS
npm run android  # Android
npm run web      # Web
```

## 環境變數配置

### 後端必要配置

編輯 `backend/.env`：

```env
# 資料庫
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=voicenursy
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# MinIO
STORAGE_TYPE=minio
STORAGE_ENDPOINT=localhost:9000
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_BUCKET_NAME=voicenursy-audio

# OpenAI（需要申請 API Key）
OPENAI_API_KEY=your_openai_api_key_here

# 安全（請更改為隨機字串）
JWT_SECRET_KEY=your_jwt_secret_key_here_change_in_production
ENCRYPTION_KEY=your_aes_256_encryption_key_here_32_bytes
```

### 前端必要配置

編輯 `frontend/.env`：

```env
# API 配置
API_BASE_URL=http://localhost:8000/api/v1
API_TIMEOUT=30000
```

## 驗證安裝

### 後端驗證

1. 檢查 API 健康狀態：
```bash
curl http://localhost:8000/health
```

應該返回：
```json
{
  "status": "healthy",
  "database": "connected",
  "redis": "connected"
}
```

2. 查看 API 文件：
訪問 http://localhost:8000/docs

### 前端驗證

1. 啟動 Expo 開發伺服器後，應該看到 QR code
2. 使用 Expo Go 應用程式掃描 QR code
3. 應該看到 "VoiceNursy 智能護理站" 的佔位畫面

## 下一步

專案基礎架構已建立完成，接下來的任務將實作：

1. **Task 2**: 資料庫模型和 API 端點
2. **Task 3**: 語音錄製功能
3. **Task 4**: 語音轉文字服務
4. **Task 5**: SOAP 格式轉換
5. **Task 6**: 安全驗證服務
6. **Task 7**: 視覺化儀表板
7. **Task 8**: 測試和部署

## 常見問題

### Q: Docker 容器無法啟動？
A: 確保 Docker Desktop 正在運行，並檢查端口是否被佔用。

### Q: 後端無法連接資料庫？
A: 檢查 `.env` 檔案中的資料庫配置是否正確，確保 PostgreSQL 容器正在運行。

### Q: 前端無法連接後端 API？
A: 確保後端服務正在運行，並檢查 `frontend/.env` 中的 `API_BASE_URL` 是否正確。

### Q: OpenAI API 金鑰在哪裡取得？
A: 訪問 https://platform.openai.com/api-keys 申請 API 金鑰。

## 技術支援

如遇到問題，請檢查：
1. 所有服務是否正常運行（`docker-compose ps`）
2. 環境變數是否正確配置
3. 依賴套件是否完整安裝
4. 日誌檔案中的錯誤訊息

## 授權

本專案為私有專案，未經授權不得使用或散布。
