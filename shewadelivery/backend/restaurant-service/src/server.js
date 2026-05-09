 
// backend/restaurant-service/src/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../../shared/logging/logger');

dotenv.config();

const restaurantController = require('./controllers/restaurantController');
const db = require('./db/postgres');

const app = express();
const PORT = process.env.PORT || 3002;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Rate limiting for public endpoints (ASR-02)
const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: 'Too many requests, please try again later'
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many admin requests'
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

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
    service: 'restaurant-service',
    database: dbHealth,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Public routes (with rate limiting)
app.get('/api/restaurants', publicLimiter, restaurantController.getAllRestaurants);
app.get('/api/restaurants/search', publicLimiter, restaurantController.searchRestaurants);
app.get('/api/restaurants/cuisines', publicLimiter, restaurantController.getCuisines);
app.get('/api/restaurants/cities', publicLimiter, restaurantController.getCities);
app.get('/api/restaurants/city/:city', publicLimiter, restaurantController.getRestaurantsByCity);
app.get('/api/restaurants/:id', publicLimiter, restaurantController.getRestaurantById);
app.get('/api/restaurants/:id/menu', publicLimiter, restaurantController.getRestaurantMenu);

// Admin/Protected routes (would normally have auth middleware)
app.post('/api/restaurants', adminLimiter, restaurantController.createRestaurant);
app.put('/api/restaurants/:id', adminLimiter, restaurantController.updateRestaurant);
app.post('/api/restaurants/:id/menu', adminLimiter, restaurantController.addMenuItem);
app.put('/api/restaurants/:id/menu/:itemId', adminLimiter, restaurantController.updateMenuItem);
app.delete('/api/restaurants/:id/menu/:itemId', adminLimiter, restaurantController.deleteMenuItem);
app.patch('/api/restaurants/:id/status', adminLimiter, restaurantController.toggleRestaurantStatus);

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

// Initialize database and start server
const startServer = async () => {
  try {
    await db.initializeDatabase();
    
    const server = app.listen(PORT, () => {
      logger.info({
        message: 'Restaurant Service started',
        port: PORT,
        environment: NODE_ENV,
        pid: process.pid,
        note: 'ASR-08: Only modified for new features'
      });
    });
    
    // Graceful shutdown
    const gracefulShutdown = async () => {
      logger.info('Shutting down Restaurant Service...');
      
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
      message: 'Failed to start Restaurant Service',
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
};

startServer();

module.exports = app;