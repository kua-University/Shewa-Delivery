 
-- Migration: 002_restaurants.sql
-- Description: Create restaurants and menu tables
-- ASR-08: Easy feature addition without breaking changes

-- Restaurants table
CREATE TABLE IF NOT EXISTS restaurants (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    cuisine TEXT[] NOT NULL DEFAULT '{}',
    city VARCHAR(100) NOT NULL,
    sub_city VARCHAR(100),
    woreda VARCHAR(50),
    address TEXT NOT NULL,
    location JSONB,
    phone VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255),
    website VARCHAR(255),
    image_url TEXT,
    cover_image_url TEXT,
    logo_url TEXT,
    delivery_fee DECIMAL(10, 2) DEFAULT 30,
    minimum_order DECIMAL(10, 2) DEFAULT 50,
    estimated_delivery_time INTEGER DEFAULT 45,
    is_open BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    rating DECIMAL(3, 2) DEFAULT 0,
    total_ratings INTEGER DEFAULT 0,
    opening_hours JSONB,
    settings JSONB DEFAULT '{}',
    meta_data JSONB DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Full-text search index
    search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
        setweight(to_tsvector('english', array_to_string(cuisine, ' ')), 'C')
    ) STORED
);

-- Create indexes
CREATE INDEX idx_restaurants_city ON restaurants(city);
CREATE INDEX idx_restaurants_cuisine ON restaurants USING GIN (cuisine);
CREATE INDEX idx_restaurants_rating ON restaurants(rating DESC);
CREATE INDEX idx_restaurants_is_open ON restaurants(is_open);
CREATE INDEX idx_restaurants_name ON restaurants(name);
CREATE INDEX idx_restaurants_location ON restaurants USING GIST (location);
CREATE INDEX idx_restaurants_search ON restaurants USING GIN (search_vector);

-- Add trigger for updated_at
CREATE TRIGGER update_restaurants_updated_at 
    BEFORE UPDATE ON restaurants 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Menu categories table
CREATE TABLE IF NOT EXISTS menu_categories (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    image_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(restaurant_id, name)
);

CREATE INDEX idx_menu_categories_restaurant ON menu_categories(restaurant_id);

-- Menu items table
CREATE TABLE IF NOT EXISTS menu_items (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES menu_categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    compare_at_price DECIMAL(10, 2),
    cost DECIMAL(10, 2),
    sku VARCHAR(100),
    barcode VARCHAR(100),
    image_url TEXT,
    images JSONB DEFAULT '[]',
    is_available BOOLEAN DEFAULT true,
    is_popular BOOLEAN DEFAULT false,
    is_recommended BOOLEAN DEFAULT false,
    preparation_time INTEGER DEFAULT 15,
    calories INTEGER,
    dietary_info JSONB DEFAULT '{}'::jsonb,
    allergens TEXT[] DEFAULT '{}',
    modifiers JSONB DEFAULT '[]',
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_menu_items_restaurant ON menu_items(restaurant_id);
CREATE INDEX idx_menu_items_category ON menu_items(category_id);
CREATE INDEX idx_menu_items_available ON menu_items(restaurant_id, is_available);
CREATE INDEX idx_menu_items_popular ON menu_items(restaurant_id, is_popular);

-- Menu item options/modifiers
CREATE TABLE IF NOT EXISTS menu_item_options (
    id SERIAL PRIMARY KEY,
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    option_type VARCHAR(20) DEFAULT 'single',
    is_required BOOLEAN DEFAULT false,
    min_select INTEGER DEFAULT 1,
    max_select INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_menu_item_options_item ON menu_item_options(menu_item_id);

-- Menu item option choices
CREATE TABLE IF NOT EXISTS menu_item_option_choices (
    id SERIAL PRIMARY KEY,
    option_id INTEGER NOT NULL REFERENCES menu_item_options(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    price_adjustment DECIMAL(10, 2) DEFAULT 0,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_option_choices_option ON menu_item_option_choices(option_id);

-- Restaurant reviews
CREATE TABLE IF NOT EXISTS restaurant_reviews (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id INTEGER,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title VARCHAR(255),
    comment TEXT,
    images TEXT[],
    response TEXT,
    responded_by INTEGER REFERENCES users(id),
    responded_at TIMESTAMP,
    is_verified_purchase BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id, order_id)
);

CREATE INDEX idx_reviews_restaurant ON restaurant_reviews(restaurant_id);
CREATE INDEX idx_reviews_user ON restaurant_reviews(user_id);
CREATE INDEX idx_reviews_rating ON restaurant_reviews(rating);
CREATE INDEX idx_reviews_created ON restaurant_reviews(created_at DESC);

-- Comments
COMMENT ON TABLE restaurants IS 'Restaurant information with multi-city support (ASR-10)';
COMMENT ON COLUMN restaurants.opening_hours IS 'JSON structure for weekly operating hours';
COMMENT ON COLUMN restaurants.settings IS 'JSON for restaurant-specific settings and feature flags';