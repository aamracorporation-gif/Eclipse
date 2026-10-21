import React,{useState,useEffect} from 'react';
import {View,Text} from 'react-native';
import {router} from 'expo-router';
import {Screen} from './Screen';
import {ThemedInput} from '@/components/ui/ThemedInput';
import {ThemedButton} from '@/components/ui/ThemedButton';
import {useWorkspace} from '@/lib/WorkspaceContext';
import {api} from '@/src/api';
import {s} from '@/src/ui/components';
import {colors as c} from '@/src/ui/theme';
export function RecoveryScreen(){
 const workspace=useWorkspace();
 const [email,setEmail]=useState(workspace.authEmail),[code,setCode]=useState(''),[password,setPassword]=useState('');
 const [stage,setStage]=useState<'request'|'code'|'done'>('request'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[resendAt,setResendAt]=useState(0),[seconds,setSeconds]=useState(0);
 useEffect(()=>{if(!resendAt)return;const tick=()=>setSeconds(Math.max(0,Math.ceil((resendAt-Date.now())/1000)));tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);},[resendAt]);
 const send=async()=>{if(busy||seconds)return;setBusy(true);setError('');try{const r=await api('/auth/forgot-password',{email:email.trim()});workspace.setAuthEmail(email.trim());setMessage(r.message);setStage('code');setResendAt(Date.now()+60000);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const save=async()=>{if(busy)return;setBusy(true);setError('');try{await api('/auth/reset-password',{email:email.trim(),code:code.trim(),password});setStage('done');setCode('');setPassword('');setMessage('Tu contraseña se ha actualizado y las sesiones anteriores se han cerrado.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const login=()=>{workspace.setAuthEmail(email.trim());router.replace({pathname:'/(auth)/login',params:{intent:workspace.space}});};
 return <Screen><View style={[s.panel,{gap:18,maxWidth:520,width:'100%',alignSelf:'center'}]}><Text style={s.title}>{stage==='done'?'Acceso recuperado':'Recuperar contraseña'}</Text>
 {stage!=='done'&&<Text style={s.body}>{stage==='request'?'Escribe el correo de tu cuenta. Recibirás un código para elegir una nueva contraseña.':'Escribe el código del último correo recibido y tu nueva contraseña.'}</Text>}
 {stage==='request'?<ThemedInput label="Correo electrónico" accessibilityLabel="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email"/>:stage==='code'?<><Text style={s.label}>{email}</Text><ThemedInput label="Código del correo" accessibilityLabel="Código del correo" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code"/><ThemedInput label="Nueva contraseña · mínimo 12 caracteres" accessibilityLabel="Nueva contraseña" value={password} onChangeText={setPassword} autoCapitalize="none" autoComplete="new-password" secureTextEntry/></>:null}
 {!!error&&<Text accessibilityRole="alert" style={{color:c.danger,lineHeight:23}}>{error}</Text>}{!!message&&<Text accessibilityRole="alert" style={{color:c.lime,lineHeight:23}}>{message}</Text>}
 {stage==='request'?<ThemedButton title="Enviar código" loading={busy} onPress={()=>void send()}/>:stage==='code'?<><ThemedButton title="Guardar nueva contraseña" loading={busy} onPress={()=>void save()}/><ThemedButton variant="secondary" title={seconds?`Reenviar código en ${seconds} s`:'Reenviar código'} disabled={busy||seconds>0} onPress={()=>void send()}/><ThemedButton variant="secondary" title="Corregir correo" disabled={busy} onPress={()=>{setStage('request');setCode('');setMessage('');setError('');setResendAt(0);setSeconds(0);}}/></>:null}
 <ThemedButton variant={stage==='done'?'primary':'secondary'} title={stage==='done'?'Entrar con mi nueva contraseña':'Volver a iniciar sesión'} onPress={login}/></View></Screen>;
}
