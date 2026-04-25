# VoiceNursy Testing Guide

This document provides comprehensive guidance on testing the VoiceNursy intelligent nursing station system.

## Table of Contents

1. [Testing Strategy Overview](#testing-strategy-overview)
2. [Backend Testing (Python)](#backend-testing-python)
3. [Frontend Testing (JavaScript/TypeScript)](#frontend-testing-javascripttypescript)
4. [Property-Based Testing](#property-based-testing)
5. [CI/CD Pipeline](#cicd-pipeline)
6. [Code Coverage](#code-coverage)
7. [Running Tests](#running-tests)

## Testing Strategy Overview

VoiceNursy employs a comprehensive testing strategy:

- **Property-Based Testing (PBT)**: For core business logic with universal properties
- **Unit Testing**: For specific examples, edge cases, and component behavior
- **Integration Testing**: For external service interactions and system integration
- **End-to-End Testing**: For complete user workflows

### Testing Requirements

- **Minimum 100 iterations** per property test
- **80% code coverage** for business logic
- **100% coverage** for critical safety validation code
- All property tests must reference design document properties

## Backend Testing (Python)

### Framework Setup

- **Test Framework**: pytest
- **Property-Based Testing**: Hypothesis
- **Coverage Tool**: pytest-cov
- **Async Testing**: pytest-asyncio

### Configuration Files

- `backend/pytest.ini`: Main pytest configuration
- `backend/.hypothesis/profiles.yml`: Hypothesis profiles for different environments

### Test Structure

```
backend/tests/
├── conftest.py              # Shared fixtures and configuration
├── unit/                    # Unit tests
│   ├── test_audio.py
│   ├── test_text_cleaning.py
│   └── test_soap_conversion.py
├── property/                # Property-based tests
│   ├── test_example_property.py
│   └── test_validation_properties.py
└── integration/             # Integration tests
    ├── test_stt_service.py
    └── test_database.py
```

### Running Backend Tests

```bash
cd backend

# Run all tests
pytest

# Run only unit tests
pytest -m unit

# Run only property tests
pytest -m property_test

# Run only integration tests
pytest -m integration

# Run with coverage report
pytest --cov=app --cov-report=html

# Run with Hypothesis statistics
pytest -m property_test --hypothesis-show-statistics
```

### Hypothesis Profiles

- **default**: 100 iterations, 5s deadline (development)
- **ci**: 200 iterations, 10s deadline (CI/CD)
- **dev**: 50 iterations, 2s deadline (quick testing)
- **debug**: 10 iterations, no deadline (debugging)

Set profile with environment variable:
```bash
export HYPOTHESIS_PROFILE=ci
pytest -m property_test
```

### Writing Property-Based Tests

Example structure:

```python
import pytest
from hypothesis import given, strategies as st, settings

@pytest.mark.property_test
@pytest.mark.tag(
    "Feature: voice-nursy-intelligent-nursing-station, "
    "Property X: Property Name"
)
@given(
    input_data=st.text(min_size=1, max_size=1000)
)
@settings(max_examples=100)
def test_property_name(input_data):
    """
    Property: Description of the property being tested.
    
    Validates: Requirements X.Y
    """
    # Test implementation
    result = function_under_test(input_data)
    assert property_holds(result)
```

## Frontend Testing (JavaScript/TypeScript)

### Framework Setup

- **Test Framework**: Jest (with jest-expo preset)
- **Property-Based Testing**: fast-check
- **Component Testing**: React Testing Library
- **Coverage Tool**: Jest built-in coverage

### Configuration Files

- `frontend/jest.config.js`: Main Jest configuration
- `frontend/jest.setup.js`: Global test setup and mocks
- `frontend/__mocks__/`: Mock implementations

### Test Structure

```
frontend/src/
├── components/
│   └── __tests__/
│       ├── AudioRecorder.test.tsx
│       └── AudioRecorder.property.test.ts
├── services/
│   └── __tests__/
│       ├── api.test.ts
│       └── api.property.test.ts
└── utils/
    └── __tests__/
        ├── example.test.ts
        └── example.property.test.ts
```

### Running Frontend Tests

```bash
cd frontend

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm test -- --coverage

# Run only property tests
npm test -- --testMatch="**/*.property.test.(js|ts|tsx)"

# Run specific test file
npm test -- AudioRecorder.test.tsx
```

### Writing Property-Based Tests

Example structure:

```typescript
import fc from 'fast-check';

describe('Property-Based Tests - Feature Name', () => {
  /**
   * Property X: Property Name
   * 
   * Description of the property being tested.
   * 
   * Validates: Requirements X.Y
   * Tag: Feature: voice-nursy-intelligent-nursing-station, Property X: Property Name
   */
  it('should satisfy property', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 1000 }),
        (input) => {
          // Test implementation
          const result = functionUnderTest(input);
          expect(result).toSatisfyProperty();
        }
      ),
      { numRuns: 100 } // Minimum 100 iterations
    );
  });
});
```

## Property-Based Testing

### What is Property-Based Testing?

Property-based testing verifies that universal properties hold across all valid inputs, rather than testing specific examples. It automatically generates test cases to find edge cases and unexpected behaviors.

### When to Use PBT

✅ **Use PBT for:**
- Pure functions with deterministic behavior
- Data structure validation
- Format checking and parsing
- State machine behavior
- Business logic rules

❌ **Don't use PBT for:**
- UI interactions requiring specific user flows
- External service integrations (use integration tests)
- Time-dependent behavior
- Random or non-deterministic functions

### Property Test Requirements

1. **Minimum 100 iterations** per test (configurable via `max_examples` or `numRuns`)
2. **Tag with design property**: Link to design document property number
3. **Clear documentation**: Describe the property being tested
4. **Reference requirements**: Link to acceptance criteria

### Example Properties from Design

- **Property 6**: Unique Filename Generation
- **Property 7**: JSON Output Structure
- **Property 8**: Punctuation and Filler Removal
- **Property 12**: SOAP Structure Completeness
- **Property 13**: Dosage Range Validation

See `design.md` for complete list of 26 correctness properties.

## CI/CD Pipeline

### Workflow Stages

The CI/CD pipeline runs on every commit and pull request:

1. **Lint**: Code formatting and style checks
   - Backend: Black, Flake8, MyPy
   - Frontend: ESLint, Prettier

2. **Unit Tests**: Fast, isolated tests
   - Run on every commit
   - 80% coverage requirement

3. **Property Tests**: Property-based tests
   - Run on every commit
   - 100+ iterations per test

4. **Integration Tests**: External service tests
   - Run on pull requests only
   - Requires PostgreSQL, Redis, MinIO

5. **Build**: Docker image and application build
   - Verify build succeeds

6. **Coverage Report**: Aggregate coverage from all test types
   - Upload to Codecov
   - Enforce 80% threshold

### GitHub Actions Workflow

Configuration: `.github/workflows/ci.yml`

### Running CI Locally

```bash
# Backend lint
cd backend
black --check app tests
flake8 app tests
mypy app

# Backend tests
pytest -m unit
pytest -m property_test
pytest -m integration

# Frontend lint
cd frontend
npm run lint
npx prettier --check "**/*.{js,jsx,ts,tsx,json,md}"

# Frontend tests
npm test -- --coverage
```

## Code Coverage

### Coverage Requirements

- **Business Logic**: 80% minimum
- **Safety Validation**: 100% required
- **Overall**: 80% minimum

### Coverage Reports

Backend coverage reports are generated in:
- `backend/htmlcov/index.html` (HTML report)
- `backend/coverage.xml` (XML for CI)

Frontend coverage reports are generated in:
- `frontend/coverage/lcov-report/index.html` (HTML report)
- `frontend/coverage/lcov.info` (LCOV for CI)

### Viewing Coverage

```bash
# Backend
cd backend
pytest --cov=app --cov-report=html
open htmlcov/index.html

# Frontend
cd frontend
npm test -- --coverage
open coverage/lcov-report/index.html
```

### Coverage Configuration

Backend coverage settings in `pytest.ini`:
```ini
[coverage:run]
source = app
omit = */tests/*, */migrations/*

[coverage:report]
precision = 2
show_missing = True
```

Frontend coverage settings in `jest.config.js`:
```javascript
coverageThreshold: {
  global: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80
  }
}
```

## Running Tests

### Quick Start

```bash
# Backend
cd backend
pip install -r requirements.txt
pytest

# Frontend
cd frontend
npm install
npm test
```

### Test Markers (Backend)

- `@pytest.mark.unit`: Unit tests
- `@pytest.mark.integration`: Integration tests
- `@pytest.mark.property_test`: Property-based tests
- `@pytest.mark.slow`: Slow-running tests
- `@pytest.mark.asyncio`: Async tests

### Test Naming Conventions

- **Backend**: `test_*.py` or `*_test.py`
- **Frontend**: `*.test.(js|ts|tsx)` or `*.spec.(js|ts|tsx)`
- **Property tests**: `*.property.test.(js|ts|tsx)` (frontend)

### Debugging Tests

```bash
# Backend - verbose output
pytest -vv

# Backend - stop on first failure
pytest -x

# Backend - run specific test
pytest tests/unit/test_audio.py::test_specific_function

# Frontend - debug mode
npm test -- --no-coverage --verbose

# Frontend - run specific test
npm test -- AudioRecorder.test.tsx
```

## Best Practices

### General

1. **Write tests first** for critical functionality
2. **Keep tests isolated** - no shared state between tests
3. **Use descriptive names** - test names should explain what is being tested
4. **Document properties** - clearly state what property is being verified
5. **Clean up resources** - use fixtures and teardown methods

### Property-Based Testing

1. **Start simple** - begin with basic properties
2. **Use smart generators** - constrain input space intelligently
3. **Shrink effectively** - Hypothesis/fast-check will find minimal failing examples
4. **Document assumptions** - state preconditions clearly
5. **Link to design** - always reference design document properties

### Coverage

1. **Focus on business logic** - prioritize critical code paths
2. **Don't chase 100%** - some code doesn't need tests (e.g., simple getters)
3. **Test error paths** - ensure error handling is covered
4. **Review coverage reports** - identify untested code regularly

## Troubleshooting

### Common Issues

**Hypothesis finds too many failures:**
- Narrow input space with constraints
- Add preconditions with `assume()`
- Check if property is too strict

**Tests are slow:**
- Reduce `max_examples` for development
- Use `@pytest.mark.slow` for slow tests
- Run fast tests first, slow tests in CI

**Coverage not meeting threshold:**
- Identify uncovered code with HTML report
- Add tests for critical paths first
- Consider if some code needs testing

**Integration tests failing:**
- Check service dependencies (PostgreSQL, Redis)
- Verify environment variables
- Check network connectivity

## Resources

- [Hypothesis Documentation](https://hypothesis.readthedocs.io/)
- [fast-check Documentation](https://fast-check.dev/)
- [pytest Documentation](https://docs.pytest.org/)
- [Jest Documentation](https://jestjs.io/)
- [React Testing Library](https://testing-library.com/react)

## Support

For questions or issues with testing:
1. Check this documentation
2. Review example tests in `tests/` directories
3. Consult design document for property definitions
4. Contact the development team
