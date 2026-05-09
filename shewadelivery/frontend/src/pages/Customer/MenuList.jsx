 // frontend/src/pages/Customer/MenuList.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import { useCache } from '../../hooks/useCache';
import LoadingSpinner from '../../components/LoadingSpinner';
import ErrorBoundary from '../../components/ErrorBoundary';
import './MenuList.css';

const MenuList = () => {
  const { restaurantId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [restaurant, setRestaurant] = useState(null);
  const [menu, setMenu] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cart, setCart] = useState(() => {
    const savedCart = localStorage.getItem('cart');
    return savedCart ? JSON.parse(savedCart) : [];
  });

  // Use cached API for menu (ASR-02: 200ms response)
  const { data: cachedMenu, isLoading: cacheLoading } = useCache(
    `/restaurants/${restaurantId}/menu`,
    { ttl: 300, enabled: !!restaurantId }
  );

  useEffect(() => {
    fetchRestaurantAndMenu();
  }, [restaurantId]);

  useEffect(() => {
    // Save cart to localStorage
    localStorage.setItem('cart', JSON.stringify(cart));
  }, [cart]);

  const fetchRestaurantAndMenu = async () => {
    try {
      setLoading(true);
      
      // Fetch restaurant details
      const restaurantRes = await api.get(`/restaurants/${restaurantId}`);
      setRestaurant(restaurantRes.data.data);

      // Fetch menu with caching
      const menuRes = await api.get(`/restaurants/${restaurantId}/menu`);
      const menuData = menuRes.data.data.menu;
      setMenu(menuData);
      
      // Extract unique categories
      const uniqueCategories = ['all', ...new Set(menuData.map(item => item.category))];
      setCategories(uniqueCategories);
      
      setError(null);
    } catch (err) {
      console.error('Failed to fetch menu:', err);
      setError(t('errors.menuLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (item) => {
    const existingItem = cart.find(cartItem => cartItem.id === item.id);
    
    if (existingItem) {
      setCart(cart.map(cartItem =>
        cartItem.id === item.id
          ? { ...cartItem, quantity: cartItem.quantity + 1 }
          : cartItem
      ));
    } else {
      setCart([...cart, { ...item, quantity: 1 }]);
    }

    // Show feedback (optional)
    showAddToCartFeedback(item.name);
  };

  const showAddToCartFeedback = (itemName) => {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = `${itemName} ${t('cart.added')}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  };

  const updateQuantity = (itemId, delta) => {
    setCart(prevCart => {
      const newCart = prevCart.map(item => {
        if (item.id === itemId) {
          const newQuantity = item.quantity + delta;
          if (newQuantity <= 0) return null;
          return { ...item, quantity: newQuantity };
        }
        return item;
      }).filter(item => item !== null);
      
      return newCart;
    });
  };

  const getCartTotal = () => {
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
  };

  const getCartItemCount = () => {
    return cart.reduce((count, item) => count + item.quantity, 0);
  };

  const filteredMenu = selectedCategory === 'all'
    ? menu
    : menu.filter(item => item.category === selectedCategory);

  if (loading || cacheLoading) {
    return <LoadingSpinner message={t('common.loading')} />;
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>{t('errors.error')}</h2>
        <p>{error}</p>
        <button onClick={fetchRestaurantAndMenu} className="retry-btn">
          {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="menu-list-container">
        {/* Restaurant Header */}
        <div className="restaurant-header">
          <div className="restaurant-info">
            <img 
              src={restaurant?.imageUrl || '/images/default-restaurant.png'} 
              alt={restaurant?.name}
              className="restaurant-image"
              loading="lazy"
            />
            <div className="restaurant-details">
              <h1>{restaurant?.name}</h1>
              <p className="restaurant-description">{restaurant?.description}</p>
              <div className="restaurant-meta">
                <span className="rating">⭐ {restaurant?.rating} ({restaurant?.totalRatings}+)</span>
                <span className="delivery-time">🚚 {restaurant?.estimatedDeliveryTime} min</span>
                <span className="delivery-fee">💰 {restaurant?.deliveryFee} ETB</span>
              </div>
            </div>
          </div>
        </div>

        {/* Category Filter */}
        <div className="category-filter">
          <div className="category-scroll">
            {categories.map(category => (
              <button
                key={category}
                className={`category-btn ${selectedCategory === category ? 'active' : ''}`}
                onClick={() => setSelectedCategory(category)}
              >
                {category === 'all' ? t('menu.all') : category}
              </button>
            ))}
          </div>
        </div>

        {/* Menu Items Grid */}
        <div className="menu-grid">
          {filteredMenu.map(item => (
            <div key={item.id} className="menu-item-card">
              <img 
                src={item.imageUrl || '/images/default-menu-item.png'} 
                alt={item.name}
                className="menu-item-image"
                loading="lazy"
              />
              <div className="menu-item-content">
                <div className="menu-item-header">
                  <h3>{item.name}</h3>
                  {item.isPopular && <span className="popular-badge">{t('menu.popular')}</span>}
                </div>
                <p className="menu-item-description">{item.description}</p>
                <div className="menu-item-footer">
                  <span className="price">{item.price} ETB</span>
                  <button 
                    className="add-to-cart-btn"
                    onClick={() => addToCart(item)}
                    disabled={!item.isAvailable}
                  >
                    {item.isAvailable ? t('menu.addToCart') : t('menu.unavailable')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Floating Cart */}
        {cart.length > 0 && (
          <div className="floating-cart">
            <div className="cart-summary" onClick={() => navigate('/checkout')}>
              <div className="cart-info">
                <span className="cart-icon">🛒</span>
                <span className="cart-count">{getCartItemCount()} {t('cart.items')}</span>
                <span className="cart-total">{getCartTotal()} ETB</span>
              </div>
              <button className="view-cart-btn">{t('cart.viewCart')}</button>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default MenuList;
