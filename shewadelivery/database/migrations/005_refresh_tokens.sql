-- Migration: 005_refresh_tokens.sql
-- Description: Create refresh tokens table for session management
-- ASR-05: Secure token management

-- Refresh tokens table
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL UNIQUE,
    fingerprint VARCHAR(255),
    expires_at TIMESTAMP NOT NULL,
    revoked BOOLEAN DEFAULT FALSE,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP,
    ip_address INET,
    user_agent TEXT
);

-- Create indexes
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
CREATE INDEX idx_refresh_tokens_revoked ON refresh_tokens(revoked);

-- Clean up expired tokens (run as scheduled job)
CREATE OR REPLACE FUNCTION cleanup_expired_refresh_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM refresh_tokens 
    WHERE expires_at < NOW() OR revoked = true;
END;
$$ LANGUAGE plpgsql;

-- Login attempts table (for brute force protection)
CREATE TABLE IF NOT EXISTS login_attempts (
    id BIGSERIAL PRIMARY KEY,
    phone_number VARCHAR(20),
    ip_address INET,
    success BOOLEAN DEFAULT FALSE,
    attempt_time TIMESTAMP DEFAULT NOW(),
    user_agent TEXT
);

CREATE INDEX idx_login_attempts_phone ON login_attempts(phone_number);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_address);
CREATE INDEX idx_login_attempts_time ON login_attempts(attempt_time);

-- OTP verification codes
CREATE TABLE IF NOT EXISTS otp_codes (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL,
    code VARCHAR(6) NOT NULL,
    purpose VARCHAR(50) DEFAULT 'verification',
    expires_at TIMESTAMP NOT NULL,
    attempts INTEGER DEFAULT 0,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_otp_phone ON otp_codes(phone_number);
CREATE INDEX idx_otp_expires ON otp_codes(expires_at);

-- Comments
COMMENT ON TABLE refresh_tokens IS 'Secure refresh tokens for JWT authentication (ASR-05)';
COMMENT ON TABLE login_attempts IS 'Audit log for login attempts (security monitoring)';