@echo off
REM VoiceNursy Testing Setup Verification Script (Windows)
REM This script verifies that the testing framework is properly configured

echo ==========================================
echo VoiceNursy Testing Setup Verification
echo ==========================================
echo.

REM Check Python version
echo Checking Python environment...
python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Python installed
    python --version
) else (
    echo [ERROR] Python not found
)
echo.

REM Check Node.js version
echo Checking Node.js environment...
node --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Node.js installed
    node --version
) else (
    echo [ERROR] Node.js not found
)
echo.

REM Check backend configuration files
echo Checking backend configuration...
if exist "backend\pytest.ini" (
    echo [OK] pytest.ini found
) else (
    echo [ERROR] pytest.ini not found
)

if exist "backend\.hypothesis\profiles.yml" (
    echo [OK] Hypothesis profiles configured
) else (
    echo [ERROR] Hypothesis profiles not found
)

if exist "backend\requirements.txt" (
    echo [OK] requirements.txt found
) else (
    echo [ERROR] requirements.txt not found
)
echo.

REM Check frontend configuration files
echo Checking frontend configuration...
if exist "frontend\jest.config.js" (
    echo [OK] jest.config.js found
) else (
    echo [ERROR] jest.config.js not found
)

if exist "frontend\jest.setup.js" (
    echo [OK] jest.setup.js found
) else (
    echo [ERROR] jest.setup.js not found
)

if exist "frontend\package.json" (
    echo [OK] package.json found
) else (
    echo [ERROR] package.json not found
)
echo.

REM Check CI/CD configuration
echo Checking CI/CD configuration...
if exist ".github\workflows\ci.yml" (
    echo [OK] GitHub Actions workflow found
) else (
    echo [ERROR] GitHub Actions workflow not found
)

if exist "codecov.yml" (
    echo [OK] Codecov configuration found
) else (
    echo [ERROR] Codecov configuration not found
)
echo.

REM Check documentation
echo Checking documentation...
if exist "TESTING.md" (
    echo [OK] TESTING.md found
) else (
    echo [ERROR] TESTING.md not found
)

if exist "TESTING_QUICK_START.md" (
    echo [OK] TESTING_QUICK_START.md found
) else (
    echo [ERROR] TESTING_QUICK_START.md not found
)
echo.

REM Check example tests
echo Checking example tests...
if exist "backend\tests\property\test_example_property.py" (
    echo [OK] Backend example property test found
) else (
    echo [ERROR] Backend example property test not found
)

if exist "frontend\src\utils\__tests__\example.property.test.ts" (
    echo [OK] Frontend example property test found
) else (
    echo [ERROR] Frontend example property test not found
)
echo.

REM Summary
echo ==========================================
echo Verification Complete
echo ==========================================
echo.
echo Next steps:
echo 1. Install backend dependencies: cd backend ^&^& pip install -r requirements.txt
echo 2. Install frontend dependencies: cd frontend ^&^& npm install
echo 3. Run backend tests: cd backend ^&^& pytest
echo 4. Run frontend tests: cd frontend ^&^& npm test
echo.
echo For more information, see TESTING.md

pause
