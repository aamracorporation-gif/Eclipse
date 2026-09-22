# Supabase staging release runbook

1. Create a dedicated staging Supabase project; never link this repository to production locally.
2. Configure GitHub environment `staging` with `SUPABASE_ACCESS_TOKEN`,
   `SUPABASE_DB_PASSWORD`, `SUPABASE_STAGING_PROJECT_REF` and `STAGING_API_URL`.
3. Add Stripe **test-mode** secrets to staging, including a staging-only webhook secret.
4. Restore a reviewed schema baseline to staging before running the manual workflow. The reviewed baseline was restored on 2026-09-21; staging now has 49 public tables with RLS. The previous seven empty tables are preserved in the inaccessible `eclipse_prebaseline` schema; do not bypass the workflow's legacy migration guard or apply the historical `99999999999999_full_schema_fix.sql` directly.
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

## Schema rehearsal completed on 2026-09-21

The user-supplied AppFest schema-only dump must be supplied locally at
`supabase/baselines/appfest-schema-20260921.sql`; it is deliberately not committed. It contains 49 application tables
and 138 functions, no copied rows or credential literals. It is a historical
snapshot, not an independently safe deployment: always apply the subsequent fixes.

`supabase/baselines/restore-staging.sql` is the one-time transactional restore for
the original empty seven-table staging project. Its guards abort if rows, users,
a different table count, or an existing archive are found. A full rollback rehearsal
passed before the real restore. Do not rerun it on rebuilt staging or production.
The remote baseline and subsequent migrations are recorded by Supabase MCP; the
historical migration chain remains unsafe to replay with `db push --include-all`.

The two custom `auth.users` triggers were restored separately because the default
schema dump excludes managed-schema customizations. Storage bucket configuration,
Storage policies, notification-template seed data, cron jobs and Edge Function
secrets still require separate review; this is not a full project clone.

Run `supabase/tests/staging_resale_regression.sql` against staging with psql
`-v ON_ERROR_STOP=1`. Twelve assertions passed against the real functions, constraints,
and triggers: signup role rejection, card ownership/QR and duplicate replay,
credit conservation/reserve split, wallet-then-card refund decision, revoked/expired/
null validation rejection, event expiry, internal RPC grants and primary purchase QR.
Every test is rolled back. Follow-up inspection found zero auth users and tickets.
These are database rehearsals, not actual Stripe charges or simultaneous sessions.
Backend regression suite: 36 tests passed (including 18 PostgreSQL/WASM subtests).

Additional corrections deployed to staging:
- Signup cannot choose administrator through user-editable metadata.
- Listing, wallet settlement and card settlement require validation_status=valid.
- Primary card purchases generate one consistent QR identity per ticket.
- The archived schema's RPC execution privileges are revoked.

Only the narrow, drift-aware `prevent_signup_admin_role` fix was also applied to
production; the whitelist was verified afterward. Existing profiles were not
modified. Payment/revenue changes remain staging-only pending Stripe integration QA.
Audit existing privileged profiles separately; the patch prevents future escalation
but does not establish how any earlier administrator profile was created.

Security advisors: all 49 public tables have RLS. Backend-only tables without
client policies intentionally deny clients. The 26 callable SECURITY DEFINER RPCs
need authorization review; the advisor label alone does not prove a vulnerability.
The pg_net extension placement warning also remains.
See https://supabase.com/docs/guides/database/database-linter.

Remaining payment findings: card resale applies 10% while credit resale applies
zero. Primary and full-wallet VIP credit accounting still need review.
The VIP card branch has now been repaired as described below; this does not approve launch.

## VIP card repair (2026-09-22)

`20260922130423_fulfill_vip_card_atomically.sql` routes card/hybrid VIP payments
through a private helper. It locks inventory, rejects expired/inactive/deleted or
changed offers, checks credit backing, issues one capacity-sized ticket with a
consistent QR, decrements VIP stock and calls the existing amount/debit core in
one transaction. A duplicate delivery is idempotent. A known unavailable offer
persists refund_pending before Stripe is called; infrastructure failures roll back.

The Node webhook now supports VIP refund decisions and refund lifecycle events.
VIP destination-charge refunds reverse the connected transfer and refund the
application fee, while platform-only charges omit those flags. Previously created
refunds are reused. Deploy the updated Node backend before enabling staging checkout.

Eleven additional database regressions passed using real functions/triggers:
card delivery/replay, hybrid real/promo debit and reserve splitting, sold-out second
charge, mismatch rollback, inactive/deleted/changed-price/expired offers, insufficient
credit and insufficient backing. This is sequential database testing, not a real
simultaneous Stripe payment race. Backend suite: 42 tests passed.

The authenticated `create-payment-intent-v2` and `confirm-payment` Edge Functions
were deployed to staging. Stripe test secrets and a staging Node webhook endpoint
still need end-to-end verification. No Stripe charges/refunds were created by this work.
