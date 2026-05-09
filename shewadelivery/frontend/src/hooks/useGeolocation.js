// frontend/src/hooks/useGeolocation.js
import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook for geolocation with fallback and error handling
 * Optimized for mobile devices and 3G networks
 * ASR-03: Mobile-first design for Ethiopian cities
 */
export const useGeolocation = (options = {}) => {
  const {
    enableHighAccuracy = false,  // Set to true for GPS, false for battery saving
    timeout = 10000,              // 10 second timeout for 3G networks
    maximumAge = 30000,          // 30 seconds maximum age
    watch = false,               // Watch position continuously
    fallbackLocation = {         // Fallback to Addis Ababa center
      latitude: 9.0054,
      longitude: 38.7636,
      accuracy: 1000
    }
  } = options;

  const [location, setLocation] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState('prompt'); // 'prompt', 'granted', 'denied'
  const [accuracy, setAccuracy] = useState(null);
  const [isWatching, setIsWatching] = useState(false);
  
  const watchIdRef = useRef(null);
  const lastUpdateRef = useRef(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  /**
   * Check if geolocation is supported
   */
  const isSupported = () => {
    return 'geolocation' in navigator;
  };

  /**
   * Get current position with retry logic
   */
  const getCurrentPosition = useCallback(() => {
    if (!isSupported()) {
      setError({
        code: 0,
        message: 'Geolocation is not supported by your browser'
      });
      setLocation(fallbackLocation);
      setLoading(false);
      return Promise.reject(new Error('Geolocation not supported'));
    }

    setLoading(true);
    setError(null);

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // Success handler
          const locationData = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            altitudeAccuracy: position.coords.altitudeAccuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            timestamp: new Date(position.timestamp),
            source: 'gps'
          };

          setLocation(locationData);
          setAccuracy(position.coords.accuracy);
          setError(null);
          setLoading(false);
          retryCountRef.current = 0;
          
          // Update permission status
          setPermission('granted');
          
          lastUpdateRef.current = Date.now();
          resolve(locationData);
        },
        (error) => {
          // Error handler with retry logic
          console.error('Geolocation error:', error);
          
          let errorMessage = '';
          let fallbackUsed = false;
          
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'Location permission denied. Please enable location services.';
              setPermission('denied');
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Location information is unavailable.';
              break;
            case error.TIMEOUT:
              errorMessage = 'Location request timed out. Using approximate location.';
              // Try fallback to IP-based location
              fallbackUsed = true;
              break;
            default:
              errorMessage = 'An unknown error occurred.';
          }
          
          // Retry logic for timeout on 3G networks
          if (error.code === error.TIMEOUT && retryCountRef.current < maxRetries) {
            retryCountRef.current++;
            console.log(`Retrying geolocation (${retryCountRef.current}/${maxRetries})...`);
            
            setTimeout(() => {
              getCurrentPosition().then(resolve).catch(reject);
            }, 2000 * retryCountRef.current);
            return;
          }
          
          // Use fallback location for Ethiopian cities
          const fallbackData = { ...fallbackLocation, source: 'fallback' };
          setLocation(fallbackData);
          setError({
            code: error.code,
            message: errorMessage,
            fallbackUsed
          });
          setLoading(false);
          
          reject(error);
        },
        {
          enableHighAccuracy,
          timeout,
          maximumAge
        }
      );
    });
  }, [enableHighAccuracy, timeout, maximumAge, fallbackLocation]);

  /**
   * Watch position continuously (for delivery drivers)
   */
  const startWatching = useCallback(() => {
    if (!isSupported() || isWatching) return;

    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const locationData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          altitudeAccuracy: position.coords.altitudeAccuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          timestamp: new Date(position.timestamp),
          source: 'gps'
        };
        
        setLocation(locationData);
        setAccuracy(position.coords.accuracy);
        setError(null);
        setLoading(false);
        lastUpdateRef.current = Date.now();
      },
      (error) => {
        console.error('Watch position error:', error);
        setError({
          code: error.code,
          message: error.message
        });
      },
      {
        enableHighAccuracy: true, // Drivers need high accuracy
        timeout: 5000,
        maximumAge: 0 // No cached positions for real-time tracking
      }
    );

    setIsWatching(true);
  }, []);

  /**
   * Stop watching position
   */
  const stopWatching = useCallback(() => {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      setIsWatching(false);
    }
  }, []);

  /**
   * Request permission explicitly (for iOS)
   */
  const requestPermission = useCallback(async () => {
    if (!isSupported()) {
      return { granted: false, message: 'Geolocation not supported' };
    }

    try {
      const position = await getCurrentPosition();
      if (position) {
        setPermission('granted');
        return { granted: true, location: position };
      }
    } catch (error) {
      setPermission('denied');
      return { granted: false, message: error.message };
    }
  }, [getCurrentPosition]);

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  const calculateDistance = useCallback((lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }, []);

  /**
   * Check if user is within delivery zone (Ethiopian cities)
   */
  const isInDeliveryZone = useCallback((latitude, longitude) => {
    // Define delivery zones for Ethiopian cities
    const zones = {
      'Addis Ababa': { lat: 9.0054, lng: 38.7636, radius: 15 },
      'Bahir Dar': { lat: 11.5742, lng: 37.3613, radius: 10 },
      'Dire Dawa': { lat: 9.5944, lng: 41.8500, radius: 10 },
      'Mekelle': { lat: 13.4967, lng: 39.4750, radius: 10 },
      'Gondar': { lat: 12.6030, lng: 37.3910, radius: 10 },
      'Hawassa': { lat: 7.0500, lng: 38.4667, radius: 10 }
    };
    
    for (const [city, zone] of Object.entries(zones)) {
      const distance = calculateDistance(latitude, longitude, zone.lat, zone.lng);
      if (distance <= zone.radius) {
        return { inZone: true, city, distance };
      }
    }
    
    return { inZone: false, city: null, distance: null };
  }, [calculateDistance]);

  /**
   * Get address from coordinates (reverse geocoding)
   */
  const getAddressFromCoordinates = useCallback(async (latitude, longitude) => {
    try {
      // Use OpenStreetMap Nominatim for reverse geocoding (free, no API key)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'ShewaDelivery/1.0'
          }
        }
      );
      
      const data = await response.json();
      
      if (data && data.display_name) {
        return {
          address: data.display_name,
          city: data.address?.city || data.address?.town || data.address?.state,
          area: data.address?.suburb || data.address?.neighbourhood,
          street: data.address?.road,
          building: data.address?.building,
          postcode: data.address?.postcode,
          fullData: data.address
        };
      }
      
      return { address: `${latitude}, ${longitude}` };
      
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
      return { address: `${latitude}, ${longitude}` };
    }
  }, []);

  /**
   * Get current city from location
   */
  const getCurrentCity = useCallback(async () => {
    if (!location) return null;
    
    try {
      const address = await getAddressFromCoordinates(location.latitude, location.longitude);
      return address.city || 'Addis Ababa';
    } catch (error) {
      console.error('Failed to get city:', error);
      return 'Addis Ababa';
    }
  }, [location, getAddressFromCoordinates]);

  /**
   * Get user-friendly location name (Ethiopian cities)
   */
  const getLocationName = useCallback(() => {
    if (!location) return null;
    
    const zone = isInDeliveryZone(location.latitude, location.longitude);
    if (zone.inZone) {
      return zone.city;
    }
    
    return `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
  }, [location, isInDeliveryZone]);

  /**
   * Format location for display
   */
  const getFormattedLocation = useCallback(() => {
    if (!location) return null;
    
    return {
      lat: location.latitude.toFixed(6),
      lng: location.longitude.toFixed(6),
      accuracy: location.accuracy ? `${Math.round(location.accuracy)}m` : null,
      source: location.source,
      timestamp: location.timestamp?.toLocaleTimeString()
    };
  }, [location]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // Auto-get location on mount if not watching
  useEffect(() => {
    if (!watch) {
      getCurrentPosition();
    }
  }, [getCurrentPosition, watch]);

  return {
    // State
    location,
    error,
    loading,
    permission,
    accuracy,
    isWatching,
    isSupported: isSupported(),
    
    // Methods
    getCurrentPosition,
    startWatching,
    stopWatching,
    requestPermission,
    calculateDistance,
    isInDeliveryZone,
    getAddressFromCoordinates,
    getCurrentCity,
    getLocationName,
    getFormattedLocation,
    
    // Helpers
    lastUpdate: lastUpdateRef.current
  };
};

/**
 * Hook for driver location tracking (high frequency updates)
 */
export const useDriverLocation = (options = {}) => {
  const {
    onLocationChange,
    onError,
    updateInterval = 3000, // 3 seconds for 3G networks
    sendToServer = true
  } = options;

  const [locations, setLocations] = useState([]);
  const [isTracking, setIsTracking] = useState(false);
  const intervalRef = useRef(null);
  const { location, error, startWatching, stopWatching, getCurrentPosition } = useGeolocation({
    enableHighAccuracy: true,
    timeout: 5000,
    watch: true
  });

  /**
   * Start tracking location
   */
  const startTracking = useCallback(() => {
    if (isTracking) return;
    
    startWatching();
    setIsTracking(true);
    
    // Also set up interval for sending to server
    if (sendToServer) {
      intervalRef.current = setInterval(async () => {
        if (location) {
          try {
            // Send location to server
            const response = await fetch('/api/delivery/location/update', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
              },
              body: JSON.stringify({
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy: location.accuracy,
                speed: location.speed,
                heading: location.heading,
                timestamp: location.timestamp
              })
            });
            
            if (onLocationChange) {
              onLocationChange(location);
            }
          } catch (err) {
            console.error('Failed to send location:', err);
            if (onError) onError(err);
          }
        }
      }, updateInterval);
    }
  }, [startWatching, sendToServer, updateInterval, location, onLocationChange, onError, isTracking]);

  /**
   * Stop tracking
   */
  const stopTracking = useCallback(() => {
    stopWatching();
    setIsTracking(false);
    
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [stopWatching]);

  /**
   * Get location history
   */
  const getLocationHistory = useCallback(() => {
    return locations;
  }, [locations]);

  /**
   * Add location to history
   */
  useEffect(() => {
    if (location && isTracking) {
      setLocations(prev => [...prev.slice(-50), location]); // Keep last 50 locations
    }
  }, [location, isTracking]);

  /**
   * Cleanup
   */
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    location,
    error,
    isTracking,
    locations,
    startTracking,
    stopTracking,
    getLocationHistory
  };
};

/**
 * Hook for customer location (single update, cached)
 */
export const useCustomerLocation = () => {
  const [cachedLocation, setCachedLocation] = useState(null);
  const { location, loading, error, getCurrentPosition, isInDeliveryZone } = useGeolocation({
    enableHighAccuracy: false, // Battery saving for customers
    timeout: 8000,
    maximumAge: 60000 // Cache for 1 minute
  });

  /**
   * Get cached location from localStorage
   */
  useEffect(() => {
    const saved = localStorage.getItem('customerLocation');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const age = Date.now() - parsed.timestamp;
        if (age < 3600000) { // Less than 1 hour old
          setCachedLocation(parsed.location);
        }
      } catch (e) {
        console.error('Failed to parse saved location');
      }
    }
  }, []);

  /**
   * Save location to cache
   */
  useEffect(() => {
    if (location) {
      const toCache = {
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy
        },
        timestamp: Date.now()
      };
      
      localStorage.setItem('customerLocation', JSON.stringify(toCache));
      setCachedLocation(toCache.location);
    }
  }, [location]);

  return {
    location: location || cachedLocation,
    loading,
    error,
    refreshLocation: getCurrentPosition,
    isInDeliveryZone: location ? isInDeliveryZone(location.latitude, location.longitude) : null
  };
};

export default useGeolocation;