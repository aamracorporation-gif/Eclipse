import {Tabs} from 'expo-router';
import {Ionicons} from '@expo/vector-icons';
import {useResponsive} from '@/lib/responsive';
import {colors as c} from '@/src/ui/theme';
export default function Layout(){const {isDesktop}=useResponsive();return <Tabs screenOptions={{headerShown:false,sceneStyle:{backgroundColor:c.bg},tabBarActiveTintColor:c.lime,tabBarInactiveTintColor:c.muted,tabBarLabelStyle:{fontSize:11,fontWeight:'600'},tabBarStyle:isDesktop?{display:'none'}:{backgroundColor:c.surface,borderTopColor:c.line,height:76,paddingTop:7,paddingBottom:12}}}><Tabs.Screen name="discover" options={{title:"Descubrir",tabBarIcon:({color,size})=><Ionicons name="compass-outline" color={typeof color==="string"?color:c.muted} size={size}/>}}/>
<Tabs.Screen name="tickets" options={{title:"Mis pases",tabBarIcon:({color,size})=><Ionicons name="ticket-outline" color={typeof color==="string"?color:c.muted} size={size}/>}}/>
<Tabs.Screen name="teams" options={{title:"Equipos",tabBarIcon:({color,size})=><Ionicons name="people-outline" color={typeof color==="string"?color:c.muted} size={size}/>}}/>
<Tabs.Screen name="agenda" options={{title:"Agenda",tabBarIcon:({color,size})=><Ionicons name="calendar-outline" color={typeof color==="string"?color:c.muted} size={size}/>}}/>
<Tabs.Screen name="profile" options={{title:"Perfil",tabBarIcon:({color,size})=><Ionicons name="person-outline" color={typeof color==="string"?color:c.muted} size={size}/>}}/>
<Tabs.Screen name="event/[id]" options={{href:null}}/>
<Tabs.Screen name="index" options={{href:null}}/>
<Tabs.Screen name="join-worker" options={{href:null}}/>
<Tabs.Screen name="party-map" options={{href:null}}/>
<Tabs.Screen name="resale" options={{href:null}}/></Tabs>;}
