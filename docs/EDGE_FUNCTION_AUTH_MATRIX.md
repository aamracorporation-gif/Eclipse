# Edge Function authentication review

## JWT required

`create-payment-intent-v2`, `confirm-payment`, all `stripe-connect-*`,
`stripe-get-account-stats`, `delete-account`, `record-legal-acceptance`,
`send-support-email`, `send-push`, `dispatch-notifications`, `send-email-notifications`,
`send-sms-notifications`, `apple-wallet-generator` and `generate-wallet-pass`.

The payment and account functions validate the user again internally. Notification
dispatchers are server-to-server and must receive the service-role JWT. In
particular, `send-push` compares the bearer credential with the service-role key
before reading any queued notification.

## Intentionally public (`verify_jwt = false`)

- `auth-redirect`: browser/deep-link callback; contains no privileged mutation.
- `event-share`: public event landing page.
- `ticket-calendar`: capability-link endpoint; the opaque ticket token is the
  credential and must remain unguessable/revocable.

## Retired public routes

- `register-user-fallback`: returns `410`; account creation must use Supabase
  Auth so email verification cannot be bypassed.
- `create-payment-intent`: returns `410`; all purchases use the authenticated,
  idempotent v2 endpoint.
- `qa-board`: returns `404`; QA data is never exposed by an Edge Function.

Any new function defaults to `verify_jwt = true`. An exception requires a threat
model, rate limit, bounded input and an owner recorded in the security review.
