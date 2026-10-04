/** @jest-environment node */
import * as fs from 'node:fs';
import * as vm from 'node:vm';
import * as ts from 'typescript';
const compiled = ts.transpileModule(fs.readFileSync('supabase/functions/send-ticket-email/index.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
describe('ticket email privileged sender', () => {
  it.each([undefined,'Bearer client-jwt','Bearer anon-key','Bearer wrong'])('rejects %s before email provider', async authorization => {
    let handler: any;
    const fetch = jest.fn();
    vm.runInNewContext(compiled,{exports:{},require:()=>({serve:(fn:any)=>{handler=fn;}}),Deno:{env:{get:()=> 'internal-test-key'}},Response,fetch});
    const headers:Record<string,string> = {'Content-Type':'application/json'};
    if(authorization)headers.Authorization=authorization;
    const r=await handler(new Request('https://example.test/send',{method:'POST',headers,body:JSON.stringify({to:'fixture@example.test',html:'test'})}));
    expect(r.status).toBe(403);expect(fetch).not.toHaveBeenCalled();
  });
});
