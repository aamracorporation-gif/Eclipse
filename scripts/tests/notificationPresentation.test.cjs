const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function harness({platform='ios',permission={status:'granted',canAskAgain:true},user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}={}){
 let handler, currentUser=user;const calls=[];
 const notifications={
  AndroidImportance:{HIGH:4,DEFAULT:3},
  setNotificationHandler:value=>{handler=value},
  setNotificationChannelAsync:async id=>{calls.push('channel:'+id)},
  getPermissionsAsync:async()=>permission,
  requestPermissionsAsync:async()=>{calls.push('prompt');return {status:'granted',canAskAgain:true}},
  getExpoPushTokenAsync:async()=>{calls.push('token');return {data:'ExponentPushToken[unit-test-device-only]'}},
  dismissAllNotificationsAsync:async()=>{},setBadgeCountAsync:async()=>{},clearLastNotificationResponseAsync:async()=>{},
 };
 const supabase={auth:{getSession:async()=>({data:{session:currentUser?{user:{id:currentUser}}:null}})},rpc:async(name,args)=>{calls.push(name);return {data:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',error:null}}};
 const modules={
  'expo-notifications':notifications,'react-native':{Platform:{OS:platform}},
  'expo-constants':{default:{easConfig:{projectId:'42ebb6eb-62b1-4784-a483-831ae3c804f2'}}},
  '@react-native-async-storage/async-storage':{default:{getItem:async()=>null,setItem:async()=>{calls.push('stored')}}},
  '@/lib/supabase':{supabase},
  './notificationNavigation':{NOTIFICATION_UUID:/^[0-9a-f-]{36}$/i},
 };
 const compiled=ts.transpileModule(fs.readFileSync('lib/notifications.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:false}}).outputText;
 const exports={};vm.runInNewContext(compiled,{exports,require:name=>{if(!modules[name])throw Error('Unexpected dependency '+name);return modules[name]},process:{env:{}},Map,Promise,JSON,Error});
 return {api:exports,calls,user,handler:()=>handler,setUser:value=>{currentUser=value}};
}
test('incoming remote push requests an OS banner, notification center entry, sound and badge',async()=>{
 const h=harness();await h.api.initNotifications();
 assert.deepEqual(JSON.parse(JSON.stringify(await h.handler().handleNotification({}))),{shouldPlaySound:true,shouldSetBadge:true,shouldShowBanner:true,shouldShowList:true});
});
test('Android channels exist before getting and saving the device token',async()=>{
 const h=harness({platform:'android'});assert.equal(await h.api.registerForPushNotifications(h.user),'registered');
 assert.ok(h.calls.indexOf('channel:eclipse-activity')<h.calls.indexOf('token'));
 assert.ok(h.calls.indexOf('channel:eclipse-reminders')<h.calls.indexOf('token'));
 assert.ok(h.calls.includes('register_notification_installation_v2'));
});
test('denied permissions do not register a token or prompt silently',async()=>{
 const h=harness({permission:{status:'denied',canAskAgain:false}});
 assert.equal(await h.api.registerForPushNotifications(h.user),'denied');
 assert.deepEqual(h.calls,[]);
});
test('explicit activation requests permission before registering',async()=>{
 const h=harness({permission:{status:'undetermined',canAskAgain:true}});
 assert.equal(await h.api.registerForPushNotifications(h.user,true),'registered');
 assert.ok(h.calls.indexOf('prompt')<h.calls.indexOf('token'));
});
test('stale user never registers another account device',async()=>{
 const h=harness();h.setUser('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 assert.equal(await h.api.registerForPushNotifications(h.user),'session-changed');
 assert.deepEqual(h.calls,[]);
});
test('web registration does not request a native token',async()=>{
 const h=harness({platform:'web'});assert.equal(await h.api.registerForPushNotifications(h.user),'unsupported');assert.deepEqual(h.calls,[]);
});
