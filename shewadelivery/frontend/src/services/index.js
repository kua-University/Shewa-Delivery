// frontend/src/services/index.js
export { default as api } from './api';
export { default as offlineQueue } from './offlineQueue';
export { cacheManager } from './cacheManager';

// Helper to check if app is online
export const isOnline = () => navigator.onLine;

// Helper to get pending requests count
export const getPendingRequestsCount = async () => {
  const stats = await offlineQueue.getStats();
  return stats.queued;
};

// Helper to sync now
export const syncNow = () => {
  if (navigator.onLine) {
    offlineQueue.processQueue();
    offlineQueue.retryFailed();
  }
};