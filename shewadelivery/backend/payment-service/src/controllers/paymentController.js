 
// backend/payment-service/src/controllers/paymentController.js
const chapaClient = require('../services/chapaClient');
const PaymentTransaction = require('../models/PaymentTransaction');
const logger = require('../../../shared/logging/logger');
const crypto = require('crypto');

/**
 * Initialize payment (ASR-06: PCI-DSS compliant)
 * No raw card data stored - only tokens
 */
const initializePayment = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const {
      orderId,
      orderNumber,
      userId,
      amount,
      currency = 'ETB',
      paymentMethod,
      customerEmail,
      customerName,
      customerPhone,
      callbackUrl,
      returnUrl
    } = req.body;

    // Validate required fields
    if (!orderId || !orderNumber || !userId || !amount || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Missing required payment fields',
        required: ['orderId', 'orderNumber', 'userId', 'amount', 'paymentMethod']
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment amount'
      });
    }

    // Generate unique transaction reference
    const transactionRef = generateTransactionRef(orderNumber);

    // Create payment transaction record (ASR-06: no sensitive data)
    const transaction = await PaymentTransaction.create({
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
      status: 'pending',
      createdAt: new Date()
    });

    logger.info({
      message: 'Payment transaction created',
      transactionId: transaction.id,
      transactionRef,
      orderId,
      userId,
      amount
    });

    // Initialize payment with Chapa (ASR-06: HTTPS/TLS 1.3)
    const chapaResponse = await chapaClient.initializePayment({
      transactionRef,
      orderId,
      orderNumber,
      amount,
      currency,
      customerEmail: customerEmail || `user${userId}@shewadelivery.com`,
      customerName: customerName || 'ShewaDelivery Customer',
      customerPhone: customerPhone || 'N/A',
      callbackUrl: callbackUrl || `${process.env.API_GATEWAY_URL}/api/payments/callback`,
      returnUrl: returnUrl || `${process.env.FRONTEND_URL}/order/${orderId}/status`
    });

    if (!chapaResponse.success) {
      // Update transaction as failed
      await PaymentTransaction.updateStatus(transaction.id, 'failed', {
        errorMessage: chapaResponse.message,
        failedAt: new Date()
      });

      return res.status(400).json({
        success: false,
        message: 'Payment initialization failed',
        error: chapaResponse.message
      });
    }

    // Update transaction with Chapa data
    await PaymentTransaction.update(transaction.id, {
      checkoutUrl: chapaResponse.checkoutUrl,
      providerReference: chapaResponse.transactionRef,
      expiresAt: chapaResponse.expiresAt
    });

    const responseTime = Date.now() - startTime;
    logger.info({
      message: 'Payment initialized successfully',
      transactionId: transaction.id,
      transactionRef,
      checkoutUrl: chapaResponse.checkoutUrl,
      responseTimeMs: responseTime
    });

    res.json({
      success: true,
      message: 'Payment initialized',
      data: {
        transactionId: transaction.id,
        transactionRef,
        checkoutUrl: chapaResponse.checkoutUrl,
        expiresAt: chapaResponse.expiresAt,
        amount,
        currency
      }
    });

  } catch (error) {
    logger.error({
      message: 'Payment initialization failed',
      error: error.message,
      stack: error.stack,
      orderId: req.body?.orderId
    });

    res.status(500).json({
      success: false,
      message: 'Unable to initialize payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Verify payment status (webhook callback)
 * ASR-06: Secure webhook verification
 */
const verifyPayment = async (req, res) => {
  try {
    const { transactionRef, status, transactionId, paymentData } = req.body;

    // Verify webhook signature (ASR-06: security)
    const signature = req.headers['x-chapa-signature'];
    if (!verifyWebhookSignature(signature, req.body)) {
      logger.warn({
        message: 'Invalid webhook signature',
        transactionRef,
        signature
      });
      return res.status(401).json({
        success: false,
        message: 'Invalid webhook signature'
      });
    }

    logger.info({
      message: 'Payment webhook received',
      transactionRef,
      status,
      transactionId
    });

    // Find transaction
    const transaction = await PaymentTransaction.findByRef(transactionRef);
    
    if (!transaction) {
      logger.error({
        message: 'Transaction not found',
        transactionRef
      });
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Prevent double processing
    if (transaction.status !== 'pending') {
      logger.warn({
        message: 'Transaction already processed',
        transactionRef,
        currentStatus: transaction.status
      });
      return res.json({
        success: true,
        message: 'Transaction already processed',
        status: transaction.status
      });
    }

    // Update transaction based on payment status
    if (status === 'success') {
      await PaymentTransaction.updateStatus(transaction.id, 'completed', {
        providerTransactionId: transactionId,
        paymentData: paymentData,
        completedAt: new Date()
      });

      logger.info({
        message: 'Payment completed successfully',
        transactionId: transaction.id,
        transactionRef,
        providerTransactionId: transactionId
      });

      // Notify order service (ASR-01: zero order loss)
      await notifyOrderService(transaction.orderId, 'success', transactionId);

    } else if (status === 'failed') {
      await PaymentTransaction.updateStatus(transaction.id, 'failed', {
        errorMessage: paymentData?.error || 'Payment failed',
        failedAt: new Date()
      });

      logger.warn({
        message: 'Payment failed',
        transactionId: transaction.id,
        transactionRef,
        error: paymentData?.error
      });

      // Notify order service of failure
      await notifyOrderService(transaction.orderId, 'failed', null, paymentData?.error);

    } else if (status === 'pending') {
      // Still pending - do nothing
      logger.debug({
        message: 'Payment still pending',
        transactionRef
      });
    }

    res.json({
      success: true,
      message: 'Webhook processed successfully'
    });

  } catch (error) {
    logger.error({
      message: 'Payment verification failed',
      error: error.message,
      body: req.body
    });

    res.status(500).json({
      success: false,
      message: 'Webhook processing failed'
    });
  }
};

/**
 * Check payment status (polling endpoint)
 */
const checkPaymentStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transaction = await PaymentTransaction.findById(transactionId);
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // For pending transactions, verify with provider (ASR-07: retry logic)
    if (transaction.status === 'pending') {
      const verification = await chapaClient.verifyPayment(transaction.transactionRef);
      
      if (verification.success && verification.status === 'success') {
        // Update to completed
        await PaymentTransaction.updateStatus(transaction.id, 'completed', {
          providerTransactionId: verification.transactionId,
          completedAt: new Date()
        });
        
        transaction.status = 'completed';
      } else if (verification.status === 'failed') {
        await PaymentTransaction.updateStatus(transaction.id, 'failed', {
          errorMessage: verification.error,
          failedAt: new Date()
        });
        
        transaction.status = 'failed';
      }
    }

    res.json({
      success: true,
      data: {
        transactionId: transaction.id,
        transactionRef: transaction.transactionRef,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        paymentMethod: transaction.paymentMethod,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt,
        expiresAt: transaction.expiresAt
      }
    });

  } catch (error) {
    logger.error({
      message: 'Status check failed',
      error: error.message,
      transactionId: req.params.transactionId
    });

    res.status(500).json({
      success: false,
      message: 'Unable to check payment status'
    });
  }
};

/**
 * Refund payment
 */
const refundPayment = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { reason, amount } = req.body;

    const transaction = await PaymentTransaction.findById(transactionId);
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    if (transaction.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: `Cannot refund payment with status: ${transaction.status}`
      });
    }

    if (transaction.refunded) {
      return res.status(400).json({
        success: false,
        message: 'Payment already refunded'
      });
    }

    const refundAmount = amount || transaction.amount;
    
    // Process refund with Chapa
    const refund = await chapaClient.refundPayment(
      transaction.providerTransactionId,
      refundAmount,
      reason
    );

    if (!refund.success) {
      return res.status(400).json({
        success: false,
        message: 'Refund failed',
        error: refund.message
      });
    }

    // Update transaction
    await PaymentTransaction.update(transaction.id, {
      refunded: true,
      refundAmount: refundAmount,
      refundReason: reason,
      refundId: refund.refundId,
      refundedAt: new Date()
    });

    logger.info({
      message: 'Payment refunded',
      transactionId: transaction.id,
      refundAmount,
      reason
    });

    res.json({
      success: true,
      message: 'Payment refunded successfully',
      data: {
        transactionId: transaction.id,
        refundId: refund.refundId,
        refundAmount,
        refundedAt: new Date()
      }
    });

  } catch (error) {
    logger.error({
      message: 'Refund failed',
      error: error.message,
      transactionId: req.params.transactionId
    });

    res.status(500).json({
      success: false,
      message: 'Unable to process refund'
    });
  }
};

/**
 * Get transaction details (for audit)
 */
const getTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    const transaction = await PaymentTransaction.findById(transactionId);
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Authorization: only user, admin, or order service can view
    if (transaction.userId !== parseInt(userId) && 
        userRole !== 'admin' && 
        userRole !== 'order_service') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Return safe data (no sensitive info)
    res.json({
      success: true,
      data: {
        id: transaction.id,
        transactionRef: transaction.transactionRef,
        orderId: transaction.orderId,
        orderNumber: transaction.orderNumber,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        paymentMethod: transaction.paymentMethod,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt,
        expiresAt: transaction.expiresAt,
        refunded: transaction.refunded,
        refundAmount: transaction.refundAmount
      }
    });

  } catch (error) {
    logger.error({
      message: 'Failed to get transaction',
      error: error.message,
      transactionId: req.params.transactionId
    });

    res.status(500).json({
      success: false,
      message: 'Unable to fetch transaction'
    });
  }
};

/**
 * Generate unique transaction reference
 */
const generateTransactionRef = (orderNumber) => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `CHAPA-${orderNumber}-${timestamp}-${random}`;
};

/**
 * Verify webhook signature (ASR-06: security)
 */
const verifyWebhookSignature = (signature, payload) => {
  if (!signature || !process.env.CHAPA_WEBHOOK_SECRET) {
    return false;
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', process.env.CHAPA_WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

/**
 * Notify order service about payment status
 */
const notifyOrderService = async (orderId, status, transactionId, error = null) => {
  try {
    const orderServiceUrl = process.env.ORDER_SERVICE_URL || 'http://order-service:3001';
    
    const response = await fetch(`${orderServiceUrl}/api/orders/${orderId}/payment-callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': process.env.INTERNAL_API_KEY
      },
      body: JSON.stringify({
        status,
        transactionId,
        error,
        timestamp: new Date().toISOString()
      }),
      timeout: 5000
    });

    if (!response.ok) {
      logger.error({
        message: 'Failed to notify order service',
        orderId,
        status,
        responseStatus: response.status
      });
    }

  } catch (error) {
    logger.error({
      message: 'Error notifying order service',
      orderId,
      error: error.message
    });
  }
};

module.exports = {
  initializePayment,
  verifyPayment,
  checkPaymentStatus,
  refundPayment,
  getTransaction
};