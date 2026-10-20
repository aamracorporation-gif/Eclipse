import React from 'react';
import {useIsFocused} from 'expo-router';
import {View,Text,ScrollView} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {router} from 'expo-router';
import {Logo,s,Button} from '@/src/ui/components';
import {colors as c} from '@/src/ui/theme';
import {NotificationBell} from '@/components/NotificationBell';
import {useAuth} from '@/lib/AuthContext';
export function Screen({children,title,back=true}:{children:React.ReactNode;title?:string;back?:boolean}){
 const {user}=useAuth();
 const focused=useIsFocused();if(!focused)return null;
 return <SafeAreaView style={{flex:1,backgroundColor:c.bg}}><View style={{height:76,paddingHorizontal:24,borderBottomWidth:1,borderBottomColor:c.line,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Logo small/><View style={s.row}>{user&&<NotificationBell/>}{back&&<Button secondary small onPress={()=>router.canGoBack()?router.back():router.replace('/welcome')}>Volver</Button>}</View></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{width:'100%',maxWidth:1060,alignSelf:'center',padding:24,paddingBottom:48,gap:20}}>{title&&<Text style={s.title}>{title}</Text>}{children}</ScrollView></SafeAreaView>;
}
