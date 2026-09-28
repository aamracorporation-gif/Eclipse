# Eclipse staging release QA — 29 September 2026 (Europe/Madrid)

## Scope and release decision

Staging only. No production migrations, real charges or store publication.
**NO-GO for public launch:** full-wallet accounting, end-to-end Connect settlement,
refund coverage and native device validation remain open.

## Shipped in b78796d

- Primary card fulfillment checks event cancellation/expiry, remaining inventory,
  ticket-type activity/deletion/stock, price changes, available credit and reserve backing.
- Unavailable purchases enter a durable `refund_pending` state before contacting Stripe.
- Replay cannot issue tickets after the refund decision, even if availability recovers.
- Primary refunds reuse existing refunds and a stable idempotency key. Destination
  charges reverse transfers and, when present, the application fee.
- Primary refund webhook failures remain visible for reconciliation.
- Resale's outer guard now locks ticket before listing, matching the inner fulfillment,
  wallet purchase and cancellation paths. This removes one inconsistent lock order;
  it is not proof of system-wide freedom from deadlocks.
- `private.fulfill_primary_card` is not directly executable by public, anon,
  authenticated or service_role. Existing wrapper ACLs are preserved.

Migration applied to project `uhondxttdpvywvkyqlkk` only.
Railway staging deployment `31de0f2d-2224-4477-b4a5-c74b1bf00fc3`: SUCCESS.

## Verification performed

- Reproduced the original bug: a canceled event issued a primary ticket. Entire
  reproduction transaction rolled back.
- Backend: **53/53 tests passed** locally (including five new refund tests).
- Primary database rejection suite: **12 scenarios passed**, with replay, balance,
  inventory, organizer-revenue and ACL assertions.
- Existing primary QR suite: single/multiple ticket issuance and stable replay passed.
- Existing VIP card suite: **14 scenarios passed**.
- Existing credit-backing suite: **10 scenarios passed**.
- Existing scanner suite: **20 scenarios passed**.
- Last-ticket SQL simulation: one available ticket, two synthetic payments;
  one fulfilled, one refund_pending/event_sold_out, one issued ticket, stock 0, sold 1.
  Separate sessions were requested in parallel but server timestamps show they did
  not overlap. **Do not count as a true concurrent-purchase test.**
- Disposable last-ticket users/event/tickets/payment rows were removed and absence
  of both synthetic users was verified. No real Stripe payments were created.

## Full-wallet accounting reproduction — STILL FAILING

An isolated transaction provisioned a synthetic buyer with 20 EUR in both the
current `user_credit` and old `creditos_usuario` systems, a funded old escrow,
and a 10 EUR primary ticket. Calling `buy_ticket_with_credito_v2` produced:

| Assertion | Observed |
| --- | --- |
| Issued tickets | 1 |
| Old balance after 10.50 EUR debit | 9.50 EUR |
| Current balance displayed by app | 20.00 EUR (unchanged) |
| Organizer revenue entries | 0 |

The reproduction rolled back. No historic balances were rewritten or mirrored.
`buy_vip_with_credito` also calls the old debit helper. Moving balances alone is
insufficient: the replacement must atomically preserve real/promo funding,
reserve provenance, purchase identity, organizer entitlement, refundability and
idempotency. A wallet purchase must not invent a Stripe PaymentIntent.

## Decisions and further gates

- Confirm promotional-credit funding: does Eclipse finance the redeemed discount
  while preserving the organizer's normal net entitlement, or is it organizer-funded?
  This affects the liability and settlement design, not just the displayed balance.
- Confirm whether the current 0.50 EUR minimum buyer fee should apply to a purchase
  entirely paid with existing credit, which creates no new Stripe card charge.
- Implement and test unified full-wallet debit/settlement after fixing that policy.
- Test primary/VIP mixed card-credit revenue and reconciliation, including refunds.
- Run real overlapping buyer requests using an authenticated test harness.
- Perform authenticated app checkout plus Stripe sandbox Connect transfers/refunds.
- Android APK build `a6a7a000-2d18-4911-a7fe-b66196863336` succeeded on source `84b952f`.
  Device acceptance testing is NOT complete. Later server-only fixes do not prove
  password recovery, wallet passes, UI or native payment methods work on devices.
- iOS staging build/device testing, credential rotation, production readiness and
  store release remain open. Do not describe this report as release approval.
