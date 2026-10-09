export type AuthLinkParams = Record<string, string>;

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function appendParams(target: AuthLinkParams, raw: string): void {
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const [rawKey, ...rawValue] = pair.split('=');
    if (!rawKey) continue;
    target[decode(rawKey)] = decode(rawValue.join('='));
  }
}

/** Parses both query and hash parameters used by Supabase Auth links. */
export function parseAuthLinkParams(url: string): AuthLinkParams {
  const params: AuthLinkParams = {};
  const queryStart = url.indexOf('?');
  const hashStart = url.indexOf('#');

  if (queryStart >= 0) {
    const queryEnd = hashStart > queryStart ? hashStart : url.length;
    appendParams(params, url.slice(queryStart + 1, queryEnd));
  }
  if (hashStart >= 0) appendParams(params, url.slice(hashStart + 1));

  return params;
}

export function isPasswordRecovery(params: AuthLinkParams): boolean {
  return params.type === 'recovery';
}
