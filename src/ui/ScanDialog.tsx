import React,{useRef,useState} from 'react';
import {Modal,View,Text,TextInput,Platform} from 'react-native';
import {CameraView,useCameraPermissions} from 'expo-camera';
import {Button,s} from './components';
import {colors} from './theme';

export function ScanDialog({close,validate}:{close:()=>void;validate:(token:string)=>Promise<string>}){
  const [permission,requestPermission]=useCameraPermissions();
  const [camera,setCamera]=useState(false),[token,setToken]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const lock=useRef(false);
  async function scan(value:string){
    if(lock.current)return;
    lock.current=true;setBusy(true);setCamera(false);
    try{setNotice(await validate(value));setToken('');}
    catch(e){setNotice((e as Error).message);}
    finally{lock.current=false;setBusy(false);}
  }
  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <View style={s.overlay}><View style={[s.dialog,{padding:24,gap:16}]}>
      <Text style={s.h3}>Control de acceso</Text>
      <Text style={s.body}>Valida el pase de esta competición. Cada inscripción admite un solo acceso.</Text>
      {Platform.OS!=='web'&&<Button secondary disabled={busy} onPress={async()=>{
        const allowed=permission?.granted || (await requestPermission()).granted;
        if(allowed){setNotice('');setCamera(true);}else setNotice('Permiso de cámara denegado. Puedes introducir el código.');
      }}>Abrir cámara</Button>}
      {camera&&<CameraView style={{height:280,width:'100%'}} facing="back" barcodeScannerSettings={{barcodeTypes:['qr']}} onBarcodeScanned={({data})=>scan(data)}/>}
      <Text style={s.caption}>{Platform.OS==='web'?'En web: pega el código del pase o usa un lector QR conectado.':'También puedes introducir el contenido del pase.'}</Text>
      <TextInput accessibilityLabel="Contenido del QR" value={token} onChangeText={setToken} placeholder="rondiqo:…" placeholderTextColor={colors.muted} style={s.input}/>
      {!!notice&&<Text accessibilityRole="alert" style={s.body}>{notice}</Text>}
      <View style={[s.row,{flexWrap:'wrap'}]}><Button disabled={busy||!token} onPress={()=>scan(token)}>Validar código</Button><Button secondary onPress={close}>Cerrar control</Button></View>
    </View></View>
  </Modal>;
}
