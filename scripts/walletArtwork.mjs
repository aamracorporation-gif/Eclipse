// Original vector artwork for Eclipse. No external images or baked ticket data.
export function drawEclipseArt(x,w,h,tier,{background,accent},platform){
 const ink='#100B1B',paper=accent;
 x.fillStyle=paper;x.fillRect(0,0,w,h);
 const isStrip=platform==='apple', cx=w*(isStrip?.77:.57),cy=h*(isStrip?.55:.49),r=Math.min(w*.43,h*(isStrip?.94:.36));
 x.save();x.translate(cx,cy);x.rotate(tier==='backstage'?-.48:tier==='fastlane'?-.18:-.32);
 // Orbital engraving: a precise series of elliptical trajectories.
 for(let i=0;i<47;i++){
  const t=i/46;x.strokeStyle=ink+(i%5===0?'90':'38');x.lineWidth=Math.max(.6,w*.0007);
  x.beginPath();x.ellipse(0,0,r*(.95+t*.65),r*(.16+t*.5),t*.22,0,Math.PI*2);x.stroke();
 }
 // Eclipse body with a lit rim and a cut-away crescent.
 x.fillStyle=ink;x.beginPath();x.arc(0,0,r*.71,0,Math.PI*2);x.fill();
 const corona=x.createRadialGradient(-r*.20,-r*.18,r*.02,0,0,r*.72);
 corona.addColorStop(0,paper+'00');corona.addColorStop(.72,paper+'00');corona.addColorStop(.95,paper+'A0');corona.addColorStop(1,paper);
 x.fillStyle=corona;x.beginPath();x.arc(0,0,r*.71,0,Math.PI*2);x.fill();
 x.fillStyle=ink;x.beginPath();x.arc(-r*.16,-r*.12,r*.62,0,Math.PI*2);x.fill();
 // Sharp chrome-white occultation slash, distinctive at wallet-strip size.
 x.strokeStyle='#FFF8EF';x.lineWidth=r*.012;x.beginPath();x.arc(0,0,r*.712,-.9,.72);x.stroke();
 const starX=r*.70,starY=-r*.12;
 x.fillStyle='#FFF9F0';x.beginPath();x.moveTo(starX-r*.08,starY);x.quadraticCurveTo(starX,starY-r*.005,starX,starY-r*.12);x.quadraticCurveTo(starX+r*.005,starY,starX+r*.08,starY);x.quadraticCurveTo(starX,starY+r*.005,starX,starY+r*.12);x.quadraticCurveTo(starX-r*.005,starY,starX-r*.08,starY);x.fill();
 x.restore();
 // Architectural cut-outs make this an identity system, not a photo backdrop.
 x.strokeStyle=ink+'75';x.lineWidth=Math.max(1,w*.0012);
 for(const [px,py]of [[w*.05,h*.15],[w*.05,h*.85],[w*.95,h*.15],[w*.95,h*.85]]){
  x.beginPath();x.moveTo(px-w*.012,py);x.lineTo(px+w*.012,py);x.moveTo(px,py-w*.012);x.lineTo(px,py+w*.012);x.stroke();
 }
 if(isStrip){
  x.save();x.translate(w*.035,h*.77);x.scale(.82,1);x.font='900 '+h*.8+'px "Wallet Sans"';x.strokeStyle=ink;x.lineWidth=h*.008;x.strokeText('E',0,0);x.restore();
  x.fillStyle=ink;x.fillRect(w*.075,h*.15,w*.12,Math.max(1,h*.025));
 }else{
  x.save();x.strokeStyle=ink+'55';x.lineWidth=w*.001;
  x.strokeRect(w*.055,h*.09,w*.89,h*.82);x.restore();
  if(tier==='fastlane')for(let j=0;j<5;j++){x.fillStyle=ink;x.fillRect(w*.07,h*(.78+j*.022),w*(.17-j*.021),h*.006);}
  if(tier==='backstage'){x.strokeStyle=ink;x.lineWidth=w*.002;x.beginPath();x.moveTo(w*.07,h*.18);x.lineTo(w*.26,h*.37);x.moveTo(w*.26,h*.18);x.lineTo(w*.07,h*.37);x.stroke();}
  if(tier==='vip'){x.strokeStyle=ink;x.lineWidth=w*.002;for(let j=0;j<3;j++)x.strokeRect(w*(.075+j*.017),h*(.18+j*.022),w*.14,h*.18);}
 }
 // Fine halftone texture; deterministic so exports are reproducible.
 x.fillStyle=ink+'15';const step=Math.max(3,w/240);
 for(let yy=0;yy<h;yy+=step)for(let xx=0;xx<w;xx+=step){if(((Math.floor(xx/step)*17+Math.floor(yy/step)*29)%11)<3)x.fillRect(xx,yy,Math.max(.4,w/1800),Math.max(.4,w/1800));}
}

