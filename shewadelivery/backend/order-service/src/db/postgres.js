 // backend/order-service/src/db/postgres.js
const { Pool } = require('pg');
const logger = require('../../../shared/logging/logger');

// PostgreSQL connection configuration
const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'shewadelivery',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: parseInt(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000,
  
  // SSL configuration for production
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: process.env.NODE_ENV === 'production'
  } : false
};

// Create connection pool
const pool = new Pool(poolConfig);

// Connection error handling
pool.on('error', (err) => {
  logger.error({
    message: 'Unexpected PostgreSQL error',
    error: err.message,
    stack: err.stack
  });
});

pool.on('connect', () => {
  logger.info({
    message: 'PostgreSQL connected',
    host: poolConfig.host,
    database: poolConfig.database
  });
});

/**
 * Execute query with automatic connection handling
 */
const query = async (text, params) => {
  const start = Date.now();
  
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    logger.debug({
      message: 'Query executed',
      text: text.substring(0, 100), // Log first 100 chars
      duration,
      rowCount: result.rowCount
    });
    
    return result;
  } catch (error) {
    logger.error({
      message: 'Query error',
      text: text.substring(0, 100),
      error: error.message,
      params: params ? JSON.stringify(params).substring(0, 200) : undefined
    });
    throw error;
  }
};

/**
 * Get a client from the pool for transactions
 */
const getClient = async () => {
  const client = await pool.connect();
  const originalQuery = client.query;
  
  // Add logging to client queries
  client.query = (...args) => {
    logger.debug({
      message: 'Transaction query executed',
      query: args[0]?.substring(0, 100)
    });
    return originalQuery.apply(client, args);
  };
  
  return client;
};

/**
 * Initialize database (create tables if not exists)
 */
const initializeDatabase = async () => {
  try {
    // Create orders table
    await query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_number VARCHAR(20) UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        restaurant_id INTEGER NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending_payment',
        subtotal DECIMAL(10, 2) NOT NULL,
        delivery_fee DECIMAL(10, 2) NOT NULL,
        tax DECIMAL(10, 2) NOT NULL,
        total_amount DECIMAL(10, 2) NOT NULL,
        payment_method VARCHAR(50),
        transaction_id VARCHAR(100),
        payment_reference VARCHAR(100),
        delivery_address JSONB,
        special_instructions TEXT,
        driver_id INTEGER,
        tracking_url TEXT,
        estimated_delivery_time TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        confirmed_at TIMESTAMP,
        paid_at TIMESTAMP,
        delivered_at TIMESTAMP,
        cancelled_at TIMESTAMP,
        cancellation_reason TEXT
      )
    `);
    
    // Create order_items table
    await query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        menu_item_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        quantity INTEGER NOT NULL,
        subtotal DECIMAL(10, 2) NOT NULL,
        special_instructions TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    
    // Create indexes for performance
    await query(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_orders_restaurant_id ON orders(restaurant_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`);
    
    logger.info('Database tables initialized successfully');
    
  } catch (error) {
    logger.error({
      message: 'Failed to initialize database',
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Check database health
 */
const healthCheck = async () => {
  try {
    const result = await query('SELECT 1 as health');
    return {
      healthy: true,
      message: 'Database connected',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      healthy: false,
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

/**
 * Close all connections
 */
const closePool = async () => {
  try {
    await pool.end();
    logger.info('PostgreSQL pool closed');
  } catch (error) {
    logger.error({
      message: 'Error closing PostgreSQL pool',
      error: error.message
    });
  }
};

// Initialize database on module load
initializeDatabase().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing PostgreSQL pool');
  closePool();
});

module.exports = {
  query,
  getClient,
  initializeDatabase,
  healthCheck,
  closePool,
  pool
};
