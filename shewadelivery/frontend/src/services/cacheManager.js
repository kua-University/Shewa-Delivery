// frontend/src/services/cacheManager.js
import localforage from 'localforage';

// Cache configuration
const cacheDB = localforage.createInstance({
  name: 'ShewaDelivery',
  storeName: 'apiCache',
  description: 'API response cache'
});

const DEFAULT_TTL = 300; // 5 minutes
const MAX_CACHE_SIZE = 50; // Maximum number of cached items

class CacheManager {
  constructor() {
    this.cache = new Map();
    this.initialized = false;
  }

  /**
   * Initialize cache manager
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      await cacheDB.ready();
      await this.loadCache();
      this.initialized = true;
      console.log('Cache manager initialized');
    } catch (error) {
      console.error('Failed to initialize cache:', error);
    }
  }

  /**
   * Set cache item
   */
  async set(key, value, options = {}) {
    const { ttl = DEFAULT_TTL, tags = [] } = options;
    
    const cacheItem = {
      data: value,
      timestamp: Date.now(),
      ttl,
      tags,
      key
    };
    
    // Store in memory
    this.cache.set(key, cacheItem);
    
    // Store in IndexedDB
    try {
      await cacheDB.setItem(key, cacheItem);
      
      // Manage cache size
      await this.enforceCacheLimit();
      
    } catch (error) {
      console.error('Failed to cache item:', error);
    }
  }

  /**
   * Get cache item
   */
  async get(key) {
    // Check memory first
    if (this.cache.has(key)) {
      const item = this.cache.get(key);
      if (!this.isExpired(item)) {
        return item.data;
      } else {
        this.cache.delete(key);
      }
    }
    
    // Check IndexedDB
    try {
      const cached = await cacheDB.getItem(key);
      
      if (cached && !this.isExpired(cached)) {
        // Load into memory
        this.cache.set(key, cached);
        return cached.data;
      } else if (cached) {
        // Remove expired
        await cacheDB.removeItem(key);
      }
    } catch (error) {
      console.error('Failed to get cached item:', error);
    }
    
    return null;
  }

  /**
   * Invalidate cache by key or pattern
   */
  async invalidate(pattern) {
    const keys = await this.getAllKeys();
    
    for (const key of keys) {
      if (key.includes(pattern)) {
        await this.delete(key);
        console.log(`Cache invalidated: ${key}`);
      }
    }
  }

  /**
   * Invalidate by tags
   */
  async invalidateByTag(tag) {
    const items = await this.getAllItems();
    
    for (const item of items) {
      if (item.tags && item.tags.includes(tag)) {
        await this.delete(item.key);
        console.log(`Cache invalidated by tag ${tag}: ${item.key}`);
      }
    }
  }

  /**
   * Delete specific cache item
   */
  async delete(key) {
    this.cache.delete(key);
    await cacheDB.removeItem(key);
  }

  /**
   * Clear all cache
   */
  async clear() {
    this.cache.clear();
    await cacheDB.clear();
    console.log('Cache cleared');
  }

  /**
   * Get all cache keys
   */
  async getAllKeys() {
    const memoryKeys = Array.from(this.cache.keys());
    const dbKeys = await cacheDB.keys();
    
    return [...new Set([...memoryKeys, ...dbKeys])];
  }

  /**
   * Get all cache items
   */
  async getAllItems() {
    const items = [];
    
    // Add memory items
    for (const [, value] of this.cache) {
      items.push(value);
    }
    
    // Add DB items not in memory
    const keys = await cacheDB.keys();
    for (const key of keys) {
      if (!this.cache.has(key)) {
        const item = await cacheDB.getItem(key);
        if (item) items.push(item);
      }
    }
    
    return items;
  }

  /**
   * Enforce cache size limit
   */
  async enforceCacheLimit() {
    const keys = await this.getAllKeys();
    
    if (keys.length > MAX_CACHE_SIZE) {
      const items = await this.getAllItems();
      
      // Sort by timestamp (oldest first)
      items.sort((a, b) => a.timestamp - b.timestamp);
      
      // Remove oldest items
      const toRemove = items.slice(0, keys.length - MAX_CACHE_SIZE);
      
      for (const item of toRemove) {
        await this.delete(item.key);
      }
      
      console.log(`Cache cleanup: removed ${toRemove.length} items`);
    }
  }

  /**
   * Check if cache item is expired
   */
  isExpired(item) {
    const age = (Date.now() - item.timestamp) / 1000;
    return age > item.ttl;
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    const keys = await this.getAllKeys();
    const items = await this.getAllItems();
    
    const now = Date.now();
    const validItems = items.filter(item => !this.isExpired(item));
    
    return {
      totalItems: keys.length,
      validItems: validItems.length,
      expiredItems: items.length - validItems.length,
      cacheSize: JSON.stringify(items).length,
      keys: keys
    };
  }

  /**
   * Load cache from IndexedDB on startup
   */
  async loadCache() {
    const keys = await cacheDB.keys();
    
    for (const key of keys) {
      const item = await cacheDB.getItem(key);
      if (item && !this.isExpired(item)) {
        this.cache.set(key, item);
      } else if (item) {
        // Clean up expired items
        await cacheDB.removeItem(key);
      }
    }
    
    console.log(`Cache loaded: ${this.cache.size} items`);
  }
}

// Create singleton
export const cacheManager = new CacheManager();

// Initialize on import
if (typeof window !== 'undefined') {
  cacheManager.initialize();
}