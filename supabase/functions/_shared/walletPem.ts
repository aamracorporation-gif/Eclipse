/** Accept PEM secrets pasted as multiline text, JSON strings or base64-encoded PEM. */
export function normalizeWalletPem(value: string): string {
  let pem = String(value || '').trim().replace(/^\uFEFF/, '');
  if (pem.startsWith('"') && pem.endsWith('"')) {
    try { pem = JSON.parse(pem); } catch { pem = pem.slice(1, -1); }
  }
  const compact = pem.replace(/\s+/g, '');
  if (compact && !pem.includes('-----BEGIN') && /^[A-Za-z0-9+/=]+$/.test(compact) && compact.length % 4 === 0) {
    try { pem = atob(compact); } catch { /* Validation is performed by the signer. */ }
  }
  return pem.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim();
}
