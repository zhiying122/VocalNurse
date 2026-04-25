#!/bin/bash

# VoiceNursy 專案設定腳本
# 此腳本協助快速設定開發環境

set -e

echo "=========================================="
echo "VoiceNursy 智能護理站系統 - 環境設定"
echo "=========================================="
echo ""

# 檢查 Python
echo "檢查 Python..."
if ! command -v python3 &> /dev/null; then
    echo "❌ 未找到 Python 3，請先安裝 Python 3.8+"
    exit 1
fi
PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
echo "✅ Python $PYTHON_VERSION"

# 檢查 Node.js
echo "檢查 Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，請先安裝 Node.js 16+"
    exit 1
fi
NODE_VERSION=$(node --version)
echo "✅ Node.js $NODE_VERSION"

# 檢查 Docker
echo "檢查 Docker..."
if ! command -v docker &> /dev/null; then
    echo "⚠️  未找到 Docker，將跳過 Docker 相關設定"
    DOCKER_AVAILABLE=false
else
    DOCKER_VERSION=$(docker --version)
    echo "✅ $DOCKER_VERSION"
    DOCKER_AVAILABLE=true
fi

echo ""
echo "=========================================="
echo "設定後端環境"
echo "=========================================="

# 設定後端
cd backend

# 建立虛擬環境
if [ ! -d "venv" ]; then
    echo "建立 Python 虛擬環境..."
    python3 -m venv venv
    echo "✅ 虛擬環境已建立"
fi

# 啟動虛擬環境
echo "啟動虛擬環境..."
source venv/bin/activate || . venv/Scripts/activate

# 安裝依賴
echo "安裝 Python 依賴..."
pip install --upgrade pip
pip install -r requirements.txt
echo "✅ Python 依賴已安裝"

# 複製環境變數範本
if [ ! -f ".env" ]; then
    echo "複製環境變數範本..."
    cp .env.example .env
    echo "✅ 已建立 .env 檔案，請編輯此檔案填入實際配置"
else
    echo "⚠️  .env 檔案已存在，跳過"
fi

# 建立 logs 目錄
mkdir -p logs
echo "✅ 已建立 logs 目錄"

cd ..

echo ""
echo "=========================================="
echo "設定前端環境"
echo "=========================================="

# 設定前端
cd frontend

# 安裝依賴
echo "安裝 Node.js 依賴..."
npm install
echo "✅ Node.js 依賴已安裝"

# 複製環境變數範本
if [ ! -f ".env" ]; then
    echo "複製環境變數範本..."
    cp .env.example .env
    echo "✅ 已建立 .env 檔案，請編輯此檔案填入實際配置"
else
    echo "⚠️  .env 檔案已存在，跳過"
fi

cd ..

echo ""
echo "=========================================="
echo "Docker 設定"
echo "=========================================="

if [ "$DOCKER_AVAILABLE" = true ]; then
    echo "啟動 Docker 服務..."
    docker-compose up -d postgres redis minio
    echo "✅ PostgreSQL, Redis, MinIO 已啟動"
    echo ""
    echo "服務資訊："
    echo "  - PostgreSQL: localhost:5432"
    echo "  - Redis: localhost:6379"
    echo "  - MinIO: localhost:9000 (Console: localhost:9001)"
    echo "  - MinIO 預設帳號: minioadmin / minioadmin"
else
    echo "⚠️  Docker 未安裝，請手動安裝並設定 PostgreSQL, Redis, MinIO"
fi

echo ""
echo "=========================================="
echo "設定完成！"
echo "=========================================="
echo ""
echo "後續步驟："
echo ""
echo "1. 編輯環境變數檔案："
echo "   - backend/.env"
echo "   - frontend/.env"
echo ""
echo "2. 啟動後端服務："
echo "   cd backend"
echo "   source venv/bin/activate  # Linux/Mac"
echo "   # 或 venv\\Scripts\\activate  # Windows"
echo "   alembic upgrade head  # 執行資料庫遷移"
echo "   uvicorn app.main:app --reload"
echo ""
echo "3. 啟動前端服務："
echo "   cd frontend"
echo "   npm start"
echo ""
echo "4. 存取服務："
echo "   - 後端 API: http://localhost:8000"
echo "   - API 文件: http://localhost:8000/docs"
echo "   - 前端應用: 依照 Expo 指示操作"
echo ""
echo "=========================================="
