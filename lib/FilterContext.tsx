import React,{createContext,useContext,useState} from 'react';
export type FilterState={sport:string;query:string;city:string;level:string;kind:string;maxPrice:string};
const initial={sport:'all',query:'',city:'Sevilla',level:'all',kind:'all',maxPrice:''};
const Context=createContext<{filters:FilterState;update:(patch:Partial<FilterState>)=>void;reset:()=>void}>({filters:initial,update:()=>{},reset:()=>{}});
export function FilterProvider({children}:{children:React.ReactNode}){
 const [filters,setFilters]=useState(initial);
 return <Context.Provider value={{filters,update:patch=>setFilters(previous=>({...previous,...patch})),reset:()=>setFilters(initial)}}>{children}</Context.Provider>;
}
export const useFilters=()=>useContext(Context);
