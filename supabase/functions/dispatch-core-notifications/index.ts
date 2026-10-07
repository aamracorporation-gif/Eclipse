import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { createNotificationTransport } from '../_shared/notificationDelivery.ts';

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async (request:Request)=>{
  const url=Deno.env.get('SUPABASE_URL') || '';
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  // JWT gateway remains enabled; never accept a regular user or trust a role from the request body.
  if (!service || request.headers.get('Authorization')!==`Bearer ${service}`) return json({error:'Forbidden'},403);
  if (request.method!=='POST') return json({error:'Method not allowed'},405);
  try {
    const client=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const transport=createNotificationTransport({projectRef:new URL(url).hostname.split('.')[0],
      resendKey:Deno.env.get('RESEND_API_KEY'),fromEmail:Deno.env.get('NOTIFICATIONS_FROM_EMAIL'),expoAccessToken:Deno.env.get('EXPO_ACCESS_TOKEN')},
      async (name,args)=>await client.rpc(name,args));
    return json({ok:true,...await transport.run()});
  } catch { console.error('[NOTIFICATIONS_CORE] Worker failed'); return json({ok:false,error:'notification_worker_failed'},503); }
});
