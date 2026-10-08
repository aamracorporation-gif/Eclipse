// @ts-nocheck Standalone visual harness; payments and network effects are disabled.
import {DiscountScopePicker} from '@/components/DiscountScopePicker';
import {GlassView} from '@/components/ui/GlassView';
import {ThemedInput} from '@/components/ui/ThemedInput';
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {View} from 'react-native';
import {CustomerPurchasePanel} from '@/components/CustomerPurchasePanel';
import {DiscountCodeField} from '@/components/DiscountCodeField';
import {calculateDiscountCents} from '@/supabase/functions/_shared/discountPolicy';
import DemoCreator from './.preview-creator';
const event={id:'preview',event_date:'2029-12-12T22:30:00Z',ticket_price:20,available_tickets:120,event_ticket_types:[
{id:'general',name:'Entrada + consumición',category:'general',price:20,quantity:100,sold:28,metadata:{includedDrinks:1,benefits:'Acceso a la pista principal.',salePhase:'Segundo tramo',minPerOrder:1,maxPerOrder:6}},
{id:'group',name:'Pack de 4 entradas',category:'group',price:68,quantity:15,sold:6,metadata:{admissionsPerUnit:4,includedDrinks:1,benefits:'Una compra para todo el grupo.',minPerOrder:1,maxPerOrder:2}},
{id:'free',name:'Lista Eclipse',category:'free',price:0,quantity:40,sold:12,metadata:{entryDeadlineMinutes:60,benefits:'Acceso con invitación.',minPerOrder:1,maxPerOrder:2}}],
reservados_vip:[{id:'mesa',name:'Mesa Eclipse',description:'Reservado junto a la pista.',base_price:300,capacity_people:6,included_bottles:1,quantity_available:4}]};
function Purchase(){
const [tab,onTab]=useState(new URLSearchParams(location.search).get('view')==='vip'?'vip':'tickets');
const [id,onSelect]=useState('general'),[quantity,onQuantity]=useState(1),[name,onName]=useState(''),[email,onEmail]=useState(''),[discount,onDiscount]=useState(null),[checking,onChecking]=useState(false);
const selected=event.event_ticket_types.find(x=>x.id===id), subtotal=tab==='vip'?300:quantity*selected.price;
const saving=calculateDiscountCents(Math.round(subtotal*100),discount?{discount_type:discount.type,discount_value:discount.value}:null)/100;
const cents=Math.round((subtotal-saving)*100),fee=subtotal===0?0:Math.max(Math.round((cents*.015+25)/.985),50)/100;
return <View style={{padding:16,paddingTop:28}}><DiscountCodeField key={tab} eventId={event.id} kind={tab==='vip'?'vip_table':'event_ticket'} productId={tab==='vip'?'mesa':id} quantity={tab==='vip'?1:quantity} value={discount} onChange={onDiscount} onCheckingChange={onChecking} render={coupon=><CustomerPurchasePanel event={event} tab={tab} onTab={onTab} selectedId={tab==='vip'?'mesa':id} onSelect={value=>{onSelect(value);onQuantity(1);}} quantity={quantity} min={1} max={selected.metadata.maxPerOrder} onQuantity={onQuantity} name={name} email={email} onName={onName} onEmail={onEmail} subtotal={subtotal} fee={fee} total={subtotal-saving+fee} saving={saving} unavailable={null} busy={false} authenticated onSubmit={()=>{}} coupon={coupon} wallet={{enabled:false,selected:false,balance:0,loading:false,onChange:()=>{}}}/>}/></View>;
}
function Organizer(){
 const [scope,onScope]=useState('selected'),[ticketIds,onTickets]=useState(['general']),[vipIds,onVips]=useState(['mesa']);
 return <View style={{padding:20}}><GlassView style={{padding:20}}><ThemedInput label="Código de descuento" value="ECLIPSE20" editable={false}/><DiscountScopePicker eventId="preview" scope={scope} ticketIds={ticketIds} vipIds={vipIds} onScope={onScope} onTickets={onTickets} onVips={onVips} onReady={()=>{}}/></GlassView></View>;
}
const view=new URLSearchParams(location.search).get('view');const creator=view==='creator';
createRoot(document.getElementById('root')!).render(view==='organizer'?<Organizer/>:creator?<div style={{height:'100vh',display:'flex'}}><DemoCreator/></div>:<Purchase/>);
