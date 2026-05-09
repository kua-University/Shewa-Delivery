 
// backend/api-gateway/src/config/redis.js
const redis = require('redis');
const logger = require('../../../shared/logging/logger');

/**
 * Redis Configuration for ShewaDelivery
 * Handles caching, sessions, and real-time data
 * ASR-02: Performance - 200ms cached responses
 * ASR-03: Mobile-first - Session management for 3G networks
 */

// Redis connection configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB) || 0,
  
  // Connection options
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    logger.warn({
      message: 'Redis connection retry',
      attempt: times,
      delayMs: delay
    });
    return delay;
  },
  
  // Reconnect on close
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNREFUSED'];
    const shouldReconnect = targetErrors.some(targetError => 
      err.message.includes(targetError)
    );
    
    if (shouldReconnect) {
      logger.warn({
        message: 'Redis error, attempting reconnect',
        error: err.message
      });
      return true;
    }
    
    return false;
  },
  
  // Timeout settings
  connectTimeout: 10000, // 10 seconds
  commandTimeout: 5000,   // 5 seconds
  
  // Keep alive
  keepAlive: 30000, // 30 seconds
  
  // TLS/SSL for production
  tls: process.env.REDIS_TLS === 'true' ? {
    rejectUnauthorized: process.env.NODE_ENV === 'production'
  } : undefined
};

// Create Redis client
const redisClient = redis.createClient(redisConfig);

// Connection state tracking
let isReady = false;
let lastError = null;

/**
 * Redis event handlers
 */
redisClient.on('connect', () => {
  logger.info({
    message: 'Redis client connecting',
    host: redisConfig.host,
    port: redisConfig.port
  });
});

redisClient.on('ready', () => {
  isReady = true;
  lastError = null;
  logger.info({
    message: 'Redis connected and ready',
    host: redisConfig.host,
    port: redisConfig.port,
    db: redisConfig.db
  });
});

redisClient.on('error', (error) => {
  isReady = false;
  lastError = error;
  logger.error({
    message: 'Redis connection error',
    error: error.message,
    code: error.code,
    host: redisConfig.host
  });
});

redisClient.on('end', () => {
  isReady = false;
  logger.warn({
    message: 'Redis connection closed',
    host: redisConfig.host
  });
});

redisClient.on('reconnecting', () => {
  logger.info({
    message: 'Redis reconnecting',
    host: redisConfig.host
  });
});

// Initialize connection
(async () => {
  try {
    await redisClient.connect();
  } catch (error) {
    logger.error({
      message: 'Failed to initialize Redis connection',
      error: error.message,
      stack: error.stack
    });
    // Don't crash the app - cache will be disabled
  }
})();

/**
 * Cache TTL configurations (in seconds)
 * Based on ASR requirements
 */
const CACHE_TTL = {
  // ASR-02: Restaurant menus (5 minutes)
  MENU: parseInt(process.env.CACHE_TTL_MENU) || 300,
  
  // Restaurant lists (5 minutes)
  RESTAURANT_LIST: parseInt(process.env.CACHE_TTL_RESTAURANT_LIST) || 300,
  
  // User sessions (7 days)
  SESSION: parseInt(process.env.CACHE_TTL_SESSION) || 7 * 24 * 3600,
  
  // Driver locations (2 seconds - real-time)
  DRIVER_LOCATION: parseInt(process.env.CACHE_TTL_DRIVER_LOCATION) || 2,
  
  // Order status (10 seconds)
  ORDER_STATUS: parseInt(process.env.CACHE_TTL_ORDER_STATUS) || 10,
  
  // Product catalog (1 hour for static data)
  PRODUCT_CATALOG: parseInt(process.env.CACHE_TTL_PRODUCT_CATALOG) || 3600,
  
  // User profile (15 minutes)
  USER_PROFILE: parseInt(process.env.CACHE_TTL_USER_PROFILE) || 900,
  
  // Price calculations (1 minute)
  PRICE_CALCULATION: parseInt(process.env.CACHE_TTL_PRICE) || 60,
  
  // GPS coordinate batches (30 seconds)
  GPS_BATCH: parseInt(process.env.CACHE_TTL_GPS) || 30,
  
  // Rate limit counters (1 minute)
  RATE_LIMIT: 60,
  
  // OTP codes (5 minutes)
  OTP: 300,
  
  // JWT blacklist (7 days)
  TOKEN_BLACKLIST: 7 * 24 * 3600
};

/**
 * Cache key prefixes for organization
 */
const CACHE_PREFIX = {
  MENU: 'menu',
  RESTAURANT: 'rest',
  USER_SESSION: 'session',
  DRIVER_LOC: 'driver_loc',
  ORDER: 'order',
  PRODUCT: 'product',
  USER: 'user',
  PRICE: 'price',
  GPS: 'gps',
  RATE_LIMIT: 'ratelimit',
  OTP: 'otp',
  TOKEN_BLACKLIST: 'token_bl',
  GEO: 'geo',
  CITY_CONFIG: 'city',
  PROMO: 'promo'
};

/**
 * Helper: Check if Redis is ready
 */
const isRedisReady = () => {
  return isReady && redisClient && redisClient.isReady;
};

/**
 * Helper: Get cached value with automatic JSON parsing
 */
const get = async (key) => {
  if (!isRedisReady()) {
    logger.debug({
      message: 'Cache get skipped - Redis not ready',
      key
    });
    return null;
  }
  
  try {
    const value = await redisClient.get(key);
    if (!value) return null;
    
    // Attempt to parse JSON
    try {
      return JSON.parse(value);
    } catch (parseError) {
      // Return raw string if not JSON
      return value;
    }
  } catch (error) {
    logger.error({
      message: 'Redis get error',
      error: error.message,
      key
    });
    return null;
  }
};

/**
 * Helper: Set cached value with TTL
 */
const set = async (key, value, ttl = CACHE_TTL.MENU) => {
  if (!isRedisReady()) {
    logger.debug({
      message: 'Cache set skipped - Redis not ready',
      key
    });
    return false;
  }
  
  try {
    const stringValue = typeof value === 'string' 
      ? value 
      : JSON.stringify(value);
    
    await redisClient.setEx(key, ttl, stringValue);
    
    logger.debug({
      message: 'Cache set successful',
      key,
      ttl,
      valueSize: stringValue.length
    });
    
    return true;
  } catch (error) {
    logger.error({
      message: 'Redis set error',
      error: error.message,
      key
    });
    return false;
  }
};

/**
 * Helper: Delete cached value
 */
const del = async (key) => {
  if (!isRedisReady()) return false;
  
  try {
    const deleted = await redisClient.del(key);
    if (deleted > 0) {
      logger.debug({
        message: 'Cache deleted',
        key
      });
    }
    return deleted > 0;
  } catch (error) {
    logger.error({
      message: 'Redis del error',
      error: error.message,
      key
    });
    return false;
  }
};

/**
 * Helper: Delete multiple keys by pattern
 */
const delPattern = async (pattern) => {
  if (!isRedisReady()) return 0;
  
  try {
    let deletedCount = 0;
    let cursor = 0;
    
    do {
      const reply = await redisClient.scan(cursor, {
        MATCH: pattern,
        COUNT: 100
      });
      
      cursor = reply.cursor;
      const keys = reply.keys;
      
      if (keys.length > 0) {
        const deleted = await redisClient.del(keys);
        deletedCount += deleted;
      }
    } while (cursor !== 0);
    
    logger.info({
      message: 'Cache pattern deletion completed',
      pattern,
      deletedCount
    });
    
    return deletedCount;
  } catch (error) {
    logger.error({
      message: 'Redis delPattern error',
      error: error.message,
      pattern
    });
    return 0;
  }
};

/**
 * Helper: Check if key exists
 */
const exists = async (key) => {
  if (!isRedisReady()) return false;
  
  try {
    return await redisClient.exists(key) === 1;
  } catch (error) {
    logger.error({
      message: 'Redis exists error',
      error: error.message,
      key
    });
    return false;
  }
};

/**
 * Helper: Get TTL of key in seconds
 */
const getTTL = async (key) => {
  if (!isRedisReady()) return -2;
  
  try {
    return await redisClient.ttl(key);
  } catch (error) {
    logger.error({
      message: 'Redis ttl error',
      error: error.message,
      key
    });
    return -2;
  }
};

/**
 * Helper: Increment counter (for rate limiting)
 */
const incr = async (key, ttl = CACHE_TTL.RATE_LIMIT) => {
  if (!isRedisReady()) return null;
  
  try {
    const count = await redisClient.incr(key);
    
    // Set TTL on first increment
    if (count === 1) {
      await redisClient.expire(key, ttl);
    }
    
    return count;
  } catch (error) {
    logger.error({
      message: 'Redis incr error',
      error: error.message,
      key
    });
    return null;
  }
};

/**
 * Helper: Set hash field
 */
const hset = async (key, field, value) => {
  if (!isRedisReady()) return false;
  
  try {
    const stringValue = typeof value === 'string' 
      ? value 
      : JSON.stringify(value);
    
    await redisClient.hSet(key, field, stringValue);
    return true;
  } catch (error) {
    logger.error({
      message: 'Redis hset error',
      error: error.message,
      key,
      field
    });
    return false;
  }
};

/**
 * Helper: Get hash field
 */
const hget = async (key, field) => {
  if (!isRedisReady()) return null;
  
  try {
    const value = await redisClient.hGet(key, field);
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (error) {
    logger.error({
      message: 'Redis hget error',
      error: error.message,
      key,
      field
    });
    return null;
  }
};

/**
 * Helper: Get all hash fields
 */
const hgetall = async (key) => {
  if (!isRedisReady()) return {};
  
  try {
    const data = await redisClient.hGetAll(key);
    
    // Parse JSON values
    const parsed = {};
    for (const [field, value] of Object.entries(data)) {
      try {
        parsed[field] = JSON.parse(value);
      } catch {
        parsed[field] = value;
      }
    }
    
    return parsed;
  } catch (error) {
    logger.error({
      message: 'Redis hgetall error',
      error: error.message,
      key
    });
    return {};
  }
};

/**
 * Helper: Add to sorted set (for geospatial queries)
 */
const geoAdd = async (key, longitude, latitude, member) => {
  if (!isRedisReady()) return false;
  
  try {
    await redisClient.geoAdd(key, {
      longitude,
      latitude,
      member
    });
    return true;
  } catch (error) {
    logger.error({
      message: 'Redis geoAdd error',
      error: error.message,
      key
    });
    return false;
  }
};

/**
 * Helper: Get geo radius (for nearby drivers)
 */
const geoRadius = async (key, longitude, latitude, radius, unit = 'km') => {
  if (!isRedisReady()) return [];
  
  try {
    const results = await redisClient.geoRadius(key, {
      longitude,
      latitude,
      radius,
      unit
    });
    
    return results;
  } catch (error) {
    logger.error({
      message: 'Redis geoRadius error',
      error: error.message,
      key
    });
    return [];
  }
};

/**
 * Helper: Set with expiration and conditional (SET NX/XX)
 */
const setWithCondition = async (key, value, ttl, condition = 'NX') => {
  if (!isRedisReady()) return false;
  
  try {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    
    const result = await redisClient.set(key, stringValue, {
      [condition]: true,
      EX: ttl
    });
    
    return result === 'OK';
  } catch (error) {
    logger.error({
      message: 'Redis setWithCondition error',
      error: error.message,
      key
    });
    return false;
  }
};

/**
 * Get cache statistics
 */
const getStats = async () => {
  if (!isRedisReady()) {
    return {
      ready: false,
      error: lastError?.message || 'Redis not ready',
      uptime: 0
    };
  }
  
  try {
    const info = await redisClient.info();
    
    return {
      ready: true,
      uptime: process.uptime(),
      redisUptime: info.match(/uptime_in_seconds:(\d+)/)?.[1] || 'N/A',
      usedMemory: info.match(/used_memory_human:([^\r\n]+)/)?.[1] || 'N/A',
      totalConnections: info.match(/total_connections_received:(\d+)/)?.[1] || 'N/A',
      totalCommands: info.match(/total_commands_processed:(\d+)/)?.[1] || 'N/A',
      hitRate: info.match(/keyspace_hits:(\d+)/)?.[1] && 
                info.match(/keyspace_misses:(\d+)/)?.[1]
                ? (parseInt(info.match(/keyspace_hits:(\d+)/)[1]) / 
                   (parseInt(info.match(/keyspace_hits:(\d+)/)[1]) + 
                    parseInt(info.match(/keyspace_misses:(\d+)/)[1])) * 100).toFixed(2)
                : 'N/A'
    };
  } catch (error) {
    return {
      ready: true,
      error: error.message
    };
  }
};

/**
 * Graceful shutdown
 */
const gracefulShutdown = async () => {
  if (redisClient) {
    logger.info('Closing Redis connection gracefully...');
    await redisClient.quit();
  }
};

// Register shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = {
  // Client instance
  client: redisClient,
  
  // Configuration
  config: redisConfig,
  CACHE_TTL,
  CACHE_PREFIX,
  
  // Connection status
  isReady: isRedisReady,
  
  // Basic operations
  get,
  set,
  del,
  delPattern,
  exists,
  getTTL,
  incr,
  
  // Hash operations
  hset,
  hget,
  hgetall,
  
  // Geospatial operations (for driver locations)
  geoAdd,
  geoRadius,
  
  // Advanced operations
  setWithCondition,
  
  // Utilities
  getStats,
  gracefulShutdown
};