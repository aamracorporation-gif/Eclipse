# Google Wallet Save repair — 2026-10-07

## Evidence and boundaries
Staging generate-wallet-pass v16 returned HTTP 200 at 18:28:22 and 18:28:44 UTC after the key-format fix. The Android user still reports Google's generic Save error. A 200 from the old handler confirms local signing, NOT Google acceptance. No actual Google rejection reason has yet been retrieved. Do not claim device success.

The original source omits the JWT origins field and embeds the full class/object in the Save link. A synthetic admission with a generated RSA key reproduces a 3,140-character JWT; the repaired reference-only token is 628 characters. These lengths are fixture measurements, not a captured user's pass. Google documents a safe encoded JWT length of 1,800 characters and recommends precreating objects for longer payloads.

References:
- https://developers.google.com/wallet/generic/web
- https://developers.google.com/wallet/generic/resources/faq
- https://developers.google.com/wallet/reference/rest/v1/Jwt
- https://developers.google.com/wallet/generic/resources/error-codes

## Narrow changes
- Retain gateway JWT verification, Supabase getUser and ownership checks. Check ticket payment/validation status, event cancellation/end and entry deadline before external calls.
- Verify credentials through OAuth, GET the configured existing generic class and GET/insert the deterministic generic object before returning a Save link. GET after a creation conflict; do not duplicate an object.
- Existing active objects receive only a presentation PATCH; never revive an inactive object or replace its QR. Reject class/QR mismatches. The shared class is read-only.
- Save JWT includes origins: [] and only the object's ID. Enforce a 1,800-character maximum and no-store HTTP response. Do not mark wallet_added merely because a link was prepared.
- Return specific sanitized configuration/OAuth/API/permission/class/payload errors. Never print the private key, OAuth token, signed URL or Google's raw response.
- No change to credentials, payments, DB schema, production or the Apple generator. Existing installed UI may still append its old generic installation hint; read the specific error and code above it.

## Verification
31 isolated handler tests pass locally with generated RSA keys and mocked Auth/DB/Google. Existing real-jose/passkit fixture regression is adapted to assert the API object and short JWT separately; it must also pass final PR CI. Tests cover ownership, invalid tickets, signing format, short link claims, API failures, concurrent creation response, existing-pass protection and VIP data. Fixtures have a frozen clock.

## Rollout
This change is based on PR #30, which remains stacked on #28. Do not merge main or deploy unrelated PR changes. Deploy only generate-wallet-pass and its four relative shared modules to Eclipse Staging, with verify_jwt=true. No auxiliary diagnostic endpoint is needed by this implementation.

Pending: verify real OAuth/API responses on the user's next authenticated Add to Wallet action; complete Android save with a non-privileged Google account; inspect all visual tiers and scan a staging QR. Test revocation after a pass is saved separately: this patch checks eligibility at generation time, not asynchronous pass invalidation. Keep production unchanged until device validation. Rollback by restoring the previous reviewed handler bundle; never weaken authentication or expose credentials to troubleshoot.
