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
2. Apply only the reviewed new migration to Eclipse Staging. Do not replay legacy migrations. Keep safety gates closed and run rollback-only tests against effective staging schema/ACLs.
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

## Current validation record
The initial isolated PostgreSQL 17 run passed 45 SQL assertions (business identities, role/ownership boundaries, cutover isolation, leases, receipts, preferences, reminders). Local worker suite passed 22 mocked-provider tests. Full final PR CI, concurrent-session tests and staging deployment are recorded separately as they complete; these sentences do not assert an unperformed deployment.
