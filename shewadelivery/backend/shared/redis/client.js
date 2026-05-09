 // backend/shared/redis/client.js
const redis = require('redis');
const EventEmitter = require('events');

class RedisClient extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 2000;
  }

  /**
   * Connect to Redis
   */
  async connect() {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB) || 0,
      
      retryStrategy: (times) => {
        const delay = Math.min(times * 100, 3000);
        console.log(`Redis reconnecting in ${delay}ms (attempt ${times})`);
        return delay;
      },
      
      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNREFUSED'];
        return targetErrors.some(targetError => err.message.includes(targetError));
      },
      
      connectTimeout: 10000,
      commandTimeout: 5000,
      keepAlive: 30000,
      enableReadyCheck: true,
      enableOfflineQueue: true
    };
    
    try {
      this.client = redis.createClient(redisConfig);
      
      // Event handlers
      this.client.on('connect', () => {
        console.log('Redis connecting...');
      });
      
      this.client.on('ready', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log('Redis connected and ready');
        this.emit('ready');
      });
      
      this.client.on('error', (error) => {
        console.error('Redis error:', error.message);
        this.isConnected = false;
        this.emit('error', error);
      });
      
      this.client.on('end', () => {
        console.warn('Redis connection closed');
        this.isConnected = false;
        this.emit('end');
        this.reconnect();
      });
      
      await this.client.connect();
      
      return true;
      
    } catch (error) {
      console.error('Failed to connect to Redis:', error.message);
      this.isConnected = false;
      this.reconnect();
      return false;
    }
  }

  /**
   * Reconnect to Redis
   */
  async reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached for Redis');
      this.emit('max_reconnect_attempts');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Reconnecting to Redis in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(async () => {
      await this.connect();
    }, delay);
  }

  /**
   * Get value from cache
   */
  async get(key) {
    if (!this.isConnected || !this.client) {
      return null;
    }
    
    try {
      const value = await this.client.get(key);
      if (!value) return null;
      
      // Try to parse JSON
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      console.error(`Redis GET error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache with TTL
   */
  async set(key, value, ttlSeconds = 300) {
    if (!this.isConnected || !this.client) {
      return false;
    }
    
    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      await this.client.setEx(key, ttlSeconds, stringValue);
      return true;
    } catch (error) {
      console.error(`Redis SET error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Set with condition (NX - only if not exists)
   */
  async setNX(key, value, ttlSeconds = 300) {
    if (!this.isConnected || !this.client) {
      return false;
    }
    
    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      const result = await this.client.set(key, stringValue, {
        NX: true,
        EX: ttlSeconds
      });
      return result === 'OK';
    } catch (error) {
      console.error(`Redis SETNX error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete key(s)
   */
  async del(...keys) {
    if (!this.isConnected || !this.client) {
      return 0;
    }
    
    try {
      return await this.client.del(keys);
    } catch (error) {
      console.error(`Redis DEL error for keys ${keys}:`, error);
      return 0;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    if (!this.isConnected || !this.client) {
      return false;
    }
    
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error(`Redis EXISTS error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get TTL for key
   */
  async ttl(key) {
    if (!this.isConnected || !this.client) {
      return -2;
    }
    
    try {
      return await this.client.ttl(key);
    } catch (error) {
      console.error(`Redis TTL error for key ${key}:`, error);
      return -2;
    }
  }

  /**
   * Increment counter
   */
  async incr(key) {
    if (!this.isConnected || !this.client) {
      return null;
    }
    
    try {
      return await this.client.incr(key);
    } catch (error) {
      console.error(`Redis INCR error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Add to hash
   */
  async hset(key, field, value) {
    if (!this.isConnected || !this.client) {
      return false;
    }
    
    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      await this.client.hSet(key, field, stringValue);
      return true;
    } catch (error) {
      console.error(`Redis HSET error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get from hash
   */
  async hget(key, field) {
    if (!this.isConnected || !this.client) {
      return null;
    }
    
    try {
      const value = await this.client.hGet(key, field);
      if (!value) return null;
      
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      console.error(`Redis HGET error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Get all hash fields
   */
  async hgetall(key) {
    if (!this.isConnected || !this.client) {
      return {};
    }
    
    try {
      const data = await this.client.hGetAll(key);
      
      // Parse JSON values
      const parsed = {};
      for (const [field, value] of Object.entries(data)) {
        try {
          parsed[field] = JSON.parse(value);
        } catch {
          parsed[field] = value;
        }
      }
      
      return parsed;
    } catch (error) {
      console.error(`Redis HGETALL error for key ${key}:`, error);
      return {};
    }
  }

  /**
   * Add to sorted set
   */
  async zadd(key, score, member) {
    if (!this.isConnected || !this.client) {
      return false;
    }
    
    try {
      await this.client.zAdd(key, { score, value: member });
      return true;
    } catch (error) {
      console.error(`Redis ZADD error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get range from sorted set
   */
  async zrange(key, start, stop, withScores = false) {
    if (!this.isConnected || !this.client) {
      return [];
    }
    
    try {
      const options = withScores ? { WITHSCORES: true } : {};
      return await this.client.zRange(key, start, stop, options);
    } catch (error) {
      console.error(`Redis ZRANGE error for key ${key}:`, error);
      return [];
    }
  }

  /**
   * Geospatial: Add location
   */
  async geoAdd(key, longitude, latitude, member) {
    if (!this.isConnected || !this.client) {
      return false;
    }
    
    try {
      await this.client.geoAdd(key, {
        longitude,
        latitude,
        member: member.toString()
      });
      return true;
    } catch (error) {
      console.error(`Redis GEOADD error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Geospatial: Find nearby members
   */
  async geoRadius(key, longitude, latitude, radius, unit = 'km') {
    if (!this.isConnected || !this.client) {
      return [];
    }
    
    try {
      const results = await this.client.geoRadius(key, {
        longitude,
        latitude,
        radius,
        unit
      });
      return results;
    } catch (error) {
      console.error(`Redis GEORADIUS error for key ${key}:`, error);
      return [];
    }
  }

  /**
   * Delete by pattern
   */
  async deletePattern(pattern) {
    if (!this.isConnected || !this.client) {
      return 0;
    }
    
    try {
      let cursor = 0;
      let deletedCount = 0;
      
      do {
        const reply = await this.client.scan(cursor, {
          MATCH: pattern,
          COUNT: 100
        });
        
        cursor = reply.cursor;
        const keys = reply.keys;
        
        if (keys.length > 0) {
          const deleted = await this.client.del(keys);
          deletedCount += deleted;
        }
      } while (cursor !== 0);
      
      return deletedCount;
    } catch (error) {
      console.error(`Redis deletePattern error for pattern ${pattern}:`, error);
      return 0;
    }
  }

  /**
   * Flush all cache (admin only)
   */
  async flushAll() {
    if (!this.isConnected || !this.client) {
      return false;
    }
    
    try {
      await this.client.flushAll();
      console.warn('Redis cache flushed');
      return true;
    } catch (error) {
      console.error('Redis FLUSHALL error:', error);
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    if (!this.isConnected || !this.client) {
      return { connected: false };
    }
    
    try {
      const info = await this.client.info();
      const memory = await this.client.info('memory');
      
      return {
        connected: true,
        uptime: process.uptime(),
        redisInfo: {
          version: info.match(/redis_version:(\d+\.\d+\.\d+)/)?.[1] || 'N/A',
          usedMemory: memory.match(/used_memory_human:([^\r\n]+)/)?.[1] || 'N/A',
          totalConnections: info.match(/total_connections_received:(\d+)/)?.[1] || 'N/A',
          totalCommands: info.match(/total_commands_processed:(\d+)/)?.[1] || 'N/A',
          hitRate: this.calculateHitRate(info)
        }
      };
    } catch (error) {
      return { connected: true, error: error.message };
    }
  }

  /**
   * Calculate cache hit rate
   */
  calculateHitRate(info) {
    const hits = parseInt(info.match(/keyspace_hits:(\d+)/)?.[1] || 0);
    const misses = parseInt(info.match(/keyspace_misses:(\d+)/)?.[1] || 0);
    
    if (hits + misses === 0) return '0%';
    return `${((hits / (hits + misses)) * 100).toFixed(2)}%`;
  }

  /**
   * Check health
   */
  async healthCheck() {
    if (!this.isConnected || !this.client) {
      return { healthy: false, message: 'Redis not connected' };
    }
    
    try {
      await this.client.ping();
      return { healthy: true };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  /**
   * Close connection
   */
  async close() {
    try {
      if (this.client) {
        await this.client.quit();
      }
      this.isConnected = false;
      console.log('Redis connection closed');
    } catch (error) {
      console.error('Error closing Redis connection:', error);
    }
  }
}

// Singleton instance
const redisClient = new RedisClient();

// Auto-connect on module load
redisClient.connect().catch(console.error);

module.exports = redisClient;
