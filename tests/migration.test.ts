import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {URL} from 'node:url';
import {PGlite} from '@electric-sql/pglite';

test('additive migration preserves existing public data and isolates the backend identity',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.eclipse_sentinel(id integer PRIMARY KEY, title text);
      INSERT INTO public.eclipse_sentinel VALUES(1,'Keep original');
      REVOKE ALL ON public.eclipse_sentinel FROM PUBLIC;`);
    const folder=new URL('../supabase/migrations/',import.meta.url);
    const file=(await readdir(folder)).find(x=>x.endsWith('_rondiqo_sports_workspaces.sql'))!;
    for(const migration of (await readdir(folder)).filter(x=>x.endsWith('.sql')&&x.includes('_rondiqo_')).sort())
      await db.exec(await readFile(new URL(migration,folder),'utf8'));
    assert.deepEqual((await db.query('SELECT * FROM public.eclipse_sentinel')).rows,[{id:1,title:'Keep original'}]);
    const {rows}=await db.query<{tables:number;rls:number}>("SELECT count(*)::int tables,count(*) FILTER(WHERE rowsecurity)::int rls FROM pg_tables WHERE schemaname='rondiqo'");
    assert.equal(rows[0].tables,17);assert.equal(rows[0].rls,17);
    for(const role of ['anon','authenticated','service_role']){
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT * FROM rondiqo.profiles'),/permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE rondiqo_backend');
    assert.deepEqual((await db.query('SELECT * FROM rondiqo.profiles')).rows,[]);
    await assert.rejects(db.query('SELECT * FROM public.eclipse_sentinel'),/permission denied/);
    await assert.rejects(db.exec('CREATE TABLE rondiqo.unwanted(id int)'),/permission denied/);
    await db.exec('RESET ROLE');
    await assert.rejects(db.exec(await readFile(new URL(file,folder),'utf8')),/already exists/);
  }finally{await db.close();}
});
