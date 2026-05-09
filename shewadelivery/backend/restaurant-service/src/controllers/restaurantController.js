 
// backend/restaurant-service/src/controllers/restaurantController.js
const restaurantService = require('../models/Restaurant');
const logger = require('../../../shared/logging/logger');

/**
 * Get all restaurants with pagination and filters (ASR-02: Performance)
 */
const getAllRestaurants = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const {
      page = 1,
      limit = 20,
      city,
      cuisine,
      minRating,
      isOpen,
      search
    } = req.query;

    // Validate pagination parameters
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100); // Max 100 per page

    if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pagination parameters'
      });
    }

    const filters = {
      city,
      cuisine,
      minRating: minRating ? parseFloat(minRating) : null,
      isOpen: isOpen === 'true' ? true : (isOpen === 'false' ? false : null),
      search
    };

    const result = await restaurantService.findAll(pageNum, limitNum, filters);

    const responseTime = Date.now() - startTime;
    
    logger.info({
      message: 'Restaurants fetched',
      count: result.restaurants.length,
      total: result.total,
      page: pageNum,
      filters,
      responseTimeMs: responseTime
    });

    res.json({
      success: true,
      data: result.restaurants,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: result.total,
        pages: Math.ceil(result.total / limitNum),
        hasNext: pageNum * limitNum < result.total,
        hasPrev: pageNum > 1
      },
      filters: result.appliedFilters
    });

  } catch (error) {
    logger.error({
      message: 'Failed to fetch restaurants',
      error: error.message,
      query: req.query
    });

    res.status(500).json({
      success: false,
      message: 'Unable to load restaurants',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get restaurant by ID with menu
 */
const getRestaurantById = async (req, res) => {
  try {
    const { id } = req.params;
    const includeMenu = req.query.includeMenu !== 'false';

    const restaurant = await restaurantService.findById(id, includeMenu);

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    logger.debug({
      message: 'Restaurant fetched',
      restaurantId: id,
      includeMenu
    });

    res.json({
      success: true,
      data: restaurant
    });

  } catch (error) {
    logger.error({
      message: 'Failed to fetch restaurant',
      error: error.message,
      restaurantId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Unable to load restaurant details'
    });
  }
};

/**
 * Get restaurant menu with caching support
 */
const getRestaurantMenu = async (req, res) => {
  try {
    const { id } = req.params;
    const { category, isAvailable } = req.query;

    const restaurant = await restaurantService.findById(id, false);
    
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    let menu = restaurant.menu || [];

    // Apply filters
    if (category) {
      menu = menu.filter(item => item.category === category);
    }
    
    if (isAvailable !== undefined) {
      const available = isAvailable === 'true';
      menu = menu.filter(item => item.isAvailable === available);
    }

    logger.debug({
      message: 'Restaurant menu fetched',
      restaurantId: id,
      itemCount: menu.length,
      filters: { category, isAvailable }
    });

    res.json({
      success: true,
      data: {
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        restaurantImage: restaurant.imageUrl,
        menu: menu,
        categories: [...new Set(restaurant.menu?.map(item => item.category) || [])]
      }
    });

  } catch (error) {
    logger.error({
      message: 'Failed to fetch menu',
      error: error.message,
      restaurantId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Unable to load menu'
    });
  }
};

/**
 * Search restaurants (ASR-10: Supports new cities)
 */
const searchRestaurants = async (req, res) => {
  try {
    const { q, lat, lng, radius = 5 } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    const results = await restaurantService.search(q, { lat, lng, radius });

    logger.info({
      message: 'Restaurant search performed',
      query: q,
      resultCount: results.length,
      location: { lat, lng }
    });

    res.json({
      success: true,
      data: results,
      query: q,
      count: results.length
    });

  } catch (error) {
    logger.error({
      message: 'Search failed',
      error: error.message,
      query: req.query.q
    });

    res.status(500).json({
      success: false,
      message: 'Search temporarily unavailable'
    });
  }
};

/**
 * Create new restaurant (Admin only - ASR-10: New city support)
 */
const createRestaurant = async (req, res) => {
  try {
    const {
      name,
      description,
      cuisine,
      city,
      address,
      location,
      phone,
      email,
      openingHours,
      imageUrl,
      deliveryFee,
      minimumOrder,
      estimatedDeliveryTime
    } = req.body;

    // Validate required fields
    if (!name || !cuisine || !city || !address || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, cuisine, city, address, phone'
      });
    }

    // Check if restaurant already exists
    const existing = await restaurantService.findByPhone(phone);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Restaurant with this phone number already exists'
      });
    }

    const restaurantData = {
      name,
      description,
      cuisine: Array.isArray(cuisine) ? cuisine : [cuisine],
      city,
      address,
      location: location || { lat: 0, lng: 0 },
      phone,
      email,
      openingHours: openingHours || {
        monday: { open: "09:00", close: "22:00" },
        tuesday: { open: "09:00", close: "22:00" },
        wednesday: { open: "09:00", close: "22:00" },
        thursday: { open: "09:00", close: "22:00" },
        friday: { open: "09:00", close: "23:00" },
        saturday: { open: "10:00", close: "23:00" },
        sunday: { open: "10:00", close: "21:00" }
      },
      imageUrl: imageUrl || '/images/default-restaurant.png',
      deliveryFee: deliveryFee || 30,
      minimumOrder: minimumOrder || 50,
      estimatedDeliveryTime: estimatedDeliveryTime || 45,
      isOpen: true,
      rating: 0,
      totalRatings: 0,
      menu: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const restaurant = await restaurantService.create(restaurantData);

    logger.info({
      message: 'New restaurant created',
      restaurantId: restaurant.id,
      name: restaurant.name,
      city: restaurant.city,
      createdBy: req.user?.id
    });

    res.status(201).json({
      success: true,
      message: 'Restaurant created successfully',
      data: restaurant
    });

  } catch (error) {
    logger.error({
      message: 'Failed to create restaurant',
      error: error.message,
      body: req.body
    });

    res.status(500).json({
      success: false,
      message: 'Unable to create restaurant'
    });
  }
};

/**
 * Update restaurant (ASR-08: Easy modification for new features)
 */
const updateRestaurant = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Remove fields that shouldn't be updated directly
    delete updates.id;
    delete updates.createdAt;
    delete updates.totalRatings;

    updates.updatedAt = new Date();

    const restaurant = await restaurantService.update(id, updates);

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    logger.info({
      message: 'Restaurant updated',
      restaurantId: id,
      updates: Object.keys(updates),
      updatedBy: req.user?.id
    });

    res.json({
      success: true,
      message: 'Restaurant updated successfully',
      data: restaurant
    });

  } catch (error) {
    logger.error({
      message: 'Failed to update restaurant',
      error: error.message,
      restaurantId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Unable to update restaurant'
    });
  }
};

/**
 * Add menu item to restaurant
 */
const addMenuItem = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      price,
      category,
      imageUrl,
      isAvailable = true,
      preparationTime,
      isPopular = false,
      dietaryInfo = {}
    } = req.body;

    // Validate
    if (!name || !price || !category) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, price, category'
      });
    }

    if (price <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Price must be greater than 0'
      });
    }

    const menuItem = {
      id: generateMenuItemId(),
      name,
      description,
      price,
      category,
      imageUrl: imageUrl || '/images/default-menu-item.png',
      isAvailable,
      preparationTime: preparationTime || 15,
      isPopular,
      dietaryInfo,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const restaurant = await restaurantService.addMenuItem(id, menuItem);

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    logger.info({
      message: 'Menu item added',
      restaurantId: id,
      menuItemId: menuItem.id,
      itemName: name,
      price
    });

    res.status(201).json({
      success: true,
      message: 'Menu item added successfully',
      data: menuItem
    });

  } catch (error) {
    logger.error({
      message: 'Failed to add menu item',
      error: error.message,
      restaurantId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Unable to add menu item'
    });
  }
};

/**
 * Update menu item
 */
const updateMenuItem = async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const updates = req.body;

    delete updates.id;
    updates.updatedAt = new Date();

    const restaurant = await restaurantService.updateMenuItem(id, itemId, updates);

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant or menu item not found'
      });
    }

    logger.info({
      message: 'Menu item updated',
      restaurantId: id,
      menuItemId: itemId,
      updates: Object.keys(updates)
    });

    res.json({
      success: true,
      message: 'Menu item updated successfully',
      data: restaurant
    });

  } catch (error) {
    logger.error({
      message: 'Failed to update menu item',
      error: error.message,
      restaurantId: req.params.id,
      menuItemId: req.params.itemId
    });

    res.status(500).json({
      success: false,
      message: 'Unable to update menu item'
    });
  }
};

/**
 * Delete menu item
 */
const deleteMenuItem = async (req, res) => {
  try {
    const { id, itemId } = req.params;

    const restaurant = await restaurantService.deleteMenuItem(id, itemId);

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant or menu item not found'
      });
    }

    logger.info({
      message: 'Menu item deleted',
      restaurantId: id,
      menuItemId: itemId
    });

    res.json({
      success: true,
      message: 'Menu item deleted successfully'
    });

  } catch (error) {
    logger.error({
      message: 'Failed to delete menu item',
      error: error.message,
      restaurantId: req.params.id,
      menuItemId: req.params.itemId
    });

    res.status(500).json({
      success: false,
      message: 'Unable to delete menu item'
    });
  }
};

/**
 * Get restaurants by city (ASR-10: Supports new cities)
 */
const getRestaurantsByCity = async (req, res) => {
  try {
    const { city } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100);

    const result = await restaurantService.findByCity(city, pageNum, limitNum);

    logger.info({
      message: 'Restaurants by city fetched',
      city,
      count: result.restaurants.length,
      total: result.total
    });

    res.json({
      success: true,
      data: result.restaurants,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: result.total,
        pages: Math.ceil(result.total / limitNum)
      },
      city
    });

  } catch (error) {
    logger.error({
      message: 'Failed to fetch restaurants by city',
      error: error.message,
      city: req.params.city
    });

    res.status(500).json({
      success: false,
      message: 'Unable to load restaurants for this city'
    });
  }
};

/**
 * Get cuisines list (for filters)
 */
const getCuisines = async (req, res) => {
  try {
    const cuisines = await restaurantService.getAllCuisines();

    res.json({
      success: true,
      data: cuisines,
      count: cuisines.length
    });

  } catch (error) {
    logger.error({
      message: 'Failed to fetch cuisines',
      error: error.message
    });

    res.status(500).json({
      success: false,
      message: 'Unable to load cuisines'
    });
  }
};

/**
 * Get cities list (ASR-10: Dynamic city support)
 */
const getCities = async (req, res) => {
  try {
    const cities = await restaurantService.getAllCities();

    res.json({
      success: true,
      data: cities,
      count: cities.length
    });

  } catch (error) {
    logger.error({
      message: 'Failed to fetch cities',
      error: error.message
    });

    res.status(500).json({
      success: false,
      message: 'Unable to load cities'
    });
  }
};

/**
 * Toggle restaurant open/closed status
 */
const toggleRestaurantStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isOpen } = req.body;

    if (typeof isOpen !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isOpen must be a boolean'
      });
    }

    const restaurant = await restaurantService.update(id, { 
      isOpen, 
      updatedAt: new Date() 
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    logger.info({
      message: `Restaurant ${isOpen ? 'opened' : 'closed'}`,
      restaurantId: id,
      isOpen
    });

    res.json({
      success: true,
      message: `Restaurant ${isOpen ? 'opened' : 'closed'} successfully`,
      data: { id: restaurant.id, isOpen: restaurant.isOpen }
    });

  } catch (error) {
    logger.error({
      message: 'Failed to toggle restaurant status',
      error: error.message,
      restaurantId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Unable to update restaurant status'
    });
  }
};

/**
 * Generate unique menu item ID
 */
const generateMenuItemId = () => {
  return `item_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

module.exports = {
  getAllRestaurants,
  getRestaurantById,
  getRestaurantMenu,
  searchRestaurants,
  createRestaurant,
  updateRestaurant,
  addMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getRestaurantsByCity,
  getCuisines,
  getCities,
  toggleRestaurantStatus
};