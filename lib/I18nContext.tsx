import React, { createContext, useContext, useState } from 'react';
import i18next, { applyDeviceLanguage, changeLanguage, supportedLanguages } from './i18n';

type Language = 'es' | 'en' | 'fr';

type I18nContextType = {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  setDeviceLanguage: () => Promise<void>;
};

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const initial = (supportedLanguages.includes(i18next.language as any) ? i18next.language : 'en') as Language;
  const [language, setLanguageState] = useState<Language>(initial);

  const setLanguage = async (lang: Language) => {
    try {
      await changeLanguage(lang);
      setLanguageState(lang);
    } catch (error) {
      console.error('Error changing language:', error);
    }
  };

  const setDeviceLanguage = async () => {
    try {
      const lang = (await applyDeviceLanguage()) as Language;
      setLanguageState(lang);
    } catch (error) {
      console.error('Error applying device language:', error);
    }
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, setDeviceLanguage }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
