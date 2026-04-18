import { StyleProp, ViewStyle } from 'react-native';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { usePaymentSheetHandler } from '@/components/PaymentSheetHandler';
import type { ConfirmPaymentResponse, CreatePaymentIntentRequest } from '@/lib/payments/types';

type PaymentButtonProps = {
  title: string;
  purchase: CreatePaymentIntentRequest;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onSuccess?: (fulfillment: ConfirmPaymentResponse) => void | Promise<void>;
};

export function PaymentButton({ title, purchase, disabled, style, onSuccess }: PaymentButtonProps) {
  const { loading, presentWithAlerts } = usePaymentSheetHandler();

  return (
    <ThemedButton
      title={title}
      loading={loading}
      disabled={disabled}
      style={style}
      onPress={async () => {
        const fulfillment = await presentWithAlerts(purchase);
        if (!fulfillment) return;
        await onSuccess?.(fulfillment);
      }}
    />
  );
}

