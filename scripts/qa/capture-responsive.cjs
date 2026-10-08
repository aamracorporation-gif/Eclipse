// Render actual RN Web screens inside a real bottom-tab navigator. No real accounts or network calls.
const fs=require('fs'),path=require('path'),http=require('http'),ts=require('typescript');
const tooling=process.env.ECLIPSE_REVIEW_TOOLS;
if(!tooling)throw Error('Set ECLIPSE_REVIEW_TOOLS to isolated tooling node_modules');
const esbuild=require(path.join(tooling,'esbuild')),{chromium}=require(path.join(tooling,'playwright'));
const out='docs/qa/responsive-review';fs.mkdirSync(out,{recursive:true});
// Extract current production tab styles, so the preview checks the same reserved space as the app.
let generated="import {Colors} from '@/constants/Colors';import {theme} from '@/theme/styles';\n";
for(const [kind,file] of [['creator','app/(creator)/_layout.tsx'],['customer','app/(tabs)/_layout.tsx']]){
 const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),styles=[];
 function walk(n){if(ts.isPropertyAssignment(n)&&n.name.getText(ast)==='tabBarStyle')styles.push(n.initializer.getText(ast));ts.forEachChild(n,walk);}walk(ast);
 generated+=`export const ${kind}TabStyle=(insets:any)=>{const paddingV=6,tabBarHeight=56+insets.bottom;return (${styles.at(-1)});};\n`;
}fs.writeFileSync('scripts/qa/.preview-tabs.ts',generated);
const common=`
const view=new URLSearchParams(location.search).get('view');
export const user={id:'demo-owner',email:'alex@example.invalid',created_at:'2024-01-01T00:00:00Z',user_metadata:{full_name:'Alex García',role:view==='customer'?'attendee':'organizer'}};
export const profile={...user,full_name:'Alex García',first_name:'Alex',last_name:'García',role:user.user_metadata.role,verification_status:'verified',stripe_onboarding_completed:true,stripe_charges_enabled:true,club_name:'Eclipse Club',business_email:'club@example.invalid',instagram_account:'@eclipse',city:'Málaga',country:'España',phone:'+34 600 000 000'};
const event={id:'demo-event',title:'Eclipse: una noche de música electrónica y encuentros en la terraza',event_date:'2027-12-12T22:00:00Z',end_datetime:'2027-12-13T05:00:00Z',creator_id:user.id,venues:{name:'Sala Eclipse'}};
const worker={id:'worker',user_id:user.id,organizer_id:user.id,name:'María García Fernández',email:'maria.garcia@example.invalid',status:'active',created_at:'2026-10-01',permissions:{scan:true,sell:true,stats:true}};
const now=new Date();const sales=[0,2,7].map((days,index)=>{const d=new Date(now);d.setDate(d.getDate()-days);return {id:'sale-'+index,purchase_date:d.toISOString(),total_price:[120,80,300][index],quantity:[6,4,15][index]};});
export const supabase={from(table){let single=false,selection='',offset=0;const chain={select(fields){selection=fields;return chain},eq:()=>chain,in:()=>chain,is:()=>chain,order:()=>chain,gte:()=>chain,limit:()=>chain,range(from){offset=from;return chain},maybeSingle(){single=true;return chain},single(){single=true;return chain},then(resolve){const rows=table==='profiles'?[profile]:table==='workers'?[worker]:table==='worker_event_assignments'?[{events:event}]:table==='events'?[event]:table==='tickets'?offset?[]:sales:table==='event_ticket_types'?[{id:'ticket',name:'Entrada general con una consumición incluida',price:20,quantity:200,sold:10,is_active:true}]:[];return Promise.resolve({data:single?rows[0]??null:rows,error:null,count:rows.length}).then(resolve)}};return chain;},channel(){const c={on:()=>c,subscribe:()=>c};return c},removeChannel:()=>{},rpc:async()=>({data:[],error:null}),auth:{getSession:async()=>({data:{session:{user}}}),getUser:async()=>({data:{user}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
export const auth={user,loading:false,workerProfile:view==='sell'?worker:null,signOut:async()=>{},signIn:async()=>{}};
`;
const mocks={
 '@/lib/supabase':`export {supabase} from 'review-data';`,
 '@/lib/AuthContext':`import {auth} from 'review-data';export const useAuth=()=>auth;`,
 '@/lib/EventContext':`const events={events:[],refreshEvents:async()=>{}};export const useEvents=()=>events;`,
 '@/lib/WalletContext':`export const useCredit=()=>({balance:0,loading:false,refresh:async()=>{}});`,
 '@/lib/I18nContext':`export const useI18n=()=>({language:'es',setLanguage:()=>{},setDeviceLanguage:()=>{}});`,
 '@/lib/edgeFunctions':`export const invokeEdgeFunction=async()=>({data:null,error:null});export const invokeEdgeFunctionStrict=async()=>({});`,
 '@/lib/payments/api':`export const getStripeAccountStats=async()=>({available_balance:0,pending_balance:0,revenue_30d:0});export const createStripeConnectOnboardingLink=async()=>({});export const createStripeConnectAccount=async()=>({});export const refreshStripeConnectStatus=async()=>({});`,
 '@/hooks/useBoxOfficeAccess':`export const useBoxOfficeAccess=()=>({enabled:true,can_sell:true,checking:false});`,
 '@/components/ui/AppDialog':`export const useAppDialog=()=>({showDialog:()=>{}});`,
 '@/lib/notifications':`export const scheduleLocalNotification=async()=>{};export const registerForPushNotifications=async()=>{};`,
 'expo-router':`export {useFocusEffect} from '@react-navigation/native';const routes={push:()=>{},replace:()=>{},back:()=>{},canGoBack:()=>false};export const router=routes;export const useRouter=()=>routes;const segments=['(tabs)','profile'];export const useSegments=()=>segments;`,
 'expo-notifications':`export const requestPermissionsAsync=async()=>({status:'granted'});`,
 'expo-location':`export const requestForegroundPermissionsAsync=async()=>({status:'denied'});export const geocodeAsync=async()=>[];`,
 'expo-haptics':`export const impactAsync=async()=>{};export const notificationAsync=async()=>{};export const selectionAsync=async()=>{};export const ImpactFeedbackStyle={Light:1};export const NotificationFeedbackType={Success:1};`,
 'expo-print':`export const printToFileAsync=async()=>({});`,
 'expo-sharing':`export const shareAsync=async()=>{};`,
 'expo-mail-composer':`export const composeAsync=async()=>{};export const isAvailableAsync=async()=>false;`,
 '@react-native-community/datetimepicker':`export default ()=>null;`,
 '@react-native-async-storage/async-storage':`export default {getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}};`,
};
async function main(){
 await esbuild.build({entryPoints:['scripts/qa/review-responsive.tsx'],bundle:true,outfile:out+'/review.js',platform:'browser',format:'iife',jsx:'automatic',alias:{'react-native':'react-native-web','@':process.cwd()},resolveExtensions:['.web.tsx','.tsx','.web.ts','.ts','.web.js','.js','.json'],define:{'process.env.NODE_ENV':'"production"','process.env.EXPO_OS':'"web"','__DEV__':'false',global:'window'},loader:{'.js':'jsx','.ttf':'file','.png':'file','.jpg':'file'},plugins:[{name:'offline',setup(build){
 build.onResolve({filter:/.*/},args=>args.path==='review-data'||mocks[args.path]?{path:args.path,namespace:'offline'}:undefined);
 build.onLoad({filter:/.*/,namespace:'offline'},args=>({contents:args.path==='review-data'?common:mocks[args.path],loader:'js',resolveDir:process.cwd()}));
 }}]});
 fs.writeFileSync(out+'/index.html','<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;height:100%;width:100%;background:#050510;color:#F8FAFC;font-family:Arial,sans-serif}*{box-sizing:border-box}#root{display:flex}</style><div id="root"></div><script src="./review.js"></script></html>');
 const base=path.resolve(out),server=http.createServer((req,res)=>{const name=path.resolve(base,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!name.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.ttf':'font/ttf','.png':'image/png'})[path.extname(name)]||'application/octet-stream');res.end(fs.readFileSync(name));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true});
 const reports=[];
 try{
 for(const [width,height,inset,fontScale=1] of [[320,568,0],[390,844,34],[844,390,21],[768,1024,20],[320,568,0,1.35]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,locale:'es-ES'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  for(const view of ['customer','organizer','workers','add','sell','dashboard']){
   await page.goto(`http://127.0.0.1:${server.address().port}/?view=${view}&inset=${inset}`);await page.waitForLoadState('networkidle');await page.evaluate(()=>document.fonts.ready);
   if(errors.length)throw Error(view+': '+errors.join('; '));
   if(fontScale>1)await page.evaluate(scale=>{for(const el of document.querySelectorAll('[dir="auto"]')){const computed=getComputedStyle(el);el.style.fontSize=parseFloat(computed.fontSize)*scale+'px';if(computed.lineHeight!=='normal')el.style.lineHeight=parseFloat(computed.lineHeight)*scale+'px';}},fontScale);
   const suffix=fontScale>1?'-large-text':'';
   await page.screenshot({path:`${out}/${view}-${width}${suffix}.png`});
   const bodyWidth=await page.evaluate(()=>document.body.scrollWidth);
   if(bodyWidth>width)throw Error(`${view}: horizontal overflow at ${width}`);
   if(view==='organizer'){
    const remove=page.getByRole('button',{name:'Eliminar mi cuenta y mis datos',exact:true});
    await remove.scrollIntoViewIfNeeded();
    const button=await remove.boundingBox(),tabs=await page.getByRole('tablist').boundingBox();
    if(!button||!tabs||button.y+button.height>tabs.y+1)throw Error('Delete account is covered by tabs');
    await page.screenshot({path:`${out}/organizer-bottom-${width}${suffix}.png`});
   }
   if(view==='workers'){
    const button=await page.getByRole('button',{name:/Añadir trabajador/}).boundingBox(),tabs=await page.getByRole('tablist').boundingBox();
    if(!button||!tabs||button.y+button.height>tabs.y+1)throw Error('Add worker is covered by tabs');
   }
   if(view==='dashboard'){
    await page.getByRole('button',{name:'Hoy',exact:true}).click();
    await page.getByText('Ventas de hoy',{exact:true}).waitFor();
    await page.getByText('120,00 €',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Mes',exact:true}).click();
    await page.getByText('500,00 €',{exact:true}).waitFor();
   }
   reports.push({view,width,height,fontScale,bodyWidth,checks:'passed'});
  }
  await page.close();
 }
 fs.writeFileSync(out+'/layout-results.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));
 const panels=[['customer-390.png','Perfil cliente'],['organizer-390.png','Perfil organizador'],['organizer-bottom-320.png','Acciones visibles'],['sell-320.png','Taquilla sin recortes']];
 fs.writeFileSync(out+'/overview.html',`<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:28px;background:#070713;color:#F8FAFC;font-family:Arial}h1{margin:0 0 8px;font-size:26px}p{color:#A1A1AA;margin:0 0 24px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}h2{font-size:16px;margin:0 0 12px}img{width:100%;border:1px solid #343047;border-radius:16px}</style><h1>Eclipse · Revisión visual</h1><p>Pantallas reales con datos de ejemplo · Vista web para revisión, sin nuevas builds</p><main>${panels.map(([file,title])=>`<section><h2>${title}</h2><img src="${file}"></section>`).join('')}</main>`);
 const overview=await browser.newPage({viewport:{width:1240,height:800},deviceScaleFactor:1});
 await overview.goto(`http://127.0.0.1:${server.address().port}/overview.html`);await overview.screenshot({path:out+'/overview.png',fullPage:true});await overview.close();
 }finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
