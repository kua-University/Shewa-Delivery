 // backend/payment-service/src/db/postgres.js
const { Pool } = require('pg');
const logger = require('../../../shared/logging/logger');

const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'shewadelivery',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: parseInt(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  
  // SSL for PCI-DSS compliance (ASR-06)
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: true,
    ca: process.env.DB_SSL_CA,
    cert: process.env.DB_SSL_CERT,
    key: process.env.DB_SSL_KEY
  } : false
};

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  logger.error({
    message: 'Unexpected PostgreSQL error',
    error: err.message
  });
});

const query = async (text, params) => {
  const start = Date.now();
  
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    if (duration > 1000) {
      logger.warn({
        message: 'Slow query detected',
        text: text.substring(0, 100),
        duration
      });
    }
    
    return result;
  } catch (error) {
    logger.error({
      message: 'Query error',
      text: text.substring(0, 100),
      error: error.message
    });
    throw error;
  }
};

const initializeDatabase = async () => {
  try {
    // Create payment_transactions table (PCI-DSS compliant)
    await query(`
      CREATE TABLE IF NOT EXISTS payment_transactions (
        id SERIAL PRIMARY KEY,
        transaction_ref VARCHAR(100) UNIQUE NOT NULL,
        order_id INTEGER NOT NULL,
        order_number VARCHAR(20) NOT NULL,
        user_id INTEGER NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'ETB',
        payment_method VARCHAR(50),
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        customer_email VARCHAR(255),
        customer_name VARCHAR(255),
        customer_phone VARCHAR(50),
        provider_reference VARCHAR(100),
        provider_transaction_id VARCHAR(100),
        checkout_url TEXT,
        expires_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP,
        failed_at TIMESTAMP,
        error_message TEXT,
        refunded BOOLEAN DEFAULT FALSE,
        refund_amount DECIMAL(10, 2),
        refund_reason TEXT,
        refund_id VARCHAR(100),
        refunded_at TIMESTAMP,
        metadata JSONB
      )
    `);
    
    // Create indexes
    await query(`CREATE INDEX IF NOT EXISTS idx_payment_transaction_ref ON payment_transactions(transaction_ref)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_payment_order_id ON payment_transactions(order_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_payment_user_id ON payment_transactions(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_payment_status ON payment_transactions(status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_payment_created_at ON payment_transactions(created_at)`);
    
    logger.info('Payment Service database initialized');
    
  } catch (error) {
    logger.error({
      message: 'Database initialization failed',
      error: error.message
    });
    throw error;
  }
};

const healthCheck = async () => {
  try {
    await query('SELECT 1');
    return { healthy: true };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
};

const closePool = async () => {
  await pool.end();
};

module.exports = {
  query,
  initializeDatabase,
  healthCheck,
  closePool
};