// Design approximation using production artwork. Native Wallet owns final layout.
import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import QRCode from 'qrcode';
import {writeFileSync,mkdirSync} from 'node:fs';
GlobalFonts.registerFromPath('assets/wallet-pass/fonts/DejaVuSans.ttf', 'Wallet Sans');
GlobalFonts.registerFromPath('assets/wallet-pass/fonts/DejaVuSans-Bold.ttf', 'Wallet Sans');
const themes={general:['#111020','#BDA9FF','GENERAL'],vip:['#19150F','#E8C58B','VIP'],backstage:['#17101C','#EAA9DE','BACKSTAGE'],fastlane:['#0C1B20','#91E4D5','FASTLANE']};
const c=createCanvas(1600,1450),x=c.getContext('2d');x.fillStyle='#EDEBF2';x.fillRect(0,0,1600,1450);
function text(t,px,py,size,color='#FFFFFF',weight=400){x.font=`${weight} ${size}px "Wallet Sans"`;x.fillStyle=color;x.fillText(t,px,py);}
text('ECLIPSE / WALLET',48,60,30,'#191524',700);text('Vista de diseño · Datos de ejemplo · La distribución final depende de Apple y Google',48,92,17,'#625C6C');
const qr=await loadImage(await QRCode.toBuffer('ECLIPSE-DESIGN-PREVIEW-NOT-A-TICKET',{width:160,margin:3}));
for(const [i,[tier,[bg,accent,label]]] of Object.entries(themes).entries()){
 for(const platform of ['ios','android']){
  const left=48+i*388,top=platform==='ios'?150:785,w=352;
  text(platform==='ios'?'APPLE WALLET':'GOOGLE WALLET',left,top-20,13,'#625C6C',700);
  x.save();x.beginPath();x.roundRect(left,top,w,570,platform==='ios'?16:30);x.clip();x.fillStyle=bg;x.fillRect(left,top,w,570);
  if(platform==='ios'){
   x.drawImage(await loadImage('assets/wallet-pass/logo@3x.png'),left+20,top+17,132,32);
   text(label,left+237,top+27,11,accent,600);text('10 oct',left+260,top+47,17);
   x.drawImage(await loadImage(`assets/wallet-pass/strip_${tier}@3x.png`),left,top+65,w,98);
   text(label,left+20,top+89,11,accent,600);text('Eclipse Weekend',left+20,top+122,26,'#FFFFFF',600);
   text('LOCAL',left+20,top+190,11,accent,600);text('HORA',left+282,top+190,11,accent,600);
   text('Sevilla · Sala Eclipse',left+20,top+215,19);text('00:30',left+279,top+215,18);
   text('TITULAR',left+20,top+251,11,accent,600);text(tier==='vip'?'GRUPO':'ENTRADA',left+230,top+251,11,accent,600);
   text('Alex García',left+20,top+276,18);text(tier==='vip'?'4 personas':label,left+230,top+276,15);
  } else {
   x.drawImage(await loadImage('assets/wallet-pass/google_logo.png'),left+18,top+17,32,32);text('ECLIPSE  '+label,left+58,top+40,14,'#FFFFFF',600);
   text('Sevilla · Sala Eclipse',left+20,top+82,15,accent);text('Eclipse Weekend',left+20,top+113,26,'#FFFFFF',600);
   text('FECHA',left+20,top+152,11,accent,600);text('INICIO',left+247,top+152,11,accent,600);
   text('10 oct',left+20,top+176,19);text('00:30',left+247,top+176,19);
   x.drawImage(await loadImage(`assets/wallet-pass/google_${tier}.png`),left,top+190,w,114);
   text('TITULAR',left+20,top+333,11,accent,600);text('TIPO DE ENTRADA',left+209,top+333,11,accent,600);
   text('Alex García',left+20,top+357,17);text(label,left+209,top+357,15);
  }
  const qy=top+(platform==='ios'?322:378);x.drawImage(qr,left+101,qy,150,150);text('ECL-2026-DEMO',left+118,qy+170,12,'#CBC7D3');
  x.restore();
 }
}
mkdirSync('docs/qa/evidence-20261006',{recursive:true});writeFileSync('docs/qa/evidence-20261006/wallet-design-preview.png',c.toBuffer('image/png'));
