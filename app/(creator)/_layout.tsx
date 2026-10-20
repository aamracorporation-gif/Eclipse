import {Tabs} from 'expo-router';
import {Ionicons} from '@expo/vector-icons';
import {useResponsive} from '@/lib/responsive';
import {colors as c} from '@/src/ui/theme';
export default function Layout(){const {isDesktop}=useResponsive();return <Tabs screenOptions={{headerShown:false,sceneStyle:{backgroundColor:c.bg},tabBarActiveTintColor:c.lime,tabBarInactiveTintColor:c.muted,tabBarLabelStyle:{fontSize:11,fontWeight:'600'},tabBarStyle:isDesktop?{display:'none'}:{backgroundColor:c.surface,borderTopColor:c.line,height:76,paddingTop:7,paddingBottom:12}}}><Tabs.Screen name="dashboard" options={{title:"Panel",tabBarIcon:({color,size})=><Ionicons name="grid-outline" color={typeof color==="string"?color:c.muted} size={size}/>}}/>
<Tabs.Screen name="manage-events" options={{title:"Torneos",tabBarIcon:({color,size})=><Ionicons name="trophy-outline" color={typeof color==="string"?color:c.muted} size={size}/>}}/>
<Tabs.Screen name="calendar" options={{title:"Agenda",tabBarIcon:({color,size})=><Ionicons name="calendar-outline" color={typeof color==="string"?color:c.muted} size={size}/>}}/>
<Tabs.Screen name="scan" options={{title:"Accesos",tabBarIcon:({color,size})=><Ionicons name="qr-code-outline" color={typeof color==="string"?color:c.muted} size={size}/>}}/>
<Tabs.Screen name="organizer-profile" options={{title:"Mi club",tabBarIcon:({color,size})=><Ionicons name="business-outline" color={typeof color==="string"?color:c.muted} size={size}/>}}/>
<Tabs.Screen name="admin-tickets" options={{href:null}}/>
<Tabs.Screen name="admin-verification" options={{href:null}}/>
<Tabs.Screen name="create-event" options={{href:null}}/>
<Tabs.Screen name="discount-codes" options={{href:null}}/>
<Tabs.Screen name="event-discounts" options={{href:null}}/>
<Tabs.Screen name="event-stats/[id]" options={{href:null}}/>
<Tabs.Screen name="global-stats" options={{href:null}}/>
<Tabs.Screen name="index" options={{href:null}}/>
<Tabs.Screen name="registrations" options={{href:null}}/>
<Tabs.Screen name="stats" options={{href:null}}/>
<Tabs.Screen name="verification" options={{href:null}}/>
<Tabs.Screen name="worker-qr" options={{href:null}}/>
<Tabs.Screen name="workers" options={{href:null}}/></Tabs>;}
