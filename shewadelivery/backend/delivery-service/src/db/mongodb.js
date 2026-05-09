 // backend/delivery-service/src/db/mongodb.js
const mongoose = require('mongoose');
const logger = require('../../../shared/logging/logger');

// MongoDB connection options optimized for high-frequency writes
const mongoOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  
  // Connection pool settings
  maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE) || 50,
  minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE) || 10,
  maxIdleTimeMS: 30000, // Close idle connections after 30 seconds
  
  // Write concern (balance between durability and speed)
  writeConcern: {
    w: process.env.NODE_ENV === 'production' ? 1 : 0, // Acknowledge writes
    j: false // No journaling for speed (ASR-03)
  },
  
  // Read preference
  readPreference: 'primaryPreferred',
  
  // Retry logic
  retryWrites: true,
  retryReads: true,
  
  // Server selection timeout
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 30000,
  
  // Heartbeat frequency
  heartbeatFrequencyMS: 10000
};

// Connection state
let isConnected = false;
let connectionAttempts = 0;
const MAX_RETRIES = 5;
const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000];

/**
 * Connect to MongoDB
 */
const connectMongoDB = async () => {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/shewadelivery';
  
  try {
    logger.info({
      message: 'Connecting to MongoDB',
      uri: mongoUri.replace(/\/\/.*@/, '//***@'), // Hide credentials
      poolSize: mongoOptions.maxPoolSize
    });
    
    await mongoose.connect(mongoUri, mongoOptions);
    isConnected = true;
    connectionAttempts = 0;
    
    logger.info({
      message: 'MongoDB connected successfully',
      host: mongoose.connection.host,
      database: mongoose.connection.name,
      poolSize: mongoose.connection.client?.topology?.description?.maxPoolSize
    });
    
    // Set up connection event handlers
    mongoose.connection.on('error', handleConnectionError);
    mongoose.connection.on('disconnected', handleDisconnect);
    mongoose.connection.on('reconnected', handleReconnect);
    
    return true;
    
  } catch (error) {
    logger.error({
      message: 'MongoDB connection failed',
      error: error.message,
      code: error.code,
      attempt: connectionAttempts + 1
    });
    
    isConnected = false;
    
    // Retry connection
    if (connectionAttempts < MAX_RETRIES) {
      const delay = RETRY_DELAYS[connectionAttempts];
      connectionAttempts++;
      
      logger.info({
        message: `Retrying MongoDB connection in ${delay}ms`,
        attempt: connectionAttempts,
        maxRetries: MAX_RETRIES
      });
      
      setTimeout(connectMongoDB, delay);
    } else {
      logger.error({
        message: 'Failed to connect to MongoDB after max retries',
        maxRetries: MAX_RETRIES
      });
      process.exit(1);
    }
    
    return false;
  }
};

/**
 * Handle connection errors
 */
const handleConnectionError = (error) => {
  logger.error({
    message: 'MongoDB connection error',
    error: error.message,
    code: error.code
  });
  isConnected = false;
};

/**
 * Handle disconnect
 */
const handleDisconnect = () => {
  logger.warn('MongoDB disconnected. Attempting to reconnect...');
  isConnected = false;
  
  // Attempt to reconnect
  setTimeout(() => {
    if (!isConnected) {
      connectMongoDB();
    }
  }, 5000);
};

/**
 * Handle reconnection
 */
const handleReconnect = () => {
  logger.info('MongoDB reconnected successfully');
  isConnected = true;
};

/**
 * Check MongoDB health
 */
const healthCheck = async () => {
  try {
    if (!isConnected || mongoose.connection.readyState !== 1) {
      return {
        healthy: false,
        message: 'MongoDB not connected',
        state: mongoose.connection.readyState
      };
    }
    
    // Run ping command
    await mongoose.connection.db.admin().ping();
    
    // Get stats
    const stats = await mongoose.connection.db.stats();
    
    return {
      healthy: true,
      message: 'MongoDB is healthy',
      state: 'connected',
      stats: {
        collections: stats.collections,
        objects: stats.objects,
        dataSize: stats.dataSize,
        storageSize: stats.storageSize
      }
    };
    
  } catch (error) {
    logger.error({
      message: 'MongoDB health check failed',
      error: error.message
    });
    
    return {
      healthy: false,
      message: error.message,
      state: mongoose.connection.readyState
    };
  }
};

/**
 * Close MongoDB connection
 */
const closeConnection = async () => {
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
    isConnected = false;
  } catch (error) {
    logger.error({
      message: 'Error closing MongoDB connection',
      error: error.message
    });
  }
};

/**
 * Get connection status
 */
const getConnectionStatus = () => {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
    99: 'uninitialized'
  };
  
  return {
    isConnected: isConnected && mongoose.connection.readyState === 1,
    readyState: states[mongoose.connection.readyState] || 'unknown',
    host: mongoose.connection.host,
    database: mongoose.connection.name
  };
};

// Connect on module load
connectMongoDB();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing MongoDB connection...');
  await closeConnection();
  process.exit(0);
});

module.exports = {
  connect: connectMongoDB,
  disconnect: closeConnection,
  healthCheck,
  getConnectionStatus,
  connection: mongoose.connection
};
