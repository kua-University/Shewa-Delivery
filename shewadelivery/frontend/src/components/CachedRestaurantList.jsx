 // frontend/src/components/CachedRestaurantList.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCache } from '../hooks/useCache';
import { useGeolocation } from '../hooks/useGeolocation';
import LoadingState from './LoadingState';
import ErrorBoundary from './ErrorBoundary';
import './CachedRestaurantList.css';

const CachedRestaurantList = ({ 
  city, 
  cuisine, 
  showFilters = true,
  limit = 20,
  className = '' 
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { location, error: locationError } = useGeolocation();
  const [restaurants, setRestaurants] = useState([]);
  const [filteredRestaurants, setFilteredRestaurants] = useState([]);
  const [filters, setFilters] = useState({
    search: '',
    cuisine: cuisine || 'all',
    rating: 0,
    deliveryTime: 0,
    priceRange: 'all'
  });
  const [sortBy, setSortBy] = useState('rating');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // Use cached API for restaurant list (ASR-02: 200ms response)
  const { 
    data: cachedData, 
    isLoading, 
    error,
    refetch 
  } = useCache(
    `/restaurants?page=${page}&limit=${limit}&city=${city || ''}&cuisine=${filters.cuisine !== 'all' ? filters.cuisine : ''}`,
    { 
      ttl: 300, // 5 minutes cache
      enabled: true,
      staleTime: 60 // Consider stale after 1 minute
    }
  );

  useEffect(() => {
    if (cachedData && cachedData.data) {
      if (page === 1) {
        setRestaurants(cachedData.data);
      } else {
        setRestaurants(prev => [...prev, ...cachedData.data]);
      }
      setHasMore(cachedData.data.length === limit);
    }
  }, [cachedData, page, limit]);

  useEffect(() => {
    applyFiltersAndSort();
  }, [restaurants, filters, sortBy, location]);

  const applyFiltersAndSort = useCallback(() => {
    let filtered = [...restaurants];

    // Search filter
    if (filters.search) {
      filtered = filtered.filter(restaurant =>
        restaurant.name.toLowerCase().includes(filters.search.toLowerCase()) ||
        restaurant.description?.toLowerCase().includes(filters.search.toLowerCase())
      );
    }

    // Cuisine filter
    if (filters.cuisine !== 'all') {
      filtered = filtered.filter(restaurant =>
        restaurant.cuisine?.includes(filters.cuisine)
      );
    }

    // Rating filter
    if (filters.rating > 0) {
      filtered = filtered.filter(restaurant => restaurant.rating >= filters.rating);
    }

    // Delivery time filter
    if (filters.deliveryTime > 0) {
      filtered = filtered.filter(restaurant => 
        restaurant.estimatedDeliveryTime <= filters.deliveryTime
      );
    }

    // Price range filter
    if (filters.priceRange !== 'all') {
      const ranges = {
        low: { min: 0, max: 100 },
        medium: { min: 100, max: 300 },
        high: { min: 300, max: Infinity }
      };
      const range = ranges[filters.priceRange];
      filtered = filtered.filter(restaurant =>
        restaurant.deliveryFee >= range.min && restaurant.deliveryFee <= range.max
      );
    }

    // Sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'rating':
          return b.rating - a.rating;
        case 'deliveryTime':
          return a.estimatedDeliveryTime - b.estimatedDeliveryTime;
        case 'distance':
          if (location) {
            const distA = calculateDistance(
              location.latitude, location.longitude,
              a.location?.lat, a.location?.lng
            );
            const distB = calculateDistance(
              location.latitude, location.longitude,
              b.location?.lat, b.location?.lng
            );
            return distA - distB;
          }
          return 0;
        case 'name':
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    setFilteredRestaurants(filtered);
  }, [restaurants, filters, sortBy, location]);

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const loadMore = () => {
    if (!isLoading && hasMore) {
      setPage(prev => prev + 1);
    }
  };

  const handleRestaurantClick = (restaurantId) => {
    navigate(`/restaurant/${restaurantId}`);
  };

  const getCuisineIcon = (cuisine) => {
    const icons = {
      'Ethiopian': '🇪🇹',
      'Italian': '🇮🇹',
      'American': '🇺🇸',
      'Chinese': '🇨🇳',
      'Indian': '🇮🇳',
      'Fast Food': '🍔',
      'Pizza': '🍕',
      'Local': '🥘'
    };
    return icons[cuisine] || '🍽️';
  };

  const FilterSection = () => (
    <div className="filter-section">
      <div className="search-bar">
        <input
          type="text"
          placeholder={t('restaurants.searchPlaceholder')}
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="search-input"
        />
        <button className="search-btn">🔍</button>
      </div>

      <div className="filter-row">
        <select 
          value={filters.cuisine} 
          onChange={(e) => setFilters({ ...filters, cuisine: e.target.value })}
          className="filter-select"
        >
          <option value="all">{t('restaurants.allCuisines')}</option>
          <option value="Ethiopian">🇪🇹 {t('restaurants.ethiopian')}</option>
          <option value="Italian">🇮🇹 {t('restaurants.italian')}</option>
          <option value="American">🇺🇸 {t('restaurants.american')}</option>
          <option value="Chinese">🇨🇳 {t('restaurants.chinese')}</option>
          <option value="Fast Food">🍔 {t('restaurants.fastFood')}</option>
        </select>

        <select 
          value={sortBy} 
          onChange={(e) => setSortBy(e.target.value)}
          className="filter-select"
        >
          <option value="rating">{t('restaurants.sortByRating')}</option>
          <option value="deliveryTime">{t('restaurants.sortByTime')}</option>
          <option value="distance">{t('restaurants.sortByDistance')}</option>
          <option value="name">{t('restaurants.sortByName')}</option>
        </select>
      </div>

      <div className="filter-tags">
        <button 
          className={`filter-tag ${filters.rating === 0 ? 'active' : ''}`}
          onClick={() => setFilters({ ...filters, rating: 0 })}
        >
          {t('restaurants.allRatings')}
        </button>
        <button 
          className={`filter-tag ${filters.rating === 3.5 ? 'active' : ''}`}
          onClick={() => setFilters({ ...filters, rating: 3.5 })}
        >
          ⭐ 3.5+
        </button>
        <button 
          className={`filter-tag ${filters.rating === 4 ? 'active' : ''}`}
          onClick={() => setFilters({ ...filters, rating: 4 })}
        >
          ⭐ 4.0+
        </button>
        <button 
          className={`filter-tag ${filters.deliveryTime === 30 ? 'active' : ''}`}
          onClick={() => setFilters({ ...filters, deliveryTime: 30 })}
        >
          🚚 {t('restaurants.under30min')}
        </button>
        <button 
          className={`filter-tag ${filters.deliveryTime === 45 ? 'active' : ''}`}
          onClick={() => setFilters({ ...filters, deliveryTime: 45 })}
        >
          🚚 {t('restaurants.under45min')}
        </button>
      </div>
    </div>
  );

  const RestaurantCard = ({ restaurant }) => (
    <div 
      className="restaurant-card"
      onClick={() => handleRestaurantClick(restaurant.id)}
      role="button"
      tabIndex={0}
      onKeyPress={(e) => e.key === 'Enter' && handleRestaurantClick(restaurant.id)}
    >
      <div className="card-image">
        <img 
          src={restaurant.imageUrl || '/images/default-restaurant.png'} 
          alt={restaurant.name}
          loading="lazy"
        />
        {restaurant.isOpen ? (
          <span className="open-badge">{t('restaurants.open')}</span>
        ) : (
          <span className="closed-badge">{t('restaurants.closed')}</span>
        )}
      </div>
      
      <div className="card-content">
        <div className="card-header">
          <h3>{restaurant.name}</h3>
          <div className="rating">
            ⭐ {restaurant.rating} ({restaurant.totalRatings})
          </div>
        </div>
        
        <div className="cuisine-tags">
          {restaurant.cuisine?.slice(0, 2).map(c => (
            <span key={c} className="cuisine-tag">
              {getCuisineIcon(c)} {c}
            </span>
          ))}
        </div>
        
        <p className="restaurant-description">{restaurant.description}</p>
        
        <div className="card-footer">
          <div className="delivery-info">
            <span>🚚 {restaurant.deliveryFee} ETB</span>
            <span>⏱️ {restaurant.estimatedDeliveryTime} min</span>
            <span>📍 {restaurant.city}</span>
          </div>
          <button className="order-now-btn">
            {t('restaurants.orderNow')}
          </button>
        </div>
      </div>
    </div>
  );

  if (isLoading && page === 1) {
    return <LoadingState type="restaurant" count={6} />;
  }

  if (error) {
    return (
      <div className="error-state">
        <p>{t('errors.loadFailed')}</p>
        <button onClick={() => refetch()} className="retry-btn">
          {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className={`cached-restaurant-list ${className}`}>
        {showFilters && <FilterSection />}
        
        {filteredRestaurants.length === 0 ? (
          <div className="no-results">
            <div className="no-results-icon">🍽️</div>
            <h3>{t('restaurants.noResults')}</h3>
            <p>{t('restaurants.noResultsMessage')}</p>
            <button onClick={() => setFilters({ search: '', cuisine: 'all', rating: 0, deliveryTime: 0, priceRange: 'all' })}>
              {t('restaurants.clearFilters')}
            </button>
          </div>
        ) : (
          <>
            <div className="restaurants-grid">
              {filteredRestaurants.map(restaurant => (
                <RestaurantCard key={restaurant.id} restaurant={restaurant} />
              ))}
            </div>
            
            {hasMore && (
              <div className="load-more">
                <button 
                  onClick={loadMore} 
                  disabled={isLoading}
                  className="load-more-btn"
                >
                  {isLoading ? t('common.loading') : t('restaurants.loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default CachedRestaurantList;
