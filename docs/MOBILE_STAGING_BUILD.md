# Mobile staging build checks

The preview profile sets ECLIPSE_BUILD_ENV=staging; production sets production. app.config.js validates the selected Supabase project and Stripe publishable-key mode before generating the native build. Preview rejects a production Railway API URL when provided. Missing public keys, server keys, mismatched legacy anon-key project claims, and mismatched build profiles stop the build with an error that does not print keys.

Configure these values in the EAS preview environment before building the release-hardening branch:
- EXPO_PUBLIC_SUPABASE_URL=https://uhondxttdpvywvkyqlkk.supabase.co
- EXPO_PUBLIC_SUPABASE_ANON_KEY: publishable or legacy anon key for Eclipse Staging
- EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: pk_test_ key from the Eclipse Staging Stripe sandbox
- EXPO_PUBLIC_API_URL=https://eclipse-staging-staging.up.railway.app (when used)

Never supply service-role or Stripe secret keys to EXPO_PUBLIC variables. These checks validate configuration shape and environment alignment; they do not authenticate API keys or verify that a Stripe publishable key belongs to the correct sandbox. An authenticated test checkout is still required.

Local development and generic CI bundle builds without a release profile remain usable without production credentials. Ten Node tests run in CI via node --test scripts/tests/buildEnvironment.test.cjs.

Use the existing EAS release build workflow with ref codex/release-hardening, profile preview and platform android/ios. Do not choose production or submit to a store for this QA phase. A signed build has not been requested by this change, and the EAS environment values have not been verified through the available connectors.

Expo references:
- https://docs.expo.dev/build/eas-json/
- https://docs.expo.dev/eas/environment-variables/usage/
