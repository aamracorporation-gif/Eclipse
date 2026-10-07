import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { authorizedNotificationWorker, runNotificationDispatch } from '../_shared/notificationDelivery.ts';

Deno.serve(async (req) => {
  const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const respond=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if (!authorizedNotificationWorker(req.headers.get('Authorization'),secret)) return respond(401,{ok:false,code:'UNAUTHORIZED'});
  if (req.method!=='POST') return respond(405,{ok:false,code:'METHOD_NOT_ALLOWED'});
  const url=Deno.env.get('SUPABASE_URL');
  if (!url || !secret) return respond(503,{ok:false,code:'NOT_CONFIGURED'});
  const client=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  try {
    const result=await runNotificationDispatch((name,args)=>client.rpc(name,args),name=>Deno.env.get(name));
    console.info('[NOTIFICATIONS_V2]',{processed:result.processed,receipts:result.receipts,dispatch:result.dispatch});
    return respond(200,{ok:true,...result});
  } catch {
    console.error('[NOTIFICATIONS_V2] WORKER_FAILED');
    return respond(503,{ok:false,code:'NOTIFICATION_WORKER_FAILED'});
  }
});
