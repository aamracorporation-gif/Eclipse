import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { confirmPayment, createPaymentIntent } from '@/lib/payments/api';
import type { ConfirmPaymentResponse, CreatePaymentIntentRequest } from '@/lib/payments/types';
import { waitForFulfillment } from '@/lib/payments/waitForFulfillment';

type PaymentSheetResult =
  | { status: 'canceled' }
  | { status: 'failed'; message: string }
  | { status: 'pending'; message: string }
  | { status: 'succeeded'; fulfillment: ConfirmPaymentResponse };

export function usePaymentSheetHandler() {
  const stripe = useStripe();
  const [loading, setLoading] = useState(false);
  const active = useRef(false);
  const checkout = useRef<{ fingerprint: string; key: string; intentId?: string; submitted?: boolean } | null>(null);

  const merchantDisplayName = useMemo(() => {
    return ((Constants.expoConfig?.extra as any)?.stripe as any)?.merchantDisplayName ?? 'Eclipse';
  }, []);

  const present = useCallback(
    async (purchase: CreatePaymentIntentRequest): Promise<PaymentSheetResult> => {
      if (Platform.OS === 'web') {
        return { status: 'failed', message: 'Payments are not supported on web.' };
      }

      const isExpoGo = (Constants as any)?.appOwnership === 'expo';
      if (!stripe?.initPaymentSheet || !stripe?.presentPaymentSheet) {
        return {
          status: 'failed',
          message: isExpoGo
            ? 'Pago con tarjeta no disponible en Expo Go. Instala un Development Build (EAS) o una build nativa para habilitar Stripe.'
            : 'Pago con tarjeta no disponible en este dispositivo.',
        };
      }

      if (active.current) return { status: 'pending', message: 'La compra ya está en curso.' };
      active.current = true;
      setLoading(true);
      try {
        const publishableKey =
          (typeof process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY === 'string'
            ? process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
            : '')?.trim() ||
          String(((Constants.expoConfig?.extra as any)?.stripe as any)?.publishableKey || '').trim() ||
          String((Constants.expoConfig?.extra as any)?.stripePublishableKey || '').trim();

        if (!publishableKey) {
          return {
            status: 'failed',
            message:
              'Falta configurar Stripe (publishable key). Define EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY o extra.stripe.publishableKey (pk_...).',
          };
        }
        if (publishableKey.includes('TU_CLAVE') || !publishableKey.startsWith('pk_') || /\s/.test(publishableKey)) {
          return {
            status: 'failed',
            message:
              'Stripe no configurado: publishable key inválida. Usa una clave pk_test_... o pk_live_... (sin espacios) en EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY.',
          };
        }

        const fingerprint = JSON.stringify(purchase);
        if (checkout.current?.submitted && checkout.current.intentId) {
          const current = await waitForFulfillment(() => confirmPayment({ payment_intent_id: checkout.current!.intentId! }));
          if (!current?.fulfilled) {
            return { status: 'pending', message: 'Estamos confirmando tu compra anterior. Revisa Mis entradas antes de volver a pagar.' };
          }
          const previousFingerprint = checkout.current.fingerprint;
          checkout.current = null;
          if (fingerprint === previousFingerprint) return { status: 'succeeded', fulfillment: current };
        }
        if (!checkout.current || checkout.current.fingerprint !== fingerprint) {
          checkout.current = { fingerprint, key: purchase.idempotency_key || `eclipse_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}` };
        }
        const intent = await createPaymentIntent({ ...purchase, idempotency_key: checkout.current.key });
        checkout.current.intentId = intent.payment_intent_id;
        if (!intent?.client_secret || typeof intent.client_secret !== 'string' || !intent.client_secret.trim()) {
          return { status: 'failed', message: 'No se pudo inicializar Stripe: falta client_secret del PaymentIntent.' };
        }
        const publishableMode = publishableKey.startsWith('pk_test_') ? 'test' : publishableKey.startsWith('pk_live_') ? 'live' : 'unknown';
        if (intent.stripe_mode && publishableMode !== 'unknown' && intent.stripe_mode !== publishableMode) {
          return {
            status: 'failed',
            message:
              `Stripe mal configurado: la app usa ${publishableMode} (pk_${publishableMode}_) pero el servidor creó el PaymentIntent en ${intent.stripe_mode} (sk_${intent.stripe_mode}_). ` +
              'Asegura que EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY y STRIPE_SECRET_KEY sean del mismo modo (test/live).',
          };
        }

        const returnURL = Linking.createURL('stripe-redirect');

        const platformPayConfig =
          isExpoGo
            ? {}
            : Platform.OS === 'ios'
            ? { applePay: { merchantCountryCode: 'ES' } }
            : Platform.OS === 'android'
              ? { googlePay: { merchantCountryCode: 'ES', testEnv: publishableMode === 'test' } }
              : {};

        const { error: initError } = await stripe.initPaymentSheet({
          merchantDisplayName,
          paymentIntentClientSecret: intent.client_secret,
          returnURL,
          allowsDelayedPaymentMethods: false,
          ...platformPayConfig,
          style: 'automatic',
        });

        if (initError) {
          const m = String(initError.message || '');
          if (m.includes('No such payment_intent') || m.includes('No existe tal payment_intent')) {
            const publishableMode =
              publishableKey.startsWith('pk_test_') ? 'test' : publishableKey.startsWith('pk_live_') ? 'live' : 'unknown';
            const serverMode = intent.stripe_mode || 'desconocido';
            const platformAccountId = (intent as any)?.stripe_platform_account_id ? String((intent as any).stripe_platform_account_id) : '';
            const sameMode = publishableMode !== 'unknown' && serverMode !== 'desconocido' && publishableMode === serverMode;
            return {
              status: 'failed',
              message:
                `Stripe no encuentra el PaymentIntent (${intent.payment_intent_id}). ` +
                (sameMode
                  ? 'Tus claves parecen del mismo modo (test/live), así que lo más probable es que pk_ y sk_ sean de CUENTAS Stripe diferentes. ' +
                    (platformAccountId ? `Cuenta Stripe del servidor: ${platformAccountId}. ` : '') +
                    'Asegura que EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY y STRIPE_SECRET_KEY sean de la misma cuenta Stripe (no solo del mismo modo).'
                  : `Esto casi siempre es mezcla test/live: app=${publishableMode}, servidor=${serverMode}. ` +
                    'Asegura pk_test con sk_test (o pk_live con sk_live).') +
                ' Reinicia Expo con caché limpia (npx expo start -c).',
            };
          }
          return { status: 'failed', message: initError.message };
        }

        const { error: presentError } = await stripe.presentPaymentSheet();
        if (presentError) {
          if (presentError.code === 'Canceled') {
            return { status: 'canceled' };
          }
          const m = String(presentError.message || '');
          if (m.includes('No such payment_intent') || m.includes('No existe tal payment_intent')) {
            const publishableMode =
              publishableKey.startsWith('pk_test_') ? 'test' : publishableKey.startsWith('pk_live_') ? 'live' : 'unknown';
            const serverMode = intent.stripe_mode || 'desconocido';
            const platformAccountId = (intent as any)?.stripe_platform_account_id ? String((intent as any).stripe_platform_account_id) : '';
            const sameMode = publishableMode !== 'unknown' && serverMode !== 'desconocido' && publishableMode === serverMode;
            return {
              status: 'failed',
              message:
                `Stripe no encuentra el PaymentIntent (${intent.payment_intent_id}). ` +
                (sameMode
                  ? 'Tus claves parecen del mismo modo (test/live), así que lo más probable es que pk_ y sk_ sean de CUENTAS Stripe diferentes. ' +
                    (platformAccountId ? `Cuenta Stripe del servidor: ${platformAccountId}. ` : '') +
                    'Asegura que EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY y STRIPE_SECRET_KEY sean de la misma cuenta Stripe (no solo del mismo modo).'
                  : `Esto casi siempre es mezcla test/live: app=${publishableMode}, servidor=${serverMode}. ` +
                    'Asegura pk_test con sk_test (o pk_live con sk_live).') +
                ' Reinicia Expo con caché limpia (npx expo start -c).',
            };
          }
          return { status: 'failed', message: presentError.message };
        }

        checkout.current.submitted = true;
        const fulfillment = await waitForFulfillment(() => confirmPayment({ payment_intent_id: intent.payment_intent_id }));
        if (!fulfillment?.fulfilled) {
          return { status: 'pending', message: 'El pago se está confirmando. Tu entrada aparecerá en Mis entradas. No necesitas volver a pagar.' };
        }
        checkout.current = null;
        return { status: 'succeeded', fulfillment };
      } catch (e: any) {
        const message = e?.message || 'Payment failed.';
        return { status: 'failed', message };
      } finally {
        active.current = false;
        setLoading(false);
      }
    },
    [merchantDisplayName, stripe]
  );

  const presentWithAlerts = useCallback(
    async (purchase: CreatePaymentIntentRequest): Promise<ConfirmPaymentResponse | null> => {
      const result = await present(purchase);
      if (result.status === 'canceled') return null;
      if (result.status === 'pending') {
        Alert.alert('Compra pendiente', result.message);
        return null;
      }
      if (result.status === 'failed') {
        Alert.alert('Error de pago', result.message);
        return null;
      }
      return result.fulfillment;
    },
    [present]
  );

  return { present, presentWithAlerts, loading };
}
