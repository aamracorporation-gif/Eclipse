# Supabase staging release runbook

1. Create a dedicated staging Supabase project; never link this repository to production locally.
2. Configure GitHub environment `staging` with `SUPABASE_ACCESS_TOKEN`,
   `SUPABASE_DB_PASSWORD`, `SUPABASE_STAGING_PROJECT_REF` and `STAGING_API_URL`.
3. Add Stripe **test-mode** secrets to staging, including a staging-only webhook secret.
4. Restore a reviewed schema baseline to staging before running the manual workflow. The current staging project has only 7 public tables versus 49 in production; do not bypass the workflow's legacy migration guard or apply the historical `99999999999999_full_schema_fix.sql` directly.
5. Confirm migrations `20260913010000_payment_webhook_idempotency_and_qa_security.sql`, `20260920104448_repair_resale_credit_and_ticket_transfer.sql`, `20260920112000_resale_refund_statuses.sql`, and `20260920120000_atomic_resale_refund_decision.sql` applied before deploying the updated backend.
6. Configure the staging Stripe webhook for `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`, `refund.updated`, and `refund.failed`.
7. Use Stripe test mode to send succeeded, duplicate, delayed-failure and reordered events. Race a card payment against a wallet purchase of the same resale listing and confirm that the losing card payment is refunded.
8. Verify one transaction, one fulfillment, one set of tickets, and ledger status `processed`; a failed refund must be visible as `refund_failed` and reconciled manually.
9. Run `k6 run tests/load/api-smoke.js` and `k6 run tests/load/payment-status.js` with staging variables.
10. Run both Maestro smoke flows on iOS and Android release candidates.
11. Promote only when CI, P1 QA and rollback checks pass.

Rollback is forward-only: restore function versions, then apply a compensating migration.
Do not delete the webhook ledger or idempotency keys.

## Credential rotation and Git history

Rotate Supabase service-role/anon keys as applicable, Stripe secret and webhook
secrets, EAS tokens, map keys, mail/SMS keys and signing credentials before rewriting
history. Then run `scripts/audit-and-clean-git-history.ps1` in dry-run mode. Only a
repository administrator should use `-Execute`; it force-rewrites every ref and
requires all collaborators to clone again. Old credentials remain compromised even
after removing them from Git, so rotation must happen first.

## Local resale regression checks

`cd backend && npm ci && npm test` executes the resale migrations against a
small PostgreSQL/WASM schema fixture. It verifies durable refund decisions,
blocked resale of used/expired/changed tickets, balance conservation, reserve
splitting, holder identity updates and QR rotation. The legacy card fulfillment
is a stub in these tests; they do not replace a production-schema rehearsal or
a real Stripe test-mode checkout.

Refund statuses are persisted before Stripe is contacted. Unexpected database
failures return a retryable webhook error. Both `refund.updated` and
`refund.failed` must be subscribed; reconcile every `refund_failed` payment.
