 
// frontend/src/services/api.js
import axios from 'axios';
import { offlineQueue } from './offlineQueue';
import { cacheManager } from './cacheManager';

// API Configuration
const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://api.shewadelivery.com';
const API_TIMEOUT = 15000; // 15 seconds
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;

// Network status
let isOnline = navigator.onLine;
let pendingRequests = new Map();
let refreshTokenPromise = null;

// Create axios instance
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Request interceptor - Add auth token and request ID
apiClient.interceptors.request.use(
  async (config) => {
    // Add request ID for tracking
    config.headers['X-Request-ID'] = generateRequestId();
    
    // Add auth token if available
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    // Add timestamp for cache busting (optional)
    if (config.method === 'get' && config.params?.nocache) {
      config.params._t = Date.now();
    }
    
    // Track request start time
    config.metadata = { startTime: Date.now() };
    
    // If offline and request is not idempotent, queue it
    if (!isOnline && !isIdempotent(config.method)) {
      return offlineQueue.queueRequest(config);
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - Handle responses and errors
apiClient.interceptors.response.use(
  async (response) => {
    // Calculate response time
    const duration = Date.now() - response.config.metadata.startTime;
    
    // Cache GET responses (ASR-02)
    if (response.config.method === 'get' && response.status === 200) {
      await cacheManager.set(response.config.url, response.data, {
        ttl: getCacheTTL(response.config.url),
        tags: extractCacheTags(response.config.url)
      });
    }
    
    // Log slow requests
    if (duration > 3000) {
      console.warn(`Slow API request: ${response.config.url} took ${duration}ms`);
    }
    
    return response;
  },
  async (error) => {
    const originalRequest = error.config;
    
    // Handle network errors (offline)
    if (!navigator.onLine || error.message === 'Network Error') {
      isOnline = false;
      
      // Try to get from cache first
      const cachedResponse = await cacheManager.get(originalRequest.url);
      if (cachedResponse && originalRequest.method === 'get') {
        console.log('Returning cached response (offline mode)');
        return Promise.resolve({ data: cachedResponse, fromCache: true });
      }
      
      // Queue the request for later
      if (isIdempotent(originalRequest.method)) {
        return offlineQueue.queueRequest(originalRequest);
      }
      
      return Promise.reject({
        message: 'You are offline. Please check your connection.',
        offline: true,
        status: 0
      });
    }
    
    // Handle token refresh (401)
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        const newToken = await refreshAccessToken();
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Redirect to login
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.dispatchEvent(new CustomEvent('auth:logout'));
        return Promise.reject(refreshError);
      }
    }
    
    // Handle rate limiting (429)
    if (error.response?.status === 429) {
      const retryAfter = error.response.headers['retry-after'] || 60;
      console.warn(`Rate limited. Retry after ${retryAfter} seconds`);
      
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(apiClient(originalRequest));
        }, retryAfter * 1000);
      });
    }
    
    // Retry logic for server errors (5xx)
    if (error.response?.status >= 500 && error.response?.status < 600) {
      if (!originalRequest._retryCount) {
        originalRequest._retryCount = 0;
      }
      
      if (originalRequest._retryCount < RETRY_ATTEMPTS) {
        originalRequest._retryCount++;
        const delay = RETRY_DELAY * Math.pow(2, originalRequest._retryCount);
        
        console.log(`Retrying request (${originalRequest._retryCount}/${RETRY_ATTEMPTS}) after ${delay}ms`);
        
        await sleep(delay);
        return apiClient(originalRequest);
      }
    }
    
    // Format error for UI
    const formattedError = formatError(error);
    return Promise.reject(formattedError);
  }
);

// Network status monitoring
window.addEventListener('online', handleOnline);
window.addEventListener('offline', handleOffline);

function handleOnline() {
  isOnline = true;
  console.log('Network connection restored');
  
  // Process offline queue
  offlineQueue.processQueue();
  
  // Refresh data
  window.dispatchEvent(new CustomEvent('network:online'));
}

function handleOffline() {
  isOnline = false;
  console.log('Network connection lost');
  window.dispatchEvent(new CustomEvent('network:offline'));
}

// Helper Functions
function generateRequestId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function isIdempotent(method) {
  const idempotentMethods = ['get', 'head', 'options', 'put', 'delete'];
  return idempotentMethods.includes(method.toLowerCase());
}

function getCacheTTL(url) {
  // Different TTLs for different endpoints (ASR-02)
  if (url.includes('/restaurants')) return 300; // 5 minutes
  if (url.includes('/menu')) return 300; // 5 minutes
  if (url.includes('/orders')) return 10; // 10 seconds
  if (url.includes('/location')) return 2; // 2 seconds
  return 60; // 1 minute default
}

function extractCacheTags(url) {
  const tags = [];
  if (url.includes('/restaurants')) tags.push('restaurants');
  if (url.includes('/menu')) tags.push('menu');
  if (url.includes('/orders')) tags.push('orders');
  return tags;
}

async function refreshAccessToken() {
  if (refreshTokenPromise) {
    return refreshTokenPromise;
  }
  
  refreshTokenPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) throw new Error('No refresh token');
      
      const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
        refreshToken
      });
      
      const { accessToken, refreshToken: newRefreshToken } = response.data.data;
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', newRefreshToken);
      
      return accessToken;
    } catch (error) {
      throw error;
    } finally {
      refreshTokenPromise = null;
    }
  })();
  
  return refreshTokenPromise;
}

function formatError(error) {
  if (error.response) {
    // Server responded with error
    return {
      message: error.response.data?.message || 'An error occurred',
      status: error.response.status,
      data: error.response.data,
      original: error
    };
  } else if (error.request) {
    // Request made but no response
    return {
      message: 'Unable to connect to server. Please check your connection.',
      status: 0,
      offline: !navigator.onLine,
      original: error
    };
  } else {
    // Something else happened
    return {
      message: error.message || 'Request failed',
      status: -1,
      original: error
    };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// API Methods
const api = {
  // GET request with caching
  get: async (url, params = {}, options = {}) => {
    const { useCache = true, cacheTTL, forceRefresh = false } = options;
    
    // Try cache first (ASR-02)
    if (useCache && !forceRefresh) {
      const cached = await cacheManager.get(url);
      if (cached && !isCacheExpired(cached)) {
        console.log(`Cache hit: ${url}`);
        return { data: cached.data, fromCache: true };
      }
    }
    
    const response = await apiClient.get(url, { params });
    return response;
  },
  
  // POST request
  post: async (url, data = {}, options = {}) => {
    const { retryOnOffline = true, priority = 'normal' } = options;
    
    // If offline and retry enabled, queue for later
    if (!navigator.onLine && retryOnOffline) {
      return offlineQueue.queueRequest({
        url,
        method: 'post',
        data,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const response = await apiClient.post(url, data);
    
    // Invalidate related cache after POST
    await invalidateCacheForUrl(url);
    
    return response;
  },
  
  // PUT request
  put: async (url, data = {}) => {
    const response = await apiClient.put(url, data);
    await invalidateCacheForUrl(url);
    return response;
  },
  
  // PATCH request
  patch: async (url, data = {}) => {
    const response = await apiClient.patch(url, data);
    await invalidateCacheForUrl(url);
    return response;
  },
  
  // DELETE request
  delete: async (url) => {
    const response = await apiClient.delete(url);
    await invalidateCacheForUrl(url);
    return response;
  },
  
  // Upload file with progress
  upload: async (url, file, onProgress = null) => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await apiClient.post(url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent) => {
        if (onProgress) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percentCompleted);
        }
      }
    });
    
    return response;
  },
  
  // Batch requests (for 3G optimization - ASR-03)
  batch: async (requests) => {
    const batchId = generateRequestId();
    console.log(`Batch request ${batchId}: ${requests.length} requests`);
    
    const results = await Promise.allSettled(
      requests.map(async (req) => {
        try {
          const response = await apiClient(req);
          return { success: true, data: response.data };
        } catch (error) {
          return { success: false, error: formatError(error) };
        }
      })
    );
    
    return results;
  },
  
  // Check network status
  isOnline: () => isOnline,
  
  // Get pending requests count
  getPendingCount: () => pendingRequests.size,
  
  // Clear all caches
  clearCache: async () => {
    await scacheManager.clear();
  }
};

// Helper to invalidate cache for URL patterns
async function invalidateCacheForUrl(url) {
  const patterns = [
    '/restaurants', '/menu', '/orders', '/profile'
  ];
  
  for (const pattern of patterns) {
    if (url.includes(pattern)) {
      await cacheManager.invalidate(pattern);
      console.log(`Cache invalidated for pattern: ${pattern}`);
      break;
    }
  }
}

function isCacheExpired(cached) {
  if (!cached || !cached.timestamp) return true;
  const ttl = cached.ttl || 300;
  const age = (Date.now() - cached.timestamp) / 1000;
  return age > ttl;
}

export default api;