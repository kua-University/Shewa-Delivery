 // backend/auth-service/src/models/User.js
const db = require('../db/postgres');
const logger = require('../../../shared/logging/logger');

/**
 * User Model for authentication and authorization
 * ASR-05: Secure user management with JWT
 */
class User {
  /**
   * Create new user
   */
  static async create(userData) {
    try {
      const query = `
        INSERT INTO users (
          phone_number, password_hash, full_name, email, role,
          preferred_language, is_phone_verified, is_active, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, phone_number, full_name, email, role, preferred_language, is_phone_verified, created_at
      `;
      
      const values = [
        userData.phoneNumber,
        userData.passwordHash,
        userData.fullName,
        userData.email || null,
        userData.role,
        userData.preferredLanguage,
        userData.isPhoneVerified || false,
        userData.isActive !== undefined ? userData.isActive : true,
        userData.createdAt
      ];
      
      const result = await db.query(query, values);
      return result.rows[0];
      
    } catch (error) {
      logger.error({
        message: 'Failed to create user',
        error: error.message,
        phoneNumber: userData.phoneNumber
      });
      throw error;
    }
  }

  /**
   * Find user by ID
   */
  static async findById(id) {
    try {
      const query = `
        SELECT 
          id, phone_number, full_name, email, role, preferred_language,
          is_phone_verified, is_active, password_hash, profile_image,
          last_login_at, created_at, updated_at
        FROM users 
        WHERE id = $1
      `;
      
      const result = await db.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        id: row.id,
        phoneNumber: row.phone_number,
        fullName: row.full_name,
        email: row.email,
        role: row.role,
        preferredLanguage: row.preferred_language,
        isPhoneVerified: row.is_phone_verified,
        isActive: row.is_active,
        passwordHash: row.password_hash,
        profileImage: row.profile_image,
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
      
    } catch (error) {
      logger.error({
        message: 'Failed to find user by ID',
        error: error.message,
        id
      });
      throw error;
    }
  }

  /**
   * Find user by phone number
   */
  static async findByPhone(phoneNumber) {
    try {
      const query = `
        SELECT 
          id, phone_number, full_name, email, role, preferred_language,
          is_phone_verified, is_active, password_hash, profile_image,
          last_login_at, created_at, updated_at
        FROM users 
        WHERE phone_number = $1
      `;
      
      const result = await db.query(query, [phoneNumber]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        id: row.id,
        phoneNumber: row.phone_number,
        fullName: row.full_name,
        email: row.email,
        role: row.role,
        preferredLanguage: row.preferred_language,
        isPhoneVerified: row.is_phone_verified,
        isActive: row.is_active,
        passwordHash: row.password_hash,
        profileImage: row.profile_image,
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
      
    } catch (error) {
      logger.error({
        message: 'Failed to find user by phone',
        error: error.message,
        phoneNumber
      });
      throw error;
    }
  }

  /**
   * Find user by email
   */
  static async findByEmail(email) {
    try {
      const query = `
        SELECT id, phone_number, full_name, email, role
        FROM users 
        WHERE email = $1
      `;
      
      const result = await db.query(query, [email]);
      return result.rows.length > 0 ? result.rows[0] : null;
      
    } catch (error) {
      logger.error({
        message: 'Failed to find user by email',
        error: error.message,
        email
      });
      throw error;
    }
  }

  /**
   * Find user by password reset token
   */
  static async findByResetToken(token) {
    try {
      const query = `
        SELECT id, phone_number, full_name, email, role
        FROM users 
        WHERE password_reset_token = $1 
          AND password_reset_expires > NOW()
      `;
      
      const result = await db.query(query, [token]);
      return result.rows.length > 0 ? result.rows[0] : null;
      
    } catch (error) {
      logger.error({
        message: 'Failed to find user by reset token',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update last login timestamp
   */
  static async updateLastLogin(id) {
    try {
      const query = `
        UPDATE users
        SET last_login_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `;
      
      await db.query(query, [id]);
      
    } catch (error) {
      logger.error({
        message: 'Failed to update last login',
        error: error.message,
        id
      });
    }
  }

  /**
   * Update phone verification status
   */
  static async updatePhoneVerification(id, isVerified) {
    try {
      const query = `
        UPDATE users
        SET is_phone_verified = $2, updated_at = NOW()
        WHERE id = $1
      `;
      
      await db.query(query, [id, isVerified]);
      
    } catch (error) {
      logger.error({
        message: 'Failed to update phone verification',
        error: error.message,
        id
      });
      throw error;
    }
  }

  /**
   * Update password
   */
  static async updatePassword(id, hashedPassword) {
    try {
      const query = `
        UPDATE users
        SET password_hash = $2, updated_at = NOW()
        WHERE id = $1
      `;
      
      await db.query(query, [id, hashedPassword]);
      
      logger.info({
        message: 'Password updated',
        userId: id
      });
      
    } catch (error) {
      logger.error({
        message: 'Failed to update password',
        error: error.message,
        id
      });
      throw error;
    }
  }

  /**
   * Store refresh token
   */
  static async storeRefreshToken(userId, refreshToken) {
    try {
      // First, invalidate old tokens
      await this.invalidateAllRefreshTokens(userId);
      
      const query = `
        INSERT INTO refresh_tokens (user_id, token, expires_at, created_at)
        VALUES ($1, $2, $3, NOW())
      `;
      
      // Decode token to get expiry
      const decoded = jwt.decode(refreshToken);
      const expiresAt = new Date(decoded.exp * 1000);
      
      await db.query(query, [userId, refreshToken, expiresAt]);
      
    } catch (error) {
      logger.error({
        message: 'Failed to store refresh token',
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * Validate refresh token
   */
  static async validateRefreshToken(userId, refreshToken) {
    try {
      const query = `
        SELECT id FROM refresh_tokens
        WHERE user_id = $1 AND token = $2 AND expires_at > NOW() AND revoked = false
      `;
      
      const result = await db.query(query, [userId, refreshToken]);
      return result.rows.length > 0;
      
    } catch (error) {
      logger.error({
        message: 'Failed to validate refresh token',
        error: error.message,
        userId
      });
      return false;
    }
  }

  /**
   * Invalidate refresh token (logout)
   */
  static async invalidateRefreshToken(userId) {
    try {
      const query = `
        UPDATE refresh_tokens
        SET revoked = true, revoked_at = NOW()
        WHERE user_id = $1 AND revoked = false
      `;
      
      await db.query(query, [userId]);
      
    } catch (error) {
      logger.error({
        message: 'Failed to invalidate refresh token',
        error: error.message,
        userId
      });
    }
  }

  /**
   * Invalidate all refresh tokens (security)
   */
  static async invalidateAllRefreshTokens(userId) {
    try {
      const query = `
        UPDATE refresh_tokens
        SET revoked = true, revoked_at = NOW()
        WHERE user_id = $1 AND revoked = false
      `;
      
      await db.query(query, [userId]);
      
      logger.info({
        message: 'All refresh tokens invalidated',
        userId
      });
      
    } catch (error) {
      logger.error({
        message: 'Failed to invalidate all refresh tokens',
        error: error.message,
        userId
      });
    }
  }

  /**
   * Store password reset token
   */
  static async storePasswordResetToken(userId, token, expiresAt) {
    try {
      const query = `
        UPDATE users
        SET password_reset_token = $2, password_reset_expires = $3, updated_at = NOW()
        WHERE id = $1
      `;
      
      await db.query(query, [userId, token, expiresAt]);
      
    } catch (error) {
      logger.error({
        message: 'Failed to store password reset token',
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * Clear password reset token
   */
  static async clearPasswordResetToken(userId) {
    try {
      const query = `
        UPDATE users
        SET password_reset_token = NULL, password_reset_expires = NULL, updated_at = NOW()
        WHERE id = $1
      `;
      
      await db.query(query, [userId]);
      
    } catch (error) {
      logger.error({
        message: 'Failed to clear password reset token',
        error: error.message,
        userId
      });
    }
  }

  /**
   * Update user profile
   */
  static async updateProfile(userId, updates) {
    try {
      const allowedUpdates = ['full_name', 'email', 'preferred_language', 'profile_image'];
      const updateFields = [];
      const values = [userId];
      let paramCounter = 2;
      
      for (const [key, value] of Object.entries(updates)) {
        if (allowedUpdates.includes(key) && value !== undefined) {
          updateFields.push(`${key} = $${paramCounter}`);
          values.push(value);
          paramCounter++;
        }
      }
      
      if (updateFields.length === 0) {
        return null;
      }
      
      updateFields.push(`updated_at = NOW()`);
      
      const query = `
        UPDATE users
        SET ${updateFields.join(', ')}
        WHERE id = $1
        RETURNING id, phone_number, full_name, email, preferred_language, profile_image
      `;
      
      const result = await db.query(query, values);
      return result.rows[0];
      
    } catch (error) {
      logger.error({
        message: 'Failed to update profile',
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * Deactivate user account
   */
  static async deactivateUser(userId) {
    try {
      const query = `
        UPDATE users
        SET is_active = false, updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `;
      
      const result = await db.query(query, [userId]);
      
      // Invalidate all tokens
      await this.invalidateAllRefreshTokens(userId);
      
      return result.rows.length > 0;
      
    } catch (error) {
      logger.error({
        message: 'Failed to deactivate user',
        error: error.message,
        userId
      });
      throw error;
    }
  }
}

/**
 * Database schema for users and refresh tokens
 */
const UserSchema = {
  usersTable: `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      phone_number VARCHAR(20) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE,
      role VARCHAR(50) NOT NULL DEFAULT 'customer',
      preferred_language VARCHAR(10) DEFAULT 'en',
      is_phone_verified BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      profile_image TEXT,
      password_reset_token VARCHAR(255),
      password_reset_expires TIMESTAMP,
      last_login_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      
      INDEX idx_users_phone (phone_number),
      INDEX idx_users_email (email),
      INDEX idx_users_role (role),
      INDEX idx_users_reset_token (password_reset_token)
    )
  `,
  
  refreshTokensTable: `
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(500) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      revoked BOOLEAN DEFAULT FALSE,
      revoked_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      
      INDEX idx_refresh_tokens_user_id (user_id),
      INDEX idx_refresh_tokens_token (token),
      INDEX idx_refresh_tokens_expires_at (expires_at)
    )
  `
};

module.exports = User;
