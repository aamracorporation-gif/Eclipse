import React,{useState} from 'react';
import {View,Text} from 'react-native';
import {router} from 'expo-router';
import {Screen} from './Screen';
import {ThemedInput} from '@/components/ui/ThemedInput';
import {ThemedButton} from '@/components/ui/ThemedButton';
import {api} from '@/src/api';
import {s} from '@/src/ui/components';
import {colors as c} from '@/src/ui/theme';
export function RecoveryScreen(){
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[password,setPassword]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const run=async()=>{setBusy(true);setMessage('');try{
  if(sent){await api('/auth/reset-password',{email,code,password});setMessage('Contraseña actualizada. Ya puedes entrar con la nueva contraseña.');}
  else{const r=await api('/auth/forgot-password',{email});setMessage(r.message);setSent(true);}
 }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 return <Screen><View style={[s.panel,{gap:18,maxWidth:520,width:'100%',alignSelf:'center'}]}><Text style={s.title}>Recupera tu acceso.</Text>
 <Text style={s.body}>Te enviaremos un código de un solo uso. No compartas el código con nadie.</Text>
 <ThemedInput label="Email" accessibilityLabel="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"/>
 {sent&&<><ThemedInput label="Código del correo" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code"/><ThemedInput label="Nueva contraseña · mínimo 12 caracteres" value={password} onChangeText={setPassword} secureTextEntry/></>}
 {!!message&&<Text accessibilityRole="alert" style={{color:c.lime,lineHeight:23}}>{message}</Text>}
 <ThemedButton title={sent?'Guardar contraseña':'Enviar código'} loading={busy} onPress={()=>void run()}/>
 <ThemedButton variant="secondary" title="Volver a entrar" onPress={()=>router.replace('/login')}/></View></Screen>;
}
