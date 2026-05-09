 
// backend/auth-service/src/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../../shared/logging/logger');

dotenv.config();

const authController = require('./controllers/authController');
const db = require('./db/postgres');

const app = express();
const PORT = process.env.PORT || 3004;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Strict rate limiting for auth endpoints (ASR-05: prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: 'Too many authentication attempts, please try again later',
  skipSuccessfulRequests: true // Don't count successful logins
});

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 OTP requests per hour
  message: 'Too many OTP requests, please try again later'
});

const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: 'Too many requests'
});

// Middleware
app.use(helmet({
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '5mb' }));

// Request ID middleware
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Health check
app.get('/health', async (req, res) => {
  const dbHealth = await db.healthCheck();
  
  res.status(dbHealth.healthy ? 200 : 503).json({
    status: dbHealth.healthy ? 'healthy' : 'unhealthy',
    service: 'auth-service',
    database: dbHealth,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Public auth routes
app.post('/api/auth/register', authLimiter, authController.register);
app.post('/api/auth/login', authLimiter, authController.login);
app.post('/api/auth/refresh', publicLimiter, authController.refreshToken);
app.post('/api/auth/logout', publicLimiter, authController.logout);
app.post('/api/auth/request-otp', otpLimiter, authController.requestOTP);
app.post('/api/auth/verify-otp', authLimiter, authController.verifyOTP);
app.post('/api/auth/forgot-password', authLimiter, authController.forgotPassword);
app.post('/api/auth/reset-password', authLimiter, authController.resetPassword);
app.post('/api/auth/change-password', authLimiter, authController.changePassword);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error({
    message: 'Unhandled error',
    error: err.message,
    stack: err.stack,
    path: req.path,
    requestId: req.id
  });
  
  res.status(err.status || 500).json({
    success: false,
    message: NODE_ENV === 'production' 
      ? 'An internal server error occurred'
      : err.message,
    requestId: req.id
  });
});

// Initialize database and start server
const startServer = async () => {
  try {
    await db.initializeDatabase();
    
    const server = app.listen(PORT, () => {
      logger.info({
        message: 'Auth Service started',
        port: PORT,
        environment: NODE_ENV,
        jwtExpiry: process.env.JWT_EXPIRY || '7d',
        pid: process.pid
      });
    });
    
    // Graceful shutdown
    const gracefulShutdown = async () => {
      logger.info('Shutting down Auth Service...');
      
      server.close(async () => {
        logger.info('HTTP server closed');
        await db.closePool();
        logger.info('Database connections closed');
        process.exit(0);
      });
      
      setTimeout(() => {
        logger.error('Forceful shutdown');
        process.exit(1);
      }, 10000);
    };
    
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
  } catch (error) {
    logger.error({
      message: 'Failed to start Auth Service',
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
};

startServer();

module.exports = app;