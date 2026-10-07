/** Isolated transport: no provider response, token, email address or body is logged. */
export type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
export type DeliveryConfig = { projectRef: string; resendKey?: string; fromEmail?: string; expoAccessToken?: string };
export type Delivery = {
  id: string; lease: string; notification_id: string; channel: 'push' | 'email'; recipient: string;
  title: string; body: string; type: string; family: string; attempt: number; expires_at: string;
};
const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';
const RESEND = 'https://api.resend.com/emails';
const knownCodes = new Set(['DeviceNotRegistered','MessageTooBig','MessageRateExceeded','MismatchSenderId','InvalidCredentials','UNAUTHORIZED','TOO_MANY_REQUESTS']);
function codeOf(value: unknown) { return typeof value === 'string' && knownCodes.has(value) ? value : 'provider_rejected'; }
export function escapeNotificationHtml(value: string) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
}
export function notificationEmail(title: string, body: string) {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body style="margin:0;background:#111020;color:#ffffff;font-family:Arial,sans-serif">'
    + '<main style="max-width:560px;margin:32px auto;padding:28px"><p style="letter-spacing:4px;color:#CCBAF4">ECLIPSE</p>'
    + '<h1 style="font-size:24px;line-height:1.3">'+escapeNotificationHtml(title)+'</h1><p style="font-size:16px;line-height:1.6">'
    + escapeNotificationHtml(body)+'</p><p>Abre Eclipse y consulta tu centro de notificaciones.</p>'
    + '<hr><p style="font-size:12px;color:#d6d2e0">Aviso sobre tu actividad en Eclipse. Puedes gestionar los canales en Preferencias de notificaciones. Nunca te pediremos claves por correo.</p></main></body></html>';
}
async function rpcData(rpc: Rpc, name: string, args: Record<string, unknown>) {
  const result = await rpc(name, args);
  if (result.error) throw new Error('notification_database_error');
  return result.data;
}
export function createNotificationTransport(config: DeliveryConfig, rpc: Rpc, send: typeof fetch = fetch) {
  const finish = (job: Delivery, state: string, code: string | null, providerId: string | null = null) =>
    rpcData(rpc, 'finish_core_notification_delivery', {p_id:job.id,p_lease:job.lease,p_state:state,p_code:code,p_provider_id:providerId});
  const expoHeaders = () => ({'Content-Type':'application/json', ...(config.expoAccessToken ? {Authorization:`Bearer ${config.expoAccessToken}`} : {})});
  async function deliver(job: Delivery) {
    if (!Number.isFinite(Date.parse(job.expires_at)) || Date.parse(job.expires_at)<=Date.now()) return finish(job,'skipped','expired');
    if (job.channel==='email' && (!config.resendKey || !config.fromEmail)) return finish(job,'failed','email_not_configured');
    const isPush=job.channel==='push';
    // Lock-screen copy is intentionally generic. The app loads the authoritative, owner-scoped detail.
    const pushBody = {to:job.recipient,title:'Eclipse',body:job.family==='important' ? 'Hay un cambio importante en tu evento. Abre Eclipse para revisarlo.' : 'Tienes una actualización en Eclipse.',
      data:{notification_id:job.notification_id,notification_version:2},priority:job.family==='important'?'high':'normal',
      ttl:Math.max(1,Math.min(3600,Math.floor((Date.parse(job.expires_at)-Date.now())/1000))),
      collapseId:job.id,tag:job.id,sound:'default',channelId:'eclipse-activity'};
    const emailBody = {from:config.fromEmail,to:[job.recipient],subject:job.title,
      text:job.body+'\n\nAbre Eclipse para consultar el detalle.',html:notificationEmail(job.title,job.body)};
    let response: Response;
    try {
      response=await send(isPush?EXPO_SEND:RESEND,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
        headers:isPush?expoHeaders():{'Content-Type':'application/json',Authorization:`Bearer ${config.resendKey}`,'Idempotency-Key':`notification/${job.id}`},
        body:JSON.stringify(isPush?pushBody:emailBody)});
    } catch {
      // Expo has no idempotency key. A timeout may have been accepted: do not blindly resend.
      return finish(job,isPush?'uncertain':'pending','network_outcome_unknown');
    }
    let data: any;
    try { data=await response.json(); } catch { return finish(job,isPush?'uncertain':'pending','invalid_provider_response'); }
    if (!response.ok) {
      const retry=response.status===429 || (!isPush && response.status>=500);
      const state=retry?'pending':isPush && response.status>=500?'uncertain':'failed';
      return finish(job,state,response.status===429?'rate_limited':response.status===401||response.status===403?'provider_credentials':response.status===409?'idempotency_conflict':'provider_rejected');
    }
    if (!isPush) return typeof data?.id==='string' && data.id ? finish(job,'accepted',null,data.id):finish(job,'pending','invalid_provider_response');
    const ticket=Array.isArray(data?.data)?data.data[0]:data?.data;
    if (ticket?.status==='ok' && typeof ticket.id==='string' && ticket.id) return finish(job,'accepted',null,ticket.id);
    if (ticket?.status==='error') {
      const code=codeOf(ticket.details?.error);
      return finish(job,code==='MessageRateExceeded'?'pending':'failed',code);
    }
    return finish(job,'uncertain','invalid_provider_response');
  }
  async function receipts() {
    const pending=await rpcData(rpc,'list_core_notification_receipts',{p_project_ref:config.projectRef});
    if (!Array.isArray(pending) || !pending.length) return 0;
    let response: Response;
    try { response=await send(EXPO_RECEIPTS,{method:'POST',headers:expoHeaders(),redirect:'error',signal:AbortSignal.timeout(10000),body:JSON.stringify({ids:pending.map(row=>row.provider_id)})}); }
    catch { return 0; }
    if (!response.ok) return 0;
    const payload=await response.json().catch(()=>null); let count=0;
    for (const row of pending) {
      const receipt=payload?.data?.[row.provider_id];
      if (receipt?.status!=='ok' && receipt?.status!=='error') continue;
      await rpcData(rpc,'finish_core_notification_receipt',{p_id:row.id,p_provider_id:row.provider_id,p_ok:receipt.status==='ok',p_code:receipt.status==='ok'?null:codeOf(receipt.details?.error)});
      count++;
    }
    return count;
  }
  async function run() {
    const receiptCount=await receipts();
    const jobs=await rpcData(rpc,'claim_core_notification_deliveries',{p_project_ref:config.projectRef,p_limit:10});
    let processed=0,failed=0,skipped=0;
    // Two concurrent requests, bounded batch: no unbounded burst or cross-project batch.
    for(let i=0;i<(jobs?.length||0);i+=2) await Promise.all(jobs.slice(i,i+2).map(async (claim:any)=>{
      try {
        const job=await rpcData(rpc,'prepare_core_notification_delivery',{p_id:claim.id,p_lease:claim.lease_token,p_project_ref:config.projectRef});
        if (!job) { skipped++; return; }
        await deliver(job); processed++;
      } catch { failed++; /* A lease reaper resolves interrupted work without logging payloads. */ }
    }));
    return {processed,skipped,failed,receipts:receiptCount};
  }
  return {run,deliver,receipts};
}
