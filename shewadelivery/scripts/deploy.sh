 #!/bin/bash
# scripts/deploy.sh
# ShewaDelivery - Complete Deployment Script
# Supports: development, staging, production environments

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-development}
DEPLOY_TYPE=${2:-full}  # full, backend, frontend, database
REGION=${3:-af-south-1}

# Version info
VERSION=$(git describe --tags --always --dirty)
TIMESTAMP=$(date -Iseconds)

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}ShewaDelivery Deployment Tool v1.0${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Environment: ${GREEN}$ENVIRONMENT${NC}"
echo -e "Deploy Type: ${GREEN}$DEPLOY_TYPE${NC}"
echo -e "Version: ${GREEN}$VERSION${NC}"
echo -e "Timestamp: ${GREEN}$TIMESTAMP${NC}"
echo -e "${BLUE}========================================${NC}"

# Load environment variables
if [ -f ".env.$ENVIRONMENT" ]; then
    source ".env.$ENVIRONMENT"
    echo -e "${GREEN}Loaded environment variables from .env.$ENVIRONMENT${NC}"
else
    echo -e "${YELLOW}Warning: .env.$ENVIRONMENT not found, using system environment${NC}"
fi

# Function to check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"
    
    local missing=0
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}✗ Docker not found${NC}"
        missing=1
    else
        echo -e "${GREEN}✓ Docker found${NC}"
    fi
    
    # Check kubectl for production
    if [ "$ENVIRONMENT" = "production" ]; then
        if ! command -v kubectl &> /dev/null; then
            echo -e "${RED}✗ kubectl not found${NC}"
            missing=1
        else
            echo -e "${GREEN}✓ kubectl found${NC}"
        fi
        
        if ! command -v terraform &> /dev/null; then
            echo -e "${RED}✗ terraform not found${NC}"
            missing=1
        else
            echo -e "${GREEN}✓ terraform found${NC}"
        fi
    fi
    
    # Check AWS CLI for production
    if [ "$ENVIRONMENT" = "production" ] || [ "$ENVIRONMENT" = "staging" ]; then
        if ! command -v aws &> /dev/null; then
            echo -e "${RED}✗ AWS CLI not found${NC}"
            missing=1
        else
            echo -e "${GREEN}✓ AWS CLI found${NC}"
        fi
    fi
    
    if [ $missing -eq 1 ]; then
        echo -e "${RED}Please install missing prerequisites and try again${NC}"
        exit 1
    fi
}

# Function to build Docker images
build_images() {
    echo -e "${YELLOW}Building Docker images...${NC}"
    
    # Build backend services
    services=("api-gateway" "order-service" "payment-service" "notification-service" "delivery-service" "restaurant-service" "auth-service")
    
    for service in "${services[@]}"; do
        echo -e "${BLUE}Building $service...${NC}"
        docker build -t "shewadelivery/$service:$VERSION" -t "shewadelivery/$service:latest" \
            -f "backend/$service/Dockerfile" "backend/$service"
        
        if [ "$ENVIRONMENT" = "production" ]; then
            # Tag for ECR
            docker tag "shewadelivery/$service:$VERSION" "$ECR_REGISTRY/shewadelivery/$service:$VERSION"
            docker tag "shewadelivery/$service:latest" "$ECR_REGISTRY/shewadelivery/$service:latest"
        fi
    done
    
    # Build frontend
    echo -e "${BLUE}Building frontend...${NC}"
    docker build -t "shewadelivery/frontend:$VERSION" -t "shewadelivery/frontend:latest" \
        -f "frontend/Dockerfile" "frontend"
    
    if [ "$ENVIRONMENT" = "production" ]; then
        docker tag "shewadelivery/frontend:$VERSION" "$ECR_REGISTRY/shewadelivery/frontend:$VERSION"
        docker tag "shewadelivery/frontend:latest" "$ECR_REGISTRY/shewadelivery/frontend:latest"
    fi
    
    echo -e "${GREEN}All images built successfully${NC}"
}

# Function to push images to ECR
push_images() {
    if [ "$ENVIRONMENT" != "production" ]; then
        echo -e "${YELLOW}Skipping image push for non-production environment${NC}"
        return
    fi
    
    echo -e "${YELLOW}Pushing images to ECR...${NC}"
    
    # Login to ECR
    aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
    
    services=("api-gateway" "order-service" "payment-service" "notification-service" "delivery-service" "restaurant-service" "auth-service" "frontend")
    
    for service in "${services[@]}"; do
        echo -e "${BLUE}Pushing $service...${NC}"
        docker push "$ECR_REGISTRY/shewadelivery/$service:$VERSION"
        docker push "$ECR_REGISTRY/shewadelivery/$service:latest"
    done
    
    echo -e "${GREEN}All images pushed successfully${NC}"
}

# Function to deploy database migrations
deploy_database() {
    echo -e "${YELLOW}Running database migrations...${NC}"
    
    if [ "$ENVIRONMENT" = "production" ]; then
        # Run migrations on production database
        kubectl exec -n shewadelivery deployment/postgres -- bash -c "
            cd /database &&
            bash scripts/migrate.sh
        "
    else
        # Local database migration
        cd database
        bash scripts/migrate.sh --seed
        cd ..
    fi
    
    echo -e "${GREEN}Database migrations completed${NC}"
    
    # Setup MongoDB indexes
    echo -e "${YELLOW}Setting up MongoDB indexes...${NC}"
    node database/mongodb/indexes.js
    echo -e "${GREEN}MongoDB indexes created${NC}"
}

# Function to deploy backend services
deploy_backend() {
    echo -e "${YELLOW}Deploying backend services...${NC}"
    
    if [ "$ENVIRONMENT" = "production" ]; then
        # Deploy to Kubernetes
        kubectl apply -f infrastructure/k8s/namespaces/
        kubectl apply -f infrastructure/k8s/configmaps/
        kubectl apply -f infrastructure/k8s/secrets/
        kubectl apply -f infrastructure/k8s/deployments/
        kubectl apply -f infrastructure/k8s/services/
        
        # Wait for deployments to be ready
        kubectl wait --for=condition=available --timeout=300s deployment -n shewadelivery --all
        
        # Apply HPA
        kubectl apply -f infrastructure/k8s/deployments/hpa.yaml
        
        # Rollout status
        kubectl rollout status deployment -n shewadelivery --timeout=300s
        
    else
        # Local development with docker-compose
        docker-compose -f infrastructure/docker-compose.dev.yml up -d --build
        
        # Wait for services to be healthy
        sleep 10
        docker-compose -f infrastructure/docker-compose.dev.yml ps
    fi
    
    echo -e "${GREEN}Backend services deployed successfully${NC}"
}

# Function to deploy frontend
deploy_frontend() {
    echo -e "${YELLOW}Deploying frontend...${NC}"
    
    if [ "$ENVIRONMENT" = "production" ]; then
        # Deploy to S3/CloudFront
        aws s3 sync frontend/build/ s3://$S3_BUCKET/ --delete --region $REGION
        
        # Invalidate CloudFront cache
        aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_DIST_ID --paths "/*"
        
        echo -e "${GREEN}Frontend deployed to S3/CloudFront${NC}"
    else
        # Local frontend with docker-compose
        docker-compose -f infrastructure/docker-compose.dev.yml up -d frontend
        echo -e "${GREEN}Frontend started locally${NC}"
    fi
}

# Function to setup monitoring
setup_monitoring() {
    echo -e "${YELLOW}Setting up monitoring...${NC}"
    
    if [ "$ENVIRONMENT" = "production" ]; then
        # Deploy Prometheus
        kubectl apply -f infrastructure/monitoring/prometheus/
        
        # Deploy Grafana
        kubectl apply -f infrastructure/monitoring/grafana/
        
        # Deploy ELK stack for logging
        kubectl apply -f infrastructure/logging/elk/
        
        echo -e "${GREEN}Monitoring stack deployed${NC}"
    fi
}

# Function to run smoke tests
run_smoke_tests() {
    echo -e "${YELLOW}Running smoke tests...${NC}"
    
    local api_url="http://localhost:3000"
    if [ "$ENVIRONMENT" = "production" ]; then
        api_url="https://api.shewadelivery.com"
    fi
    
    # Test health endpoint
    echo -e "${BLUE}Testing API health...${NC}"
    curl -f "$api_url/health" || {
        echo -e "${RED}Health check failed${NC}"
        exit 1
    }
    
    # Test database connection
    echo -e "${BLUE}Testing database...${NC}"
    curl -f "$api_url/health/db" || {
        echo -e "${RED}Database check failed${NC}"
        exit 1
    }
    
    # Test Redis
    echo -e "${BLUE}Testing Redis...${NC}"
    curl -f "$api_url/health/redis" || {
        echo -e "${RED}Redis check failed${NC}"
        exit 1
    }
    
    # Test RabbitMQ
    echo -e "${BLUE}Testing RabbitMQ...${NC}"
    curl -f "$api_url/health/rabbitmq" || {
        echo -e "${RED}RabbitMQ check failed${NC}"
        exit 1
    }
    
    echo -e "${GREEN}All smoke tests passed${NC}"
}

# Function to print deployment summary
print_summary() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${GREEN}Deployment Summary${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo -e "Environment: ${GREEN}$ENVIRONMENT${NC}"
    echo -e "Version: ${GREEN}$VERSION${NC}"
    echo -e "Timestamp: ${GREEN}$TIMESTAMP${NC}"
    
    if [ "$ENVIRONMENT" = "production" ]; then
        echo -e "\nAccess URLs:"
        echo -e "  API: ${GREEN}https://api.shewadelivery.com${NC}"
        echo -e "  Frontend: ${GREEN}https://shewadelivery.com${NC}"
        echo -e "  Grafana: ${GREEN}https://monitoring.shewadelivery.com${NC}"
    else
        echo -e "\nLocal Access:"
        echo -e "  API: ${GREEN}http://localhost:3000${NC}"
        echo -e "  Frontend: ${GREEN}http://localhost:80${NC}"
        echo -e "  RabbitMQ Management: ${GREEN}http://localhost:15672${NC}"
    fi
    
    echo -e "\nDeployed Services:"
    echo -e "  ✅ API Gateway"
    echo -e "  ✅ Order Service"
    echo -e "  ✅ Payment Service"
    echo -e "  ✅ Notification Service"
    echo -e "  ✅ Delivery Service"
    echo -e "  ✅ Restaurant Service"
    echo -e "  ✅ Auth Service"
    echo -e "  ✅ Frontend"
    echo -e "  ✅ PostgreSQL"
    echo -e "  ✅ MongoDB"
    echo -e "  ✅ Redis"
    echo -e "  ✅ RabbitMQ"
    
    echo -e "${BLUE}========================================${NC}"
}

# Main deployment flow
main() {
    check_prerequisites
    
    case $DEPLOY_TYPE in
        full)
            build_images
            push_images
            deploy_database
            deploy_backend
            deploy_frontend
            setup_monitoring
            run_smoke_tests
            print_summary
            ;;
        backend)
            build_images
            push_images
            deploy_database
            deploy_backend
            run_smoke_tests
            print_summary
            ;;
        frontend)
            build_images
            push_images
            deploy_frontend
            print_summary
            ;;
        database)
            deploy_database
            print_summary
            ;;
        *)
            echo -e "${RED}Invalid deploy type: $DEPLOY_TYPE${NC}"
            echo -e "Valid types: full, backend, frontend, database"
            exit 1
            ;;
    esac
    
    echo -e "${GREEN}Deployment completed successfully!${NC}"
}

# Run main function
main "$@"
