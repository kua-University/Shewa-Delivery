// backend/auth-service/src/db/postgres.js
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
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
  
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: true
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

const getClient = async () => {
  return await pool.connect();
};

const initializeDatabase = async () => {
  try {
    // Create users table
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        phone_number VARCHAR(20) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE,
        role VARCHAR(50) NOT NULL DEFAULT 'customer',
        preferred_language VARCHAR(10) DEFAULT 'en',
        is_phone_verified BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        profile_image TEXT,
        password_reset_token VARCHAR(255),
        password_reset_expires TIMESTAMP,
        last_login_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    
    // Create refresh_tokens table
    await query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(500) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        revoked BOOLEAN DEFAULT FALSE,
        revoked_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    
    // Create indexes
    await query(`CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(password_reset_token)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at)`);
    
    // Create admin user if not exists (for development)
    const adminCheck = await query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    
    if (adminCheck.rows.length === 0 && process.env.NODE_ENV !== 'production') {
      const hashedPassword = await bcrypt.hash('Admin@123', 12);
      
      await query(`
        INSERT INTO users (phone_number, password_hash, full_name, email, role, is_phone_verified)
        VALUES ('+251911111111', $1, 'System Admin', 'admin@shewadelivery.com', 'admin', true)
      `, [hashedPassword]);
      
      logger.info('Admin user created for development');
    }
    
    logger.info('Auth Service database initialized');
    
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
  getClient,
  initializeDatabase,
  healthCheck,
  closePool
};
