 
// backend/delivery-service/src/controllers/locationController.js
const gpsIngestion = require('../services/gpsIngestion');
const DriverLocation = require('../models/DriverLocation');
const redisClient = require('../db/redis');
const logger = require('../../../shared/logging/logger');

/**
 * Update driver location (high-frequency writes - ASR-03)
 * Receives GPS updates from driver mobile app every 2-5 seconds
 */
const updateLocation = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const {
      driverId,
      latitude,
      longitude,
      accuracy,
      speed,
      heading,
      timestamp,
      batteryLevel,
      status = 'active'
    } = req.body;

    // Validate required fields
    if (!driverId || !latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: driverId, latitude, longitude'
      });
    }

    // Validate coordinates
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    // Prepare location data
    const locationData = {
      driverId: parseInt(driverId),
      location: {
        type: 'Point',
        coordinates: [longitude, latitude] // GeoJSON format: [lng, lat]
      },
      accuracy: accuracy || 10, // meters
      speed: speed || 0, // km/h
      heading: heading || 0, // degrees
      timestamp: timestamp || new Date().toISOString(),
      batteryLevel: batteryLevel || 100,
      status,
      serverTimestamp: new Date()
    };

    // Process location update (async to not block response)
    // Store in MongoDB (high-frequency writes)
    const mongoResult = await gpsIngestion.storeLocation(locationData);
    
    // Update Redis cache with latest position (for real-time queries)
    await gpsIngestion.updateCache(driverId, locationData);

    // Check if driver has active orders and update ETA
    if (req.body.orderId) {
      await gpsIngestion.updateDeliveryETA(driverId, req.body.orderId, locationData);
    }

    const responseTime = Date.now() - startTime;
    
    logger.debug({
      message: 'Driver location updated',
      driverId,
      latitude,
      longitude,
      accuracy,
      responseTimeMs: responseTime
    });

    res.json({
      success: true,
      message: 'Location updated',
      data: {
        driverId,
        timestamp: locationData.serverTimestamp,
        responseTime: responseTime
      }
    });

  } catch (error) {
    logger.error({
      message: 'Failed to update driver location',
      error: error.message,
      driverId: req.body?.driverId,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Unable to update location',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get driver's current location (from Redis cache for speed)
 */
const getDriverLocation = async (req, res) => {
  try {
    const { driverId } = req.params;
    
    // Get from Redis first (fast path - ASR-02)
    let location = await redisClient.get(`driver:location:${driverId}`);
    
    if (!location) {
      // Fallback to MongoDB if not in cache
      location = await DriverLocation.getLatestLocation(driverId);
      
      if (location) {
        // Update cache for next time
        await redisClient.setEx(
          `driver:location:${driverId}`,
          2, // 2 seconds TTL
          JSON.stringify(location)
        );
      }
    } else {
      location = JSON.parse(location);
    }

    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Driver location not found'
      });
    }

    res.json({
      success: true,
      data: location,
      source: location.cached ? 'cache' : 'database'
    });

  } catch (error) {
    logger.error({
      message: 'Failed to get driver location',
      error: error.message,
      driverId: req.params.driverId
    });

    res.status(500).json({
      success: false,
      message: 'Unable to fetch driver location'
    });
  }
};

/**
 * Get nearby drivers for order assignment (geospatial query)
 */
const getNearbyDrivers = async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      radius = 5, // km
      limit = 10
    } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Missing latitude or longitude'
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const radiusKm = parseFloat(radius);
    const limitNum = parseInt(limit);

    // Query MongoDB for nearby drivers (geospatial index)
    const nearbyDrivers = await DriverLocation.findNearbyDrivers(
      lng, lat, radiusKm, limitNum
    );

    logger.info({
      message: 'Nearby drivers queried',
      lat,
      lng,
      radius: radiusKm,
      count: nearbyDrivers.length
    });

    res.json({
      success: true,
      data: nearbyDrivers,
      count: nearbyDrivers.length,
      center: { latitude: lat, longitude: lng },
      radius: radiusKm
    });

  } catch (error) {
    logger.error({
      message: 'Failed to get nearby drivers',
      error: error.message,
      query: req.query
    });

    res.status(500).json({
      success: false,
      message: 'Unable to find nearby drivers'
    });
  }
};

/**
 * Get driver's location history (for tracking order)
 */
const getDriverHistory = async (req, res) => {
  try {
    const { driverId } = req.params;
    const {
      startTime,
      endTime,
      limit = 100
    } = req.query;

    const filters = {
      driverId: parseInt(driverId),
      startTime: startTime ? new Date(startTime) : new Date(Date.now() - 3600000), // Last hour
      endTime: endTime ? new Date(endTime) : new Date(),
      limit: parseInt(limit)
    };

    const history = await DriverLocation.getLocationHistory(
      filters.driverId,
      filters.startTime,
      filters.endTime,
      filters.limit
    );

    // Calculate distance traveled
    const distance = calculateDistance(history);

    logger.debug({
      message: 'Driver history retrieved',
      driverId,
      points: history.length,
      distanceKm: distance
    });

    res.json({
      success: true,
      data: history,
      meta: {
        totalPoints: history.length,
        distanceTraveled: distance,
        startTime: filters.startTime,
        endTime: filters.endTime
      }
    });

  } catch (error) {
    logger.error({
      message: 'Failed to get driver history',
      error: error.message,
      driverId: req.params.driverId
    });

    res.status(500).json({
      success: false,
      message: 'Unable to fetch driver history'
    });
  }
};

/**
 * Get driver status (online/offline/busy)
 */
const getDriverStatus = async (req, res) => {
  try {
    const { driverId } = req.params;
    
    const latestLocation = await DriverLocation.getLatestLocation(driverId);
    
    if (!latestLocation) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Calculate if driver is still active (within last 30 seconds)
    const lastUpdate = new Date(latestLocation.timestamp);
    const secondsSinceUpdate = (Date.now() - lastUpdate.getTime()) / 1000;
    const isActive = secondsSinceUpdate < 30 && latestLocation.status === 'active';

    res.json({
      success: true,
      data: {
        driverId: parseInt(driverId),
        status: latestLocation.status,
        isActive,
        lastUpdate: latestLocation.timestamp,
        lastLocation: {
          latitude: latestLocation.location.coordinates[1],
          longitude: latestLocation.location.coordinates[0]
        },
        secondsSinceUpdate: Math.round(secondsSinceUpdate)
      }
    });

  } catch (error) {
    logger.error({
      message: 'Failed to get driver status',
      error: error.message,
      driverId: req.params.driverId
    });

    res.status(500).json({
      success: false,
      message: 'Unable to fetch driver status'
    });
  }
};

/**
 * Batch update locations (for saving bandwidth on 3G networks - ASR-03)
 */
const batchUpdateLocations = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { driverId, locations } = req.body;

    if (!driverId || !locations || !Array.isArray(locations)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid batch data'
      });
    }

    if (locations.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Batch too large. Maximum 50 locations per request'
      });
    }

    // Process batch in parallel
    const results = await Promise.all(
      locations.map(async (loc) => {
        const locationData = {
          driverId: parseInt(driverId),
          location: {
            type: 'Point',
            coordinates: [loc.longitude, loc.latitude]
          },
          accuracy: loc.accuracy || 10,
          speed: loc.speed || 0,
          heading: loc.heading || 0,
          timestamp: loc.timestamp || new Date().toISOString(),
          batteryLevel: loc.batteryLevel || 100,
          status: loc.status || 'active',
          serverTimestamp: new Date()
        };
        
        await gpsIngestion.storeLocation(locationData);
        return locationData;
      })
    );

    // Update cache with latest location (last one in batch)
    if (results.length > 0) {
      await gpsIngestion.updateCache(driverId, results[results.length - 1]);
    }

    const responseTime = Date.now() - startTime;
    
    logger.info({
      message: 'Batch locations updated',
      driverId,
      batchSize: locations.length,
      responseTimeMs: responseTime
    });

    res.json({
      success: true,
      message: `Updated ${locations.length} locations`,
      data: {
        processed: results.length,
        responseTime: responseTime
      }
    });

  } catch (error) {
    logger.error({
      message: 'Batch update failed',
      error: error.message,
      driverId: req.body?.driverId
    });

    res.status(500).json({
      success: false,
      message: 'Batch update failed'
    });
  }
};

/**
 * Calculate distance traveled from location history
 */
const calculateDistance = (locations) => {
  if (locations.length < 2) return 0;
  
  let totalDistance = 0;
  
  for (let i = 1; i < locations.length; i++) {
    const prev = locations[i - 1];
    const curr = locations[i];
    
    const distance = haversineDistance(
      prev.location.coordinates[1], prev.location.coordinates[0],
      curr.location.coordinates[1], curr.location.coordinates[0]
    );
    
    totalDistance += distance;
  }
  
  return Math.round(totalDistance * 10) / 10; // Round to 1 decimal
};

/**
 * Haversine formula to calculate distance between two points
 */
const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

module.exports = {
  updateLocation,
  getDriverLocation,
  getNearbyDrivers,
  getDriverHistory,
  getDriverStatus,
  batchUpdateLocations
};