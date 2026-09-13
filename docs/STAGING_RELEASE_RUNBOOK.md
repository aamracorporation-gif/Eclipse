# Supabase staging release runbook

1. Create a dedicated staging Supabase project; never link this repository to production locally.
2. Configure GitHub environment `staging` with `SUPABASE_ACCESS_TOKEN`,
   `SUPABASE_DB_PASSWORD`, `SUPABASE_STAGING_PROJECT_REF` and `STAGING_API_URL`.
3. Add Stripe **test-mode** secrets to staging, including a staging-only webhook secret.
4. Run the manual workflow `Deploy Supabase staging` and require one reviewer.
5. Confirm migration `20260913010000_payment_webhook_idempotency_and_qa_security.sql` applied.
6. Use Stripe CLI to send succeeded, duplicate, delayed-failure and reordered events.
7. Verify one transaction, one fulfillment, one set of tickets, and ledger status `processed`.
8. Run `k6 run tests/load/api-smoke.js` and `k6 run tests/load/payment-status.js` with staging variables.
9. Run both Maestro smoke flows on iOS and Android release candidates.
10. Promote only when CI, P1 QA and rollback checks pass.

Rollback is forward-only: restore function versions, then apply a compensating migration.
Do not delete the webhook ledger or idempotency keys.

## Credential rotation and Git history

Rotate Supabase service-role/anon keys as applicable, Stripe secret and webhook
secrets, EAS tokens, map keys, mail/SMS keys and signing credentials before rewriting
history. Then run `scripts/audit-and-clean-git-history.ps1` in dry-run mode. Only a
repository administrator should use `-Execute`; it force-rewrites every ref and
requires all collaborators to clone again. Old credentials remain compromised even
after removing them from Git, so rotation must happen first.
