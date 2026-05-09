 
// backend/notification-service/src/consumers/notificationConsumer.js
const amqp = require('amqplib');
const emailSmsService = require('../services/emailSmsService');
const logger = require('../../../shared/logging/logger');

// Queue configuration
const QUEUES = {
  NOTIFICATIONS: 'shewa.notifications',
  DEAD_LETTER: 'shewa.dead.letter',
  RETRY: 'shewa.notifications.retry'
};

const EXCHANGES = {
  NOTIFICATION_EVENTS: 'shewa.notification.events'
};

let connection = null;
let channel = null;
let isConnected = false;
let retryCount = 0;
const MAX_RETRIES = 5;
const RETRY_DELAYS = [5000, 15000, 30000, 60000, 120000]; // 5s, 15s, 30s, 1m, 2m

// Store failed messages for retroactive sending (ASR-07)
const failedMessagesStore = new Map();
const RETROACTIVE_WINDOW = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Initialize RabbitMQ connection and consumers
 * ASR-07: Ensures messages are never lost
 */
const initialize = async () => {
  try {
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    
    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();
    
    // Assert queues with dead letter exchange (ASR-07)
    await channel.assertQueue(QUEUES.NOTIFICATIONS, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': QUEUES.DEAD_LETTER,
        'x-message-ttl': RETROACTIVE_WINDOW,
        'x-max-retries': MAX_RETRIES
      }
    });
    
    await channel.assertQueue(QUEUES.DEAD_LETTER, { durable: true });
    await channel.assertQueue(QUEUES.RETRY, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': QUEUES.NOTIFICATIONS,
        'x-message-ttl': 60000 // 1 minute retry delay
      }
    });
    
    // Assert exchanges
    await channel.assertExchange(EXCHANGES.NOTIFICATION_EVENTS, 'topic', { durable: true });
    
    // Set prefetch to 10 messages (balanced processing)
    await channel.prefetch(10);
    
    // Start consuming messages
    await startConsumer();
    
    // Start dead letter processor
    await startDeadLetterProcessor();
    
    isConnected = true;
    retryCount = 0;
    
    logger.info({
      message: 'Notification Service RabbitMQ initialized',
      queues: Object.values(QUEUES),
      prefetch: 10
    });
    
    return true;
    
  } catch (error) {
    logger.error({
      message: 'Failed to initialize RabbitMQ consumer',
      error: error.message,
      retryCount
    });
    
    isConnected = false;
    
    // Retry connection with backoff (ASR-07)
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount];
      retryCount++;
      
      logger.info({
        message: `Retrying RabbitMQ connection in ${delay}ms`,
        retryAttempt: retryCount,
        maxRetries: MAX_RETRIES
      });
      
      setTimeout(initialize, delay);
    } else {
      logger.error({
        message: 'Failed to connect to RabbitMQ after max retries',
        maxRetries: MAX_RETRIES
      });
    }
    
    return false;
  }
};

/**
 * Start consuming messages from notification queue
 */
const startConsumer = async () => {
  if (!channel) {
    logger.error('Channel not available for consuming');
    return;
  }
  
  await channel.consume(QUEUES.NOTIFICATIONS, async (message) => {
    if (!message) return;
    
    const startTime = Date.now();
    let notification = null;
    
    try {
      // Parse message
      notification = JSON.parse(message.content.toString());
      
      logger.info({
        message: 'Processing notification',
        notificationId: notification.id,
        type: notification.type,
        userId: notification.userId,
        orderId: notification.orderId,
        retryCount: notification.retryCount || 0
      });
      
      // Process notification based on type
      let result;
      switch (notification.type) {
        case 'ORDER_CREATED':
          result = await emailSmsService.sendOrderConfirmation(notification);
          break;
          
        case 'ORDER_STATUS_UPDATED':
          result = await emailSmsService.sendOrderStatusUpdate(notification);
          break;
          
        case 'ORDER_CANCELLED':
          result = await emailSmsService.sendOrderCancellation(notification);
          break;
          
        case 'PAYMENT_SUCCESS':
          result = await emailSmsService.sendPaymentSuccess(notification);
          break;
          
        case 'PAYMENT_FAILED':
          result = await emailSmsService.sendPaymentFailed(notification);
          break;
          
        case 'DRIVER_ASSIGNED':
          result = await emailSmsService.sendDriverAssigned(notification);
          break;
          
        case 'ORDER_DELIVERED':
          result = await emailSmsService.sendOrderDelivered(notification);
          break;
          
        case 'RESTAURANT_ORDER_RECEIVED':
          result = await emailSmsService.sendRestaurantOrderNotification(notification);
          break;
          
        default:
          logger.warn({
            message: 'Unknown notification type',
            type: notification.type,
            notificationId: notification.id
          });
          result = { success: false, error: 'Unknown notification type' };
      }
      
      const processingTime = Date.now() - startTime;
      
      if (result.success) {
        // Acknowledge message (success)
        channel.ack(message);
        
        // Publish success event
        await publishNotificationEvent('sent', notification);
        
        logger.info({
          message: 'Notification processed successfully',
          notificationId: notification.id,
          type: notification.type,
          userId: notification.userId,
          processingTimeMs: processingTime
        });
      } else {
        // Handle failure with retry logic
        await handleFailedNotification(message, notification, result.error);
      }
      
    } catch (error) {
      logger.error({
        message: 'Error processing notification',
        notificationId: notification?.id,
        error: error.message,
        stack: error.stack,
        processingTimeMs: Date.now() - startTime
      });
      
      await handleFailedNotification(message, notification, error.message);
    }
  });
  
  logger.info('Notification consumer started');
};

/**
 * Handle failed notification with retry logic (ASR-07)
 */
const handleFailedNotification = async (message, notification, error) => {
  try {
    const retryCount = (notification?.retryCount || 0) + 1;
    const maxRetries = notification?.maxRetries || 3;
    
    if (retryCount <= maxRetries) {
      // Retry with exponential backoff
      const retryDelay = calculateRetryDelay(retryCount);
      
      logger.warn({
        message: 'Notification failed, scheduling retry',
        notificationId: notification?.id,
        retryCount,
        maxRetries,
        retryDelayMs: retryDelay,
        error
      });
      
      // Update retry count
      notification.retryCount = retryCount;
      notification.lastError = error;
      notification.nextRetryAt = new Date(Date.now() + retryDelay);
      
      // Reject and requeue with delay
      channel.reject(message, false); // false = don't requeue immediately
      
      // Schedule for retry via retry queue
      await scheduleRetry(notification, retryDelay);
      
      // Store for retroactive sending if needed
      storeFailedNotification(notification, error);
      
    } else {
      // Max retries exceeded - move to dead letter queue
      logger.error({
        message: 'Notification failed after max retries, moving to dead letter',
        notificationId: notification?.id,
        retryCount,
        maxRetries,
        error
      });
      
      // Store failed notification for retroactive processing
      storeFailedNotification(notification, error, true);
      
      // Send to dead letter queue
      channel.sendToQueue(
        QUEUES.DEAD_LETTER,
        Buffer.from(JSON.stringify({
          ...notification,
          failedAt: new Date().toISOString(),
          finalError: error,
          totalRetries: retryCount
        })),
        { persistent: true }
      );
      
      // Acknowledge original message (already moved to dead letter)
      channel.ack(message);
      
      // Publish failure event for monitoring
      await publishNotificationEvent('failed', notification, error);
    }
    
  } catch (handlerError) {
    logger.error({
      message: 'Error in failure handler',
      error: handlerError.message,
      originalError: error
    });
    
    // Force acknowledge to prevent message loop
    channel.ack(message);
  }
};

/**
 * Schedule retry with delay
 */
const scheduleRetry = async (notification, delayMs) => {
  try {
    await channel.assertQueue(QUEUES.RETRY, { durable: true });
    
    channel.sendToQueue(
      QUEUES.RETRY,
      Buffer.from(JSON.stringify(notification)),
      {
        persistent: true,
        expiration: delayMs // Message will be moved after delay
      }
    );
    
    logger.debug({
      message: 'Notification scheduled for retry',
      notificationId: notification.id,
      delayMs
    });
    
  } catch (error) {
    logger.error({
      message: 'Failed to schedule retry',
      error: error.message,
      notificationId: notification.id
    });
  }
};

/**
 * Process dead letter queue (retroactive sending)
 */
const startDeadLetterProcessor = async () => {
  if (!channel) return;
  
  await channel.consume(QUEUES.DEAD_LETTER, async (message) => {
    if (!message) return;
    
    try {
      const failedNotification = JSON.parse(message.content.toString());
      
      logger.warn({
        message: 'Processing dead letter notification',
        notificationId: failedNotification.id,
        type: failedNotification.type,
        failedAt: failedNotification.failedAt
      });
      
      // Attempt retroactive send (ASR-07)
      const retroactiveResult = await processRetroactiveNotification(failedNotification);
      
      if (retroactiveResult.success) {
        channel.ack(message);
        
        logger.info({
          message: 'Retroactive notification sent successfully',
          notificationId: failedNotification.id
        });
      } else {
        // Keep in dead letter for manual intervention
        channel.nack(message, false, false);
        
        logger.error({
          message: 'Retroactive notification failed, requiring manual intervention',
          notificationId: failedNotification.id,
          error: retroactiveResult.error
        });
      }
      
    } catch (error) {
      logger.error({
        message: 'Error processing dead letter',
        error: error.message
      });
      channel.nack(message, false, false);
    }
  });
  
  logger.info('Dead letter processor started');
};

/**
 * Process retroactive notification (ASR-07)
 * Attempts to send notification that previously failed
 */
const processRetroactiveNotification = async (failedNotification) => {
  try {
    const { type, userId, orderId, data } = failedNotification;
    
    // Check if notification is still relevant (within 7 days)
    const failedAt = new Date(failedNotification.failedAt);
    const now = new Date();
    const daysSinceFailure = (now - failedAt) / (1000 * 60 * 60 * 24);
    
    if (daysSinceFailure > 7) {
      logger.warn({
        message: 'Notification too old for retroactive send',
        notificationId: failedNotification.id,
        daysSinceFailure
      });
      return { success: false, error: 'Notification expired' };
    }
    
    // Attempt to send based on type
    let result;
    switch (type) {
      case 'ORDER_CREATED':
        result = await emailSmsService.sendOrderConfirmation(failedNotification);
        break;
      case 'ORDER_STATUS_UPDATED':
        result = await emailSmsService.sendOrderStatusUpdate(failedNotification);
        break;
      case 'PAYMENT_SUCCESS':
        result = await emailSmsService.sendPaymentSuccess(failedNotification);
        break;
      case 'PAYMENT_FAILED':
        result = await emailSmsService.sendPaymentFailed(failedNotification);
        break;
      default:
        result = { success: false, error: 'Unsupported notification type' };
    }
    
    if (result.success) {
      // Remove from failed store
      failedMessagesStore.delete(failedNotification.id);
    }
    
    return result;
    
  } catch (error) {
    logger.error({
      message: 'Retroactive processing failed',
      notificationId: failedNotification.id,
      error: error.message
    });
    
    return { success: false, error: error.message };
  }
};

/**
 * Store failed notification for retroactive sending
 */
const storeFailedNotification = (notification, error, isFinal = false) => {
  try {
    const failedRecord = {
      id: notification.id,
      type: notification.type,
      userId: notification.userId,
      orderId: notification.orderId,
      data: notification.data,
      error: error,
      failedAt: new Date().toISOString(),
      retryCount: notification.retryCount || 0,
      isFinal: isFinal,
      storedAt: new Date().toISOString()
    };
    
    failedMessagesStore.set(notification.id, failedRecord);
    
    // Clean up old entries (older than RETROACTIVE_WINDOW)
    const cutoffTime = Date.now() - RETROACTIVE_WINDOW;
    for (const [id, record] of failedMessagesStore.entries()) {
      if (new Date(record.failedAt).getTime() < cutoffTime) {
        failedMessagesStore.delete(id);
      }
    }
    
    logger.debug({
      message: 'Failed notification stored for retroactive sending',
      notificationId: notification.id,
      storeSize: failedMessagesStore.size
    });
    
  } catch (storageError) {
    logger.error({
      message: 'Failed to store notification',
      error: storageError.message
    });
  }
};

/**
 * Publish notification event for monitoring
 */
const publishNotificationEvent = async (eventType, notification, error = null) => {
  if (!channel) return;
  
  try {
    const routingKey = `notification.${eventType}`;
    const event = {
      eventType,
      notificationId: notification.id,
      type: notification.type,
      userId: notification.userId,
      orderId: notification.orderId,
      timestamp: new Date().toISOString(),
      error: error,
      retryCount: notification.retryCount
    };
    
    channel.publish(
      EXCHANGES.NOTIFICATION_EVENTS,
      routingKey,
      Buffer.from(JSON.stringify(event)),
      { persistent: false }
    );
    
  } catch (error) {
    logger.debug({
      message: 'Failed to publish notification event',
      error: error.message
    });
  }
};

/**
 * Calculate retry delay with exponential backoff
 */
const calculateRetryDelay = (retryCount) => {
  const delays = [1000, 5000, 15000, 30000, 60000]; // 1s, 5s, 15s, 30s, 60s
  return delays[Math.min(retryCount - 1, delays.length - 1)];
};

/**
 * Get failed notifications for manual retry (admin endpoint)
 */
const getFailedNotifications = async (filter = {}) => {
  const notifications = Array.from(failedMessagesStore.values());
  
  if (filter.type) {
    return notifications.filter(n => n.type === filter.type);
  }
  
  if (filter.userId) {
    return notifications.filter(n => n.userId === filter.userId);
  }
  
  return notifications;
};

/**
 * Manually retry a failed notification
 */
const manualRetry = async (notificationId) => {
  const failedRecord = failedMessagesStore.get(notificationId);
  
  if (!failedRecord) {
    return { success: false, error: 'Notification not found' };
  }
  
  try {
    // Re-queue the notification
    channel.sendToQueue(
      QUEUES.NOTIFICATIONS,
      Buffer.from(JSON.stringify({
        id: failedRecord.id,
        type: failedRecord.type,
        userId: failedRecord.userId,
        orderId: failedRecord.orderId,
        data: failedRecord.data,
        retryCount: 0,
        isManualRetry: true,
        queuedAt: new Date().toISOString()
      })),
      { persistent: true }
    );
    
    // Remove from failed store
    failedMessagesStore.delete(notificationId);
    
    logger.info({
      message: 'Manual retry initiated',
      notificationId
    });
    
    return { success: true, message: 'Notification queued for retry' };
    
  } catch (error) {
    logger.error({
      message: 'Manual retry failed',
      notificationId,
      error: error.message
    });
    
    return { success: false, error: error.message };
  }
};

/**
 * Get consumer health status
 */
const getHealth = () => {
  return {
    connected: isConnected,
    queueName: QUEUES.NOTIFICATIONS,
    failedMessagesCount: failedMessagesStore.size,
    retryCount,
    uptime: process.uptime()
  };
};

/**
 * Close connections
 */
const close = async () => {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
    logger.info('Notification consumer closed');
  } catch (error) {
    logger.error({
      message: 'Error closing consumer',
      error: error.message
    });
  }
};

// Initialize on module load
initialize();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing notification consumer');
  await close();
  process.exit(0);
});

module.exports = {
  initialize,
  getFailedNotifications,
  manualRetry,
  getHealth,
  close,
  QUEUES
};