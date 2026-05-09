 // backend/api-gateway/src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const rateLimiter = require('../middleware/rateLimiter');
const jwtAuth = require('../middleware/jwtAuth');
const logger = require('../../../shared/logging/logger');

const AUTH_SERVICE = process.env.AUTH_SERVICE_URL || 'http://auth-service:3004';
const USER_SERVICE = process.env.USER_SERVICE_URL || 'http://user-service:3005';

/**
 * POST /api/auth/register
 * Register new user (customer, restaurant, or driver)
 */
router.post('/register',
  rateLimiter.auth, // 5 attempts per 15 minutes
  async (req, res) => {
    try {
      const { 
        phoneNumber, 
        password, 
        fullName, 
        role = 'customer',
        email,
        preferredLanguage = 'am' // am or en (ASR-09)
      } = req.body;

      // Validation
      if (!phoneNumber || !password || !fullName) {
        return res.status(400).json({
          success: false,
          message: 'Phone number, password, and full name are required'
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 8 characters'
        });
      }

      if (!['customer', 'restaurant', 'driver'].includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role specified'
        });
      }

      // Forward to auth service
      const response = await fetch(`${AUTH_SERVICE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber,
          password,
          fullName,
          role,
          email,
          preferredLanguage
        }),
        timeout: 5000
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      logger.info({
        message: 'New user registered',
        userId: data.userId,
        phoneNumber,
        role,
        preferredLanguage
      });

      res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: {
          userId: data.userId,
          phoneNumber,
          fullName,
          role,
          requiresPhoneVerification: true
        }
      });

    } catch (error) {
      logger.error({
        message: 'Registration failed',
        error: error.message,
        phoneNumber: req.body?.phoneNumber
      });

      res.status(500).json({
        success: false,
        message: 'Unable to complete registration. Please try again.'
      });
    }
  }
);

/**
 * POST /api/auth/login
 * Authenticate user and return JWT tokens
 */
router.post('/login',
  rateLimiter.auth, // 10 attempts per 15 minutes
  async (req, res) => {
    try {
      const { phoneNumber, password } = req.body;

      if (!phoneNumber || !password) {
        return res.status(400).json({
          success: false,
          message: 'Phone number and password are required'
        });
      }

      const response = await fetch(`${AUTH_SERVICE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, password }),
        timeout: 5000
      });

      const data = await response.json();

      if (!response.ok) {
        // ASR-05: Log failed attempts
        logger.warn({
          message: 'Failed login attempt',
          phoneNumber,
          statusCode: response.status,
          reason: data.message
        });

        return res.status(response.status).json({
          success: false,
          message: data.message || 'Invalid credentials'
        });
      }

      // Successful login
      logger.info({
        message: 'User logged in',
        userId: data.user.id,
        phoneNumber,
        role: data.user.role
      });

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresIn: data.expiresIn,
          user: {
            id: data.user.id,
            fullName: data.user.fullName,
            phoneNumber: data.user.phoneNumber,
            role: data.user.role,
            preferredLanguage: data.user.preferredLanguage
          }
        }
      });

    } catch (error) {
      logger.error({
        message: 'Login failed',
        error: error.message,
        phoneNumber: req.body?.phoneNumber
      });

      res.status(500).json({
        success: false,
        message: 'Unable to login. Please check your connection.'
      });
    }
  }
);

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh',
  rateLimiter.public,
  async (req, res) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: 'Refresh token required'
        });
      }

      const response = await fetch(`${AUTH_SERVICE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        timeout: 5000
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      res.json({
        success: true,
        data: {
          accessToken: data.accessToken,
          expiresIn: data.expiresIn
        }
      });

    } catch (error) {
      logger.error({ message: 'Token refresh failed', error: error.message });
      res.status(500).json({
        success: false,
        message: 'Unable to refresh session'
      });
    }
  }
);

/**
 * POST /api/auth/logout
 * Invalidate current session
 */
router.post('/logout',
  jwtAuth.optional, // Don't require auth for logout
  async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      if (token) {
        await fetch(`${AUTH_SERVICE}/api/auth/logout`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          timeout: 3000
        }).catch(() => {}); // Fire and forget
      }

      res.json({
        success: true,
        message: 'Logged out successfully'
      });

    } catch (error) {
      // Always return success for logout
      res.json({ success: true, message: 'Logged out' });
    }
  }
);

/**
 * GET /api/auth/verify
 * Verify JWT token and return user info (for frontend route guards)
 */
router.get('/verify',
  jwtAuth.required, // This will automatically reject invalid tokens (ASR-05)
  async (req, res) => {
    try {
      // User info is already attached by jwtAuth middleware
      res.json({
        success: true,
        data: {
          userId: req.user.id,
          fullName: req.user.fullName,
          phoneNumber: req.user.phoneNumber,
          role: req.user.role,
          preferredLanguage: req.user.preferredLanguage,
          email: req.user.email
        }
      });

    } catch (error) {
      logger.error({ message: 'Token verification failed', error: error.message });
      res.status(500).json({
        success: false,
        message: 'Session validation failed'
      });
    }
  }
);

/**
 * POST /api/auth/change-password
 * Change user password (authenticated)
 */
router.post('/change-password',
  jwtAuth.required,
  rateLimiter.authenticated,
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current and new password are required'
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 8 characters'
        });
      }

      const response = await fetch(`${AUTH_SERVICE}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': req.user.id
        },
        body: JSON.stringify({ currentPassword, newPassword }),
        timeout: 5000
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      logger.info({
        message: 'Password changed',
        userId: req.user.id
      });

      res.json({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (error) {
      logger.error({
        message: 'Password change failed',
        userId: req.user?.id,
        error: error.message
      });

      res.status(500).json({
        success: false,
        message: 'Unable to change password'
      });
    }
  }
);

/**
 * POST /api/auth/request-otp
 * Request OTP for phone verification (ASR-09: Mobile-first)
 */
router.post('/request-otp',
  rateLimiter.auth, // 3 requests per 10 minutes
  async (req, res) => {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          message: 'Phone number required'
        });
      }

      const response = await fetch(`${AUTH_SERVICE}/api/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber }),
        timeout: 5000
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      res.json({
        success: true,
        message: 'OTP sent successfully',
        expiresIn: data.expiresIn
      });

    } catch (error) {
      logger.error({ message: 'OTP request failed', error: error.message });
      res.status(500).json({
        success: false,
        message: 'Unable to send verification code'
      });
    }
  }
);

/**
 * POST /api/auth/verify-otp
 * Verify OTP code
 */
router.post('/verify-otp',
  rateLimiter.auth,
  async (req, res) => {
    try {
      const { phoneNumber, otpCode } = req.body;

      if (!phoneNumber || !otpCode) {
        return res.status(400).json({
          success: false,
          message: 'Phone number and OTP code required'
        });
      }

      const response = await fetch(`${AUTH_SERVICE}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, otpCode }),
        timeout: 5000
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      res.json({
        success: true,
        message: 'Phone verified successfully'
      });

    } catch (error) {
      logger.error({ message: 'OTP verification failed', error: error.message });
      res.status(500).json({
        success: false,
        message: 'Unable to verify code'
      });
    }
  }
);

module.exports = router;
