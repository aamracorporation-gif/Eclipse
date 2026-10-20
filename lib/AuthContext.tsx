// Eclipse AuthProvider adapted to sports API roles, always decided by the server.
import React,{createContext,useContext} from 'react';
import {useAppState} from './AppStateContext';
import {api,logout} from '@/src/api';
import {TERMS_VERSION} from '@/src/domain/model';
import type {Row} from '@/src/domain/model';
type AuthValue={user:Row|null;loading:boolean;organizations:Row[];isAdmin:boolean;isOrganizer:boolean;signIn:(email:string,password:string,profile?:Row)=>Promise<Row>;signUp:(data:Row)=>Promise<Row>;signOut:()=>Promise<void>};
const Context=createContext<AuthValue|null>(null);
export function AuthProvider({children}:{children:React.ReactNode}){
 const {state,loading,refresh}=useAppState();
 const signIn=async(email:string,password:string,profile?:Row)=>{await api('/auth/login',{email,password,profile:profile?{...profile,terms_version:TERMS_VERSION}:undefined});return refresh(true);};
 const signUp=async(data:Row)=>{const result=await api('/auth/register',{...data,terms_version:TERMS_VERSION});return result.verificationRequired?result:refresh(true);};
 const signOut=async()=>{await logout();await refresh(true);};
 return <Context.Provider value={{user:state.user,loading,organizations:state.organizations,isAdmin:state.user?.role==='admin',isOrganizer:state.organizations.length>0,signIn,signUp,signOut}}>{children}</Context.Provider>;
}
export function useAuth(){const value=useContext(Context);if(!value)throw new Error('AuthProvider required');return value;}
