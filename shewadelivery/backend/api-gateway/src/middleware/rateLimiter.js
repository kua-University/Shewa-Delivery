 
// backend/api-gateway/src/middleware/rateLimiter.js
const logger = require('../../../shared/logging/logger');

// In-memory store for rate limiting (use Redis in production)
// Structure: Map<key, { count, resetTime }>
const rateLimitStore = new Map();

// Cleanup interval (runs every minute)
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, data] of rateLimitStore.entries()) {
    if (now > data.resetTime) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.debug({
      message: 'Rate limiter cleanup completed',
      cleanedEntries: cleaned,
      remainingEntries: rateLimitStore.size
    });
  }
}, 60000); // Run every minute

/**
 * Generic rate limiter factory
 * @param {Object} options - Rate limit options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.maxRequests - Maximum requests per window
 * @param {string} options.message - Custom error message
 * @param {Function} options.keyGenerator - Custom key generator function
 */
const createRateLimiter = (options) => {
  const {
    windowMs = 60000, // 1 minute default
    maxRequests = 100,
    message = 'Too many requests, please try again later.',
    keyGenerator = null
  } = options;
  
  return async (req, res, next) => {
    try {
      // Generate unique key for this request (IP + endpoint + user ID if authenticated)
      let key;
      if (keyGenerator) {
        key = await keyGenerator(req);
      } else {
        // Default: IP address + endpoint path
        const ip = req.ip || req.connection.remoteAddress;
        const endpoint = req.baseUrl + req.path;
        const userId = req.user?.id || 'anonymous';
        key = `${ip}:${endpoint}:${userId}`;
      }
      
      const now = Date.now();
      const record = rateLimitStore.get(key);
      
      // If no record exists for this key, create one
      if (!record) {
        rateLimitStore.set(key, {
          count: 1,
          resetTime: now + windowMs
        });
        
        // Add rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
        res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));
        
        return next();
      }
      
      // Check if window has expired
      if (now > record.resetTime) {
        // Reset the counter
        record.count = 1;
        record.resetTime = now + windowMs;
        
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
        res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));
        
        return next();
      }
      
      // Increment counter
      record.count++;
      const remaining = Math.max(0, maxRequests - record.count);
      
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));
      
      // Check if limit exceeded
      if (record.count > maxRequests) {
        logger.warn({
          message: 'Rate limit exceeded',
          key,
          count: record.count,
          limit: maxRequests,
          path: req.path,
          ip: req.ip,
          userId: req.user?.id
        });
        
        const retryAfter = Math.ceil((record.resetTime - now) / 1000);
        res.setHeader('Retry-After', retryAfter);
        
        return res.status(429).json({
          success: false,
          message: message,
          error: 'RATE_LIMIT_EXCEEDED',
          retryAfter: retryAfter,
          limit: maxRequests,
          windowMs: windowMs
        });
      }
      
      next();
      
    } catch (error) {
      logger.error({
        message: 'Rate limiter error',
        error: error.message,
        path: req.path
      });
      // On error, allow the request to proceed (fail open)
      next();
    }
  };
};

/**
 * Public endpoints rate limiter (strict)
 * 100 requests per minute for unauthenticated users
 */
const public = createRateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 100,
  message: 'Too many requests. Please slow down and try again in a minute.'
});

/**
 * Authenticated endpoints rate limiter (higher limits)
 * 300 requests per minute for authenticated users
 */
const authenticated = createRateLimiter({
  windowMs: 60000,
  maxRequests: 300,
  message: 'Request limit reached. Please wait before making more requests.',
  keyGenerator: (req) => {
    const userId = req.user?.id || 'unknown';
    const endpoint = req.baseUrl + req.path;
    return `auth:${userId}:${endpoint}`;
  }
});

/**
 * Auth endpoints rate limiter (very strict for login/register)
 * 10 attempts per 15 minutes to prevent brute force
 */
const auth = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,
  message: 'Too many authentication attempts. Please try again after 15 minutes.',
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress;
    const phoneNumber = req.body?.phoneNumber || 'unknown';
    return `auth-attempts:${ip}:${phoneNumber}`;
  }
});

/**
 * Order placement rate limiter (per user)
 * 30 orders per hour maximum (prevents abuse)
 */
const orders = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 30,
  message: 'Order limit reached. Maximum 30 orders per hour.',
  keyGenerator: (req) => {
    const userId = req.user?.id || 'unknown';
    return `orders:${userId}`;
  }
});

/**
 * GPS update rate limiter (per driver)
 * 120 updates per minute (2 per second max)
 */
const gpsUpdates = createRateLimiter({
  windowMs: 60000,
  maxRequests: 120,
  message: 'GPS update limit reached. Please reduce update frequency.',
  keyGenerator: (req) => {
    const driverId = req.user?.id || req.body?.driverId || 'unknown';
    return `gps:${driverId}`;
  }
});

/**
 * API key rate limiter for internal services
 * 1000 requests per minute
 */
const internalApi = createRateLimiter({
  windowMs: 60000,
  maxRequests: 1000,
  message: 'Internal API rate limit exceeded.',
  keyGenerator: (req) => {
    const apiKey = req.headers['x-api-key'] || 'unknown';
    return `internal:${apiKey}`;
  }
});

/**
 * Mobile-friendly rate limiter (more lenient for 3G retries)
 * Allows retries with backoff hints
 */
const mobileFriendly = createRateLimiter({
  windowMs: 30000, // 30 seconds
  maxRequests: 20, // 20 requests per 30 seconds
  message: 'Network limit reached. Please wait a moment before retrying.',
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'unknown';
    return `mobile:${ip}:${userAgent.substring(0, 50)}`;
  }
});

/**
 * Reset rate limit for a specific key (admin function)
 */
const resetLimit = async (key) => {
  if (rateLimitStore.has(key)) {
    rateLimitStore.delete(key);
    logger.info({
      message: 'Rate limit reset',
      key
    });
    return true;
  }
  return false;
};

/**
 * Get current rate limit status for a key
 */
const getStatus = async (key) => {
  const record = rateLimitStore.get(key);
  if (!record) {
    return {
      limited: false,
      current: 0,
      remaining: null,
      resetTime: null
    };
  }
  
  const now = Date.now();
  const limited = record.count > record.maxRequests;
  const remaining = limited ? 0 : Math.max(0, record.maxRequests - record.count);
  
  return {
    limited,
    current: record.count,
    remaining,
    resetTime: new Date(record.resetTime),
    resetInSeconds: Math.max(0, Math.ceil((record.resetTime - now) / 1000))
  };
};

module.exports = {
  public,
  authenticated,
  auth,
  orders,
  gpsUpdates,
  internalApi,
  mobileFriendly,
  createRateLimiter,
  resetLimit,
  getStatus
};