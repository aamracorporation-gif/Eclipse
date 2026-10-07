# Notification core v2 — implementation and controlled rollout

Tracks #29; implements the first operational slice of the #31 design. Stacked on Google Wallet PR #32; do not replace or redeploy Wallet as part of this work.

## Scope implemented in this branch
- Transactional private outbox and idempotency tied to each payment/ticket/event revision, not a 12-hour per-user suppression.
- Admission and whole-table VIP confirmations; free claims and securely linked box-office tickets; refund processing/completion; check-in history; invalidation; combined schedule/venue/access/lineup/cancellation changes; staff assignments and verification outcomes.
- 24h / 2h / entry-deadline reminders, narrow due windows, collision suppression and current eligibility checks.
- Server-paginated inbox by active role, exact unread count, read/archive actions, safe semantic navigation, current-account isolation and preferences with explicit permission action.
- Per-installation/session binding, logout unlinking, expiring atomic delivery leases, bounded retries, provider idempotency for email, per-device delayed Expo receipts, invalid-token handling and conservative unknown status for ambiguous push requests.
- Private push copy contains no buyer/event/QR details. Already queued OS messages cannot be recalled; details remain behind the authorized inbox.

## Safety defaults
Migration 20261007205841_notification_core_v2.sql was named by the pinned Supabase CLI, not hand-numbered. It does NOT enable capture or external deliveries. It does not backfill history, migrate old tokens, start cron, change credentials or touch production.

`notification_private.config` defaults to capture=false, live_delivery=false, allow_all=false and empty allowed_recipients. The worker independently requires `NOTIFICATIONS_V2_SEND_ENABLED=true`. Neither should be enabled silently. The old delivery queue remains untouched; never drain it through this worker.

New authenticated clients must register their current installation/session; old tokens are not trusted or copied into v2. New UI needs a build containing these sources; deploying server code does not change installed screens.

## Rollout sequence
1. Run ordinary app CI, worker contract tests and disposable PostgreSQL fixture + regression + multi-session tests. The fixture and concurrency script are CI-only and MUST NOT be executed on Supabase.
2. Apply only the reviewed notification core and hardening migrations to Eclipse Staging. Do not replay legacy migrations. Keep safety gates closed and run rollback-only tests against effective staging schema/ACLs.
3. Deploy only dispatch-notifications-v2 with its shared notificationDelivery.ts and keep verify_jwt=true. It additionally validates the exact server service credential; mobile clients cannot invoke delivery.
4. Configure the staging worker: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are runtime-provided. Push requires NOTIFICATIONS_EXPO_PROJECT_ID=42ebb6eb-62b1-4784-a483-831ae3c804f2 and optionally EXPO_ACCESS_TOKEN when enhanced push security is enabled. Email requires existing RESEND_API_KEY and NOTIFICATIONS_FROM_EMAIL with verified sender. Never expose secret values in Git, chat or logs.
5. Build updated iOS/Android clients and register explicitly consented test installations. Select named pilot users in allowed_recipients; verify their current confirmed account email. Marketing is constrained false and SMS/resale/saldo remain excluded.
6. Enable capture from a new cutover time; prepare_notifications_v2(100) may be scheduled once per minute with server-only SQL cron. Invoke the protected worker from a server schedule with a Vault-stored credential, never a literal secret in SQL/job history. Verify that schedules exist before describing reminders/delivery as automatic.
7. Enable remote pilot delivery only after provider credentials, recipients and device registration are verified. Test foreground/background/terminated state, denied permissions, logout/account switches, two devices, invalid tokens, expired/cancelled reminders and actual email delivery.
8. Do not set allow_all_recipients=true or enable production as part of the pilot.

## What this phase does not claim
No proof of push arrival or email delivery from mocks. Expo receipt confirmed means upstream provider acceptance, not human opening. Email accepted is not proof of mailbox delivery; delivery/bounce webhooks remain to implement. No physical-device or native-build QA yet.

Not the full 66-type design: organizer sales aggregation/stock summaries, admin incident recipients and independent alert channel, marketing, support/waitlist/review-dependent flows, additional locales and template editing remain later work. Organizer legacy sales notifications are not silently replaced by a new ungrouped push. No SMS, resale or monetary wallet activation.

## Rollback
Turn live_delivery_enabled and capture_enabled off, set NOTIFICATIONS_V2_SEND_ENABLED=false, and disable the new schedules. Do not delete business payments, idempotency keys, inbox history or delivery audit. Stop old/new mixed workers before changing the cutover. Keep the new schema available to installed clients; rollback is forward-only.

## Verified deployment and validation — 2026-10-07 UTC

Implementation commit `9176b8dc8c681f6fcc1e45f1e9abee1a009a4848` passed the ordinary CI run **37693114683** (quality and secret scan) and notification regression run **37693114705**. The ordinary run includes TypeScript, lint, app tests, Wallet fixtures, the Expo web bundle, backend tests and critical-severity dependency checks. These are not a native build or a claim of zero dependency/security warnings.

Validation completed:
- **45** core SQL assertions plus **19** hardening assertions on disposable PostgreSQL 17, with the real staging ticket-status vocabularies represented in the fixture.
- Three multi-session scenarios: two simultaneous claimers hold 20 distinct leases with one attempt each; simultaneous duplicate capture persists once; keyset pages return 80 distinct notices across 50 + 30 rows with an exact unread count.
- **23** local and CI worker/provider/type-contract tests. HTTP providers are mocked; no actual Expo or Resend message is generated by these tests.
- **26** rollback-only checks on the actual Eclipse Staging database: capture gate, business deduplication, legacy isolation, per-device/email fanout, row-level security, cross-account inbox/detail/destination denial, immutable message content, owner-only preferences, admin denial, worker RPC denial, private-token denial, separate read/delivery states, account-switch binding rotation, logout unlink and expired-session rejection. SQL role/JWT context is simulated for these database checks; it is not a real mobile login.

Both additive migrations are installed on `Eclipse Staging` (`uhondxttdpvywvkyqlkk`): `20261007205841_notification_core_v2.sql` and `20261007215119_notification_core_v2_hardening.sql`. All 31 initial function bodies matched the reviewed source; the four hardening replacements also matched. The MCP applied-history timestamps (20261007214911 and 20261007220032) were aligned, with guarded metadata-only updates, to the two CLI-generated repository versions above. No migration SQL was replayed during that repair; migration statements and unrelated history were preserved.

`dispatch-notifications-v2` is deployed and fetched back as **version 1, ACTIVE, verify_jwt=true**; bundle SHA-256 `978d66bc010d15a16eb933ad994a7415a6f0e0056d87a8989f490139c2698d48`. Only this new worker was deployed; no payment or Wallet function was redeployed. Deployment and source verification do not prove a successful authenticated runtime invocation or provider delivery; that remains part of the configured pilot.

Post-rollback inspection: capture=false; live_delivery=false; allow_all=false; allowed_recipients empty; **0** v2 outbox rows, **0** v2 deliveries, **0** v2 installations; **0** synthetic smoke users remain; the original **17** inbox notices and **17** pending legacy deliveries remain unchanged; **0** cron jobs. There was no historical replay, real email/push, production change, native build or store submission.

### Additional defects corrected in the hardening migration
Admission-deadline reminders may remain relevant after doors open and during events longer than five hours; their expiry now follows the purchased cutoff and actual event end. Reminder identities use timezone-independent timestamps, and changing a cutoff does not duplicate the 24-hour reminder. Eligibility and invalidation capture now recognize the actual `ticket_status=invalidated` and `validation_status=revoked` fields. A restored ticket suppresses a queued invalidation. The worker accepts Supabase's PromiseLike RPC builder without unsafe casts.

### Security advisor review
The post-DDL advisor returned no ERROR-severity notices, but it is not a clean global security audit. The five new private tables intentionally retain RLS with no client policy and revoked client table privileges. The eight new authenticated SECURITY DEFINER RPCs are intentional narrow APIs with owner/role/session checks; the negative staging tests above exercise those boundaries. Do not add permissive policies just to remove an informational warning.

Existing project warnings about `pg_net` in public, other authenticated SECURITY DEFINER functions and disabled leaked-password protection remain outside this notification patch. Reference guidance: [private RLS tables](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [authenticated privileged functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [extension location](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

### Next gates, still pending
Provider/sender configuration and authenticated runtime smoke, a new iOS/Android build, approved pilot recipients and physical-device checks, then deliberate activation of capture and server scheduling. Organizer sales/stock aggregation, admin incident routing with an independent channel, and email delivery/bounce reconciliation remain beyond this core. Keep #29 open and do not describe all 66 design types as complete.
