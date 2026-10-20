import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import type { Database, DB } from './db.ts';
import { one } from './db.ts';
import { ensure } from '../src/domain/model.ts';
import type { Actor, Row } from '../src/domain/model.ts';
import type {PaymentMode} from './config.ts';
import { secret } from './security.ts';
export type PaymentClient = Pick<Stripe, 'checkout' | 'refunds' | 'accounts' | 'webhooks' | 'charges'>;
export class Payments {
  db: Database;
  client: PaymentClient | null;
  origin: string;
  feeBps: number;
  webhookSecret: string;
  mode:PaymentMode;
  constructor(db: Database, options: { client?: PaymentClient; key?: string; origin: string; feeBps?: number; webhookSecret?: string;mode?:PaymentMode;liveEnabled?:boolean }) {
    this.mode=options.mode||'stripe_test';
    if(this.mode==='stripe_live')ensure(options.liveEnabled===true,'LIVE_DISABLED','Los pagos reales requieren activación explícita.');
    this.db = db; this.origin = options.origin; this.feeBps = options.feeBps ?? 500; this.webhookSecret = options.webhookSecret ?? '';
    ensure(Number.isInteger(this.feeBps) && this.feeBps >= 0 && this.feeBps <= 3000,'CONFIG','Comisión no válida.');
    if(options.key)ensure((this.mode==='stripe_live'?/^rk_live_/:/^rk_test_/).test(options.key),'LIVE_DISABLED','Usa una clave restringida del modo correcto: pruebas o real.');
    this.client = options.client ?? (options.key ? new Stripe(options.key, { maxNetworkRetries: 2, timeout: 15000 }) : null);
  }
  async checkout(actor: Actor, regId: string) {
    ensure(this.client, 'PAYMENTS_DISABLED', 'Stripe no está configurado.', 503);
    const r = await one(this.db, `SELECT r.*,c.title,c.status AS comp_status,o.stripe_account,o.verified
      FROM rondiqo.registrations r JOIN rondiqo.competitions c ON c.id=r.competition_id JOIN rondiqo.organizations o ON o.id=c.org_id WHERE r.id=$1`, [regId]);
    ensure(r && r.user_id === actor.id, 'FORBIDDEN', 'Inscripción no disponible.', 403);
    ensure(r.status === 'pending' && r.provider === this.mode && r.comp_status === 'open','STATE','La inscripción no admite cobro.',409);
    ensure(r.verified && r.stripe_account,'ORGANIZER','El organizador debe estar verificado y conectado a Stripe.',409);
    ensure(!r.expires_at||new Date(r.expires_at).getTime()>Date.now(),'EXPIRED','La reserva ha caducado.',409);
    if (r.checkout_id) {
      const existing = await this.client.checkout.sessions.retrieve(r.checkout_id);
      ensure(existing.status === 'open','STATE','La sesión de pago ya no está abierta.',409);
      return { url:existing.url };
    }
    const account = await this.client.accounts.retrieve(r.stripe_account);
    ensure(account.charges_enabled && account.payouts_enabled,'KYC','La cuenta del organizador todavía no puede cobrar.',409);
    const fee = Math.round(r.amount_cents * this.feeBps / 10000);
    const expiresAt=Math.floor(new Date(r.expires_at).getTime()/1000);
    ensure(expiresAt>=Math.floor(Date.now()/1000)+30*60,'EXPIRED','La ventana de pago ha caducado. Cancela la reserva y vuelve a inscribirte.',409);
    // Existing destination-charge model; live mode requires explicit responsibility acceptance.
    const session = await this.client.checkout.sessions.create({
      mode:'payment',payment_method_types:['card'],client_reference_id:r.id,
      line_items:[{price_data:{currency:'eur',unit_amount:r.amount_cents,product_data:{name:r.title}},quantity:1}],
      metadata:{registration_id:r.id,app:'rondiqo'},
      payment_intent_data:{application_fee_amount:fee,transfer_data:{destination:r.stripe_account},metadata:{registration_id:r.id,app:'rondiqo'}},
      success_url:`${this.origin}/tickets?payment=return`,cancel_url:`${this.origin}/tickets?payment=cancel`,
      expires_at:expiresAt,
      integration_identifier:'rondiqo_checkout_zqkrtvnm',
    } as Stripe.Checkout.SessionCreateParams, { idempotencyKey:`rondiqo-checkout-${r.id}` });
    // Cancellation can race the network request; retain the session so reconciliation can refund a late payment.
    await this.db.transaction(async db=>{
      await db.query('UPDATE rondiqo.registrations SET checkout_id=$1 WHERE id=$2 AND (checkout_id IS NULL OR checkout_id=$1)',[session.id,r.id]);
    });
    const current = await one(this.db,'SELECT status FROM rondiqo.registrations WHERE id=$1',[r.id]);
    if(current?.status!=='pending') {
      try { await this.client.checkout.sessions.expire(session.id); } catch { /* webhook/reconciliation owns late completion */ }
      ensure(false,'STATE','La inscripción fue cancelada durante el pago.',409);
    }
    return {url:session.url};
  }
  verify(raw:Buffer,signature:string) {
    ensure(this.client && this.webhookSecret,'PAYMENTS_DISABLED','Webhook no configurado.',503);
    return this.client.webhooks.constructEvent(raw,signature,this.webhookSecret,300);
  }
  async linkAccount(actor:Actor,orgId:string,accountId:string){
    const admin=await one(this.db,'SELECT role,suspended FROM rondiqo.profiles WHERE id=$1',[actor.id]);
    ensure(admin?.role==='admin'&&!admin.suspended,'FORBIDDEN','Solo administración puede vincular cuentas.',403);
    ensure(this.client&&this.mode!=='simulated','PAYMENTS_DISABLED','Stripe no está configurado.',503);
    ensure(/^acct_[a-zA-Z0-9]+$/.test(accountId),'ACCOUNT','Identificador de cuenta no válido.');
    // Retrieve through this platform: no account or financial agreement is created here.
    const account=await this.client.accounts.retrieve(accountId);
    ensure(account.id===accountId&&account.charges_enabled&&account.payouts_enabled,'KYC','La cuenta conectada todavía no puede cobrar.',409);
    await this.db.transaction(async db=>{
      const org=await one(db,'SELECT id,verified,stripe_account FROM rondiqo.organizations WHERE id=$1 FOR UPDATE',[orgId]);
      ensure(org?.verified,'ORGANIZER','Verifica la organización antes de vincular sus cobros.',409);
      ensure(!await one(db,'SELECT id FROM rondiqo.organizations WHERE stripe_account=$1 AND id<>$2',[accountId,orgId]),'ACCOUNT','Cuenta ya vinculada a otra organización.',409);
      if(org.stripe_account!==accountId)ensure(!await one(db,"SELECT r.id FROM rondiqo.registrations r JOIN rondiqo.competitions c ON c.id=r.competition_id WHERE c.org_id=$1 AND r.status IN ('pending','confirmed','refund_pending') AND r.amount_cents>0 LIMIT 1",[orgId]),'ACCOUNT','Resuelve las inscripciones de pago antes de cambiar la cuenta.',409);
      await db.query('UPDATE rondiqo.organizations SET stripe_account=$1 WHERE id=$2',[accountId,orgId]);
      await db.query("INSERT INTO rondiqo.audit(id,actor_id,action,resource_id,detail) VALUES($1,$2,'payment.account_linked',$3,$4)",[randomUUID(),actor.id,orgId,JSON.stringify({account:accountId,mode:this.mode})]);
    });return {ok:true};
  }
  async apply(event: Row) {
    ensure(event.livemode===(this.mode==='stripe_live'),'LIVE_DISABLED','Modo del evento incorrecto; eventos reales y pruebas están separados.',400);
    return this.db.transaction(async db=>{
      if(await one(db,'SELECT id FROM rondiqo.webhook_events WHERE id=$1',[event.id])) return {duplicate:true};
      const s=event.data?.object;
      ensure(s && typeof event.id==='string','WEBHOOK','Evento no válido.');
      if(event.type.startsWith('checkout.session.')){
        const regId=s.metadata?.registration_id;
        ensure(typeof regId==='string','WEBHOOK','Falta la inscripción.');
        const r=await one(db,`SELECT r.*,c.status AS comp_status FROM rondiqo.registrations r JOIN rondiqo.competitions c ON c.id=r.competition_id WHERE r.id=$1`,[regId]);
        ensure(r && r.provider===this.mode,'WEBHOOK','Inscripción desconocida para este modo de pago.',404);
        ensure(!r.checkout_id || r.checkout_id===s.id,'WEBHOOK_SESSION','Sesión de pago incorrecta.',409);
        ensure(s.currency==='eur' && s.amount_total===r.amount_cents && s.client_reference_id===r.id && s.metadata?.app==='rondiqo','WEBHOOK_AMOUNT','Importe, moneda o referencia incorrectos.',409);
        const paid=['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type) && s.payment_status==='paid';
        if(paid && r.status!=='confirmed' && r.status!=='refunded' && r.status!=='refund_pending'){
          const canConfirm=r.status==='pending' && r.comp_status==='open' && (!r.expires_at||new Date(r.expires_at).getTime()>Date.now());
          ensure(typeof s.payment_intent==='string','WEBHOOK','Falta referencia del pago.');
          await db.query('UPDATE rondiqo.registrations SET status=$1,checkout_id=$2,payment_intent=$3 WHERE id=$4',[canConfirm?'confirmed':'refund_pending',s.id,s.payment_intent,r.id]);
          if(!canConfirm) await db.query("INSERT INTO rondiqo.refunds(id,registration_id,status,reason) VALUES($1,$2,'pending','Pago recibido después de cancelación o cierre') ON CONFLICT(registration_id) DO NOTHING",[randomUUID(),r.id]);
          await db.query('INSERT INTO rondiqo.notifications(id,user_id,title,message) VALUES($1,$2,$3,$4)',[randomUUID(),r.user_id,canConfirm?'Pago confirmado':'Reembolso pendiente',canConfirm?'Ya puedes consultar tu pase QR.':'Se ha recibido un pago fuera de plazo. La plaza no se confirma; se ha abierto un reembolso.']);
        } else if(['checkout.session.expired','checkout.session.async_payment_failed'].includes(event.type) && r.status==='pending') {
          await db.query("UPDATE rondiqo.registrations SET status='expired',checkout_id=$1 WHERE id=$2",[s.id,r.id]);
        }
      } else if(event.type==='charge.refunded') {
        const pi=typeof s.payment_intent==='string'?s.payment_intent:s.payment_intent?.id;
        const ours=s.metadata?.app==='rondiqo';
        const ref=ours?s.metadata?.registration_id:null;
        const r=await one(db,'SELECT * FROM rondiqo.registrations WHERE payment_intent=$1 OR ($2::uuid IS NOT NULL AND id=$2)',[pi,ref ?? null]);
        // Charge metadata inherits PaymentIntent metadata, so refund-before-success cannot resurrect a pass.
        if(ours)ensure(r,'WEBHOOK','Reembolso sin inscripción conocida; requiere reintento.',409);
        if(r){
          ensure(r.provider===this.mode && (!r.payment_intent || r.payment_intent===pi) && s.currency==='eur' && s.amount===r.amount_cents,'WEBHOOK_AMOUNT','Reembolso no corresponde al pago.',409);
          // Refund events may arrive out of order; a full refund is terminal.
          const full=r.status==='refunded'||s.amount_refunded>=r.amount_cents;
          await db.query('UPDATE rondiqo.registrations SET status=$1,qr_token=$2,payment_intent=$3 WHERE id=$4',[full?'refunded':'refund_pending',secret(),pi,r.id]);
          if(full)await db.query("UPDATE rondiqo.refunds SET status='completed' WHERE registration_id=$1",[r.id]);
          else await db.query("INSERT INTO rondiqo.refunds(id,registration_id,status,reason) VALUES($1,$2,'pending','Reembolso parcial externo: completar devolución antes de reutilizar plaza') ON CONFLICT(registration_id) DO NOTHING",[randomUUID(),r.id]);
        }
      }
      await db.query('INSERT INTO rondiqo.webhook_events(id,type) VALUES($1,$2)',[event.id,event.type]);
      return {ok:true};
    });
  }
  async processRefunds() {
    ensure(this.client,'PAYMENTS_DISABLED','Stripe no configurado.',503);
    const rows=(await this.db.query(`SELECT f.*,r.payment_intent,r.amount_cents FROM rondiqo.refunds f JOIN rondiqo.registrations r ON r.id=f.registration_id
      WHERE f.status IN ('pending','failed') AND r.provider=$1 AND r.payment_intent IS NOT NULL`,[this.mode])).rows;
    const results:Row[]=[];
    for(const r of rows){
      try{
        // Reconcile externally issued partial/full refunds before requesting any remaining amount.
        const charges=await this.client.charges.list({payment_intent:r.payment_intent,limit:10});
        const charge=charges.data.find(c=>c.paid&&c.status==='succeeded');
        ensure(charge&&charge.currency==='eur'&&charge.amount===r.amount_cents,'REFUND','No se ha podido verificar el cobro.');
        const remaining=charge.amount-charge.amount_refunded;
        // Follow an existing asynchronous refund instead of replaying a cached creation response.
        const refund=r.provider_ref?await this.client.refunds.retrieve(r.provider_ref):remaining===0?{id:charge.id,status:'succeeded'}:
          await this.client.refunds.create({payment_intent:r.payment_intent,amount:remaining,reverse_transfer:true,refund_application_fee:true},{idempotencyKey:`rondiqo-refund-${r.id}`});
        await this.db.transaction(async db=>{
          await db.query('UPDATE rondiqo.refunds SET status=$1,provider_ref=$2 WHERE id=$3',[refund.status==='succeeded'?'completed':['failed','canceled'].includes(refund.status||'')?'failed':'pending',refund.id,r.id]);
          if(refund.status==='succeeded') await db.query("UPDATE rondiqo.registrations SET status='refunded',qr_token=$1 WHERE id=$2",[secret(),r.registration_id]);
        });
        results.push({id:r.id,status:refund.status});
      }catch{
        await this.db.query("UPDATE rondiqo.refunds SET status='failed' WHERE id=$1",[r.id]);
        results.push({id:r.id,status:'failed'});
      }
    }
    return results;
  }
  async reconcile() {
    ensure(this.client,'PAYMENTS_DISABLED','Stripe no configurado.',503);
    const pending=(await this.db.query("SELECT id,checkout_id FROM rondiqo.registrations WHERE provider=$1 AND status IN ('pending','cancelled','expired','refund_pending') AND checkout_id IS NOT NULL",[this.mode])).rows;
    for(const r of pending){
      const s=await this.client.checkout.sessions.retrieve(r.checkout_id);
      if(s.status==='expired'||s.payment_status==='paid') await this.apply({
        id:`reconcile-${s.id}-${s.payment_status}-${s.status}`,livemode:s.livemode,
        type:s.payment_status==='paid'?'checkout.session.completed':'checkout.session.expired',data:{object:s},
      });
    }
    return {checked:pending.length,refunds:await this.processRefunds()};
  }
}
