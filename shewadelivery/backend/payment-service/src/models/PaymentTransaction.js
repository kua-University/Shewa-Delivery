 // backend/payment-service/src/models/PaymentTransaction.js
const db = require('../db/postgres');
const logger = require('../../../shared/logging/logger');

/**
 * Payment Transaction Model
 * ASR-06: No sensitive card data stored - only tokens and references
 */
class PaymentTransaction {
  /**
   * Create a new payment transaction
   */
  static async create(transactionData) {
    const {
      transactionRef,
      orderId,
      orderNumber,
      userId,
      amount,
      currency,
      paymentMethod,
      customerEmail,
      customerName,
      customerPhone,
      status = 'pending',
      metadata = {}
    } = transactionData;

    const query = `
      INSERT INTO payment_transactions (
        transaction_ref, order_id, order_number, user_id,
        amount, currency, payment_method, status,
        customer_email, customer_name, customer_phone,
        metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    const values = [
      transactionRef,
      orderId,
      orderNumber,
      userId,
      amount,
      currency,
      paymentMethod,
      status,
      customerEmail || null,
      customerName || null,
      customerPhone || null,
      JSON.stringify(metadata),
      new Date(),
      new Date()
    ];

    const result = await db.query(query, values);
    
    logger.info({
      message: 'Payment transaction created',
      transactionId: result.rows[0].id,
      transactionRef,
      orderId,
      userId
    });

    return this.formatTransaction(result.rows[0]);
  }

  /**
   * Find transaction by ID
   */
  static async findById(id) {
    const query = `
      SELECT * FROM payment_transactions 
      WHERE id = $1
    `;
    const result = await db.query(query, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.formatTransaction(result.rows[0]);
  }

  /**
   * Find transaction by reference
   */
  static async findByRef(transactionRef) {
    const query = `
      SELECT * FROM payment_transactions 
      WHERE transaction_ref = $1
    `;
    const result = await db.query(query, [transactionRef]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.formatTransaction(result.rows[0]);
  }

  /**
   * Find transactions by order ID
   */
  static async findByOrderId(orderId) {
    const query = `
      SELECT * FROM payment_transactions 
      WHERE order_id = $1
      ORDER BY created_at DESC
    `;
    const result = await db.query(query, [orderId]);
    
    return result.rows.map(row => this.formatTransaction(row));
  }

  /**
   * Find transactions by user ID
   */
  static async findByUserId(userId, limit = 50, offset = 0) {
    const query = `
      SELECT * FROM payment_transactions 
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await db.query(query, [userId, limit, offset]);
    
    return result.rows.map(row => this.formatTransaction(row));
  }

  /**
   * Update transaction status
   */
  static async updateStatus(id, status, additionalData = {}) {
    const updates = {
      status,
      updated_at: new Date(),
      ...additionalData
    };
    
    const setClause = Object.keys(updates)
      .map((key, index) => `${this.toSnakeCase(key)} = $${index + 2}`)
      .join(', ');
    
    const values = [id, ...Object.values(updates)];
    
    const query = `
      UPDATE payment_transactions
      SET ${setClause}
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await db.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error('Transaction not found');
    }
    
    logger.info({
      message: 'Transaction status updated',
      transactionId: id,
      status,
      additionalData
    });
    
    return this.formatTransaction(result.rows[0]);
  }

  /**
   * Generic update method
   */
  static async update(id, data) {
    const updates = {
      ...data,
      updated_at: new Date()
    };
    
    const setClause = Object.keys(updates)
      .map((key, index) => `${this.toSnakeCase(key)} = $${index + 2}`)
      .join(', ');
    
    const values = [id, ...Object.values(updates)];
    
    const query = `
      UPDATE payment_transactions
      SET ${setClause}
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await db.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error('Transaction not found');
    }
    
    return this.formatTransaction(result.rows[0]);
  }

  /**
   * Get transaction statistics for a user
   */
  static async getUserStats(userId) {
    const query = `
      SELECT 
        COUNT(*) as total_transactions,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful_transactions,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_transactions,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_transactions,
        SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_spent,
        COUNT(DISTINCT order_id) as total_orders
      FROM payment_transactions
      WHERE user_id = $1
    `;
    
    const result = await db.query(query, [userId]);
    
    return {
      totalTransactions: parseInt(result.rows[0].total_transactions),
      successfulTransactions: parseInt(result.rows[0].successful_transactions),
      failedTransactions: parseInt(result.rows[0].failed_transactions),
      pendingTransactions: parseInt(result.rows[0].pending_transactions),
      totalSpent: parseFloat(result.rows[0].total_spent || 0),
      totalOrders: parseInt(result.rows[0].total_orders)
    };
  }

  /**
   * Format transaction object (remove sensitive data)
   */
  static formatTransaction(row) {
    return {
      id: row.id,
      transactionRef: row.transaction_ref,
      orderId: row.order_id,
      orderNumber: row.order_number,
      userId: row.user_id,
      amount: parseFloat(row.amount),
      currency: row.currency,
      paymentMethod: row.payment_method,
      status: row.status,
      customerEmail: row.customer_email,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      providerReference: row.provider_reference,
      providerTransactionId: row.provider_transaction_id,
      checkoutUrl: row.checkout_url,
      expiresAt: row.expires_at,
      metadata: row.metadata,
      errorMessage: row.error_message,
      refunded: row.refunded || false,
      refundAmount: row.refund_amount ? parseFloat(row.refund_amount) : null,
      refundReason: row.refund_reason,
      refundId: row.refund_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      failedAt: row.failed_at,
      refundedAt: row.refunded_at
    };
  }

  /**
   * Convert camelCase to snake_case
   */
  static toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

/**
 * Database schema (for reference)
 */
const PaymentTransactionSchema = {
  tableName: 'payment_transactions',
  
  createTableSQL: `
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
      
      -- Customer info (no sensitive data)
      customer_email VARCHAR(255),
      customer_name VARCHAR(255),
      customer_phone VARCHAR(50),
      
      -- Provider data (tokens only, ASR-06)
      provider_reference VARCHAR(100),
      provider_transaction_id VARCHAR(100),
      checkout_url TEXT,
      
      -- Timestamps
      expires_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP,
      failed_at TIMESTAMP,
      
      -- Error handling
      error_message TEXT,
      
      -- Refund data
      refunded BOOLEAN DEFAULT FALSE,
      refund_amount DECIMAL(10, 2),
      refund_reason TEXT,
      refund_id VARCHAR(100),
      refunded_at TIMESTAMP,
      
      -- Metadata (JSON)
      metadata JSONB,
      
      -- Indexes
      INDEX idx_payment_transactions_transaction_ref (transaction_ref),
      INDEX idx_payment_transactions_order_id (order_id),
      INDEX idx_payment_transactions_user_id (user_id),
      INDEX idx_payment_transactions_status (status),
      INDEX idx_payment_transactions_created_at (created_at)
    )
  `
};

module.exports = PaymentTransaction;
