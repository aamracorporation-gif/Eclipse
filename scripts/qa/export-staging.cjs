const {spawnSync}=require('node:child_process'),path=require('node:path');
process.env.ECLIPSE_BUILD_ENV='staging';
require('../buildEnvironment.cjs').validateBuildEnvironment();
const cli=path.join(path.dirname(require.resolve('expo/package.json')),'bin/cli');
const result=spawnSync(process.execPath,[cli,'export','--platform','all','--output-dir','dist-staging'],{stdio:'inherit',env:process.env});
process.exit(result.status??1);
