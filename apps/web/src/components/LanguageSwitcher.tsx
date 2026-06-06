import { useTranslation } from 'react-i18next';

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { i18n } = useTranslation();
  const current = i18n.language?.startsWith('en') ? 'en' : 'es';

  const toggle = () => {
    const next = current === 'es' ? 'en' : 'es';
    void i18n.changeLanguage(next);
  };

  if (compact) {
    return (
      <button
        className="lang-switcher-compact"
        onClick={toggle}
        title={current === 'es' ? 'Switch to English' : 'Cambiar a Español'}
        aria-label={current === 'es' ? 'Switch to English' : 'Cambiar a Español'}
      >
        <span className={`lang-flag ${current === 'es' ? 'active' : ''}`}>ES</span>
        <span className="lang-divider">|</span>
        <span className={`lang-flag ${current === 'en' ? 'active' : ''}`}>EN</span>
      </button>
    );
  }

  return (
    <div className="lang-switcher">
      <button
        className={`lang-btn ${current === 'es' ? 'active' : ''}`}
        onClick={() => void i18n.changeLanguage('es')}
        aria-label="Cambiar a Español"
      >
        <span className="lang-icon">🇪🇸</span>
        <span>ES</span>
      </button>
      <button
        className={`lang-btn ${current === 'en' ? 'active' : ''}`}
        onClick={() => void i18n.changeLanguage('en')}
        aria-label="Switch to English"
      >
        <span className="lang-icon">🇺🇸</span>
        <span>EN</span>
      </button>
    </div>
  );
}
