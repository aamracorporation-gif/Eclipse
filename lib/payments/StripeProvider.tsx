import { ReactElement, useMemo } from 'react';
import { StripeProvider as NativeStripeProvider } from '@stripe/stripe-react-native';
import Constants from 'expo-constants';

function getPublishableKey(): string {
  const fromEnv = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();

  const extra = Constants.expoConfig?.extra as any;
  const fromStripeObject = extra?.stripe?.publishableKey;
  if (typeof fromStripeObject === 'string' && fromStripeObject.trim()) return fromStripeObject.trim();

  const fromExtra = extra?.stripePublishableKey;
  if (typeof fromExtra === 'string' && fromExtra.trim()) return fromExtra.trim();

  return '';
}

function getUrlScheme(): string {
  const scheme = Constants.expoConfig?.scheme;
  if (Array.isArray(scheme)) return scheme[0] ?? 'myapp';
  if (typeof scheme === 'string' && scheme.trim()) return scheme.trim();
  return 'myapp';
}

export function StripeProvider({ children }: { children: ReactElement | ReactElement[] }) {
  const publishableKey = useMemo(() => getPublishableKey(), []);
  const urlScheme = useMemo(() => getUrlScheme(), []);

  return (
    <NativeStripeProvider
      publishableKey={publishableKey}
      merchantIdentifier="merchant.com.achraf.eclipse"
      urlScheme={urlScheme}
    >
      {children}
    </NativeStripeProvider>
  );
}
