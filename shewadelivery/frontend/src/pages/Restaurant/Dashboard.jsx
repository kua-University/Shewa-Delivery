 // frontend/src/pages/Restaurant/Dashboard.jsx
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import { useWebSocket } from '../../hooks/useWebSocket';
import './Dashboard.css';

const Dashboard = () => {
  const { t } = useTranslation();
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState({
    todayOrders: 0,
    todayRevenue: 0,
    activeDrivers: 0,
    pendingOrders: 0
  });
  const [selectedOrder, setSelectedOrder] = useState(null);
  
  // WebSocket for real-time orders (ASR-03: real-time updates)
  const { lastMessage } = useWebSocket('/ws/restaurant/orders');

  useEffect(() => {
    fetchOrders();
    fetchStats();
  }, []);

  useEffect(() => {
    if (lastMessage) {
      const newOrder = JSON.parse(lastMessage.data);
      setOrders(prev => [newOrder, ...prev]);
      // Show notification
      showNotification(t('dashboard.newOrder'), newOrder.orderNumber);
    }
  }, [lastMessage]);

  const fetchOrders = async () => {
    try {
      const response = await api.get('/restaurant/orders');
      setOrders(response.data.data);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await api.get('/restaurant/stats');
      setStats(response.data.data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const updateOrderStatus = async (orderId, status) => {
    try {
      await api.patch(`/restaurant/orders/${orderId}/status`, { status });
      
      setOrders(prev => prev.map(order =>
        order.id === orderId ? { ...order, status } : order
      ));
      
      fetchStats();
      showNotification(t('dashboard.orderUpdated'), `Order #${orderId} ${status}`);
    } catch (error) {
      console.error('Failed to update order:', error);
    }
  };

  const showNotification = (title, body) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  };

  const getStatusBadgeClass = (status) => {
    const classes = {
      pending_payment: 'status-pending',
      confirmed: 'status-confirmed',
      preparing: 'status-preparing',
      ready: 'status-ready',
      delivering: 'status-delivering',
      delivered: 'status-delivered',
      cancelled: 'status-cancelled'
    };
    return classes[status] || 'status-default';
  };

  return (
    <div className="restaurant-dashboard">
      <header className="dashboard-header">
        <h1>{t('dashboard.title')}</h1>
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-value">{stats.todayOrders}</span>
            <span className="stat-label">{t('dashboard.todayOrders')}</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.todayRevenue} ETB</span>
            <span className="stat-label">{t('dashboard.todayRevenue')}</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.activeDrivers}</span>
            <span className="stat-label">{t('dashboard.activeDrivers')}</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.pendingOrders}</span>
            <span className="stat-label">{t('dashboard.pendingOrders')}</span>
          </div>
        </div>
      </header>

      <div className="orders-section">
        <h2>{t('dashboard.recentOrders')}</h2>
        <div className="orders-list">
          {orders.map(order => (
            <div key={order.id} className="order-card">
              <div className="order-header">
                <div>
                  <h3>{t('dashboard.order')} #{order.orderNumber}</h3>
                  <span className={`status-badge ${getStatusBadgeClass(order.status)}`}>
                    {t(`orders.status.${order.status}`)}
                  </span>
                </div>
                <div className="order-actions">
                  {order.status === 'confirmed' && (
                    <button onClick={() => updateOrderStatus(order.id, 'preparing')}>
                      {t('dashboard.startPreparing')}
                    </button>
                  )}
                  {order.status === 'preparing' && (
                    <button onClick={() => updateOrderStatus(order.id, 'ready')}>
                      {t('dashboard.markReady')}
                    </button>
                  )}
                  {order.status === 'ready' && (
                    <button onClick={() => updateOrderStatus(order.id, 'delivering')}>
                      {t('dashboard.assignDriver')}
                    </button>
                  )}
                </div>
              </div>
              
              <div className="order-details">
                <p><strong>{t('checkout.customer')}:</strong> {order.customerName}</p>
                <p><strong>{t('checkout.phone')}:</strong> {order.customerPhone}</p>
                <p><strong>{t('checkout.address')}:</strong> {order.deliveryAddress}</p>
                <p><strong>{t('checkout.total')}:</strong> {order.totalAmount} ETB</p>
                
                <div className="order-items">
                  <strong>{t('checkout.items')}:</strong>
                  {order.items.map(item => (
                    <div key={item.id} className="order-item">
                      {item.quantity}x {item.name} - {item.price} ETB
                    </div>
                  ))}
                </div>
                
                {order.specialInstructions && (
                  <p><strong>{t('checkout.specialInstructions')}:</strong> {order.specialInstructions}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
