import React,{useEffect,useState} from 'react';
import {View,Text,Pressable,Platform} from 'react-native';
import {router,useLocalSearchParams} from 'expo-router';
import {useAuth} from '@/lib/AuthContext';
import {useWorkspace} from '@/lib/WorkspaceContext';
import {Screen} from './Screen';
import {ThemedInput} from '@/components/ui/ThemedInput';
import {ThemedButton} from '@/components/ui/ThemedButton';
import {s,Court,Badge} from '@/src/ui/components';
import {colors as c} from '@/src/ui/theme';
import {useResponsive} from '@/lib/responsive';
import {pathFor,safeReturnPath} from '@/src/domain/navigation';
import {api} from '@/src/api';

export function AuthScreen({register=false}:{register?:boolean}){
 const params=useLocalSearchParams<{intent?:string;next?:string}>(),workspace=useWorkspace();
 const intent=params.intent==='organizer'?'organizer':params.intent==='player'?'player':workspace.space;
 const {signIn,signUp}=useAuth(),{isDesktop}=useResponsive();
 const [email,setEmail]=useState(workspace.authEmail),[password,setPassword]=useState(''),[name,setName]=useState(''),[adult,setAdult]=useState(false);
 const [needsProfile,setNeedsProfile]=useState(false),[confirming,setConfirming]=useState(false),[resendAt,setResendAt]=useState(0),[seconds,setSeconds]=useState(0);
 const [visible,setVisible]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(Platform.OS==='web'&&window.location.hash){const hash=new URLSearchParams(window.location.hash.slice(1));if(hash.get('error'))setError('El enlace no es válido o ha caducado. Solicita otro enlace de confirmación.');else if(hash.get('type')==='signup')setNotice('Enlace de confirmación abierto. Entra con tu contraseña para continuar.');window.history.replaceState(null,'',window.location.pathname+window.location.search);}},[]);
 useEffect(()=>{if(!resendAt)return;const tick=()=>setSeconds(Math.max(0,Math.ceil((resendAt-Date.now())/1000)));tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);},[resendAt]);
 function remember(){workspace.setAuthEmail(email.trim());workspace.choose(intent);}
 function goTo(mode:'login'|'register'|'reset-password'){remember();router.replace({pathname:`/(auth)/${mode}`,params:{intent,...(params.next?{next:params.next}:{})}} as any);}
 async function submit(continueAfterConfirm=false){
  if(busy)return;setError('');setNotice('');setBusy(true);
  try{
   if(!email.trim()||!password)throw new Error('Escribe tu correo y tu contraseña.');
   if((register&&!continueAfterConfirm||needsProfile)&&(!name.trim()||!adult))throw new Error('Indica tu nombre y acepta las condiciones para mayores de 18 años.');
   remember();
   const next=register&&!needsProfile&&!continueAfterConfirm?await signUp({name,email:email.trim(),password,adult}):await signIn(email.trim(),password,needsProfile?{name,adult}:undefined);
   if(next.verificationRequired){setConfirming(true);setResendAt(Date.now()+60000);return;}
   const fallback=pathFor(intent,intent==='organizer'&&!next.organizations.length?'club':intent==='organizer'?'dashboard':'home');
   router.replace((params.next?safeReturnPath(params.next,intent):fallback) as any);
  }catch(e){const code=(e as any).code;if(code==='CONSENT'){setNeedsProfile(true);setConfirming(false);}if(code==='EMAIL_NOT_CONFIRMED'){setConfirming(true);}setError((e as Error).message);}finally{setBusy(false);}
 }
 async function resend(){
  if(busy||seconds)return;setError('');setNotice('');setBusy(true);
  try{const result=await api('/auth/resend-confirmation',{email:email.trim()});setNotice(result.message);setResendAt(Date.now()+60000);}catch(e){setError((e as Error).message);if((e as any).code==='EMAIL_RATE_LIMIT')setResendAt(Date.now()+60000);}finally{setBusy(false);}
 }
 const noticeBlock=<>{!!error&&<Text accessibilityRole="alert" style={{color:c.danger,lineHeight:23}}>{error}</Text>}{!!notice&&<Text accessibilityRole="alert" style={{color:c.lime,lineHeight:23}}>{notice}</Text>}</>;
 return <Screen><View style={{flexDirection:isDesktop?'row':'column',gap:isDesktop?42:16,alignItems:'center',paddingTop:isDesktop?24:0}}>
 {isDesktop&&<View style={{flex:1,gap:22}}><Badge color={intent==='organizer'?c.blue:c.lime}>{intent==='organizer'?'ORGANIZA CON RONDIQO':'JUEGA CON RONDIQO'}</Badge><Text style={[s.title,{fontSize:48,lineHeight:54}]}>{intent==='organizer'?'Tu competición,\nbien organizada.':'Tu equipo.\nTu próximo partido.'}</Text><Text style={s.body}>{intent==='organizer'?'Crea tu club, abre inscripciones y lleva cada jornada desde un mismo lugar.':'Crea tu pareja o equipo, inscríbete y sigue cada jornada.'}</Text><Court width={340} height={210}/></View>}
 <View style={[s.panel,{flex:isDesktop?1:undefined,width:'100%',maxWidth:480,padding:isDesktop?28:22,gap:16}]}>
 <Text style={[s.eyebrow,{color:intent==='organizer'?c.blue:c.lime}]}>{intent==='organizer'?'Espacio organizador':'Espacio jugador'}</Text>
 {confirming?<>
  <Text style={s.title}>Continúa con tu cuenta</Text>
  <Text style={s.body}>Si es tu primera cuenta, abre el enlace de confirmación que recibirás por correo y después vuelve aquí.</Text>
  <View style={{backgroundColor:c.bg,borderRadius:12,padding:14,gap:6}}><Text style={s.label}>{email}</Text><Text style={s.caption}>Revisa la bandeja de entrada y spam. El enlace anterior deja de ser válido si solicitas uno nuevo.</Text></View>
  <View style={{borderLeftWidth:3,borderLeftColor:c.blue,paddingLeft:14,gap:6}}><Text style={s.label}>¿Ya tenías cuenta en Eclipse o RONDIQO?</Text><Text style={s.body}>Tu cuenta sigue siendo la misma. No necesitas otra confirmación: entra con tu contraseña anterior o recupera el acceso.</Text></View>
  {noticeBlock}
  <ThemedButton title="Ya he confirmado · Entrar" loading={busy} onPress={()=>void submit(true)}/>
  <ThemedButton variant="secondary" title={seconds?`Reenviar enlace en ${seconds} s`:'Reenviar confirmación'} disabled={busy||seconds>0} onPress={()=>void resend()}/>
  <Pressable accessibilityRole="button" onPress={()=>goTo('login')}><Text style={{color:c.blue,textAlign:'center',paddingVertical:8}}>Entrar con mi cuenta existente</Text></Pressable>
  <Pressable accessibilityRole="button" onPress={()=>goTo('reset-password')}><Text style={{color:c.blue,textAlign:'center',paddingVertical:8}}>Recuperar mi contraseña</Text></Pressable>
  <Pressable accessibilityRole="button" onPress={()=>{setConfirming(false);setError('');setNotice('');}}><Text style={{color:c.muted,textAlign:'center',paddingVertical:8}}>Corregir correo o datos</Text></Pressable>
 </>:<>
  <Text style={s.title}>{needsProfile?'Completa tu perfil':register?'Crear cuenta':'Iniciar sesión'}</Text>
  <Text style={s.body}>{needsProfile?'Tu acceso de Eclipse es válido. Solo falta completar tu perfil deportivo.':register?'Una cuenta para jugar y organizar. Confirma tu correo para proteger el acceso.':'Si ya usabas Eclipse, entra con ese mismo correo y contraseña.'}</Text>
  {(register||needsProfile)&&<ThemedInput label="Tu nombre" accessibilityLabel="Nombre" value={name} onChangeText={setName} autoComplete="name"/>}
  <ThemedInput label="Correo electrónico" accessibilityLabel="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email"/>
  <ThemedInput label="Contraseña" accessibilityLabel="Contraseña" value={password} onChangeText={setPassword} secureTextEntry={!visible} autoCapitalize="none" autoComplete={register?'new-password':'current-password'} onSubmitEditing={()=>{if(!register)void submit();}} rightIcon={<Pressable accessibilityRole="button" accessibilityLabel={visible?'Ocultar contraseña':'Mostrar contraseña'} onPress={()=>setVisible(!visible)}><Text style={{color:c.lime}}>{visible?'Ocultar':'Ver'}</Text></Pressable>}/>
  {(register||needsProfile)&&<>{register&&<Text style={s.caption}>Mínimo 12 caracteres. Puedes utilizar una frase larga.</Text>}<Pressable accessibilityRole="checkbox" accessibilityState={{checked:adult}} onPress={()=>setAdult(!adult)} style={[s.row,{alignItems:'flex-start'}]}><View style={[s.checkbox,adult&&{backgroundColor:c.lime}]}><Text>{adult?'✓':''}</Text></View><Text style={[s.body,{flex:1}]}>Tengo 18 años o más y acepto las condiciones de participación.</Text></Pressable><Pressable accessibilityRole="link" onPress={()=>router.push('/legal/terminos')}><Text style={{color:c.blue,paddingVertical:6}}>Leer condiciones y privacidad</Text></Pressable></>}
  {noticeBlock}
  <ThemedButton title={needsProfile?'Guardar perfil y entrar':register?'Crear mi cuenta':'Entrar'} loading={busy} onPress={()=>void submit()}/>
  {!register&&<Pressable accessibilityRole="link" onPress={()=>goTo('reset-password')}><Text style={{color:c.blue,textAlign:'center',paddingVertical:10}}>He olvidado mi contraseña</Text></Pressable>}
  <Pressable accessibilityRole="button" onPress={()=>goTo(register?'login':'register')}><Text style={{color:c.text,textAlign:'center',paddingVertical:12}}>{register?'Ya tengo cuenta · Entrar':'No tengo cuenta · Registrarme'}</Text></Pressable>
 </>}
 </View></View></Screen>;
}
