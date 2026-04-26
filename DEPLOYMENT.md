# VoiceNursy Deployment Guide

This guide provides comprehensive instructions for deploying the VoiceNursy intelligent nursing station system in various environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Configuration](#environment-configuration)
3. [Local Development Deployment](#local-development-deployment)
4. [Docker Compose Deployment](#docker-compose-deployment)
5. [Kubernetes Deployment](#kubernetes-deployment)
6. [Production Deployment Checklist](#production-deployment-checklist)
7. [Monitoring and Maintenance](#monitoring-and-maintenance)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

**Development Environment:**
- Docker 20.10+
- Docker Compose 2.0+
- Python 3.11+
- Node.js 18+
- 8GB RAM minimum
- 20GB free disk space

**Production Environment:**
- Kubernetes 1.24+
- kubectl configured
- Helm 3.0+ (optional)
- PostgreSQL 14+
- Redis 7+
- S3-compatible storage
- 16GB RAM minimum per node
- 100GB free disk space

### Required Services

1. **OpenAI API Key** - For Whisper STT and GPT-4 SOAP conversion
2. **AWS S3 or MinIO** - For audio file storage
3. **PostgreSQL Database** - For structured data
4. **Redis Cache** - For caching and message queuing
5. **SSL/TLS Certificates** - For HTTPS in production

## Environment Configuration

### 1. Backend Environment Variables

Copy the example environment file and configure:

```bash
# Development
cp backend/.env.example backend/.env

# Production
cp backend/.env.production.example backend/.env.production
```

**Critical Variables to Configure:**

```bash
# Database
DATABASE_PASSWORD=<strong-password>

# Redis
REDIS_PASSWORD=<strong-password>

# OpenAI
OPENAI_API_KEY=<your-api-key>

# JWT Secret (generate with: openssl rand -hex 32)
JWT_SECRET_KEY=<random-64-char-string>

# Encryption Key (generate with: python -c "import secrets; print(secrets.token_urlsafe(32))")
ENCRYPTION_KEY=<secure-32-byte-key>

# Storage
STORAGE_ACCESS_KEY=<aws-access-key>
STORAGE_SECRET_KEY=<aws-secret-key>
```

### 2. Frontend Environment Variables

```bash
cp frontend/.env.example frontend/.env
```

Configure the API endpoint:

```bash
API_BASE_URL=http://localhost:8000/api/v1  # Development
# API_BASE_URL=https://api.voicenursy.example.com/api/v1  # Production
```

## Local Development Deployment

### Quick Start

1. **Install Dependencies**

```bash
# Backend
cd backend
pip install -r requirements.txt

# Frontend
cd frontend
npm install
```

2. **Start Infrastructure Services**

```bash
docker-compose up -d postgres redis minio
```

3. **Run Database Migrations**

```bash
cd backend
alembic upgrade head
```

4. **Start Backend Server**

```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

5. **Start Frontend**

```bash
cd frontend
npm start
```

Access the application:
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/docs
- Frontend: http://localhost:19006

## Docker Compose Deployment

### Development Environment

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

### Production Environment

```bash
# Build production images
docker-compose -f docker-compose.prod.yml build

# Start production services
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f backend

# Stop services
docker-compose -f docker-compose.prod.yml down
```

### Service Health Checks

```bash
# Check service status
docker-compose ps

# Check backend health
curl http://localhost:8000/health

# Check database connection
docker-compose exec postgres pg_isready -U postgres

# Check Redis connection
docker-compose exec redis redis-cli ping
```

## Kubernetes Deployment

### Prerequisites

1. **Configure kubectl**

```bash
kubectl config use-context <your-cluster>
```

2. **Create Namespace**

```bash
kubectl apply -f k8s/namespace.yaml
```

3. **Configure Secrets**

Edit `k8s/secrets.yaml` with your actual credentials:

```bash
# Generate base64 encoded values
echo -n "your-password" | base64

# Apply secrets
kubectl apply -f k8s/secrets.yaml
```

4. **Configure ConfigMap**

```bash
kubectl apply -f k8s/configmap.yaml
```

### Deploy Services

```bash
# Deploy PostgreSQL
kubectl apply -f k8s/postgres-deployment.yaml

# Deploy Redis
kubectl apply -f k8s/redis-deployment.yaml

# Wait for databases to be ready
kubectl wait --for=condition=ready pod -l app=postgres -n voicenursy --timeout=300s
kubectl wait --for=condition=ready pod -l app=redis -n voicenursy --timeout=300s

# Deploy Backend
kubectl apply -f k8s/backend-deployment.yaml

# Deploy Ingress
kubectl apply -f k8s/ingress.yaml
```

### Verify Deployment

```bash
# Check all pods
kubectl get pods -n voicenursy

# Check services
kubectl get svc -n voicenursy

# Check ingress
kubectl get ingress -n voicenursy

# View backend logs
kubectl logs -f deployment/voicenursy-backend -n voicenursy

# Check pod health
kubectl describe pod <pod-name> -n voicenursy
```

### Scale Deployment

```bash
# Manual scaling
kubectl scale deployment voicenursy-backend --replicas=5 -n voicenursy

# Check HPA status
kubectl get hpa -n voicenursy

# View HPA details
kubectl describe hpa voicenursy-backend-hpa -n voicenursy
```

## Production Deployment Checklist

### Security

- [ ] Change all default passwords
- [ ] Generate secure JWT secret key
- [ ] Generate secure encryption key
- [ ] Configure TLS/SSL certificates
- [ ] Enable HTTPS only
- [ ] Configure firewall rules
- [ ] Set up VPC/network isolation
- [ ] Enable database encryption at rest
- [ ] Configure Redis password authentication
- [ ] Review and restrict CORS origins
- [ ] Enable rate limiting
- [ ] Set up WAF (Web Application Firewall)

### Configuration

- [ ] Set `DEBUG=False`
- [ ] Configure production database
- [ ] Set up S3 bucket with proper permissions
- [ ] Configure backup strategy
- [ ] Set appropriate resource limits
- [ ] Configure log retention policies
- [ ] Set up monitoring and alerting
- [ ] Configure auto-scaling policies
- [ ] Set up CDN for static assets
- [ ] Configure session timeout

### Database

- [ ] Run database migrations
- [ ] Set up database backups
- [ ] Configure connection pooling
- [ ] Enable SSL for database connections
- [ ] Set up read replicas (if needed)
- [ ] Configure database monitoring

### Monitoring

- [ ] Set up application monitoring (e.g., Sentry)
- [ ] Configure log aggregation (e.g., ELK stack)
- [ ] Set up metrics collection (e.g., Prometheus)
- [ ] Configure alerting rules
- [ ] Set up uptime monitoring
- [ ] Configure performance monitoring

### Testing

- [ ] Run all unit tests
- [ ] Run integration tests
- [ ] Run property-based tests
- [ ] Perform load testing
- [ ] Conduct security testing
- [ ] Test backup and restore procedures
- [ ] Test failover scenarios

### Documentation

- [ ] Update API documentation
- [ ] Document deployment procedures
- [ ] Create runbooks for common issues
- [ ] Document backup/restore procedures
- [ ] Create incident response plan

## Monitoring and Maintenance

### Health Checks

```bash
# Backend health
curl https://api.voicenursy.example.com/health

# Database health
kubectl exec -it <postgres-pod> -n voicenursy -- pg_isready

# Redis health
kubectl exec -it <redis-pod> -n voicenursy -- redis-cli ping
```

### Log Management

```bash
# View backend logs
kubectl logs -f deployment/voicenursy-backend -n voicenursy

# View logs from all replicas
kubectl logs -f deployment/voicenursy-backend -n voicenursy --all-containers=true

# View logs from specific time
kubectl logs --since=1h deployment/voicenursy-backend -n voicenursy
```

### Database Backup

```bash
# Manual backup
kubectl exec -it <postgres-pod> -n voicenursy -- \
  pg_dump -U voicenursy_user voicenursy > backup_$(date +%Y%m%d).sql

# Restore from backup
kubectl exec -i <postgres-pod> -n voicenursy -- \
  psql -U voicenursy_user voicenursy < backup_20240115.sql
```

### Update Deployment

```bash
# Update backend image
kubectl set image deployment/voicenursy-backend \
  backend=voicenursy/backend:v1.1.0 -n voicenursy

# Check rollout status
kubectl rollout status deployment/voicenursy-backend -n voicenursy

# Rollback if needed
kubectl rollout undo deployment/voicenursy-backend -n voicenursy
```

## Troubleshooting

### Common Issues

**1. Backend Pod Not Starting**

```bash
# Check pod status
kubectl describe pod <pod-name> -n voicenursy

# Check logs
kubectl logs <pod-name> -n voicenursy

# Common causes:
# - Missing environment variables
# - Database connection failure
# - Insufficient resources
```

**2. Database Connection Errors**

```bash
# Test database connectivity
kubectl exec -it <backend-pod> -n voicenursy -- \
  python -c "from app.core.database import engine; engine.connect()"

# Check database service
kubectl get svc postgres-service -n voicenursy

# Verify credentials
kubectl get secret voicenursy-secrets -n voicenursy -o yaml
```

**3. High Memory Usage**

```bash
# Check resource usage
kubectl top pods -n voicenursy

# Increase memory limits
kubectl set resources deployment voicenursy-backend \
  --limits=memory=8Gi -n voicenursy
```

**4. SSL/TLS Certificate Issues**

```bash
# Check certificate
kubectl describe secret voicenursy-tls -n voicenursy

# Verify certificate expiration
openssl x509 -in certificate.crt -noout -dates

# Renew certificate (if using cert-manager)
kubectl delete secret voicenursy-tls -n voicenursy
```

### Performance Optimization

**1. Database Query Optimization**

```sql
-- Check slow queries
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- Add indexes for frequently queried columns
CREATE INDEX idx_soap_records_patient_id ON soap_records(patient_id);
CREATE INDEX idx_audio_files_uploaded_at ON audio_files(uploaded_at);
```

**2. Redis Cache Optimization**

```bash
# Check cache hit rate
kubectl exec -it <redis-pod> -n voicenursy -- \
  redis-cli INFO stats | grep keyspace

# Clear cache if needed
kubectl exec -it <redis-pod> -n voicenursy -- \
  redis-cli FLUSHDB
```

**3. Application Performance**

```bash
# Enable profiling
export ENABLE_PROFILING=true

# Monitor API response times
kubectl logs -f deployment/voicenursy-backend -n voicenursy | \
  grep "response_time"
```

## Support

For additional support:
- Documentation: https://docs.voicenursy.example.com
- Issues: https://github.com/voicenursy/voicenursy/issues
- Email: support@voicenursy.example.com
