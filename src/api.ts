import {Platform} from 'react-native';
import * as SecureStore from 'expo-secure-store';
const native=Platform.OS!=='web',storageKey='rondiqo-session-v1';
let token:string|undefined,loaded=false;
export const base=native?(process.env.EXPO_PUBLIC_API_URL||'http://127.0.0.1:4173'):'';
async function saveToken(value?:string){token=value;if(native){if(value)await SecureStore.setItemAsync(storageKey,value,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});else await SecureStore.deleteItemAsync(storageKey);}}
export async function api(path:string,body?:unknown,idempotency?:string){
 if(native&&!loaded){token=(await SecureStore.getItemAsync(storageKey))||undefined;loaded=true;}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await fetch(`${base}/api${path}`,{method:body===undefined?'GET':'POST',credentials:native?'omit':'include',signal:controller.signal,
   headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(native?{'X-Rondiqo-Client':'native'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();
  if(!response.ok){if(response.status===401)await saveToken();throw Object.assign(new Error(data.error||'No se pudo completar la operación.'),{code:data.code});}
  if(native&&data.token)await saveToken(data.token);
  return data;
 }catch(e){if((e as Error).name==='AbortError')throw new Error('La conexión está tardando. Comprueba tu conexión y vuelve a intentarlo.');throw e;}
 finally{clearTimeout(timer);}
}
export async function logout(){try{await api('/auth/logout',{});}finally{await saveToken();}}
export const command=(action:string,input:unknown)=>api('/command',{action,input},`${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
