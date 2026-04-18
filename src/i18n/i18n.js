import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import enBase from '../../locales/en.json';
import esBase from '../../locales/es.json';
import frBase from '../../locales/fr.json';
import enExtra from './locales/en.json';
import esExtra from './locales/es.json';
import frExtra from './locales/fr.json';

const SUPPORTED_LANGUAGES = ['es', 'en', 'fr'];
const STORAGE_KEY = 'appLanguage';
const STORAGE_SOURCE_KEY = 'appLanguageSource';
let initInFlight = null;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(a, b) {
  if (!isPlainObject(a) || !isPlainObject(b)) return b;
  const out = { ...a };
  for (const k of Object.keys(b)) {
    const av = out[k];
    const bv = b[k];
    out[k] = isPlainObject(av) && isPlainObject(bv) ? deepMerge(av, bv) : bv;
  }
  return out;
}

const resources = {
  en: { translation: deepMerge(enBase, enExtra) },
  es: { translation: deepMerge(esBase, esExtra) },
  fr: { translation: deepMerge(frBase, frExtra) },
};

export function getDeviceLanguage() {
  const locales = Localization.getLocales?.() || [];
  const first = locales[0];
  const raw = (first?.languageCode || first?.languageTag || 'en').toString().toLowerCase();
  const code = raw.includes('-') ? raw.split('-')[0] : raw;
  return code;
}

function normalizeLanguage(lang) {
  const code = (lang || '').toString().toLowerCase();
  if (SUPPORTED_LANGUAGES.includes(code)) return code;
  return 'en';
}

export async function initLanguage() {
  if (initInFlight) return initInFlight;

  initInFlight = (async () => {
    const device = normalizeLanguage(getDeviceLanguage());
    const initial = device;

    if (i18next.isInitialized && i18next.language === initial) {
      return initial;
    }

    await AsyncStorage.setItem(STORAGE_KEY, initial).catch(() => {});
    await AsyncStorage.setItem(STORAGE_SOURCE_KEY, 'device').catch(() => {});

    if (!i18next.isInitialized) {
      await i18next.use(initReactI18next).init({
        resources,
        lng: initial,
        fallbackLng: 'en',
        interpolation: {
          escapeValue: false,
        },
        react: {
          useSuspense: false,
        },
        returnNull: false,
        parseMissingKeyHandler: () => '—',
      });
    } else {
      await i18next.changeLanguage(initial);
    }

    return initial;
  })();

  try {
    return await initInFlight;
  } finally {
    initInFlight = null;
  }
}

export async function changeLanguage(lang) {
  const next = normalizeLanguage(lang);
  await AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  await AsyncStorage.setItem(STORAGE_SOURCE_KEY, 'manual').catch(() => {});
  await i18next.changeLanguage(next);
  return next;
}

export async function applyDeviceLanguage() {
  const next = normalizeLanguage(getDeviceLanguage());
  await AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  await AsyncStorage.setItem(STORAGE_SOURCE_KEY, 'device').catch(() => {});
  await i18next.changeLanguage(next);
  return next;
}

export const supportedLanguages = SUPPORTED_LANGUAGES;
export const storageKey = STORAGE_KEY;
export default i18next;
