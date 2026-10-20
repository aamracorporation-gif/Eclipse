import React,{createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {AppState} from 'react-native';
import {api} from '@/src/api';
import type {Row} from '@/src/domain/model';
const initial:Row={agenda:[],organizer:null,competitions:[],registrations:[],teams:[],organizations:[],orgMembers:[],notifications:[],admin:null,user:null,paymentMode:'simulated'};
const Context=createContext<{state:Row;loading:boolean;error:string;refresh:(force?:boolean)=>Promise<Row>}>({state:initial,loading:true,error:'',refresh:async()=>initial});
export function AppStateProvider({children}:{children:React.ReactNode}){
 const [state,setState]=useState(initial),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const inflight=useRef<Promise<Row>|null>(null),generation=useRef(0);
 const refresh=useCallback((force=false)=>{
  if(inflight.current&&!force)return inflight.current;
  const request=++generation.current;
  const promise=api('/state').then(next=>{if(request===generation.current){setState(next);setError('');}return next;}).catch(e=>{if(request===generation.current)setError(e.message);throw e;}).finally(()=>{if(request===generation.current){setLoading(false);inflight.current=null;}});
  inflight.current=promise;return promise;
 },[]);
 useEffect(()=>{void refresh().catch(()=>{});const sub=AppState.addEventListener('change',status=>{if(status==='active')void refresh().catch(()=>{});});return()=>sub.remove();},[refresh]);
 return <Context.Provider value={{state,loading,error,refresh}}>{children}</Context.Provider>;
}
export const useAppState=()=>useContext(Context);
