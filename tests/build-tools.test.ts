import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
execFileSync(process.execPath,['scripts/patch-build-tools.cjs']);
const braces=require('braces'),forge=require('node-forge');
test('build tool brace guards reject hostile nested strings and ASTs without stack overflow',()=>{
 assert.deepEqual(braces.expand('club-{padel,futbol}'),['club-padel','club-futbol']);
 assert.throws(()=>braces('{'.repeat(5000)+'x'+'}'.repeat(5000)),/safe build limit/);
 let ast:any={type:'text',value:'x'};for(let i=0;i<5000;i++)ast={type:'brace',nodes:[ast]};
 for(const operation of ['compile','expand','stringify'])assert.throws(()=>braces[operation](ast),/safe build limit/);
});
test('RSA build tooling accepts standard signatures and rejects extra DigestAlgorithm elements',()=>{
 const keys=forge.pki.rsa.generateKeyPair({bits:1024,workers:0});
 const md=forge.md.sha256.create();md.update('release integrity');
 const signature=keys.privateKey.sign(md);
 assert.equal(keys.publicKey.verify(md.digest().getBytes(),signature),true);
 const a=forge.asn1,oid=forge.pki.oids.sha256;
 const algorithm=a.create(a.Class.UNIVERSAL,a.Type.SEQUENCE,true,[
  a.create(a.Class.UNIVERSAL,a.Type.OID,false,a.oidToDer(oid).getBytes()),
  a.create(a.Class.UNIVERSAL,a.Type.NULL,false,''),
  a.create(a.Class.UNIVERSAL,a.Type.OCTETSTRING,false,'unexpected'),
 ]);
 const digest=a.create(a.Class.UNIVERSAL,a.Type.SEQUENCE,true,[algorithm,a.create(a.Class.UNIVERSAL,a.Type.OCTETSTRING,false,md.digest().getBytes())]);
 const malformed=forge.pki.rsa.encrypt(a.toDer(digest).getBytes(),keys.privateKey,0x01);
 assert.throws(()=>keys.publicKey.verify(md.digest().getBytes(),malformed),/DigestInfo/);
});
