#!/bin/bash

# VoiceNursy Deployment Script
# This script automates the deployment process for different environments

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    print_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    print_info "Prerequisites check passed."
}

check_env_file() {
    local env_file=$1
    if [ ! -f "$env_file" ]; then
        print_error "Environment file $env_file not found."
        print_info "Please copy from .env.example and configure it."
        exit 1
    fi
}

deploy_local() {
    print_info "Deploying to local development environment..."
    
    check_env_file "backend/.env"
    check_env_file "frontend/.env"
    
    # Start infrastructure services
    print_info "Starting infrastructure services..."
    docker-compose up -d postgres redis minio
    
    # Wait for services to be ready
    print_info "Waiting for services to be ready..."
    sleep 10
    
    # Check service health
    docker-compose ps
    
    print_info "Local infrastructure deployed successfully!"
    print_info "Backend API will be available at: http://localhost:8000"
    print_info "API Documentation: http://localhost:8000/docs"
    print_info ""
    print_info "To start the backend:"
    print_info "  cd backend && uvicorn app.main:app --reload"
    print_info ""
    print_info "To start the frontend:"
    print_info "  cd frontend && npm start"
}

deploy_docker() {
    print_info "Deploying with Docker Compose..."
    
    check_env_file "backend/.env"
    check_env_file "frontend/.env"
    
    # Build and start all services
    print_info "Building and starting all services..."
    docker-compose up -d --build
    
    # Wait for services to be ready
    print_info "Waiting for services to be ready..."
    sleep 20
    
    # Check service health
    print_info "Checking service health..."
    docker-compose ps
    
    # Test backend health
    print_info "Testing backend health..."
    max_retries=30
    retry_count=0
    while [ $retry_count -lt $max_retries ]; do
        if curl -f http://localhost:8000/health &> /dev/null; then
            print_info "Backend is healthy!"
            break
        fi
        retry_count=$((retry_count + 1))
        echo -n "."
        sleep 2
    done
    
    if [ $retry_count -eq $max_retries ]; then
        print_error "Backend health check failed after $max_retries attempts."
        print_info "Check logs with: docker-compose logs backend"
        exit 1
    fi
    
    print_info "Deployment completed successfully!"
    print_info "Backend API: http://localhost:8000"
    print_info "API Documentation: http://localhost:8000/docs"
    print_info "Frontend: http://localhost:19006"
    print_info ""
    print_info "View logs with: docker-compose logs -f"
}

deploy_production() {
    print_info "Deploying to production environment..."
    
    check_env_file "backend/.env.production"
    
    # Confirm production deployment
    print_warning "You are about to deploy to PRODUCTION environment."
    read -p "Are you sure you want to continue? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        print_info "Deployment cancelled."
        exit 0
    fi
    
    # Build production images
    print_info "Building production images..."
    docker-compose -f docker-compose.prod.yml build
    
    # Start production services
    print_info "Starting production services..."
    docker-compose -f docker-compose.prod.yml up -d
    
    # Wait for services to be ready
    print_info "Waiting for services to be ready..."
    sleep 30
    
    # Check service health
    print_info "Checking service health..."
    docker-compose -f docker-compose.prod.yml ps
    
    print_info "Production deployment completed!"
    print_info "Monitor logs with: docker-compose -f docker-compose.prod.yml logs -f"
}

deploy_kubernetes() {
    print_info "Deploying to Kubernetes..."
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        print_error "kubectl is not installed. Please install kubectl first."
        exit 1
    fi
    
    # Check cluster connection
    if ! kubectl cluster-info &> /dev/null; then
        print_error "Cannot connect to Kubernetes cluster. Please configure kubectl."
        exit 1
    fi
    
    # Confirm Kubernetes deployment
    print_warning "You are about to deploy to Kubernetes cluster."
    kubectl config current-context
    read -p "Is this the correct cluster? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        print_info "Deployment cancelled."
        exit 0
    fi
    
    # Create namespace
    print_info "Creating namespace..."
    kubectl apply -f k8s/namespace.yaml
    
    # Apply secrets
    print_warning "Make sure you have configured k8s/secrets.yaml with actual credentials!"
    read -p "Have you configured secrets? (yes/no): " secrets_confirm
    if [ "$secrets_confirm" != "yes" ]; then
        print_error "Please configure k8s/secrets.yaml first."
        exit 1
    fi
    kubectl apply -f k8s/secrets.yaml
    
    # Apply configmap
    print_info "Applying ConfigMap..."
    kubectl apply -f k8s/configmap.yaml
    
    # Deploy PostgreSQL
    print_info "Deploying PostgreSQL..."
    kubectl apply -f k8s/postgres-deployment.yaml
    
    # Deploy Redis
    print_info "Deploying Redis..."
    kubectl apply -f k8s/redis-deployment.yaml
    
    # Wait for databases
    print_info "Waiting for databases to be ready..."
    kubectl wait --for=condition=ready pod -l app=postgres -n voicenursy --timeout=300s
    kubectl wait --for=condition=ready pod -l app=redis -n voicenursy --timeout=300s
    
    # Deploy backend
    print_info "Deploying backend..."
    kubectl apply -f k8s/backend-deployment.yaml
    
    # Wait for backend
    print_info "Waiting for backend to be ready..."
    kubectl wait --for=condition=ready pod -l app=voicenursy-backend -n voicenursy --timeout=300s
    
    # Deploy ingress
    print_info "Deploying ingress..."
    kubectl apply -f k8s/ingress.yaml
    
    # Show deployment status
    print_info "Deployment status:"
    kubectl get pods -n voicenursy
    kubectl get svc -n voicenursy
    kubectl get ingress -n voicenursy
    
    print_info "Kubernetes deployment completed!"
    print_info "Monitor with: kubectl get pods -n voicenursy -w"
}

stop_services() {
    print_info "Stopping services..."
    
    if [ -f "docker-compose.yml" ]; then
        docker-compose down
        print_info "Development services stopped."
    fi
    
    if [ -f "docker-compose.prod.yml" ]; then
        docker-compose -f docker-compose.prod.yml down
        print_info "Production services stopped."
    fi
}

show_logs() {
    local service=$1
    if [ -z "$service" ]; then
        docker-compose logs -f
    else
        docker-compose logs -f "$service"
    fi
}

show_usage() {
    echo "VoiceNursy Deployment Script"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  local       - Deploy local development environment (infrastructure only)"
    echo "  docker      - Deploy with Docker Compose (all services)"
    echo "  production  - Deploy production environment with Docker Compose"
    echo "  kubernetes  - Deploy to Kubernetes cluster"
    echo "  stop        - Stop all running services"
    echo "  logs [svc]  - Show logs (optionally for specific service)"
    echo "  help        - Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 local              # Deploy local infrastructure"
    echo "  $0 docker             # Deploy all services with Docker"
    echo "  $0 kubernetes         # Deploy to Kubernetes"
    echo "  $0 logs backend       # Show backend logs"
    echo "  $0 stop               # Stop all services"
}

# Main script
case "$1" in
    local)
        check_prerequisites
        deploy_local
        ;;
    docker)
        check_prerequisites
        deploy_docker
        ;;
    production)
        check_prerequisites
        deploy_production
        ;;
    kubernetes|k8s)
        deploy_kubernetes
        ;;
    stop)
        stop_services
        ;;
    logs)
        show_logs "$2"
        ;;
    help|--help|-h)
        show_usage
        ;;
    *)
        print_error "Invalid command: $1"
        echo ""
        show_usage
        exit 1
        ;;
esac
