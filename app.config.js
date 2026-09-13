const appJson = require('./app.json');

const PASSKITE_PLUGIN_PATH = './plugins/withPasskite';

const normalizePlugins = (plugins = []) =>
  plugins.map((plugin) => {
    if (plugin === 'expo-passkite') return PASSKITE_PLUGIN_PATH;
    if (Array.isArray(plugin) && plugin[0] === 'expo-passkite') {
      return [PASSKITE_PLUGIN_PATH, plugin[1] || {}];
    }
    return plugin;
  });

const getHttpsHost = () => {
  const enableAssociatedDomains = process.env.EXPO_PUBLIC_ENABLE_ASSOCIATED_DOMAINS === '1';
  if (!enableAssociatedDomains) return null;
  const baseUrl = process.env.EXPO_PUBLIC_WEB_BASE_URL || process.env.EXPO_PUBLIC_API_URL;
  if (!baseUrl || typeof baseUrl !== 'string') return null;
  if (!baseUrl.startsWith('https://')) return null;
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
};

module.exports = () => {
  const host = getHttpsHost();
  const expoConfig = appJson.expo;
  const plugins = normalizePlugins(expoConfig.plugins);
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const android = {
    ...expoConfig.android,
    ...(googleMapsApiKey
      ? { config: { ...expoConfig.android?.config, googleMaps: { apiKey: googleMapsApiKey } } }
      : {}),
  };

  if (!host) {
    return {
      ...expoConfig,
      plugins,
      android,
    };
  }

  const intentFilters = [
    {
      action: 'VIEW',
      data: [
        {
          scheme: 'https',
          host,
          pathPrefix: '/event',
        },
        {
          scheme: 'https',
          host,
          pathPrefix: '/evento',
        },
        {
          scheme: 'https',
          host,
          pathPrefix: '/auth',
        },
      ],
      category: ['BROWSABLE', 'DEFAULT'],
      autoVerify: false,
    },
  ];

  return {
    ...expoConfig,
    plugins,
    android: {
      ...android,
      intentFilters,
    },
    ios: {
      ...expoConfig.ios,
      associatedDomains: Array.from(new Set([...(expoConfig.ios?.associatedDomains ?? []), `applinks:${host}`])),
    },
  };
};
