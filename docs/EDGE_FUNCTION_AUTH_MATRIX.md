# Edge Function authentication review

## JWT required

`create-payment-intent-v2`, `confirm-payment`, all `stripe-connect-*`,
`stripe-get-account-stats`, `delete-account`, `record-legal-acceptance`,
`send-push`, `dispatch-notifications`, `send-email-notifications`,
`send-sms-notifications`, `apple-wallet-generator` and `generate-wallet-pass`.

The payment and account functions validate the user again internally. Notification
dispatchers are server-to-server and must receive the service-role JWT.

## Intentionally public (`verify_jwt = false`)

- `auth-redirect`: browser/deep-link callback; contains no privileged mutation.
- `send-support-email`: public contact entry point; retain strict rate limiting,
  input limits and abuse monitoring.
- `event-share`: public event landing page.
- `ticket-calendar`: capability-link endpoint; the opaque ticket token is the
  credential and must remain unguessable/revocable.
- `register-user-fallback`: bootstrap path used before a normal session exists;
  it must never accept role or privilege fields from the caller.

Any new function defaults to `verify_jwt = true`. An exception requires a threat
model, rate limit, bounded input and an owner recorded in the security review.
