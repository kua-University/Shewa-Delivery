 // frontend/src/pages/Customer/Cart.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './Cart.css';

const Cart = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [cart, setCart] = useState([]);
  const [promoCode, setPromoCode] = useState('');
  const [discount, setDiscount] = useState(0);
  const [promoError, setPromoError] = useState('');

  useEffect(() => {
    const savedCart = localStorage.getItem('cart');
    if (savedCart) {
      setCart(JSON.parse(savedCart));
    }
  }, []);

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
      
      localStorage.setItem('cart', JSON.stringify(newCart));
      return newCart;
    });
  };

  const removeItem = (itemId) => {
    setCart(prevCart => {
      const newCart = prevCart.filter(item => item.id !== itemId);
      localStorage.setItem('cart', JSON.stringify(newCart));
      return newCart;
    });
  };

  const applyPromoCode = async () => {
    if (!promoCode) return;
    
    try {
      // API call to validate promo code
      const response = await api.post('/promo/validate', { code: promoCode });
      setDiscount(response.data.discount);
      setPromoError('');
    } catch (error) {
      setPromoError(t('cart.invalidPromo'));
      setDiscount(0);
    }
  };

  const getSubtotal = () => {
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
  };

  const getDeliveryFee = () => {
    return getSubtotal() > 200 ? 0 : 30;
  };

  const getTax = () => {
    return getSubtotal() * 0.02;
  };

  const getTotal = () => {
    return getSubtotal() + getDeliveryFee() + getTax() - discount;
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;
    navigate('/checkout', { state: { cart, total: getTotal() } });
  };

  if (cart.length === 0) {
    return (
      <div className="empty-cart">
        <div className="empty-cart-icon">🛒</div>
        <h2>{t('cart.empty')}</h2>
        <p>{t('cart.emptyMessage')}</p>
        <button onClick={() => navigate('/restaurants')} className="browse-btn">
          {t('cart.browseRestaurants')}
        </button>
      </div>
    );
  }

  return (
    <div className="cart-container">
      <h1>{t('cart.title')}</h1>
      
      <div className="cart-layout">
        <div className="cart-items">
          {cart.map(item => (
            <div key={item.id} className="cart-item">
              <img src={item.imageUrl} alt={item.name} className="cart-item-image" />
              <div className="cart-item-details">
                <h3>{item.name}</h3>
                <p className="item-price">{item.price} ETB</p>
              </div>
              <div className="cart-item-actions">
                <button onClick={() => updateQuantity(item.id, -1)} className="qty-btn">-</button>
                <span className="item-quantity">{item.quantity}</span>
                <button onClick={() => updateQuantity(item.id, 1)} className="qty-btn">+</button>
                <button onClick={() => removeItem(item.id)} className="remove-btn">
                  🗑️
                </button>
              </div>
              <div className="cart-item-total">
                {item.price * item.quantity} ETB
              </div>
            </div>
          ))}
        </div>

        <div className="cart-summary">
          <h3>{t('cart.summary')}</h3>
          <div className="summary-row">
            <span>{t('cart.subtotal')}</span>
            <span>{getSubtotal()} ETB</span>
          </div>
          <div className="summary-row">
            <span>{t('cart.deliveryFee')}</span>
            <span>{getDeliveryFee()} ETB</span>
          </div>
          <div className="summary-row">
            <span>{t('cart.tax')}</span>
            <span>{getTax()} ETB</span>
          </div>
          
          {discount > 0 && (
            <div className="summary-row discount">
              <span>{t('cart.discount')}</span>
              <span>-{discount} ETB</span>
            </div>
          )}
          
          <div className="promo-code">
            <input
              type="text"
              placeholder={t('cart.enterPromo')}
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
            />
            <button onClick={applyPromoCode}>{t('cart.apply')}</button>
          </div>
          {promoError && <p className="promo-error">{promoError}</p>}
          
          <div className="summary-row total">
            <strong>{t('cart.total')}</strong>
            <strong>{getTotal()} ETB</strong>
          </div>
          
          <button onClick={handleCheckout} className="checkout-btn">
            {t('cart.proceedToCheckout')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Cart;
