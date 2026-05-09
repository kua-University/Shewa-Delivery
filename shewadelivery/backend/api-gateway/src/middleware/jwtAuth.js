 // backend/api-gateway/src/middleware/jwtAuth.js
const jwt = require('jsonwebtoken');
const logger = require('../../../shared/logging/logger');

// Secret keys (should be in environment variables)
const JWT_SECRET = process.env.JWT_SECRET || 'shewadelivery-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'shewadelivery-refresh-secret-key';

// Cache for blacklisted tokens (using Redis in production)
let tokenBlacklist = new Map(); // Simple in-memory fallback

/**
 * Middleware: Require valid JWT token (ASR-05)
 * Returns HTTP 403 with proper error message for unauthorized access
 */
const required = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn({
        message: 'Missing or invalid Authorization header',
        path: req.path,
        ip: req.ip,
        requestId: req.id
      });
      
      return res.status(403).json({
        success: false,
        message: 'Access denied. No token provided.',
        error: 'MISSING_TOKEN',
        timestamp: new Date().toISOString()
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Check if token is blacklisted (logout or compromised)
    const isBlacklisted = await isTokenBlacklisted(token);
    if (isBlacklisted) {
      logger.warn({
        message: 'Attempt to use blacklisted token',
        path: req.path,
        ip: req.ip,
        requestId: req.id
      });
      
      return res.status(403).json({
        success: false,
        message: 'Session expired. Please login again.',
        error: 'TOKEN_BLACKLISTED',
        timestamp: new Date().toISOString()
      });
    }
    
    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      maxAge: '7d' // Maximum token age
    });
    
    // Attach user info to request object
    req.user = {
      id: decoded.userId,
      phoneNumber: decoded.phoneNumber,
      fullName: decoded.fullName,
      role: decoded.role,
      email: decoded.email,
      preferredLanguage: decoded.preferredLanguage || 'en',
      permissions: decoded.permissions || []
    };
    
    req.token = token;
    req.tokenExpiresAt = decoded.exp ? new Date(decoded.exp * 1000) : null;
    
    // Log successful authentication (for audit)
    logger.debug({
      message: 'JWT authentication successful',
      userId: req.user.id,
      role: req.user.role,
      path: req.path,
      requestId: req.id
    });
    
    next();
    
  } catch (error) {
    // Handle specific JWT errors with appropriate 403 messages (ASR-05)
    if (error.name === 'TokenExpiredError') {
      logger.warn({
        message: 'Expired token used',
        path: req.path,
        ip: req.ip,
        requestId: req.id
      });
      
      return res.status(403).json({
        success: false,
        message: 'Session expired. Please refresh your token.',
        error: 'TOKEN_EXPIRED',
        timestamp: new Date().toISOString()
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      logger.warn({
        message: 'Invalid JWT token',
        error: error.message,
        path: req.path,
        ip: req.ip,
        requestId: req.id
      });
      
      return res.status(403).json({
        success: false,
        message: 'Invalid authentication token.',
        error: 'INVALID_TOKEN',
        timestamp: new Date().toISOString()
      });
    }
    
    // Log other errors
    logger.error({
      message: 'JWT validation error',
      error: error.message,
      stack: error.stack,
      path: req.path,
      requestId: req.id
    });
    
    return res.status(403).json({
      success: false,
      message: 'Authentication failed. Please login again.',
      error: 'AUTH_FAILED',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Middleware: Optional JWT (doesn't fail if no token)
 * Used for endpoints that work with or without authentication
 */
const optional = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = {
          id: decoded.userId,
          phoneNumber: decoded.phoneNumber,
          fullName: decoded.fullName,
          role: decoded.role,
          email: decoded.email,
          preferredLanguage: decoded.preferredLanguage || 'en'
        };
        req.token = token;
      } catch (jwtError) {
        // Don't fail for optional auth, just don't set user
        logger.debug({
          message: 'Optional auth: Invalid token provided',
          error: jwtError.message,
          path: req.path
        });
      }
    }
    
    next();
    
  } catch (error) {
    // Never fail for optional auth
    next();
  }
};

/**
 * Middleware: Role-based access control
 * Must be used after required() middleware
 */
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: 'Authentication required',
        error: 'NO_USER'
      });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      logger.warn({
        message: 'Access denied - insufficient permissions',
        userId: req.user.id,
        role: req.user.role,
        requiredRoles: allowedRoles,
        path: req.path,
        requestId: req.id
      });
      
      return res.status(403).json({
        success: false,
        message: `Access denied. ${req.user.role} role does not have permission.`,
        error: 'INSUFFICIENT_PERMISSIONS',
        requiredRoles: allowedRoles,
        timestamp: new Date().toISOString()
      });
    }
    
    next();
  };
};

/**
 * Middleware: Check specific permissions (more granular than roles)
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user || !req.user.permissions) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        error: 'MISSING_PERMISSIONS'
      });
    }
    
    if (!req.user.permissions.includes(permission)) {
      logger.warn({
        message: 'Permission denied',
        userId: req.user.id,
        requiredPermission: permission,
        path: req.path
      });
      
      return res.status(403).json({
        success: false,
        message: `Permission '${permission}' required`,
        error: 'PERMISSION_DENIED'
      });
    }
    
    next();
  };
};

/**
 * Helper: Blacklist a token (on logout or security incident)
 * Should use Redis in production for persistence across restarts
 */
const blacklistToken = async (token, expiresIn = 7 * 24 * 60 * 60) => {
  try {
    const decoded = jwt.decode(token);
    const ttl = (decoded.exp || Date.now() / 1000 + expiresIn) - Math.floor(Date.now() / 1000);
    
    // In production, use Redis with TTL
    // await redisClient.setEx(`blacklist:${token}`, ttl, 'true');
    
    // Fallback to memory (not suitable for production with multiple instances)
    tokenBlacklist.set(token, {
      blacklistedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttl * 1000)
    });
    
    // Clean up old entries periodically
    if (tokenBlacklist.size > 1000) {
      cleanupBlacklist();
    }
    
    logger.info({
      message: 'Token blacklisted',
      tokenId: token.substring(0, 20) + '...',
      expiresIn: ttl
    });
    
    return true;
  } catch (error) {
    logger.error({
      message: 'Failed to blacklist token',
      error: error.message
    });
    return false;
  }
};

/**
 * Helper: Check if token is blacklisted
 */
const isTokenBlacklisted = async (token) => {
  try {
    // In production, check Redis first
    // const blacklisted = await redisClient.get(`blacklist:${token}`);
    // if (blacklisted) return true;
    
    // Fallback to memory check
    if (tokenBlacklist.has(token)) {
      const entry = tokenBlacklist.get(token);
      // Check if still valid
      if (new Date(entry.expiresAt) > new Date()) {
        return true;
      } else {
        // Expired entry, remove it
        tokenBlacklist.delete(token);
      }
    }
    
    return false;
  } catch (error) {
    logger.error({
      message: 'Error checking token blacklist',
      error: error.message
    });
    return false; // Fail open on error
  }
};

/**
 * Helper: Clean up expired blacklist entries
 */
const cleanupBlacklist = () => {
  const now = new Date();
  let cleaned = 0;
  
  for (const [token, entry] of tokenBlacklist.entries()) {
    if (new Date(entry.expiresAt) <= now) {
      tokenBlacklist.delete(token);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.debug({
      message: 'Blacklist cleanup completed',
      cleanedEntries: cleaned,
      remainingEntries: tokenBlacklist.size
    });
  }
};

// Run cleanup every hour
if (process.env.NODE_ENV === 'production') {
  setInterval(cleanupBlacklist, 60 * 60 * 1000);
}

/**
 * Helper: Generate new JWT token
 */
const generateToken = (user) => {
  const payload = {
    userId: user.id,
    phoneNumber: user.phoneNumber,
    fullName: user.fullName,
    role: user.role,
    email: user.email,
    preferredLanguage: user.preferredLanguage || 'en'
  };
  
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '7d',
    algorithm: 'HS256'
  });
};

/**
 * Helper: Generate refresh token (longer expiry)
 */
const generateRefreshToken = (user) => {
  const payload = {
    userId: user.id,
    type: 'refresh'
  };
  
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: '30d',
    algorithm: 'HS256'
  });
};

/**
 * Helper: Verify refresh token
 */
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (error) {
    throw error;
  }
};

module.exports = {
  required,
  optional,
  requireRole,
  requirePermission,
  blacklistToken,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken
};
