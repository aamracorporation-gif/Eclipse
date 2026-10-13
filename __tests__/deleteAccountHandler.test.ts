/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function setup({ billingError = null as any, updateError = null as any, cancelError = null as any, authenticated = true } = {}) {
  const calls: string[] = [];
  let handle: (req: Request) => Promise<Response>;
  const admin = {
    from(table: string) {
      let updating = false;
      const q: any = {
        select() { return q; }, eq() { return q; },
        update() { updating = true; calls.push('save-cancellation'); return q; },
        async maybeSingle() { return table === 'profiles' ? {data:{stripe_account_id:''},error:null} : {data:{stripe_subscription_id:'sub_fixture',stripe_customer_id:'cus_fixture'},error:billingError}; },
        then(resolve: any) { return Promise.resolve({error:updating ? updateError:null}).then(resolve); },
      }; return q;
    },
    async rpc() { calls.push('purge'); return {error:null}; },
    auth:{admin:{async deleteUser() { calls.push('delete-auth'); return {error:null}; }}},
  };
  const env: Record<string,string>={SUPABASE_URL:'https://uhondxttdpvywvkyqlkk.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',STRIPE_SECRET_KEY:'sk_test_fixture'};
  const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/delete-account/index.ts'),'utf8').replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
    Response,JSON,Date,encodeURIComponent,
    Deno:{env:{get:(k:string)=>env[k]},serve:(fn:typeof handle)=>{handle=fn;}},
    createClient:(_url:string,key:string)=>key==='service'?admin:{auth:{getUser:async()=>({data:{user:authenticated?{id:'owner'}:null},error:null})}},
    cancelBoxOfficeForDeletion:async()=>{calls.push('cancel');if(cancelError)throw cancelError;},
    fetch:async()=>{calls.push('connect');return new Response('{}');},
  });
  return {calls,run:()=>handle(new Request('https://example.invalid/delete-account',{method:'POST',headers:{Authorization:'Bearer fixture'}}))};
}
it('cancels and records billing before purging the account',async()=>{
  const s=setup();expect((await s.run()).status).toBe(200);
  expect(s.calls).toEqual(['cancel','save-cancellation','purge','delete-auth']);
});
it.each(['Stripe unavailable','TimeoutError','ownership mismatch'])('preserves account on %s',async message=>{
  const s=setup({cancelError:new Error(message)});expect((await s.run()).status).toBe(503);
  expect(s.calls).toEqual(['cancel']);
});
it.each(['42P01','PGRST205','other'])('fails closed when billing lookup fails: %s',async code=>{
  const s=setup({billingError:{code}});expect((await s.run()).status).toBe(503);expect(s.calls).toEqual([]);
});
it('retains account when cancellation cannot be recorded',async()=>{
  const s=setup({updateError:{message:'database unavailable'}});expect((await s.run()).status).toBe(503);
  expect(s.calls).toEqual(['cancel','save-cancellation']);
});
it('never attempts cancellation for an invalid session',async()=>{
  const s=setup({authenticated:false});expect((await s.run()).status).toBe(401);expect(s.calls).toEqual([]);
});
