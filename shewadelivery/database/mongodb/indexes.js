 
// database/mongodb/indexes.js
// MongoDB indexes for GPS tracking optimization
// High-frequency writes for driver locations

// Driver location schema and indexes
const createDriverLocationIndexes = async (db) => {
  const collection = db.collection('driver_locations');
  
  // Create indexes for optimal GPS query performance
  
  // 1. Geospatial index for finding nearby drivers (ASR-03)
  await collection.createIndex(
    { location: '2dsphere' },
    { 
      name: 'gps_location_2dsphere',
      background: true 
    }
  );
  
  // 2. Compound index for driver history queries
  await collection.createIndex(
    { driverId: 1, timestamp: -1 },
    { 
      name: 'driver_timestamp_idx',
      background: true 
    }
  );
  
  // 3. TTL index for automatic cleanup (7 days retention)
  await collection.createIndex(
    { timestamp: 1 },
    { 
      expireAfterSeconds: 604800, // 7 days
      name: 'ttl_timestamp_idx',
      background: true 
    }
  );
  
  // 4. Index for active drivers (status + timestamp)
  await collection.createIndex(
    { status: 1, timestamp: -1 },
    { 
      name: 'status_timestamp_idx',
      background: true,
      partialFilterExpression: { status: { $in: ['active', 'busy'] } }
    }
  );
  
  // 5. Index for order tracking
  await collection.createIndex(
    { orderId: 1, timestamp: -1 },
    { 
      name: 'order_tracking_idx',
      background: true,
      sparse: true 
    }
  );
  
  // 6. Compound index for driver location summary queries
  await collection.createIndex(
    { driverId: 1, status: 1, timestamp: -1 },
    { 
      name: 'driver_status_timestamp_idx',
      background: true 
    }
  );
  
  console.log('Driver location indexes created successfully');
};

// Driver sessions collection indexes
const createDriverSessionsIndexes = async (db) => {
  const collection = db.collection('driver_sessions');
  
  await collection.createIndex(
    { driverId: 1, startTime: -1 },
    { name: 'driver_session_idx', background: true }
  );
  
  await collection.createIndex(
    { endTime: 1 },
    { expireAfterSeconds: 2592000, name: 'session_ttl_idx' } // 30 days
  );
};

// Order tracking collection indexes
const createOrderTrackingIndexes = async (db) => {
  const collection = db.collection('order_tracking');
  
  await collection.createIndex(
    { orderId: 1, timestamp: -1 },
    { name: 'order_tracking_idx', background: true }
  );
  
  await collection.createIndex(
    { driverId: 1, timestamp: -1 },
    { name: 'driver_order_idx', background: true }
  );
  
  await collection.createIndex(
    { timestamp: 1 },
    { expireAfterSeconds: 604800, name: 'order_ttl_idx' } // 7 days
  );
};

// Cache collection indexes (for Redis fallback)
const createCacheIndexes = async (db) => {
  const collection = db.collection('cache');
  
  await collection.createIndex(
    { key: 1 },
    { unique: true, name: 'cache_key_idx', background: true }
  );
  
  await collection.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'cache_expiry_idx' }
  );
};

// Notification queue indexes
const createNotificationIndexes = async (db) => {
  const collection = db.collection('notification_queue');
  
  await collection.createIndex(
    { userId: 1, status: 1, createdAt: -1 },
    { name: 'user_status_idx', background: true }
  );
  
  await collection.createIndex(
    { status: 1, retryCount: 1, nextRetryAt: 1 },
    { name: 'retry_queue_idx', background: true }
  );
  
  await collection.createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 604800, name: 'notification_ttl_idx' }
  );
};

// Analytics collection indexes
const createAnalyticsIndexes = async (db) => {
  const collection = db.collection('analytics_events');
  
  await collection.createIndex(
    { eventType: 1, timestamp: -1 },
    { name: 'event_type_idx', background: true }
  );
  
  await collection.createIndex(
    { userId: 1, timestamp: -1 },
    { name: 'user_analytics_idx', background: true }
  );
  
  await collection.createIndex(
    { timestamp: 1 },
    { expireAfterSeconds: 7776000, name: 'analytics_ttl_idx' } // 90 days
  );
};

// Main function to create all indexes
const createAllIndexes = async (mongoClient) => {
  try {
    const db = mongoClient.db(process.env.MONGODB_DB || 'shewadelivery');
    
    console.log('Starting MongoDB index creation...');
    
    await createDriverLocationIndexes(db);
    await createDriverSessionsIndexes(db);
    await createOrderTrackingIndexes(db);
    await createCacheIndexes(db);
    await createNotificationIndexes(db);
    await createAnalyticsIndexes(db);
    
    console.log('All MongoDB indexes created successfully');
    
    // Create capped collection for real-time driver locations (optional)
    const collections = await db.listCollections({ name: 'realtime_driver_locations' }).toArray();
    if (collections.length === 0) {
      await db.createCollection('realtime_driver_locations', {
        capped: true,
        size: 104857600, // 100MB
        max: 10000 // Maximum 10,000 documents
      });
      console.log('Capped collection created for real-time driver locations');
    }
    
    return true;
  } catch (error) {
    console.error('Error creating MongoDB indexes:', error);
    throw error;
  }
};

// Optimized query examples
const optimizedQueries = {
  // Find nearby active drivers
  findNearbyDrivers: (longitude, latitude, radiusKm = 5) => ({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: radiusKm * 1000
      }
    },
    status: { $in: ['active', 'idle'] },
    timestamp: { $gt: new Date(Date.now() - 30000) } // Last 30 seconds
  }),
  
  // Get driver's last known location
  getDriverLastLocation: (driverId) => ({
    driverId: driverId
  }),
  
  // Get driver's location history (last hour)
  getDriverHistory: (driverId, minutes = 60) => ({
    driverId: driverId,
    timestamp: { $gt: new Date(Date.now() - minutes * 60000) }
  }),
  
  // Get location updates for active order
  getOrderTracking: (orderId) => ({
    orderId: orderId,
    timestamp: { $gt: new Date(Date.now() - 86400000) } // Last 24 hours
  })
};

// Aggregation pipeline for driver analytics
const driverAnalyticsAggregation = (driverId, startDate, endDate) => [
  {
    $match: {
      driverId: driverId,
      timestamp: { $gte: startDate, $lte: endDate }
    }
  },
  {
    $group: {
      _id: {
        driverId: '$driverId',
        hour: { $hour: '$timestamp' },
        day: { $dayOfYear: '$timestamp' }
      },
      totalDistance: { $sum: '$distance' },
      totalDeliveries: { $sum: { $cond: [{ $eq: ['$eventType', 'delivered'] }, 1, 0] } },
      averageSpeed: { $avg: '$speed' },
      totalDrivingTime: { $sum: '$drivingTime' }
    }
  },
  {
    $sort: { '_id.day': 1, '_id.hour': 1 }
  }
];

module.exports = {
  createAllIndexes,
  optimizedQueries,
  driverAnalyticsAggregation
};