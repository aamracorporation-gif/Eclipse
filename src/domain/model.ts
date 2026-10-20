import {normalizeWhitespace} from '../../lib/normalize.ts';
export type Sport = 'padel' | 'football7' | 'basket3x3' | 'tennis';
export type Format = 'knockout' | 'league' | 'challenge';
export type Row = Record<string, any>;
export type Actor = { id: string; role: 'player' | 'admin'; name: string; suspended?: boolean };
export const sports: Record<Sport, string> = { padel: 'Pádel', football7: 'Fútbol 7', basket3x3: 'Basket 3×3', tennis: 'Tenis' };
export const formats: Record<Format, string> = { knockout: 'Torneo', league: 'Liga', challenge: 'Desafío' };
export const TERMS_VERSION = 'pilot-2026-10-20';
export class DomainError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
export function ensure(value: unknown, code: string, message: string, status = 400): asserts value {
  if (!value) throw new DomainError(code, message, status);
}
export function text(value: unknown, name: string, min = 2, max = 150): string {
  ensure(typeof value === 'string', 'VALIDATION', `${name}: texto obligatorio.`);
  const result = normalizeWhitespace(value);
  ensure(result.length >= min && result.length <= max && !/[\u0000-\u001f\u007f]/u.test(result), 'VALIDATION', `${name}: entre ${min} y ${max} caracteres.`);
  return result;
}
export function integer(value: unknown, name: string, min: number, max: number): number {
  ensure(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, 'VALIDATION', `${name}: entero entre ${min} y ${max}.`);
  return value;
}
export function isoDate(value: unknown, name = 'Fecha'): string {
  ensure(typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), 'VALIDATION', `${name}: fecha con zona horaria obligatoria.`);
  return new Date(value).toISOString();
}
export function choice<T extends string>(value: unknown, values: readonly T[], name: string): T {
  ensure(typeof value === 'string' && values.includes(value as T), 'VALIDATION', `${name}: valor no válido.`);
  return value as T;
}
