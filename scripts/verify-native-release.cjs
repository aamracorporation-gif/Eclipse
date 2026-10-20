if(process.env.EAS_REUSE_ECLIPSE!=='true')throw new Error('La compilación de tienda debe usar el proyecto existente revisado.');
const url=new URL(process.env.EXPO_PUBLIC_API_URL||'');
if(url.protocol!=='https:'||['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.origin!==process.env.EXPO_PUBLIC_API_URL)throw new Error('Falta un backend HTTPS sin rutas ni credenciales.');
(async()=>{
 const r=await fetch(url.origin+'/api/health',{signal:AbortSignal.timeout(10000)});
 const h=await r.json();
 if(!r.ok||h.app!=='RONDIQO'||!['beta','production'].includes(h.environment))throw new Error('Backend de RONDIQO sin desplegar/verificar.');
 if(process.env.EXPO_PUBLIC_RELEASE_MODE==='production'&&h.environment!=='production')throw new Error('El backend no es de producción.');
 console.log('Backend y destino de publicación verificados; no se han iniciado compilaciones ni cobros.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
