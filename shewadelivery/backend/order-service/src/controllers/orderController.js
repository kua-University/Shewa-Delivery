// backend/order-service/src/controllers/orderController.js
const orderService = require('../services/orderService');
const paymentClient = require('../services/paymentClient');
const rabbitmqProducer = require('../queues/rabbitmqProducer');
const logger = require('../../../shared/logging/logger');

/**
 * Create new order (ASR-01: Zero order loss)
 */
const createOrder = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const {
      userId,
      restaurantId,
      items,
      deliveryAddress,
      specialInstructions,
      paymentMethod,
      status = 'pending_payment'
    } = req.body;

    // Validate required fields
    if (!userId || !restaurantId || !items || !deliveryAddress || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        required: ['userId', 'restaurantId', 'items', 'deliveryAddress', 'paymentMethod']
      });
    }

    if (!items.length || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order must contain at least one item'
      });
    }

    // Calculate order totals
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const deliveryFee = calculateDeliveryFee(deliveryAddress.distance);
    const tax = subtotal * 0.02; // 2% tax
    const totalAmount = subtotal + deliveryFee + tax;

    // Generate unique order number
    const orderNumber = generateOrderNumber();

    // Create order in database (immediate persistence - ASR-01)
    const order = await orderService.createOrder({
      orderNumber,
      userId,
      restaurantId,
      items,
      deliveryAddress,
      specialInstructions,
      paymentMethod,
      subtotal,
      deliveryFee,
      tax,
      totalAmount,
      status,
      createdAt: new Date(),
      estimatedDeliveryTime: calculateEstimatedDeliveryTime(deliveryAddress.distance)
    });

    // Queue payment processing (async - ASR-03)
    paymentClient.processPayment({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId,
      amount: totalAmount,
      paymentMethod,
      callbackUrl: `${process.env.API_GATEWAY_URL}/api/orders/${order.id}/payment-callback`
    }).catch(error => {
      // Don't fail order creation if payment processing fails
      // RabbitMQ will retry (ASR-07)
      logger.error({
        message: 'Payment processing queued with error',
        orderId: order.id,
        error: error.message
      });
    });

    // Queue notification (ASR-07)
    await rabbitmqProducer.publishNotification({
      type: 'ORDER_CREATED',
      userId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      data: {
        restaurantName: order.restaurantName,
        totalAmount,
        estimatedDeliveryTime: order.estimatedDeliveryTime
      }
    });

    const responseTime = Date.now() - startTime;
    logger.info({
      message: 'Order created successfully',
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId,
      totalAmount,
      responseTimeMs: responseTime
    });

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalAmount: order.totalAmount,
        estimatedDeliveryTime: order.estimatedDeliveryTime,
        createdAt: order.createdAt
      }
    });

  } catch (error) {
    logger.error({
      message: 'Failed to create order',
      error: error.message,
      stack: error.stack,
      userId: req.body?.userId
    });

    res.status(500).json({
      success: false,
      message: 'Unable to create order. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get order by ID with authorization check
 */
const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.headers['x-user-id'];

    const order = await orderService.getOrderById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Authorization check (ASR-05)
    if (order.userId !== userId && !isAuthorizedUser(req.headers['x-user-role'], order)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this order'
      });
    }

    res.json({
      success: true,
      data: order
    });

  } catch (error) {
    logger.error({
      message: 'Failed to fetch order',
      orderId: req.params.id,
      error: error.message
    });

    res.status(500).json({
      success: false,
      message: 'Unable to fetch order details'
    });
  }
};

/**
 * Get user's active orders
 */
const getUserActiveOrders = async (req, res) => {
  try {
    const { userId } = req.params;
    const requestingUserId = req.headers['x-user-id'];

    // Authorization check
    if (userId !== requestingUserId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const orders = await orderService.getUserActiveOrders(userId);

    res.json({
      success: true,
      data: orders,
      count: orders.length
    });

  } catch (error) {
    logger.error({
      message: 'Failed to fetch active orders',
      userId: req.params.userId,
      error: error.message
    });

    res.status(500).json({
      success: false,
      message: 'Unable to fetch orders'
    });
  }
};

/**
 * Update order status (internal endpoint)
 */
const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, driverId, trackingUrl } = req.body;

    const validStatuses = ['pending_payment', 'confirmed', 'preparing', 'ready', 'delivering', 'delivered', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const order = await orderService.updateOrderStatus(id, status, { driverId, trackingUrl });

    // Queue notification for status change
    await rabbitmqProducer.publishNotification({
      type: 'ORDER_STATUS_UPDATED',
      userId: order.userId,
      orderId: order.id,
      data: {
        status: order.status,
        previousStatus: status,
        updatedAt: new Date()
      }
    });

    logger.info({
      message: 'Order status updated',
      orderId: id,
      previousStatus: order.status,
      newStatus: status
    });

    res.json({
      success: true,
      message: 'Order status updated',
      data: order
    });

  } catch (error) {
    logger.error({
      message: 'Failed to update order status',
      orderId: req.params.id,
      error: error.message
    });

    res.status(500).json({
      success: false,
      message: 'Unable to update order status'
    });
  }
};

/**
 * Cancel order
 */
const cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.headers['x-user-id'];

    const order = await orderService.getOrderById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if order can be cancelled (only pending or confirmed orders)
    if (!['pending_payment', 'confirmed'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel order in ${order.status} status`
      });
    }

    // Authorization check
    if (order.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only cancel your own orders'
      });
    }

    const cancelledOrder = await orderService.cancelOrder(id, reason);

    // Queue notification for cancellation
    await rabbitmqProducer.publishNotification({
      type: 'ORDER_CANCELLED',
      userId: order.userId,
      orderId: order.id,
      data: {
        reason,
        cancelledAt: new Date()
      }
    });

    logger.info({
      message: 'Order cancelled',
      orderId: id,
      userId,
      reason
    });

    res.json({
      success: true,
      message: 'Order cancelled successfully',
      data: cancelledOrder
    });

  } catch (error) {
    logger.error({
      message: 'Failed to cancel order',
      orderId: req.params.id,
      error: error.message
    });

    res.status(500).json({
      success: false,
      message: 'Unable to cancel order'
    });
  }
};

/**
 * Handle payment callback from payment service
 */
const handlePaymentCallback = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, transactionId, reference, paymentMethod } = req.body;

    logger.info({
      message: 'Payment callback received',
      orderId: id,
      status,
      transactionId
    });

    if (status === 'success') {
      // Update order status to confirmed
      await orderService.updateOrderStatus(id, 'confirmed', {
        transactionId,
        paymentReference: reference,
        paymentMethod,
        paidAt: new Date()
      });

      // Queue success notification
      await rabbitmqProducer.publishNotification({
        type: 'PAYMENT_SUCCESS',
        orderId: id,
        data: {
          transactionId,
          amount: req.body.amount
        }
      });

    } else if (status === 'failed') {
      // Update order status to payment_failed
      await orderService.updateOrderStatus(id, 'payment_failed', {
        transactionId,
        paymentError: req.body.error,
        failedAt: new Date()
      });

      // Queue failure notification - will retry (ASR-07)
      await rabbitmqProducer.publishNotification({
        type: 'PAYMENT_FAILED',
        orderId: id,
        data: {
          transactionId,
          error: req.body.error,
          retryable: true
        }
      });

      // Retry payment (ASR-01: zero loss)
      setTimeout(async () => {
        await retryFailedPayment(id);
      }, 60000); // Retry after 1 minute
    }

    res.json({ success: true });

  } catch (error) {
    logger.error({
      message: 'Payment callback processing failed',
      orderId: req.params.id,
      error: error.message
    });

    res.status(500).json({ success: false });
  }
};

/**
 * Helper: Calculate delivery fee based on distance
 */
const calculateDeliveryFee = (distanceKm) => {
  const baseFee = 30; // 30 ETB
  const perKmFee = 10; // 10 ETB per km
  return baseFee + (distanceKm * perKmFee);
};

/**
 * Helper: Generate unique order number
 */
const generateOrderNumber = () => {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `SW-${timestamp}-${random}`;
};

/**
 * Helper: Calculate estimated delivery time
 */
const calculateEstimatedDeliveryTime = (distanceKm) => {
  const baseTime = 30; // 30 minutes base
  const travelTime = Math.ceil(distanceKm * 5); // 5 minutes per km
  const totalMinutes = baseTime + travelTime;
  
  const estimatedTime = new Date();
  estimatedTime.setMinutes(estimatedTime.getMinutes() + totalMinutes);
  
  return estimatedTime;
};

/**
 * Helper: Check if user is authorized to view order
 */
const isAuthorizedUser = (userRole, order) => {
  const authorizedRoles = ['admin', 'restaurant_owner', 'driver'];
  return authorizedRoles.includes(userRole);
};

/**
 * Helper: Retry failed payment (ASR-01)
 */
const retryFailedPayment = async (orderId) => {
  try {
    const order = await orderService.getOrderById(orderId);
    
    if (order.status === 'payment_failed') {
      logger.info({
        message: 'Retrying failed payment',
        orderId,
        orderNumber: order.orderNumber
      });

      await paymentClient.processPayment({
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        amount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        isRetry: true
      });
    }
  } catch (error) {
    logger.error({
      message: 'Payment retry failed',
      orderId,
      error: error.message
    });
  }
};

module.exports = {
  createOrder,
  getOrderById,
  getUserActiveOrders,
  updateOrderStatus,
  cancelOrder,
  handlePaymentCallback
}; 
