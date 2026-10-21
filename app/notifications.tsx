import {View,Text} from 'react-native';
import {Screen} from '@/components/rondiqo/Screen';
import {useNotifications} from '@/lib/NotificationContext';
import {useAuth} from '@/lib/AuthContext';
import {s,Button,Empty,Badge} from '@/src/ui/components';
import {useState} from 'react';
import {router} from 'expo-router';
import {useWorkspace} from '@/lib/WorkspaceContext';
import {colors as c} from '@/src/ui/theme';
export default function Notifications(){
 const {notifications,unreadCount,markRead,markAllRead}=useNotifications(),{user}=useAuth(),{space}=useWorkspace();
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function read(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <Screen title="Notificaciones"><Text style={s.body}>Los avisos de tus inscripciones, horarios y resultados aparecen aquí. Primero se muestran los pendientes de leer.</Text>
 {!!error&&<Text accessibilityRole="alert" style={{color:c.danger}}>{error}</Text>}
 {!user?<Empty title="Entra para ver tus avisos" body="Las notificaciones son privadas y están vinculadas a tu cuenta."><Button onPress={()=>router.push({pathname:'/(auth)/login',params:{intent:space}})}>Iniciar sesión</Button></Empty>:<>
 {unreadCount>0&&<View style={[s.row,{flexWrap:'wrap',justifyContent:'space-between'}]}><Text style={s.label}>{unreadCount} sin leer</Text><Button small secondary disabled={busy} onPress={()=>void read(markAllRead)}>Marcar todos como leídos</Button></View>}
 {notifications.length?notifications.map(n=><View key={n.id} style={[s.panel,{gap:12}]}>{!n.read_at&&<Badge>NUEVO</Badge>}<Text style={s.h3}>{n.title}</Text><Text style={s.body}>{n.message}</Text><Text style={s.caption}>{new Date(n.created_at).toLocaleString('es-ES',{timeZone:'Europe/Madrid'})}</Text>{!n.read_at&&<Button small secondary disabled={busy} onPress={()=>void read(()=>markRead(n.id))}>Marcar como leído</Button>}</View>):<Empty title="Todo al día" body="Cuando haya novedades en tus equipos o competiciones aparecerán aquí."/>}
 </>}</Screen>;
}
