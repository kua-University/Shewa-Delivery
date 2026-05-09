 
// backend/api-gateway/src/server.js
// ShewaDelivery API Gateway - Central entry point for all client requests
// Handles routing, authentication, rate limiting, and caching (ASR-02, ASR-03, ASR-05)

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const logger = require('../../shared/logging/logger');
const rateLimiter = require('./middleware/rateLimiter');
const jwtAuth = require('./middleware/jwtAuth');
const cache = require('./middleware/cache');

const app = express();
const PORT = process.env.API_GATEWAY_PORT || 3000;

// ============================================
// Security & Middleware
// ============================================
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: process.env.CORS_CREDENTIALS === 'true'
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) }
}));

// ============================================
// Health Check (no auth required)
// ============================================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'api-gateway',
    version: process.env.APP_VERSION || '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ============================================
// API Routes
// ============================================

// Auth routes - public (register, login, refresh)
app.use('/api/auth', rateLimiter.auth, require('./routes/authRoutes'));

// Restaurant routes - public browsing, protected management
app.use('/api/restaurants', cache.menuCache, require('./routes/restaurantRoutes'));

// Order routes - protected (ASR-01: zero order loss, ASR-03: <2s response)
app.use('/api/orders', jwtAuth.required, rateLimiter.authenticated, require('./routes/orderRoutes'));

// Search routes - cached (ASR-02: Redis cache, 200ms response)
app.use('/api/search', cache.searchCache, require('./routes/searchRoutes'));

// ============================================
// 404 Handler
// ============================================
app.use((req, res) => {
  logger.warn({ message: 'Route not found', path: req.path, method: req.method });
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// Global Error Handler
// ============================================
app.use((err, req, res, next) => {
  logger.error({
    message: 'Unhandled error in API Gateway',
    error: err.message,
    stack: err.stack,
    path: req.path
  });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// Start Server
// ============================================
const server = app.listen(PORT, () => {
  logger.info({
    message: `API Gateway running`,
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown (ASR-01: no dropped connections)
process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down API Gateway gracefully');
  server.close(() => {
    logger.info('API Gateway shut down complete');
    process.exit(0);
  });
});

module.exports = app;