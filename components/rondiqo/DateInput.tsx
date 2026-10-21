import React,{useState} from 'react';
import {View,Text,Pressable,Modal,StyleSheet} from 'react-native';
import {ThemedButton} from '@/components/ui/ThemedButton';
import {colors as c} from '@/src/ui/theme';
import {madridParts} from '@/src/domain/datetime';

/** A calendar shared by native and web, with no locale-dependent date parsing. */
export function DateInput({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
 const [open,setOpen]=useState(false),[month,setMonth]=useState(()=>madridParts(new Date()).date.slice(0,7));
 const [year,monthNumber]=month.split('-').map(Number);
 const leading=(new Date(Date.UTC(year,monthNumber-1,1)).getUTCDay()+6)%7,days=new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
 const selected=/^\d{4}-\d{2}-\d{2}$/.test(value)?value.split('-').reverse().join('/'):'Elige una fecha';
 const monthLabel=new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year,monthNumber-1,1)));
 const move=(amount:number)=>{const d=new Date(Date.UTC(year,monthNumber-1+amount,1));setMonth(d.toISOString().slice(0,7));};
 return <><Text style={[s.label,{marginBottom:8}]}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected}`} onPress={()=>{setMonth(/^\d{4}-\d{2}/.test(value)?value.slice(0,7):madridParts(new Date()).date.slice(0,7));setOpen(true);}} style={[s.input,{justifyContent:'center',marginBottom:14}]}><Text style={{color:c.text,fontSize:15}}>{selected}  ▾</Text></Pressable>
 <Modal visible={open} transparent animationType="fade" onRequestClose={()=>setOpen(false)}><View style={s.overlay}><View style={[s.dialog,{maxWidth:400,padding:20,gap:16}]}><Text style={s.h3}>{label}</Text>
 <View style={[s.row,{justifyContent:'space-between'}]}><Pressable accessibilityRole="button" accessibilityLabel="Mes anterior" onPress={()=>move(-1)} style={{padding:12}}><Text style={{color:c.lime,fontSize:22}}>‹</Text></Pressable><Text style={[s.label,{textTransform:'capitalize'}]}>{monthLabel}</Text><Pressable accessibilityRole="button" accessibilityLabel="Mes siguiente" onPress={()=>move(1)} style={{padding:12}}><Text style={{color:c.lime,fontSize:22}}>›</Text></Pressable></View>
 <View style={{flexDirection:'row'}}>{['L','M','X','J','V','S','D'].map((day,i)=><Text key={i} style={[s.caption,{width:'14.2857%',textAlign:'center'}]}>{day}</Text>)}</View>
 <View style={{flexDirection:'row',flexWrap:'wrap'}}>{Array.from({length:Math.ceil((leading+days)/7)*7},(_,i)=>{const day=i-leading+1,date=month+'-'+String(day).padStart(2,'0'),valid=day>0&&day<=days;return valid?<Pressable key={i} accessibilityRole="button" accessibilityLabel={`${day} de ${monthLabel}`} accessibilityState={{selected:date===value}} onPress={()=>{onChange(date);setOpen(false);}} style={{width:'14.2857%',height:44,justifyContent:'center',alignItems:'center',borderRadius:10,backgroundColor:date===value?c.lime:'transparent'}}><Text style={{fontSize:15,color:date===value?c.ink:c.text,fontWeight:date===value?'800':'400'}}>{day}</Text></Pressable>:<View key={i} style={{width:'14.2857%',height:44}}/>;})}</View>
 <ThemedButton variant="secondary" title="Cerrar calendario" onPress={()=>setOpen(false)}/></View></View></Modal></>;
}
const s=StyleSheet.create({label:{color:c.text,fontSize:13,fontWeight:'600'},h3:{color:c.text,fontSize:19,fontWeight:'700'},caption:{color:c.muted,fontSize:12,lineHeight:18},input:{backgroundColor:c.bg,borderWidth:1,borderColor:c.line,borderRadius:10,padding:13,minHeight:48},overlay:{flex:1,backgroundColor:'#0009',justifyContent:'center',alignItems:'center',padding:16},dialog:{backgroundColor:c.surface,borderWidth:1,borderColor:c.line,borderRadius:22,width:'100%',maxHeight:'92%'},row:{flexDirection:'row',alignItems:'center',gap:12}});
