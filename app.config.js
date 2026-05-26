const appJson = require('./app.json');

const getHttpsHost = () => {
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

  if (!host) return expoConfig;

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
      ],
      category: ['BROWSABLE', 'DEFAULT'],
      autoVerify: false,
    },
  ];

  return {
    ...expoConfig,
    android: {
      ...expoConfig.android,
      intentFilters,
    },
    ios: {
      ...expoConfig.ios,
      associatedDomains: Array.from(new Set([...(expoConfig.ios?.associatedDomains ?? []), `applinks:${host}`])),
    },
  };
};
