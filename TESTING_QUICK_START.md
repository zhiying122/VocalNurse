# Testing Quick Start Guide

Quick reference for running tests in VoiceNursy.

## Prerequisites

### Backend
```bash
cd backend
pip install -r requirements.txt
```

### Frontend
```bash
cd frontend
npm install
```

## Running Tests

### Backend

```bash
cd backend

# Run all tests
pytest

# Run specific test types
pytest -m unit              # Unit tests only
pytest -m property_test     # Property-based tests only
pytest -m integration       # Integration tests only

# Run with coverage
pytest --cov=app --cov-report=html

# View coverage report
open htmlcov/index.html
```

### Frontend

```bash
cd frontend

# Run all tests
npm test

# Run in watch mode
npm run test:watch

# Run with coverage
npm test -- --coverage

# Run only property tests
npm test -- --testMatch="**/*.property.test.(js|ts|tsx)"

# View coverage report
open coverage/lcov-report/index.html
```

## Writing Tests

### Backend Property Test Template

```python
import pytest
from hypothesis import given, strategies as st, settings

@pytest.mark.property_test
@pytest.mark.tag("Feature: voice-nursy-intelligent-nursing-station, Property X: Name")
@given(input_data=st.text(min_size=1))
@settings(max_examples=100)
def test_property_name(input_data):
    """
    Property: Description
    Validates: Requirements X.Y
    """
    result = function_under_test(input_data)
    assert expected_property(result)
```

### Frontend Property Test Template

```typescript
import fc from 'fast-check';

describe('Feature Tests', () => {
  it('should satisfy property', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        (input) => {
          const result = functionUnderTest(input);
          expect(result).toSatisfyProperty();
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

## Common Commands

### Lint and Format

```bash
# Backend
cd backend
black app tests              # Format code
flake8 app tests            # Lint code
mypy app                    # Type check

# Frontend
cd frontend
npm run lint                # Lint code
npm run format              # Format code
```

### CI/CD Locally

```bash
# Run the same checks as CI
cd backend
black --check app tests
flake8 app tests --max-line-length=100
mypy app --ignore-missing-imports
pytest -m unit
pytest -m property_test

cd ../frontend
npm run lint
npx prettier --check "**/*.{js,jsx,ts,tsx,json,md}"
npm test -- --coverage
```

## Coverage Requirements

- **Overall**: 80% minimum
- **Safety Validation**: 100% required
- **Property Tests**: 100+ iterations

## Test Markers (Backend)

- `@pytest.mark.unit` - Unit tests
- `@pytest.mark.integration` - Integration tests
- `@pytest.mark.property_test` - Property-based tests
- `@pytest.mark.slow` - Slow tests
- `@pytest.mark.asyncio` - Async tests

## Debugging

```bash
# Backend - verbose output
pytest -vv

# Backend - stop on first failure
pytest -x

# Backend - run specific test
pytest tests/unit/test_file.py::test_function

# Frontend - debug mode
npm test -- --no-coverage --verbose

# Frontend - run specific test
npm test -- ComponentName.test.tsx
```

## Resources

- Full documentation: [TESTING.md](./TESTING.md)
- CI/CD setup: [.github/README.md](./.github/README.md)
- Design properties: [.kiro/specs/voice-nursy-intelligent-nursing-station/design.md](./.kiro/specs/voice-nursy-intelligent-nursing-station/design.md)
