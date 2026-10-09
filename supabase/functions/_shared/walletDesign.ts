/** Shared presentation only; ticket authorization and QR payloads stay in the handlers. */
export const WALLET_THEMES = {
  general: { label: 'ENTRADA', background: '#111020', foreground: '#FFFFFF', accent: '#CCBAF4' },
  vip: { label: 'MESA VIP', background: '#19150F', foreground: '#FFFFFF', accent: '#E6CFAD' },
  backstage: { label: 'BACKSTAGE', background: '#17101C', foreground: '#FFFFFF', accent: '#E7B7D0' },
  fastlane: { label: 'PRIORITARIO', background: '#0C1B20', foreground: '#FFFFFF', accent: '#ACE0D6' },
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
export const WALLET_ART_BASE = 'https://raw.githubusercontent.com/aamracorporation-gif/Eclipse/fb7b7370ae890f73810302532293f9f5c8105ccc/assets/wallet-pass';
