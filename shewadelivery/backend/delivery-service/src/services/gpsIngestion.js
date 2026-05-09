 
// backend/delivery-service/src/services/gpsIngestion.js
const DriverLocation = require('../models/DriverLocation');
const redisClient = require('../db/redis');
const logger = require('../../../shared/logging/logger');

// Write buffer for batching (optional optimization)
let writeBuffer = [];
let bufferTimeout = null;
const BUFFER_SIZE = 100;
const BUFFER_FLUSH_INTERVAL = 1000; // 1 second

/**
 * Store driver location in MongoDB (high-frequency writes optimized)
 */
const storeLocation = async (locationData) => {
  try {
    // Direct write to MongoDB (with write concern for critical data)
    const result = await DriverLocation.create(locationData);
    
    // Optional: Add to buffer for bulk operations (if needed)
    // addToBuffer(locationData);
    
    return result;
    
  } catch (error) {
    logger.error({
      message: 'Failed to store location in MongoDB',
      error: error.message,
      driverId: locationData.driverId
    });
    throw error;
  }
};

/**
 * Update Redis cache with latest driver location
 * TTL: 2 seconds for real-time accuracy
 */
const updateCache = async (driverId, locationData) => {
  try {
    const cacheData = {
      driverId: locationData.driverId,
      location: {
        latitude: locationData.location.coordinates[1],
        longitude: locationData.location.coordinates[0]
      },
      accuracy: locationData.accuracy,
      speed: locationData.speed,
      heading: locationData.heading,
      timestamp: locationData.timestamp,
      status: locationData.status,
      cached: true,
      lastUpdate: new Date().toISOString()
    };
    
    // Store in Redis with 2 second TTL (ASR-02: performance)
    await redisClient.setEx(
      `driver:location:${driverId}`,
      2, // 2 seconds TTL
      JSON.stringify(cacheData)
    );
    
    // Also update a sorted set for geospatial queries (optional)
    await redisClient.geoAdd(
      'drivers:active',
      locationData.location.coordinates[0],
      locationData.location.coordinates[1],
      driverId.toString()
    );
    
    // Set expiry for the geo set member (30 seconds)
    await redisClient.expire('drivers:active', 30);
    
    logger.debug({
      message: 'Driver location cached in Redis',
      driverId,
      ttl: 2
    });
    
    return true;
    
  } catch (error) {
    logger.error({
      message: 'Failed to update Redis cache',
      error: error.message,
      driverId
    });
    return false; // Don't fail the main operation
  }
};

/**
 * Update ETA for active delivery
 */
const updateDeliveryETA = async (driverId, orderId, locationData) => {
  try {
    // Get restaurant location and calculate ETA
    // This would integrate with order service
    const eta = calculateETA(locationData, orderId);
    
    // Store in Redis for quick access
    await redisClient.setEx(
      `delivery:eta:${orderId}`,
      10, // 10 seconds TTL
      JSON.stringify({
        eta,
        driverId,
        lastUpdate: new Date().toISOString()
      })
    );
    
    logger.debug({
      message: 'ETA updated',
      driverId,
      orderId,
      etaMinutes: eta
    });
    
  } catch (error) {
    logger.warn({
      message: 'Failed to update ETA',
      error: error.message,
      driverId,
      orderId
    });
  }
};

/**
 * Calculate ETA based on current location and destination
 */
const calculateETA = (locationData, orderId) => {
  // Simplified calculation
  // In production, use Google Maps Distance Matrix API
  const avgSpeed = locationData.speed || 30; // km/h
  const distanceToDestination = 5; // km (mock)
  const etaMinutes = (distanceToDestination / avgSpeed) * 60;
  
  return Math.round(etaMinutes);
};

/**
 * Batch write buffer (optional optimization for very high traffic)
 */
const addToBuffer = (locationData) => {
  writeBuffer.push(locationData);
  
  if (writeBuffer.length >= BUFFER_SIZE) {
    flushBuffer();
  } else if (!bufferTimeout) {
    bufferTimeout = setTimeout(flushBuffer, BUFFER_FLUSH_INTERVAL);
  }
};

/**
 * Flush write buffer to MongoDB in bulk
 */
const flushBuffer = async () => {
  if (writeBuffer.length === 0) return;
  
  const buffer = [...writeBuffer];
  writeBuffer = [];
  
  if (bufferTimeout) {
    clearTimeout(bufferTimeout);
    bufferTimeout = null;
  }
  
  try {
    await DriverLocation.bulkCreate(buffer);
    logger.info({
      message: 'Buffer flushed to MongoDB',
      count: buffer.length
    });
  } catch (error) {
    logger.error({
      message: 'Failed to flush buffer',
      error: error.message,
      bufferSize: buffer.length
    });
    
    // Re-add to buffer on failure
    writeBuffer = [...buffer, ...writeBuffer];
  }
};

/**
 * Get driver's current delivery status
 */
const getDriverDeliveryStatus = async (driverId) => {
  try {
    const activeDelivery = await redisClient.get(`driver:delivery:${driverId}`);
    return activeDelivery ? JSON.parse(activeDelivery) : null;
  } catch (error) {
    logger.error({
      message: 'Failed to get delivery status',
      error: error.message,
      driverId
    });
    return null;
  }
};

/**
 * Clean up old location data (scheduled job)
 * Keep last 7 days of location history
 */
const cleanupOldLocations = async () => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const deleted = await DriverLocation.deleteOldLocations(sevenDaysAgo);
    
    logger.info({
      message: 'Old location cleanup completed',
      deletedCount: deleted,
      olderThan: sevenDaysAgo
    });
    
    return deleted;
  } catch (error) {
    logger.error({
      message: 'Cleanup failed',
      error: error.message
    });
    return 0;
  }
};

// Run cleanup every hour
if (process.env.NODE_ENV === 'production') {
  setInterval(cleanupOldLocations, 60 * 60 * 1000);
}

module.exports = {
  storeLocation,
  updateCache,
  updateDeliveryETA,
  getDriverDeliveryStatus,
  cleanupOldLocations,
  flushBuffer
};