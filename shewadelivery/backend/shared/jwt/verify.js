 // backend/shared/logging/logger.js
const winston = require('winston');
const { format, transports } = winston;

// Custom format for console output
const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    
    return log;
  })
);

// JSON format for file output
const jsonFormat = format.combine(
  format.timestamp(),
  format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { 
    service: process.env.SERVICE_NAME || 'shewadelivery',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: []
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: consoleFormat,
    level: 'debug'
  }));
} else {
  // Production: console with JSON format
  logger.add(new transports.Console({
    format: jsonFormat,
    level: 'info'
  }));
  
  // Add file transports in production
  logger.add(new transports.File({
    filename: '/var/log/shewadelivery/error.log',
    level: 'error',
    format: jsonFormat,
    maxsize: 10485760, // 10MB
    maxFiles: 5
  }));
  
  logger.add(new transports.File({
    filename: '/var/log/shewadelivery/combined.log',
    format: jsonFormat,
    maxsize: 10485760,
    maxFiles: 5
  }));
}

/**
 * Create child logger with additional context
 */
const createChildLogger = (context) => {
  return logger.child(context);
};

/**
 * Log API request with timing
 */
const logApiRequest = (req, res, startTime) => {
  const duration = Date.now() - startTime;
  const level = res.statusCode >= 400 ? 'warn' : 'info';
  
  logger[level]({
    message: 'API Request',
    method: req.method,
    path: req.path,
    statusCode: res.statusCode,
    durationMs: duration,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: req.user?.id,
    requestId: req.id
  });
};

/**
 * Log database query
 */
const logQuery = (query, duration, error = null) => {
  const level = error ? 'error' : 'debug';
  
  logger[level]({
    message: 'Database Query',
    query: query.substring(0, 200),
    durationMs: duration,
    error: error?.message
  });
};

/**
 * Log external API call
 */
const logExternalCall = (service, endpoint, duration, error = null) => {
  const level = error ? 'error' : 'info';
  
  logger[level]({
    message: `External API Call: ${service}`,
    endpoint,
    durationMs: duration,
    error: error?.message
  });
};

/**
 * Log message with structured data
 */
const logStructured = (level, message, data = {}) => {
  logger[level]({ message, ...data });
};

/**
 * Create audit log for sensitive operations
 */
const auditLog = (action, userId, details = {}) => {
  logger.info({
    message: 'Audit Log',
    action,
    userId,
    details,
    timestamp: new Date().toISOString()
  });
};

/**
 * Get logger instance
 */
const getLogger = () => logger;

module.exports = {
  logger,
  createChildLogger,
  logApiRequest,
  logQuery,
  logExternalCall,
  logStructured,
  auditLog,
  getLogger
};
