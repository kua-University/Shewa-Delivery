 
# terraform/main.tf
terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.10"
    }
  }
  backend "s3" {
    bucket         = "shewadelivery-terraform-state"
    key            = "terraform.tfstate"
    region         = "af-south-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Environment = var.environment
      Project     = "ShewaDelivery"
      ManagedBy   = "Terraform"
    }
  }
}

# VPC Configuration
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "shewadelivery-vpc"
  }
}

# Public Subnets
resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  map_public_ip_on_launch = true

  tags = {
    Name = "shewadelivery-public-subnet-${count.index}"
  }
}

# Private Subnets
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "shewadelivery-private-subnet-${count.index}"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "shewadelivery-igw"
  }
}

# NAT Gateway
resource "aws_eip" "nat" {
  domain = "vpc"
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id

  tags = {
    Name = "shewadelivery-nat"
  }
}

# Route Tables
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "shewadelivery-public-rt"
  }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }

  tags = {
    Name = "shewadelivery-private-rt"
  }
}

# Route Table Associations
resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# EKS Cluster
resource "aws_eks_cluster" "main" {
  name     = "shewadelivery-eks"
  role_arn = aws_iam_role.eks_cluster.arn
  version  = "1.28"

  vpc_config {
    subnet_ids = aws_subnet.public[*].id
  }

  tags = {
    Name = "shewadelivery-eks"
  }
}

resource "aws_iam_role" "eks_cluster" {
  name = "shewadelivery-eks-cluster-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "eks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_cluster" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.eks_cluster.name
}

# EKS Node Group
resource "aws_eks_node_group" "main" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "shewadelivery-nodes"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = aws_subnet.private[*].id
  instance_types  = ["t3.medium", "t3.large"]
  capacity_type   = "ON_DEMAND"

  scaling_config {
    desired_size = 3
    max_size     = 10
    min_size     = 2
  }

  update_config {
    max_unavailable = 1
  }

  tags = {
    Name = "shewadelivery-node-group"
  }
}

resource "aws_iam_role" "eks_nodes" {
  name = "shewadelivery-eks-nodes-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_nodes" {
  for_each = {
    "AmazonEKSWorkerNodePolicy"      = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
    "AmazonEKS_CNI_Policy"           = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
    "AmazonEC2ContainerRegistryReadOnly" = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  }
  policy_arn = each.value
  role       = aws_iam_role.eks_nodes.name
}

# RDS PostgreSQL
resource "aws_db_instance" "postgres" {
  identifier     = "shewadelivery-postgres"
  engine         = "postgres"
  engine_version = "15.3"
  instance_class = "db.t3.large"
  
  allocated_storage     = 100
  max_allocated_storage = 200
  storage_encrypted     = true
  storage_type         = "gp3"
  
  db_name  = "shewadelivery"
  username = var.db_username
  password = var.db_password
  
  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
  
  backup_retention_period = 30
  backup_window          = "03:00-04:00"
  maintenance_window     = "Mon:04:00-Mon:05:00"
  
  multi_az               = true
  publicly_accessible    = false
  deletion_protection    = true
  skip_final_snapshot    = false
  final_snapshot_identifier = "shewadelivery-postgres-final"
  
  tags = {
    Name = "shewadelivery-postgres"
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "shewadelivery-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "shewadelivery-db-subnet-group"
  }
}

# DocumentDB (MongoDB compatible)
resource "aws_docdb_cluster" "main" {
  cluster_identifier     = "shewadelivery-docdb"
  engine                 = "docdb"
  master_username        = var.docdb_username
  master_password        = var.docdb_password
  db_subnet_group_name   = aws_docdb_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.docdb.id]
  skip_final_snapshot    = false
  final_snapshot_identifier = "shewadelivery-docdb-final"
  
  backup_retention_period = 7
  preferred_backup_window = "07:00-09:00"
  
  tags = {
    Name = "shewadelivery-docdb"
  }
}

resource "aws_docdb_subnet_group" "main" {
  name       = "shewadelivery-docdb-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "shewadelivery-docdb-subnet-group"
  }
}

# ElastiCache for Redis
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id          = "shewadelivery-redis"
  description                   = "ShewaDelivery Redis Cache"
  engine                        = "redis"
  engine_version                = "7.0"
  node_type                     = "cache.t3.micro"
  num_cache_clusters            = 2
  port                          = 6379
  parameter_group_name          = "default.redis7"
  automatic_failover_enabled    = true
  multi_az_enabled              = true
  subnet_group_name             = aws_elasticache_subnet_group.main.name
  security_group_ids            = [aws_security_group.redis.id]
  
  at_rest_encryption_enabled    = true
  transit_encryption_enabled    = true
  
  tags = {
    Name = "shewadelivery-redis"
  }
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "shewadelivery-redis-subnet-group"
  subnet_ids = aws_subnet.private[*].id
}

# MQ for RabbitMQ
resource "aws_mq_broker" "rabbitmq" {
  broker_name        = "shewadelivery-rabbitmq"
  engine_type        = "RabbitMQ"
  engine_version     = "3.11.20"
  host_instance_type = "mq.t3.micro"
  deployment_mode    = "CLUSTER_MULTI_AZ"
  subnet_ids         = aws_subnet.private[*].id
  
  user {
    username = var.rabbitmq_username
    password = var.rabbitmq_password
  }
  
  security_groups = [aws_security_group.rabbitmq.id]
  
  tags = {
    Name = "shewadelivery-rabbitmq"
  }
}

# ECR Repositories
resource "aws_ecr_repository" "services" {
  for_each = var.services
  name     = "shewadelivery/${each.value}"
  
  image_scanning_configuration {
    scan_on_push = true
  }
  
  tags = {
    Name = "shewadelivery-${each.value}"
  }
}

# S3 Bucket for Static Assets
resource "aws_s3_bucket" "assets" {
  bucket = "shewadelivery-assets-${var.environment}"
  
  tags = {
    Name = "shewadelivery-assets"
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id
  
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_website_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  
  index_document {
    suffix = "index.html"
  }
  
  error_document {
    key = "404.html"
  }
}

resource "aws_s3_bucket_cors_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["https://shewadelivery.com"]
    max_age_seconds = 3000
  }
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  
  origin {
    domain_name = aws_s3_bucket_website_configuration.assets.website_endpoint
    origin_id   = "S3Origin"
    
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }
  
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD", "OPTIONS"]
    target_origin_id = "S3Origin"
    
    forwarded_values {
      query_string = true
      cookies {
        forward = "none"
      }
    }
    
    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
    compress               = true
  }
  
  price_class = "PriceClass_100"
  
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  
  viewer_certificate {
    cloudfront_default_certificate = true
  }
  
  tags = {
    Name = "shewadelivery-cloudfront"
  }
}

# Security Groups
resource "aws_security_group" "rds" {
  name        = "shewadelivery-rds-sg"
  description = "Security group for RDS"
  vpc_id      = aws_vpc.main.id
  
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_eks_cluster.main.vpc_config[0].cluster_security_group_id]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "docdb" {
  name        = "shewadelivery-docdb-sg"
  description = "Security group for DocumentDB"
  vpc_id      = aws_vpc.main.id
  
  ingress {
    from_port       = 27017
    to_port         = 27017
    protocol        = "tcp"
    security_groups = [aws_eks_cluster.main.vpc_config[0].cluster_security_group_id]
  }
}

resource "aws_security_group" "redis" {
  name        = "shewadelivery-redis-sg"
  description = "Security group for Redis"
  vpc_id      = aws_vpc.main.id
  
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_eks_cluster.main.vpc_config[0].cluster_security_group_id]
  }
}

resource "aws_security_group" "rabbitmq" {
  name        = "shewadelivery-rabbitmq-sg"
  description = "Security group for RabbitMQ"
  vpc_id      = aws_vpc.main.id
  
  ingress {
    from_port       = 5671
    to_port         = 5672
    protocol        = "tcp"
    security_groups = [aws_eks_cluster.main.vpc_config[0].cluster_security_group_id]
  }
  
  ingress {
    from_port       = 15671
    to_port         = 15672
    protocol        = "tcp"
    security_groups = [aws_eks_cluster.main.vpc_config[0].cluster_security_group_id]
  }
}

# Data sources
data "aws_availability_zones" "available" {
  state = "available"
}