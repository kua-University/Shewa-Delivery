 // backend/delivery-service/src/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../../shared/logging/logger');

dotenv.config();

const locationController = require('./controllers/locationController');
const mongodb = require('./db/mongodb');
const redisClient = require('./db/redis');

const app = express();
const PORT = process.env.PORT || 3006;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Rate limiting for GPS updates (prevent abuse)
const gpsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // Max 120 updates per minute (2 per second)
  message: 'Too many GPS updates, please reduce frequency'
});

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many requests'
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression({
  level: 6,
  threshold: 512,
  filter: (req) => {
    // Don't compress GPS updates (already small)
    return !req.path.includes('/location/update');
  }
}));
app.use(express.json({ limit: '10mb' }));

// Request ID middleware
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Health check
app.get('/health', async (req, res) => {
  const mongoHealth = await mongodb.healthCheck();
  const redisHealth = await redisClient.healthCheck();
  
  const isHealthy = mongoHealth.healthy && redisHealth.healthy;
  
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    service: 'delivery-service',
    mongodb: mongoHealth,
    redis: redisHealth,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// GPS tracking routes
app.post('/api/delivery/location/update', gpsLimiter, locationController.updateLocation);
app.post('/api/delivery/location/batch', gpsLimiter, locationController.batchUpdateLocations);
app.get('/api/delivery/location/driver/:driverId', publicLimiter, locationController.getDriverLocation);
app.get('/api/delivery/location/nearby', publicLimiter, locationController.getNearbyDrivers);
app.get('/api/delivery/location/history/:driverId', publicLimiter, locationController.getDriverHistory);
app.get('/api/delivery/driver/:driverId/status', publicLimiter, locationController.getDriverStatus);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path
  });
});

// Error handler
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

// Start server
const startServer = async () => {
  try {
    // Wait for MongoDB connection
    await mongodb.connect();
    
    const server = app.listen(PORT, () => {
      logger.info({
        message: 'Delivery Service started',
        port: PORT,
        environment: NODE_ENV,
        mongodb: mongodb.getConnectionStatus(),
        redis: redisClient.isReady(),
        pid: process.pid
      });
    });
    
    // Graceful shutdown
    const gracefulShutdown = async () => {
      logger.info('Shutting down Delivery Service...');
      
      server.close(async () => {
        logger.info('HTTP server closed');
        await mongodb.disconnect();
        await redisClient.closeConnection();
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
      message: 'Failed to start Delivery Service',
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
};

startServer();

module.exports = app;
