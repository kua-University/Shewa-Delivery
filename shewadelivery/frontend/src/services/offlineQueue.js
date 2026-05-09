 
// frontend/src/services/offlineQueue.js
import localforage from 'localforage';
import { v4 as uuidv4 } from 'uuid';

// Configure IndexedDB for persistent storage
const queueDB = localforage.createInstance({
  name: 'ShewaDelivery',
  storeName: 'offlineQueue',
  description: 'Offline request queue for ShewaDelivery'
});

// Queue configuration
const MAX_RETRY_ATTEMPTS = 5;
const BASE_RETRY_DELAY = 5000; // 5 seconds
const MAX_QUEUE_SIZE = 100;
const SYNC_INTERVAL = 30000; // 30 seconds

// Queue state
let isProcessing = false;
let syncInterval = null;
let networkListeners = [];

/**
 * Offline Queue Manager
 * Handles queuing requests when offline and retrying when online
 * ASR-03: Offline-tolerant design for mobile-first experience
 */
class OfflineQueue {
  constructor() {
    this.queueKey = 'pending_requests';
    this.failedKey = 'failed_requests';
    this.statsKey = 'queue_stats';
    this.initialized = false;
  }

  /**
   * Initialize the queue system
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      // Ensure storage is ready
      await queueDB.ready();
      
      // Load queue from storage
      await this.loadQueue();
      
      // Start sync interval
      this.startSyncInterval();
      
      // Setup network listeners
      this.setupNetworkListeners();
      
      this.initialized = true;
      console.log('Offline queue initialized');
      
      // Process any pending requests on startup
      if (navigator.onLine) {
        setTimeout(() => this.processQueue(), 1000);
      }
      
    } catch (error) {
      console.error('Failed to initialize offline queue:', error);
    }
  }

  /**
   * Queue a request for later execution
   */
  async queueRequest(config) {
    const queueItem = {
      id: uuidv4(),
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: MAX_RETRY_ATTEMPTS,
      config: {
        url: config.url,
        method: config.method || 'get',
        data: config.data,
        params: config.params,
        headers: {
          ...config.headers,
          'X-Queued': 'true',
          'X-Queue-Time': new Date().toISOString()
        }
      },
      priority: config.priority || 'normal', // high, normal, low
      tags: extractTagsFromUrl(config.url)
    };
    
    // Check queue size limit
    const queue = await this.getQueue();
    if (queue.length >= MAX_QUEUE_SIZE) {
      console.warn('Queue is full, dropping oldest request');
      queue.shift();
    }
    
    queue.push(queueItem);
    await this.saveQueue(queue);
    
    // Update stats
    await this.updateStats({ queued: 1 });
    
    // Dispatch event for UI
    window.dispatchEvent(new CustomEvent('queue:updated', {
      detail: { queueLength: queue.length }
    }));
    
    console.log(`Request queued (${queueItem.id}): ${config.method} ${config.url}`);
    
    // Show offline notification
    this.showOfflineNotification();
    
    // Return a promise that will resolve when request is processed
    return new Promise((resolve, reject) => {
      const checkCompletion = setInterval(async () => {
        const completed = await this.isRequestCompleted(queueItem.id);
        if (completed) {
          clearInterval(checkCompletion);
          const result = await this.getRequestResult(queueItem.id);
          if (result.success) {
            resolve(result.response);
          } else {
            reject(result.error);
          }
        }
      }, 1000);
    });
  }

  /**
   * Process all pending requests in the queue
   */
  async processQueue() {
    if (!navigator.onLine) {
      console.log('Still offline, waiting to process queue');
      return;
    }
    
    if (isProcessing) {
      console.log('Queue already being processed');
      return;
    }
    
    isProcessing = true;
    
    try {
      const queue = await this.getQueue();
      
      if (queue.length === 0) {
        isProcessing = false;
        return;
      }
      
      console.log(`Processing ${queue.length} queued requests...`);
      
      // Sort by priority (high first) and then by timestamp
      const sortedQueue = this.sortByPriority(queue);
      
      let processedCount = 0;
      let failedCount = 0;
      
      for (const item of sortedQueue) {
        try {
          const response = await this.executeQueuedRequest(item);
          await this.removeFromQueue(item.id);
          await this.updateStats({ completed: 1 });
          processedCount++;
          
          // Dispatch progress event
          window.dispatchEvent(new CustomEvent('queue:progress', {
            detail: { processed: processedCount, total: queue.length }
          }));
          
        } catch (error) {
          console.error(`Failed to process request ${item.id}:`, error);
          
          // Increment retry count
          item.retryCount++;
          
          if (item.retryCount >= item.maxRetries) {
            // Move to failed queue
            await this.moveToFailed(item, error);
            await this.removeFromQueue(item.id);
            failedCount++;
          } else {
            // Update retry count in queue
            await this.updateQueueItem(item);
          }
        }
        
        // Small delay between requests to avoid overwhelming server
        await this.sleep(500);
      }
      
      console.log(`Queue processed: ${processedCount} succeeded, ${failedCount} failed`);
      
      // Show sync complete notification
      if (processedCount > 0) {
        this.showSyncCompleteNotification(processedCount);
      }
      
    } catch (error) {
      console.error('Error processing queue:', error);
    } finally {
      isProcessing = false;
      
      // Check if more items were added during processing
      const remaining = await this.getQueueSize();
      if (remaining > 0 && navigator.onLine) {
        setTimeout(() => this.processQueue(), 1000);
      }
    }
  }

  /**
   * Execute a specific queued request
   */
  async executeQueuedRequest(item) {
    const { config } = item;
    
    // Reconstruct request
    const requestConfig = {
      url: config.url,
      method: config.method,
      headers: config.headers || {},
      timeout: 15000
    };
    
    if (config.data) {
      requestConfig.data = config.data;
    }
    
    if (config.params) {
      requestConfig.params = config.params;
    }
    
    // Get fresh auth token if needed
    const token = localStorage.getItem('accessToken');
    if (token) {
      requestConfig.headers.Authorization = `Bearer ${token}`;
    }
    
    // Execute request
    const response = await fetch(`${process.env.REACT_APP_API_URL}${config.url}`, {
      method: config.method,
      headers: requestConfig.headers,
      body: config.data ? JSON.stringify(config.data) : undefined
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Store result for promise resolution
    await this.storeRequestResult(item.id, { success: true, response: data });
    
    return data;
  }

  /**
   * Retry failed requests
   */
  async retryFailed() {
    const failed = await this.getFailedQueue();
    
    if (failed.length === 0) return;
    
    console.log(`Retrying ${failed.length} failed requests...`);
    
    for (const item of failed) {
      // Check if retry delay has passed
      const retryDelay = this.calculateRetryDelay(item.retryCount);
      const timeSinceFailure = Date.now() - item.failedAt;
      
      if (timeSinceFailure >= retryDelay) {
        // Move back to main queue
        await this.moveToQueue(item);
        await this.removeFromFailed(item.id);
      }
    }
    
    // Process main queue
    if (navigator.onLine) {
      this.processQueue();
    }
  }

  /**
   * Get current queue
   */
  async getQueue() {
    const queue = await queueDB.getItem(this.queueKey);
    return queue || [];
  }

  /**
   * Save queue
   */
  async saveQueue(queue) {
    await queueDB.setItem(this.queueKey, queue);
  }

  /**
   * Get failed queue
   */
  async getFailedQueue() {
    const failed = await queueDB.getItem(this.failedKey);
    return failed || [];
  }

  /**
   * Move request to failed queue
   */
  async moveToFailed(item, error) {
    const failed = await this.getFailedQueue();
    
    const failedItem = {
      ...item,
      failedAt: Date.now(),
      error: {
        message: error.message,
        status: error.status,
        timestamp: new Date().toISOString()
      }
    };
    
    failed.push(failedItem);
    await queueDB.setItem(this.failedKey, failed);
    
    // Update stats
    await this.updateStats({ failed: 1 });
    
    // Dispatch event for UI
    window.dispatchEvent(new CustomEvent('queue:failed', {
      detail: { item: failedItem }
    }));
  }

  /**
   * Move request back to main queue
   */
  async moveToQueue(item) {
    const queue = await this.getQueue();
    queue.push(item);
    await this.saveQueue(queue);
  }

  /**
   * Remove from queue
   */
  async removeFromQueue(id) {
    const queue = await this.getQueue();
    const filtered = queue.filter(item => item.id !== id);
    await this.saveQueue(filtered);
    
    // Update UI
    window.dispatchEvent(new CustomEvent('queue:updated', {
      detail: { queueLength: filtered.length }
    }));
  }

  /**
   * Remove from failed queue
   */
  async removeFromFailed(id) {
    const failed = await this.getFailedQueue();
    const filtered = failed.filter(item => item.id !== id);
    await queueDB.setItem(this.failedKey, filtered);
  }

  /**
   * Update queue item
   */
  async updateQueueItem(updatedItem) {
    const queue = await this.getQueue();
    const index = queue.findIndex(item => item.id === updatedItem.id);
    
    if (index !== -1) {
      queue[index] = updatedItem;
      await this.saveQueue(queue);
    }
  }

  /**
   * Check if request completed
   */
  async isRequestCompleted(id) {
    const result = await queueDB.getItem(`result_${id}`);
    return result !== null;
  }

  /**
   * Get request result
   */
  async getRequestResult(id) {
    const result = await queueDB.getItem(`result_${id}`);
    await queueDB.removeItem(`result_${id}`);
    return result;
  }

  /**
   * Store request result
   */
  async storeRequestResult(id, result) {
    await queueDB.setItem(`result_${id}`, result);
    
    // Auto-cleanup after 1 hour
    setTimeout(async () => {
      await queueDB.removeItem(`result_${id}`);
    }, 3600000);
  }

  /**
   * Get queue statistics
   */
  async getStats() {
    const stats = await queueDB.getItem(this.statsKey);
    return stats || { queued: 0, completed: 0, failed: 0, lastSync: null };
  }

  /**
   * Update statistics
   */
  async updateStats(update) {
    const stats = await this.getStats();
    const newStats = { ...stats, ...update, lastSync: Date.now() };
    await queueDB.setItem(this.statsKey, newStats);
    return newStats;
  }

  /**
   * Get queue size
   */
  async getQueueSize() {
    const queue = await this.getQueue();
    return queue.length;
  }

  /**
   * Clear all queues
   */
  async clearQueues() {
    await queueDB.removeItem(this.queueKey);
    await queueDB.removeItem(this.failedKey);
    await queueDB.removeItem(this.statsKey);
    console.log('All queues cleared');
  }

  /**
   * Start sync interval
   */
  startSyncInterval() {
    if (syncInterval) clearInterval(syncInterval);
    
    syncInterval = setInterval(() => {
      if (navigator.onLine) {
        this.retryFailed();
      }
    }, SYNC_INTERVAL);
  }

  /**
   * Setup network listeners
   */
  setupNetworkListeners() {
    const handleOnline = () => {
      console.log('Network online, processing queue');
      this.processQueue();
      this.retryFailed();
    };
    
    const handleOffline = () => {
      console.log('Network offline');
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    networkListeners.push({ handleOnline, handleOffline });
  }

  /**
   * Sort queue by priority
   */
  sortByPriority(queue) {
    const priorityOrder = { high: 3, normal: 2, low: 1 };
    
    return [...queue].sort((a, b) => {
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.timestamp - b.timestamp;
    });
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  calculateRetryDelay(retryCount) {
    return BASE_RETRY_DELAY * Math.pow(2, retryCount);
  }

  /**
   * Show offline notification
   */
  showOfflineNotification() {
    // Check if notification already showing
    if (document.querySelector('.offline-notification')) return;
    
    const notification = document.createElement('div');
    notification.className = 'offline-notification';
    notification.innerHTML = `
      <div class="notification-content">
        <span class="icon">📱</span>
        <div>
          <strong>You're offline</strong>
          <p>Your request has been queued and will be sent when you're back online.</p>
        </div>
        <button class="close-btn">×</button>
      </div>
    `;
    
    notification.querySelector('.close-btn').onclick = () => notification.remove();
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) notification.remove();
    }, 5000);
  }

  /**
   * Show sync complete notification
   */
  showSyncCompleteNotification(count) {
    const notification = document.createElement('div');
    notification.className = 'sync-notification';
    notification.innerHTML = `
      <div class="notification-content success">
        <span class="icon">✅</span>
        <div>
          <strong>Sync Complete</strong>
          <p>${count} request${count > 1 ? 's' : ''} synced successfully.</p>
        </div>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      if (notification.parentNode) notification.remove();
    }, 3000);
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Load initial queue
   */
  async loadQueue() {
    const queue = await this.getQueue();
    const failed = await this.getFailedQueue();
    console.log(`Loaded queue: ${queue.length} pending, ${failed.length} failed`);
  }

  /**
   * Cleanup
   */
  destroy() {
    if (syncInterval) clearInterval(syncInterval);
    
    networkListeners.forEach(({ handleOnline, handleOffline }) => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    });
    
    networkListeners = [];
  }
}

/**
 * Extract tags from URL for better queue management
 */
function extractTagsFromUrl(url) {
  const tags = [];
  
  if (url.includes('/orders')) tags.push('order');
  if (url.includes('/payment')) tags.push('payment');
  if (url.includes('/location')) tags.push('location');
  if (url.includes('/profile')) tags.push('profile');
  
  return tags;
}

// Create singleton instance
export const offlineQueue = new OfflineQueue();

// Initialize on import
if (typeof window !== 'undefined') {
  offlineQueue.initialize();
}

// Export for use
export default offlineQueue;