'use strict';
// A real Postgres engine for financial-service tests. The small query adapter
// executes SQL; it does not fake RPC results, constraints, locks or balances.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const ident = name => { if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw Error('Invalid test SQL identifier'); return '"'+name+'"'; };
async function cancellationDatabase() {
  const pg = new PGlite();
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA private; CREATE SCHEMA notification_private;
    CREATE TABLE notification_private.deliveries(notification_id uuid,status text,updated_at timestamptz);
    CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text,data jsonb);
    CREATE FUNCTION notification_private.emit(uuid,text,text,text,text,text,jsonb,text,text,text[],timestamptz)
      RETURNS void LANGUAGE sql AS 'INSERT INTO notifications(user_id,type,data) VALUES($1,$3,$7)';
    CREATE TABLE profiles(id uuid PRIMARY KEY,role text,email text,is_suspended boolean DEFAULT false);
    CREATE TABLE events(id uuid PRIMARY KEY,creator_id uuid,event_date timestamptz,end_datetime timestamptz,status text DEFAULT 'scheduled',
      is_cancelled boolean DEFAULT false,cancelled_at timestamptz,cancellation_reason text);
    CREATE TABLE payment_transactions(id uuid PRIMARY KEY,user_id uuid,kind text,currency text,amount_cents int,platform_fee_cents int,
      stripe_payment_intent_id text,metadata jsonb,status text,destination_amount_cents int,destination_account_id text,
      protected_event_id uuid GENERATED ALWAYS AS ((metadata->>'event_id')::uuid) STORED);
    CREATE TABLE tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid,status text,ticket_status text);
    GRANT SELECT,INSERT,UPDATE ON events,payment_transactions,tickets,profiles TO service_role;`);
  await pg.exec(fs.readFileSync(path.join(__dirname,'../../../supabase/migrations/20261014001706_organizer_deferred_cancellation_billing.sql'),'utf8'));
  const db = { pg, close: () => pg.close(), async rpc(name, args) {
    try { const keys=Object.keys(args); const r=await pg.query(`SELECT ${ident(name)}(${keys.map((k,i)=>ident(k)+'=> $'+(i+1)).join(',')}) result`,Object.values(args)); return {data:r.rows[0].result,error:null}; }
    catch(error) { return { data:null,error }; }
  }, from(table) {
    let operation='select',payload,conflict,one=false,columns='*',start=0,count,sort=[]; const filters=[];
    const q={ select(c='*'){columns=c;return q;},insert(p){operation='insert';payload=p;return q;},
      upsert(p,options={}){operation='upsert';payload=p;conflict=options;return q;},update(p){operation='update';payload=p;return q;},
      eq(k,v){filters.push([k,'=',v]);return q;},neq(k,v){filters.push([k,'<>',v]);return q;},is(k,v){filters.push([k,'IS',v]);return q;},
      in(k,v){filters.push([k,'IN',v]);return q;},order(k,opts={}){sort.push([k,opts.ascending!==false]);return q;},
      limit(n){count=n;return q;},range(a,b){start=a;count=b-a+1;return q;},single(){one=true;return execute();},maybeSingle(){one=true;return execute();},
      then(resolve,reject){return execute().then(resolve,reject);}};
    async function execute() {
      try {
        const values=[], bind=v=>{values.push(v);return '$'+values.length;};
        const field=k=>k.includes('.')?'j.'+ident(k.split('.')[1]):'r.'+ident(k);
        const where=()=>filters.length?' WHERE '+filters.map(([k,op,v])=>op==='IS'?`${field(k)} IS NULL`:op==='IN'?`${field(k)} = ANY(${bind(v)})`:`${field(k)} ${op} ${bind(v)}`).join(' AND '):'';
        let sql;
        if(operation==='insert'||operation==='upsert') {
          const keys=Object.keys(payload);sql=`INSERT INTO ${ident(table)} AS r (${keys.map(ident).join(',')}) VALUES (${keys.map(k=>bind(payload[k])).join(',')})`;
          if(operation==='upsert') sql+=` ON CONFLICT (${ident(conflict.onConflict)}) DO `+(conflict.ignoreDuplicates?'NOTHING':'UPDATE SET '+keys.map(k=>`${ident(k)}=EXCLUDED.${ident(k)}`).join(','));
          sql+=' RETURNING *';
        } else if(operation==='update') {
          sql=`UPDATE ${ident(table)} AS r SET ${Object.keys(payload).map(k=>`${ident(k)}=${bind(payload[k])}`).join(',')}${where()} RETURNING *`;
        } else {
          const joined=columns.includes('event_cancellations!inner');
          sql=`SELECT r.*${joined?',to_jsonb(j) AS event_cancellations':''} FROM ${ident(table)} r${joined?' JOIN event_cancellations j ON j.id=r.cancellation_id':''}${where()}`;
          if(sort.length) sql+=' ORDER BY '+sort.map(([k,asc])=>field(k)+(asc?' ASC':' DESC')).join(',');
          if(count!==undefined) sql+=' LIMIT '+Number(count); if(start) sql+=' OFFSET '+Number(start);
        }
        const result=await pg.query(sql,values);return {data:one?result.rows[0]||null:result.rows,error:null};
      } catch(error) { return {data:null,error}; }
    }
    return q;
  }};
  return db;
}
module.exports={ cancellationDatabase };
