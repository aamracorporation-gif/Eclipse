# Stripe staging verification — 2026-09-27

## Scope and isolation

Test run: `eclipse_20260927_webhook`.
Backend commit: `5d57ee6a38153534f773a18085931318c50ea26a`.
Railway deployment: `56da83de-1361-4b65-9f0d-47d59a3fe056`.
Backend: https://eclipse-staging-staging.up.railway.app
Supabase staging: `uhondxttdpvywvkyqlkk`.
Stripe sandbox: Eclipse Staging, `acct_1UKJbDQX94Oeeb3v`, livemode=false.

No production payment or real-money charge was made. The configured backend handled actual Stripe sandbox webhook deliveries and issued a sandbox refund.

Checkout Sessions were created through Stripe tooling, using synthetic staging users, tickets and listings. An initial declined test payment materialized each PaymentIntent; its corresponding application payment transaction was then registered explicitly as failed before retrying with a successful test card. This validates Stripe → deployed webhook → database fulfillment/refund, but does **not** validate authenticated application payment creation, mobile checkout or the full user journey.

## Results

| Scenario | Observed result |
| --- | --- |
| Resale payment, EUR 10 | Stripe succeeded; application transaction fulfilled; ticket transferred to buyer |
| Ticket identity | QR code equals QR token; buyer identity updated; prior short code and Wallet pass ID cleared |
| Seller accounting | One resale transaction; real credit EUR 10; reserves EUR 10 |
| Revoked ticket, EUR 10 | No transfer; backend automatically requested full refund; Stripe refund succeeded; application transaction refunded |
| Refund accounting | Seller balance and reserves remained EUR 10; still only one resale transaction |
| Database fulfillment replay | Repeated fulfilled payment returned fulfilled; repeated refunded payment returned refunded with refund_required=false; seller balance EUR 10 and resale count 1 |

Replay verification called the real fulfillment function inside a transaction followed by ROLLBACK. It is database-level idempotency evidence, not a duplicate HTTP webhook delivery test.

## Trace identifiers

Successful resale:
- PaymentIntent: `pi_3UKMQhQX94Oeeb3v1a41h0TL`
- Success event: `evt_3UKMQhQX94Oeeb3v19Ey1Wrq` — processed, attempts 1
- Checkout Session: `cs_test_a1KjYpNOLFqICOtKohAb2d76kyXAF9lpxLpXTSe3NOaYsOhhXvzu1FQtIV`

Automatic refund:
- PaymentIntent: `pi_3UKMUVQX94Oeeb3v4GJRaXcS`
- Success event: `evt_3UKMUVQX94Oeeb3v4ymLNVod` — processed, attempts 1
- Refund: `re_3UKMUVQX94Oeeb3v4zf49V5n` — succeeded, EUR 10
- Refund event: `evt_3UKMUVQX94Oeeb3v4YlrRlKz` — processed, attempts 1
- Checkout Session: `cs_test_a197aVf2Pzogd3bhEi3DhljoA7DVzLTacxl54uKGfsG1RLf6t3RmQG9cZa`

Webhook: `we_1UKJkCQX94Oeeb3v02XIg6xY`, API version 2024-06-20, enabled, sandbox.
Subscribed events: payment_intent.succeeded, payment_intent.payment_failed, account.updated, refund.updated, refund.failed.
This endpoint has connect=false; connected-account event coverage remains unverified.

## Outstanding checks and limitations

- Initial decline events arrived before fixture transaction registration and remain failed/retryable at the final inspection: `evt_3UKMQhQX94Oeeb3v1TyfqnMW` (attempts 2) and `evt_3UKMUVQX94Oeeb3v4u41arax` (attempts 1). Do not manually mark them processed. Verify a later retry does not downgrade fulfilled/refunded state.
- Duplicate and reordered HTTP webhook deliveries, simultaneous card/wallet buyers, VIP destination charges and transfer/application-fee reversal remain to be tested.
- Authenticated app checkout and iOS/Android device testing remain outstanding.
- Primary and full-wallet VIP credit accounting findings in the staging runbook remain open.
- These results do not approve production launch.

Synthetic fixture IDs use prefix `a9270000-0000-4000-8000-`: buyer 000000000001, seller 000000000002, event 000000000003, successful ticket/listing 000000000004/000000000005, revoked ticket/listing 000000000006/000000000007. Keep payment and webhook ledgers for reconciliation; do not erase idempotency evidence.
