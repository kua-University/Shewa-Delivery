 // backend/delivery-service/src/models/DriverLocation.js
const mongoose = require('mongoose');
const logger = require('../../../shared/logging/logger');

// Schema for driver location history
const driverLocationSchema = new mongoose.Schema({
  driverId: {
    type: Number,
    required: true,
    index: true
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
      index: '2dsphere' // Geospatial index for proximity queries
    }
  },
  accuracy: {
    type: Number,
    required: true,
    min: 0,
    max: 1000,
    default: 10
  },
  speed: {
    type: Number,
    min: 0,
    max: 200,
    default: 0
  },
  heading: {
    type: Number,
    min: 0,
    max: 360,
    default: 0
  },
  timestamp: {
    type: Date,
    required: true,
    index: true,
    default: Date.now
  },
  serverTimestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  batteryLevel: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  status: {
    type: String,
    enum: ['active', 'idle', 'offline', 'busy'],
    default: 'active'
  },
  orderId: {
    type: Number,
    index: true
  }
}, {
  timestamps: true,
  // Optimized for high-frequency writes
  writeConcern: {
    w: 1, // Acknowledge writes (faster than majority)
    j: false // No journaling for speed
  },
  // Cap the collection size (optional: limit to 1GB)
  capped: {
    size: 1024 * 1024 * 1024, // 1GB
    max: 10000000 // 10 million documents
  }
});

// Compound indexes for common queries
driverLocationSchema.index({ driverId: 1, timestamp: -1 });
driverLocationSchema.index({ driverId: 1, status: 1 });
driverLocationSchema.index({ timestamp: 1 }, { expireAfterSeconds: 604800 }); // 7 days TTL

// Geospatial index for finding nearby drivers
driverLocationSchema.index({ location: '2dsphere' });

/**
 * Find nearby active drivers
 */
driverLocationSchema.statics.findNearbyDrivers = async function(lng, lat, radiusKm = 5, limit = 10) {
  try {
    const query = {
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [lng, lat]
          },
          $maxDistance: radiusKm * 1000 // Convert to meters
        }
      },
      status: { $in: ['active', 'idle'] },
      timestamp: { $gt: new Date(Date.now() - 30000) } // Active in last 30 seconds
    };
    
    // Use aggregation to get latest location per driver
    const pipeline = [
      { $match: query },
      { $sort: { driverId: 1, timestamp: -1 } },
      {
        $group: {
          _id: '$driverId',
          doc: { $first: '$$ROOT' }
        }
      },
      { $replaceRoot: { newRoot: '$doc' } },
      { $limit: limit },
      {
        $project: {
          driverId: 1,
          location: 1,
          speed: 1,
          heading: 1,
          accuracy: 1,
          batteryLevel: 1,
          status: 1,
          lastUpdate: '$timestamp',
          distance: {
            $let: {
              vars: {
                distance: {
                  $multiply: [
                    6371,
                    {
                      $acos: {
                        $add: [
                          { $multiply: [{ $sin: { $degreesToRadians: lat } }, { $sin: { $degreesToRadians: { $arrayElemAt: ['$location.coordinates', 1] } } }] },
                          { $multiply: [{ $cos: { $degreesToRadians: lat } }, { $cos: { $degreesToRadians: { $arrayElemAt: ['$location.coordinates', 1] } } }, { $cos: { $subtract: [{ $degreesToRadians: lng }, { $degreesToRadians: { $arrayElemAt: ['$location.coordinates', 0] } }] } }] }
                        ]
                      }
                    }
                  ]
                }
              },
              in: '$$distance'
            }
          }
        }
      },
      { $sort: { distance: 1 } }
    ];
    
    const results = await this.aggregate(pipeline);
    
    return results.map(doc => ({
      driverId: doc.driverId,
      location: {
        latitude: doc.location.coordinates[1],
        longitude: doc.location.coordinates[0]
      },
      speed: doc.speed,
      heading: doc.heading,
      accuracy: doc.accuracy,
      batteryLevel: doc.batteryLevel,
      status: doc.status,
      lastUpdate: doc.lastUpdate,
      distanceKm: Math.round(doc.distance * 100) / 100
    }));
    
  } catch (error) {
    logger.error({
      message: 'Error finding nearby drivers',
      error: error.message,
      lng,
      lat,
      radiusKm
    });
    throw error;
  }
};

/**
 * Get latest location for a driver
 */
driverLocationSchema.statics.getLatestLocation = async function(driverId) {
  try {
    const result = await this.findOne({ driverId })
      .sort({ timestamp: -1 })
      .limit(1);
    
    if (!result) return null;
    
    return {
      driverId: result.driverId,
      location: {
        latitude: result.location.coordinates[1],
        longitude: result.location.coordinates[0]
      },
      accuracy: result.accuracy,
      speed: result.speed,
      heading: result.heading,
      timestamp: result.timestamp,
      status: result.status,
      batteryLevel: result.batteryLevel
    };
    
  } catch (error) {
    logger.error({
      message: 'Error getting latest location',
      error: error.message,
      driverId
    });
    throw error;
  }
};

/**
 * Get location history for a driver
 */
driverLocationSchema.statics.getLocationHistory = async function(driverId, startTime, endTime, limit = 100) {
  try {
    const query = {
      driverId,
      timestamp: {
        $gte: startTime,
        $lte: endTime
      }
    };
    
    const results = await this.find(query)
      .sort({ timestamp: 1 })
      .limit(limit);
    
    return results.map(doc => ({
      timestamp: doc.timestamp,
      location: {
        latitude: doc.location.coordinates[1],
        longitude: doc.location.coordinates[0]
      },
      speed: doc.speed,
      heading: doc.heading,
      accuracy: doc.accuracy,
      status: doc.status
    }));
    
  } catch (error) {
    logger.error({
      message: 'Error getting location history',
      error: error.message,
      driverId
    });
    throw error;
  }
};

/**
 * Create new location record
 */
driverLocationSchema.statics.create = async function(locationData) {
  try {
    const location = new this(locationData);
    return await location.save();
  } catch (error) {
    logger.error({
      message: 'Error creating location record',
      error: error.message,
      driverId: locationData.driverId
    });
    throw error;
  }
};

/**
 * Bulk create location records (for batch processing)
 */
driverLocationSchema.statics.bulkCreate = async function(locationsArray) {
  try {
    const result = await this.insertMany(locationsArray, {
      ordered: false, // Continue on error
      writeConcern: { w: 1 } // Faster writes
    });
    return result;
  } catch (error) {
    logger.error({
      message: 'Error in bulk create',
      error: error.message,
      count: locationsArray.length
    });
    throw error;
  }
};

/**
 * Delete old locations (TTL cleanup)
 */
driverLocationSchema.statics.deleteOldLocations = async function(olderThan) {
  try {
    const result = await this.deleteMany({
      timestamp: { $lt: olderThan }
    });
    return result.deletedCount;
  } catch (error) {
    logger.error({
      message: 'Error deleting old locations',
      error: error.message
    });
    throw error;
  }
};

// Create the model
const DriverLocation = mongoose.model('DriverLocation', driverLocationSchema);

// Ensure indexes are created
DriverLocation.createIndexes().catch(error => {
  logger.error({
    message: 'Failed to create MongoDB indexes',
    error: error.message
  });
});

module.exports = DriverLocation;
