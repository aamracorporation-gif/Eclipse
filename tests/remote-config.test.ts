import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/db.ts';

test('remote destination and TLS cannot be overridden by PostgreSQL URL options',async()=>{
  const previous={ALLOW_REMOTE_DATABASE:process.env.ALLOW_REMOTE_DATABASE,REMOTE_PROJECT_REF:process.env.REMOTE_PROJECT_REF};
  const project='zurbdrfmwjqbrscairub';
  const url=`postgresql://rondiqo_backend.${project}:fake@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`;
  try{
    process.env.ALLOW_REMOTE_DATABASE='approved-existing-project';
    process.env.REMOTE_PROJECT_REF=project;
    for(const query of ['ssl=0','sslmode=no-verify','host=unapproved.invalid','user=postgres','sslrootcert=unexpected.crt'])
      await assert.rejects(openDatabase(':memory:',`${url}?${query}`),/without additional connection options/);
    await assert.rejects(openDatabase(':memory:',url.replace('postgresql:','socket:')),/PostgreSQL URL/);
    await assert.rejects(openDatabase(':memory:',url.replace('rondiqo_backend','postgres')),/dedicated RONDIQO/);
    await assert.rejects(openDatabase(':memory:',url.replace('aws-1-eu-central-1.pooler.supabase.com','unapproved.invalid')),/Remote DB disabled/);
    delete process.env.ALLOW_REMOTE_DATABASE;
    await assert.rejects(openDatabase(':memory:',url),/Remote DB disabled/);
  }finally{
    for(const [key,value] of Object.entries(previous))
      if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});
