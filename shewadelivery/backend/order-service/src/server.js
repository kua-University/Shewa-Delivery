 // backend/order-service/src/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../shared/logging/logger');

dotenv.config();

const orderController = require('./controllers/orderController');
const db = require('./db/postgres');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    service: 'order-service',
    database: dbHealth,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Routes
app.post('/api/orders', orderController.createOrder);
app.get('/api/orders/:id', orderController.getOrderById);
app.get('/api/orders/user/:userId/active', orderController.getUserActiveOrders);
app.put('/api/orders/:id/status', orderController.updateOrderStatus);
app.post('/api/orders/:id/cancel', orderController.cancelOrder);
app.post('/api/orders/:id/payment-callback', orderController.handlePaymentCallback);

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
const server = app.listen(PORT, () => {
  logger.info({
    message: 'Order Service started',
    port: PORT,
    environment: NODE_ENV,
    pid: process.pid
  });
});

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Shutting down Order Service...');
  
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

module.exports = app;
