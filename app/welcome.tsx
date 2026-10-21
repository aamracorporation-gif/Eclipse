import {useWorkspace} from '@/lib/WorkspaceContext';
import {View,Text} from 'react-native';
import {router} from 'expo-router';
import {Screen} from '@/components/rondiqo/Screen';
import {s,Button,Court,Badge} from '@/src/ui/components';
import {colors as c} from '@/src/ui/theme';
import {useResponsive} from '@/lib/responsive';
import {useAppState} from '@/lib/AppStateContext';
import {useAuth} from '@/lib/AuthContext';
import {pathFor} from '@/src/domain/navigation';
export default function Welcome(){
 const {state}=useAppState(),{choose}=useWorkspace();
 const {isDesktop}=useResponsive(),{user}=useAuth();
 const enter=(intent:'player'|'organizer')=>{choose(intent);user?router.push(pathFor(intent,intent==='player'?'home':'dashboard') as any):router.push({pathname:'/(auth)/login',params:{intent}});};
 return <Screen back={false}><View style={{flexDirection:isDesktop?'row':'column',alignItems:'center',gap:24,paddingVertical:36}}><View style={{flex:1,gap:24}}><Badge>SEVILLA · PÁDEL + FÚTBOL 7</Badge><Text style={[s.title,{fontSize:isDesktop?64:44,lineHeight:isDesktop?68:49}]}>Menos «a ver si».{'\n'}<Text style={{color:c.lime}}>Más equipo.{'\n'}Más juego.</Text></Text><Text style={[s.body,{fontSize:17,lineHeight:27,maxWidth:530}]}>Encuentra tu próxima competición, reúne a tu equipo y haz que cada jornada cuente.</Text><View style={[s.row,{flexWrap:'wrap'}]}><Button onPress={()=>enter('player')}>Quiero jugar ↗</Button><Button secondary onPress={()=>enter('organizer')}>Quiero organizar</Button></View><Button secondary small onPress={()=>router.push(pathFor('player','discover') as any)}>Explorar competiciones</Button></View><Court width={isDesktop?410:300} height={isDesktop?270:180}/></View><View style={[s.row,{flexWrap:'wrap',alignItems:'stretch'}]}>{[['01','Tu equipo, conectado','Parejas de pádel y plantillas de fútbol 7. Invitaciones y plazas en un mismo lugar.'],['02','Cada jornada, al día','Calendario, cuadro, resultados y clasificación para saber cuándo te toca.'],['03','Tú haces que pase','Publica competiciones, gestiona inscritos y valida los accesos con QR.']].map(([n,title,body])=><View key={n} style={[s.panel,{flex:1,minWidth:240,gap:12}]}><Text style={s.eyebrow}>{n}</Text><Text style={s.h3}>{title}</Text><Text style={s.body}>{body}</Text></View>)}</View>{state.release==='local'&&<Text style={[s.caption,{marginTop:15}]}>Prueba con cuentas ficticias: jugador@rondiqo.test u organiza@rondiqo.test · Contraseña: RondaLocal2026! · Pagos simulados.</Text>}</Screen>;
}
