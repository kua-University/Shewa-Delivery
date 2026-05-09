 
// frontend/src/App.jsx
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { NotificationProvider } from './contexts/NotificationContext';
import ErrorBoundary from './components/ErrorBoundary';
import LoadingSpinner from './components/LoadingState';
import OfflineNotification from './components/OfflineNotification';
import './i18n/config';
import './App.css';

// Lazy load pages for code splitting (ASR-03: Mobile optimization)
const MenuList = lazy(() => import('./pages/Customer/MenuList'));
const Cart = lazy(() => import('./pages/Customer/Cart'));
const Checkout = lazy(() => import('./pages/Customer/Checkout'));
const OrderTracking = lazy(() => import('./pages/Customer/OrderTracking'));
const RestaurantDashboard = lazy(() => import('./pages/Restaurant/Dashboard'));
const DriverMap = lazy(() => import('./pages/Delivery/DriverMap'));
const OnboardingWizard = lazy(() => import('./pages/OnboardingWizard'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Profile = lazy(() => import('./pages/Profile'));
const OrderHistory = lazy(() => import('./pages/Customer/OrderHistory'));
const RestaurantList = lazy(() => import('./components/CachedRestaurantList'));

// Layout Components
const Header = lazy(() => import('./components/Layout/Header'));
const Footer = lazy(() => import('./components/Layout/Footer'));
const BottomNavigation = lazy(() => import('./components/Layout/BottomNavigation'));

// Loading fallback
const PageLoader = () => (
  <div className="page-loader">
    <LoadingSpinner type="pulse" message="Loading..." />
  </div>
);

// Protected Route Component
const ProtectedRoute = ({ children, allowedRoles = [] }) => {
  const { user, isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return <PageLoader />;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  if (allowedRoles.length > 0 && !allowedRoles.includes(user?.role)) {
    return <Navigate to="/" replace />;
  }
  
  return children;
};

// Main App Content
const AppContent = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  
  useEffect(() => {
    // Network status monitoring
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Responsive detection
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    
    // Register service worker for PWA
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(registration => {
          console.log('SW registered:', registration);
        }).catch(error => {
          console.log('SW registration failed:', error);
        });
      });
    }
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('resize', handleResize);
    };
  }, []);
  
  return (
    <div className={`app ${isMobile ? 'mobile-view' : 'desktop-view'}`}>
      {!isOnline && <OfflineNotification />}
      
      <Suspense fallback={<PageLoader />}>
        <Header />
        
        <main className="app-main">
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<RestaurantList />} />
            <Route path="/restaurants" element={<RestaurantList />} />
            <Route path="/restaurant/:restaurantId" element={<MenuList />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/onboarding" element={<OnboardingWizard />} />
            
            {/* Customer Routes */}
            <Route path="/cart" element={
              <ProtectedRoute allowedRoles={['customer']}>
                <Cart />
              </ProtectedRoute>
            } />
            <Route path="/checkout" element={
              <ProtectedRoute allowedRoles={['customer']}>
                <Checkout />
              </ProtectedRoute>
            } />
            <Route path="/order/:orderId/tracking" element={
              <ProtectedRoute allowedRoles={['customer']}>
                <OrderTracking />
              </ProtectedRoute>
            } />
            <Route path="/orders" element={
              <ProtectedRoute allowedRoles={['customer']}>
                <OrderHistory />
              </ProtectedRoute>
            } />
            
            {/* Restaurant Routes */}
            <Route path="/restaurant/dashboard" element={
              <ProtectedRoute allowedRoles={['restaurant']}>
                <RestaurantDashboard />
              </ProtectedRoute>
            } />
            
            {/* Driver Routes */}
            <Route path="/driver/track" element={
              <ProtectedRoute allowedRoles={['driver']}>
                <DriverMap />
              </ProtectedRoute>
            } />
            
            {/* Profile Route */}
            <Route path="/profile" element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            } />
            
            {/* 404 Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        
        {isMobile && user && <BottomNavigation />}
        <Footer />
      </Suspense>
    </div>
  );
};

// App with Providers
const App = () => {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <NotificationProvider>
          <AuthProvider>
            <Router>
              <AppContent />
            </Router>
          </AuthProvider>
        </NotificationProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
};

export default App;