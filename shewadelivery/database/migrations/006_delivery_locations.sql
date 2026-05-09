-- Migration: 006_delivery_locations.sql
-- Description: Create delivery tracking tables (PostgreSQL side)
-- Note: Main GPS tracking uses MongoDB for high-frequency writes

-- Delivery zones table (for Ethiopian cities - ASR-10)
CREATE TABLE IF NOT EXISTS delivery_zones (
    id SERIAL PRIMARY KEY,
    city VARCHAR(100) NOT NULL,
    sub_city VARCHAR(100),
    zone_name VARCHAR(100),
    delivery_fee DECIMAL(10, 2),
    minimum_order DECIMAL(10, 2),
    estimated_time_min INTEGER,
    estimated_time_max INTEGER,
    polygon GEOGRAPHY(POLYGON),
    center GEOGRAPHY(POINT),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(city, sub_city, zone_name)
);

CREATE INDEX idx_delivery_zones_city ON delivery_zones(city);
CREATE INDEX idx_delivery_zones_location ON delivery_zones USING GIST (polygon);
CREATE INDEX idx_delivery_zones_center ON delivery_zones USING GIST (center);

-- Driver locations (summary table - main data in MongoDB)
CREATE TABLE IF NOT EXISTS driver_location_summary (
    id SERIAL PRIMARY KEY,
    driver_id INTEGER NOT NULL REFERENCES users(id),
    current_latitude DECIMAL(10, 8),
    current_longitude DECIMAL(11, 8),
    last_update TIMESTAMP,
    status VARCHAR(20) DEFAULT 'offline',
    current_order_id INTEGER REFERENCES orders(id),
    total_distance_today DECIMAL(10, 2) DEFAULT 0,
    total_deliveries_today INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT valid_driver_status CHECK (status IN ('online', 'offline', 'busy', 'break'))
);

CREATE INDEX idx_driver_location_summary_driver ON driver_location_summary(driver_id);
CREATE INDEX idx_driver_location_summary_status ON driver_location_summary(status);

-- Driver performance metrics
CREATE TABLE IF NOT EXISTS driver_performance (
    id SERIAL PRIMARY KEY,
    driver_id INTEGER NOT NULL REFERENCES users(id),
    date DATE NOT NULL,
    total_deliveries INTEGER DEFAULT 0,
    total_distance DECIMAL(10, 2) DEFAULT 0,
    total_hours DECIMAL(10, 2) DEFAULT 0,
    average_rating DECIMAL(3, 2),
    on_time_percentage DECIMAL(5, 2),
    earnings DECIMAL(10, 2) DEFAULT 0,
    tips DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(driver_id, date)
);

CREATE INDEX idx_driver_performance_driver ON driver_performance(driver_id);
CREATE INDEX idx_driver_performance_date ON driver_performance(date);

-- Delivery tracking events (summary - detailed in MongoDB)
CREATE TABLE IF NOT EXISTS delivery_events (
    id BIGSERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    driver_id INTEGER NOT NULL REFERENCES users(id),
    event_type VARCHAR(50) NOT NULL,
    location GEOGRAPHY(POINT),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_delivery_events_order ON delivery_events(order_id);
CREATE INDEX idx_delivery_events_driver ON delivery_events(driver_id);
CREATE INDEX idx_delivery_events_type ON delivery_events(event_type);
CREATE INDEX idx_delivery_events_location ON delivery_events USING GIST (location);
CREATE INDEX idx_delivery_events_created ON delivery_events(created_at);

-- Comments
COMMENT ON TABLE delivery_zones IS 'Delivery zones for Ethiopian cities (ASR-10: Multi-city support)';
COMMENT ON TABLE driver_location_summary IS 'Summary of driver locations (main GPS data in MongoDB)';