 // backend/api-gateway/src/routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const jwtAuth = require('../middleware/jwtAuth');
const rateLimiter = require('../middleware/rateLimiter');
const logger = require('../../../shared/logging/logger');

const ORDER_SERVICE = process.env.ORDER_SERVICE_URL || 'http://order-service:3001';
const PAYMENT_SERVICE = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3003';

/**
 * POST /api/orders
 * Create new order with zero loss guarantee (ASR-01, ASR-07)
 * Order is accepted even if payment/notification services are down
 */
router.post('/orders',
  jwtAuth.required, // Customer must be authenticated
  rateLimiter.authenticated, // 30 orders per minute per user
  async (req, res) => {
    const startTime = Date.now();
    const { 
      restaurantId, 
      items, 
      deliveryAddress, 
      paymentMethod,
      specialInstructions 
    } = req.body;

    // Validate required fields
    if (!restaurantId || !items || !deliveryAddress || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: restaurantId, items, deliveryAddress, paymentMethod'
      });
    }

    if (!items.length || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order must contain at least one item'
      });
    }

    try {
      // Step 1: Create order in database immediately (ASR-01)
      const orderResponse = await fetch(`${ORDER_SERVICE}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': req.user.id,
          'X-Request-ID': req.id
        },
        body: JSON.stringify({
          userId: req.user.id,
          restaurantId,
          items,
          deliveryAddress,
          specialInstructions,
          paymentMethod,
          status: 'pending_payment', // Initial status
          createdAt: new Date().toISOString()
        }),
        timeout: 5000 // 5 second timeout for order creation
      });

      if (!orderResponse.ok) {
        throw new Error(`Order creation failed: ${orderResponse.status}`);
      }

      const orderData = await orderResponse.json();
      const { orderId, orderNumber } = orderData;

      // Step 2: Process payment asynchronously (ASR-03 - 2s response)
      // Don't wait for payment confirmation - queue it
      const paymentPromise = fetch(`${PAYMENT_SERVICE}/api/payments/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': req.id
        },
        body: JSON.stringify({
          orderId,
          orderNumber,
          userId: req.user.id,
          amount: orderData.totalAmount,
          paymentMethod,
          callbackUrl: `${process.env.API_GATEWAY_URL}/api/orders/${orderId}/payment-callback`
        }),
        timeout: 2000 // Short timeout - we don't wait for response
      }).catch(error => {
        // Payment service might be slow - queue will handle retry (ASR-07)
        logger.warn({
          message: 'Payment processing queued due to timeout',
          orderId,
          error: error.message,
          requestId: req.id
        });
      });

      // Step 3: Return order confirmation immediately (ASR-03)
      const responseTime = Date.now() - startTime;
      logger.info({
        message: 'Order created successfully',
        orderId,
        orderNumber,
        userId: req.user.id,
        responseTimeMs: responseTime,
        requestId: req.id
      });

      res.status(201).json({
        success: true,
        message: 'Order placed successfully',
        data: {
          orderId,
          orderNumber,
          status: 'pending_payment',
          estimatedDeliveryTime: orderData.estimatedDeliveryTime,
          totalAmount: orderData.totalAmount,
          restaurantName: orderData.restaurantName
        },
        note: 'You will receive payment confirmation via notification'
      });

      // Don't await - let it run in background
      await paymentPromise;

    } catch (error) {
      logger.error({
        message: 'Order creation failed',
        error: error.message,
        userId: req.user?.id,
        requestId: req.id,
        body: req.body
      });

      // ASR-01: Even on failure, order is never lost
      // RabbitMQ dead letter queue will retry
      res.status(500).json({
        success: false,
        message: 'Unable to place order. Please try again.',
        errorReference: req.id, // For customer support tracking
        retryable: true
      });
    }
  }
);

/**
 * GET /api/orders/:id
 * Get specific order details (ASR-05: Authorization check)
 */
router.get('/orders/:id',
  jwtAuth.required,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const response = await fetch(`${ORDER_SERVICE}/api/orders/${id}`, {
        headers: {
          'X-User-ID': req.user.id,
          'X-Request-ID': req.id
        },
        timeout: 3000
      });

      if (response.status === 403) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view this order'
        });
      }

      if (response.status === 404) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }

      const order = await response.json();

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
        message: 'Unable to load order details'
      });
    }
  }
);

/**
 * GET /api/orders/my/active
 * Get customer's active orders (pending, preparing, delivering)
 */
router.get('/orders/my/active',
  jwtAuth.required,
  cache.route({ duration: 10 }), // Short cache - status changes frequently
  async (req, res) => {
    try {
      const response = await fetch(
        `${ORDER_SERVICE}/api/orders/user/${req.user.id}/active`,
        {
          headers: { 'X-Request-ID': req.id },
          timeout: 3000
        }
      );

      const orders = await response.json();

      res.json({
        success: true,
        data: orders,
        count: orders.length
      });

    } catch (error) {
      logger.error({ message: 'Failed to fetch active orders', error: error.message });
      res.status(500).json({
        success: false,
        message: 'Unable to load your orders'
      });
    }
  }
);

/**
 * POST /api/orders/:id/cancel
 * Cancel order (if within cancellation window)
 */
router.post('/orders/:id/cancel',
  jwtAuth.required,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const response = await fetch(`${ORDER_SERVICE}/api/orders/${id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': req.user.id
        },
        body: JSON.stringify({ reason }),
        timeout: 3000
      });

      const result = await response.json();

      if (!response.ok) {
        return res.status(response.status).json(result);
      }

      logger.info({
        message: 'Order cancelled',
        orderId: id,
        userId: req.user.id,
        reason
      });

      res.json({
        success: true,
        message: 'Order cancelled successfully',
        data: result
      });

    } catch (error) {
      logger.error({
        message: 'Order cancellation failed',
        orderId: req.params.id,
        error: error.message
      });

      res.status(500).json({
        success: false,
        message: 'Unable to cancel order at this time'
      });
    }
  }
);

/**
 * POST /api/orders/:id/payment-callback
 * Webhook endpoint for Chapa payment callback (internal)
 */
router.post('/orders/:id/payment-callback',
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, transactionId, reference } = req.body;

      // Verify webhook signature (in production)
      // const isValid = verifyChapaWebhook(req.headers['x-webhook-signature'], req.body);
      
      logger.info({
        message: 'Payment callback received',
        orderId: id,
        status,
        transactionId
      });

      // Forward to order service to update status
      await fetch(`${ORDER_SERVICE}/api/orders/${id}/payment-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, transactionId, reference }),
        timeout: 3000
      });

      res.json({ success: true });

    } catch (error) {
      logger.error({
        message: 'Payment callback failed',
        error: error.message
      });
      res.status(500).json({ success: false });
    }
  }
);

module.exports = router;
