# terraform/variables.tf
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "af-south-1"
}

variable "environment" {
  description = "Environment (dev, staging, production)"
  type        = string
  default     = "production"
}

variable "db_username" {
  description = "PostgreSQL master username"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "PostgreSQL master password"
  type        = string
  sensitive   = true
}

variable "docdb_username" {
  description = "DocumentDB master username"
  type        = string
  sensitive   = true
}

variable "docdb_password" {
  description = "DocumentDB master password"
  type        = string
  sensitive   = true
}

variable "rabbitmq_username" {
  description = "RabbitMQ username"
  type        = string
  sensitive   = true
}

variable "rabbitmq_password" {
  description = "RabbitMQ password"
  type        = string
  sensitive   = true
}

variable "services" {
  description = "ECR repositories for services"
  type        = map(string)
  default = {
    api-gateway         = "api-gateway"
    order-service       = "order-service"
    payment-service     = "payment-service"
    notification-service = "notification-service"
    delivery-service    = "delivery-service"
    restaurant-service  = "restaurant-service"
    auth-service        = "auth-service"
    frontend            = "frontend"
  }
}