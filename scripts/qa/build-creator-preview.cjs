// QA-only copy of the actual screen. External effects are replaced with explicit demo services.
const fs = require('node:fs');
const ts = require('typescript');
let source = fs.readFileSync('app/(creator)/create-event.tsx','utf8').replaceAll('\r\n','\n');
const ast = ts.createSourceFile('creator.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const isolated = ['expo-router','expo-image-picker','expo-location','react-native-webview','react-native-safe-area-context','@/lib/AuthContext','@/lib/EventContext','@/lib/supabase','@/lib/storage'];
const edits = [];
for (const node of ast.statements) if (ts.isImportDeclaration(node) && isolated.includes(node.moduleSpecifier.text)) edits.push([node.getFullStart(),node.end,'']);
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast)==='searchGeocode') edits.push([node.initializer.getStart(ast),node.initializer.end,"useCallback(async (query: string) => query.length < 3 ? [] : [{id:'demo-location',name:'Sala Eclipse · Málaga (ejemplo)',lat:36.7213,lng:-4.4214}],[])"]);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast)==='chooseImageSource') edits.push([node.initializer.getStart(ast),node.initializer.end,"useCallback((field: 'imageUri' | 'venuePlanUri') => updateDraft(field, new URL('./customer-orbit.png', window.location.href).href),[updateDraft])"]);
  ts.forEachChild(node,visit);
} visit(ast);
for (const [start,end,replacement] of edits.sort((a,b)=>b[0]-a[0])) source=source.slice(0,start)+replacement+source.slice(end);
source=source.replace('  Alert,\n','');
source=source.replace("const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY || '';", "const MAPTILER_KEY = ''; // Map is simulated in this preview.");
source=source.replace('export default function CreateEventScreen()',"export default function DemoCreator({ editing = false }: {editing?: boolean})");
source=source.replace("const params = useLocalSearchParams<{ id?: string; isEditing?: string }>();", "const params = {id: editing ? 'demo-event' : undefined};");
source=source.replace("Alert.alert('Evento actualizado', 'Los cambios se han guardado correctamente.', [{ text: 'OK', onPress: safeBack }]);", "setFormNotice('Simulación completada: cambios validados. No se ha modificado ningún evento real.');");
source=source.replace("Alert.alert('Evento creado', 'El evento se ha creado correctamente.', [{ text: 'OK', onPress: safeBack }]);", "setFormNotice('Simulación completada: evento validado. No se ha publicado ningún evento real.');");
const stubs = `
const SafeAreaView = View, useSafeAreaInsets = () => ({top:0,bottom:0,left:0,right:0});
const demoRouter = {back:()=>{},replace:()=>{},canGoBack:()=>false}, useRouter = () => demoRouter;
const demoUser = {id:'demo-organizer'}, useAuth = () => ({user:demoUser});
const demoEvents = {addEvent:async()=>{},updateEvent:async()=>{}}, useEvents = () => demoEvents;
const Alert = {alert:()=>{}}, uploadImage = async (uri:string) => uri;
const ImagePicker = {requestCameraPermissionsAsync:async()=>({status:'denied'}),requestMediaLibraryPermissionsAsync:async()=>({status:'denied'})};
const Location = {requestForegroundPermissionsAsync:async()=>({status:'denied'}),reverseGeocodeAsync:async()=>[{street:'Sala Eclipse',city:'Málaga (ejemplo)'}]};
const WebView = React.forwardRef((props:any,ref:any)=><View style={{padding:24}}><Text style={{color:Colors.dark.text,marginBottom:16}}>Mapa simulado. En la app puedes buscar y fijar la ubicación real.</Text><ThemedButton title="Marcar ubicación de ejemplo" onPress={()=>props.onMessage({nativeEvent:{data:JSON.stringify({type:'pinDrop',lat:36.7213,lng:-4.4214})}})}/></View>);
const supabase = {from:()=>({select:()=>({eq:()=>({single:async()=>({data:{title:'Eclipse After Dark',description:'House, pista abierta y una noche para compartir.',event_date:'2026-12-12T22:30:00Z',end_datetime:'2026-12-13T05:00:00Z',poster_url:new URL('./customer-orbit.png',window.location.href).href,theme:'House',age_restriction:18,event_type:'party',venues:{name:'Sala Eclipse · Málaga (ejemplo)',latitude:36.7213,longitude:-4.4214},event_ticket_types:[{id:'demo-ticket',name:'Entrada + consumición',price:20,quantity:100,sold:20,category:'general',metadata:{includedDrinks:1}}],reservados_vip:[{id:'demo-table',name:'Mesa Eclipse',base_price:300,quantity_available:0,capacity_people:6,included_bottles:1}]}})})})})};
`;
fs.writeFileSync('scripts/qa/.preview-creator.tsx','// @ts-nocheck\n// Generated from the real screen; map, uploads, identity and publication are demo-only.\n'+source+'\n'+stubs);
console.log('Creator preview generated with isolated demo effects.');
