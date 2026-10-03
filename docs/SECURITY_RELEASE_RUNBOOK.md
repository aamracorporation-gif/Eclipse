# Security release runbook

1. Rotate/restrict the exposed Google Maps and MapTiler keys.
2. Remove signing files and secrets from Git history using `git filter-repo`; coordinate this because it rewrites history.
3. Store Android signing credentials in EAS Credentials. Never commit keystores.
4. Create isolated Supabase development, staging and production projects.
5. Apply `20260913000000_harden_atomic_ticket_scanning.sql` to staging first.
6. Run QR-001 through QR-016 from the release Test Plan, including two physical scanners.
7. Deploy the Wallet function and verify `/authorize-sa` no longer exists.
8. Configure environment-scoped EAS variables and run CI.
9. Promote the same tested commit/build to production; never rebuild from a different commit.
10. Monitor authentication failures, scan conflicts, webhook failures and paid-without-ticket anomalies.
