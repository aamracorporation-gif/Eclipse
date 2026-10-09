/** Use the HTTPS bridge in installed builds; never fall back to localhost. */
export function resolveAuthRedirect(options: {
  explicitUrl?: string;
  apiUrl?: string;
  fallback: string;
}): string {
  const explicit = options.explicitUrl?.trim();
  if (explicit) return explicit;
  const api = options.apiUrl?.trim();
  if (api) {
    try {
      const url = new URL(api);
      if (url.protocol === 'https:') return `${url.origin}/auth/verify`;
    } catch {}
  }
  return options.fallback;
}
