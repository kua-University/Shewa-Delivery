 
// frontend/src/pages/Delivery/DriverMap.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import './DriverMap.css';

const DriverMap = () => {
  const { t } = useTranslation();
  const [currentLocation, setCurrentLocation] = useState(null);
  const [activeOrder, setActiveOrder] = useState(null);
  const [isOnline, setIsOnline] = useState(false);
  const [watchId, setWatchId] = useState(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    // Request location permissions
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
        },
        (error) => {
          console.error('Geolocation error:', error);
        }
      );
    }

    fetchActiveOrder();
    
    return () => {
      if (watchId) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, []);

  const fetchActiveOrder = async () => {
    try {
      const response = await api.get('/delivery/active-order');
      setActiveOrder(response.data.data);
    } catch (error) {
      console.error('No active order:', error);
    }
  };

  const startTracking = () => {
    if (!isOnline) {
      const id = navigator.geolocation.watchPosition(
        async (position) => {
          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed,
            heading: position.coords.heading,
            timestamp: new Date().toISOString()
          };
          
          setCurrentLocation(location);
          
          // Send location to server (ASR-03: high-frequency updates)
          await api.post('/delivery/location/update', {
            driverId: localStorage.getItem('driverId'),
            ...location,
            status: isOnline ? 'active' : 'idle'
          });
          
          // Update map marker
          if (markerRef.current) {
            markerRef.current.setPosition(location);
          }
        },
        (error) => {
          console.error('Watch position error:', error);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 5000
        }
      );
      
      setWatchId(id);
      setIsOnline(true);
      
      // Show notification
      alert(t('driver.trackingStarted'));
    }
  };

  const stopTracking = () => {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
      setIsOnline(false);
      alert(t('driver.trackingStopped'));
    }
  };

  const updateOrderStatus = async (status) => {
    try {
      await api.patch(`/delivery/order/${activeOrder.id}/status`, { status });
      
      if (status === 'delivered') {
        setActiveOrder(null);
        alert(t('driver.orderDelivered'));
      } else {
        setActiveOrder({ ...activeOrder, status });
      }
    } catch (error) {
      console.error('Failed to update order status:', error);
    }
  };

  return (
    <div className="driver-map-container">
      <div className="driver-controls">
        <div className="driver-status">
          <h2>{t('driver.title')}</h2>
          <div className={`status-indicator ${isOnline ? 'online' : 'offline'}`}>
            {isOnline ? t('driver.online') : t('driver.offline')}
          </div>
          
          {!isOnline ? (
            <button onClick={startTracking} className="start-tracking-btn">
              {t('driver.startTracking')}
            </button>
          ) : (
            <button onClick={stopTracking} className="stop-tracking-btn">
              {t('driver.stopTracking')}
            </button>
          )}
        </div>

        {activeOrder && (
          <div className="active-order">
            <h3>{t('driver.activeDelivery')}</h3>
            <div className="order-info">
              <p><strong>{t('driver.orderNumber')}:</strong> #{activeOrder.orderNumber}</p>
              <p><strong>{t('checkout.restaurant')}:</strong> {activeOrder.restaurantName}</p>
              <p><strong>{t('checkout.customer')}:</strong> {activeOrder.customerName}</p>
              <p><strong>{t('checkout.address')}:</strong> {activeOrder.deliveryAddress}</p>
              
              <div className="order-actions">
                {activeOrder.status === 'assigned' && (
                  <button onClick={() => updateOrderStatus('picked_up')}>
                    {t('driver.markPickedUp')}
                  </button>
                )}
                {activeOrder.status === 'picked_up' && (
                  <button onClick={() => updateOrderStatus('delivered')}>
                    {t('driver.markDelivered')}
                  </button>
                )}
              </div>
            </div>
            
            <div className="eta-info">
              <span>🚚 {t('driver.estimatedArrival')}: {activeOrder.eta} {t('driver.minutes')}</span>
            </div>
          </div>
        )}
        
        {currentLocation && (
          <div className="location-info">
            <h4>{t('driver.currentLocation')}</h4>
            <p>📍 {currentLocation.lat?.toFixed(6)}, {currentLocation.lng?.toFixed(6)}</p>
            <p>🎯 {t('driver.accuracy')}: {currentLocation.accuracy?.toFixed(0)}m</p>
            {currentLocation.speed && <p>🚗 {t('driver.speed')}: {currentLocation.speed} km/h</p>}
          </div>
        )}
      </div>
      
      <div id="map" className="map-container" ref={mapRef}>
        {/* Map would be rendered here using Google Maps or Leaflet */}
        <div className="map-placeholder">
          <p>{t('driver.mapLoading')}</p>
          <p className="map-note">{t('driver.mapNote')}</p>
        </div>
      </div>
    </div>
  );
};

export default DriverMap;