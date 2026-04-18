export function calculateAgeFromDate(date: Date) {
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const m = today.getMonth() - date.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < date.getDate())) age--;
  return age;
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

