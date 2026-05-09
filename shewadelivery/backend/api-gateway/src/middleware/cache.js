 // backend/api-gateway/src/middleware/cache.js
const redis = require('redis');
const crypto = require('crypto');
const logger = require('../../../shared/logging/logger');

// Redis client configuration
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD,
  socket: {
    reconnectStrategy: (retries) => {
      // Exponential backoff: 100ms, 200ms, 400ms, ...
      const delay = Math.min(100 * Math.pow(2, retries), 30000);
      logger.warn({
        message: 'Redis reconnecting',
        attempt: retries,
        delayMs: delay
      });
      return delay;
    },
    timeout: 5000 // 5 second timeout
  }
});

// Track if Redis is connected
let isRedisConnected = false;
let connectionAttempts = 0;

// Redis event handlers
redisClient.on('connect', () => {
  isRedisConnected = true;
  connectionAttempts = 0;
  logger.info({
    message: 'Redis connected successfully',
    url: process.env.REDIS_URL?.replace(/\/\/.*@/, '//***@') // Hide credentials
  });
});

redisClient.on('error', (error) => {
  isRedisConnected = false;
  connectionAttempts++;
  logger.error({
    message: 'Redis connection error',
    error: error.message,
    attempt: connectionAttempts
  });
});

redisClient.on('end', () => {
  isRedisConnected = false;
  logger.warn('Redis connection closed');
});

// Connect to Redis
(async () => {
  try {
    await redisClient.connect();
  } catch (error) {
    logger.error({
      message: 'Failed to connect to Redis on startup',
      error: error.message
    });
    // Continue without cache - app will fallback to direct DB queries
  }
})();

/**
 * Generate cache key from request
 */
const generateCacheKey = (req, prefix = 'api') => {
  const parts = [
    prefix,
    req.method,
    req.baseUrl + req.path,
    JSON.stringify(req.query), // Include query params
    req.user?.id || 'anonymous' // User-specific cache when needed
  ];
  
  // Create hash to keep keys reasonably sized
  const keyString = parts.join(':');
  const hash = crypto.createHash('md5').update(keyString).digest('hex');
  
  // Return shortened key with prefix for easy browsing in Redis
  return `${prefix}:${req.method}:${hash.substring(0, 16)}`;
};

/**
 * Route caching middleware
 * Caches GET responses to reduce database load (ASR-02)
 */
const route = (options = {}) => {
  const {
    duration = 300, // 5 minutes default
    prefix = 'route',
    conditional = null, // Optional function to determine if cache should be used
    keyGenerator = null // Custom key generator
  } = options;
  
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }
    
    // Check conditional (e.g., don't cache for admin users)
    if (conditional && !conditional(req)) {
      return next();
    }
    
    // Skip cache if Redis is not available
    if (!isRedisConnected) {
      logger.debug({
        message: 'Cache skipped - Redis unavailable',
        path: req.path
      });
      return next();
    }
    
    // Generate cache key
    const cacheKey = keyGenerator 
      ? keyGenerator(req)
      : generateCacheKey(req, prefix);
    
    try {
      // Try to get from cache
      const cachedData = await redisClient.get(cacheKey);
      
      if (cachedData) {
        // Cache hit - return cached response
        const data = JSON.parse(cachedData);
        
        logger.debug({
          message: 'Cache HIT',
          key: cacheKey,
          path: req.path,
          userId: req.user?.id
        });
        
        // Mark that this was a cache hit (for response headers)
        req.cacheHit = true;
        
        // Add cache headers
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-TTL', duration);
        
        // Return cached response
        return res.status(200).json(data);
      }
      
      // Cache miss - continue to route handler
      logger.debug({
        message: 'Cache MISS',
        key: cacheKey,
        path: req.path
      });
      
      req.cacheHit = false;
      res.setHeader('X-Cache', 'MISS');
      
      // Store the original send function
      const originalSend = res.json;
      
      // Override json method to cache the response
      res.json = function(body) {
        // Only cache successful responses
        if (res.statusCode === 200 && body.success !== false) {
          // Store in cache
          redisClient.setEx(cacheKey, duration, JSON.stringify(body))
            .then(() => {
              logger.debug({
                message: 'Response cached',
                key: cacheKey,
                duration: duration,
                path: req.path
              });
            })
            .catch((error) => {
              logger.error({
                message: 'Failed to cache response',
                error: error.message,
                key: cacheKey
              });
            });
        }
        
        // Call original send function
        originalSend.call(this, body);
      };
      
      next();
      
    } catch (error) {
      logger.error({
        message: 'Cache middleware error',
        error: error.message,
        path: req.path,
        key: cacheKey
      });
      
      // On error, continue without cache (fail open)
      req.cacheHit = false;
      next();
    }
  };
};

/**
 * Invalidate cache by pattern
 * Useful when data changes (e.g., after order placement)
 */
const invalidatePattern = async (pattern) => {
  if (!isRedisConnected) {
    logger.warn({
      message: 'Cannot invalidate cache - Redis unavailable',
      pattern
    });
    return 0;
  }
  
  try {
    let deletedCount = 0;
    let cursor = 0;
    
    do {
      // Scan for keys matching pattern
      const reply = await redisClient.scan(cursor, {
        MATCH: pattern,
        COUNT: 100
      });
      
      cursor = reply.cursor;
      const keys = reply.keys;
      
      if (keys.length > 0) {
        // Delete keys in batch
        const deleted = await redisClient.del(keys);
        deletedCount += deleted;
      }
      
    } while (cursor !== 0);
    
    logger.info({
      message: 'Cache invalidated by pattern',
      pattern,
      deletedCount
    });
    
    return deletedCount;
    
  } catch (error) {
    logger.error({
      message: 'Failed to invalidate cache pattern',
      error: error.message,
      pattern
    });
    return 0;
  }
};

/**
 * Invalidate specific cache keys
 */
const invalidateKeys = async (keys) => {
  if (!isRedisConnected) {
    logger.warn('Cannot invalidate keys - Redis unavailable');
    return 0;
  }
  
  try {
    const deleted = await redisClient.del(keys);
    logger.debug({
      message: 'Cache keys invalidated',
      keys: keys,
      deletedCount: deleted
    });
    return deleted;
  } catch (error) {
    logger.error({
      message: 'Failed to invalidate cache keys',
      error: error.message
    });
    return 0;
  }
};

/**
 * Cache for user-specific data (with user ID in key)
 */
const userSpecific = (duration = 300) => {
  return route({
    duration,
    prefix: 'user',
    keyGenerator: (req) => {
      const userId = req.user?.id || 'anonymous';
      return `user:${userId}:${req.method}:${req.baseUrl + req.path}:${JSON.stringify(req.query)}`;
    }
  });
};

/**
 * Short cache for frequently changing data (e.g., driver locations)
 */
const short = (duration = 10) => {
  return route({
    duration,
    prefix: 'short'
  });
};

/**
 * Long cache for rarely changing data (e.g., restaurant menus)
 */
const long = (duration = 3600) => {
  return route({
    duration,
    prefix: 'long'
  });
};

/**
 * Clear entire cache (admin function - use with caution)
 */
const clearAll = async () => {
  if (!isRedisConnected) {
    return false;
  }
  
  try {
    await redisClient.flushAll();
    logger.warn({
      message: 'Entire Redis cache cleared',
      timestamp: new Date().toISOString()
    });
    return true;
  } catch (error) {
    logger.error({
      message: 'Failed to clear cache',
      error: error.message
    });
    return false;
  }
};

/**
 * Get cache stats (for monitoring)
 */
const getStats = async () => {
  if (!isRedisConnected) {
    return {
      connected: false,
      error: 'Redis not connected'
    };
  }
  
  try {
    const info = await redisClient.info();
    const memory = await redisClient.info('memory');
    
    return {
      connected: true,
      uptime: process.uptime(),
      redisInfo: {
        usedMemory: memory.match(/used_memory_human: (.+)/)?.[1] || 'N/A',
        totalConnections: info.match(/total_connections_received: (\d+)/)?.[1] || 'N/A',
        totalCommands: info.match(/total_commands_processed: (\d+)/)?.[1] || 'N/A'
      }
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message
    };
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Closing Redis connection...');
  if (redisClient) {
    await redisClient.quit();
  }
});

module.exports = {
  route,
  userSpecific,
  short,
  long,
  invalidatePattern,
  invalidateKeys,
  clearAll,
  getStats,
  redisClient, // Export for direct use if needed
  isRedisConnected: () => isRedisConnected
};
