import React,{useEffect} from 'react';
import {View,Text,Pressable,ScrollView,StyleSheet,RefreshControl} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {router} from 'expo-router';
import {Ionicons} from '@expo/vector-icons';
import {Logo,Button,s} from '@/src/ui/components';
import {colors as c} from '@/src/ui/theme';
import {pathFor,spaceTabs,sectionLabel,type Space} from '@/src/domain/navigation';
import {useWorkspace} from '@/lib/WorkspaceContext';
import {useResponsive} from '@/lib/responsive';
import {useAuth} from '@/lib/AuthContext';
import {NotificationBell} from '@/components/NotificationBell';

export function WorkspaceShell({space,section,detail=false,children,onRefresh,refreshing=false}:{space:Space;section:string;detail?:boolean;children:React.ReactNode;onRefresh:()=>void;refreshing?:boolean}){
 const {isDesktop}=useResponsive(),{user}=useAuth(),{choose}=useWorkspace();
 const organizer=space==='organizer',accent=organizer?c.blue:c.lime;
 useEffect(()=>choose(space),[space,choose]);
 const tabs=spaceTabs(space),selected=section==='calendar'&&!organizer?'activity':section;
 const switchSpace=()=>{const next=organizer?'player':'organizer';choose(next);router.replace(pathFor(next,next==='player'?'home':'dashboard') as any);};
 const navigate=(id:string)=>router.replace(pathFor(space,id) as any);
 const login=()=>router.push({pathname:'/(auth)/login',params:{intent:space}});
 const tab=(item:typeof tabs[number],mobile=false)=><Pressable key={item.id} accessibilityRole="tab" accessibilityState={{selected:selected===item.id&&!detail}} accessibilityLabel={item.label} onPress={()=>navigate(item.id)} style={[mobile?styles.bottomItem:styles.sideItem,selected===item.id&&!detail&&!mobile&&{backgroundColor:accent+'14'}]}>
  <Ionicons name={item.icon as any} color={selected===item.id&&!detail?accent:c.muted} size={mobile?22:20}/><Text numberOfLines={1} style={{fontSize:mobile?10:14,color:selected===item.id&&!detail?accent:c.muted,fontWeight:'700'}}>{item.label}</Text>
 </Pressable>;
 return <SafeAreaView style={styles.root} edges={['top','left','right','bottom']}><View style={styles.row}>
  {isDesktop&&<View style={styles.sidebar}><Logo/><Text style={[s.eyebrow,{color:accent,marginTop:22,marginBottom:24}]}>{organizer?'Organizador':'Jugador'}</Text><View style={{gap:8}}>{tabs.map(item=>tab(item))}</View><View style={{flex:1}}/>{organizer&&<Button secondary small onPress={()=>navigate('profile')}>Mi cuenta</Button>}<View style={{marginTop:16}}><Button secondary small onPress={switchSpace}>{organizer?'Cambiar a jugador':'Cambiar a organizador'}</Button></View></View>}
  <View style={{flex:1,minWidth:0}}><View style={[styles.header,{paddingHorizontal:isDesktop?32:18}]}>
   <View style={{flex:1,gap:3}}>{isDesktop?<Text style={s.h3}>{detail?'Competición':sectionLabel(space,section)}</Text>:<Logo small/>}<Text style={[s.caption,{color:accent}]}>{organizer?'Espacio organizador':'Espacio jugador'}</Text></View>
   <View style={[s.row,{gap:14}]}>{user&&<NotificationBell/>}{!isDesktop&&<Pressable accessibilityRole="button" accessibilityLabel={organizer?'Cambiar a jugador':'Cambiar a organizador'} onPress={switchSpace} style={styles.switch}><Ionicons name="swap-horizontal-outline" size={18} color={accent}/><Text style={{color:accent,fontSize:11,fontWeight:'700'}}>Cambiar</Text></Pressable>}{user?<Pressable accessibilityRole="button" accessibilityLabel="Mi cuenta" onPress={()=>navigate('profile')} style={[styles.avatar,{backgroundColor:accent+'18'}]}><Text style={{color:accent,fontWeight:'800'}}>{user.name?.slice(0,1)?.toUpperCase()}</Text></Pressable>:<Button small onPress={login}>Entrar</Button>}</View>
  </View><ScrollView key={`${space}-${section}-${detail}`} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent}/>} contentContainerStyle={{padding:isDesktop?32:18,paddingBottom:32,maxWidth:1240,width:'100%',alignSelf:'center',flexGrow:1}}>{children}</ScrollView></View>
 </View>{!isDesktop&&<View accessibilityRole="tablist" style={styles.bottom}>{tabs.map(item=>tab(item,true))}</View>}</SafeAreaView>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:c.bg},row:{flex:1,flexDirection:'row'},sidebar:{width:238,padding:24,borderRightWidth:1,borderRightColor:c.line,backgroundColor:'#101e20'},sideItem:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:13,paddingVertical:15,borderRadius:12},header:{minHeight:78,paddingVertical:12,borderBottomWidth:1,borderBottomColor:c.line,flexDirection:'row',alignItems:'center',gap:12},avatar:{width:36,height:36,borderRadius:12,alignItems:'center',justifyContent:'center'},switch:{alignItems:'center',gap:2,padding:5,minWidth:48,minHeight:44},bottom:{flexDirection:'row',backgroundColor:c.surface,borderTopWidth:1,borderTopColor:c.line,paddingTop:8,paddingBottom:5},bottomItem:{flex:1,minWidth:0,minHeight:51,alignItems:'center',justifyContent:'center',gap:4,paddingHorizontal:2}});
