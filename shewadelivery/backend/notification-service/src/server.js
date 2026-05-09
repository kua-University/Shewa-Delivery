 
// backend/notification-service/src/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../../shared/logging/logger');

dotenv.config();

const notificationConsumer = require('./consumers/notificationConsumer');
const emailSmsService = require('./services/emailSmsService');

const app = express();
const PORT = process.env.PORT || 3005;
const NODE_ENV = process.env.NODE_ENV || 'development';

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

// Health check endpoint
app.get('/health', async (req, res) => {
  const consumerHealth = notificationConsumer.getHealth();
  
  res.status(200).json({
    status: 'healthy',
    service: 'notification-service',
    consumer: consumerHealth,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Admin endpoints for failed notifications (ASR-07: retroactive send)
app.get('/api/notifications/failed', async (req, res) => {
  try {
    const { type, userId } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (userId) filter.userId = userId;
    
    const failed = await notificationConsumer.getFailedNotifications(filter);
    
    res.json({
      success: true,
      data: failed,
      count: failed.length
    });
  } catch (error) {
    logger.error({
      message: 'Failed to get failed notifications',
      error: error.message
    });
    res.status(500).json({
      success: false,
      message: 'Unable to fetch failed notifications'
    });
  }
});

app.post('/api/notifications/retry/:notificationId', async (req, res) => {
  try {
    const { notificationId } = req.params;
    const result = await notificationConsumer.manualRetry(notificationId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    logger.error({
      message: 'Manual retry failed',
      error: error.message
    });
    res.status(500).json({
      success: false,
      message: 'Unable to retry notification'
    });
  }
});

// Template preview endpoint (for testing)
app.post('/api/notifications/preview', async (req, res) => {
  try {
    const { type, language = 'en', data } = req.body;
    const templates = emailSmsService.getTemplates(language);
    
    let preview = null;
    switch (type) {
      case 'order_confirmation':
        preview = templates.orderConfirmation.html(data, 'Preview order summary');
        break;
      case 'status_update':
        preview = templates.statusUpdate.html(data);
        break;
      case 'cancellation':
        preview = templates.cancellation.html(data);
        break;
      case 'payment_success':
        preview = templates.paymentSuccess.html(data);
        break;
      case 'payment_failed':
        preview = templates.paymentFailed.html(data);
        break;
      default:
        return res.status(400).json({ error: 'Invalid template type' });
    }
    
    res.json({
      success: true,
      preview,
      type,
      language
    });
  } catch (error) {
    logger.error({
      message: 'Template preview failed',
      error: error.message
    });
    res.status(500).json({
      success: false,
      message: 'Unable to generate preview'
    });
  }
});

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
  
  res.status(500).json({
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
    message: 'Notification Service started',
    port: PORT,
    environment: NODE_ENV,
    pid: process.pid
  });
});

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Shutting down Notification Service...');
  
  server.close(async () => {
    logger.info('HTTP server closed');
    await notificationConsumer.close();
    logger.info('RabbitMQ connections closed');
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