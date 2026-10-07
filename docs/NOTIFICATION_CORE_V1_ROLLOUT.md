# Notification core V1 — implementation / controlled rollout

Tracks #29. Built on #32 (Google Wallet), preserving #30 discounts and #28 dependency repairs. This implements a first transactional slice, not all 66 designed notifications. The accepted instruction is to start the core; undecided marketing, sales cadence, reminders and incident recipients are NOT silently activated.

## Included
16 Spanish templates: admission/VIP/free/box-office confirmation; refund pending/completed; invalidation/check-in; cancellation/schedule/venue/access/lineup changes; purchased benefits changes; organizer verification approved/needs correction. The private catalogue has no marketing, SMS, resale or balance type.

Paid confirmation comes only from committed fulfillment with issued paid tickets, not from a UI success or every inserted ticket. Independent purchases have independent dedupe keys. A VIP table is one order with its group's capacity. Refund_pending does not claim a refund was completed. Price/stock edits do not notify past buyers; editing the existing venue address is covered. Purchase snapshot changes are distinct from editing future offers.

A committed inbox notification and per-device/channel jobs form the transactional outbox. Provider HTTP is outside purchase transactions. Capture failure due to a broken database invariant can still fail its SQL transaction; provider outages cannot. Schema rehearsal and business-flow QA are required before enabling capture.

## Delivery and access boundaries
Private schema with RLS/no client access. Enqueue, claim, preflight, finish and receipt RPCs are service-only. Client RPCs check auth.uid(), expected user for race prevention and ownership. A read/archive never edits delivery state or deletes audit evidence. Exact unread count is separate from pagination.

Device registration uses the actual EAS project ID and live auth session. Rebinding a token changes its revision; old queued jobs cannot follow it to another account. Legacy token registration for that token is disabled. Logout explicitly unbinds before sign-out, and dispatch rechecks session liveness. Already-accepted provider messages cannot be recalled; lock-screen content is generic and detail is loaded under RLS. Do not claim end-to-end exactly-once delivery.

Worker: 10 jobs/run, concurrency 2, two-minute leases, four maximum attempts, 20-hour expiry. Retry delays 60/300/900 seconds within the expiry. Resend uses a stable idempotency key and the retry horizon stays below its 24-hour retention. Ambiguous push delivery (timeout/crash after send) becomes uncertain rather than blindly duplicated. Lease compare-and-set rejects stale worker updates.

Expo tickets are `accepted`, not delivered. Receipts are checked after 15 minutes and marked provider_confirmed, never as device opened; late/absent receipts remain unknown. Invalid-device receipts deactivate only the same device revision. Resend acceptance is recorded; Resend delivery/bounce webhooks are NOT part of this slice. Provider failures need operator follow-up; independent incident alerting is a later stage.

The UI provides safe inbox/detail, filters, archive, read-all, pagination, error/retry and core preferences. Native permission is requested only after an explicit user action. Background/foreground permission inspection does not prompt. Push payload routes only to /notifications with a validated ID; arbitrary URLs and privileged routes are ignored. No user metadata is used to authorize organizer links. Selecting the inbox alone does not mark all read.

## Defaults / intentionally not activated
Migration defaults: capture_enabled=false, delivery_enabled=false, no project ref/Expo project, empty staging allowlist. No backfill, no replay of the 17 historical pending deliveries, no cron installed. When capture is enabled without delivery, outbound jobs are terminal skipped, not held for a burst later. Existing non-pilot producers are not suppressed.

Quiet hours are optional/off by default; enabling the switch explicitly selects 00:00–11:00 Europe/Madrid for push, exempting user-initiated order confirmations. Event-night exception, editable time-zone/hours UI and configurable sales/reminders remain to be agreed/implemented. Marketing stays off independent of old marketing preference values.

## Rollout sequence
1. Run ordinary PR CI including real PGlite migration fixture tests, transport/client safety tests, TypeScript, lint, app/backend, Wallet and secret checks.
2. Review migration against staging's current schema. Apply ONLY 20261007194601_notification_core_v1.sql once; never run the legacy migration chain. This creates a separate queue and leaves old deliveries intact. Verify defaults/RLS/RPC grants and compare security advisors.
3. Deploy only dispatch-core-notifications and its shared notificationDelivery.ts with verify_jwt=true. It additionally requires the service credential before database/provider access. No new diagnostic endpoint or public enqueue is introduced.
4. Configure the private runtime with the actual staging project ref and EAS project UUID, and explicit QA user UUIDs. Keep delivery disabled until the provider/sender/device checklist passes. Do not substitute a merchant/Wallet/Firebase service-account key for push credentials.
5. Build the new mobile code against staging (new RPCs/columns required), test inbox/preferences and explicit registration on physical iOS/Android. Old builds do not gain these UI/device-binding changes from a server deployment.
6. Confirm Expo APNs/FCM credentials and optional Expo access token; confirm RESEND_API_KEY and verified NOTIFICATIONS_FROM_EMAIL on the server. Never put secrets in the repo, chat or SQL scripts. Verify a QA recipient, then explicitly enable deliveries for that allowlist only.
7. Configure a server-side scheduler for authenticated dispatch and later receipt reconciliation. No foreground mobile dispatcher. Use a secured secret reference, not a literal key in a committed cron command. Cron setup is still pending.
8. Trigger NEW QA purchases and transitions; do not replay old queues or mark jobs manually accepted. Test two purchases, VIP, free, actual verified mail, foreground/background/terminated push, consent denied, logout/account switch, multiple devices, archive/read while a delivery waits, expired jobs, retry and replay. Record provider evidence separately from device save/open evidence.
9. Confirm the rollout with Ash before production. Production configuration/schema/credentials and marketing are untouched.

## Validation status
Local transport/client tests cover mocked providers and real helper logic. SQL fixture tests must pass in CI before deployment. No real notification has been sent by this implementation session. Native build/device notification tests, real Resend/Expo delivery, receipt timing, multi-connection stress, scheduler and production promotion remain unverified until recorded explicitly in the PR.

## Deferred work
Reminders (24h/2h/deadline), organizer sales digests/stock/billing, staff assignments, admin incidents/health, persistent support/waitlist/favorites, multilingual notification copy, email delivery/bounce webhooks, recipient-authorized deep links in emails and approved marketing. Existing Google/Apple Wallet pass behavior is not changed by this work.

References: https://docs.expo.dev/push-notifications/sending-notifications/ ; https://docs.expo.dev/versions/v54.0.0/sdk/notifications/ ; https://supabase.com/docs/guides/database/postgres/row-level-security ; https://supabase.com/docs/guides/functions/schedule-functions ; https://resend.com/docs/dashboard/emails/idempotency-keys .
