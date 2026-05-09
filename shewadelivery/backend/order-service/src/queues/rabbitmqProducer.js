// backend/order-service/src/models/Order.js
const db = require('../db/postgres');

/**
 * Order model schema (for reference)
 * Actual schema should be created via migrations
 */
const OrderSchema = {
  tableName: 'orders',
  
  // SQL creation script
  createTableSQL: `
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
      cancellation_reason TEXT,
      
      -- Indexes for performance
      INDEX idx_orders_user_id (user_id),
      INDEX idx_orders_restaurant_id (restaurant_id),
      INDEX idx_orders_status (status),
      INDEX idx_orders_order_number (order_number),
      INDEX idx_orders_created_at (created_at)
    )
  `,
  
  // Order items table
  createOrderItemsTableSQL: `
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal DECIMAL(10, 2) NOT NULL,
      special_instructions TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      
      INDEX idx_order_items_order_id (order_id)
    )
  `
};

/**
 * Order model methods
 */
class Order {
  /**
   * Find order by ID
   */
  static async findById(id) {
    const query = `
      SELECT o.*, 
             json_agg(oi.*) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.id = $1
      GROUP BY o.id
    `;
    const result = await db.query(query, [id]);
    return result.rows[0];
  }
  
  /**
   * Find order by order number
   */
  static async findByOrderNumber(orderNumber) {
    const query = `
      SELECT o.*, 
             json_agg(oi.*) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.order_number = $1
      GROUP BY o.id
    `;
    const result = await db.query(query, [orderNumber]);
    return result.rows[0];
  }
  
  /**
   * Find orders by user ID
   */
  static async findByUserId(userId, limit = 50, offset = 0) {
    const query = `
      SELECT o.*, 
             json_agg(oi.*) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await db.query(query, [userId, limit, offset]);
    return result.rows;
  }
  
  /**
   * Update order status
   */
  static async updateStatus(id, status, additionalData = {}) {
    const updates = {
      status,
      updated_at: new Date(),
      ...additionalData
    };
    
    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');
    
    const values = [id, ...Object.values(updates)];
    
    const query = `
      UPDATE orders
      SET ${setClause}
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await db.query(query, values);
    return result.rows[0];
  }
}

module.exports = {
  OrderSchema,
  Order
};