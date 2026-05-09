 
// frontend/src/pages/Customer/Checkout.jsx
import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import './Checkout.css';

const Checkout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { cart, total } = location.state || { cart: [], total: 0 };
  
  const [formData, setFormData] = useState({
    fullName: '',
    phoneNumber: '',
    address: '',
    city: 'Addis Ababa',
    paymentMethod: 'chapa',
    specialInstructions: ''
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Create order (ASR-03: 2s response expectation)
      const orderData = {
        restaurantId: cart[0]?.restaurantId,
        items: cart.map(item => ({
          menuItemId: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity
        })),
        deliveryAddress: {
          fullName: formData.fullName,
          phone: formData.phoneNumber,
          address: formData.address,
          city: formData.city
        },
        specialInstructions: formData.specialInstructions,
        paymentMethod: formData.paymentMethod,
        totalAmount: total
      };

      const response = await api.post('/orders', orderData);
      
      // Clear cart on success
      localStorage.removeItem('cart');
      
      // Redirect to order tracking
      navigate(`/order/${response.data.data.orderId}/tracking`, {
        state: { order: response.data.data }
      });
      
    } catch (err) {
      console.error('Checkout failed:', err);
      setError(t('checkout.error'));
    } finally {
      setLoading(false);
    }
  };

  if (!cart || cart.length === 0) {
    navigate('/cart');
    return null;
  }

  return (
    <div className="checkout-container">
      <h1>{t('checkout.title')}</h1>
      
      <form onSubmit={handleSubmit} className="checkout-form">
        <div className="form-section">
          <h2>{t('checkout.deliveryInfo')}</h2>
          
          <div className="form-group">
            <label>{t('checkout.fullName')} *</label>
            <input
              type="text"
              name="fullName"
              value={formData.fullName}
              onChange={handleInputChange}
              required
            />
          </div>
          
          <div className="form-group">
            <label>{t('checkout.phoneNumber')} *</label>
            <input
              type="tel"
              name="phoneNumber"
              value={formData.phoneNumber}
              onChange={handleInputChange}
              required
              placeholder="+251XXXXXXXXX"
            />
          </div>
          
          <div className="form-group">
            <label>{t('checkout.address')} *</label>
            <textarea
              name="address"
              value={formData.address}
              onChange={handleInputChange}
              required
              rows="3"
            />
          </div>
          
          <div className="form-group">
            <label>{t('checkout.city')}</label>
            <select name="city" value={formData.city} onChange={handleInputChange}>
              <option value="Addis Ababa">Addis Ababa</option>
              <option value="Bahir Dar">Bahir Dar</option>
              <option value="Dire Dawa">Dire Dawa</option>
              <option value="Mekelle">Mekelle</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>{t('checkout.specialInstructions')}</label>
            <textarea
              name="specialInstructions"
              value={formData.specialInstructions}
              onChange={handleInputChange}
              rows="2"
              placeholder={t('checkout.instructionsPlaceholder')}
            />
          </div>
        </div>
        
        <div className="form-section">
          <h2>{t('checkout.payment')}</h2>
          
          <div className="payment-methods">
            <label className="payment-method">
              <input
                type="radio"
                name="paymentMethod"
                value="chapa"
                checked={formData.paymentMethod === 'chapa'}
                onChange={handleInputChange}
              />
              <span>Chapa (Card / Bank Transfer)</span>
            </label>
            
            <label className="payment-method">
              <input
                type="radio"
                name="paymentMethod"
                value="cash"
                checked={formData.paymentMethod === 'cash'}
                onChange={handleInputChange}
              />
              <span>{t('checkout.cashOnDelivery')}</span>
            </label>
          </div>
        </div>
        
        <div className="order-summary">
          <h2>{t('checkout.orderSummary')}</h2>
          {cart.map(item => (
            <div key={item.id} className="summary-item">
              <span>{item.quantity}x {item.name}</span>
              <span>{item.price * item.quantity} ETB</span>
            </div>
          ))}
          <div className="summary-total">
            <strong>{t('checkout.total')}</strong>
            <strong>{total} ETB</strong>
          </div>
        </div>
        
        {error && <div className="error-message">{error}</div>}
        
        <button type="submit" disabled={loading} className="place-order-btn">
          {loading ? t('common.processing') : t('checkout.placeOrder')}
        </button>
      </form>
    </div>
  );
};

export default Checkout;