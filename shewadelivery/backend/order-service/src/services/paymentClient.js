 
// backend/order-service/src/services/paymentClient.js
const axios = require('axios');
const logger = require('../../../shared/logging/logger');
const rabbitmqProducer = require('../queues/rabbitmqProducer');

// Chapa API configuration
const CHAPA_API_KEY = process.env.CHAPA_API_KEY;
const CHAPA_API_URL = process.env.CHAPA_API_URL || 'https://api.chapa.co/v1';
const CHAPA_TIMEOUT = parseInt(process.env.CHAPA_TIMEOUT) || 10000; // 10 seconds (ASR-03, ASR-06)

/**
 * Process payment through Chapa (ASR-06: PCI-DSS compliant)
 */
const processPayment = async (paymentData) => {
  const {
    orderId,
    orderNumber,
    userId,
    amount,
    paymentMethod,
    callbackUrl,
    isRetry = false
  } = paymentData;

  try {
    logger.info({
      message: isRetry ? 'Retrying payment' : 'Processing payment',
      orderId,
      orderNumber,
      amount,
      paymentMethod
    });

    // Prepare payment payload for Chapa
    const payload = {
      amount: amount.toString(),
      currency: 'ETB',
      email: paymentData.email || 'customer@shewadelivery.com',
      first_name: paymentData.firstName || 'Customer',
      last_name: paymentData.lastName || '',
      phone_number: paymentData.phoneNumber,
      tx_ref: `${orderNumber}-${Date.now()}`,
      callback_url: callbackUrl,
      return_url: `${process.env.FRONTEND_URL}/order/${orderId}/status`,
      customization: {
        title: 'ShewaDelivery Order Payment',
        description: `Payment for order ${orderNumber}`,
        logo: 'https://shewadelivery.com/logo.png'
      },
      meta: {
        order_id: orderId,
        order_number: orderNumber,
        user_id: userId
      }
    };

    // Make request to Chapa API with timeout (ASR-03)
    const response = await axios.post(
      `${CHAPA_API_URL}/transaction/initialize`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${CHAPA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: CHAPA_TIMEOUT
      }
    );

    if (response.data.status === 'success') {
      logger.info({
        message: 'Payment initialized successfully',
        orderId,
        transactionRef: response.data.data.tx_ref,
        checkoutUrl: response.data.data.checkout_url
      });

      // Store payment reference in database
      await storePaymentReference(orderId, response.data.data.tx_ref);

      // Queue webhook check (ASR-07)
      await rabbitmqProducer.publishPaymentWebhook({
        orderId,
        transactionRef: response.data.data.tx_ref,
        retryCount: isRetry ? 1 : 0
      });

      return {
        success: true,
        transactionRef: response.data.data.tx_ref,
        checkoutUrl: response.data.data.checkout_url,
        requiresRedirect: true
      };
    } else {
      throw new Error('Chapa initialization failed: ' + response.data.message);
    }

  } catch (error) {
    // Handle timeout (ASR-03)
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      logger.error({
        message: 'Payment service timeout',
        orderId,
        timeoutMs: CHAPA_TIMEOUT
      });

      // Queue for retry (ASR-01: zero loss)
      await rabbitmqProducer.publishRetryPayment({
        orderId,
        paymentData,
        retryAfter: 30 // seconds
      });

      throw new Error('Payment service timeout - queued for retry');
    }

    // Handle other errors
    logger.error({
      message: 'Payment processing failed',
      orderId,
      error: error.response?.data || error.message,
      statusCode: error.response?.status
    });

    // Queue for retry (ASR-07)
    await rabbitmqProducer.publishRetryPayment({
      orderId,
      paymentData,
      retryAfter: 60,
      errorMessage: error.message
    });

    throw error;
  }
};

/**
 * Verify payment status with Chapa
 */
const verifyPayment = async (transactionRef) => {
  try {
    const response = await axios.get(
      `${CHAPA_API_URL}/transaction/verify/${transactionRef}`,
      {
        headers: {
          'Authorization': `Bearer ${CHAPA_API_KEY}`
        },
        timeout: 5000
      }
    );

    if (response.data.status === 'success') {
      const payment = response.data.data;
      
      return {
        success: true,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        transactionId: payment.transaction_id,
        paymentMethod: payment.payment_method,
        paidAt: payment.paid_at
      };
    }

    return {
      success: false,
      status: 'failed',
      message: response.data.message
    };

  } catch (error) {
    logger.error({
      message: 'Payment verification failed',
      transactionRef,
      error: error.message
    });

    return {
      success: false,
      status: 'unknown',
      error: error.message
    };
  }
};

/**
 * Store payment reference in database
 */
const storePaymentReference = async (orderId, transactionRef) => {
  try {
    // Implementation depends on your database
    logger.info({
      message: 'Payment reference stored',
      orderId,
      transactionRef
    });
  } catch (error) {
    logger.error({
      message: 'Failed to store payment reference',
      error: error.message
    });
  }
};

/**
 * Refund payment (for cancelled orders)
 */
const refundPayment = async (orderId, transactionId, amount, reason) => {
  try {
    const response = await axios.post(
      `${CHAPA_API_URL}/transaction/refund`,
      {
        transaction_id: transactionId,
        amount: amount.toString(),
        reason: reason
      },
      {
        headers: {
          'Authorization': `Bearer ${CHAPA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    if (response.data.status === 'success') {
      logger.info({
        message: 'Payment refunded successfully',
        orderId,
        transactionId,
        amount
      });

      return {
        success: true,
        refundId: response.data.data.refund_id,
        refundedAt: new Date()
      };
    }

    throw new Error('Refund failed: ' + response.data.message);

  } catch (error) {
    logger.error({
      message: 'Payment refund failed',
      orderId,
      transactionId,
      error: error.message
    });

    throw error;
  }
};

module.exports = {
  processPayment,
  verifyPayment,
  refundPayment
};