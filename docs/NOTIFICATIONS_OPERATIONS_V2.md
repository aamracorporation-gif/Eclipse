# Notification operations V2

Continuation of #33 / #29, implemented in #34. Server changes are deployed to Eclipse Staging only. Capture, operations and external delivery remain disabled; there are no pilot recipients or new schedules. UI changes require a new native build. Production and Wallet/payment functions are outside this change.

## Product rules
- Group sales into fixed 15-minute UTC windows by organizer/event. User preferences offer grouped, immediate, or history-only. VIP immediate override defaults false. Free invitations and box-office units remain grouped even in immediate mode.
- Capture only fulfilled primary payments or paid, non-Stripe free/box-office issuance. A whole VIP table counts once, not once per guest. Multi-ticket free claims use a common order identity. Retried status transitions do not double capture. Refunds before preparation and former organizers are excluded.
- Financial copy is the product subtotal from authoritative metadata, excluding buyer service fees. Missing amounts are not invented or shown as zero; no message describes this subtotal as available balance or bank payout. Later changes/refunds are checked in the organizer panel.
- Each batch records its exact membership under a transaction lock. Concurrent workers cannot count the same fact twice; late commits to the same window create a supplemental digest rather than disappear. Maximum 500 facts per batch / 50 groups per scheduler tick. These bounds may split a very busy window; this is not a financial reporting ledger.
- Admissions alert at 20%, 5%, and sold out. The effective VIP schema has current available quantity but no authoritative original total: VIP alerts therefore use last two tables, last table, and sold out, not invented percentage thresholds.
- Alert only on decreasing inventory crossing a more urgent band. Product creation, relabeling, reactivation and restocking do not produce alerts. Pending alerts become ineligible after band/revision change, restock, deactivation, deletion, event cancellation/end or organizer change. Repeated same-band crossings within one hour are inbox-only.
- General operations/channel preferences and quiet time still apply. Stock opt-out is independent. Marketing remains disabled, as do SMS, resale and the monetary wallet.

## Operations and security
The additive migration `20261007224744_notification_operations_v2.sql` was generated with Supabase CLI 2.120.0. It adds an independent operations_enabled=false gate, private RLS tables for sale facts/stock state/worker health, and narrow service-only execution tracking. No existing queue is backfilled.

The admin diagnostic screen calls the existing admin-authorized RPC; it shows aggregate queue/lease/receipt counts, explicit gates, pilot recipient count and heartbeat metadata only. It exposes no tokens, recipient identities, provider bodies or customer message content, and has no activation actions. Account changes clear prior results. A heartbeat or provider acceptance never proves native delivery or reading.

The worker adds a service-only heartbeat around the unchanged dispatch algorithm. Deploy its index with notificationWorkerHealth.ts and notificationDelivery.ts only AFTER the migration. Exact service authorization and gateway JWT verification remain required.

## Verified code and CI
Runtime source: `9b674da1be6b67381ae8d183e0dc7c2c2815573a`.
- CI #127: https://github.com/aamracorporation-gif/Eclipse/actions/runs/37700982522 — passed completely, including typecheck, lint, app/component tests, Wallet regressions, web bundle, backend tests, dependency gates and secret scanning.
- Notification regression #7: https://github.com/aamracorporation-gif/Eclipse/actions/runs/37700982575 — passed completely.
- 63 new SQL assertions; existing 45 core and 19 hardening assertions passed before and after the operations migration.
- 6 concurrent-process scenarios passed: the 3 existing core checks plus parallel sales aggregation, late order handling and concurrent recording of the same source.
- 42 Node transport/type/health checks passed with mocked providers, including 19 new health/heartbeat cases.
- 6 new organizer preference component cases passed as part of app CI.
- The first operational database run detected an ambiguous PL/pgSQL stock-kind reference. It was explicitly renamed; no check or scanner was weakened.

Reviewed-source artifact SHA-256: `227d1d33856de5002880fa1e02d640ebd89f88f309604df944955903f77b6b73`. Its manifest hashes were verified locally; tested migration and worker files matched local candidates. The PR merge checkout was `96bb0caac61980c1af71f113d3d9542a25d97c40`.

## Staging deployment and effective-schema checks
Project: `uhondxttdpvywvkyqlkk` only.
- Applied the single reviewed operations migration as managed version `20261007231726`, with a closed-gate check and five base-function source hash guards. No legacy migrations were replayed.
- Read back all 15 new/replaced function bodies: MD5 hashes match tested source. New private tables have RLS and no direct anonymous/authenticated grants. The new heartbeat RPC is service-only; administrative health retains its checked user boundary.
- 30 rollback-only effective-schema checks passed. They exercise an existing fulfilled staging payment as a read-only reference, idempotent sale capture/preparation, organizer preference writes under authenticated role, temporary admission/VIP inventory transitions, stale-alert suppression, current inbox, client denial, admin health and closed delivery gating. The two temporary catalog products and all notification/preference/heartbeat writes rolled back. No payment row or balance was changed, no account was promoted, and no message was sent.
- Post-rollback: zero sale facts, stock states, v2 outbox/deliveries and installations; zero temporary catalog rows; original 17 legacy notices/deliveries unchanged.
- Deployed `dispatch-notifications-v2` version 2, ACTIVE, verify_jwt=true. Bundle digest `57e3c003e4e595f134c9d9fee365c903dceea8ad763c534f9d36b29775e0781e`. Source readback confirmed the heartbeat wrapper and unchanged transport.
- Unauthenticated HTTP POST returned 401 `UNAUTHORIZED_NO_AUTH_HEADER`. This verifies the gateway, NOT an authenticated worker execution or provider delivery. The persistent heartbeat correctly remains `never` after rollback tests.

Security advisors before/after retain the same 30 authenticated SECURITY DEFINER warnings, pg_net placement warning and leaked-password protection warning. Three additional INFO notices correspond to intentionally private server-only tables with RLS and no client policies; do not add permissive policies merely to clear these notices. Reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy . Existing security findings remain outside this feature's approval.

## Remaining gates
Capture, operations_enabled, live delivery and allow-all remain false; allowed_recipients is empty. No provider credentials were read, changed or validated by this slice. No native build, cron, real push/email, production deploy or branch merge was performed.

Before pilot: authorize the exact test account(s), verify Expo/APNs/FCM and email sender configuration, install the updated native client, then validate protected runtime execution and schedule processing with explicit pilot limits. Test foreground/background/closed app, permission denial, account switch, multiple devices, stale events, retries and safe deep links. Keep administrative incident recipients and an independent operational channel explicit. Email delivered/bounced webhook reconciliation and remaining conditional catalogue types are still pending. Keep #29 open: this is not completion of all 66 designed types or a production approval.
