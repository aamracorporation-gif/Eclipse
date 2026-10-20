import React,{createContext,useContext} from 'react';
import {useAppState} from './AppStateContext';
import {command} from '@/src/api';
import type {Row} from '@/src/domain/model';
const Context=createContext<{notifications:Row[];unreadCount:number;markRead:(id:string)=>Promise<void>}|null>(null);
export function NotificationProvider({children}:{children:React.ReactNode}){
 const {state,refresh}=useAppState();
 return <Context.Provider value={{notifications:state.notifications,unreadCount:state.notifications.filter((n:Row)=>!n.read_at).length,markRead:async id=>{await command('notification.read',{id});await refresh(true);}}}>{children}</Context.Provider>;
}
export function useNotifications(){const value=useContext(Context);if(!value)throw new Error('NotificationProvider required');return value;}
