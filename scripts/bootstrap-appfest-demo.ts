if(process.env.RELEASE_MODE&&process.env.RELEASE_MODE!=='local')throw new Error('Demo seed is disabled outside local mode.');
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {openDatabase,one} from '../server/db.ts';
import type {Row} from '../src/domain/model.ts';

// Explicit, one-time import of the existing fictional pilot into an empty private
// schema. Stop the local server first: PGlite must have a single process owner.
if(process.env.REMOTE_PROJECT_REF!=='zurbdrfmwjqbrscairub' ||
   process.env.REMOTE_DEMO_BOOTSTRAP!=='approved-empty-rondiqo' || !process.env.DATABASE_URL)
  throw new Error('Only the approved empty RONDIQO schema in AppFest is supported.');
const tables=['profiles','credentials','organizations','org_members','teams','team_members',
  'competitions','registrations','matches','audit','notifications','webhook_events','idempotency','refunds'] as const;
const allowedEmails=new Set(['admin','organiza','jugador','pareja','lola','dani','cris','nico','sam','vera','arbitro','acceso','capitan','rival',
  ...[0,1].flatMap(t=>[1,2,3,4,5,6].map(n=>`futbol${t}-${n}`))].map(x=>`${x}@rondiqo.test`));
const source=await openDatabase(),destination=await openDatabase(':memory:',process.env.DATABASE_URL);
try{
  const rows:Record<string,Row[]>={};
  for(const table of tables)rows[table]=(await source.query(`SELECT * FROM rondiqo.${table}`)).rows;
  assert.equal(rows.profiles.length,26,'Expected the known fictional pilot only.');
  assert.ok(rows.profiles.every(p=>allowedEmails.has(p.email)));
  assert.ok(rows.registrations.every(r=>['free','simulated'].includes(r.provider)));
  assert.ok(rows.organizations.every(o=>o.stripe_account===null));
  const counts=Object.fromEntries(tables.map(t=>[t,rows[t].length]));
  await destination.transaction(async tx=>{
    for(const table of [...tables,'sessions'])
      assert.equal((await one(tx,`SELECT count(*)::int n FROM rondiqo.${table}`))?.n,0,`Refusing to modify nonempty table ${table}.`);
    for(const table of tables)if(rows[table].length)
      await tx.query(`INSERT INTO rondiqo.${table} SELECT * FROM jsonb_populate_recordset(NULL::rondiqo.${table},$1::jsonb)`,[JSON.stringify(rows[table])]);
  });
  const evidence={checkedAt:new Date().toISOString(),project:'zurbdrfmwjqbrscairub',fictionalDataOnly:true,
    sessionsCopied:0,existingEclipseDataImported:false,counts};
  await writeFile('evidence/appfest-demo-bootstrap.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
}finally{await source.close();await destination.close();}
