/** Transactional v2 delivery. Dependencies are injectable; never log recipients, payloads or provider bodies. */
export type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: unknown }>;
export type Environment = (name: string) => string | undefined;
export type Delivery = {
  id: string; notification_id: string; channel: 'push' | 'email'; to: string; project_id?: string;
  title: string; body: string; category: string; priority: string; expires_at: string; attempts: number;
};
type Outcome = { outcome: 'accepted' | 'retry' | 'failed' | 'unknown' | 'unregistered'; code: string; providerId?: string };
const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';
const RESEND_SEND = 'https://api.resend.com/emails';
const KNOWN_PUSH_ERRORS = new Set(['DeviceNotRegistered','MessageTooBig','MessageRateExceeded','MismatchSenderId','InvalidCredentials']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authorizedNotificationWorker(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  let difference = 0;
  for (let i=0;i<expected.length;i++) difference |= header.charCodeAt(i)^expected.charCodeAt(i);
  return difference===0;
}
export function escapeNotificationHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
export function notificationEmail(d: Pick<Delivery,'title'|'body'>): string {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f5f3f8;font-family:Arial,sans-serif;color:#201a2f"><main style="max-width:560px;margin:32px auto;padding:32px;background:white;border-radius:16px"><p style="font-size:13px;letter-spacing:3px;color:#6846ab">ECLIPSE</p><h1 style="font-size:25px;line-height:1.3">${escapeNotificationHtml(d.title)}</h1><p style="font-size:16px;line-height:1.6;white-space:pre-line">${escapeNotificationHtml(d.body)}</p><p style="margin-top:28px;font-size:14px">Abre Eclipse para consultar los detalles en tu centro de notificaciones.</p><hr style="border:0;border-top:1px solid #ebe7f0"><p style="font-size:12px;color:#6f677d">Aviso sobre tu actividad en Eclipse. Gestiona tus preferencias desde la aplicación. Nunca compartas el QR de tu entrada.</p></main></body></html>`;
}
function pushPreview(value: string, limit: number): string {
  const text = value.replace(/\s+/gu, ' ').trim();
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  const prefix = characters.slice(0, limit - 1).join('');
  const lastSpace = prefix.lastIndexOf(' ');
  return (lastSpace > prefix.length / 2 ? prefix.slice(0, lastSpace) : prefix).trimEnd() + '…';
}
export function notificationPush(d: Delivery, projectRef: string, now=Date.now()) {
  // Show a short preview of the authorized inbox copy. Keep navigation data limited to IDs.
  return { to: d.to, title:pushPreview(d.title,80)||'Eclipse',
    body:pushPreview(d.body,160)||pushPreview(d.title,160)||'Abre Eclipse para consultar este aviso.',
    data:{notification_schema:2,notification_id:d.notification_id,project_ref:projectRef},
    channelId:d.category==='reminder'?'eclipse-reminders':'eclipse-activity',
    priority:d.priority==='high'?'high':'normal', sound:'default',
    ttl:Math.max(1,Math.min(86400,Math.floor((Date.parse(d.expires_at)-now)/1000))),
    collapseId:d.notification_id };
}
function validDelivery(d: Delivery): boolean {
  return !!d && UUID.test(d.id) && UUID.test(d.notification_id) && ['push','email'].includes(d.channel)
   && typeof d.to==='string' && typeof d.title==='string' && typeof d.body==='string'
   && d.title.length<=160 && d.body.length<=2000 && Number.isFinite(Date.parse(d.expires_at));
}
function expoHeaders(env: Environment) {
  const access = env('EXPO_ACCESS_TOKEN');
  return {'Content-Type':'application/json', ...(access ? {Authorization:`Bearer ${access}`} : {})};
}
async function sendOne(d: Delivery, env: Environment, send: typeof fetch): Promise<Outcome> {
  if (!validDelivery(d)) return {outcome:'failed',code:'INVALID_JOB'};
  if (Date.parse(d.expires_at)<=Date.now()) return {outcome:'failed',code:'EXPIRED'};
  let url: string; let headers: Record<string,string>; let body: unknown;
  if (d.channel==='push') {
    if (!/^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]{10,200}\]$/.test(d.to)) return {outcome:'failed',code:'INVALID_TOKEN'};
    if (d.project_id!==env('NOTIFICATIONS_EXPO_PROJECT_ID')) return {outcome:'failed',code:'EXPO_PROJECT_MISMATCH'};
    const projectRef = new URL(env('SUPABASE_URL')!).hostname.split('.')[0];
    url=EXPO_SEND; headers=expoHeaders(env); body=notificationPush(d,projectRef);
  } else {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.to)) return {outcome:'failed',code:'INVALID_EMAIL'};
    const apiKey=env('RESEND_API_KEY'), from=env('NOTIFICATIONS_FROM_EMAIL');
    if (!apiKey || !from || /[\r\n]/.test(from)) return {outcome:'retry',code:'EMAIL_NOT_CONFIGURED'};
    url=RESEND_SEND; headers={'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`,'Idempotency-Key':`eclipse-notification/${d.id}`};
    body={from,to:[d.to],subject:d.title.replace(/[\r\n]/g,' '),text:`${d.body}\n\nAbre Eclipse para consultar los detalles.`,html:notificationEmail(d)};
  }
  let response: Response;
  try { response=await send(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(7000),redirect:'error'}); }
  catch { return d.channel==='email'?{outcome:'retry',code:'NETWORK_ERROR'}:{outcome:'unknown',code:'AMBIGUOUS_PUSH_RESULT'}; }
  const data=await response.json().catch(()=>null);
  if (!response.ok) {
    if (response.status===429 || response.status>=500) return {outcome:'retry',code:`PROVIDER_HTTP_${response.status}`};
    return {outcome:'failed',code:`PROVIDER_HTTP_${response.status}`};
  }
  if (d.channel==='email') return typeof data?.id==='string' ? {outcome:'accepted',code:'RESEND_ACCEPTED',providerId:data.id} : {outcome:'unknown',code:'MISSING_PROVIDER_ID'};
  const ticket=Array.isArray(data?.data)?data.data[0]:data?.data;
  if (ticket?.status==='ok' && typeof ticket.id==='string') return {outcome:'accepted',code:'EXPO_ACCEPTED',providerId:ticket.id};
  const code=KNOWN_PUSH_ERRORS.has(ticket?.details?.error)?ticket.details.error:'EXPO_REJECTED';
  return {outcome:code==='DeviceNotRegistered'?'unregistered':code==='MessageRateExceeded'?'retry':'failed',code};
}
async function mustRpc(rpc: Rpc, name:string,args:Record<string,unknown>={}) {
  const result=await rpc(name,args);
  if (result.error) throw new Error(`NOTIFICATION_RPC_FAILED:${name}`);
  return result.data;
}
export async function reconcileNotificationReceipts(rpc: Rpc, env:Environment, send:typeof fetch) {
  const rows=await mustRpc(rpc,'notification_receipts_v2',{p_limit:100});
  if (!Array.isArray(rows) || rows.length===0) return 0;
  let response:Response;
  try {response=await send(EXPO_RECEIPTS,{method:'POST',headers:expoHeaders(env),body:JSON.stringify({ids:rows.map(r=>r.provider_id)}),signal:AbortSignal.timeout(7000),redirect:'error'});}
  catch { return 0; }
  if (!response.ok) return 0;
  const parsed=await response.json().catch(()=>null); let count=0;
  if (!parsed?.data || typeof parsed.data!=='object') return 0;
  for (const row of rows) {
    const receipt=parsed.data[row.provider_id];
    const rawCode=receipt?.details?.error;
    const outcome=!receipt?'missing':receipt.status==='ok'?'confirmed':rawCode==='DeviceNotRegistered'?'unregistered':'failed';
    const code=!receipt?'RECEIPT_PENDING':receipt.status==='ok'?'PROVIDER_CONFIRMED':KNOWN_PUSH_ERRORS.has(rawCode)?rawCode:'RECEIPT_REJECTED';
    await mustRpc(rpc,'complete_notification_receipt_v2',{p_id:row.id,p_provider_id:row.provider_id,p_outcome:outcome,p_code:code}); count++;
  }
  return count;
}
export async function runNotificationDispatch(rpc:Rpc, env:Environment, send:typeof fetch=fetch) {
  const prepared=await mustRpc(rpc,'prepare_notifications_v2',{p_limit:100});
  // Independent deployment safety gate; absence never enables remote deliveries.
  if (env('NOTIFICATIONS_V2_SEND_ENABLED')!=='true') return {prepared,dispatch:'disabled',processed:0,receipts:0};
  const channels: string[]=[];
  if (UUID.test(env('NOTIFICATIONS_EXPO_PROJECT_ID')??'')) channels.push('push');
  if (env('RESEND_API_KEY') && env('NOTIFICATIONS_FROM_EMAIL') && !/[\r\n]/.test(env('NOTIFICATIONS_FROM_EMAIL')!)) channels.push('email');
  // Missing provider configuration must not consume attempts or exhaust queued work.
  const refs=await mustRpc(rpc,'claim_notification_deliveries_v2',{p_limit:10,p_channels:channels}); let processed=0;
  for (let start=0;start<(refs?.length??0);start+=2) {
    await Promise.all(refs.slice(start,start+2).map(async (ref: {id:string;lease_token:string})=>{
      const delivery=await mustRpc(rpc,'authorize_notification_delivery_v2',{p_id:ref.id,p_lease:ref.lease_token});
      if (!delivery) return;
      const result=await sendOne(delivery,env,send);
      const recorded=await mustRpc(rpc,'complete_notification_delivery_v2',{p_id:ref.id,p_lease:ref.lease_token,p_outcome:result.outcome,p_code:result.code,p_provider_id:result.providerId??null});
      if (recorded) processed++;
    }));
  }
  const receipts=await reconcileNotificationReceipts(rpc,env,send);
  return {prepared,dispatch:'processed',processed,receipts};
}
