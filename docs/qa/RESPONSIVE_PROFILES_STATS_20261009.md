# Profiles, staff, navigation and organizer statistics

The customer and organizer tab bars now occupy normal layout space. Nested staff screens and the account deletion action cannot extend behind the bar. Redundant fixed bottom padding was reduced on the main event and ticket lists. The purchase and event creation forms retain the build 65 design.

Customer and organizer profiles share their header, avatar, typography, card surfaces and purple palette. Staff management and invitations use the same surfaces and constrained content width. Long names, permission descriptions and footer actions wrap. Profile editing dialogs no longer force a minimum height larger than a short viewport. Shared buttons grow when their labels wrap.

The staff event selector no longer has a 100-pixel height cap. Its full event title and date remain visible; ticket quantity controls wrap below the name when needed.

The organizer dashboard previously loaded tickets through the public event feed and displayed an unrelated fixed 30-day Stripe total above the chart. It now queries paid tickets joined to the signed-in organizer's events under existing RLS, paginates results, and shares local calendar boundaries between totals and chart (today, Monday-to-today, first-of-month-to-today). It refreshes on focus, foreground, filter changes, pull-to-refresh and every minute while active. Failed requests show an error and retry action rather than a false zero. Superseded responses cannot overwrite newer results. Stripe available balance remains a separate value.

## Verification

- Local app suite: 274 passed, one existing skipped test.
- Type check passed; lint has no errors (pre-existing warnings remain).
- Five new sales regression tests cover calendar boundaries, pagination, ownership filters, empty results and failed requests.
- `scripts/qa/capture-responsive.cjs` renders six actual screens with offline sample data inside React Navigation's real bottom-tab navigator. The tab styles are extracted from the app layouts.
- 30 layout cases: 320×568, 390×844 with a 34-pixel bottom inset, 844×390 landscape, 768×1024, and 320×568 with text enlarged to 135% in the browser. Checks cover horizontal overflow, account deletion / add-worker clearance above tabs and changing dashboard totals by period.
- These are React Native Web checks, not proof of native iOS/Android keyboard, accessibility or physical-device behavior. The sample account and sales are fictional. No real purchase, invitation or notification is sent by the harness.

Run with `ECLIPSE_REVIEW_TOOLS` pointing to isolated dependencies containing esbuild and Playwright, then `node scripts/qa/capture-responsive.cjs`.

## Notifications

The existing gated notification runner has been successfully deployed in staging after billing was restored. Its database heartbeat reports completed cycles with push configured; all-recipient staging delivery remains subject to user preferences, device permission and session-bound installation checks. Production was not changed. Android still requires the FCM V1 service credential in EAS, and physical-device delivery remains to be confirmed. No new app build or store submission is implied by these checks.
