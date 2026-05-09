 
// backend/payment-service/src/services/chapaClient.js
const axios = require('axios');
const https = require('https');
const logger = require('../../../shared/logging/logger');

// Chapa configuration (ASR-06: TLS 1.3 enforcement)
const CHAPA_API_KEY = process.env.CHAPA_API_KEY;
const CHAPA_API_URL = process.env.CHAPA_API_URL || 'https://api.chapa.co/v1';
const CHAPA_TIMEOUT = parseInt(process.env.CHAPA_TIMEOUT) || 15000;
const CHAPA_RETRY_COUNT = parseInt(process.env.CHAPA_RETRY_COUNT) || 3;
const CHAPA_RETRY_DELAY = parseInt(process.env.CHAPA_RETRY_DELAY) || 1000;

// Create HTTPS agent with TLS 1.3 (ASR-06)
const httpsAgent = new https.Agent({
  secureOptions: crypto.constants.SSL_OP_NO_TLSv1 | crypto.constants.SSL_OP_NO_TLSv1_1,
  minVersion: 'TLSv1.3',
  maxVersion: 'TLSv1.3',
  rejectUnauthorized: true,
  keepAlive: true,
  keepAliveMsecs: 10000
});

// Axios instance with TLS 1.3
const chapaAxios = axios.create({
  baseURL: CHAPA_API_URL,
  timeout: CHAPA_TIMEOUT,
  httpsAgent: httpsAgent,
  headers: {
    'Authorization': `Bearer ${CHAPA_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

// Response interceptor for error handling
chapaAxios.interceptors.response.use(
  response => response,
  error => {
    logger.error({
      message: 'Chapa API error',
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    return Promise.reject(error);
  }
);

/**
 * Initialize payment with Chapa
 * ASR-06: PCI-DSS compliant - no card data stored
 */
const initializePayment = async (paymentData) => {
  const {
    transactionRef,
    orderId,
    orderNumber,
    amount,
    currency = 'ETB',
    customerEmail,
    customerName,
    customerPhone,
    callbackUrl,
    returnUrl
  } = paymentData;

  let lastError = null;

  for (let attempt = 1; attempt <= CHAPA_RETRY_COUNT; attempt++) {
    try {
      logger.info({
        message: `Initializing Chapa payment (attempt ${attempt}/${CHAPA_RETRY_COUNT})`,
        transactionRef,
        amount,
        currency
      });

      const payload = {
        amount: amount.toString(),
        currency,
        email: customerEmail,
        first_name: customerName.split(' ')[0] || 'Customer',
        last_name: customerName.split(' ').slice(1).join(' ') || '',
        phone_number: customerPhone,
        tx_ref: transactionRef,
        callback_url: callbackUrl,
        return_url: returnUrl,
        customization: {
          title: 'ShewaDelivery',
          description: `Payment for order ${orderNumber}`,
          logo: 'https://shewadelivery.com/logo.png'
        },
        meta: {
          order_id: orderId,
          order_number: orderNumber,
          transaction_ref: transactionRef
        }
      };

      const response = await chapaAxios.post('/transaction/initialize', payload);

      if (response.data.status === 'success') {
        logger.info({
          message: 'Chapa payment initialized successfully',
          transactionRef,
          checkoutUrl: response.data.data.checkout_url,
          expiresAt: response.data.data.expires_at
        });

        return {
          success: true,
          transactionRef: response.data.data.tx_ref,
          checkoutUrl: response.data.data.checkout_url,
          expiresAt: response.data.data.expires_at || calculateExpiryDate()
        };
      } else {
        throw new Error(response.data.message || 'Chapa initialization failed');
      }

    } catch (error) {
      lastError = error;
      logger.warn({
        message: `Chapa initialization attempt ${attempt} failed`,
        transactionRef,
        error: error.message,
        attempt
      });

      if (attempt < CHAPA_RETRY_COUNT) {
        await sleep(CHAPA_RETRY_DELAY * attempt);
      }
    }
  }

  logger.error({
    message: 'Chapa initialization failed after all retries',
    transactionRef,
    lastError: lastError?.message
  });

  return {
    success: false,
    message: lastError?.message || 'Payment initialization failed'
  };
};

/**
 * Verify payment with Chapa
 */
const verifyPayment = async (transactionRef) => {
  let lastError = null;

  for (let attempt = 1; attempt <= CHAPA_RETRY_COUNT; attempt++) {
    try {
      logger.info({
        message: `Verifying payment (attempt ${attempt}/${CHAPA_RETRY_COUNT})`,
        transactionRef
      });

      const response = await chapaAxios.get(`/transaction/verify/${transactionRef}`);

      if (response.data.status === 'success') {
        const payment = response.data.data;
        
        logger.info({
          message: 'Payment verified successfully',
          transactionRef,
          status: payment.status,
          transactionId: payment.transaction_id
        });

        return {
          success: true,
          status: payment.status === 'success' ? 'success' : 'pending',
          transactionId: payment.transaction_id,
          amount: payment.amount,
          currency: payment.currency,
          paymentMethod: payment.payment_method,
          paidAt: payment.paid_at,
          customer: {
            email: payment.customer?.email,
            name: payment.customer?.name
          }
        };
      } else {
        return {
          success: false,
          status: 'pending',
          message: 'Payment not completed yet'
        };
      }

    } catch (error) {
      lastError = error;
      
      if (error.response?.status === 404) {
        // Transaction not found - no need to retry
        return {
          success: false,
          status: 'not_found',
          message: 'Transaction not found'
        };
      }

      logger.warn({
        message: `Verification attempt ${attempt} failed`,
        transactionRef,
        error: error.message,
        attempt
      });

      if (attempt < CHAPA_RETRY_COUNT) {
        await sleep(CHAPA_RETRY_DELAY * attempt);
      }
    }
  }

  logger.error({
    message: 'Payment verification failed after all retries',
    transactionRef,
    lastError: lastError?.message
  });

  return {
    success: false,
    status: 'unknown',
    message: 'Unable to verify payment status'
  };
};

/**
 * Refund payment through Chapa
 */
const refundPayment = async (transactionId, amount, reason) => {
  try {
    logger.info({
      message: 'Processing refund',
      transactionId,
      amount,
      reason
    });

    const response = await chapaAxios.post('/transaction/refund', {
      transaction_id: transactionId,
      amount: amount.toString(),
      reason: reason || 'Customer request'
    });

    if (response.data.status === 'success') {
      logger.info({
        message: 'Refund processed successfully',
        transactionId,
        refundId: response.data.data.refund_id
      });

      return {
        success: true,
        refundId: response.data.data.refund_id,
        status: response.data.data.status,
        refundedAt: new Date()
      };
    } else {
      throw new Error(response.data.message || 'Refund failed');
    }

  } catch (error) {
    logger.error({
      message: 'Refund failed',
      transactionId,
      error: error.message,
      response: error.response?.data
    });

    return {
      success: false,
      message: error.response?.data?.message || error.message
    };
  }
};

/**
 * Get bank list (for payment methods)
 */
const getBanks = async () => {
  try {
    const response = await chapaAxios.get('/banks');
    
    if (response.data.status === 'success') {
      return {
        success: true,
        banks: response.data.data
      };
    }
    
    return {
      success: false,
      message: 'Failed to fetch banks'
    };

  } catch (error) {
    logger.error({
      message: 'Failed to fetch banks',
      error: error.message
    });

    return {
      success: false,
      message: error.message
    };
  }
};

/**
 * Calculate expiry date (24 hours from now)
 */
const calculateExpiryDate = () => {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 24);
  return expiry.toISOString();
};

/**
 * Sleep helper for retries
 */
const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

module.exports = {
  initializePayment,
  verifyPayment,
  refundPayment,
  getBanks
};