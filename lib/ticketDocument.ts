import { resolveTicketProduct } from '../supabase/functions/_shared/ticketProduct';
import {
  WALLET_THEMES,
  walletDate,
} from '../supabase/functions/_shared/walletDesign';
import { create } from 'qrcode/lib/core/qrcode';
import { render } from 'qrcode/lib/renderer/svg-tag';

const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** Local QR generation: admission tokens never leave the device to render a PDF. */
export function buildTicketDocument(ticket: any): string {
  const product = resolveTicketProduct(ticket),
    theme = WALLET_THEMES[product.visual];
  const qr = create(ticket.qr_token || ticket.qr_code || ticket.id, {
    errorCorrectionLevel: 'M',
  });
  const svg = render(qr, {
    margin: 4,
    width: 210,
    color: { dark: '#111020', light: '#FFFFFF' },
  });
  const people = Number(product.metadata.vipGroupSize || ticket.quantity || 1);
  const event = ticket.events || {},
    date = event.event_date ? new Date(event.event_date) : null;
  const inclusions = [
    product.metadata.benefits,
    ...(product.metadata.vipBottles || []).map(
      (b: any) => `${b.quantity} × ${b.brand || b.label}`,
    ),
  ]
    .filter(Boolean)
    .join(' · ');
  const field = (label: string, value: unknown) =>
    value
      ? `<div class="field"><small>${escape(label)}</small><strong>${escape(value)}</strong></div>`
      : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrada Eclipse</title><style>
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#F3EEF8;background:#EEEAF1;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .ticket{max-width:550px;margin:auto;border-radius:20px;overflow:hidden;background:${theme.background}}.art{position:relative;height:132px;background:${theme.accent};color:#171020;overflow:hidden;padding:22px}.brand{font-weight:900;letter-spacing:5px;font-size:13px;position:relative;z-index:2}.orbit{position:absolute;width:210px;height:210px;border:1px solid #433849;border-radius:50%;right:12px;top:-35px;box-shadow:0 0 0 9px ${theme.accent},0 0 0 10px #736575,0 0 0 20px ${theme.accent},0 0 0 21px #948298}.moon{position:absolute;inset:23px;border-radius:50%;background:#171020;box-shadow:6px 0 7px #fff9}.type{position:absolute;bottom:18px;font-size:12px;font-weight:bold;letter-spacing:2px}.body{padding:24px}h1{font-size:32px;letter-spacing:-1.2px;margin:0 0 20px}.fields{display:flex;flex-wrap:wrap;gap:18px}.field{min-width:42%;flex:1}small{display:block;color:${theme.accent};font-size:9px;letter-spacing:1.4px;margin-bottom:6px;text-transform:uppercase}strong{font-size:15px;line-height:1.4}.included{margin-top:20px;font-size:13px;line-height:1.6}.qr{text-align:center;padding:20px;border-top:1px dashed #706077}.code{font-size:13px;letter-spacing:3px;margin:12px}.hint{font-size:10px;color:#C2B9CE;line-height:1.5}.deadline{border:1px solid ${theme.accent};border-radius:8px;padding:10px;margin-top:14px;font-size:12px}
  </style></head><body><article class="ticket"><div class="art"><div class="brand">ECLIPSE</div><div class="orbit"><div class="moon"></div></div><div class="type">${escape(product.kind === 'vip_table' ? 'MESA VIP' : product.name.toUpperCase())}</div></div><div class="body"><h1>${escape(event.title || 'Tu próxima noche')}</h1><div class="fields">${field('Tu acceso', product.name)}${field('Personas', people)}${field('Fecha / hora', `${walletDate(date)} · ${walletDate(date, true)}`)}${field('Local', event.venues?.name || 'Por confirmar')}${field('Titular', ticket.buyer_name || 'Titular de la entrada')}${field('Zona', product.metadata.accessZone)}</div>${inclusions ? `<div class="included"><small>Incluido en tu acceso</small>${escape(inclusions)}</div>` : ''}${ticket.entry_deadline ? `<div class="deadline">Acceso antes de ${escape(walletDate(new Date(ticket.entry_deadline)))} · ${escape(walletDate(new Date(ticket.entry_deadline), true))}</div>` : ''}</div><div class="qr">${svg}<div class="code">${escape(ticket.short_code || ticket.id.slice(0, 8).toUpperCase())}</div><div class="hint">Presenta este QR en el acceso. ${people > 1 ? 'Acceso conjunto para las personas incluidas. ' : ''}No compartas tu entrada.</div></div></article></body></html>`;
}
