// Eclipse event provider now represents sports competitions.
import React,{createContext,useContext} from 'react';
import {useAppState} from './AppStateContext';
import {command} from '@/src/api';
import type {Row} from '@/src/domain/model';
const Context=createContext<{events:Row[];loading:boolean;refreshEvents:()=>Promise<Row>;createCompetition:(input:Row)=>Promise<Row>}|null>(null);
export function EventProvider({children}:{children:React.ReactNode}){
 const {state,loading,refresh}=useAppState();
 return <Context.Provider value={{events:state.competitions,loading,refreshEvents:refresh,createCompetition:async input=>{const result=await command('competition.create',input);await refresh(true);return result;}}}>{children}</Context.Provider>;
}
export function useEvents(){const value=useContext(Context);if(!value)throw new Error('EventProvider required');return value;}
