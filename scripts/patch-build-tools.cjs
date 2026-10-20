// Local, reviewable mitigations for two upstream advisories with no published fix.
// npm audit still reports the original versions. Neither package ships in the runtime image.
const fs=require('node:fs'),path=require('node:path');
function patch(file,needle,replacement){
 let source=fs.readFileSync(file,'utf8');
 if(source.includes(replacement))return;
 if(source.split(needle).length!==2)throw new Error('Security patch no longer matches: '+file);
 fs.writeFileSync(file,source.replace(needle,replacement));
}
const braces=path.dirname(require.resolve('braces/package.json')),forge=path.dirname(require.resolve('node-forge/package.json'));
if(require(path.join(braces,'package.json')).version!=='3.0.3'||require(path.join(forge,'package.json')).version!=='1.4.0')throw new Error('Review upstream security fixes before updating build patches.');
const guard=`
  // RONDIQO GHSA-vfj7-8cjw-p6xm: bounded, iterative AST validation before recursion.
  const pending=[[ast,0]]; let visited=0;
  while(pending.length){const [node,depth]=pending.pop();
    if(depth>64||++visited>100000)throw new SyntaxError('Brace nesting exceeds safe build limit');
    if(node && Array.isArray(node.nodes))for(const child of node.nodes)pending.push([child,depth+1]);
  }`;
for(const name of ['compile','expand']){
 const needle=`const ${name} = (ast, options = {}) => {`;
 patch(path.join(braces,'lib',name+'.js'),needle,needle+guard);
}
const stringify='module.exports = (ast, options = {}) => {';
patch(path.join(braces,'lib/stringify.js'),stringify,stringify+guard);
const parse="  const opts = options || {};";
patch(path.join(braces,'lib/parse.js'),parse,`  // RONDIQO: reject pathological patterns before constructing the AST.
  let rondiqoDepth=0;
  for(const ch of input){if(ch==='{'||ch==='('){if(++rondiqoDepth>64)throw new SyntaxError('Brace nesting exceeds safe build limit');}else if(ch==='}'||ch===')')rondiqoDepth=Math.max(0,rondiqoDepth-1);}
`+parse);
patch(path.join(forge,'lib/rsa.js'),'obj.value.length !== 2) {',`obj.value.length !== 2 ||
            // RONDIQO GHSA-86w9-cpqp-85rv: reject extra nested DigestAlgorithm elements.
            !Array.isArray(obj.value[0].value) ||
            obj.value[0].value.length < 1 || obj.value[0].value.length > 2) {`);
console.log('Build-tool guards verified (braces depth, RSA DigestAlgorithm element count).');
