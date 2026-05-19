import { getPasswordRequirements, isPasswordStrong, normalizeWhitespaceForInput } from '@/lib/validators';

describe('normalizeWhitespaceForInput', () => {
  it('preserva un espacio final mientras el usuario escribe', () => {
    expect(normalizeWhitespaceForInput('Buenos ')).toBe('Buenos ');
    expect(normalizeWhitespaceForInput('Ciudad de ')).toBe('Ciudad de ');
  });

  it('permite espacios internos y colapsa múltiples espacios', () => {
    expect(normalizeWhitespaceForInput('Ciudad   de   México')).toBe('Ciudad de México');
    expect(normalizeWhitespaceForInput('  Buenos   Aires  ')).toBe('Buenos Aires ');
  });

  it('elimina espacios iniciales', () => {
    expect(normalizeWhitespaceForInput('  Madrid')).toBe('Madrid');
    expect(normalizeWhitespaceForInput('Madrid  ')).toBe('Madrid ');
  });
});

describe('password security requirements', () => {
  it('detecta requisitos de contraseña y valida seguridad completa', () => {
    expect(isPasswordStrong('abc')).toBe(false);
    expect(getPasswordRequirements('abc').minLength).toBe(false);

    const r = getPasswordRequirements('Abcdef1!');
    expect(r.minLength).toBe(true);
    expect(r.hasUpper).toBe(true);
    expect(r.hasLower).toBe(true);
    expect(r.hasNumber).toBe(true);
    expect(r.hasSpecial).toBe(true);
    expect(r.onlyAllowedChars).toBe(true);
    expect(isPasswordStrong('Abcdef1!')).toBe(true);
  });

  it('rechaza emojis y símbolos fuera de la lista permitida', () => {
    expect(isPasswordStrong('Abcdef1😺')).toBe(false);
    expect(getPasswordRequirements('Abcdef1😺').hasSpecial).toBe(false);
    expect(getPasswordRequirements('Abcdef1😺').onlyAllowedChars).toBe(false);

    expect(isPasswordStrong('Abcdef1_')).toBe(false);
    expect(getPasswordRequirements('Abcdef1_').hasSpecial).toBe(false);
    expect(getPasswordRequirements('Abcdef1_').onlyAllowedChars).toBe(false);
  });
});
