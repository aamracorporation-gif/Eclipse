// Adapted from Eclipse/lib/validators.ts (MIT, 2026 aamracorporation-gif).
export function normalizeWhitespace(input: string) {
  return String(input || '').replace(/\s+/g, ' ').trim();
}
