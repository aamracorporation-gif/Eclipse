/** Google Wallet REST transport. Never log tokens, keys, provider bodies or Save URLs. */
export class GoogleWalletError extends Error {
  constructor(public code: string, message: string, public upstreamStatus = 0) { super(message); }
}
const API = 'https://walletobjects.googleapis.com/walletobjects/v1/';
type Sender = typeof fetch;
type Stage = 'oauth' | 'class' | 'object';
const presentationKeys = ['hexBackgroundColor', 'cardTitle', 'header', 'subheader', 'textModulesData', 'logo', 'heroImage'] as const;

export function validateGoogleWalletIds(issuer: string, classId: string) {
  if (!/^\d{1,30}$/.test(issuer) || !classId.startsWith(issuer + '.') || !/^\d{1,30}\.[A-Za-z0-9._-]{1,100}$/.test(classId)) {
    throw new GoogleWalletError('WALLET_CONFIG_IDS', 'Google Wallet: el ID de la clase debe incluir el mismo ID de emisor configurado.');
  }
}

export function walletTicketUnavailable(ticket: any, now = Date.now()): string | null {
  if (!['valid', 'active'].includes(ticket.status) || ticket.ticket_status !== 'active' || ticket.validation_status !== 'valid' || ticket.scanned_at || ticket.payment_status !== 'paid') {
    return 'Esta entrada no está vigente o su pago no está confirmado.';
  }
  const event = ticket.events;
  if (!event || event.is_cancelled || ['cancelled', 'deleted'].includes(event.status)) return 'El evento no está disponible.';
  const end = event.end_datetime ? Date.parse(event.end_datetime) : Date.parse(event.event_date) + 5 * 3600000;
  if (!Number.isFinite(end) || end <= now) return 'El evento ya ha finalizado o su horario no es válido.';
  if (ticket.entry_deadline && (!Number.isFinite(Date.parse(ticket.entry_deadline)) || Date.parse(ticket.entry_deadline) <= now)) return 'La hora límite de acceso de esta entrada ya ha pasado.';
  if (!String(ticket.qr_token || ticket.qr_code || '').trim()) return 'La entrada todavía no tiene un código de acceso válido.';
  return null;
}

async function request(url: string, options: RequestInit, stage: Stage, send: Sender, allowed: number[] = []) {
  let response: Response;
  try { response = await send(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(7000) }); }
  catch { throw new GoogleWalletError('WALLET_GOOGLE_UNAVAILABLE', 'No se ha podido conectar con Google Wallet. Vuelve a intentarlo.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok && !allowed.includes(response.status)) {
    const details = Array.isArray(data?.error?.details) ? data.error.details : [];
    if (details.some((item: any) => item?.reason === 'SERVICE_DISABLED')) throw new GoogleWalletError('WALLET_API_DISABLED', 'La API de Google Wallet no está habilitada en el proyecto de la cuenta de servicio.', response.status);
    if (stage === 'oauth') throw new GoogleWalletError('WALLET_GOOGLE_CREDENTIALS', 'Google no ha aceptado las credenciales del emisor. Comprueba que la clave corresponda a la cuenta de servicio configurada.', response.status);
    if (response.status === 401 || response.status === 403) throw new GoogleWalletError('WALLET_GOOGLE_PERMISSION', 'Google no permite a la cuenta de servicio gestionar este emisor o esta clase de pases.', response.status);
    if (stage === 'class' && response.status === 404) throw new GoogleWalletError('WALLET_CLASS_NOT_FOUND', 'Google Wallet no encuentra la clase configurada. Revisa el ID completo de la clase.', response.status);
    if (response.status === 400) throw new GoogleWalletError('WALLET_GOOGLE_PAYLOAD', 'Google Wallet ha rechazado los datos del pase. Contacta con soporte de Eclipse.', response.status);
    throw new GoogleWalletError('WALLET_GOOGLE_UNAVAILABLE', 'Google Wallet no ha podido preparar el pase. Vuelve a intentarlo.', response.status);
  }
  return { response, data };
}

export async function exchangeGoogleWalletToken(assertion: string, send: Sender = fetch): Promise<string> {
  const { data } = await request('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  }, 'oauth', send);
  if (typeof data?.access_token !== 'string' || !data.access_token) throw new GoogleWalletError('WALLET_GOOGLE_CREDENTIALS', 'Google no ha autorizado la firma del pase.');
  return data.access_token;
}

/** Called only after authenticating the ticket owner and checking current ticket validity. */
export async function persistGoogleWalletObject(token: string, object: Record<string, any>, send: Sender = fetch): Promise<void> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const classUrl = API + 'genericClass/' + encodeURIComponent(object.classId);
  const { data: passClass } = await request(classUrl, { method: 'GET', headers }, 'class', send);
  if (passClass?.id !== object.classId) throw new GoogleWalletError('WALLET_CLASS_INVALID', 'Google Wallet no ha confirmado la clase del pase.');
  // Do not alter the shared class: staging may share its issuer with production.
  const objectUrl = API + 'genericObject/' + encodeURIComponent(object.id);
  let existing = await request(objectUrl, { method: 'GET', headers }, 'object', send, [404]);
  if (existing.response.status === 404) {
    const created = await request(API + 'genericObject', { method: 'POST', headers, body: JSON.stringify(object) }, 'object', send, [409]);
    if (created.response.status !== 409) {
      if (created.data?.id !== object.id || created.data?.classId !== object.classId) throw new GoogleWalletError('WALLET_OBJECT_INVALID', 'Google Wallet no ha confirmado la creación del pase.');
      return;
    }
    // Another request may have created the same deterministic ID. Never duplicate it.
    existing = await request(objectUrl, { method: 'GET', headers }, 'object', send);
  }
  if (existing.data?.id !== object.id || existing.data?.classId !== object.classId || existing.data?.barcode?.value !== object.barcode?.value) {
    throw new GoogleWalletError('WALLET_OBJECT_CONFLICT', 'El pase existente no coincide con esta entrada. Contacta con soporte de Eclipse.');
  }
  if (String(existing.data?.state || '').toUpperCase() !== 'ACTIVE') throw new GoogleWalletError('WALLET_OBJECT_INACTIVE', 'Este pase ya no está activo en Google Wallet.');
  const patch = Object.fromEntries(presentationKeys.filter(key => object[key] !== undefined).map(key => [key, object[key]]));
  const updated = await request(objectUrl, { method: 'PATCH', headers, body: JSON.stringify(patch) }, 'object', send);
  if (updated.data?.id !== object.id) throw new GoogleWalletError('WALLET_OBJECT_INVALID', 'Google Wallet no ha confirmado la actualización del pase.');
}

export function googleWalletSaveClaims(objectId: string, nowSeconds: number) {
  return { typ: 'savetowallet', iat: nowSeconds, origins: [], payload: { genericObjects: [{ id: objectId }] } };
}
