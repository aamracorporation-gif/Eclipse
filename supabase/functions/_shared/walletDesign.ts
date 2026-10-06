/** Shared presentation only; ticket authorization and QR payloads stay in the handlers. */
export const WALLET_THEMES = {
  general: { label: 'GENERAL', background: '#111020', foreground: '#FFFFFF', accent: '#BDA9FF' },
  vip: { label: 'VIP', background: '#19150F', foreground: '#FFFFFF', accent: '#E8C58B' },
  backstage: { label: 'BACKSTAGE', background: '#17101C', foreground: '#FFFFFF', accent: '#EAA9DE' },
  fastlane: { label: 'FASTLANE', background: '#0C1B20', foreground: '#FFFFFF', accent: '#D8F36A' },
};
export function walletTier(category: unknown, name: unknown): keyof typeof WALLET_THEMES {
  const text = `${category || ''} ${name || ''}`.toLowerCase();
  if (/backstage|back stage|founder/.test(text)) return 'backstage';
  if (/vip|reservad/.test(text)) return 'vip';
  if (/fastlane|fast lane|express|fast.track/.test(text)) return 'fastlane';
  return 'general';
}
export function walletDate(date: Date | null, time = false): string {
  if (!date || !Number.isFinite(date.getTime())) return 'Por confirmar';
  return new Intl.DateTimeFormat('es-ES', time
    ? { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }
    : { timeZone: 'Europe/Madrid', day: '2-digit', month: 'short' }).format(date).replace(/\./g, '');
}
export function walletRgb(hex: string): string {
  return `rgb(${[1,3,5].map(i => parseInt(hex.slice(i,i+2),16)).join(',')})`;
}
// Immutable public artwork, contains no ticket data or credentials.
export const WALLET_ART_BASE = 'https://raw.githubusercontent.com/aamracorporation-gif/Eclipse/39426435f4d26cd47f72a473dd3d31c96f10787c/assets/wallet-pass';
