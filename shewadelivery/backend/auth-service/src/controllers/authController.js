 // backend/auth-service/src/controllers/authController.js
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const logger = require('../../../shared/logging/logger');

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'shewadelivery-jwt-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'shewadelivery-refresh-secret-key';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '30d';

// Rate limiting store (use Redis in production)
const otpStore = new Map();
const loginAttempts = new Map();

/**
 * Register new user (ASR-05: Secure authentication)
 */
const register = async (req, res) => {
  try {
    const {
      phoneNumber,
      password,
      fullName,
      email,
      role = 'customer',
      preferredLanguage = 'en'
    } = req.body;

    // Validate required fields
    if (!phoneNumber || !password || !fullName) {
      return res.status(400).json({
        success: false,
        message: 'Phone number, password, and full name are required'
      });
    }

    // Validate phone number format (Ethiopian format)
    const phoneRegex = /^(\+251|0)[0-9]{9}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use +251XXXXXXXXX or 09XXXXXXXX'
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    // Check password complexity
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (!(hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar)) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain uppercase, lowercase, number, and special character'
      });
    }

    // Check if user already exists
    const existingUser = await User.findByPhone(phoneNumber);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this phone number already exists'
      });
    }

    if (email) {
      const existingEmail = await User.findByEmail(email);
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: 'User with this email already exists'
        });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = await User.create({
      phoneNumber,
      passwordHash: hashedPassword,
      fullName,
      email,
      role,
      preferredLanguage,
      isPhoneVerified: false,
      isActive: true,
      createdAt: new Date()
    });

    // Send OTP for phone verification
    await sendOTP(phoneNumber);

    logger.info({
      message: 'New user registered',
      userId: user.id,
      phoneNumber,
      role,
      preferredLanguage
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your phone number.',
      data: {
        userId: user.id,
        phoneNumber: user.phoneNumber,
        fullName: user.fullName,
        role: user.role,
        requiresPhoneVerification: true
      }
    });

  } catch (error) {
    logger.error({
      message: 'Registration failed',
      error: error.message,
      stack: error.stack,
      phoneNumber: req.body?.phoneNumber
    });

    res.status(500).json({
      success: false,
      message: 'Unable to complete registration',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Login user and issue JWT tokens (ASR-05)
 */
const login = async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    if (!phoneNumber || !password) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and password are required'
      });
    }

    // Check login attempts (prevent brute force)
    const attemptsKey = `login:${phoneNumber}`;
    const attempts = loginAttempts.get(attemptsKey) || { count: 0, lockedUntil: null };

    if (attempts.lockedUntil && new Date() < attempts.lockedUntil) {
      const remainingMinutes = Math.ceil((attempts.lockedUntil - new Date()) / 60000);
      return res.status(429).json({
        success: false,
        message: `Too many failed attempts. Try again in ${remainingMinutes} minutes`,
        lockoutRemaining: remainingMinutes
      });
    }

    // Find user
    const user = await User.findByPhone(phoneNumber);
    
    if (!user) {
      // Record failed attempt
      recordFailedAttempt(attemptsKey);
      
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    
    if (!isValidPassword) {
      // Record failed attempt
      recordFailedAttempt(attemptsKey);
      
      logger.warn({
        message: 'Failed login attempt',
        phoneNumber,
        userId: user.id
      });
      
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Reset failed attempts on successful login
    loginAttempts.delete(attemptsKey);

    // Generate JWT tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Store refresh token in database
    await User.storeRefreshToken(user.id, refreshToken);

    // Update last login timestamp
    await User.updateLastLogin(user.id);

    logger.info({
      message: 'User logged in successfully',
      userId: user.id,
      phoneNumber,
      role: user.role
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        expiresIn: JWT_EXPIRY,
        user: {
          id: user.id,
          fullName: user.fullName,
          phoneNumber: user.phoneNumber,
          email: user.email,
          role: user.role,
          preferredLanguage: user.preferredLanguage,
          isPhoneVerified: user.isPhoneVerified,
          profileImage: user.profileImage
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
      message: 'Unable to login'
    });
  }
};

/**
 * Refresh access token
 */
const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token required'
      });
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    // Check if refresh token exists in database
    const isValid = await User.validateRefreshToken(decoded.userId, refreshToken);
    
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token not found or revoked'
      });
    }

    // Get user
    const user = await User.findById(decoded.userId);
    
    if (!user || !user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'User account is inactive'
      });
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user);

    logger.info({
      message: 'Token refreshed',
      userId: user.id
    });

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        expiresIn: JWT_EXPIRY
      }
    });

  } catch (error) {
    logger.error({
      message: 'Token refresh failed',
      error: error.message
    });

    res.status(500).json({
      success: false,
      message: 'Unable to refresh token'
    });
  }
};

/**
 * Logout user (invalidate tokens)
 */
const logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      // Decode token to get user ID
      const decoded = jwt.decode(token);
      if (decoded && decoded.userId) {
        // Invalidate refresh token
        await User.invalidateRefreshToken(decoded.userId);
        
        // Blacklist access token (for extra security)
        await blacklistAccessToken(token);
        
        logger.info({
          message: 'User logged out',
          userId: decoded.userId
        });
      }
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    logger.error({
      message: 'Logout error',
      error: error.message
    });
    
    // Always return success for logout
    res.json({ success: true, message: 'Logged out' });
  }
};

/**
 * Send OTP for phone verification
 */
const requestOTP = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number required'
      });
    }

    // Check rate limiting for OTP requests
    const otpKey = `otp:${phoneNumber}`;
    const lastRequest = otpStore.get(`${otpKey}:lastRequest`);
    
    if (lastRequest && (Date.now() - lastRequest) < 60000) {
      return res.status(429).json({
        success: false,
        message: 'Please wait 60 seconds before requesting another OTP'
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP with expiration (5 minutes)
    otpStore.set(otpKey, {
      otp,
      expiresAt: Date.now() + 300000, // 5 minutes
      attempts: 0
    });
    
    otpStore.set(`${otpKey}:lastRequest`, Date.now());

    // In production, send via SMS
    await sendSMS(phoneNumber, `Your ShewaDelivery verification code is: ${otp}`);

    logger.info({
      message: 'OTP sent',
      phoneNumber,
      otp: process.env.NODE_ENV === 'development' ? otp : '***'
    });

    res.json({
      success: true,
      message: 'OTP sent successfully',
      expiresIn: 300 // 5 minutes in seconds
    });

  } catch (error) {
    logger.error({
      message: 'OTP request failed',
      error: error.message,
      phoneNumber: req.body?.phoneNumber
    });

    res.status(500).json({
      success: false,
      message: 'Unable to send OTP'
    });
  }
};

/**
 * Verify OTP
 */
const verifyOTP = async (req, res) => {
  try {
    const { phoneNumber, otpCode } = req.body;

    if (!phoneNumber || !otpCode) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and OTP code required'
      });
    }

    const otpKey = `otp:${phoneNumber}`;
    const otpData = otpStore.get(otpKey);

    if (!otpData) {
      return res.status(400).json({
        success: false,
        message: 'OTP expired or not requested'
      });
    }

    if (Date.now() > otpData.expiresAt) {
      otpStore.delete(otpKey);
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    if (otpData.attempts >= 3) {
      otpStore.delete(otpKey);
      return res.status(400).json({
        success: false,
        message: 'Too many failed attempts. Please request a new OTP.'
      });
    }

    if (otpData.otp !== otpCode) {
      otpData.attempts++;
      otpStore.set(otpKey, otpData);
      
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP code',
        remainingAttempts: 3 - otpData.attempts
      });
    }

    // OTP verified successfully
    otpStore.delete(otpKey);
    
    // Update user's phone verification status
    const user = await User.findByPhone(phoneNumber);
    if (user) {
      await User.updatePhoneVerification(user.id, true);
    }

    logger.info({
      message: 'Phone verified successfully',
      phoneNumber,
      userId: user?.id
    });

    res.json({
      success: true,
      message: 'Phone verified successfully'
    });

  } catch (error) {
    logger.error({
      message: 'OTP verification failed',
      error: error.message,
      phoneNumber: req.body?.phoneNumber
    });

    res.status(500).json({
      success: false,
      message: 'Unable to verify OTP'
    });
  }
};

/**
 * Change password
 */
const changePassword = async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters'
      });
    }

    // Get user
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    
    // Update password
    await User.updatePassword(userId, hashedPassword);
    
    // Invalidate all refresh tokens for security
    await User.invalidateAllRefreshTokens(userId);

    logger.info({
      message: 'Password changed successfully',
      userId
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error({
      message: 'Password change failed',
      error: error.message,
      userId: req.body?.userId
    });

    res.status(500).json({
      success: false,
      message: 'Unable to change password'
    });
  }
};

/**
 * Forgot password - send reset link
 */
const forgotPassword = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number required'
      });
    }

    const user = await User.findByPhone(phoneNumber);
    
    if (!user) {
      // Don't reveal if user exists for security
      return res.json({
        success: true,
        message: 'If account exists, password reset instructions will be sent'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour
    
    await User.storePasswordResetToken(user.id, resetToken, resetTokenExpiry);
    
    // Send reset link via SMS
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    await sendSMS(phoneNumber, `Reset your ShewaDelivery password: ${resetLink}`);

    logger.info({
      message: 'Password reset requested',
      userId: user.id,
      phoneNumber
    });

    res.json({
      success: true,
      message: 'If account exists, password reset instructions will be sent'
    });

  } catch (error) {
    logger.error({
      message: 'Forgot password failed',
      error: error.message,
      phoneNumber: req.body?.phoneNumber
    });

    res.status(500).json({
      success: false,
      message: 'Unable to process request'
    });
  }
};

/**
 * Reset password with token
 */
const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Reset token and new password required'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    // Find user by reset token
    const user = await User.findByResetToken(token);
    
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await User.updatePassword(user.id, hashedPassword);
    
    // Clear reset token
    await User.clearPasswordResetToken(user.id);
    
    // Invalidate all sessions
    await User.invalidateAllRefreshTokens(user.id);

    logger.info({
      message: 'Password reset successfully',
      userId: user.id
    });

    res.json({
      success: true,
      message: 'Password reset successfully. Please login with your new password.'
    });

  } catch (error) {
    logger.error({
      message: 'Password reset failed',
      error: error.message
    });

    res.status(500).json({
      success: false,
      message: 'Unable to reset password'
    });
  }
};

/**
 * Generate JWT access token
 */
const generateAccessToken = (user) => {
  const payload = {
    userId: user.id,
    phoneNumber: user.phoneNumber,
    fullName: user.fullName,
    role: user.role,
    email: user.email,
    preferredLanguage: user.preferredLanguage
  };
  
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
    algorithm: 'HS256'
  });
};

/**
 * Generate refresh token
 */
const generateRefreshToken = (user) => {
  const payload = {
    userId: user.id,
    type: 'refresh'
  };
  
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
    algorithm: 'HS256'
  });
};

/**
 * Record failed login attempt
 */
const recordFailedAttempt = (key) => {
  const attempts = loginAttempts.get(key) || { count: 0, lockedUntil: null };
  attempts.count++;
  
  if (attempts.count >= 5) {
    attempts.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // Lock for 15 minutes
  }
  
  loginAttempts.set(key, attempts);
  
  // Auto-cleanup after 30 minutes
  setTimeout(() => {
    loginAttempts.delete(key);
  }, 30 * 60 * 1000);
};

/**
 * Blacklist access token
 */
const blacklistAccessToken = async (token) => {
  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.exp) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        // Store in Redis for blacklist
        // await redisClient.setEx(`blacklist:${token}`, ttl, 'true');
      }
    }
  } catch (error) {
    logger.error({
      message: 'Failed to blacklist token',
      error: error.message
    });
  }
};

/**
 * Send SMS (mock implementation)
 */
const sendSMS = async (phoneNumber, message) => {
  // In production, integrate with SMS provider
  logger.info({
    message: 'SMS sent',
    phoneNumber,
    message
  });
  return true;
};

/**
 * Send OTP (real implementation would use SMS)
 */
const sendOTP = async (phoneNumber) => {
  const otpKey = `otp:${phoneNumber}`;
  const otpData = otpStore.get(otpKey);
  
  if (otpData) {
    // In production, send via SMS
    await sendSMS(phoneNumber, `Your ShewaDelivery verification code is: ${otpData.otp}`);
  }
};

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  requestOTP,
  verifyOTP,
  changePassword,
  forgotPassword,
  resetPassword
};
