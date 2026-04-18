import i18n, { initLanguage, changeLanguage } from '@/lib/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-localization', () => {
  let locales = [{ languageCode: 'xx' }];
  return {
    getLocales: () => locales,
    __setLocales: (next: any) => {
      locales = next;
    },
  };
});

describe('i18n initialization and change', () => {
  beforeEach(async () => {
    await AsyncStorage.removeItem('appLanguage');
    await AsyncStorage.removeItem('appLanguageSource');
    const loc: any = require('expo-localization');
    loc.__setLocales([{ languageCode: 'xx' }]);
  });

  it('falls back to Spanish when device language not supported', async () => {
    const lang = await initLanguage();
    expect(lang).toBe('es');
    expect(i18n.language).toBe('es');
    expect(i18n.t('common.loading')).toBeTruthy();
  });

  it('changes language instantly and persists', async () => {
    await initLanguage();
    await changeLanguage('en');
    expect(i18n.language).toBe('en');
    const stored = await AsyncStorage.getItem('appLanguage');
    expect(stored).toBe('en');
    expect(i18n.t('common.loading')).toBe('Loading...');
  });

  it('follows device language when not manually overridden', async () => {
    const loc: any = require('expo-localization');
    loc.__setLocales([{ languageCode: 'en' }]);
    await AsyncStorage.setItem('appLanguage', 'es');
    await AsyncStorage.setItem('appLanguageSource', 'device');
    const lang = await initLanguage();
    expect(lang).toBe('en');
    expect(i18n.language).toBe('en');
  });
});
