@echo off
REM VoiceNursy Deployment Script for Windows
REM This script automates the deployment process for different environments

setlocal enabledelayedexpansion

REM Check if command is provided
if "%1"=="" (
    call :show_usage
    exit /b 1
)

REM Execute command
if /i "%1"=="local" (
    call :deploy_local
) else if /i "%1"=="docker" (
    call :deploy_docker
) else if /i "%1"=="production" (
    call :deploy_production
) else if /i "%1"=="stop" (
    call :stop_services
) else if /i "%1"=="logs" (
    call :show_logs %2
) else if /i "%1"=="help" (
    call :show_usage
) else (
    echo [ERROR] Invalid command: %1
    echo.
    call :show_usage
    exit /b 1
)

exit /b 0

:check_prerequisites
    echo [INFO] Checking prerequisites...
    
    REM Check Docker
    docker --version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Docker is not installed. Please install Docker Desktop first.
        exit /b 1
    )
    
    REM Check Docker Compose
    docker-compose --version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Docker Compose is not installed. Please install Docker Compose first.
        exit /b 1
    )
    
    echo [INFO] Prerequisites check passed.
    exit /b 0

:check_env_file
    if not exist "%~1" (
        echo [ERROR] Environment file %~1 not found.
        echo [INFO] Please copy from .env.example and configure it.
        exit /b 1
    )
    exit /b 0

:deploy_local
    echo [INFO] Deploying to local development environment...
    
    call :check_prerequisites
    if errorlevel 1 exit /b 1
    
    call :check_env_file "backend\.env"
    if errorlevel 1 exit /b 1
    
    call :check_env_file "frontend\.env"
    if errorlevel 1 exit /b 1
    
    REM Start infrastructure services
    echo [INFO] Starting infrastructure services...
    docker-compose up -d postgres redis minio
    
    REM Wait for services to be ready
    echo [INFO] Waiting for services to be ready...
    timeout /t 10 /nobreak >nul
    
    REM Check service health
    docker-compose ps
    
    echo [INFO] Local infrastructure deployed successfully!
    echo [INFO] Backend API will be available at: http://localhost:8000
    echo [INFO] API Documentation: http://localhost:8000/docs
    echo.
    echo [INFO] To start the backend:
    echo   cd backend ^&^& uvicorn app.main:app --reload
    echo.
    echo [INFO] To start the frontend:
    echo   cd frontend ^&^& npm start
    
    exit /b 0

:deploy_docker
    echo [INFO] Deploying with Docker Compose...
    
    call :check_prerequisites
    if errorlevel 1 exit /b 1
    
    call :check_env_file "backend\.env"
    if errorlevel 1 exit /b 1
    
    call :check_env_file "frontend\.env"
    if errorlevel 1 exit /b 1
    
    REM Build and start all services
    echo [INFO] Building and starting all services...
    docker-compose up -d --build
    
    REM Wait for services to be ready
    echo [INFO] Waiting for services to be ready...
    timeout /t 20 /nobreak >nul
    
    REM Check service health
    echo [INFO] Checking service health...
    docker-compose ps
    
    REM Test backend health
    echo [INFO] Testing backend health...
    set retry_count=0
    set max_retries=30
    
    :health_check_loop
    if !retry_count! geq !max_retries! (
        echo [ERROR] Backend health check failed after !max_retries! attempts.
        echo [INFO] Check logs with: docker-compose logs backend
        exit /b 1
    )
    
    curl -f http://localhost:8000/health >nul 2>&1
    if errorlevel 1 (
        set /a retry_count+=1
        echo|set /p="."
        timeout /t 2 /nobreak >nul
        goto health_check_loop
    )
    
    echo.
    echo [INFO] Backend is healthy!
    echo [INFO] Deployment completed successfully!
    echo [INFO] Backend API: http://localhost:8000
    echo [INFO] API Documentation: http://localhost:8000/docs
    echo [INFO] Frontend: http://localhost:19006
    echo.
    echo [INFO] View logs with: docker-compose logs -f
    
    exit /b 0

:deploy_production
    echo [INFO] Deploying to production environment...
    
    call :check_prerequisites
    if errorlevel 1 exit /b 1
    
    call :check_env_file "backend\.env.production"
    if errorlevel 1 exit /b 1
    
    REM Confirm production deployment
    echo [WARNING] You are about to deploy to PRODUCTION environment.
    set /p confirm="Are you sure you want to continue? (yes/no): "
    if /i not "!confirm!"=="yes" (
        echo [INFO] Deployment cancelled.
        exit /b 0
    )
    
    REM Build production images
    echo [INFO] Building production images...
    docker-compose -f docker-compose.prod.yml build
    
    REM Start production services
    echo [INFO] Starting production services...
    docker-compose -f docker-compose.prod.yml up -d
    
    REM Wait for services to be ready
    echo [INFO] Waiting for services to be ready...
    timeout /t 30 /nobreak >nul
    
    REM Check service health
    echo [INFO] Checking service health...
    docker-compose -f docker-compose.prod.yml ps
    
    echo [INFO] Production deployment completed!
    echo [INFO] Monitor logs with: docker-compose -f docker-compose.prod.yml logs -f
    
    exit /b 0

:stop_services
    echo [INFO] Stopping services...
    
    if exist "docker-compose.yml" (
        docker-compose down
        echo [INFO] Development services stopped.
    )
    
    if exist "docker-compose.prod.yml" (
        docker-compose -f docker-compose.prod.yml down
        echo [INFO] Production services stopped.
    )
    
    exit /b 0

:show_logs
    if "%~1"=="" (
        docker-compose logs -f
    ) else (
        docker-compose logs -f %~1
    )
    exit /b 0

:show_usage
    echo VoiceNursy Deployment Script for Windows
    echo.
    echo Usage: deploy.bat [command]
    echo.
    echo Commands:
    echo   local       - Deploy local development environment (infrastructure only)
    echo   docker      - Deploy with Docker Compose (all services)
    echo   production  - Deploy production environment with Docker Compose
    echo   stop        - Stop all running services
    echo   logs [svc]  - Show logs (optionally for specific service)
    echo   help        - Show this help message
    echo.
    echo Examples:
    echo   deploy.bat local              # Deploy local infrastructure
    echo   deploy.bat docker             # Deploy all services with Docker
    echo   deploy.bat logs backend       # Show backend logs
    echo   deploy.bat stop               # Stop all services
    exit /b 0
