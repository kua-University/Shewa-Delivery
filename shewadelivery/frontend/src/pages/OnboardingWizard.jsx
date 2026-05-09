 // frontend/src/pages/OnboardingWizard.jsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import './OnboardingWizard.css';

const OnboardingWizard = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    role: 'customer',
    phoneNumber: '',
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    restaurantName: '',
    restaurantAddress: '',
    restaurantPhone: '',
    driverLicense: '',
    vehiclePlate: ''
  });

  const handleLanguageChange = (lang) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
  };

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleRoleSelect = (role) => {
    setFormData({ ...formData, role });
    setStep(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate passwords match for customer/restaurant
      if (formData.role !== 'driver' && formData.password !== formData.confirmPassword) {
        alert(t('onboarding.passwordMismatch'));
        setLoading(false);
        return;
      }

      // Register user
      const response = await api.post('/auth/register', {
        phoneNumber: formData.phoneNumber,
        password: formData.password,
        fullName: formData.fullName,
        email: formData.email,
        role: formData.role,
        preferredLanguage: i18n.language
      });

      // Additional registration for restaurant/driver
      if (formData.role === 'restaurant') {
        await api.post('/restaurants/register', {
          userId: response.data.userId,
          name: formData.restaurantName,
          address: formData.restaurantAddress,
          phone: formData.restaurantPhone
        });
      } else if (formData.role === 'driver') {
        await api.post('/drivers/register', {
          userId: response.data.userId,
          licenseNumber: formData.driverLicense,
          vehiclePlate: formData.vehiclePlate
        });
      }

      // Show success and redirect to login
      alert(t('onboarding.success'));
      navigate('/login');
      
    } catch (error) {
      console.error('Registration failed:', error);
      alert(t('onboarding.error'));
    } finally {
      setLoading(false);
    }
  };

  const renderStep1 = () => (
    <div className="step-content">
      <h2>{t('onboarding.welcome')}</h2>
      <p>{t('onboarding.welcomeMessage')}</p>
      
      <div className="language-selector">
        <h3>{t('onboarding.selectLanguage')}</h3>
        <div className="language-buttons">
          <button 
            className={`lang-btn ${i18n.language === 'en' ? 'active' : ''}`}
            onClick={() => handleLanguageChange('en')}
          >
            🇬🇧 English
          </button>
          <button 
            className={`lang-btn ${i18n.language === 'am' ? 'active' : ''}`}
            onClick={() => handleLanguageChange('am')}
          >
            🇪🇹 አማርኛ
          </button>
        </div>
      </div>
      
      <div className="role-selection">
        <h3>{t('onboarding.whoAreYou')}</h3>
        <div className="role-cards">
          <div className="role-card" onClick={() => handleRoleSelect('customer')}>
            <div className="role-icon">🍔</div>
            <h4>{t('onboarding.customer')}</h4>
            <p>{t('onboarding.customerDesc')}</p>
          </div>
          
          <div className="role-card" onClick={() => handleRoleSelect('restaurant')}>
            <div className="role-icon">🏪</div>
            <h4>{t('onboarding.restaurant')}</h4>
            <p>{t('onboarding.restaurantDesc')}</p>
          </div>
          
          <div className="role-card" onClick={() => handleRoleSelect('driver')}>
            <div className="role-icon">🚗</div>
            <h4>{t('onboarding.driver')}</h4>
            <p>{t('onboarding.driverDesc')}</p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCustomerForm = () => (
    <form onSubmit={handleSubmit} className="onboarding-form">
      <h2>{t('onboarding.customerInfo')}</h2>
      
      <div className="form-group">
        <label>{t('onboarding.fullName')} *</label>
        <input
          type="text"
          name="fullName"
          value={formData.fullName}
          onChange={handleInputChange}
          required
          placeholder={t('onboarding.fullNamePlaceholder')}
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.phoneNumber')} *</label>
        <input
          type="tel"
          name="phoneNumber"
          value={formData.phoneNumber}
          onChange={handleInputChange}
          required
          placeholder="+251XXXXXXXXX"
        />
        <small>{t('onboarding.phoneHelp')}</small>
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.email')}</label>
        <input
          type="email"
          name="email"
          value={formData.email}
          onChange={handleInputChange}
          placeholder="you@example.com"
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.password')} *</label>
        <input
          type="password"
          name="password"
          value={formData.password}
          onChange={handleInputChange}
          required
        />
        <small>{t('onboarding.passwordHelp')}</small>
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.confirmPassword')} *</label>
        <input
          type="password"
          name="confirmPassword"
          value={formData.confirmPassword}
          onChange={handleInputChange}
          required
        />
      </div>
      
      <div className="form-actions">
        <button type="button" onClick={() => setStep(1)} className="back-btn">
          {t('common.back')}
        </button>
        <button type="submit" disabled={loading} className="submit-btn">
          {loading ? t('common.processing') : t('onboarding.complete')}
        </button>
      </div>
    </form>
  );

  const renderRestaurantForm = () => (
    <form onSubmit={handleSubmit} className="onboarding-form">
      <h2>{t('onboarding.restaurantInfo')}</h2>
      
      <div className="form-group">
        <label>{t('onboarding.restaurantName')} *</label>
        <input
          type="text"
          name="restaurantName"
          value={formData.restaurantName}
          onChange={handleInputChange}
          required
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.restaurantAddress')} *</label>
        <textarea
          name="restaurantAddress"
          value={formData.restaurantAddress}
          onChange={handleInputChange}
          required
          rows="3"
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.restaurantPhone')} *</label>
        <input
          type="tel"
          name="restaurantPhone"
          value={formData.restaurantPhone}
          onChange={handleInputChange}
          required
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.fullName')} *</label>
        <input
          type="text"
          name="fullName"
          value={formData.fullName}
          onChange={handleInputChange}
          required
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.phoneNumber')} *</label>
        <input
          type="tel"
          name="phoneNumber"
          value={formData.phoneNumber}
          onChange={handleInputChange}
          required
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.email')}</label>
        <input
          type="email"
          name="email"
          value={formData.email}
          onChange={handleInputChange}
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.password')} *</label>
        <input
          type="password"
          name="password"
          value={formData.password}
          onChange={handleInputChange}
          required
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.confirmPassword')} *</label>
        <input
          type="password"
          name="confirmPassword"
          value={formData.confirmPassword}
          onChange={handleInputChange}
          required
        />
      </div>
      
      <div className="form-actions">
        <button type="button" onClick={() => setStep(1)} className="back-btn">
          {t('common.back')}
        </button>
        <button type="submit" disabled={loading} className="submit-btn">
          {loading ? t('common.processing') : t('onboarding.registerRestaurant')}
        </button>
      </div>
    </form>
  );

  const renderDriverForm = () => (
    <form onSubmit={handleSubmit} className="onboarding-form">
      <h2>{t('onboarding.driverInfo')}</h2>
      
      <div className="form-group">
        <label>{t('onboarding.driverLicense')} *</label>
        <input
          type="text"
          name="driverLicense"
          value={formData.driverLicense}
          onChange={handleInputChange}
          required
          placeholder="DL-XXXXXXXX"
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.vehiclePlate')} *</label>
        <input
          type="text"
          name="vehiclePlate"
          value={formData.vehiclePlate}
          onChange={handleInputChange}
          required
          placeholder="AA-1234"
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.fullName')} *</label>
        <input
          type="text"
          name="fullName"
          value={formData.fullName}
          onChange={handleInputChange}
          required
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.phoneNumber')} *</label>
        <input
          type="tel"
          name="phoneNumber"
          value={formData.phoneNumber}
          onChange={handleInputChange}
          required
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.password')} *</label>
        <input
          type="password"
          name="password"
          value={formData.password}
          onChange={handleInputChange}
          required
        />
      </div>
      
      <div className="form-group">
        <label>{t('onboarding.confirmPassword')} *</label>
        <input
          type="password"
          name="confirmPassword"
          value={formData.confirmPassword}
          onChange={handleInputChange}
          required
        />
      </div>
      
      <div className="form-actions">
        <button type="button" onClick={() => setStep(1)} className="back-btn">
          {t('common.back')}
        </button>
        <button type="submit" disabled={loading} className="submit-btn">
          {loading ? t('common.processing') : t('onboarding.registerDriver')}
        </button>
      </div>
    </form>
  );

  const renderStepContent = () => {
    if (step === 1) return renderStep1();
    
    switch (formData.role) {
      case 'customer':
        return renderCustomerForm();
      case 'restaurant':
        return renderRestaurantForm();
      case 'driver':
        return renderDriverForm();
      default:
        return renderCustomerForm();
    }
  };

  return (
    <div className="onboarding-wizard">
      <div className="wizard-container">
        <div className="progress-bar">
          <div className={`progress-step ${step >= 1 ? 'completed' : ''}`}>
            <span className="step-number">1</span>
            <span className="step-label">{t('onboarding.role')}</span>
          </div>
          <div className={`progress-line ${step >= 2 ? 'active' : ''}`}></div>
          <div className={`progress-step ${step >= 2 ? 'completed' : ''}`}>
            <span className="step-number">2</span>
            <span className="step-label">{t('onboarding.info')}</span>
          </div>
        </div>
        
        {renderStepContent()}
      </div>
    </div>
  );
};

export default OnboardingWizard;
