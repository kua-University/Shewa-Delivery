 // backend/restaurant-service/src/models/Restaurant.js
const db = require('../db/postgres');
const logger = require('../../../shared/logging/logger');

/**
 * Restaurant Model with Menu Support
 * ASR-08: Designed for easy feature addition without breaking changes
 * ASR-10: Supports dynamic city configuration
 */
class Restaurant {
  /**
   * Find all restaurants with pagination and filters
   */
  static async findAll(page = 1, limit = 20, filters = {}) {
    try {
      const offset = (page - 1) * limit;
      const conditions = [];
      const values = [];
      let paramCounter = 1;

      // Build filter conditions
      if (filters.city) {
        conditions.push(`city = $${paramCounter++}`);
        values.push(filters.city);
      }

      if (filters.cuisine) {
        conditions.push(`$${paramCounter} = ANY(cuisine)`);
        values.push(filters.cuisine);
        paramCounter++;
      }

      if (filters.minRating) {
        conditions.push(`rating >= $${paramCounter++}`);
        values.push(filters.minRating);
      }

      if (filters.isOpen !== null) {
        conditions.push(`is_open = $${paramCounter++}`);
        values.push(filters.isOpen);
      }

      if (filters.search) {
        conditions.push(`(name ILIKE $${paramCounter} OR description ILIKE $${paramCounter})`);
        values.push(`%${filters.search}%`);
        paramCounter++;
      }

      const whereClause = conditions.length > 0 
        ? `WHERE ${conditions.join(' AND ')}` 
        : '';

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM restaurants 
        ${whereClause}
      `;
      const countResult = await db.query(countQuery, values);
      const total = parseInt(countResult.rows[0].total);

      // Get paginated results
      const dataQuery = `
        SELECT 
          id, name, description, cuisine, city, address,
          phone, email, image_url, delivery_fee, minimum_order,
          estimated_delivery_time, is_open, rating, total_ratings,
          opening_hours, location, created_at
        FROM restaurants 
        ${whereClause}
        ORDER BY rating DESC, name ASC
        LIMIT $${paramCounter++} OFFSET $${paramCounter++}
      `;
      values.push(limit, offset);

      const result = await db.query(dataQuery, values);

      const restaurants = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        cuisine: row.cuisine,
        city: row.city,
        address: row.address,
        phone: row.phone,
        email: row.email,
        imageUrl: row.image_url,
        deliveryFee: parseFloat(row.delivery_fee),
        minimumOrder: parseFloat(row.minimum_order),
        estimatedDeliveryTime: row.estimated_delivery_time,
        isOpen: row.is_open,
        rating: parseFloat(row.rating),
        totalRatings: row.total_ratings,
        openingHours: row.opening_hours,
        location: row.location,
        createdAt: row.created_at
      }));

      return {
        restaurants,
        total,
        appliedFilters: filters
      };

    } catch (error) {
      logger.error({
        message: 'Database error in findAll',
        error: error.message,
        filters
      });
      throw error;
    }
  }

  /**
   * Find restaurant by ID
   */
  static async findById(id, includeMenu = true) {
    try {
      const query = `
        SELECT 
          id, name, description, cuisine, city, address,
          phone, email, image_url, delivery_fee, minimum_order,
          estimated_delivery_time, is_open, rating, total_ratings,
          opening_hours, location, menu, created_at, updated_at
        FROM restaurants 
        WHERE id = $1
      `;
      
      const result = await db.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const restaurant = {
        id: row.id,
        name: row.name,
        description: row.description,
        cuisine: row.cuisine,
        city: row.city,
        address: row.address,
        phone: row.phone,
        email: row.email,
        imageUrl: row.image_url,
        deliveryFee: parseFloat(row.delivery_fee),
        minimumOrder: parseFloat(row.minimum_order),
        estimatedDeliveryTime: row.estimated_delivery_time,
        isOpen: row.is_open,
        rating: parseFloat(row.rating),
        totalRatings: row.total_ratings,
        openingHours: row.opening_hours,
        location: row.location,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      if (includeMenu) {
        restaurant.menu = row.menu || [];
      }

      return restaurant;

    } catch (error) {
      logger.error({
        message: 'Database error in findById',
        error: error.message,
        id
      });
      throw error;
    }
  }

  /**
   * Find restaurant by phone number
   */
  static async findByPhone(phone) {
    try {
      const query = `SELECT id, name, phone FROM restaurants WHERE phone = $1`;
      const result = await db.query(query, [phone]);
      
      return result.rows.length > 0 ? result.rows[0] : null;
      
    } catch (error) {
      logger.error({
        message: 'Database error in findByPhone',
        error: error.message,
        phone
      });
      throw error;
    }
  }

  /**
   * Create new restaurant
   */
  static async create(restaurantData) {
    try {
      const query = `
        INSERT INTO restaurants (
          name, description, cuisine, city, address, location,
          phone, email, image_url, delivery_fee, minimum_order,
          estimated_delivery_time, is_open, rating, total_ratings,
          opening_hours, menu, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING id, name, city, created_at
      `;

      const values = [
        restaurantData.name,
        restaurantData.description,
        restaurantData.cuisine,
        restaurantData.city,
        restaurantData.address,
        restaurantData.location,
        restaurantData.phone,
        restaurantData.email,
        restaurantData.imageUrl,
        restaurantData.deliveryFee,
        restaurantData.minimumOrder,
        restaurantData.estimatedDeliveryTime,
        restaurantData.isOpen,
        restaurantData.rating || 0,
        restaurantData.totalRatings || 0,
        restaurantData.openingHours,
        restaurantData.menu || [],
        restaurantData.createdAt,
        restaurantData.updatedAt
      ];

      const result = await db.query(query, values);
      
      return result.rows[0];

    } catch (error) {
      logger.error({
        message: 'Database error in create',
        error: error.message,
        restaurantData
      });
      throw error;
    }
  }

  /**
   * Update restaurant (ASR-08: Supports dynamic feature addition)
   */
  static async update(id, updates) {
    try {
      const setClause = Object.keys(updates)
        .map((key, index) => `${this.toSnakeCase(key)} = $${index + 2}`)
        .join(', ');
      
      const values = [id, ...Object.values(updates)];
      
      const query = `
        UPDATE restaurants
        SET ${setClause}
        WHERE id = $1
        RETURNING *
      `;
      
      const result = await db.query(query, values);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        city: row.city,
        isOpen: row.is_open,
        updatedAt: row.updated_at
      };

    } catch (error) {
      logger.error({
        message: 'Database error in update',
        error: error.message,
        id,
        updates
      });
      throw error;
    }
  }

  /**
   * Add menu item to restaurant
   */
  static async addMenuItem(restaurantId, menuItem) {
    try {
      // Get current menu
      const current = await this.findById(restaurantId, true);
      if (!current) return null;

      // Add new item
      const updatedMenu = [...(current.menu || []), menuItem];

      // Update restaurant
      const query = `
        UPDATE restaurants
        SET menu = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, menu
      `;
      
      const result = await db.query(query, [restaurantId, JSON.stringify(updatedMenu)]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return {
        id: result.rows[0].id,
        name: result.rows[0].name,
        menu: result.rows[0].menu
      };

    } catch (error) {
      logger.error({
        message: 'Database error in addMenuItem',
        error: error.message,
        restaurantId,
        menuItem
      });
      throw error;
    }
  }

  /**
   * Update menu item
   */
  static async updateMenuItem(restaurantId, itemId, updates) {
    try {
      const current = await this.findById(restaurantId, true);
      if (!current) return null;

      const menuIndex = current.menu.findIndex(item => item.id === itemId);
      if (menuIndex === -1) return null;

      // Update the item
      current.menu[menuIndex] = { ...current.menu[menuIndex], ...updates };

      const query = `
        UPDATE restaurants
        SET menu = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, menu
      `;
      
      const result = await db.query(query, [restaurantId, JSON.stringify(current.menu)]);
      
      return result.rows[0] ? {
        id: result.rows[0].id,
        name: result.rows[0].name,
        menu: result.rows[0].menu
      } : null;

    } catch (error) {
      logger.error({
        message: 'Database error in updateMenuItem',
        error: error.message,
        restaurantId,
        itemId
      });
      throw error;
    }
  }

  /**
   * Delete menu item
   */
  static async deleteMenuItem(restaurantId, itemId) {
    try {
      const current = await this.findById(restaurantId, true);
      if (!current) return null;

      const updatedMenu = current.menu.filter(item => item.id !== itemId);
      
      if (updatedMenu.length === current.menu.length) {
        return null; // Item not found
      }

      const query = `
        UPDATE restaurants
        SET menu = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, name
      `;
      
      const result = await db.query(query, [restaurantId, JSON.stringify(updatedMenu)]);
      
      return result.rows[0] || null;

    } catch (error) {
      logger.error({
        message: 'Database error in deleteMenuItem',
        error: error.message,
        restaurantId,
        itemId
      });
      throw error;
    }
  }

  /**
   * Find restaurants by city (ASR-10: Dynamic city support)
   */
  static async findByCity(city, page = 1, limit = 20) {
    try {
      const offset = (page - 1) * limit;
      
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM restaurants 
        WHERE city ILIKE $1
      `;
      const countResult = await db.query(countQuery, [`%${city}%`]);
      const total = parseInt(countResult.rows[0].total);

      const dataQuery = `
        SELECT 
          id, name, description, cuisine, image_url, 
          rating, delivery_fee, estimated_delivery_time, is_open
        FROM restaurants 
        WHERE city ILIKE $1
        ORDER BY rating DESC
        LIMIT $2 OFFSET $3
      `;
      
      const result = await db.query(dataQuery, [`%${city}%`, limit, offset]);
      
      const restaurants = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        cuisine: row.cuisine,
        imageUrl: row.image_url,
        rating: parseFloat(row.rating),
        deliveryFee: parseFloat(row.delivery_fee),
        estimatedDeliveryTime: row.estimated_delivery_time,
        isOpen: row.is_open
      }));

      return { restaurants, total };

    } catch (error) {
      logger.error({
        message: 'Database error in findByCity',
        error: error.message,
        city
      });
      throw error;
    }
  }

  /**
   * Search restaurants
   */
  static async search(query, location = null) {
    try {
      let sql = `
        SELECT 
          id, name, description, cuisine, city, image_url,
          rating, delivery_fee, is_open
        FROM restaurants
        WHERE name ILIKE $1 
           OR description ILIKE $1 
           OR $2 = ANY(cuisine)
        ORDER BY 
          CASE WHEN name ILIKE $3 THEN 1 ELSE 2 END,
          rating DESC
        LIMIT 50
      `;
      
      const searchTerm = `%${query}%`;
      const exactMatch = `${query}%`;
      
      const result = await db.query(sql, [searchTerm, query, exactMatch]);
      
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        cuisine: row.cuisine,
        city: row.city,
        imageUrl: row.image_url,
        rating: parseFloat(row.rating),
        deliveryFee: parseFloat(row.delivery_fee),
        isOpen: row.is_open
      }));

    } catch (error) {
      logger.error({
        message: 'Database error in search',
        error: error.message,
        query
      });
      throw error;
    }
  }

  /**
   * Get all unique cuisines
   */
  static async getAllCuisines() {
    try {
      const query = `
        SELECT DISTINCT UNNEST(cuisine) as cuisine
        FROM restaurants
        WHERE is_open = true
        ORDER BY cuisine
      `;
      
      const result = await db.query(query);
      return result.rows.map(row => row.cuisine);

    } catch (error) {
      logger.error({
        message: 'Database error in getAllCuisines',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all unique cities (ASR-10: Dynamic)
   */
  static async getAllCities() {
    try {
      const query = `
        SELECT DISTINCT city
        FROM restaurants
        ORDER BY city
      `;
      
      const result = await db.query(query);
      return result.rows.map(row => row.city);

    } catch (error) {
      logger.error({
        message: 'Database error in getAllCities',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Convert camelCase to snake_case
   */
  static toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

/**
 * Database schema (for reference)
 */
const RestaurantSchema = {
  tableName: 'restaurants',
  
  createTableSQL: `
    CREATE TABLE IF NOT EXISTS restaurants (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      cuisine TEXT[] NOT NULL,
      city VARCHAR(100) NOT NULL,
      address TEXT NOT NULL,
      location JSONB,
      phone VARCHAR(20) UNIQUE NOT NULL,
      email VARCHAR(255),
      image_url TEXT,
      delivery_fee DECIMAL(10, 2) DEFAULT 30,
      minimum_order DECIMAL(10, 2) DEFAULT 50,
      estimated_delivery_time INTEGER DEFAULT 45,
      is_open BOOLEAN DEFAULT true,
      rating DECIMAL(3, 2) DEFAULT 0,
      total_ratings INTEGER DEFAULT 0,
      opening_hours JSONB,
      menu JSONB DEFAULT '[]',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      
      -- Indexes for performance (ASR-02)
      INDEX idx_restaurants_city (city),
      INDEX idx_restaurants_cuisine USING GIN (cuisine),
      INDEX idx_restaurants_rating (rating DESC),
      INDEX idx_restaurants_is_open (is_open),
      INDEX idx_restaurants_name (name)
    )
  `
};

module.exports = Restaurant;
