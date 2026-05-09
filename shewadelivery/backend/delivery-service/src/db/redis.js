 // backend/delivery-service/src/db/redis.js
const redis = require('redis');
const logger = require('../../../shared/logging/logger');

// Redis configuration for real-time caching
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB) || 0,
  
  // Connection options
  retryStrategy: (times) => {
    const delay = Math.min(times * 100, 3000);
    logger.warn({
      message: 'Redis reconnecting',
      attempt: times,
      delayMs: delay
    });
    return delay;
  },
  
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNREFUSED'];
    return targetErrors.some(targetError => err.message.includes(targetError));
  },
  
  connectTimeout: 10000,
  commandTimeout: 3000,
  keepAlive: 30000,
  
  // For high-frequency operations
  enableReadyCheck: true,
  enableOfflineQueue: true
};

// Create Redis client
const redisClient = redis.createClient(redisConfig);

let isReady = false;

// Event handlers
redisClient.on('connect', () => {
  logger.info({
    message: 'Redis client connecting',
    host: redisConfig.host
  });
});

redisClient.on('ready', () => {
  isReady = true;
  logger.info({
    message: 'Redis connected and ready',
    host: redisConfig.host,
    db: redisConfig.db
  });
});

redisClient.on('error', (error) => {
  isReady = false;
  logger.error({
    message: 'Redis connection error',
    error: error.message
  });
});

redisClient.on('end', () => {
  isReady = false;
  logger.warn('Redis connection closed');
});

// Connect
(async () => {
  try {
    await redisClient.connect();
  } catch (error) {
    logger.error({
      message: 'Failed to connect to Redis',
      error: error.message
    });
  }
})();

/**
 * Get driver location from cache
 */
const getDriverLocation = async (driverId) => {
  try {
    const cached = await redisClient.get(`driver:location:${driverId}`);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    logger.error({
      message: 'Failed to get driver location from cache',
      error: error.message,
      driverId
    });
    return null;
  }
};

/**
 * Set driver location in cache with TTL
 */
const setDriverLocation = async (driverId, locationData, ttl = 2) => {
  try {
    await redisClient.setEx(`driver:location:${driverId}`, ttl, JSON.stringify(locationData));
    return true;
  } catch (error) {
    logger.error({
      message: 'Failed to cache driver location',
      error: error.message,
      driverId
    });
    return false;
  }
};

/**
 * Get nearby drivers from Redis geospatial index
 */
const getNearbyDrivers = async (longitude, latitude, radius = 5) => {
  try {
    const drivers = await redisClient.geoRadius(
      'drivers:active',
      { longitude, latitude },
      radius,
      'km'
    );
    return drivers;
  } catch (error) {
    logger.error({
      message: 'Failed to get nearby drivers from Redis',
      error: error.message
    });
    return [];
  }
};

/**
 * Add driver to geospatial index
 */
const addDriverToGeoIndex = async (driverId, longitude, latitude) => {
  try {
    await redisClient.geoAdd('drivers:active', {
      longitude,
      latitude,
      member: driverId.toString()
    });
    await redisClient.expire('drivers:active', 30);
    return true;
  } catch (error) {
    logger.error({
      message: 'Failed to add driver to geo index',
      error: error.message,
      driverId
    });
    return false;
  }
};

/**
 * Get ETA for delivery
 */
const getDeliveryETA = async (orderId) => {
  try {
    const eta = await redisClient.get(`delivery:eta:${orderId}`);
    return eta ? JSON.parse(eta) : null;
  } catch (error) {
    logger.error({
      message: 'Failed to get ETA from cache',
      error: error.message,
      orderId
    });
    return null;
  }
};

/**
 * Set ETA for delivery
 */
const setDeliveryETA = async (orderId, etaData, ttl = 10) => {
  try {
    await redisClient.setEx(`delivery:eta:${orderId}`, ttl, JSON.stringify(etaData));
    return true;
  } catch (error) {
    logger.error({
      message: 'Failed to cache ETA',
      error: error.message,
      orderId
    });
    return false;
  }
};

/**
 * Health check
 */
const healthCheck = async () => {
  if (!isReady) {
    return { healthy: false, message: 'Redis not ready' };
  }
  
  try {
    await redisClient.ping();
    return { healthy: true };
  } catch (error) {
    return { healthy: false, message: error.message };
  }
};

/**
 * Close connection
 */
const closeConnection = async () => {
  try {
    await redisClient.quit();
    logger.info('Redis connection closed');
  } catch (error) {
    logger.error({
      message: 'Error closing Redis connection',
      error: error.message
    });
  }
};

module.exports = {
  client: redisClient,
  getDriverLocation,
  setDriverLocation,
  getNearbyDrivers,
  addDriverToGeoIndex,
  getDeliveryETA,
  setDeliveryETA,
  healthCheck,
  closeConnection,
  isReady: () => isReady
};
