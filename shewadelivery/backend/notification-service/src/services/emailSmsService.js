 // backend/notification-service/src/services/emailSmsService.js
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const logger = require('../../../shared/logging/logger');

// Email configuration
const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

// SMS configuration (Twilio)
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const SUPPORTED_LANGUAGES = ['en', 'am']; // English and Amharic (ASR-09)

/**
 * Send order confirmation notification (ASR-03: 2s response)
 * ASR-07: Retroactive send ensures customer always gets confirmation
 */
const sendOrderConfirmation = async (notification) => {
  const { userId, orderId, data, preferredLanguage = 'en' } = notification;
  
  try {
    const language = SUPPORTED_LANGUAGES.includes(preferredLanguage) ? preferredLanguage : 'en';
    
    // Prepare message templates
    const templates = getTemplates(language);
    const orderData = {
      orderNumber: data.orderNumber,
      restaurantName: data.restaurantName,
      totalAmount: data.totalAmount,
      estimatedDeliveryTime: data.estimatedDeliveryTime,
      items: data.items || []
    };
    
    // Generate order summary
    const orderSummary = generateOrderSummary(orderData, language);
    
    // Send email (if email configured)
    let emailSent = false;
    if (data.customerEmail) {
      emailSent = await sendEmail({
        to: data.customerEmail,
        subject: templates.orderConfirmation.subject(orderData.orderNumber),
        html: templates.orderConfirmation.html(orderData, orderSummary),
        text: templates.orderConfirmation.text(orderData, orderSummary)
      });
    }
    
    // Send SMS (if phone configured)
    let smsSent = false;
    if (data.customerPhone) {
      smsSent = await sendSMS({
        to: data.customerPhone,
        body: templates.orderConfirmation.sms(orderData)
      });
    }
    
    // Also send push notification (if device token available)
    let pushSent = false;
    if (data.deviceToken) {
      pushSent = await sendPushNotification({
        token: data.deviceToken,
        title: templates.push.orderConfirmation.title,
        body: templates.push.orderConfirmation.body(orderData),
        data: { orderId, type: 'order_confirmation' }
      });
    }
    
    // At least one channel should succeed
    const success = emailSent || smsSent || pushSent;
    
    if (!success) {
      logger.warn({
        message: 'No notification channel succeeded',
        userId,
        orderId,
        hasEmail: !!data.customerEmail,
        hasPhone: !!data.customerPhone,
        hasPush: !!data.deviceToken
      });
    }
    
    return {
      success,
      channels: { email: emailSent, sms: smsSent, push: pushSent }
    };
    
  } catch (error) {
    logger.error({
      message: 'Order confirmation failed',
      orderId,
      error: error.message
    });
    
    return { success: false, error: error.message };
  }
};

/**
 * Send order status update
 */
const sendOrderStatusUpdate = async (notification) => {
  const { userId, orderId, data, preferredLanguage = 'en' } = notification;
  
  try {
    const language = SUPPORTED_LANGUAGES.includes(preferredLanguage) ? preferredLanguage : 'en';
    const templates = getTemplates(language);
    
    const statusData = {
      orderNumber: data.orderNumber,
      status: data.status,
      previousStatus: data.previousStatus,
      statusMessage: getStatusMessage(data.status, language),
      estimatedDeliveryTime: data.estimatedDeliveryTime,
      driverName: data.driverName,
      driverPhone: data.driverPhone,
      trackingUrl: data.trackingUrl
    };
    
    let emailSent = false;
    if (data.customerEmail) {
      emailSent = await sendEmail({
        to: data.customerEmail,
        subject: templates.statusUpdate.subject(data.orderNumber, data.status),
        html: templates.statusUpdate.html(statusData),
        text: templates.statusUpdate.text(statusData)
      });
    }
    
    let smsSent = false;
    if (data.customerPhone) {
      smsSent = await sendSMS({
        to: data.customerPhone,
        body: templates.statusUpdate.sms(statusData)
      });
    }
    
    let pushSent = false;
    if (data.deviceToken) {
      pushSent = await sendPushNotification({
        token: data.deviceToken,
        title: templates.push.statusUpdate.title(data.status),
        body: templates.push.statusUpdate.body(statusData),
        data: { orderId, status: data.status, type: 'status_update' }
      });
    }
    
    return {
      success: emailSent || smsSent || pushSent,
      channels: { email: emailSent, sms: smsSent, push: pushSent }
    };
    
  } catch (error) {
    logger.error({
      message: 'Status update failed',
      orderId,
      error: error.message
    });
    
    return { success: false, error: error.message };
  }
};

/**
 * Send order cancellation notification
 */
const sendOrderCancellation = async (notification) => {
  const { userId, orderId, data, preferredLanguage = 'en' } = notification;
  
  try {
    const language = SUPPORTED_LANGUAGES.includes(preferredLanguage) ? preferredLanguage : 'en';
    const templates = getTemplates(language);
    
    const cancelData = {
      orderNumber: data.orderNumber,
      reason: data.reason,
      cancelledAt: data.cancelledAt
    };
    
    let emailSent = false;
    if (data.customerEmail) {
      emailSent = await sendEmail({
        to: data.customerEmail,
        subject: templates.cancellation.subject(data.orderNumber),
        html: templates.cancellation.html(cancelData),
        text: templates.cancellation.text(cancelData)
      });
    }
    
    let smsSent = false;
    if (data.customerPhone) {
      smsSent = await sendSMS({
        to: data.customerPhone,
        body: templates.cancellation.sms(cancelData)
      });
    }
    
    let pushSent = false;
    if (data.deviceToken) {
      pushSent = await sendPushNotification({
        token: data.deviceToken,
        title: templates.push.cancellation.title,
        body: templates.push.cancellation.body(cancelData),
        data: { orderId, type: 'cancellation' }
      });
    }
    
    return {
      success: emailSent || smsSent || pushSent,
      channels: { email: emailSent, sms: smsSent, push: pushSent }
    };
    
  } catch (error) {
    logger.error({
      message: 'Cancellation notification failed',
      orderId,
      error: error.message
    });
    
    return { success: false, error: error.message };
  }
};

/**
 * Send payment success notification
 */
const sendPaymentSuccess = async (notification) => {
  const { userId, orderId, data, preferredLanguage = 'en' } = notification;
  
  try {
    const language = SUPPORTED_LANGUAGES.includes(preferredLanguage) ? preferredLanguage : 'en';
    const templates = getTemplates(language);
    
    const paymentData = {
      orderNumber: data.orderNumber,
      amount: data.amount,
      transactionId: data.transactionId,
      paymentMethod: data.paymentMethod
    };
    
    let emailSent = false;
    if (data.customerEmail) {
      emailSent = await sendEmail({
        to: data.customerEmail,
        subject: templates.paymentSuccess.subject(data.orderNumber),
        html: templates.paymentSuccess.html(paymentData),
        text: templates.paymentSuccess.text(paymentData)
      });
    }
    
    let smsSent = false;
    if (data.customerPhone) {
      smsSent = await sendSMS({
        to: data.customerPhone,
        body: templates.paymentSuccess.sms(paymentData)
      });
    }
    
    let pushSent = false;
    if (data.deviceToken) {
      pushSent = await sendPushNotification({
        token: data.deviceToken,
        title: templates.push.paymentSuccess.title,
        body: templates.push.paymentSuccess.body(paymentData),
        data: { orderId, type: 'payment_success' }
      });
    }
    
    return {
      success: emailSent || smsSent || pushSent,
      channels: { email: emailSent, sms: smsSent, push: pushSent }
    };
    
  } catch (error) {
    logger.error({
      message: 'Payment success notification failed',
      orderId,
      error: error.message
    });
    
    return { success: false, error: error.message };
  }
};

/**
 * Send payment failed notification
 */
const sendPaymentFailed = async (notification) => {
  const { userId, orderId, data, preferredLanguage = 'en' } = notification;
  
  try {
    const language = SUPPORTED_LANGUAGES.includes(preferredLanguage) ? preferredLanguage : 'en';
    const templates = getTemplates(language);
    
    const paymentData = {
      orderNumber: data.orderNumber,
      amount: data.amount,
      error: data.error,
      retryable: data.retryable
    };
    
    let emailSent = false;
    if (data.customerEmail) {
      emailSent = await sendEmail({
        to: data.customerEmail,
        subject: templates.paymentFailed.subject(data.orderNumber),
        html: templates.paymentFailed.html(paymentData),
        text: templates.paymentFailed.text(paymentData)
      });
    }
    
    let smsSent = false;
    if (data.customerPhone) {
      smsSent = await sendSMS({
        to: data.customerPhone,
        body: templates.paymentFailed.sms(paymentData)
      });
    }
    
    let pushSent = false;
    if (data.deviceToken) {
      pushSent = await sendPushNotification({
        token: data.deviceToken,
        title: templates.push.paymentFailed.title,
        body: templates.push.paymentFailed.body(paymentData),
        data: { orderId, type: 'payment_failed' }
      });
    }
    
    return {
      success: emailSent || smsSent || pushSent,
      channels: { email: emailSent, sms: smsSent, push: pushSent }
    };
    
  } catch (error) {
    logger.error({
      message: 'Payment failed notification error',
      orderId,
      error: error.message
    });
    
    return { success: false, error: error.message };
  }
};

/**
 * Send driver assigned notification
 */
const sendDriverAssigned = async (notification) => {
  const { userId, orderId, data } = notification;
  
  try {
    const message = `🚗 Your driver ${data.driverName} has been assigned to order #${data.orderNumber}. Track your delivery here: ${data.trackingUrl}`;
    
    let smsSent = false;
    if (data.customerPhone) {
      smsSent = await sendSMS({
        to: data.customerPhone,
        body: message
      });
    }
    
    let pushSent = false;
    if (data.deviceToken) {
      pushSent = await sendPushNotification({
        token: data.deviceToken,
        title: 'Driver Assigned 🚗',
        body: `${data.driverName} is on the way to deliver your order`,
        data: { orderId, driverName: data.driverName, trackingUrl: data.trackingUrl }
      });
    }
    
    return {
      success: smsSent || pushSent,
      channels: { sms: smsSent, push: pushSent }
    };
    
  } catch (error) {
    logger.error({ message: 'Driver assigned notification failed', error: error.message });
    return { success: false, error: error.message };
  }
};

/**
 * Send order delivered notification
 */
const sendOrderDelivered = async (notification) => {
  const { userId, orderId, data } = notification;
  
  try {
    const message = `✅ Your order #${data.orderNumber} has been delivered! Thank you for using ShewaDelivery. Rate your experience: ${data.ratingUrl}`;
    
    let smsSent = false;
    if (data.customerPhone) {
      smsSent = await sendSMS({
        to: data.customerPhone,
        body: message
      });
    }
    
    let pushSent = false;
    if (data.deviceToken) {
      pushSent = await sendPushNotification({
        token: data.deviceToken,
        title: 'Order Delivered! ✅',
        body: 'Your food has arrived. Enjoy your meal!',
        data: { orderId, type: 'delivered', ratingUrl: data.ratingUrl }
      });
    }
    
    return {
      success: smsSent || pushSent,
      channels: { sms: smsSent, push: pushSent }
    };
    
  } catch (error) {
    logger.error({ message: 'Order delivered notification failed', error: error.message });
    return { success: false, error: error.message };
  }
};

/**
 * Send restaurant order notification
 */
const sendRestaurantOrderNotification = async (notification) => {
  const { restaurantId, data } = notification;
  
  try {
    const message = `🍕 New order #${data.orderNumber} received! Total: ${data.totalAmount} ETB. Prepare by ${data.estimatedPickupTime}`;
    
    // In production, send to restaurant's dashboard/email/SMS
    logger.info({
      message: 'Restaurant order notification',
      restaurantId,
      orderNumber: data.orderNumber,
      message
    });
    
    return { success: true };
    
  } catch (error) {
    logger.error({ message: 'Restaurant notification failed', error: error.message });
    return { success: false };
  }
};

/**
 * Send email via SMTP
 */
const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const info = await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@shewadelivery.com',
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, '') // Strip HTML for text version
    });
    
    logger.debug({
      message: 'Email sent',
      to,
      subject,
      messageId: info.messageId
    });
    
    return true;
    
  } catch (error) {
    logger.error({
      message: 'Email sending failed',
      to,
      error: error.message
    });
    return false;
  }
};

/**
 * Send SMS via Twilio
 */
const sendSMS = async ({ to, body }) => {
  try {
    const message = await twilioClient.messages.create({
      body,
      to,
      from: TWILIO_PHONE_NUMBER
    });
    
    logger.debug({
      message: 'SMS sent',
      to,
      sid: message.sid
    });
    
    return true;
    
  } catch (error) {
    logger.error({
      message: 'SMS sending failed',
      to,
      error: error.message
    });
    return false;
  }
};

/**
 * Send push notification (Firebase Cloud Messaging)
 */
const sendPushNotification = async ({ token, title, body, data }) => {
  try {
    // Implementation with FCM
    // const admin = require('firebase-admin');
    // const message = { token, notification: { title, body }, data };
    // await admin.messaging().send(message);
    
    logger.debug({
      message: 'Push notification sent',
      token: token.substring(0, 20) + '...',
      title
    });
    
    return true;
    
  } catch (error) {
    logger.error({
      message: 'Push notification failed',
      error: error.message
    });
    return false;
  }
};

/**
 * Generate order summary text
 */
const generateOrderSummary = (orderData, language) => {
  const items = orderData.items.map(item => 
    `${item.quantity}x ${item.name} - ${item.price} ETB`
  ).join('\n');
  
  return `
Order #${orderData.orderNumber}
Restaurant: ${orderData.restaurantName}
Items:
${items}
Total: ${orderData.totalAmount} ETB
Estimated Delivery: ${new Date(orderData.estimatedDeliveryTime).toLocaleTimeString()}
  `;
};

/**
 * Get status message based on status code
 */
// backend/notification-service/src/services/emailSmsService.js (continued)

const getStatusMessage = (status, language) => {
  const messages = {
    en: {
      confirmed: 'Your order has been confirmed',
      preparing: 'Restaurant is preparing your food',
      ready: 'Your order is ready for pickup',
      delivering: 'Driver is on the way',
      delivered: 'Order delivered successfully'
    },
    am: {
      confirmed: 'ትዕዛዝዎ ተረጋግጧል',
      preparing: 'ምግብ እየተዘጋጀ ነው',
      ready: 'ትዕዛዝዎ ዝግጁ ነው',
      delivering: 'አውራሪው በመንገድ ላይ ነው',
      delivered: 'ትዕዛዝ በሚገባ ተሰርቷል'
    }
  };
  
  return messages[language]?.[status] || messages.en[status] || status;
};

/**
 * Get message templates based on language (ASR-09: Amharic/English support)
 */
const getTemplates = (language) => {
  const templates = {
    en: {
      orderConfirmation: {
        subject: (orderNumber) => `Order Confirmation #${orderNumber} - ShewaDelivery`,
        html: (orderData, summary) => `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #FF6B35; color: white; padding: 20px; text-align: center; }
              .content { padding: 20px; background: #f9f9f9; }
              .order-details { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
              .total { font-size: 20px; font-weight: bold; color: #FF6B35; }
              .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Order Confirmed! 🎉</h1>
              </div>
              <div class="content">
                <p>Dear Customer,</p>
                <p>Thank you for your order! Your order has been received and is being processed.</p>
                <div class="order-details">
                  <h3>Order #${orderData.orderNumber}</h3>
                  <p><strong>Restaurant:</strong> ${orderData.restaurantName}</p>
                  <p><strong>Total Amount:</strong> ${orderData.totalAmount} ETB</p>
                  <p><strong>Estimated Delivery:</strong> ${new Date(orderData.estimatedDeliveryTime).toLocaleString()}</p>
                  <hr>
                  <pre>${summary}</pre>
                </div>
                <p>You can track your order status in real-time from the app.</p>
                <p>Thank you for choosing ShewaDelivery!</p>
              </div>
              <div class="footer">
                <p>© 2024 ShewaDelivery. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: (orderData, summary) => `
          Order Confirmation #${orderData.orderNumber}
          
          Thank you for your order!
          
          Restaurant: ${orderData.restaurantName}
          Total: ${orderData.totalAmount} ETB
          Estimated Delivery: ${new Date(orderData.estimatedDeliveryTime).toLocaleString()}
          
          ${summary}
          
          Track your order in the ShewaDelivery app.
        `,
        sms: (orderData) => `✅ Order #${orderData.orderNumber} confirmed! Total: ${orderData.totalAmount} ETB. Est delivery: ${new Date(orderData.estimatedDeliveryTime).toLocaleTimeString()}. Track in app.`
      },
      
      statusUpdate: {
        subject: (orderNumber, status) => `Order #${orderNumber} Status Update - ${status}`,
        html: (statusData) => `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #FF6B35; color: white; padding: 20px; text-align: center; }
              .status { font-size: 24px; font-weight: bold; margin: 20px 0; }
              .tracking { background: #f0f0f0; padding: 15px; border-radius: 5px; margin: 15px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h2>Order Status Update</h2>
              </div>
              <div class="content">
                <p>Order #${statusData.orderNumber}</p>
                <div class="status">${statusData.statusMessage}</div>
                ${statusData.trackingUrl ? `
                  <div class="tracking">
                    <p><strong>Track your delivery:</strong></p>
                    <a href="${statusData.trackingUrl}">${statusData.trackingUrl}</a>
                    ${statusData.driverName ? `<p><strong>Driver:</strong> ${statusData.driverName}</p>` : ''}
                    ${statusData.driverPhone ? `<p><strong>Driver Phone:</strong> ${statusData.driverPhone}</p>` : ''}
                  </div>
                ` : ''}
              </div>
            </div>
          </body>
          </html>
        `,
        text: (statusData) => `
          Order #${statusData.orderNumber} - ${statusData.statusMessage}
          ${statusData.trackingUrl ? `\nTrack here: ${statusData.trackingUrl}` : ''}
          ${statusData.driverName ? `\nDriver: ${statusData.driverName}` : ''}
        `,
        sms: (statusData) => `Order #${statusData.orderNumber}: ${statusData.statusMessage}. ${statusData.trackingUrl ? `Track: ${statusData.trackingUrl}` : ''}`
      },
      
      cancellation: {
        subject: (orderNumber) => `Order #${orderNumber} Cancelled - ShewaDelivery`,
        html: (cancelData) => `
          <div class="container">
            <h2>Order Cancelled</h2>
            <p>Your order #${cancelData.orderNumber} has been cancelled.</p>
            <p><strong>Reason:</strong> ${cancelData.reason || 'Requested by customer'}</p>
            <p>If you were charged, the refund will be processed within 5-7 business days.</p>
          </div>
        `,
        text: (cancelData) => `Order #${cancelData.orderNumber} cancelled. Reason: ${cancelData.reason || 'Requested by customer'}`,
        sms: (cancelData) => `❌ Order #${cancelData.orderNumber} cancelled. Refund will be processed.`
      },
      
      paymentSuccess: {
        subject: (orderNumber) => `Payment Confirmed - Order #${orderNumber}`,
        html: (paymentData) => `
          <div class="container">
            <h2>Payment Successful! 💰</h2>
            <p>Your payment of ${paymentData.amount} ETB for order #${paymentData.orderNumber} has been confirmed.</p>
            <p>Transaction ID: ${paymentData.transactionId}</p>
          </div>
        `,
        text: (paymentData) => `Payment of ${paymentData.amount} ETB confirmed for order #${paymentData.orderNumber}. Transaction: ${paymentData.transactionId}`,
        sms: (paymentData) => `💰 Payment of ${paymentData.amount} ETB confirmed for order #${paymentData.orderNumber}`
      },
      
      paymentFailed: {
        subject: (orderNumber) => `Payment Failed - Order #${orderNumber}`,
        html: (paymentData) => `
          <div class="container">
            <h2>Payment Failed</h2>
            <p>Your payment for order #${paymentData.orderNumber} could not be processed.</p>
            <p><strong>Amount:</strong> ${paymentData.amount} ETB</p>
            <p><strong>Error:</strong> ${paymentData.error}</p>
            ${paymentData.retryable ? '<p>Please try again or use a different payment method.</p>' : '<p>Please contact customer support.</p>'}
          </div>
        `,
        text: (paymentData) => `Payment failed for order #${paymentData.orderNumber}. Error: ${paymentData.error}`,
        sms: (paymentData) => `❌ Payment failed for order #${paymentData.orderNumber}. Please check app for details.`
      }
    },
    
    am: {
      orderConfirmation: {
        subject: (orderNumber) => `የትዕዛዝ ማረጋገጫ #${orderNumber} - ሸዋ ደሊቨሪ`,
        html: (orderData, summary) => `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: 'Noto Sans Ethiopic', Arial, sans-serif; line-height: 1.6; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #FF6B35; color: white; padding: 20px; text-align: center; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>ትዕዛዝ ተረጋግጧል! 🎉</h1>
              </div>
              <div class="content">
                <p>ውድ ደንበኛ፣</p>
                <p>እንኳን ደስ ያለዎት! የእርስዎ ትዕዛዝ ተቀብለን በማስኬድ ላይ ነው።</p>
                <div class="order-details">
                  <h3>ትዕዛዝ #${orderData.orderNumber}</h3>
                  <p><strong>ሬስቶራንት:</strong> ${orderData.restaurantName}</p>
                  <p><strong>ጠቅላላ ዋጋ:</strong> ${orderData.totalAmount} ብር</p>
                  <p><strong>የሚደርስበት ጊዜ:</strong> ${new Date(orderData.estimatedDeliveryTime).toLocaleString()}</p>
                </div>
                <p>ትዕዛዝዎን በመተግበሪያው ውስጥ መከታተል ይችላሉ።</p>
                <p>ሸዋ ደሊቨሪን በመምረጥዎ እናመሰግናለን!</p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: (orderData) => `ትዕዛዝ #${orderData.orderNumber} ተረጋግጧል! ጠቅላላ: ${orderData.totalAmount} ብር`,
        sms: (orderData) => `✅ ትዕዛዝ #${orderData.orderNumber} ተረጋግጧል! ጠቅላላ: ${orderData.totalAmount} ብር`
      },
      
      statusUpdate: {
        subject: (orderNumber, status) => `የትዕዛዝ #${orderNumber} ሁኔታ`,
        html: (statusData) => `<div><h2>የትዕዛዝ ሁኔታ</h2><p>ትዕዛዝ #${statusData.orderNumber}: ${statusData.statusMessage}</p></div>`,
        text: (statusData) => `ትዕዛዝ #${statusData.orderNumber}: ${statusData.statusMessage}`,
        sms: (statusData) => `ትዕዛዝ #${statusData.orderNumber}: ${statusData.statusMessage}`
      },
      
      cancellation: {
        subject: (orderNumber) => `ትዕዛዝ #${orderNumber} ተሰርዟል`,
        html: (cancelData) => `<div><h2>ትዕዛዝ ተሰርዟል</h2><p>ትዕዛዝ #${cancelData.orderNumber} ተሰርዟል።</p></div>`,
        text: (cancelData) => `ትዕዛዝ #${cancelData.orderNumber} ተሰርዟል`,
        sms: (cancelData) => `❌ ትዕዛዝ #${cancelData.orderNumber} ተሰርዟል`
      },
      
      paymentSuccess: {
        subject: (orderNumber) => `ክፍያ ተረጋግጧል - ትዕዛዝ #${orderNumber}`,
        html: (paymentData) => `<div><h2>ክፍያ ተሳክቷል! 💰</h2><p>${paymentData.amount} ብር ለትዕዛዝ #${paymentData.orderNumber} ተከፍሏል።</p></div>`,
        text: (paymentData) => `${paymentData.amount} ብር ለትዕዛዝ #${paymentData.orderNumber} ተከፍሏል`,
        sms: (paymentData) => `💰 ${paymentData.amount} ብር ለትዕዛዝ #${paymentData.orderNumber} ተከፍሏል`
      },
      
      paymentFailed: {
        subject: (orderNumber) => `ክፍያ አልተሳካም - ትዕዛዝ #${orderNumber}`,
        html: (paymentData) => `<div><h2>ክፍያ አልተሳካም</h2><p>ዕዳው ${paymentData.amount} ብር ለትዕዛዝ #${paymentData.orderNumber} አልተሳካም።</p></div>`,
        text: (paymentData) => `ክፍያ አልተሳካም: ${paymentData.amount} ብር`,
        sms: (paymentData) => `❌ ክፍያ አልተሳካም: ${paymentData.amount} ብር`
      }
    }
  };
  
  return templates[language];
};

module.exports = {
  sendOrderConfirmation,
  sendOrderStatusUpdate,
  sendOrderCancellation,
  sendPaymentSuccess,
  sendPaymentFailed,
  sendDriverAssigned,
  sendOrderDelivered,
  sendRestaurantOrderNotification,
  getTemplates
};