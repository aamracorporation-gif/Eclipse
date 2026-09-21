# Preparing the Eclipse Staging schema

The existing staging project has 7 empty public tables; production has 49. Its
current schema cannot exercise resale, wallet reserves or Stripe payment
fulfillment. The staging deployment workflow deliberately stops while the
historical `99999999999999_full_schema_fix.sql` migration remains present.

## Produce a schema-only candidate

On a trusted machine with Docker, Supabase CLI and `rg`, set
`ECLIPSE_PRODUCTION_DB_URL` from a secret manager to a percent-encoded
production database connection URL. The export reads schema and does not
include production users, tickets, payments or other table data.

```bash
bash scripts/prepare-staging-schema-baseline.sh /tmp/eclipse-public-schema.sql
```

The script refuses output inside the repository, refuses to overwrite an
existing file, rejects top-level data operations and prints a table count and
SHA-256 checksum. Keep the resulting file private: function definitions and
grants still require review before moving to a shared artifact.

## Review and restore

1. Compare the candidate's public tables, types, functions, triggers, policies
   and grants with production. Ensure that Auth and Storage remain managed by
   the target Supabase project. The CLI's default schema dump excludes those
   managed schemas.
2. Check the dump for embedded credentials or project-specific URLs. Review
   security definer function grants and RLS before adding the baseline to
   version control or restoring it.
3. Plan a clean restore of the **empty staging application schema**. The seven
   existing tables overlap with the dump; applying it on top without a reset
   will fail. Do not alter production or import production table data.
4. Apply the reviewed baseline, then the release migrations in
   `STAGING_RELEASE_RUNBOOK.md` in version order. Keep the deployment guard
   until a complete staging rehearsal succeeds.
5. Configure Stripe test credentials and the staging webhook, then execute
   the card, wallet, refund, QR, cancellation race, Android and iOS smoke
   checks from the runbook.

Current blocker: this workspace has database read access through Supabase, but
no production database connection URL for a schema-only CLI export. The
baseline cannot be generated from the existing 7-table staging project.
