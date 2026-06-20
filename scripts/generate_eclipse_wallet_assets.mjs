/**
 * ECLIPSE Wallet Pass — Asset Generator v4 "TIER SYSTEM"
 *
 * Four distinct generative artworks, one per ticket tier:
 *
 *   STANDARD   → "CORONA ECLIPSE"      Refined solar eclipse, platinum/silver
 *   PREMIUM    → "AURORA BOREALIS"      Northern lights, cyan/violet curtains
 *   VIP        → "SUPERNOVA REMNANT"    Stellar explosion, amber/gold burst
 *   LEGENDARY  → "GRAVITATIONAL SINGULARITY"  Black hole with photon ring
 *
 * Techniques:
 *   • ctx.filter blur for soft glow / bloom
 *   • Fibonacci golden-ratio star distribution
 *   • Deterministic LCG pseudo-noise (reproducible builds)
 *   • Asymmetric Doppler brightening on photon ring
 *   • 360 individual coronal ray streamers (length from summed sines)
 *   • Aurora curtains with embedded vertical ray shafts
 *   • 12-arm supernova burst with concentric halos
 *
 * Run: node scripts/generate_eclipse_wallet_assets.mjs
 */

import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT  = join(ROOT, "assets", "wallet-pass");
mkdirSync(OUT, { recursive: true });

function save(name, canvas) {
  const buf = canvas.toBuffer("image/png");
  writeFileSync(join(OUT, name), buf);
  const kb = (buf.length / 1024).toFixed(0);
  console.log(`  ✓ ${name}  (${canvas.width}×${canvas.height}, ${kb} KB)`);
}

// ── math / colour helpers ────────────────────────────────────────────────────

const hexRgb = h => ({ r: parseInt(h.slice(1,3),16), g: parseInt(h.slice(3,5),16), b: parseInt(h.slice(5,7),16) });
const rgba   = ({r,g,b}, a)    => `rgba(${r},${g},${b},${+a.toFixed(4)})`;
const mix    = (A,B,t)         => ({ r:Math.round(A.r+(B.r-A.r)*t), g:Math.round(A.g+(B.g-A.g)*t), b:Math.round(A.b+(B.b-A.b)*t) });

/** LCG pseudo-random with explicit seed — deterministic, reproducible */
const makeLcg = (seed = 42) => {
  let s = seed >>> 0;
  return () => { s=(s*1664525+1013904223)>>>0; return s/0xFFFFFFFF; };
};

/** Stars on a Fibonacci golden-ratio spiral */
function drawStars(ctx, w, h, opts = {}) {
  const {
    count   = 220,
    spreadR = Math.max(w,h) * 0.85,
    cx      = w * 0.5,
    cy      = h * 0.50,
    tintRgb = {r:255,g:255,b:255},
    maxA    = 0.82,
  } = opts;

  const PHI = 1.6180339887;
  ctx.save();
  for (let i = 1; i <= count; i++) {
    const theta = 2 * Math.PI * i * PHI;
    const rr    = Math.sqrt(i / count) * spreadR;
    const sx    = cx + rr * Math.cos(theta);
    const sy    = cy + rr * Math.sin(theta);
    if (sx < 0 || sx > w || sy < 0 || sy > h) continue;

    const distFrac = Math.min(1, rr / (spreadR * 0.52));
    const alpha    = (0.04 + distFrac * 0.58) * maxA;
    const starR    = 0.45 + (i%11===0 ? 0.85 : 0) + (i%37===0 ? 0.55 : 0);
    const color    = i%23===0 ? mix(tintRgb, {r:255,g:255,b:255}, 0.4) : {r:255,g:255,b:255};

    ctx.globalAlpha = Math.min(alpha, 0.88);
    ctx.beginPath(); ctx.arc(sx, sy, starR, 0, Math.PI*2);
    ctx.fillStyle = rgba(color, 1); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Scanline CRT texture */
function drawScanlines(ctx, w, h, a = 0.022) {
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "#000";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  ctx.restore();
}

/** Gradient darkness over the top of the strip — Wallet fields need legibility */
function drawTopDark(ctx, w, h, peak = 0.90) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0,    `rgba(0,0,0,${peak})`);
  g.addColorStop(0.40, `rgba(0,0,0,0.28)`);
  g.addColorStop(0.68, `rgba(0,0,0,0.06)`);
  g.addColorStop(1,    `rgba(0,0,0,0.00)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

/** Bottom vignette */
function drawVignette(ctx, w, h, a = 0.48) {
  const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
  g.addColorStop(0, "transparent");
  g.addColorStop(1, `rgba(0,0,0,${a})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

/** Grain (deterministic) */
function drawGrain(ctx, w, h, density = 0.010, seed = 99) {
  const rand = makeLcg(seed);
  ctx.save();
  const n = Math.floor(w * h * density);
  for (let i = 0; i < n; i++) {
    const b = rand() > 0.5 ? 255 : 0;
    ctx.globalAlpha = rand() * 0.052;
    ctx.fillStyle = `rgb(${b},${b},${b})`;
    ctx.fillRect(rand() * w, rand() * h, 1, 1);
  }
  ctx.globalAlpha = 1; ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ICON  —  87 / 58 / 29 px
// Eclipse "E" with micro-eclipse accent dot
// ═══════════════════════════════════════════════════════════════════════════════

function drawIcon(sz) {
  const c = createCanvas(sz, sz);
  const ctx = c.getContext("2d");

  ctx.fillStyle = "#030308"; ctx.fillRect(0, 0, sz, sz);

  // Subtle amber glow behind the E
  const bg = ctx.createRadialGradient(sz*.50, sz*.44, 0, sz*.50, sz*.44, sz*.72);
  bg.addColorStop(0, "rgba(255,179,107,.18)");
  bg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, sz, sz);

  // Geometric "E" — clean strokes
  const P = sz * 0.19, SW = sz * 0.118, BH = SW * 0.82;
  const W = sz - P*2, H = sz - P*2;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(P,         P,           SW, H);          // vertical bar
  ctx.fillRect(P,         P,           W,  BH);         // top
  ctx.fillRect(P,         P+H/2-BH/2, W*0.66, BH);    // mid (shorter)
  ctx.fillRect(P,         P+H-BH,     W,  BH);         // bottom

  // Micro-eclipse: amber corona + black moon, top-right of the E
  const dcx = P + W * 0.80, dcy = P + BH * 0.50, dr = sz * 0.062;
  ctx.save();
  ctx.filter = `blur(${Math.max(1, sz*0.04).toFixed(0)}px)`;
  const dg = ctx.createRadialGradient(dcx,dcy,0,dcx,dcy,dr*2.8);
  dg.addColorStop(0, "rgba(255,185,90,.70)"); dg.addColorStop(1,"transparent");
  ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(dcx,dcy,dr*2.8,0,Math.PI*2); ctx.fill();
  ctx.filter = "none"; ctx.restore();
  ctx.fillStyle = "#030308"; ctx.beginPath(); ctx.arc(dcx,dcy,dr,0,Math.PI*2); ctx.fill();

  return c;
}

console.log("\n✦  ECLIPSE Wallet Asset Generator v4\n");
console.log("Generating icons…");
[[87,"@3x"],[58,"@2x"],[29,""]].forEach(([sz,suf]) => save(`icon${suf}.png`, drawIcon(sz)));

// ═══════════════════════════════════════════════════════════════════════════════
// LOGO  —  480/320/160 × 150/100/50 px
// "ECLIPSE" wordmark on near-black, wide tracking
// ═══════════════════════════════════════════════════════════════════════════════

function drawLogo(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#030308"; ctx.fillRect(0, 0, w, h);

  // Hairline bottom — amber
  ctx.save();
  const hg = ctx.createLinearGradient(0, 0, w, 0);
  hg.addColorStop(0,"transparent"); hg.addColorStop(.3,"rgba(255,179,107,.22)");
  hg.addColorStop(.7,"rgba(255,179,107,.22)"); hg.addColorStop(1,"transparent");
  ctx.fillStyle = hg; ctx.fillRect(0, h-1, w, 1);
  ctx.restore();

  const fs = Math.round(h * 0.40);
  ctx.font         = `900 ${fs}px Arial Black, Arial`;
  ctx.letterSpacing = `${Math.round(fs * 0.24)}px`;
  ctx.fillStyle    = "#FFFFFF";
  ctx.textBaseline = "middle";
  ctx.textAlign    = "left";
  ctx.fillText("ECLIPSE", Math.round(w * 0.06), h / 2 + 1);
  return c;
}

console.log("Generating logos…");
[[160,50,""],[320,100,"@2x"],[480,150,"@3x"]].forEach(([w,h,s]) => save(`logo${s}.png`, drawLogo(w,h)));

// Footer (plain dark)
const FT = createCanvas(480,150); FT.getContext("2d").fillStyle="#030308"; FT.getContext("2d").fillRect(0,0,480,150);
["","@2x","@3x"].forEach(s => save(`footer${s}.png`, FT));

// ═══════════════════════════════════════════════════════════════════════════════
// STRIP IMAGES  —  1125 × 432 px  (375×144 @3x)
// ═══════════════════════════════════════════════════════════════════════════════

const W = 1125, H = 432;

// ─── TIER 1: STANDARD — "CORONA ECLIPSE" ────────────────────────────────────
// Refined solar eclipse, platinum/silver corona, minimal luxury

function makeStripStandard() {
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");

  // Background — cool near-black with faint blue tint
  const bg = ctx.createRadialGradient(W*.50,H*.50,0,W*.50,H*.50,W*.70);
  bg.addColorStop(0,"#05050E"); bg.addColorStop(1,"#010104");
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // Distant nebula hints
  [[W*.20,H*.30,W*.28,{r:160,g:170,b:220},.028],[W*.78,H*.38,W*.24,{r:140,g:155,b:200},.020]]
    .forEach(([nx,ny,nr,col,a]) => {
      const ng=ctx.createRadialGradient(nx,ny,0,nx,ny,nr);
      ng.addColorStop(0,rgba(col,a)); ng.addColorStop(1,"transparent");
      ctx.fillStyle=ng; ctx.fillRect(0,0,W,H);
    });

  drawStars(ctx,W,H,{tintRgb:{r:200,g:210,b:255}, maxA:.78});

  const cx=W*.50, cy=H*.555, moonR=H*.238;

  // Soft inner corona — 50-step exponential glow
  const silver={r:212,g:218,b:232};
  for (let i=50;i>=0;i--) {
    const t  = i/50;
    const rr = moonR*.96 + (moonR*2.55-moonR*.96)*t;
    const a  = .038 * Math.exp(-t*3.5);
    ctx.beginPath(); ctx.arc(cx,cy,rr,0,Math.PI*2);
    ctx.fillStyle = rgba(silver,a); ctx.fill();
  }

  // 360 coronal ray streamers (platinum/silver)
  const rayLen = deg => {
    const a=(deg*Math.PI)/180;
    return 1+ .30*Math.abs(Math.sin(a*3.1)) + .22*Math.abs(Math.sin(a*7.3+1.14))
             + .17*Math.abs(Math.sin(a*13.7+.55)) + .11*Math.abs(Math.sin(a*23.1+2.22))
             + .07*Math.abs(Math.sin(a*41.0+.77));
  };
  ctx.save();
  for (let deg=0;deg<360;deg++) {
    const a=deg*Math.PI/180, rl=moonR*rayLen(deg)*1.5, hw=(Math.PI/180)*.52;
    const tipX=cx+Math.cos(a)*(moonR+rl), tipY=cy+Math.sin(a)*(moonR+rl);
    const g=ctx.createRadialGradient(cx,cy,moonR*.96,cx,cy,moonR+rl);
    g.addColorStop(0,rgba(silver,.22)); g.addColorStop(.30,rgba(silver,.09));
    g.addColorStop(.70,rgba(silver,.02)); g.addColorStop(1,rgba(silver,.00));
    ctx.beginPath();
    ctx.moveTo(cx+Math.cos(a-hw)*(moonR*.97),cy+Math.sin(a-hw)*(moonR*.97));
    ctx.lineTo(cx+Math.cos(a+hw)*(moonR*.97),cy+Math.sin(a+hw)*(moonR*.97));
    ctx.lineTo(tipX,tipY); ctx.closePath();
    ctx.fillStyle=g; ctx.fill();
  }
  ctx.restore();

  // Chromatic aberration rings
  [{r:moonR*1.05,c:"rgba(210,230,255,.06)"},{r:moonR*1.20,c:"rgba(100,140,255,.04)"}].forEach(({r,c})=>{
    const rg=ctx.createRadialGradient(cx,cy,r*.85,cx,cy,r);
    rg.addColorStop(0,"transparent"); rg.addColorStop(.6,c); rg.addColorStop(1,"transparent");
    ctx.fillStyle=rg; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  });

  // Moon
  ctx.beginPath(); ctx.arc(cx,cy,moonR,0,Math.PI*2); ctx.fillStyle="#000000"; ctx.fill();

  drawGrain(ctx,W,H,.010,11); drawScanlines(ctx,W,H,.020);
  drawTopDark(ctx,W,H,.90); drawVignette(ctx,W,H,.45);
  return c;
}

// ─── TIER 2: PREMIUM — "AURORA BOREALIS" ─────────────────────────────────────
// Northern lights: translucent curtains with embedded vertical ray shafts,
// cyan → teal → violet gradient from bottom to top

function makeStripPremium() {
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");

  // Deep navy-black base
  const bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,"#000810"); bg.addColorStop(.65,"#010C1C"); bg.addColorStop(1,"#020E20");
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // Horizon glow (cyan at bottom)
  const hg=ctx.createLinearGradient(0,H*.62,0,H);
  hg.addColorStop(0,"transparent"); hg.addColorStop(1,"rgba(0,180,255,.058)");
  ctx.fillStyle=hg; ctx.fillRect(0,0,W,H);

  drawStars(ctx,W,H,{tintRgb:{r:100,g:210,b:255},maxA:.65,cy:H*.48});

  // Aurora curtains — 5 bands, each with blurred fill + vertical ray shafts
  const bands = [
    { yF:.540, tk:.190, freq:3.40, ph:0.00, col:{r:0  ,g:190,b:225}, a:.22 },
    { yF:.400, tk:.160, freq:4.10, ph:1.15, col:{r:68 ,g:210,b:232}, a:.18 },
    { yF:.295, tk:.140, freq:3.75, ph:0.65, col:{r:130,g:228,b:242}, a:.15 },
    { yF:.205, tk:.120, freq:4.85, ph:1.80, col:{r:155,g:78 ,b:230}, a:.12 },
    { yF:.130, tk:.100, freq:5.25, ph:2.50, col:{r:195,g:120,b:255}, a:.09 },
  ];

  const STEPS = 240;

  for (const band of bands) {
    const hH = (band.tk * H) / 2;
    const bY  = band.yF * H;

    // Build top and bottom edge paths
    const topPts=[], botPts=[];
    for (let i=0;i<=STEPS;i++) {
      const x   = (i/STEPS)*W;
      const sw  = Math.sin((i/STEPS)*Math.PI*2*band.freq + band.ph);
      topPts.push([x, bY - hH + sw*hH*.60]);
      botPts.push([x, bY + hH + sw*hH*.40]);
    }

    // Blurred filled band (soft glow)
    ctx.save();
    ctx.filter="blur(18px)";
    ctx.beginPath();
    topPts.forEach(([x,y],i) => i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y));
    [...botPts].reverse().forEach(([x,y]) => ctx.lineTo(x,y));
    ctx.closePath();
    const bg2=ctx.createLinearGradient(0,bY-hH,0,bY+hH);
    const {r,g,b}=band.col;
    bg2.addColorStop(0,`rgba(${r},${g},${b},${band.a*.38})`);
    bg2.addColorStop(.5,`rgba(${r},${g},${b},${band.a})`);
    bg2.addColorStop(1,`rgba(${r},${g},${b},${band.a*.28})`);
    ctx.fillStyle=bg2; ctx.fill();
    ctx.filter="none"; ctx.restore();

    // Crisp (unblurred) band overlay at lower alpha for definition
    ctx.save();
    ctx.beginPath();
    topPts.forEach(([x,y],i) => i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y));
    [...botPts].reverse().forEach(([x,y]) => ctx.lineTo(x,y));
    ctx.closePath();
    const bg3=ctx.createLinearGradient(0,bY-hH,0,bY+hH);
    bg3.addColorStop(0,`rgba(${r},${g},${b},0)`);
    bg3.addColorStop(.42,`rgba(${r},${g},${b},${band.a*.55})`);
    bg3.addColorStop(1,`rgba(${r},${g},${b},0)`);
    ctx.fillStyle=bg3; ctx.fill(); ctx.restore();

    // Vertical ray shafts within the band
    const PHI=1.6180339887, rayN=72;
    ctx.save();
    for (let ri=0;ri<rayN;ri++) {
      const rx=(ri/rayN)*W + (W/rayN)*.5;
      const sw=Math.sin((ri/rayN)*Math.PI*2*band.freq+band.ph);
      const rtY=bY-hH*.92+sw*hH*.60;
      const rbY=bY+hH*.52+sw*hH*.40;
      const ra=band.a*(0.28+0.42*Math.abs(Math.sin(ri*PHI)));
      const rg2=ctx.createLinearGradient(0,rtY,0,rbY);
      rg2.addColorStop(0,`rgba(${r},${g},${b},${ra})`);
      rg2.addColorStop(1,`rgba(${r},${g},${b},0)`);
      ctx.beginPath(); ctx.moveTo(rx,rtY); ctx.lineTo(rx,rbY);
      ctx.strokeStyle=rg2; ctx.lineWidth=1.8; ctx.stroke();
    }
    ctx.restore();
  }

  drawGrain(ctx,W,H,.010,55); drawScanlines(ctx,W,H,.018);
  drawTopDark(ctx,W,H,.88); drawVignette(ctx,W,H,.44);
  return c;
}

// ─── TIER 3: VIP — "SUPERNOVA REMNANT" ───────────────────────────────────────
// Central stellar explosion: amber/gold core, 12 burst arms, concentric halos,
// gold particle shower

function makeStripVip() {
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");

  ctx.fillStyle="#040100"; ctx.fillRect(0,0,W,H);

  // Warm radial tint in deep background
  const bg=ctx.createRadialGradient(W*.5,H*.52,0,W*.5,H*.52,W*.72);
  bg.addColorStop(0,"rgba(60,15,0,.18)"); bg.addColorStop(1,"transparent");
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  drawStars(ctx,W,H,{tintRgb:{r:255,g:210,b:140},maxA:.62,cy:H*.50});

  const cx=W*.50, cy=H*.520;

  // Central explosion bloom — layered radial gradients
  const layers=[
    {r:H*.06,  col:{r:255,g:255,b:245}, a:.90},   // white-hot core
    {r:H*.12,  col:{r:255,g:225,b:120}, a:.62},   // amber inner
    {r:H*.22,  col:{r:255,g:160,b:40},  a:.35},   // orange
    {r:H*.40,  col:{r:210,g:70, b:5},   a:.14},   // deep orange-red
    {r:H*.72,  col:{r:130,g:20, b:0},   a:.05},   // dark red far glow
  ];
  for (const {r,col,a} of layers) {
    ctx.save();
    ctx.filter=`blur(${Math.round(r*.18)}px)`;
    const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
    g.addColorStop(0,rgba(col,a)); g.addColorStop(1,rgba(col,0));
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    ctx.filter="none"; ctx.restore();
  }

  // 12 burst arms — long, tapered triangles at 30° intervals
  const armLengths=[2.05,1.42,1.88,1.28,2.22,1.65,1.95,1.35,2.18,1.52,1.78,1.18];
  const baseLen=H*.52, armHW=(Math.PI/180)*2.8;
  ctx.save();
  for (let i=0;i<12;i++) {
    const angle=(i/12)*Math.PI*2 - Math.PI/24;
    const al=baseLen*armLengths[i];
    const tx=cx+Math.cos(angle)*al, ty=cy+Math.sin(angle)*al;
    const g=ctx.createRadialGradient(cx,cy,0,cx,cy,al);
    g.addColorStop(0,  "rgba(255,235,145,.62)");
    g.addColorStop(.07,"rgba(255,190,80,.46)");
    g.addColorStop(.22,"rgba(225,110,20,.22)");
    g.addColorStop(.55,"rgba(185,55,5,.06)");
    g.addColorStop(1,  "rgba(140,30,0,.00)");
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.lineTo(cx+Math.cos(angle-armHW)*al, cy+Math.sin(angle-armHW)*al);
    ctx.lineTo(tx,ty);
    ctx.lineTo(cx+Math.cos(angle+armHW)*al, cy+Math.sin(angle+armHW)*al);
    ctx.closePath(); ctx.fillStyle=g; ctx.fill();
  }
  ctx.restore();

  // Concentric halos
  [[H*.20,"rgba(255,200,80,.28)",3.5],[H*.36,"rgba(220,120,30,.16)",2.5],[H*.54,"rgba(170,65,5,.09)",1.8]]
    .forEach(([r,col,lw])=>{
      ctx.save(); ctx.filter=`blur(${(lw*4).toFixed(0)}px)`;
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
      ctx.strokeStyle=col; ctx.lineWidth=lw*2; ctx.stroke();
      ctx.filter="none"; ctx.restore();
    });

  // Gold particles (deterministic spray outward)
  {
    const rand=makeLcg(137); const N=140;
    ctx.save();
    for (let i=0;i<N;i++) {
      const a=rand()*Math.PI*2, d=rand()*H*.82;
      const px=cx+Math.cos(a)*d, py=cy+Math.sin(a)*d;
      if(px<0||px>W||py<0||py>H) continue;
      const al=(1-d/(H*.82))*.48 + .05;
      const pr=.5+rand()*1.6;
      ctx.globalAlpha=al*(rand()*.8+.2);
      ctx.fillStyle=rand()>.55?"#FFD080":"#FF9B28";
      ctx.beginPath(); ctx.arc(px,py,pr,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1; ctx.restore();
  }

  drawGrain(ctx,W,H,.010,77); drawScanlines(ctx,W,H,.018);
  drawTopDark(ctx,W,H,.90); drawVignette(ctx,W,H,.46);
  return c;
}

// ─── TIER 4: LEGENDARY — "GRAVITATIONAL SINGULARITY" ─────────────────────────
// Black hole: asymmetric photon ring (Doppler boosted), thin accretion disk,
// ghost Einstein ring, absolute void interior

function makeStripLegendary() {
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");

  ctx.fillStyle="#000000"; ctx.fillRect(0,0,W,H);

  // Faint far nebula
  const ng=ctx.createRadialGradient(W*.5,H*.50,0,W*.5,H*.50,W*.62);
  ng.addColorStop(0,"rgba(55,0,115,.040)"); ng.addColorStop(.6,"rgba(30,0,70,.018)"); ng.addColorStop(1,"transparent");
  ctx.fillStyle=ng; ctx.fillRect(0,0,W,H);

  drawStars(ctx,W,H,{count:200,tintRgb:{r:200,g:160,b:255},maxA:.75,cy:H*.48});

  const cx=W*.50, cy=H*.545;
  const bhR=H*.215;        // event-horizon radius
  const ringR=bhR*1.340;   // photon ring radius

  // Accretion disk — thin elliptical glow below the BH
  {
    const dRx=bhR*2.10, dRy=bhR*.220, dCy=cy+bhR*.10;
    ctx.save();
    ctx.filter="blur(14px)";
    // Scale ctx vertically to draw an ellipse
    ctx.save();
    ctx.translate(0, dCy); ctx.scale(1, dRy/dRx); ctx.translate(0,-dCy);
    const dg=ctx.createRadialGradient(cx,dCy,bhR*.82,cx,dCy,dRx);
    dg.addColorStop(0,"rgba(200,120,255,.00)");
    dg.addColorStop(.35,"rgba(180,90,255,.14)");
    dg.addColorStop(.70,"rgba(140,60,220,.08)");
    dg.addColorStop(1,"transparent");
    ctx.fillStyle=dg; ctx.beginPath(); ctx.arc(cx,dCy,dRx,0,Math.PI*2); ctx.fill();
    ctx.restore();
    ctx.filter="none"; ctx.restore();
  }

  // Photon ring — 360 segments, asymmetric Doppler brightening
  // Brightest at bottom (approaching gas), dimmest at top
  {
    const SEG=360;
    for (let i=0;i<SEG;i++) {
      const a0=(i/SEG)*Math.PI*2, a1=((i+1)/SEG)*Math.PI*2;
      const aM=(a0+a1)/2;
      // Doppler: max at bottom (sin=1 at aM=π/2)
      const dop = Math.pow((1+Math.sin(aM-Math.PI*.5))*.5, 2.2);
      const alpha = .040 + dop*.580;
      const lw    = bhR*(.052+dop*.072);
      const blurR = (2+dop*7).toFixed(0);

      ctx.save();
      ctx.filter=`blur(${blurR}px)`;
      ctx.beginPath(); ctx.arc(cx,cy,ringR,a0,a1);
      ctx.strokeStyle=`rgba(215,148,255,${alpha.toFixed(3)})`;
      ctx.lineWidth=lw; ctx.stroke();
      ctx.filter="none"; ctx.restore();
    }

    // Hot spot — bottom of the ring
    const hsX=cx+Math.cos(Math.PI*.5)*ringR, hsY=cy+Math.sin(Math.PI*.5)*ringR;
    ctx.save();
    ctx.filter="blur(10px)";
    const hsg=ctx.createRadialGradient(hsX,hsY,0,hsX,hsY,bhR*.32);
    hsg.addColorStop(0,"rgba(255,245,255,.72)"); hsg.addColorStop(.5,"rgba(210,140,255,.28)"); hsg.addColorStop(1,"transparent");
    ctx.fillStyle=hsg; ctx.beginPath(); ctx.arc(hsX,hsY,bhR*.32,0,Math.PI*2); ctx.fill();
    ctx.filter="none"; ctx.restore();
  }

  // Secondary ghost Einstein ring (lensing second image, very faint)
  {
    const gR=ringR*1.58;
    ctx.save(); ctx.filter="blur(10px)";
    for (let i=0;i<180;i++) {
      const a0=(i/180)*Math.PI*2, a1=((i+1)/180)*Math.PI*2, aM=(a0+a1)/2;
      const dop=Math.pow((1+Math.sin(aM+Math.PI*.5))*.5,2.0);
      const alpha=.006+dop*.030;
      ctx.beginPath(); ctx.arc(cx,cy,gR,a0,a1);
      ctx.strokeStyle=`rgba(195,115,255,${alpha.toFixed(3)})`; ctx.lineWidth=bhR*.042; ctx.stroke();
    }
    ctx.filter="none"; ctx.restore();
  }

  // Black hole disk — absolute void
  ctx.save();
  ctx.beginPath(); ctx.arc(cx,cy,bhR,0,Math.PI*2); ctx.fillStyle="#000000"; ctx.fill();
  // Very faint atmospheric limb
  const limb=ctx.createRadialGradient(cx,cy,bhR*.80,cx,cy,bhR);
  limb.addColorStop(0,"transparent"); limb.addColorStop(1,"rgba(180,100,255,.04)");
  ctx.fillStyle=limb; ctx.beginPath(); ctx.arc(cx,cy,bhR,0,Math.PI*2); ctx.fill();
  ctx.restore();

  drawGrain(ctx,W,H,.008,33); drawScanlines(ctx,W,H,.015);
  drawTopDark(ctx,W,H,.92); drawVignette(ctx,W,H,.50);
  return c;
}

// ── Generate all strips ───────────────────────────────────────────────────────

console.log("Generating strip images (this may take a moment)…\n");

const strips=[
  ["strip_standard.png",  makeStripStandard],
  ["strip_premium.png",   makeStripPremium],
  ["strip_vip.png",       makeStripVip],
  ["strip_legendary.png", makeStripLegendary],
];
for (const [name,fn] of strips) save(name, fn());

console.log("\n✅  All ECLIPSE v4 Tier assets generated.\n");
console.log("Next → run .\\scripts\\generate_wallet_assets_module.ps1\n");
