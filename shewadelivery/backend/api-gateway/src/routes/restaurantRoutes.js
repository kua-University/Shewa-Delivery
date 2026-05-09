 // backend/api-gateway/src/routes/restaurantRoutes.js
const express = require('express');
const router = express.Router();
const cache = require('../middleware/cache');
const jwtAuth = require('../middleware/jwtAuth');
const rateLimiter = require('../middleware/rateLimiter');
const logger = require('../../../shared/logging/logger');

// Service endpoints (internal Kubernetes DNS)
const RESTAURANT_SERVICE = process.env.RESTAURANT_SERVICE_URL || 'http://restaurant-service:3002';
const ORDER_SERVICE = process.env.ORDER_SERVICE_URL || 'http://order-service:3001';

/**
 * GET /api/restaurants
 * Returns paginated restaurant list with Redis caching (ASR-02)
 * Cache TTL: 5 minutes (reduces database load during lunch rush)
 */
router.get('/restaurants', 
  rateLimiter.public, // 100 requests per minute per IP
  cache.route({ duration: 300 }), // 5 minutes cache
  async (req, res) => {
    try {
      const { page = 1, limit = 20, city, cuisine } = req.query;
      
      // Forward to restaurant service with query params
      const response = await fetch(
        `${RESTAURANT_SERVICE}/api/restaurants?${new URLSearchParams({
          page,
          limit,
          ...(city && { city }),
          ...(cuisine && { cuisine })
        })}`,
        {
          headers: {
            'X-Request-ID': req.id,
            'Accept': 'application/json'
          },
          timeout: 3000 // 3 second timeout for 3G networks
        }
      );

      if (!response.ok) {
        throw new Error(`Restaurant service error: ${response.status}`);
      }

      const data = await response.json();
      
      // Log cache hit/miss for monitoring
      logger.info({
        message: 'Restaurant list fetched',
        page,
        city,
        cacheHit: req.cacheHit || false,
        requestId: req.id
      });

      res.json({
        success: true,
        data: data.restaurants,
        pagination: data.pagination,
        cached: req.cacheHit || false
      });

    } catch (error) {
      logger.error({
        message: 'Failed to fetch restaurants',
        error: error.message,
        requestId: req.id
      });

      res.status(500).json({
        success: false,
        message: 'Unable to load restaurants. Please try again.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

/**
 * GET /api/restaurants/:id/menu
 * Returns restaurant menu with caching (ASR-02)
 * Cache TTL: 2 minutes (menus change less frequently)
 */
router.get('/restaurants/:id/menu',
  rateLimiter.public,
  cache.route({ duration: 120 }), // 2 minutes cache
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const response = await fetch(
        `${RESTAURANT_SERVICE}/api/restaurants/${id}/menu`,
        {
          headers: { 'X-Request-ID': req.id },
          timeout: 3000
        }
      );

      if (response.status === 404) {
        return res.status(404).json({
          success: false,
          message: 'Restaurant not found'
        });
      }

      if (!response.ok) {
        throw new Error(`Menu fetch failed: ${response.status}`);
      }

      const data = await response.json();

      res.json({
        success: true,
        data: data.menu,
        restaurantName: data.restaurantName,
        cached: req.cacheHit || false
      });

    } catch (error) {
      logger.error({
        message: 'Failed to fetch menu',
        restaurantId: req.params.id,
        error: error.message
      });

      res.status(500).json({
        success: false,
        message: 'Unable to load menu. Please refresh.'
      });
    }
  }
);

/**
 * GET /api/restaurants/search
 * Search restaurants (no cache - real-time results)
 */
router.get('/restaurants/search',
  rateLimiter.public,
  async (req, res) => {
    try {
      const { q, lat, lng } = req.query;

      if (!q || q.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Search query must be at least 2 characters'
        });
      }

      const response = await fetch(
        `${RESTAURANT_SERVICE}/api/restaurants/search?${new URLSearchParams({ q, lat, lng })}`,
        {
          headers: { 'X-Request-ID': req.id },
          timeout: 4000
        }
      );

      const data = await response.json();

      res.json({
        success: true,
        data: data.results,
        query: q
      });

    } catch (error) {
      logger.error({ message: 'Search failed', error: error.message });
      res.status(500).json({
        success: false,
        message: 'Search temporarily unavailable'
      });
    }
  }
);

module.exports = router;
