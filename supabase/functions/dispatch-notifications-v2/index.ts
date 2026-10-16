import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { authorizedNotificationWorker } from '../_shared/notificationDelivery.ts';
import { runNotificationDispatchWithHealth } from '../_shared/notificationWorkerHealth.ts';

Deno.serve(async (req) => {
  const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const respond=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  const url=Deno.env.get('SUPABASE_URL');
  if (!url || !secret) return respond(503,{ok:false,code:'NOT_CONFIGURED'});
  const authorization=req.headers.get('Authorization');
  if (!authorizedNotificationWorker(authorization,secret)) {
    // Legacy service JWTs can be reissued with different bytes. Supabase must
    // validate the caller and its service-only RPC grant; decoded claims alone
    // never authorize dispatch. Keep gateway verify_jwt enabled as well.
    const anon=Deno.env.get('SUPABASE_ANON_KEY');
    if (!anon || !authorization?.startsWith('Bearer ') || authorization.length>8192) return respond(401,{ok:false,code:'UNAUTHORIZED'});
    try {
      const caller=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:authorization}}});
      const probe=await caller.rpc('notification_receipts_v2',{p_limit:1});
      if (probe.error || !Array.isArray(probe.data)) return respond(401,{ok:false,code:'UNAUTHORIZED'});
    } catch { return respond(401,{ok:false,code:'UNAUTHORIZED'}); }
  }
  if (req.method!=='POST') return respond(405,{ok:false,code:'METHOD_NOT_ALLOWED'});
  const client=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  try {
    const result=await runNotificationDispatchWithHealth((name,args)=>client.rpc(name,args),name=>Deno.env.get(name));
    console.info('[NOTIFICATIONS_V2]',{processed:result.processed,receipts:result.receipts,dispatch:result.dispatch});
    return respond(200,{ok:true,...result});
  } catch {
    console.error('[NOTIFICATIONS_V2] WORKER_FAILED');
    return respond(503,{ok:false,code:'NOTIFICATION_WORKER_FAILED'});
  }
});
