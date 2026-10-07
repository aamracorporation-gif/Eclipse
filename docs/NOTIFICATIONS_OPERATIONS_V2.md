# Notification operations V2

Continuation of #33 / #29. This slice adds organizer sales summaries, product availability alerts, and read-only administrative diagnostics. It does not activate capture, external sends, schedules, marketing, SMS, resale or monetary wallet. Production and Wallet/payment functions are outside this change.

## Product rules
- Group sales into fixed 15-minute UTC windows by organizer/event. User preferences offer grouped, immediate, or history-only. VIP immediate override defaults false. Free invitations and box-office units remain grouped even in immediate mode.
- Capture only fulfilled primary payments or paid, non-Stripe free/box-office issuance. A whole VIP table counts once, not once per guest. Multi-ticket free claims use a common order identity. Retried status transitions do not double capture. Refunds before preparation and former organizers are excluded.
- Financial copy is the product subtotal from authoritative metadata, excluding buyer service fees. Missing amounts are not invented or shown as zero; no message describes this subtotal as available balance or bank payout. Later changes/refunds are checked in the organizer panel.
- Each batch records its exact membership under a transaction lock. Concurrent workers cannot count the same fact twice; late commits to the same window create a supplemental digest rather than disappear. Maximum 500 facts per batch / 50 groups per scheduler tick. These bounds may split a very busy window; this is not a financial reporting ledger.
- Admissions alert at 20%, 5%, and sold out. The effective VIP schema has current available quantity but no authoritative original total: VIP alerts therefore use last two tables, last table, and sold out, not invented percentage thresholds.
- Alert only on decreasing inventory crossing a more urgent band. Product creation, relabeling, reactivation and restocking do not produce alerts. Pending alerts become ineligible after band/revision change, restock, deactivation, deletion, event cancellation/end or organizer change. Repeated same-band crossings within one hour are inbox-only.
- General operations/channel preferences and quiet time still apply. Stock opt-out is independent. Public marketing remains impossible under the existing false-only preference constraint.

## Operations and security
The additive migration `20261007224744_notification_operations_v2.sql` was generated with Supabase CLI 2.120.0. It adds an independent operations_enabled=false gate, private RLS tables for sale facts/stock state/worker health, and narrow service-only execution tracking. No existing queue is backfilled.

The new admin diagnostic screen calls the existing admin-authorized RPC; it shows aggregate queue/lease/receipt counts, explicit gates, pilot recipient count and heartbeat metadata only. It exposes no tokens, recipient identities, provider bodies or customer message content, and has no activation actions. Changing accounts clears prior results. A heartbeat or provider acceptance never proves native delivery or reading.

The worker adds a service-only heartbeat around the existing dispatch algorithm. Deploy its index with notificationWorkerHealth.ts and notificationDelivery.ts only AFTER the migration. Existing exact service authorization and gateway JWT verification remain required.

## Validation and rollout status
42 local Node checks (existing 23 plus 19 new health/heartbeat cases) passed with mocked providers. New SQL, concurrency, component tests and ordinary app CI must pass before remote deployment. None of these tests sends real messages or validates physical Android/iPhone behavior.

At creation this is source-only: no operational migration or worker replacement has been deployed. Preserve staging's closed gates. Apply only this migration after checking base function drift, then run rollback-only effective-schema checks and source readback. Never execute tests/notifications/*fixture* or the disposable concurrency scripts on a Supabase project.

Capture, live delivery, pilot recipients, provider/sender validation, authenticated runtime invocation, new native clients, scheduled processing and device QA are separate activation gates. Administrative incident recipients and an independent alerting channel, plus email delivery/bounce reconciliation, remain pending. Keep #29 open; this does not complete all 66 designed types.
