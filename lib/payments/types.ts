export type PurchaseKind = 'event_ticket' | 'resale_ticket' | 'vip_table' | 'premium_feature' | 'wallet_topup';

export type Currency = 'eur';

export type CreatePaymentIntentRequest =
  | {
      kind: 'event_ticket';
      event_id: string;
      ticket_type_id?: string | null;
      quantity: number;
      buyer_name?: string;
      buyer_email?: string;
      wallet_debit_eur?: number;
    }
  | {
      kind: 'resale_ticket';
      listing_id: string;
    }
  | {
      kind: 'vip_table';
      reference_id: string;
      wallet_debit_eur?: number;
      buyer_name?: string;
      buyer_email?: string;
    }
  | {
      kind: 'premium_feature';
      reference_id: string;
    }
  | {
      kind: 'wallet_topup';
      amount_eur: number;
    };

export type CreatePaymentIntentResponse = {
  client_secret: string;
  payment_intent_id: string;
  amount_cents: number;
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
