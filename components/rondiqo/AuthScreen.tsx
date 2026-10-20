import React,{useState} from 'react';
import {View,Text,Pressable} from 'react-native';
import {router,useLocalSearchParams} from 'expo-router';
import {useAuth} from '@/lib/AuthContext';
import {Screen} from './Screen';
import {ThemedInput} from '@/components/ui/ThemedInput';
import {ThemedButton} from '@/components/ui/ThemedButton';
import {GlassView} from '@/components/ui/GlassView';
import {s,Court,Badge} from '@/src/ui/components';
import {colors as c} from '@/src/ui/theme';
import {useResponsive} from '@/lib/responsive';
import {pathFor} from '@/src/domain/navigation';
export function AuthScreen({register=false}:{register?:boolean}){
 const params=useLocalSearchParams<{intent?:string}>(),intent=params.intent==='organizer'?'organizer':'player';
 const {signIn,signUp}=useAuth(),{isDesktop}=useResponsive();
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[adult,setAdult]=useState(false);
 const [needsProfile,setNeedsProfile]=useState(false);
 const [visible,setVisible]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(){
  setError('');setBusy(true);
  try{
   if((register||needsProfile)&&(!name.trim()||!adult))throw new Error('Indica tu nombre y acepta las condiciones de participación para mayores de 18 años.');
   const next=register?await signUp({name,email,password,adult}):await signIn(email,password,needsProfile?{name,adult}:undefined);
   if(next.verificationRequired){setError(next.message);return;}
   const target=intent==='organizer'||next.organizations.length||next.user?.role==='admin'?'organizer':'player';
   router.replace(pathFor(target,target==='organizer'&&!next.organizations.length?'club':target==='organizer'?'dashboard':'discover') as any);
  }catch(e){if((e as any).code==='CONSENT')setNeedsProfile(true);setError((e as Error).message);}finally{setBusy(false);}
 }
 return <Screen><View style={{flexDirection:isDesktop?'row':'column',gap:40,alignItems:'center',paddingTop:24}}>
 {isDesktop&&<View style={{flex:1,gap:22}}><Badge>UNA CUENTA. TODAS TUS RONDAS.</Badge><Text style={[s.title,{fontSize:52,lineHeight:57}]}>El partido empieza{'\n'}<Text style={{color:c.lime}}>antes de la pista.</Text></Text><Text style={s.body}>Tu equipo, las próximas jornadas y cada competición, siempre a mano.</Text><Court width={360} height={220}/></View>}
 <GlassView intensity={14} style={{flex:1,width:'100%',maxWidth:460}} contentContainerStyle={{padding:28,gap:8}}>
 <Text style={s.eyebrow}>{intent==='organizer'?'TU CLUB. TU PRÓXIMA RONDA.':'HECHO PARA JUGAR'}</Text>
 <Text style={[s.title,{marginBottom:18}]}>{register?'Empieza tu historia.':'Vuelve a la pista.'}</Text>
 {(register||needsProfile)&&<ThemedInput label="Nombre" accessibilityLabel="Nombre" value={name} onChangeText={setName} autoComplete="name"/>}
 <ThemedInput label="Email" accessibilityLabel="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email"/>
 <ThemedInput label="Contraseña" accessibilityLabel="Contraseña" value={password} onChangeText={setPassword} secureTextEntry={!visible} autoCapitalize="none" onSubmitEditing={()=>{if(!register)void submit();}} rightIcon={<Pressable accessibilityRole="button" accessibilityLabel={visible?'Ocultar contraseña':'Mostrar contraseña'} onPress={()=>setVisible(!visible)}><Text style={{color:c.lime}}>{visible?'Ocultar':'Ver'}</Text></Pressable>}/>
 {(register||needsProfile)&&<><Text style={[s.caption,{marginBottom:10}]}>Al menos 12 caracteres. Puedes utilizar una frase larga.</Text><Pressable accessibilityRole="checkbox" accessibilityState={{checked:adult}} onPress={()=>setAdult(!adult)} style={[s.row,{alignItems:'flex-start',marginBottom:16}]}><View style={[s.checkbox,adult&&{backgroundColor:c.lime}]}><Text>{adult?'✓':''}</Text></View><Text style={[s.body,{flex:1}]}>Tengo 18 años o más y acepto las condiciones de participación del piloto.</Text></Pressable><Pressable accessibilityRole="link" onPress={()=>router.push('/legal/terminos')}><Text style={{color:c.blue,marginBottom:14}}>Leer condiciones y privacidad</Text></Pressable></>}
 {!!error&&<Text accessibilityRole="alert" style={{color:c.coral,marginBottom:14,lineHeight:22}}>{error}</Text>}
 <ThemedButton title={register?'Crear mi cuenta':'Entrar'} loading={busy} onPress={()=>{void submit();}}/>
 {!register&&<Pressable accessibilityRole="link" onPress={()=>router.push('/reset-password')}><Text style={{color:c.blue,paddingVertical:14}}>He olvidado mi contraseña</Text></Pressable>}
 <Pressable accessibilityRole="button" onPress={()=>router.replace({pathname:register?'/(auth)/login':'/(auth)/register',params:{intent}})} style={{paddingVertical:20}}><Text style={{color:c.text,textAlign:'center'}}>{register?'Ya tengo cuenta · Entrar':'Crear una cuenta nueva ↗'}</Text></Pressable>
 <Text style={s.caption}>Versión de prueba conectada. Las competiciones de ejemplo son ficticias y los pagos están simulados.</Text>
 </GlassView></View></Screen>;
}
