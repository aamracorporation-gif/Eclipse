// Presentation study with exact production PNGs. Not an OS screenshot.
import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import QRCode from 'qrcode';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import ts from 'typescript';
GlobalFonts.registerFromPath('assets/wallet-pass/fonts/DejaVuSans.ttf','Wallet Sans');
GlobalFonts.registerFromPath('assets/wallet-pass/fonts/DejaVuSans-Bold.ttf','Wallet Sans');
const {outputText}=ts.transpileModule(readFileSync('supabase/functions/_shared/walletDesign.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}});
const {WALLET_THEMES:themes}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const concepts=['LIQUID ORBIT','OBSIDIAN AUREOLE','PRISM RUPTURE','ACID VELOCITY'];
const subtitles=['Metal líquido · luz ultravioleta','Obsidiana · oro escultórico','Cristal fracturado · magenta','Cromo tensado · acento ácido'];
const output='docs/qa/evidence-20261006';
mkdirSync(output,{recursive:true});
const qr=await loadImage(await QRCode.toBuffer('ECLIPSE-DESIGN-PREVIEW-NOT-A-TICKET',{width:560,margin:4,errorCorrectionLevel:'M'}));
const logo=await loadImage('assets/wallet-pass/logo@3x.png');
const googleLogo=await loadImage('assets/wallet-pass/google_logo.png');
const boards={};
for(const platform of ['ios','android']){
 const width=1776,height=platform==='ios'?920:1120;
 const c=createCanvas(width,height),x=c.getContext('2d');
 const text=(t,px,py,size,color='#FFFFFF',weight=400,maxWidth=null)=>{
  x.font=weight+' '+size+'px "Wallet Sans"';x.fillStyle=color;
  if(maxWidth){while(x.measureText(t).width>maxWidth&&t.length>1)t=t.slice(0,-2)+'…';}
  x.fillText(t,px,py);
 };
 x.fillStyle='#090A0D';x.fillRect(0,0,width,height);
 text('E C L I P S E',48,53,16,'#E8E6EF',700);
 text('WALLET / SCULPTURAL SERIES',1220,52,15,'#9997A3');
 text(platform==='ios'?'Apple Wallet.':'Google Wallet.',44,130,62,'#F5F3F7',700);
 text('CUATRO ACCESOS. CUATRO IDENTIDADES.',48,167,14,'#93919F');
 text('02 / 2026',1610,163,14,'#93919F');
 x.fillStyle='#303038';x.fillRect(48,193,1680,1);
 for(const [i,[tier,theme]] of Object.entries(themes).entries()){
  const {background:bg,accent,label}=theme;
  const left=48+i*430,top=262,w=390,h=platform==='ios'?538:740;
  text(String(i+1).padStart(2,'0'),left,233,12,accent,700);
  text(concepts[i],left+31,233,12,'#CAC8D2',700);
  x.save();x.shadowColor='#000000';x.shadowBlur=24;x.shadowOffsetY=12;
  x.fillStyle=bg;x.beginPath();x.roundRect(left,top,w,h,platform==='ios'?18:30);x.fill();x.restore();
  x.save();x.beginPath();x.roundRect(left,top,w,h,platform==='ios'?18:30);x.clip();x.fillStyle=bg;x.fillRect(left,top,w,h);
  if(platform==='ios'){
   x.drawImage(logo,left+19,top+16,139,34);
   x.textAlign='right';text(label,left+w-20,top+26,10,accent,700);text('10 oct',left+w-20,top+47,16);x.textAlign='left';
   x.drawImage(await loadImage('assets/wallet-pass/strip_'+tier+'@3x.png'),left,top+65,w,w*98/375);
   text(label,left+20,top+195,10,accent,700);text('HORA',left+322,top+195,10,accent,700);
   text('Eclipse Weekend',left+20,top+222,24,'#FFFFFF',600,280);text('00:30',left+320,top+222,19);
   text('LOCAL',left+20,top+258,10,accent,700);
   text('TITULAR',left+(tier==='vip'?179:225),top+258,10,accent,700);
   text('Sala Eclipse',left+20,top+282,18,'#FFFFFF',400,150);
   text('Alex García',left+(tier==='vip'?179:225),top+282,17,'#FFFFFF',400,tier==='vip'?100:146);
   if(tier==='vip'){text('GRUPO',left+303,top+258,10,accent,700);text('4 personas',left+303,top+282,15);}
   x.drawImage(qr,left+111,top+328,168,168);
   x.textAlign='center';text('ECL-2026-DEMO',left+w/2,top+517,11,'#D4D0DD');x.textAlign='left';
  }else{
   x.save();x.beginPath();x.arc(left+37,top+32,16,0,Math.PI*2);x.clip();x.drawImage(googleLogo,left+21,top+16,32,32);x.restore();
   text('ECLIPSE  '+label,left+67,top+39,14,'#FFFFFF',700);
   text('Sala Eclipse',left+22,top+82,14,'#D1CED7');text('Eclipse Weekend',left+22,top+115,26,'#FFFFFF',700);
   text('FECHA',left+22,top+154,10,'#D1CED7',700);text('INICIO',left+278,top+154,10,'#D1CED7',700);
   text('10 oct',left+22,top+176,18);text('00:30',left+278,top+176,18);
   text('TITULAR',left+22,top+212,10,'#D1CED7',700);text('TIPO DE ENTRADA',left+230,top+212,10,'#D1CED7',700);
   text('Alex García',left+22,top+236,17);text(label,left+230,top+236,16);
   const imageHeight=w*812/1032;
   x.drawImage(await loadImage('assets/wallet-pass/google_'+tier+'.png'),left,top+251,w,imageHeight);
   x.drawImage(qr,left+123,top+566,144,144);
   x.textAlign='center';text('ECL-2026-DEMO',left+w/2,top+728,10,'#D4D0DD');x.textAlign='left';
  }
  x.restore();
  text(subtitles[i],left,top+h+35,13,'#A6A3B0');
 }
 text('PREVISUALIZACIÓN · Datos de ejemplo y QR de demostración.',48,height-40,13,'#8D8A97');
 text('La distribución final la decide cada Wallet. Pendiente de revisión en dispositivos.',48,height-19,11,'#6E6C77');
 writeFileSync(output+'/wallet-'+platform+'-v2.png',c.toBuffer('image/png'));boards[platform]=c;
}
const c=createCanvas(1776,2040),x=c.getContext('2d');x.drawImage(boards.ios,0,0);x.drawImage(boards.android,0,920);
writeFileSync(output+'/wallet-design-preview-v2.png',c.toBuffer('image/png'));
console.log('Rendered both Wallet previews from exported production artwork.');
