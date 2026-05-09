 // frontend/src/components/LoadingState.jsx
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './LoadingState.css';

const LoadingState = ({ 
  type = 'default', 
  count = 3,
  message,
  showProgress = false,
  estimatedTime = null 
}) => {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [networkStatus, setNetworkStatus] = useState('good');
  const [showTip, setShowTip] = useState(false);

  // Detect network speed (3G optimization)
  useEffect(() => {
    if ('connection' in navigator) {
      const connection = navigator.connection;
      const updateNetworkStatus = () => {
        if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') {
          setNetworkStatus('slow');
        } else if (connection.effectiveType === '3g') {
          setNetworkStatus('3g');
        } else {
          setNetworkStatus('good');
        }
      };
      
      updateNetworkStatus();
      connection.addEventListener('change', updateNetworkStatus);
      return () => connection.removeEventListener('change', updateNetworkStatus);
    }
  }, []);

  // Simulate progress for slow connections
  useEffect(() => {
    if (showProgress && networkStatus !== 'good') {
      const interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) return prev;
          return prev + 10;
        });
      }, 1000);
      
      return () => clearInterval(interval);
    }
  }, [showProgress, networkStatus]);

  // Show loading tip after 3 seconds on slow network
  useEffect(() => {
    const timer = setTimeout(() => {
      if (networkStatus !== 'good') {
        setShowTip(true);
      }
    }, 3000);
    
    return () => clearTimeout(timer);
  }, [networkStatus]);

  const getLoadingTip = () => {
    const tips = [
      t('loading.tip1'),
      t('loading.tip2'),
      t('loading.tip3'),
      t('loading.tip4'),
      t('loading.tip5')
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  };

  const renderSkeletonCards = () => {
    const skeletons = [];
    for (let i = 0; i < count; i++) {
      skeletons.push(
        <div key={i} className="skeleton-card">
          <div className="skeleton-image"></div>
          <div className="skeleton-content">
            <div className="skeleton-title"></div>
            <div className="skeleton-text"></div>
            <div className="skeleton-text short"></div>
            <div className="skeleton-footer"></div>
          </div>
        </div>
      );
    }
    return skeletons;
  };

  const renderSkeletonList = () => {
    const skeletons = [];
    for (let i = 0; i < count; i++) {
      skeletons.push(
        <div key={i} className="skeleton-list-item">
          <div className="skeleton-avatar"></div>
          <div className="skeleton-list-content">
            <div className="skeleton-title"></div>
            <div className="skeleton-text"></div>
          </div>
        </div>
      );
    }
    return skeletons;
  };

  const renderSpinner = () => (
    <div className="loading-spinner-container">
      <div className="spinner"></div>
      {message && <p className="loading-message">{message}</p>}
      {estimatedTime && (
        <p className="estimated-time">
          {t('loading.estimatedTime')}: {estimatedTime}s
        </p>
      )}
      {showProgress && networkStatus !== 'good' && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }}></div>
        </div>
      )}
      {showTip && (
        <div className="loading-tip">
          <span className="tip-icon">💡</span>
          <p>{getLoadingTip()}</p>
        </div>
      )}
      {networkStatus !== 'good' && (
        <div className="network-badge">
          📶 {networkStatus === 'slow' ? t('loading.slowConnection') : t('loading.averageConnection')}
        </div>
      )}
    </div>
  );

  const renderSkeleton = () => (
    <div className={`skeleton-wrapper skeleton-${type}`}>
      {type === 'restaurant' && renderSkeletonCards()}
      {type === 'list' && renderSkeletonList()}
      {type === 'grid' && renderSkeletonCards()}
      {type === 'order' && (
        <div className="skeleton-order">
          <div className="skeleton-order-header"></div>
          <div className="skeleton-order-items">
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton-order-item"></div>
            ))}
          </div>
        </div>
      )}
      {networkStatus !== 'good' && (
        <div className="loading-hint">
          <span>🐌</span> {t('loading.longerOnSlowNetwork')}
        </div>
      )}
    </div>
  );

  const renderPulse = () => (
    <div className="pulse-loading">
      <div className="pulse-dot"></div>
      <div className="pulse-dot delay-1"></div>
      <div className="pulse-dot delay-2"></div>
      <p>{message || t('loading.loading')}</p>
    </div>
  );

  const renderShimmer = () => (
    <div className="shimmer-wrapper">
      <div className="shimmer-effect"></div>
      {renderSkeleton()}
    </div>
  );

  switch (type) {
    case 'spinner':
      return renderSpinner();
    case 'skeleton':
      return renderSkeleton();
    case 'pulse':
      return renderPulse();
    case 'shimmer':
      return renderShimmer();
    default:
      return renderSpinner();
  }
};

// Progressive Loading Component for images
export const ProgressiveImage = ({ src, alt, className, onLoad }) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageSrc, setImageSrc] = useState(null);

  useEffect(() => {
    const img = new Image();
    img.src = src;
    img.onload = () => {
      setImageSrc(src);
      setImageLoaded(true);
      if (onLoad) onLoad();
    };
  }, [src]);

  return (
    <div className={`progressive-image ${className}`}>
      {!imageLoaded && <div className="image-placeholder"></div>}
      {imageSrc && <img src={imageSrc} alt={alt} className={imageLoaded ? 'loaded' : ''} />}
    </div>
  );
};

// Lazy Load Component for below-the-fold content
export const LazyLoad = ({ children, threshold = 0.1 }) => {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin: '50px' }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [threshold]);

  return <div ref={ref}>{isVisible ? children : <LoadingState type="pulse" />}</div>;
};

// Retry Button for failed loads
export const RetryButton = ({ onRetry, error }) => {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    await onRetry();
    setRetrying(false);
  };

  return (
    <div className="retry-container">
      <div className="error-icon">⚠️</div>
      <p className="error-message">{error || t('errors.somethingWentWrong')}</p>
      <button onClick={handleRetry} disabled={retrying} className="retry-button">
        {retrying ? (
          <span className="retry-spinner"></span>
        ) : (
          t('common.retry')
        )}
      </button>
      <p className="retry-hint">{t('loading.checkConnection')}</p>
    </div>
  );
};

export default LoadingState;
