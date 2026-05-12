 
# ShewaDelivery - Ethiopia's #1 Food Delivery Platform


## 🚀 Overview

ShewaDelivery is a real-time, multi-actor food delivery platform serving Ethiopian cities. It enables customers to order food from local restaurants, restaurants to manage orders, and drivers to deliver with real-time GPS tracking.

### Key Metrics

- **Order Response Time**: < 2 seconds (ASR-03)
- **System Availability**: 99.99% (ASR-01)
- **Concurrent Users**: 500+ during peak hours
- **GPS Writes**: 600-1000 updates/minute
- **Supported Cities**: Addis Ababa, Bahir Dar, Dire Dawa, Mekelle, and more

## 🏗 Architecture

## ✨ Features

### For Customers
- 🍔 Browse restaurants by cuisine, rating, or location
- 🛒 Real-time cart management
- 📍 Live order tracking with GPS
- 💳 Multiple payment options (Chapa, Cash, Telebirr)
- 🌍 Bilingual support (Amharic/English)
- 📱 Offline mode with request queuing

### For Restaurants
- 📊 Real-time order dashboard
- 🔔 Instant order notifications
- 📈 Sales analytics and reporting
- 🍽️ Menu management system
- ⭐ Customer reviews and ratings
- 🚚 Driver assignment interface

### For Drivers
- 📍 Real-time GPS tracking
- 🗺️ Optimized delivery routes
- 💰 Earnings tracking
- 📱 Mobile-first interface
- 🔄 Live order updates

## 🛠 Tech Stack

### Backend
- **Runtime**: Node.js 18
- **Framework**: Express.js
- **Databases**: PostgreSQL (ACID), MongoDB (GPS), Redis (Cache)
- **Message Queue**: RabbitMQ
- **Authentication**: JWT with refresh tokens
- **API Gateway**: Custom Node.js gateway

### Frontend
- **Framework**: React 18
- **State Management**: Redux Toolkit
- **Styling**: CSS Modules + Tailwind
- **PWA**: Workbox
- **Maps**: Google Maps API
- **i18n**: react-i18next

### Infrastructure
- **Container**: Docker
- **Orchestration**: Kubernetes (EKS)
- **Cloud Provider**: AWS af-south-1 (Cape Town)
- **CI/CD**: GitHub Actions
- **Monitoring**: Prometheus + Grafana
- **Logging**: ELK Stack

## 🚦 Getting Started

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- PostgreSQL 15+
- MongoDB 7+
- Redis 7+
- Make (optional)

### Quick Start with Docker

```bash
# Clone the repository
git clone https://github.com/shewadelivery/platform.git
cd platform

# Copy environment variables
cp .env.example .env

# Update .env with your values
# Edit .env and set database passwords, API keys, etc.

# Start all services
docker-compose up -d

# Run database migrations
docker-compose exec backend npm run migrate

# Seed database with sample data
docker-compose exec backend npm run seed

# Access the application
# Frontend: http://localhost:80
# API: http://localhost:3000
# RabbitMQ Management: http://localhost:15672 (guest/guest)