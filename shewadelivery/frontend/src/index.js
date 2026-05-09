 
// frontend/src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import reportWebVitals from './reportWebVitals';
import './index.css';

// PWA Registration
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

// Initialize error tracking (optional)
const initErrorTracking = () => {
  if (process.env.NODE_ENV === 'production' && window.Sentry) {
    window.Sentry.init({
      dsn: process.env.REACT_APP_SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1
    });
  }
};

// Initialize performance monitoring
const initPerformanceMonitoring = () => {
  if ('performance' in window && process.env.NODE_ENV === 'production') {
    // Report Core Web Vitals
    reportWebVitals(console.log);
    
    // Custom performance marks
    window.performance.mark('app-start');
    
    window.addEventListener('load', () => {
      window.performance.mark('app-loaded');
      window.performance.measure('app-load-time', 'app-start', 'app-loaded');
    });
  }
};

// Setup offline detection
const setupOfflineDetection = () => {
  window.addEventListener('online', () => {
    console.log('App is online');
    document.body.classList.remove('offline-mode');
  });
  
  window.addEventListener('offline', () => {
    console.log('App is offline');
    document.body.classList.add('offline-mode');
  });
};

// Initialize app
const initApp = () => {
  initErrorTracking();
  initPerformanceMonitoring();
  setupOfflineDetection();
  
  // Check for updates (PWA)
  if ('serviceWorker' in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }
};

// Render app
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

const root = ReactDOM.createRoot(rootElement);

initApp();

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Service worker registration
serviceWorkerRegistration.register({
  onUpdate: (registration) => {
    // Show update notification to user
    const updateEvent = new CustomEvent('app-update-available', {
      detail: { registration }
    });
    window.dispatchEvent(updateEvent);
  },
  onSuccess: (registration) => {
    console.log('Service worker registered successfully');
  }
});

// Export for testing
export { reportWebVitals };