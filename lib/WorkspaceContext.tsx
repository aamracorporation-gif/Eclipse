import React,{createContext,useCallback,useContext,useEffect,useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {Space} from '@/src/domain/navigation';
type Value={space:Space;ready:boolean;choose:(space:Space)=>void;authEmail:string;setAuthEmail:(email:string)=>void};
const Context=createContext<Value|null>(null);
export function WorkspaceProvider({children}:{children:React.ReactNode}){
 const [space,setSpace]=useState<Space>('player'),[ready,setReady]=useState(false),[authEmail,setAuthEmail]=useState('');
 useEffect(()=>{let active=true;AsyncStorage.getItem('rondiqo-workspace').then(value=>{if(active&&(value==='player'||value==='organizer'))setSpace(value);}).catch(()=>{}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
 const choose=useCallback((next:Space)=>{setSpace(next);void AsyncStorage.setItem('rondiqo-workspace',next).catch(()=>{});},[]);
 return <Context.Provider value={{space,ready,choose,authEmail,setAuthEmail}}>{children}</Context.Provider>;
}
export function useWorkspace(){const value=useContext(Context);if(!value)throw new Error('WorkspaceProvider required');return value;}
