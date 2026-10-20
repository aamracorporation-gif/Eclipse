// The sports API is the active backend.
import('./server/index.ts').then(({main})=>main()).catch(error=>{
  console.error('[RONDIQO]',error.code || error.name || 'startup error');
  process.exitCode=1;
});
