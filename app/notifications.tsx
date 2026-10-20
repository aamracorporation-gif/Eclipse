import {View,Text} from 'react-native';
import {Screen} from '@/components/rondiqo/Screen';
import {useNotifications} from '@/lib/NotificationContext';
import {useAuth} from '@/lib/AuthContext';
import {s,Button,Empty,Badge} from '@/src/ui/components';
import {useState} from 'react';
export default function Notifications(){const {notifications,markRead}=useNotifications(),{user}=useAuth();const [error,setError]=useState('');return <Screen title="Lo que pasa en tu ronda."><Text style={s.body}>Inscripciones, horarios, resultados y novedades de tus competiciones.</Text>{!!error&&<Text accessibilityRole="alert" style={{color:'#FF8D75'}}>{error}</Text>}{!user?<Empty title="Entra para ver tus avisos" body="Los avisos son privados y están vinculados a tu cuenta."/>:notifications.length?notifications.map(n=><View key={n.id} style={[s.panel,{gap:12}]}>{!n.read_at&&<Badge>NUEVO</Badge>}<Text style={s.h3}>{n.title}</Text><Text style={s.body}>{n.message}</Text><Text style={s.caption}>{new Date(n.created_at).toLocaleString('es-ES',{timeZone:'Europe/Madrid'})}</Text>{!n.read_at&&<Button small secondary onPress={()=>{void markRead(n.id).catch(e=>setError(e.message));}}>Marcar como leído</Button>}</View>):<Empty title="Todo al día" body="Cuando haya novedades en tus equipos o competiciones aparecerán aquí."/>}</Screen>;}
