# Environment Variables Reference

This document provides a comprehensive reference for all environment variables used in the VoiceNursy system.

## Table of Contents

1. [Backend Environment Variables](#backend-environment-variables)
2. [Frontend Environment Variables](#frontend-environment-variables)
3. [Docker Compose Variables](#docker-compose-variables)
4. [Kubernetes ConfigMap/Secrets](#kubernetes-configmapsecrets)
5. [Security Best Practices](#security-best-practices)

## Backend Environment Variables

### Application Settings

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `APP_NAME` | string | `VoiceNursy` | Application name | No |
| `APP_VERSION` | string | `1.0.0` | Application version | No |
| `DEBUG` | boolean | `False` | Enable debug mode (set to False in production) | No |
| `LOG_LEVEL` | string | `INFO` | Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL) | No |
| `ENVIRONMENT` | string | `development` | Environment name (development, staging, production) | No |

### Server Configuration

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `HOST` | string | `0.0.0.0` | Server host address | No |
| `PORT` | integer | `8000` | Server port | No |
| `WORKERS` | integer | `4` | Number of worker processes (production) | No |

### Database Configuration (PostgreSQL)

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `DATABASE_HOST` | string | `localhost` | PostgreSQL host | Yes |
| `DATABASE_PORT` | integer | `5432` | PostgreSQL port | No |
| `DATABASE_NAME` | string | `voicenursy` | Database name | Yes |
| `DATABASE_USER` | string | `postgres` | Database user | Yes |
| `DATABASE_PASSWORD` | string | - | Database password | Yes |
| `DATABASE_POOL_SIZE` | integer | `10` | Connection pool size | No |
| `DATABASE_MAX_OVERFLOW` | integer | `20` | Max overflow connections | No |
| `DATABASE_SSL_MODE` | string | `prefer` | SSL mode (disable, allow, prefer, require) | No |

**Example:**
```bash
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_NAME=voicenursy_prod
DATABASE_USER=voicenursy_user
DATABASE_PASSWORD=secure_password_here
DATABASE_POOL_SIZE=20
DATABASE_MAX_OVERFLOW=40
DATABASE_SSL_MODE=require
```

### Redis Configuration

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `REDIS_HOST` | string | `localhost` | Redis host | Yes |
| `REDIS_PORT` | integer | `6379` | Redis port | No |
| `REDIS_PASSWORD` | string | - | Redis password | No |
| `REDIS_DB` | integer | `0` | Redis database number | No |
| `REDIS_MAX_CONNECTIONS` | integer | `50` | Max connections | No |
| `REDIS_SSL` | boolean | `False` | Enable SSL | No |

**Example:**
```bash
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=redis_password_here
REDIS_DB=0
REDIS_MAX_CONNECTIONS=100
REDIS_SSL=True
```

### Storage Configuration (S3/MinIO)

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `STORAGE_TYPE` | string | `minio` | Storage type (s3, minio) | Yes |
| `STORAGE_ENDPOINT` | string | - | Storage endpoint URL | Yes |
| `STORAGE_ACCESS_KEY` | string | - | Access key | Yes |
| `STORAGE_SECRET_KEY` | string | - | Secret key | Yes |
| `STORAGE_BUCKET_NAME` | string | `voicenursy-audio` | Bucket name | Yes |
| `STORAGE_REGION` | string | `us-east-1` | AWS region | No |
| `STORAGE_USE_SSL` | boolean | `True` | Use SSL | No |

**Example (AWS S3):**
```bash
STORAGE_TYPE=s3
STORAGE_ENDPOINT=s3.amazonaws.com
STORAGE_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
STORAGE_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
STORAGE_BUCKET_NAME=voicenursy-audio-prod
STORAGE_REGION=us-east-1
STORAGE_USE_SSL=True
```

**Example (MinIO):**
```bash
STORAGE_TYPE=minio
STORAGE_ENDPOINT=minio:9000
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_BUCKET_NAME=voicenursy-audio
STORAGE_REGION=us-east-1
STORAGE_USE_SSL=False
```

### OpenAI Configuration

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `OPENAI_API_KEY` | string | - | OpenAI API key | Yes |
| `OPENAI_MODEL` | string | `gpt-4` | GPT model for SOAP conversion | No |
| `OPENAI_MAX_RETRIES` | integer | `3` | Max retry attempts | No |
| `OPENAI_TIMEOUT` | integer | `30` | Request timeout (seconds) | No |
| `WHISPER_MODEL` | string | `whisper-large-v3` | Whisper model for STT | No |

**Example:**
```bash
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4
OPENAI_MAX_RETRIES=3
OPENAI_TIMEOUT=30
WHISPER_MODEL=whisper-large-v3
```

### Faster-Whisper Configuration (Offline Mode)

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `FASTER_WHISPER_MODEL` | string | `large-v3` | Model size | No |
| `FASTER_WHISPER_DEVICE` | string | `cpu` | Device (cpu, cuda) | No |
| `FASTER_WHISPER_COMPUTE_TYPE` | string | `int8` | Compute type (int8, float16, float32) | No |

**Example:**
```bash
FASTER_WHISPER_MODEL=large-v3
FASTER_WHISPER_DEVICE=cuda
FASTER_WHISPER_COMPUTE_TYPE=float16
```

### Authentication & Security

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `JWT_SECRET_KEY` | string | - | JWT signing key (64+ chars) | Yes |
| `JWT_ALGORITHM` | string | `HS256` | JWT algorithm | No |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | integer | `60` | Access token expiry | No |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | integer | `7` | Refresh token expiry | No |
| `PASSWORD_HASH_ALGORITHM` | string | `bcrypt` | Password hashing algorithm | No |
| `PASSWORD_MIN_LENGTH` | integer | `8` | Minimum password length | No |

**Generate JWT Secret:**
```bash
openssl rand -hex 32
```

**Example:**
```bash
JWT_SECRET_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7
PASSWORD_HASH_ALGORITHM=bcrypt
PASSWORD_MIN_LENGTH=12
```

### Encryption (AES-256)

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `ENCRYPTION_KEY` | string | - | AES-256 encryption key (32 bytes) | Yes |

**Generate Encryption Key:**
```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

**Example:**
```bash
ENCRYPTION_KEY=xK8vN2pQ9mL5wR7tY3uI6oP1aS4dF8gH2jK5lZ9xC3vB6nM0
```

### TLS Configuration

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `TLS_ENABLED` | boolean | `False` | Enable TLS/HTTPS | No |
| `TLS_CERT_FILE` | string | - | Path to certificate file | No |
| `TLS_KEY_FILE` | string | - | Path to private key file | No |
| `TLS_MIN_VERSION` | string | `TLSv1_3` | Minimum TLS version | No |

**Example:**
```bash
TLS_ENABLED=True
TLS_CERT_FILE=/etc/ssl/certs/voicenursy.crt
TLS_KEY_FILE=/etc/ssl/private/voicenursy.key
TLS_MIN_VERSION=TLSv1_3
```

### API Rate Limiting

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `RATE_LIMIT_PER_MINUTE` | integer | `60` | Requests per minute | No |
| `RATE_LIMIT_PER_HOUR` | integer | `1000` | Requests per hour | No |
| `RATE_LIMIT_BURST` | integer | `10` | Burst allowance | No |

### Audio Processing

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `MAX_AUDIO_FILE_SIZE_MB` | integer | `50` | Max file size in MB | No |
| `AUDIO_FORMAT` | string | `wav` | Audio format | No |
| `AUDIO_SAMPLE_RATE` | integer | `16000` | Sample rate (Hz) | No |
| `AUDIO_CHANNELS` | integer | `1` | Number of channels | No |
| `SILENCE_THRESHOLD_DB` | integer | `-40` | Silence threshold (dB) | No |
| `MIN_SILENCE_DURATION_MS` | integer | `500` | Min silence duration (ms) | No |

### STT Configuration

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `STT_TIMEOUT_SECONDS` | integer | `30` | STT request timeout | No |
| `STT_MAX_RETRIES` | integer | `3` | Max retry attempts | No |
| `STT_LANGUAGE` | string | `zh-TW` | Language code | No |
| `STT_MODE` | string | `auto` | Mode (cloud, local, auto) | No |

### SOAP Conversion

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `SOAP_CONVERSION_TIMEOUT_SECONDS` | integer | `15` | Conversion timeout | No |
| `SOAP_MAX_RETRIES` | integer | `3` | Max retry attempts | No |

### Safety Validation

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `VALIDATION_TIMEOUT_SECONDS` | integer | `5` | Validation timeout | No |
| `CRITICAL_ERROR_DOSAGE_MULTIPLIER` | integer | `10` | Critical error threshold | No |

### Session Management

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `SESSION_TIMEOUT_MINUTES` | integer | `15` | Session timeout | No |
| `MAX_CONCURRENT_SESSIONS` | integer | `10` | Max concurrent sessions | No |

### Logging

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `LOG_FILE_PATH` | string | `logs/voicenursy.log` | Log file path | No |
| `LOG_RETENTION_DAYS` | integer | `30` | Log retention period | No |
| `ERROR_LOG_RETENTION_DAYS` | integer | `90` | Error log retention | No |
| `LOG_FORMAT` | string | `text` | Log format (text, json) | No |
| `LOG_TO_STDOUT` | boolean | `True` | Log to stdout | No |

### Monitoring & Metrics

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `ENABLE_METRICS` | boolean | `False` | Enable metrics | No |
| `METRICS_PORT` | integer | `9090` | Metrics port | No |
| `SENTRY_DSN` | string | - | Sentry DSN for error tracking | No |

### CORS Configuration

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `CORS_ORIGINS` | string | `*` | Allowed origins (comma-separated) | No |
| `CORS_ALLOW_CREDENTIALS` | boolean | `True` | Allow credentials | No |
| `CORS_ALLOW_METHODS` | string | `*` | Allowed methods | No |
| `CORS_ALLOW_HEADERS` | string | `*` | Allowed headers | No |

**Example (Production):**
```bash
CORS_ORIGINS=https://voicenursy.example.com,https://app.voicenursy.example.com
CORS_ALLOW_CREDENTIALS=True
CORS_ALLOW_METHODS=GET,POST,PUT,DELETE
CORS_ALLOW_HEADERS=*
```

## Frontend Environment Variables

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `API_BASE_URL` | string | - | Backend API URL | Yes |
| `API_TIMEOUT` | integer | `30000` | API timeout (ms) | No |
| `AUTH_TOKEN_KEY` | string | `voicenursy_auth_token` | Token storage key | No |
| `REFRESH_TOKEN_KEY` | string | `voicenursy_refresh_token` | Refresh token key | No |
| `MAX_RECORDING_DURATION_SECONDS` | integer | `300` | Max recording duration | No |
| `AUDIO_QUALITY` | string | `high` | Audio quality | No |
| `SESSION_TIMEOUT_MINUTES` | integer | `15` | Session timeout | No |
| `THEME` | string | `light` | Default theme | No |
| `ENABLE_DARK_MODE` | boolean | `true` | Enable dark mode | No |
| `DEFAULT_LANGUAGE` | string | `zh-TW` | Default language | No |

**Example:**
```bash
API_BASE_URL=https://api.voicenursy.example.com/api/v1
API_TIMEOUT=30000
SESSION_TIMEOUT_MINUTES=15
ENABLE_DARK_MODE=true
DEFAULT_LANGUAGE=zh-TW
```

## Docker Compose Variables

Create a `.env` file in the project root for Docker Compose:

```bash
# Database
DATABASE_USER=postgres
DATABASE_PASSWORD=secure_password
DATABASE_NAME=voicenursy

# Redis
REDIS_PASSWORD=redis_password

# Storage
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin

# Backend
BACKEND_PORT=8000

# MinIO
STORAGE_PORT=9000
MINIO_CONSOLE_PORT=9001
MINIO_CONSOLE_URL=http://localhost:9001
```

## Kubernetes ConfigMap/Secrets

### ConfigMap (Non-sensitive)

All non-sensitive configuration goes in `k8s/configmap.yaml`.

### Secrets (Sensitive)

All sensitive data goes in `k8s/secrets.yaml`:

- Database credentials
- Redis password
- OpenAI API key
- JWT secret
- Encryption key
- Storage credentials

**Generate base64 values:**
```bash
echo -n "your-password" | base64
```

## Security Best Practices

### 1. Never Commit Secrets

- Add `.env` files to `.gitignore`
- Use `.env.example` as templates
- Store production secrets in secure vaults

### 2. Use Strong Passwords

```bash
# Generate strong password
openssl rand -base64 32

# Generate JWT secret (64 chars)
openssl rand -hex 32

# Generate encryption key
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 3. Rotate Secrets Regularly

- Rotate passwords every 90 days
- Rotate API keys every 180 days
- Update JWT secrets on security incidents

### 4. Environment-Specific Configuration

- Development: Use `.env`
- Staging: Use `.env.staging`
- Production: Use `.env.production`

### 5. Validate Configuration

```bash
# Check required variables
python -c "from app.core.config import settings; print(settings)"

# Test database connection
python -c "from app.core.database import engine; engine.connect()"
```

### 6. Use Secret Management Tools

**Production Recommendations:**
- AWS Secrets Manager
- HashiCorp Vault
- Azure Key Vault
- Google Secret Manager

### 7. Principle of Least Privilege

- Grant minimum necessary permissions
- Use separate credentials for each environment
- Restrict database user permissions

## Troubleshooting

### Missing Required Variables

```bash
# Check which variables are missing
python -c "from app.core.config import settings"
```

### Invalid Configuration

```bash
# Validate configuration
python backend/app/core/config.py
```

### Connection Issues

```bash
# Test database
psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME

# Test Redis
redis-cli -h $REDIS_HOST -p $REDIS_PORT ping

# Test S3/MinIO
aws s3 ls s3://$STORAGE_BUCKET_NAME --endpoint-url http://$STORAGE_ENDPOINT
```

## References

- [Backend .env.example](backend/.env.example)
- [Backend .env.production.example](backend/.env.production.example)
- [Frontend .env.example](frontend/.env.example)
- [Docker Compose Configuration](docker-compose.yml)
- [Kubernetes ConfigMap](k8s/configmap.yaml)
- [Kubernetes Secrets](k8s/secrets.yaml)
