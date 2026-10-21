import test from 'node:test';
import assert from 'node:assert/strict';
import {Auth} from '../server/auth.ts';
import {openDatabase} from '../server/db.ts';
import {pathFor,competitionPath,sectionFor,spaceTabs,safeReturnPath} from '../src/domain/navigation.ts';
import {TERMS_VERSION} from '../src/domain/model.ts';

test('player and organizer destinations stay separate, including profiles and competition details',()=>{
 for(const space of ['player','organizer'] as const){
  const prefix=space==='player'?'/jugador/':'/organizador/';
  assert.equal(spaceTabs(space).length,5);
  const paths=spaceTabs(space).map(tab=>pathFor(space,tab.id));
  assert.equal(new Set(paths).size,5);
  for(const path of paths)assert.ok(path.startsWith(prefix));
  assert.ok(pathFor(space,'profile').startsWith(prefix));
  assert.ok(competitionPath(space,'a0000000-0000-4000-8000-000000000001').startsWith(prefix+'competicion/'));
 }
 assert.equal(sectionFor('player','inscripciones'),'activity');
 assert.equal(sectionFor('organizer','inscripciones'),'registrations');
 assert.equal(sectionFor('player','descubrir'),'discover');
 assert.equal(pathFor('player','unknown'),'/jugador/inicio');
});

test('login continuation rejects external, other-space and encoded redirect targets',()=>{
 for(const value of ['https://evil.invalid','//evil.invalid','/organizador/panel','/jugador/../admin','/jugador/%2f%2fevil.invalid','/jugador/inicio?redirect=https://evil.invalid']){
  assert.equal(safeReturnPath(value,'player'),'/jugador/inicio');
 }
 assert.equal(safeReturnPath('/jugador/competicion/a0000000-0000-4000-8000-000000000001','player'),'/jugador/competicion/a0000000-0000-4000-8000-000000000001');
});

test('confirmation resend protects account existence, reports provider outage and rate limit, and never creates a session',async()=>{
 const db=await openDatabase(':memory:'),auth=new Auth(db,'supabase','https://example.supabase.co','public-test-key',{allowDemo:false,origin:'https://app.example.com'});
 try{
  let error:any=null;
  auth.remote=()=>({auth:{resend:async(input:any)=>{
   assert.equal(input.type,'signup');assert.equal(input.email,'player@example.com');assert.equal(input.options.emailRedirectTo,'https://app.example.com/login');return {error};
  }}} as any);
  const pending=await auth.resendConfirmation('Player@Example.com');
  for(const code of ['user_not_found','email_address_invalid','email_already_confirmed']){error={status:400,code};assert.deepEqual(await auth.resendConfirmation('player@example.com'),pending);}
  error={status:429};await assert.rejects(auth.resendConfirmation('player@example.com'),(e:any)=>e.status===429&&e.code==='EMAIL_RATE_LIMIT');
  error={status:500};await assert.rejects(auth.resendConfirmation('player@example.com'),(e:any)=>e.status===503&&e.code==='EMAIL_UNAVAILABLE');
  assert.equal((await db.query('SELECT * FROM rondiqo.sessions')).rows.length,0);
 }finally{await db.close();}
});

test('signup delivery failures do not look like successful registration and unconfirmed login has a recoverable state',async()=>{
 const db=await openDatabase(':memory:'),auth=new Auth(db,'supabase','https://example.supabase.co','public-test-key',{allowDemo:false});
 try{
  auth.remote=()=>({auth:{signUp:async()=>({error:{status:500}})}} as any);
  await assert.rejects(auth.register({email:'new@example.com',name:'New Player',password:'A long valid password!',adult:true,terms_version:TERMS_VERSION}),(e:any)=>e.code==='EMAIL_UNAVAILABLE');
  auth.remote=()=>({auth:{signInWithPassword:async()=>({data:{user:null},error:{code:'email_not_confirmed',status:400}})}} as any);
  await assert.rejects(auth.login('new@example.com','A long valid password!'),(e:any)=>e.code==='EMAIL_NOT_CONFIRMED');
 }finally{await db.close();}
});
