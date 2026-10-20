import {ensure} from '../src/domain/model.ts';
export type PaymentMode='simulated'|'stripe_test'|'stripe_live';
export type ReleaseMode='local'|'beta'|'production';
export function runtimeConfig(env:Record<string,string|undefined>=process.env){
 const release=env.RELEASE_MODE||'local',paymentMode=env.PAYMENT_MODE||'simulated',authMode=env.AUTH_MODE||'local';
 ensure(['local','beta','production'].includes(release),'CONFIG','RELEASE_MODE no válido.');
 ensure(['simulated','stripe_test','stripe_live'].includes(paymentMode),'CONFIG','Modo de pago no válido.');
 ensure(['local','supabase'].includes(authMode),'CONFIG','Modo de autenticación no válido.');
 const origin=env.APP_ORIGIN||'http://127.0.0.1:4173';
 let url:URL;try{url=new URL(origin);}catch{throw new Error('APP_ORIGIN no válido.');}
 ensure(url.origin===origin&&!url.username&&!url.password,'CONFIG','APP_ORIGIN debe ser un origen sin rutas ni credenciales.');
 const host=env.HOST||(release==='local'?'127.0.0.1':'0.0.0.0');
 const port=Number(env.PORT||4173);
 ensure(Number.isInteger(port)&&port>0&&port<65536,'CONFIG','Puerto no válido.');
 if(release==='local')ensure(['127.0.0.1','localhost','::1'].includes(host),'HOST','La versión local solo escucha en el equipo local.');
 else{
  ensure(url.protocol==='https:'&&!['localhost','127.0.0.1','::1'].includes(url.hostname),'CONFIG','La publicación requiere HTTPS.');
  ensure(env.DATABASE_URL&&env.REMOTE_PROJECT_REF==='zurbdrfmwjqbrscairub','CONFIG','Se requiere la base AppFest autorizada.');
  ensure(env.DEMO_ACCESS!=='true','CONFIG','Las cuentas demo no pueden acceder a una publicación.');
  ensure(['none','railway'].includes(env.TRUST_PROXY||'none'),'CONFIG','Proxy no válido.');
 }
 if(release==='production'){
  ensure(authMode==='supabase','CONFIG','Producción requiere correo verificado mediante Supabase.');
  for(const key of ['PUBLIC_LEGAL_URL','PUBLIC_SUPPORT_URL'])ensure(env[key]?.startsWith('https://'),'CONFIG',`Falta ${key}.`);
  ensure(env.AUTH_EMAIL_READY==='verified','CONFIG','Verifica confirmación, recuperación y entrega de correo antes de producción.');
  ensure(paymentMode!=='simulated','CONFIG','Producción no admite pagos simulados.');
 }
 if(paymentMode==='stripe_live'){
  ensure(release==='production','CONFIG','Los pagos reales requieren modo producción.');
  ensure(env.ENABLE_LIVE_PAYMENTS==='approved'&&env.CONNECT_LIABILITY_ACCEPTED==='approved','CONFIG','Falta activar expresamente pagos y responsabilidades de Connect.');
  ensure(/^rk_live_/.test(env.STRIPE_RESTRICTED_KEY||'')&&env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'),'CONFIG','Faltan credenciales restringidas y webhook de producción.');
 }
 if(paymentMode==='stripe_test')ensure(/^rk_test_/.test(env.STRIPE_RESTRICTED_KEY||'')&&env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'),'CONFIG','Faltan credenciales y webhook del entorno de pruebas.');
 return {release:release as ReleaseMode,origin,host,port,paymentMode:paymentMode as PaymentMode,authMode,proxy:env.TRUST_PROXY==='railway'?'railway' as const:'none' as const};
}
