export type PurchaseKind = 'event_ticket' | 'resale_ticket' | 'vip_table' | 'premium_feature';

export type Currency = 'eur';

export type CreatePaymentIntentRequest =
  | {
      idempotency_key?: string;
      kind: 'event_ticket';
      event_id: string;
      ticket_type_id?: string | null;
      quantity: number;
      buyer_name?: string;
      buyer_email?: string;
      credit_debit_eur?: number;
      discount_code_id?: string;
    }
  | {
      idempotency_key?: string;
      kind: 'resale_ticket';
      listing_id: string;
    }
  | {
      idempotency_key?: string;
      kind: 'vip_table';
      reference_id: string;
      credit_debit_eur?: number;
      buyer_name?: string;
      buyer_email?: string;
    }
  | {
      idempotency_key?: string;
      kind: 'premium_feature';
      reference_id: string;
    };

export type CreatePaymentIntentResponse = {
  client_secret: string;
  payment_intent_id: string;
  amount_cents: number;
  ticket_amount_cents?: number;
  service_fee_cents?: number;
  currency: Currency;
  merchant_display_name?: string;
  transaction_id?: string;
  stripe_mode?: 'test' | 'live';
  stripe_platform_account_id?: string | null;
};

export type ConfirmPaymentRequest = {
  payment_intent_id: string;
};

export type ConfirmPaymentResponse = {
  fulfilled: boolean;
  kind: PurchaseKind;
  tickets?: { ids: string[] };
  resale?: { ticket_id: string; listing_id: string };
  error?: string;
  status?: string;
};

export type CreateStripeConnectAccountResponse = {
  stripe_account_id: string;
};

export type CreateStripeConnectOnboardingLinkRequest = {
  return_url: string;
  refresh_url: string;
};

export type CreateStripeConnectOnboardingLinkResponse = {
  url: string;
};

export type StripeConnectAccountStatus = {
  stripe_account_id: string;
  stripe_details_submitted: boolean;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  stripe_onboarding_completed: boolean;
};
