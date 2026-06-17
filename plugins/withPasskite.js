const { createRunOncePlugin, withEntitlementsPlist } = require('expo/config-plugins');

const DEFAULT_PASS_TYPE_IDENTIFIERS = ['$(TeamIdentifierPrefix)*'];

const withPasskite = (config, options = {}) => {
  const requestedIdentifiers = Array.isArray(options.passTypeIdentifiers) && options.passTypeIdentifiers.length > 0
    ? options.passTypeIdentifiers
    : DEFAULT_PASS_TYPE_IDENTIFIERS;

  return withEntitlementsPlist(config, (config) => {
    const existingIdentifiers = config.modResults['com.apple.developer.pass-type-identifiers'];
    const mergedIdentifiers = Array.from(
      new Set([
        ...(Array.isArray(existingIdentifiers) ? existingIdentifiers : []),
        ...requestedIdentifiers,
      ])
    );

    config.modResults['com.apple.developer.pass-type-identifiers'] = mergedIdentifiers;
    return config;
  });
};

module.exports = createRunOncePlugin(withPasskite, 'with-passkite', '1.0.0');
