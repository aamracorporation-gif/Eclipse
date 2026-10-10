// Public links must not depend on the API transport configured for a build.
// The apex domain is parked; this branded host serves both event routes.
export const EVENT_LINK_ORIGIN = 'https://api.weareeclipseoficial.com';

export function eventShareUrl(eventId: string): string {
  // Tokens belong to one Supabase environment. The branded host must not
  // resolve a staging token against production and discard the event ID.
  return `${EVENT_LINK_ORIGIN}/event/${encodeURIComponent(eventId)}`;
}

export function eventReturnPath(value: unknown): string | null {
  return typeof value === 'string' && /^\/(\(tabs\)\/)event\/[a-zA-Z0-9-]+$/.test(value)
    ? value
    : null;
}
