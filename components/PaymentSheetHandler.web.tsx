import { useCallback } from 'react';
import { Alert } from 'react-native';
import type { ConfirmPaymentResponse, CreatePaymentIntentRequest } from '@/lib/payments/types';

type PaymentSheetResult =
  | { status: 'canceled' }
  | { status: 'failed'; message: string }
  | { status: 'pending'; message: string }
  | { status: 'succeeded'; fulfillment: ConfirmPaymentResponse };

const WEB_PAYMENT_MESSAGE =
  'Las compras están disponibles en la aplicación Eclipse para iOS y Android.';

/**
 * Expo resolves this implementation only on web. It deliberately avoids the
 * native Stripe SDK, whose code-generation modules cannot be bundled for web.
 */
export function usePaymentSheetHandler() {
  const present = useCallback(
    async (_purchase: CreatePaymentIntentRequest): Promise<PaymentSheetResult> => ({
      status: 'failed',
      message: WEB_PAYMENT_MESSAGE,
    }),
    []
  );

  const presentWithAlerts = useCallback(
    async (_purchase: CreatePaymentIntentRequest): Promise<ConfirmPaymentResponse | null> => {
      Alert.alert('Compra desde la app', WEB_PAYMENT_MESSAGE);
      return null;
    },
    []
  );

  return { present, presentWithAlerts, loading: false };
}
