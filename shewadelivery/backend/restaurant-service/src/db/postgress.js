// backend/restaurant-service/src/db/postgres.js
// PostgreSQL connection pool for Restaurant Service
// Handles restaurant profiles, menus, and availability data (ASR-02, ASR-08)

const { Pool } = require('pg');
const logger = require('../../../shared/logging/logger');

const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'shewadelivery',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: parseInt(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000,
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: process.env.NODE_ENV === 'production'
  } : false
};

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  logger.error({
    message: 'Unexpected PostgreSQL error in Restaurant Service',
    error: err.message,
    stack: err.stack
  });
});

pool.on('connect', () => {
  logger.info({
    message: 'Restaurant Service connected to PostgreSQL',
    host: poolConfig.host,
    database: poolConfig.database
  });
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug({
      message: 'Restaurant Service query executed',
      text: text.substring(0, 100),
      duration,
      rowCount: result.rowCount
    });
    return result;
  } catch (error) {
    logger.error({
      message: 'Restaurant Service query error',
      text: text.substring(0, 100),
      error: error.message
    });
    throw error;
  }
};

const getClient = async () => {
  const client = await pool.connect();
  const originalQuery = client.query;
  client.query = (...args) => {
    logger.debug({
      message: 'Restaurant Service transaction query',
      query: args[0]?.substring(0, 100)
    });
    return originalQuery.apply(client, args);
  };
  return client;
};

const initializeDatabase = async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS restaurants (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        name_am VARCHAR(255),
        description TEXT,
        description_am TEXT,
        cuisine_type VARCHAR(100),
        phone VARCHAR(20),
        email VARCHAR(255),
        address JSONB,
        location POINT,
        city VARCHAR(100) DEFAULT 'Addis Ababa',
        logo_url TEXT,
        cover_image_url TEXT,
        is_open BOOLEAN DEFAULT false,
        is_verified BOOLEAN DEFAULT false,
        rating DECIMAL(3, 2) DEFAULT 0.00,
        total_ratings INTEGER DEFAULT 0,
        min_order_amount DECIMAL(10, 2) DEFAULT 0,
        delivery_fee DECIMAL(10, 2) DEFAULT 0,
        delivery_time_min INTEGER DEFAULT 30,
        delivery_time_max INTEGER DEFAULT 60,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id SERIAL PRIMARY KEY,
        restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        category VARCHAR(100),
        name VARCHAR(255) NOT NULL,
        name_am VARCHAR(255),
        description TEXT,
        description_am TEXT,
        price DECIMAL(10, 2) NOT NULL,
        image_url TEXT,
        is_available BOOLEAN DEFAULT true,
        is_featured BOOLEAN DEFAULT false,
        preparation_time INTEGER DEFAULT 15,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_restaurants_city ON restaurants(city)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_restaurants_is_open ON restaurants(is_open)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_restaurants_owner_id ON restaurants(owner_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant_id ON menu_items(restaurant_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_menu_items_is_available ON menu_items(is_available)`);

    logger.info('Restaurant Service database tables initialized successfully');
  } catch (error) {
    logger.error({
      message: 'Failed to initialize Restaurant Service database',
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

const healthCheck = async () => {
  try {
    await query('SELECT 1 as health');
    return { healthy: true, message: 'Database connected', timestamp: new Date().toISOString() };
  } catch (error) {
    return { healthy: false, message: error.message, timestamp: new Date().toISOString() };
  }
};

const closePool = async () => {
  try {
    await pool.end();
    logger.info('Restaurant Service PostgreSQL pool closed');
  } catch (error) {
    logger.error({ message: 'Error closing Restaurant Service pool', error: error.message });
  }
};

initializeDatabase().catch(console.error);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing Restaurant Service PostgreSQL pool');
  closePool();
});

module.exports = { query, getClient, initializeDatabase, healthCheck, closePool, pool };