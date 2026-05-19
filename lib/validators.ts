export function calculateAgeFromDate(date: Date) {
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const m = today.getMonth() - date.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < date.getDate())) age--;
  return age;
}

export function normalizeWhitespace(input: string) {
  return String(input || '').replace(/\s+/g, ' ').trim();
}

export function normalizeWhitespaceForInput(input: string) {
  const raw = String(input || '');
  let s = raw.replace(/\s+/g, ' ');
  s = s.replace(/^\s+/, '');
  return s;
}

export function normalizeSearchQuery(input: string) {
  return normalizeWhitespace(String(input || '')).toLowerCase();
}

export type PasswordRequirements = {
  minLength: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
  onlyAllowedChars: boolean;
};

export function getPasswordRequirements(password: string): PasswordRequirements {
  const p = String(password || '');
  const allowedSpecials = `!@#$%^&*(),.?":{}|<>`;
  const escaped = allowedSpecials.replace(/[-\\\]^]/g, '\\$&');
  const specialRe = new RegExp(`[${escaped}]`);
  const invalidCharRe = new RegExp(`[^A-Za-z0-9${escaped}]`);
  const hasInvalid = invalidCharRe.test(p);
  return {
    minLength: p.length >= 6,
    hasUpper: /[A-Z]/.test(p),
    hasLower: /[a-z]/.test(p),
    hasNumber: /[0-9]/.test(p),
    hasSpecial: specialRe.test(p),
    onlyAllowedChars: !hasInvalid,
  };
}

export function isPasswordStrong(password: string) {
  const r = getPasswordRequirements(password);
  return r.minLength && r.hasUpper && r.hasLower && r.hasNumber && r.hasSpecial && r.onlyAllowedChars;
}

export function eventMatchesQuery(
  event: {
    title?: string | null;
    location?: string | null;
    description?: string | null;
    eventType?: string | null;
    theme?: string | null;
    venues?: { name?: string | null } | null;
  },
  query: string
) {
  const q = normalizeSearchQuery(query);
  if (!q) return true;
  const haystack = [
    event.title,
    event.location,
    event.description,
    event.eventType,
    event.theme,
    event.venues?.name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export function filterEventsByQuery<T extends Parameters<typeof eventMatchesQuery>[0]>(events: T[], query: string) {
  const q = normalizeSearchQuery(query);
  if (!q) return events;
  return (events || []).filter((e) => eventMatchesQuery(e, q));
}

function hasControlChars(s: string) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(String(s || ''));
}

export function isValidPersonName(input: string) {
  const s = normalizeWhitespace(input);
  if (!s) return false;
  if (hasControlChars(s)) return false;
  return /^[\p{L}]+(?:[ '\-][\p{L}]+)*$/u.test(s);
}

export function isSafeTextNoEmojis(input: string) {
  const s = String(input || '');
  if (!s) return true;
  if (s.includes('\n') || s.includes('\r') || s.includes('\t')) return false;
  if (hasControlChars(s)) return false;
  return /^[\p{L}\p{N}\s.,'’"¡!¿?\-_:;()&+/€@#%/ºª]*$/u.test(s);
}

export function isSafeAddressText(input: string) {
  const s = String(input || '');
  if (!s) return true;
  if (s.includes('\n') || s.includes('\r') || s.includes('\t')) return false;
  if (hasControlChars(s)) return false;
  return /^[\p{L}\p{N}\s.,'’"\-#/ºª]*$/u.test(s);
}

export function isSafeOrgText(input: string) {
  const s = String(input || '');
  if (!s) return true;
  if (s.includes('\n') || s.includes('\r') || s.includes('\t')) return false;
  if (hasControlChars(s)) return false;
  return /^[\p{L}\p{N}\s.&'’"\-()/#]*$/u.test(s);
}

export function isUuid(input: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(input || ''));
}

export function buildPublicEventShareUrl(baseUrl: string, token: string) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!base) return '';
  if (!isUuid(token)) return '';
  return `${base}/evento/${token}`;
}

export function normalizeIban(input: string) {
  return String(input || '').replace(/\s+/g, '').toUpperCase();
}

export function isValidIbanES(input: string) {
  const iban = normalizeIban(input);
  if (!/^ES[0-9]{22}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const chunk = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of chunk) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

export function normalizeTaxId(input: string) {
  return String(input || '').replace(/\s+/g, '').toUpperCase();
}

function isValidNif(digits8: string, letter: string) {
  if (!/^[0-9]{8}$/.test(digits8) || !/^[A-Z]$/.test(letter)) return false;
  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  const idx = Number(digits8) % 23;
  return letters[idx] === letter;
}

function isValidNie(nie: string) {
  if (!/^[XYZ][0-9]{7}[A-Z]$/.test(nie)) return false;
  const map: Record<string, string> = { X: '0', Y: '1', Z: '2' };
  const digits8 = map[nie[0]] + nie.slice(1, 8);
  const letter = nie[8];
  return isValidNif(digits8, letter);
}

function isValidCif(cif: string) {
  if (!/^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/.test(cif)) return false;
  const type = cif[0];
  const digits = cif.slice(1, 8);
  const control = cif[8];

  let sumEven = 0;
  let sumOdd = 0;
  for (let i = 0; i < digits.length; i++) {
    const n = Number(digits[i]);
    if ((i + 1) % 2 === 0) {
      sumEven += n;
    } else {
      const dbl = n * 2;
      sumOdd += Math.floor(dbl / 10) + (dbl % 10);
    }
  }
  const sum = sumEven + sumOdd;
  const mod = sum % 10;
  const controlDigit = (10 - mod) % 10;
  const controlLetters = 'JABCDEFGHI';
  const controlLetter = controlLetters[controlDigit];

  const mustBeLetter = 'PQRSNW'.includes(type);
  const mustBeDigit = 'ABEH'.includes(type);

  if (mustBeLetter) return control === controlLetter;
  if (mustBeDigit) return control === String(controlDigit);
  return control === String(controlDigit) || control === controlLetter;
}

export function isValidSpanishTaxId(input: string) {
  const id = normalizeTaxId(input);
  if (/^[0-9]{8}[A-Z]$/.test(id)) return isValidNif(id.slice(0, 8), id[8]);
  if (/^[XYZ][0-9]{7}[A-Z]$/.test(id)) return isValidNie(id);
  if (/^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/.test(id)) return isValidCif(id);
  return false;
}

export function normalizePhoneEsE164(input: string) {
  const raw = String(input || '').replace(/\s+/g, '');
  if (!raw) return '';
  if (raw.startsWith('+')) return raw;
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.startsWith('34') && digits.length >= 11) return `+${digits}`;
  if (digits.length === 9) return `+34${digits}`;
  return `+${digits}`;
}
