 // backend/order-service/src/services/orderService.js
const db = require('../db/postgres');
const logger = require('../../../shared/logging/logger');

/**
 * Create new order in database
 */
const createOrder = async (orderData) => {
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    // Insert order
    const orderQuery = `
      INSERT INTO orders (
        order_number, user_id, restaurant_id, status, subtotal, 
        delivery_fee, tax, total_amount, payment_method, 
        delivery_address, special_instructions, estimated_delivery_time, 
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    
    const orderValues = [
      orderData.orderNumber,
      orderData.userId,
      orderData.restaurantId,
      orderData.status,
      orderData.subtotal,
      orderData.deliveryFee,
      orderData.tax,
      orderData.totalAmount,
      orderData.paymentMethod,
      JSON.stringify(orderData.deliveryAddress),
      orderData.specialInstructions || null,
      orderData.estimatedDeliveryTime,
      orderData.createdAt,
      orderData.createdAt
    ];
    
    const orderResult = await client.query(orderQuery, orderValues);
    const order = orderResult.rows[0];
    
    // Insert order items
    for (const item of orderData.items) {
      const itemQuery = `
        INSERT INTO order_items (
          order_id, menu_item_id, name, price, quantity, 
          special_instructions, subtotal
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `;
      
      const itemValues = [
        order.id,
        item.menuItemId,
        item.name,
        item.price,
        item.quantity,
        item.specialInstructions || null,
        item.price * item.quantity
      ];
      
      await client.query(itemQuery, itemValues);
    }
    
    await client.query('COMMIT');
    
    logger.info({
      message: 'Order created in database',
      orderId: order.id,
      orderNumber: order.order_number,
      userId: orderData.userId
    });
    
    return {
      id: order.id,
      orderNumber: order.order_number,
      userId: order.user_id,
      restaurantId: order.restaurant_id,
      status: order.status,
      subtotal: parseFloat(order.subtotal),
      deliveryFee: parseFloat(order.delivery_fee),
      tax: parseFloat(order.tax),
      totalAmount: parseFloat(order.total_amount),
      paymentMethod: order.payment_method,
      deliveryAddress: order.delivery_address,
      specialInstructions: order.special_instructions,
      estimatedDeliveryTime: order.estimated_delivery_time,
      createdAt: order.created_at
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({
      message: 'Failed to create order in database',
      error: error.message,
      orderData
    });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get order by ID
 */
const getOrderById = async (orderId) => {
  try {
    const orderQuery = `
      SELECT 
        o.*,
        json_agg(json_build_object(
          'id', oi.id,
          'menuItemId', oi.menu_item_id,
          'name', oi.name,
          'price', oi.price,
          'quantity', oi.quantity,
          'subtotal', oi.subtotal,
          'specialInstructions', oi.special_instructions
        )) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.id = $1
      GROUP BY o.id
    `;
    
    const result = await db.query(orderQuery, [orderId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row = result.rows[0];
    
    return {
      id: row.id,
      orderNumber: row.order_number,
      userId: row.user_id,
      restaurantId: row.restaurant_id,
      status: row.status,
      subtotal: parseFloat(row.subtotal),
      deliveryFee: parseFloat(row.delivery_fee),
      tax: parseFloat(row.tax),
      totalAmount: parseFloat(row.total_amount),
      paymentMethod: row.payment_method,
      deliveryAddress: row.delivery_address,
      specialInstructions: row.special_instructions,
      estimatedDeliveryTime: row.estimated_delivery_time,
      items: row.items || [],
      driverId: row.driver_id,
      trackingUrl: row.tracking_url,
      transactionId: row.transaction_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      paidAt: row.paid_at,
      deliveredAt: row.delivered_at
    };
    
  } catch (error) {
    logger.error({
      message: 'Failed to fetch order',
      orderId,
      error: error.message
    });
    throw error;
  }
};

/**
 * Get user's active orders
 */
const getUserActiveOrders = async (userId) => {
  try {
    const query = `
      SELECT 
        o.*,
        json_agg(json_build_object(
          'id', oi.id,
          'name', oi.name,
          'quantity', oi.quantity,
          'price', oi.price
        )) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = $1 
        AND o.status NOT IN ('delivered', 'cancelled')
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `;
    
    const result = await db.query(query, [userId]);
    
    return result.rows.map(row => ({
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      totalAmount: parseFloat(row.total_amount),
      estimatedDeliveryTime: row.estimated_delivery_time,
      items: row.items || [],
      createdAt: row.created_at
    }));
    
  } catch (error) {
    logger.error({
      message: 'Failed to fetch user active orders',
      userId,
      error: error.message
    });
    throw error;
  }
};

/**
 * Update order status
 */
const updateOrderStatus = async (orderId, status, additionalData = {}) => {
  try {
    const updates = {
      status,
      updated_at: new Date(),
      ...additionalData
    };
    
    // Add timestamps based on status
    if (status === 'confirmed') {
      updates.confirmed_at = new Date();
    } else if (status === 'delivered') {
      updates.delivered_at = new Date();
    } else if (status === 'cancelled') {
      updates.cancelled_at = new Date();
    }
    
    const setClause = Object.keys(updates)
      .map((key, index) => `${snakeCase(key)} = $${index + 2}`)
      .join(', ');
    
    const values = [orderId, ...Object.values(updates)];
    
    const query = `
      UPDATE orders
      SET ${setClause}
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await db.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error('Order not found');
    }
    
    const row = result.rows[0];
    
    logger.info({
      message: 'Order status updated',
      orderId,
      status,
      additionalData
    });
    
    return {
      id: row.id,
      status: row.status,
      updatedAt: row.updated_at
    };
    
  } catch (error) {
    logger.error({
      message: 'Failed to update order status',
      orderId,
      status,
      error: error.message
    });
    throw error;
  }
};

/**
 * Cancel order
 */
const cancelOrder = async (orderId, reason) => {
  try {
    const query = `
      UPDATE orders
      SET status = 'cancelled', 
          cancellation_reason = $2,
          cancelled_at = $3,
          updated_at = $3
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await db.query(query, [orderId, reason, new Date()]);
    
    if (result.rows.length === 0) {
      throw new Error('Order not found');
    }
    
    const row = result.rows[0];
    
    return {
      id: row.id,
      status: row.status,
      cancellationReason: row.cancellation_reason,
      cancelledAt: row.cancelled_at
    };
    
  } catch (error) {
    logger.error({
      message: 'Failed to cancel order',
      orderId,
      error: error.message
    });
    throw error;
  }
};

/**
 * Helper: Convert camelCase to snake_case
 */
const snakeCase = (str) => {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
};

module.exports = {
  createOrder,
  getOrderById,
  getUserActiveOrders,
  updateOrderStatus,
  cancelOrder
};
