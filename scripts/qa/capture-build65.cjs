(async function(){
 const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
 const tooling=process.env.ECLIPSE_REVIEW_TOOLS;if(!tooling)throw Error("Set ECLIPSE_REVIEW_TOOLS to isolated node_modules");const esbuild=require(path.join(tooling,"esbuild")),{chromium}=require(path.join(tooling,"playwright"));
 require('./build-creator-preview.cjs');
 const out='docs/qa/build65-restored';fs.mkdirSync(out,{recursive:true});
 await esbuild.build({entryPoints:['scripts/qa/review-build65.tsx'],bundle:true,outfile:out+'/review.js',platform:'browser',format:'iife',jsx:'automatic',alias:{'react-native':'react-native-web','@':process.cwd()},resolveExtensions:['.web.tsx','.tsx','.web.ts','.ts','.web.js','.js','.json'],define:{'process.env.NODE_ENV':'"production"','process.env.EXPO_OS':'"web"','__DEV__':'false',global:'window'},loader:{'.js':'jsx','.ttf':'file','.png':'file','.jpg':'file'},plugins:[{name:'offline-preview',setup(build){
 build.onResolve({filter:/^@\/lib\/supabase$/},args=>({path:args.path,namespace:'offline'}));
 build.onLoad({filter:/.*/,namespace:'offline'},()=>({contents:"export const supabase={rpc:async()=>({data:null,error:{message:'Vista de ejemplo: no se validan códigos reales.'}})}",loader:'js'}));
 build.onResolve({filter:/^@react-native-community\/datetimepicker$/},()=>({path:path.resolve('scripts/qa/web-datepicker-stub.js')}));
 }}]});
 fs.writeFileSync(out+'/index.html','<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#050510;color:#F8FAFC;font-family:Arial,sans-serif}*{box-sizing:border-box}#root{min-height:100vh}</style><div id="root"></div><script src="./review.js"></script></html>');
 const base=path.resolve(out);
 const server=http.createServer((req,res)=>{const name=path.resolve(base,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!name.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.ttf':'font/ttf','.png':'image/png'})[path.extname(name)]||'application/octet-stream');res.end(fs.readFileSync(name));}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,locale:'es-ES'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 for(const view of ['tickets','vip','creator']){
   await page.goto('http://127.0.0.1:'+server.address().port+'/?view='+view);await page.waitForLoadState('networkidle');await page.evaluate(()=>document.fonts.ready);
   if(errors.length)throw Error(errors.join(';'));
   await page.screenshot({path:out+'/'+view+'.png',fullPage:true});
   if(view==='tickets'){await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.screenshot({path:out+'/payment.png',fullPage:true});}

 }
 console.log('CAPTURES_READY='+path.resolve(out));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
