import React,{useState} from 'react';
import {View,Text} from 'react-native';
import {RevenueChart} from '@/components/dashboard/RevenueChart';
import {TimeFilter,TimeRange} from '@/components/dashboard/TimeFilter';
import {useAppState} from '@/lib/AppStateContext';
import {Heading,Empty,Button,s} from '@/src/ui/components';
import {colors as c} from '@/src/ui/theme';
import type {Row} from '@/src/domain/model';
export function SportsStats(){
 const {state}=useAppState(),[range,setRange]=useState<TimeRange>('week'),[org,setOrg]=useState('all');
 const metrics=(state.organizer?.metrics||[]).filter((m:Row)=>org==='all'||m.org_id===org),rows=(state.organizer?.registrations||[]).filter((r:Row)=>(org==='all'||r.org_id===org)&&r.amount_cents!==undefined);
 const total=(key:string)=>metrics.reduce((n:number,m:Row)=>n+Number(m[key]||0),0);
 const money=(v:number)=>new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(v/100);
 return <><Heading eyebrow="CADA RONDA CUENTA" title="El pulso de tu organización." subtitle="Inscripciones, ocupación y accesos. Importes de demostración, sin cobros reales."/><View style={[s.row,{flexWrap:'wrap',marginBottom:22}]}><Button small secondary={org!=='all'} onPress={()=>setOrg('all')}>Todas</Button>{state.organizations.map((o:Row)=><Button key={o.id} small secondary={org!==o.id} onPress={()=>setOrg(o.id)}>{o.name}</Button>)}</View>{!metrics.length?<Empty title="Estadísticas de gestión" body="Los importes y métricas están disponibles para propietarios y gestores de una organización."/>:<>
 <View style={[s.row,{flexWrap:'wrap',alignItems:'stretch',marginBottom:22}]}>{[{label:'Inscripciones confirmadas',value:total('confirmed')},{label:'Accesos validados',value:total('checked_in')},{label:'Importe confirmado simulado',value:money(total('amount_cents'))}].map(x=><View key={x.label} style={[s.panel,{flexBasis:210,flexGrow:1,gap:10}]}><Text style={s.caption}>{x.label}</Text><Text style={{color:c.lime,fontSize:30,fontWeight:'800'}}>{x.value}</Text></View>)}</View>
 <View style={[s.panel,{marginBottom:22}]}><Text style={s.h3}>Importes de inscripciones confirmadas</Text><Text style={s.caption}>Agrupados por fecha de inscripción. No representan ingresos cobrados.</Text><TimeFilter value={range} onChange={setRange}/><RevenueChart data={rows.filter((r:Row)=>r.status==='confirmed').map((r:Row)=>({date:r.created_at,amount:r.amount_cents/100}))} timeRange={range} color={c.lime}/></View>
 <Text style={[s.h3,{marginBottom:15}]}>Ocupación por competición</Text>{state.competitions.filter((x:Row)=>metrics.some((m:Row)=>m.org_id===x.org_id)).map((x:Row)=><View key={x.id} style={[s.panel,{gap:12,marginBottom:12}]}><Text style={s.label}>{x.title}</Text><Text style={s.caption}>{x.confirmed_count} confirmadas / {x.capacity} plazas · {Math.round(x.confirmed_count/x.capacity*100)} %</Text><View style={{height:7,borderRadius:4,backgroundColor:c.line,overflow:'hidden'}}><View style={{width:Math.min(100,x.confirmed_count/x.capacity*100)+'%' as any,height:7,backgroundColor:c.lime}}/></View></View>)}</>}
 </>;
}
