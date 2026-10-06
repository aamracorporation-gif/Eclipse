import React, {useState} from 'react';
// @ts-expect-error Standalone QA harness; React DOM types are not part of the native app.
import {createRoot} from 'react-dom/client';
import {SalesOfferForm} from '@/components/SalesOfferForm';
import {createEmptyTicketDraft,getTicketDraftErrors,buildTicketName,serializeTicketMetadata} from '@/lib/createEventTicketConfig';
import {buildTicketDocument} from '@/lib/ticketDocument';
import {DemoCard} from './.preview-card';
function Preview(){
 const [draft,setDraft]=useState({...createEmptyTicketDraft(),category:'vip_table' as const,name:'Mesa Eclipse',price:'300',quantity:'4',vipGroupSize:'6',vipFreeBottles:[{brand:'Botella a elegir',quantity:'1'}],benefits:'Mesa completa. Entrada para todo el grupo.',generalAccessZone:'Terraza'});
 const [attempt,setAttempt]=useState(false),[notice,setNotice]=useState('');
 const ticket={id:'00000000-0000-4000-8000-00000000de00',buyer_name:'Alex García',short_code:'DEMO-026',qr_token:'DEMO-NO-VALIDO-ECLIPSE',quantity:draft.category==='vip_table'?Number(draft.vipGroupSize||1):Number(draft.admissionsPerUnit||1),status:'valid',events:{id:'demo',title:'Eclipse Weekend',event_date:'2026-10-09T22:30:00Z',venues:{name:'Sala Eclipse'}},product_snapshot:{kind:draft.category==='vip_table'?'vip_table':'admission',name:buildTicketName(draft),category:draft.category,metadata:serializeTicketMetadata(draft)}};
 return <main><header><span>E C L I P S E</span><span>VENTAS / ORBITAL EDITION</span></header><div className="layout"><section className="form"><SalesOfferForm value={draft} onChange={v=>setDraft(v as any)} eventDate={new Date('2026-10-09T22:30:00Z')} showErrors={attempt} errors={getTicketDraftErrors(draft)} onAdd={()=>{setAttempt(true);setNotice(Object.keys(getTicketDraftErrors(draft)).length?'Revisa los campos indicados.':'Oferta válida. Lista para guardar en el catálogo.');}}/><p role="status">{notice}</p></section><aside><small>ENTRADA EN LA APP · DATOS DE EJEMPLO</small><DemoCard item={ticket}/><small>VERSIÓN PARA DESCARGAR</small><iframe title="Entrada para descargar" srcDoc={buildTicketDocument(ticket)}/><p className="note">Previsualización interactiva con los componentes del formulario y la tarjeta. Los QR son de demostración.</p></aside></div></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
