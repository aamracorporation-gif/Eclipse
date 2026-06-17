[OPEN] Wallet invalid pass debugging session

- Session ID: `wallet-invalid-pass`
- Symptom: Apple Wallet muestra `Failed to parse pass data: The pass cannot be read because it isn't valid`.
- Scope: iOS TestFlight and development builds when tapping `Anadir a la cartera`.
- Current evidence:
  - PassKit native module is available in the iOS build.
  - `apple-wallet-generator` returns Base64 successfully.
  - ZIP entries, manifest, signature, and certificate identity appear structurally coherent in logs.
- Active hypotheses:
  - H1: The generated CMS/PKCS7 signature is structurally present but rejected by Wallet.
  - H2: The exported `pass.json` still violates an Apple content requirement not covered by current logs.
  - H3: The fallback PNG assets are valid PNGs but still unacceptable to Wallet on device.
  - H4: The client-side native bridge is collapsing a more specific PassKit error into a generic invalid-data message.
- Evidence update:
  - H4 confirmed first: the expanded native error exposed the underlying PassKit reason.
  - Root cause identified from device logs: `icon.png` hash in `manifest.json` did not match the actual file bytes extracted by Wallet.
  - Minimal fix applied in backend: pass assets are now passed to `passkit-generator` as `Buffer` values, not raw `Uint8Array`.
