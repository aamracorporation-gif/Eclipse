import { subscriptionEntitlement, subscriptionIdFromEvent } from '../supabase/functions/_shared/boxOfficeEntitlement';

const valid = () => ({id:'sub_test',metadata:{feature:'box_office_monthly'},status:'active',cancel_at_period_end:false,
  items:{data:[{quantity:1,current_period_end:2000000000,price:{unit_amount:5000,currency:'eur',recurring:{interval:'month',interval_count:1}}}]},
  latest_invoice:{status:'paid',currency:'eur',total:5000},pause_collection:null});

describe('Taquilla Premium requires the paid monthly plan',()=>{
 it('grants a paid month and retains it after scheduled cancellation',()=>{
   const subscription=valid();
   expect(subscriptionEntitlement(subscription).paidThrough).toBe(new Date(2000000000000).toISOString());
   subscription.cancel_at_period_end=true;
   expect(subscriptionEntitlement(subscription).paidThrough).not.toBeNull();
   expect(subscriptionEntitlement(subscription).cancelAtPeriodEnd).toBe(true);
 });
 it.each(['incomplete','past_due','unpaid','canceled','trialing','paused'])('denies %s',status=>{
   expect(subscriptionEntitlement({...valid(),status}).paidThrough).toBeNull();
 });
 it('recognizes current portal cancel_at and never grants beyond cancellation',()=>{
   const result=subscriptionEntitlement({...valid(),cancel_at:1999999900});
   expect(result.cancelAtPeriodEnd).toBe(true);
   expect(result.paidThrough).toBe(new Date(1999999900000).toISOString());
 });
 it('denies active but unpaid invoices and paused collection',()=>{
   const subscription=valid();subscription.latest_invoice.status='open';
   expect(subscriptionEntitlement(subscription).paidThrough).toBeNull();
   expect(subscriptionEntitlement({...valid(),pause_collection:{behavior:'void'}}).paidThrough).toBeNull();
 });
 it.each(['currency','amount','interval','quantity','feature','free_invoice'])('rejects an unrelated or forged %s',change=>{
   const s=valid();const item=s.items.data[0];
   if(change==='currency')item.price.currency='usd';
   if(change==='amount')item.price.unit_amount=1;
   if(change==='interval')item.price.recurring.interval='year';
   if(change==='quantity')item.quantity=2;
   if(change==='feature')s.metadata.feature='other';
   if(change==='free_invoice')s.latest_invoice.total=0;
   expect(subscriptionEntitlement(s).paidThrough).toBeNull();
 });
 it('recognizes modern invoice webhooks and ignores unrelated events',()=>{
   expect(subscriptionIdFromEvent({type:'invoice.paid',data:{object:{parent:{subscription_details:{subscription:'sub_test'}}}}})).toBe('sub_test');
   expect(subscriptionIdFromEvent({type:'checkout.session.completed',data:{object:{subscription:'sub_test'}}})).toBe('sub_test');
   expect(subscriptionIdFromEvent({type:'customer.subscription.deleted',data:{object:{id:'sub_test'}}})).toBe('sub_test');
   expect(subscriptionIdFromEvent({type:'payment_intent.succeeded',data:{object:{id:'pi_test'}}})).toBeNull();
 });
});
