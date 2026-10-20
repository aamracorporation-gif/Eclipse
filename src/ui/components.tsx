import {ThemedButton} from '@/components/ui/ThemedButton';
import {ThemedInput} from '@/components/ui/ThemedInput';
import React from 'react';
import { View,Text,Pressable,StyleSheet,TextInput,Modal,ScrollView,ActivityIndicator } from 'react-native';
import Svg,{Path,Rect,Circle,Line} from 'react-native-svg';
import { colors as c } from './theme';
export function Logo({small=false}:{small?:boolean}){
  return <View style={{flexDirection:'row',alignItems:'center',gap:10}}><Svg width={small?25:34} height={small?25:34} viewBox="0 0 40 40"><Rect width="40" height="40" rx="11" fill={c.lime}/><Path d="M11 29V11H23C30 11 31 22 23 23L30 29H23L17 23V29ZM17 16V19H23C25 19 25 16 23 16Z" fill={c.ink}/></Svg><Text style={{fontSize:small?18:23,fontWeight:'900',letterSpacing:1.2,color:c.text}}>RONDIQO</Text></View>;
}
export function Court({color=c.lime,width=270,height=160}:{color?:string;width?:number;height?:number}){
  return <Svg width={width} height={height} viewBox="0 0 300 180" accessibilityLabel="Ilustración de una pista deportiva">
    <Rect x="12" y="10" width="276" height="160" rx="30" fill={color} opacity=".09"/>
    <Path d="M52 38L248 38L270 146L30 146Z M150 38V146 M42 92H258 M48 62H253 M36 122H264" fill="none" stroke={color} strokeWidth="2.5" opacity=".75"/>
    <Circle cx="103" cy="67" r="11" fill={color}/><Circle cx="204" cy="119" r="11" fill={c.coral}/>
    <Path d="M114 72Q169 69 196 108" fill="none" stroke={c.text} strokeDasharray="5 6" strokeWidth="2"/>
    <Circle cx="156" cy="82" r="4" fill={c.text}/>
  </Svg>;
}
export function Button({children,onPress,secondary=false,danger=false,disabled=false,small=false}:{children:React.ReactNode;onPress:()=>void;secondary?:boolean;danger?:boolean;disabled?:boolean;small?:boolean}){
  return <ThemedButton title={React.Children.toArray(children).join('')} onPress={onPress} disabled={disabled} variant={secondary?'secondary':'primary'} style={{width:'auto',minHeight:small?40:48,borderRadius:11,...(danger?{backgroundColor:c.coral}:{})}} textStyle={{fontSize:small?12:14}}/>;
}
export function Badge({children,color=c.lime}:{children:React.ReactNode;color?:string}){
  return <View style={{backgroundColor:color+'18',paddingHorizontal:10,paddingVertical:5,borderRadius:7,alignSelf:'flex-start'}}><Text style={{fontSize:11,fontWeight:'800',letterSpacing:.5,color}}>{children}</Text></View>;
}
export function Heading({eyebrow,title,subtitle}:{eyebrow?:string;title:string;subtitle?:string}){
  return <View style={{gap:9,marginBottom:22}}>{eyebrow&&<Text style={s.eyebrow}>{eyebrow}</Text>}<Text style={s.title}>{title}</Text>{subtitle&&<Text style={s.body}>{subtitle}</Text>}</View>;
}
export function Empty({title,body,children}:{title:string;body:string;children?:React.ReactNode}){
  return <View style={[s.panel,{padding:28,gap:12}]}><Text style={s.h3}>{title}</Text><Text style={s.body}>{body}</Text>{children}</View>;
}
export type Field={key:string;label:string;type?:'password'|'number'|'select'|'check'|'multiline';options?:{value:string;label:string}[];hint?:string};
export type FormConfig={title:string;intro?:string;fields:Field[];initial?:Record<string,any>;submit?:string;run:(values:Record<string,any>)=>Promise<void>};
export function FormDialog({form,close}:{form:FormConfig|null;close:()=>void}){
  const [values,setValues]=React.useState<Record<string,any>>({}),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
  React.useEffect(()=>{setValues(form?.initial||{});setError('');},[form]);
  if(!form)return null;
  const submit=async()=>{setBusy(true);setError('');try{await form.run(values);close();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <Modal visible transparent animationType="fade" onRequestClose={close}><View style={s.overlay}><View style={s.dialog}>
    <View style={[s.row,{justifyContent:'space-between',padding:24,paddingBottom:10}]}><Text style={[s.h3,{flex:1}]}>{form.title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar formulario" onPress={close} disabled={busy}><Text style={{color:c.muted,fontSize:25,padding:8}}>×</Text></Pressable></View>
    <ScrollView contentContainerStyle={{padding:24,paddingTop:10,gap:18}} keyboardShouldPersistTaps="handled">
      {form.intro&&<Text style={s.body}>{form.intro}</Text>}
      {form.fields.map(f=><View key={f.key} style={{gap:8}}>{f.type!=='check'&&<Text style={s.label}>{f.label}</Text>}
        {f.type==='select'?<View style={[s.row,{flexWrap:'wrap'}]}>{f.options?.map(o=><Pressable key={o.value} accessibilityRole="radio" accessibilityState={{checked:values[f.key]===o.value}} onPress={()=>setValues({...values,[f.key]:o.value})} style={[s.chip,values[f.key]===o.value&&s.chipActive]}><Text style={{color:values[f.key]===o.value?c.ink:c.text,fontSize:13,fontWeight:'600'}}>{o.label}</Text></Pressable>)}</View>:
        f.type==='check'?<Pressable accessibilityRole="checkbox" accessibilityState={{checked:!!values[f.key]}} onPress={()=>setValues({...values,[f.key]:!values[f.key]})} style={[s.row,{alignItems:'flex-start'}]}><View style={[s.checkbox,values[f.key]&&{backgroundColor:c.lime}]}><Text style={{color:c.ink,fontWeight:'900'}}>{values[f.key]?'✓':''}</Text></View><Text style={[s.body,{flex:1}]}>{f.label}</Text></Pressable>:
        <ThemedInput accessibilityLabel={f.label} containerStyle={{marginBottom:0}} value={String(values[f.key]??'')} onChangeText={v=>setValues({...values,[f.key]:v})} secureTextEntry={f.type==='password'} autoCapitalize="none" multiline={f.type==='multiline'} keyboardType={f.type==='number'?'numeric':'default'} placeholderTextColor={c.muted} inputStyle={f.type==='multiline'?{height:95,textAlignVertical:'top'}:{}}/>}
        {f.hint&&<Text style={s.caption}>{f.hint}</Text>}
      </View>)}
      {!!error&&<Text accessibilityRole="alert" style={{color:c.danger,lineHeight:21}}>{error}</Text>}
      <Button disabled={busy} onPress={submit}>{busy?'Guardando…':form.submit||'Guardar'}</Button>
    </ScrollView></View></View></Modal>;
}
export function Loading(){return <View style={{padding:50}}><ActivityIndicator color={c.lime}/></View>;}
export const s=StyleSheet.create({
  panel:{backgroundColor:c.surface,borderWidth:1,borderColor:c.line,borderRadius:20,padding:22},
  row:{flexDirection:'row',alignItems:'center',gap:12},
  button:{backgroundColor:c.lime,paddingHorizontal:20,paddingVertical:14,borderRadius:10,alignItems:'center',justifyContent:'center',minHeight:40},
  secondary:{backgroundColor:c.raised,borderWidth:1,borderColor:c.line},
  buttonText:{color:c.ink,fontWeight:'800',fontSize:14},
  eyebrow:{color:c.lime,fontSize:11,fontWeight:'800',letterSpacing:2.2,textTransform:'uppercase'},
  title:{color:c.text,fontSize:32,fontWeight:'800',letterSpacing:-1},
  h3:{color:c.text,fontSize:19,fontWeight:'700'},
  body:{color:c.muted,fontSize:14,lineHeight:22},
  caption:{color:c.muted,fontSize:12,lineHeight:18},
  label:{color:c.text,fontSize:13,fontWeight:'600'},
  input:{backgroundColor:c.bg,borderWidth:1,borderColor:c.line,borderRadius:10,padding:13,color:c.text,fontSize:15,minHeight:48},
  chip:{borderWidth:1,borderColor:c.line,borderRadius:9,paddingHorizontal:14,paddingVertical:10},
  chipActive:{backgroundColor:c.lime,borderColor:c.lime},
  checkbox:{width:23,height:23,borderWidth:1,borderColor:c.muted,borderRadius:5,alignItems:'center',justifyContent:'center'},
  overlay:{flex:1,backgroundColor:'#0009',justifyContent:'center',alignItems:'center',padding:16},
  dialog:{backgroundColor:c.surface,borderWidth:1,borderColor:c.line,borderRadius:22,width:'100%',maxWidth:580,maxHeight:'92%'},
});
