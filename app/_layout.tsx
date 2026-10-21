import 'react-native-url-polyfill/auto';
import React,{Component,type ReactNode} from 'react';
import {Stack} from 'expo-router';
import {View,Text,Platform} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AppStateProvider,useAppState} from '@/lib/AppStateContext';
import {AuthProvider} from '@/lib/AuthContext';
import {WorkspaceProvider} from '@/lib/WorkspaceContext';
import {EventProvider} from '@/lib/EventContext';
import {NotificationProvider} from '@/lib/NotificationContext';
import {FilterProvider} from '@/lib/FilterContext';
import {AppDialogProvider} from '@/components/ui/AppDialog';
import {ThemedButton} from '@/components/ui/ThemedButton';
import {Colors} from '@/constants/Colors';
// Eclipse's root provider tree and error boundary, using the sports services.
class AppErrorBoundary extends Component<{children:ReactNode},{hasError:boolean}>{
 state={hasError:false};static getDerivedStateFromError(){return {hasError:true};}
 render(){return this.state.hasError?<View style={{flex:1,padding:30,justifyContent:'center',backgroundColor:Colors.dark.background,gap:20}}><Text style={{color:Colors.dark.text,fontSize:24}}>No hemos podido abrir esta pantalla.</Text><Text style={{color:Colors.dark.text}}>Recarga la app para recuperar la conexión y la última versión disponible.</Text><ThemedButton title="Recargar app" onPress={()=>{if(Platform.OS==='web')window.location.reload();else this.setState({hasError:false});}}/></View>:this.props.children;}
}
function ConnectionStatus(){
 const {error,refresh}=useAppState();
 return error?<View style={{backgroundColor:'#452825',padding:12,flexDirection:'row',alignItems:'center',gap:10}}><Text accessibilityRole="alert" style={{color:Colors.dark.text,flex:1}}>No se pudo actualizar la conexión. Los datos visibles pueden estar desactualizados.</Text><ThemedButton title="Reintentar" onPress={()=>{void refresh().catch(()=>{});}} style={{width:110,minHeight:40}}/></View>:null;
}
export default function Layout(){return <SafeAreaProvider><StatusBar style="light"/><AppErrorBoundary><AppStateProvider><AuthProvider><WorkspaceProvider><EventProvider><NotificationProvider><FilterProvider><AppDialogProvider><ConnectionStatus/><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:Colors.dark.background}}}/></AppDialogProvider></FilterProvider></NotificationProvider></EventProvider></WorkspaceProvider></AuthProvider></AppStateProvider></AppErrorBoundary></SafeAreaProvider>;}
