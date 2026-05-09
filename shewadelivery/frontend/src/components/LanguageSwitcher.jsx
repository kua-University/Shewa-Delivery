 // frontend/src/components/LanguageSwitcher.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import './LanguageSwitcher.css';

const LanguageSwitcher = ({ variant = 'dropdown', className = '' }) => {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [currentLang, setCurrentLang] = useState(i18n.language || 'en');
  const dropdownRef = useRef(null);

  const languages = [
    { 
      code: 'en', 
      name: 'English', 
      nativeName: 'English',
      flag: '🇬🇧',
      dir: 'ltr'
    },
    { 
      code: 'am', 
      name: 'Amharic', 
      nativeName: 'አማርኛ',
      flag: '🇪🇹',
      dir: 'ltr'
    }
  ];

  useEffect(() => {
    // Load saved language preference
    const savedLang = localStorage.getItem('language');
    if (savedLang && savedLang !== currentLang) {
      changeLanguage(savedLang);
    }

    // Handle click outside to close dropdown
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    // Update document direction for RTL if needed
    const lang = languages.find(l => l.code === currentLang);
    if (lang && lang.dir === 'rtl') {
      document.documentElement.dir = 'rtl';
      document.body.classList.add('rtl');
    } else {
      document.documentElement.dir = 'ltr';
      document.body.classList.remove('rtl');
    }
  }, [currentLang]);

  const changeLanguage = async (langCode) => {
    try {
      await i18n.changeLanguage(langCode);
      setCurrentLang(langCode);
      localStorage.setItem('language', langCode);
      
      // Update HTML lang attribute
      document.documentElement.lang = langCode;
      
      // Dispatch custom event for other components
      window.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: langCode } }));
      
      // Close dropdown if open
      setIsOpen(false);
      
      // Show feedback
      showToast(`Language changed to ${languages.find(l => l.code === langCode)?.name}`);
      
    } catch (error) {
      console.error('Failed to change language:', error);
    }
  };

  const showToast = (message) => {
    const toast = document.createElement('div');
    toast.className = 'language-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  };

  const getCurrentLanguage = () => {
    return languages.find(lang => lang.code === currentLang) || languages[0];
  };

  // Button variant for mobile (simple toggle)
  if (variant === 'button') {
    return (
      <div className={`language-switcher-button ${className}`}>
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="lang-toggle-btn"
          aria-label={t('common.changeLanguage')}
        >
          <span className="lang-flag">{getCurrentLanguage().flag}</span>
          <span className="lang-code">{getCurrentLanguage().code.toUpperCase()}</span>
        </button>
        
        {isOpen && (
          <div className="lang-dropdown-menu">
            {languages.map(lang => (
              <button
                key={lang.code}
                onClick={() => changeLanguage(lang.code)}
                className={`lang-option ${currentLang === lang.code ? 'active' : ''}`}
              >
                <span className="lang-flag">{lang.flag}</span>
                <span className="lang-name">{lang.nativeName}</span>
                {currentLang === lang.code && <span className="check-mark">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Full dropdown variant (default)
  return (
    <div ref={dropdownRef} className={`language-switcher ${className}`}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="switcher-trigger"
        aria-expanded={isOpen}
        aria-label={t('common.selectLanguage')}
      >
        <div className="current-language">
          <span className="lang-flag">{getCurrentLanguage().flag}</span>
          <span className="lang-name">{getCurrentLanguage().name}</span>
          <svg 
            className={`dropdown-arrow ${isOpen ? 'open' : ''}`}
            width="12" 
            height="12" 
            viewBox="0 0 12 12" 
            fill="none"
          >
            <path d="M6 8L2 4H10L6 8Z" fill="currentColor"/>
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="language-dropdown">
          <div className="dropdown-header">
            <h4>{t('common.selectLanguage')}</h4>
          </div>
          <div className="language-list">
            {languages.map(lang => (
              <button
                key={lang.code}
                onClick={() => changeLanguage(lang.code)}
                className={`language-item ${currentLang === lang.code ? 'active' : ''}`}
              >
                <div className="language-info">
                  <span className="lang-flag-large">{lang.flag}</span>
                  <div className="lang-text">
                    <span className="lang-name">{lang.name}</span>
                    <span className="lang-native">{lang.nativeName}</span>
                  </div>
                </div>
                {currentLang === lang.code && (
                  <svg className="check-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M13.5 4L6 11.5L2.5 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
          <div className="dropdown-footer">
            <p className="powered-by">{t('common.poweredByShewa')}</p>
          </div>
        </div>
      )}
    </div>
  );
};

// Language Context Provider for global language state
export const LanguageProvider = ({ children }) => {
  const [language, setLanguage] = useState(localStorage.getItem('language') || 'en');

  useEffect(() => {
    const handleLanguageChange = (event) => {
      setLanguage(event.detail.language);
    };

    window.addEventListener('languageChanged', handleLanguageChange);
    return () => window.removeEventListener('languageChanged', handleLanguageChange);
  }, []);

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const LanguageContext = React.createContext();

export default LanguageSwitcher;
