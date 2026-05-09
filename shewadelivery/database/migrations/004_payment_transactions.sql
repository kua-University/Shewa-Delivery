-- Migration: 004_payment_transactions.sql
-- Description: Create payment transactions table (PCI-DSS compliant)
-- ASR-06: No sensitive card data stored

-- Payment transactions table (PCI-DSS compliant)
CREATE TABLE IF NOT EXISTS payment_transactions (
    id SERIAL PRIMARY KEY,
    transaction_ref VARCHAR(100) UNIQUE NOT NULL,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'ETB',
    payment_method VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    
    -- Customer info (limited for PCI compliance)
    customer_email VARCHAR(255),
    customer_name VARCHAR(255),
    customer_phone VARCHAR(50),
    
    -- Payment provider data (tokens only, no card data)
    provider_name VARCHAR(50) DEFAULT 'chapa',
    provider_reference VARCHAR(100),
    provider_transaction_id VARCHAR(100),
    checkout_url TEXT,
    
    -- Timestamps
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    failed_at TIMESTAMP,
    
    -- Error handling
    error_message TEXT,
    error_code VARCHAR(50),
    
    -- Refund data
    refunded BOOLEAN DEFAULT FALSE,
    refund_amount DECIMAL(10, 2),
    refund_reason TEXT,
    refund_id VARCHAR(100),
    refunded_at TIMESTAMP,
    
    -- Metadata (non-sensitive)
    metadata JSONB,
    
    -- Constraints
    CONSTRAINT valid_payment_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
    CONSTRAINT valid_payment_method CHECK (payment_method IN ('chapa', 'cash', 'telebirr', 'card'))
);

-- Create indexes for performance
CREATE INDEX idx_payment_transaction_ref ON payment_transactions(transaction_ref);
CREATE INDEX idx_payment_order_id ON payment_transactions(order_id);
CREATE INDEX idx_payment_user_id ON payment_transactions(user_id);
CREATE INDEX idx_payment_status ON payment_transactions(status);
CREATE INDEX idx_payment_created_at ON payment_transactions(created_at);
CREATE INDEX idx_payment_provider_ref ON payment_transactions(provider_reference);

-- Add trigger for updated_at
CREATE TRIGGER update_payment_transactions_updated_at 
    BEFORE UPDATE ON payment_transactions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Payment webhook logs
CREATE TABLE IF NOT EXISTS payment_webhook_logs (
    id BIGSERIAL PRIMARY KEY,
    transaction_ref VARCHAR(100),
    event_type VARCHAR(50),
    payload JSONB,
    headers JSONB,
    signature VARCHAR(255),
    verified BOOLEAN DEFAULT FALSE,
    processed BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webhook_transaction_ref ON payment_webhook_logs(transaction_ref);
CREATE INDEX idx_webhook_created ON payment_webhook_logs(created_at);

-- Comments
COMMENT ON TABLE payment_transactions IS 'PCI-DSS compliant payment transactions (no card data stored)';
COMMENT ON COLUMN payment_transactions.provider_reference IS 'Payment provider token - only reference, no card data';
COMMENT ON COLUMN payment_transactions.metadata IS 'Non-sensitive transaction metadata';