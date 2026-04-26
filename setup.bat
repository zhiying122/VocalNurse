@echo off
REM VoiceNursy 專案設定腳本 (Windows)
REM 此腳本協助快速設定開發環境

echo ==========================================
echo VoiceNursy 智能護理站系統 - 環境設定
echo ==========================================
echo.

REM 檢查 Python
echo 檢查 Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 未找到 Python，請先安裝 Python 3.8+
    exit /b 1
)
for /f "tokens=2" %%i in ('python --version') do set PYTHON_VERSION=%%i
echo ✅ Python %PYTHON_VERSION%

REM 檢查 Node.js
echo 檢查 Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 未找到 Node.js，請先安裝 Node.js 16+
    exit /b 1
)
for /f %%i in ('node --version') do set NODE_VERSION=%%i
echo ✅ Node.js %NODE_VERSION%

REM 檢查 Docker
echo 檢查 Docker...
docker --version >nul 2>&1
if errorlevel 1 (
    echo ⚠️  未找到 Docker，將跳過 Docker 相關設定
    set DOCKER_AVAILABLE=false
) else (
    for /f "tokens=*" %%i in ('docker --version') do set DOCKER_VERSION=%%i
    echo ✅ !DOCKER_VERSION!
    set DOCKER_AVAILABLE=true
)

echo.
echo ==========================================
echo 設定後端環境
echo ==========================================

REM 設定後端
cd backend

REM 建立虛擬環境
if not exist "venv" (
    echo 建立 Python 虛擬環境...
    python -m venv venv
    echo ✅ 虛擬環境已建立
)

REM 啟動虛擬環境
echo 啟動虛擬環境...
call venv\Scripts\activate.bat

REM 安裝依賴
echo 安裝 Python 依賴...
python -m pip install --upgrade pip
pip install -r requirements.txt
echo ✅ Python 依賴已安裝

REM 複製環境變數範本
if not exist ".env" (
    echo 複製環境變數範本...
    copy .env.example .env
    echo ✅ 已建立 .env 檔案，請編輯此檔案填入實際配置
) else (
    echo ⚠️  .env 檔案已存在，跳過
)

REM 建立 logs 目錄
if not exist "logs" mkdir logs
echo ✅ 已建立 logs 目錄

cd ..

echo.
echo ==========================================
echo 設定前端環境
echo ==========================================

REM 設定前端
cd frontend

REM 安裝依賴
echo 安裝 Node.js 依賴...
call npm install
echo ✅ Node.js 依賴已安裝

REM 複製環境變數範本
if not exist ".env" (
    echo 複製環境變數範本...
    copy .env.example .env
    echo ✅ 已建立 .env 檔案，請編輯此檔案填入實際配置
) else (
    echo ⚠️  .env 檔案已存在，跳過
)

cd ..

echo.
echo ==========================================
echo Docker 設定
echo ==========================================

if "%DOCKER_AVAILABLE%"=="true" (
    echo 啟動 Docker 服務...
    docker-compose up -d postgres redis minio
    echo ✅ PostgreSQL, Redis, MinIO 已啟動
    echo.
    echo 服務資訊：
    echo   - PostgreSQL: localhost:5432
    echo   - Redis: localhost:6379
    echo   - MinIO: localhost:9000 (Console: localhost:9001^)
    echo   - MinIO 預設帳號: minioadmin / minioadmin
) else (
    echo ⚠️  Docker 未安裝，請手動安裝並設定 PostgreSQL, Redis, MinIO
)

echo.
echo ==========================================
echo 設定完成！
echo ==========================================
echo.
echo 後續步驟：
echo.
echo 1. 編輯環境變數檔案：
echo    - backend\.env
echo    - frontend\.env
echo.
echo 2. 啟動後端服務：
echo    cd backend
echo    venv\Scripts\activate.bat
echo    alembic upgrade head
echo    uvicorn app.main:app --reload
echo.
echo 3. 啟動前端服務：
echo    cd frontend
echo    npm start
echo.
echo 4. 存取服務：
echo    - 後端 API: http://localhost:8000
echo    - API 文件: http://localhost:8000/docs
echo    - 前端應用: 依照 Expo 指示操作
echo.
echo ==========================================

pause
