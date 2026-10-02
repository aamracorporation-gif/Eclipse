# Staging parity — 2026-10-02

Goal: production-equivalent application journeys on isolated staging services,
with release-hardening fixes and resale/monetary wallet disabled. Apple/Google
ticket passes remain in scope. Never copy production users, sales or live keys.

## Verified and corrected

- EAS preview has Supabase, Stripe test, Railway and Google Maps variables, but no
  EXPO_PUBLIC_MAPTILER_KEY in any listed EAS environment. Both native map screens
  use MapTiler through MapLibre/WebView. The Google key cannot satisfy that dependency.
- Release guards now require the MapTiler key. Map failures show retry and event-list
  navigation rather than leaving an unexplained blank map; retry restores cached pins.
- Applied staging_service_parity to uhondxttdpvywvkyqlkk: created events and night_mode
  public asset buckets and organizer_verification private bucket. Four event-object
  policies allow public reading and only authenticated owners to insert/update/delete.
  The private verification bucket has no direct client policies; its Edge Function
  checks the authenticated organizer and document ownership.
- Seeded 13 notification templates from production configuration only. The two resale
  templates are disabled. No user data, old notifications or file contents were copied.
- Added 12 missing Edge Functions: record-legal-acceptance,
  upload-organizer-verification-file, delete-account, stripe-connect-create-account,
  stripe-connect-refresh-status, stripe-get-account-stats,
  stripe-connect-delete-account, stripe-connect-onboarding-link,
  send-email-notifications, dispatch-notifications, event-share, ticket-calendar.
- Notification workers require the service credential before database/network access.
  Missing Resend configuration returns 503 without permanently failing queued mail.
- Connect callback origin follows the Supabase project. Staging no longer uses the
  production API callback. Return URLs allow only app schemes or the matching backend
  origin; arbitrary HTTPS destinations and malformed links are rejected.

## Checks completed

- 24 local Node tests pass: build environment guards and Edge service regressions.
- Map TSX transpiles with esbuild. This is not a native rendering/device test.
- HTTP probes to 10 authenticated deployed functions reject unauthenticated requests
  with 401. event-share also rejects unauthenticated creation (401); ticket-calendar
  rejects requests without a ticket capability (400). No external emails were sent.
- SQL verifies 3 buckets, 4 policies, Storage RLS enabled, 13 templates and zero
  enabled resale templates. Security advisors show no new categories/findings versus
  the pre-change check (existing findings remain tracked in the release runbook).

## Remaining dependencies — do not call this launch-ready

1. Add an active EXPO_PUBLIC_MAPTILER_KEY to EAS preview and verify style/tile access
   from both native WebViews. No active key is available in the EAS environment list.
2. Supabase Dashboard authentication is required to inspect/configure SMTP, Auth URL
   allowlists and Edge Function secrets; the installed connector does not expose
   those operations. Confirm Resend key and verified sender configuration for staging.
   Do not paste passwords, private keys or SMTP credentials into chat or Git.
3. public.dispatch_notifications_async() is currently a no-op in staging, and there
   are no cron jobs. Reconnect server-side dispatch only after credentials and test
   recipients are verified. Production cron command text was not copied: automated
   review rejected reading it because it could expose embedded credentials. Schedule
   metadata was read safely; reconstruct required jobs explicitly with staging secrets.
4. Staging contains 3 attendee profiles, no organizers, 1 expired QA event, no venues
   and no stored assets. Provision a test organizer through the normal auth/onboarding
   flow, then run the synthetic Sevilla seed with that organizer. Do not promote an
   existing attendee or copy production customer data just to manufacture test access.
5. Apple pass signer and SMS worker are not yet deployed to staging; verify signing
   certificates and provider configuration before enabling those paths. Google passes
   and push delivery also need actual provider/device checks; presence of a function
   is not proof that its secrets are configured or delivery works.
6. Build new preview APK/TestFlight only after the missing MapTiler variable is set.
   Then test signup, password recovery, maps, image uploads, organizer onboarding,
   test checkout, ticket QR, email delivery, notifications and ticket passes on devices.

The existing mobile artifacts predate these source changes. Backend configuration
changes are live in staging; map/build changes need a new artifact.

References: https://supabase.com/docs/guides/storage/buckets/creating-buckets,
https://supabase.com/docs/guides/functions/auth-headers,
https://docs.stripe.com/connect/hosted-onboarding.
