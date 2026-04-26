#!/bin/bash
# VoiceNursy Testing Setup Verification Script
# This script verifies that the testing framework is properly configured

set -e

echo "=========================================="
echo "VoiceNursy Testing Setup Verification"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $2"
    else
        echo -e "${RED}✗${NC} $2"
    fi
}

# Function to print warning
print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check Python version
echo "Checking Python environment..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
    print_status 0 "Python installed: $PYTHON_VERSION"
    
    # Check if version is 3.8+
    PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d'.' -f1)
    PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d'.' -f2)
    if [ "$PYTHON_MAJOR" -ge 3 ] && [ "$PYTHON_MINOR" -ge 8 ]; then
        print_status 0 "Python version is 3.8 or higher"
    else
        print_warning "Python version should be 3.8 or higher"
    fi
else
    print_status 1 "Python not found"
fi
echo ""

# Check Node.js version
echo "Checking Node.js environment..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    print_status 0 "Node.js installed: $NODE_VERSION"
    
    # Check if version is 18+
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
        print_status 0 "Node.js version is 18 or higher"
    else
        print_warning "Node.js version should be 18 or higher"
    fi
else
    print_status 1 "Node.js not found"
fi
echo ""

# Check backend configuration files
echo "Checking backend configuration..."
if [ -f "backend/pytest.ini" ]; then
    print_status 0 "pytest.ini found"
else
    print_status 1 "pytest.ini not found"
fi

if [ -f "backend/.hypothesis/profiles.yml" ]; then
    print_status 0 "Hypothesis profiles configured"
else
    print_status 1 "Hypothesis profiles not found"
fi

if [ -f "backend/requirements.txt" ]; then
    print_status 0 "requirements.txt found"
    
    # Check if pytest and hypothesis are in requirements
    if grep -q "pytest" backend/requirements.txt; then
        print_status 0 "pytest in requirements.txt"
    else
        print_status 1 "pytest not in requirements.txt"
    fi
    
    if grep -q "hypothesis" backend/requirements.txt; then
        print_status 0 "hypothesis in requirements.txt"
    else
        print_status 1 "hypothesis not in requirements.txt"
    fi
else
    print_status 1 "requirements.txt not found"
fi
echo ""

# Check frontend configuration files
echo "Checking frontend configuration..."
if [ -f "frontend/jest.config.js" ]; then
    print_status 0 "jest.config.js found"
else
    print_status 1 "jest.config.js not found"
fi

if [ -f "frontend/jest.setup.js" ]; then
    print_status 0 "jest.setup.js found"
else
    print_status 1 "jest.setup.js not found"
fi

if [ -f "frontend/package.json" ]; then
    print_status 0 "package.json found"
    
    # Check if jest and fast-check are in package.json
    if grep -q "jest" frontend/package.json; then
        print_status 0 "jest in package.json"
    else
        print_status 1 "jest not in package.json"
    fi
    
    if grep -q "fast-check" frontend/package.json; then
        print_status 0 "fast-check in package.json"
    else
        print_status 1 "fast-check not in package.json"
    fi
else
    print_status 1 "package.json not found"
fi
echo ""

# Check CI/CD configuration
echo "Checking CI/CD configuration..."
if [ -f ".github/workflows/ci.yml" ]; then
    print_status 0 "GitHub Actions workflow found"
else
    print_status 1 "GitHub Actions workflow not found"
fi

if [ -f "codecov.yml" ]; then
    print_status 0 "Codecov configuration found"
else
    print_status 1 "Codecov configuration not found"
fi
echo ""

# Check documentation
echo "Checking documentation..."
if [ -f "TESTING.md" ]; then
    print_status 0 "TESTING.md found"
else
    print_status 1 "TESTING.md not found"
fi

if [ -f "TESTING_QUICK_START.md" ]; then
    print_status 0 "TESTING_QUICK_START.md found"
else
    print_status 1 "TESTING_QUICK_START.md not found"
fi
echo ""

# Check example tests
echo "Checking example tests..."
if [ -f "backend/tests/property/test_example_property.py" ]; then
    print_status 0 "Backend example property test found"
else
    print_status 1 "Backend example property test not found"
fi

if [ -f "frontend/src/utils/__tests__/example.property.test.ts" ]; then
    print_status 0 "Frontend example property test found"
else
    print_status 1 "Frontend example property test not found"
fi
echo ""

# Summary
echo "=========================================="
echo "Verification Complete"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Install backend dependencies: cd backend && pip install -r requirements.txt"
echo "2. Install frontend dependencies: cd frontend && npm install"
echo "3. Run backend tests: cd backend && pytest"
echo "4. Run frontend tests: cd frontend && npm test"
echo ""
echo "For more information, see TESTING.md"
