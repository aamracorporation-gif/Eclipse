const fs=require('node:fs');
const c=JSON.parse(fs.readFileSync('../.private/box-office-qa.json','utf8'));
async function json(url,opts={}){const r=await fetch(url,opts),d=await r.json();if(!r.ok)throw Error('HTTP '+r.status+' '+JSON.stringify(d));return d;}
(async()=>{
 const session=await json(c.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:c.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email:c.email,password:c.password})});
 if(session.user.id!==c.id)throw Error('Wrong QA user');
 fs.writeFileSync('../.private/box-office-qa-session.json',JSON.stringify(session));
 const headers={apikey:c.anonKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'};
 const call=body=>json(c.url+'/functions/v1/box-office-billing',{method:'POST',headers,body:JSON.stringify(body)});
 await call({action:'refresh'});
 const results=await Promise.all([call({action:'checkout'}),call({action:'checkout'})]);
 if(results[0].url!==results[1].url||!results[0].url?.startsWith('https://checkout.stripe.com/'))throw Error('Duplicate or missing checkout');
 fs.writeFileSync('../.private/box-office-checkout.json',JSON.stringify(results[0]));
 const access=await json(c.url+'/rest/v1/rpc/get_box_office_access',{method:'POST',headers,body:JSON.stringify({p_organizer_id:c.id})});
 if(access.enabled)throw Error('Unpaid checkout activated premium');
 const forge=await fetch(c.url+'/rest/v1/organizer_box_office_subscriptions?organizer_id=eq.'+c.id,{method:'PATCH',headers,body:JSON.stringify({status:'active',paid_through:'2030-01-01T00:00:00Z'})});
 if(forge.ok)throw Error('Client can forge subscription');
 console.log('PASS: authenticated checkout, concurrent requests reuse one session, unpaid access denied, client cannot forge entitlement.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
