// ═══════════════════════════════════════════════════════════════════════════════
// generate_eclipse_wallet_assets.mjs  ── CINEMATIC v5
// Eclipse Apple Wallet — strip images @3x (1125×432 px)
//
// STANDARD   → SOLAR TOTALITY      — corona, chromosphere, eclipse sky
// PREMIUM    → AURORA MAXIMUS      — 7-curtain borealis + lake reflection
// VIP        → STELLAR FORGE       — Pillars of Creation nebula + OB stars
// LEGENDARY  → EVENT HORIZON       — photorealistic black hole + disk + jet
// ═══════════════════════════════════════════════════════════════════════════════

import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT   = join(__dir, '..', 'assets', 'wallet-pass');
try { mkdirSync(OUT, { recursive: true }); } catch {}

const W = 1125, H = 432;
const CX = W / 2, CY = H / 2;
const TAU = Math.PI * 2;
const PHI = (1 + Math.sqrt(5)) / 2;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/** Seeded LCG — no Math.random() anywhere */
function makeLcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
}

/** Blackbody color (Mitchell Charity approximation) — K → [r,g,b] 0-255 */
function kelvin(K) {
  K = Math.max(1000, Math.min(40000, K)) / 100;
  const clamp = v => Math.round(Math.max(0, Math.min(255, v)));
  let r, g, b;
  if (K <= 66) {
    r = 255;
    g = K <= 19 ? 0 : 99.4708025861 * Math.log(K - 10) - 161.1195681661;
    b = K >= 66 ? 255 : K <= 19 ? 0 : 138.5177312231 * Math.log(K - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(K - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(K - 60, -0.0755148492);
    b = 255;
  }
  return [clamp(r), clamp(g), clamp(b)];
}

/** Fibonacci star field — deterministic, uniform distribution */
function drawStars(ctx, n, rng, opts) {
  const alpha  = (opts && opts.alpha  != null) ? opts.alpha  : 0.8;
  const minSz  = (opts && opts.minSz  != null) ? opts.minSz  : 0.2;
  const maxSz  = (opts && opts.maxSz  != null) ? opts.maxSz  : 1.5;
  const sx     = (opts && opts.sx     != null) ? opts.sx     : CX * 1.05;
  const sy     = (opts && opts.sy     != null) ? opts.sy     : CY * 1.05;
  for (let i = 0; i < n; i++) {
    const theta = TAU * i * PHI;
    const r     = Math.sqrt(i / n);
    const x     = CX + r * sx * Math.cos(theta);
    const y     = CY + r * sy * Math.sin(theta);
    if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
    const sz    = minSz + rng() * maxSz;
    const a     = (0.25 + rng() * 0.75) * alpha;
    const temp  = 3500 + rng() * 22000;
    const col   = kelvin(temp);
    const sr = col[0], sg = col[1], sb = col[2];
    ctx.beginPath();
    ctx.arc(x, y, sz, 0, TAU);
    ctx.fillStyle = 'rgba(' + sr + ',' + sg + ',' + sb + ',' + a.toFixed(3) + ')';
    ctx.fill();
    if (sz > 1.0 && a > 0.55) {
      ctx.strokeStyle = 'rgba(' + sr + ',' + sg + ',' + sb + ',' + (a * 0.22).toFixed(3) + ')';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.moveTo(x - sz * 6, y); ctx.lineTo(x + sz * 6, y);
      ctx.moveTo(x, y - sz * 6); ctx.lineTo(x, y + sz * 6);
      ctx.stroke();
    }
  }
}

/** Film grain — cinematic texture */
function drawGrain(ctx, seed, intensity) {
  if (intensity == null) intensity = 0.02;
  const rng = makeLcg(seed || 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x += 2) {
      const v = rng();
      if (v < intensity * 3.5) {
        ctx.fillStyle = 'rgba(255,255,255,' + (v * 0.075).toFixed(4) + ')';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

/** Radial vignette */
function drawVignette(ctx, s) {
  if (s == null) s = 0.75;
  const g = ctx.createRadialGradient(CX, CY * 0.75, H * 0.12, CX, CY * 0.75, H * 0.88);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,' + s + ')');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Bottom bleed — seamless transition to pass body */
function drawBleed(ctx, r, g, b, from) {
  if (from == null) from = 0.42;
  const gr = ctx.createLinearGradient(0, H * from, 0, H);
  gr.addColorStop(0,   'rgba(' + r + ',' + g + ',' + b + ',0)');
  gr.addColorStop(0.5, 'rgba(' + r + ',' + g + ',' + b + ',0.55)');
  gr.addColorStop(1,   'rgba(' + r + ',' + g + ',' + b + ',1)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
}

function savePng(canvas, name) {
  const buf = canvas.toBuffer('image/png');
  writeFileSync(join(OUT, name), buf);
  console.log('  ' + name.padEnd(30) + (buf.length / 1024).toFixed(0) + ' KB');
  return buf;
}

// ═════════════════════════════════════════════════════════════════════════════
// STRIP 1: STANDARD — "SOLAR TOTALITY"
// ═════════════════════════════════════════════════════════════════════════════
function makeStripStandard() {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  const rng    = makeLcg(3001);

  const EX = CX - 15, EY = CY - 18;
  const MOON_R  = 115;
  const CHROM_R = MOON_R + 5;
  const INNER_R = MOON_R + 70;

  // 1. Eclipse sky — deep indigo-blue
  const sky = ctx.createRadialGradient(EX, EY, MOON_R, EX, EY, H * 1.4);
  sky.addColorStop(0,    'rgb(2,4,20)');
  sky.addColorStop(0.25, 'rgb(5,8,28)');
  sky.addColorStop(0.6,  'rgb(4,7,24)');
  sky.addColorStop(1,    'rgb(2,3,14)');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  // 2. Stars visible in totality
  drawStars(ctx, 260, rng, { alpha: 0.65, maxSz: 1.2 });

  // Venus (bright planet)
  const VX = EX - 290, VY = EY - 85;
  ctx.filter = 'blur(3px)';
  const venus = ctx.createRadialGradient(VX, VY, 0, VX, VY, 14);
  venus.addColorStop(0, 'rgba(255,245,210,1)');
  venus.addColorStop(1, 'rgba(255,240,180,0)');
  ctx.fillStyle = venus; ctx.beginPath(); ctx.arc(VX, VY, 14, 0, TAU); ctx.fill();
  ctx.filter = 'none';
  ctx.beginPath(); ctx.arc(VX, VY, 2.5, 0, TAU); ctx.fillStyle = 'rgba(255,248,220,1)'; ctx.fill();

  // Mars (red)
  ctx.beginPath(); ctx.arc(EX + 320, EY + 70, 1.8, 0, TAU); ctx.fillStyle = 'rgba(255,100,60,0.8)'; ctx.fill();

  // 3. Long helmet streamers
  const helmetAngles = [0.08, 0.22, -0.12, -0.06, Math.PI-0.08, Math.PI+0.15, Math.PI+0.28, Math.PI*0.48, Math.PI*1.5-0.05];
  ctx.save(); ctx.translate(EX, EY);
  for (const angle of helmetAngles) {
    const sLen = 260 + rng() * 160, sW = 5 + rng() * 14;
    const grad = ctx.createLinearGradient(
      Math.cos(angle)*CHROM_R, Math.sin(angle)*CHROM_R,
      Math.cos(angle)*(CHROM_R+sLen), Math.sin(angle)*(CHROM_R+sLen)
    );
    grad.addColorStop(0,    'rgba(235,246,255,0.50)');
    grad.addColorStop(0.1,  'rgba(220,238,255,0.28)');
    grad.addColorStop(0.4,  'rgba(210,230,255,0.12)');
    grad.addColorStop(0.75, 'rgba(200,220,255,0.04)');
    grad.addColorStop(1,    'rgba(190,215,255,0)');
    ctx.save(); ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(CHROM_R, -sW/2);
    ctx.quadraticCurveTo(sLen*0.5, sW*0.15, sLen+CHROM_R, sW*0.04);
    ctx.quadraticCurveTo(sLen*0.5, -sW*0.15, CHROM_R, sW/2);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Polar plumes
  ctx.save(); ctx.translate(EX, EY);
  for (const pa of [Math.PI/2-0.04, Math.PI/2+0.04, -Math.PI/2-0.05, -Math.PI/2+0.05]) {
    const pLen = 200 + rng() * 80;
    ctx.filter = 'blur(5px)';
    const pg = ctx.createLinearGradient(
      Math.cos(pa)*CHROM_R, Math.sin(pa)*CHROM_R,
      Math.cos(pa)*(CHROM_R+pLen), Math.sin(pa)*(CHROM_R+pLen)
    );
    pg.addColorStop(0, 'rgba(200,222,255,0.35)'); pg.addColorStop(1, 'rgba(190,215,255,0)');
    ctx.save(); ctx.rotate(pa);
    ctx.beginPath(); ctx.moveTo(CHROM_R,-28); ctx.lineTo(CHROM_R+pLen,-4); ctx.lineTo(CHROM_R+pLen,4); ctx.lineTo(CHROM_R,28); ctx.closePath();
    ctx.fillStyle = pg; ctx.fill(); ctx.restore();
  }
  ctx.filter = 'none'; ctx.restore();

  // 4. Fine corona ray texture (summed sines for realism)
  ctx.save(); ctx.translate(EX, EY);
  for (let i = 0; i < 500; i++) {
    const a = (i/500)*TAU;
    const rLen = INNER_R + 55*Math.sin(a*3+0.5) + 28*Math.sin(a*7+1.2) + 14*Math.sin(a*11+0.8) + 18*Math.sin(a*2+2.1) + 8*Math.sin(a*19+0.3);
    const al   = 0.035 + 0.075 * Math.pow(Math.abs(Math.sin(a*3)), 1.5);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a)*CHROM_R, Math.sin(a)*CHROM_R);
    ctx.lineTo(Math.cos(a)*rLen,   Math.sin(a)*rLen);
    ctx.strokeStyle = 'rgba(225,238,255,' + al.toFixed(4) + ')'; ctx.lineWidth = 0.55; ctx.stroke();
  }
  ctx.restore();

  // 5. Inner corona bloom — multiple passes
  ctx.save(); ctx.translate(EX, EY);
  const coronaLayers = [
    [INNER_R*2.8, 0.65, '215,232,255', 28],
    [INNER_R*2.0, 0.55, '228,242,255', 18],
    [INNER_R*1.4, 0.50, '242,250,255', 10],
    [INNER_R*1.0, 0.60, '255,255,255', 5 ],
  ];
  for (const [cr, ca, col, bl] of coronaLayers) {
    ctx.filter = 'blur(' + bl + 'px)';
    const g = ctx.createRadialGradient(0, 0, MOON_R*0.85, 0, 0, cr);
    g.addColorStop(0,   'rgba(' + col + ',' + ca + ')');
    g.addColorStop(0.5, 'rgba(' + col + ',' + (ca*0.35).toFixed(2) + ')');
    g.addColorStop(1,   'rgba(' + col + ',0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0,0,cr,0,TAU); ctx.fill();
  }
  ctx.filter = 'none'; ctx.restore();

  // 6. Chromosphere ring + Bailey's beads
  ctx.save(); ctx.translate(EX, EY);
  ctx.filter = 'blur(2px)';
  ctx.beginPath(); ctx.arc(0,0,CHROM_R,0,TAU); ctx.lineWidth = 5.5; ctx.strokeStyle = 'rgba(255,35,15,0.90)'; ctx.stroke();
  const bA = 2.62, bx = Math.cos(bA)*CHROM_R, by = Math.sin(bA)*CHROM_R;
  ctx.filter = 'blur(3.5px)';
  const bead = ctx.createRadialGradient(bx,by,0,bx,by,9);
  bead.addColorStop(0,'rgba(255,210,120,1)'); bead.addColorStop(1,'rgba(255,210,120,0)');
  ctx.fillStyle = bead; ctx.beginPath(); ctx.arc(bx,by,9,0,TAU); ctx.fill();
  ctx.filter = 'none'; ctx.restore();

  // 7. Moon — perfect black disc
  ctx.save(); ctx.translate(EX, EY);
  ctx.beginPath(); ctx.arc(0,0,MOON_R,0,TAU); ctx.fillStyle = 'rgb(0,0,0)'; ctx.fill();
  const es = ctx.createRadialGradient(-MOON_R*0.25,-MOON_R*0.25,0,0,0,MOON_R);
  es.addColorStop(0.82,'rgba(0,0,0,0)'); es.addColorStop(1,'rgba(15,22,40,0.12)');
  ctx.fillStyle = es; ctx.beginPath(); ctx.arc(0,0,MOON_R,0,TAU); ctx.fill();
  ctx.restore();

  drawVignette(ctx, 0.62);
  drawGrain(ctx, 101, 0.018);
  drawBleed(ctx, 3, 4, 12, 0.44);
  return canvas;
}

// ═════════════════════════════════════════════════════════════════════════════
// STRIP 2: PREMIUM — "AURORA MAXIMUS"
// ═════════════════════════════════════════════════════════════════════════════
function makeStripPremium() {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  const rng    = makeLcg(3002);

  const HORIZON = H * 0.64;

  // 1. Arctic sky + ground
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, 'rgb(0,1,10)'); sky.addColorStop(0.4,'rgb(0,4,14)'); sky.addColorStop(1,'rgb(0,9,12)');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  const gnd = ctx.createLinearGradient(0, HORIZON, 0, H);
  gnd.addColorStop(0,'rgb(0,9,12)'); gnd.addColorStop(1,'rgb(0,4,7)');
  ctx.fillStyle = gnd; ctx.fillRect(0, HORIZON, W, H - HORIZON);

  // 2. Stars
  drawStars(ctx, 200, rng, { alpha: 0.40, maxSz: 1.0, sy: CY * 0.95 });

  // 3. Aurora curtains
  const curtains = [
    { cx: 80,   w: 320, h: 240, hue: 130, sat: 80, lit: 24, a: 0.62, lean: -5 },
    { cx: 310,  w: 260, h: 300, hue: 163, sat: 95, lit: 30, a: 0.72, lean:  4 },
    { cx: 490,  w: 300, h: 270, hue: 142, sat: 88, lit: 26, a: 0.65, lean: -3 },
    { cx: 660,  w: 220, h: 330, hue: 172, sat: 98, lit: 35, a: 0.78, lean:  6 },
    { cx: 810,  w: 280, h: 255, hue: 126, sat: 75, lit: 22, a: 0.58, lean: -4 },
    { cx: 980,  w: 250, h: 285, hue: 155, sat: 90, lit: 28, a: 0.68, lean:  3 },
    { cx: 1110, w: 180, h: 220, hue: 138, sat: 82, lit: 20, a: 0.55, lean: -2 },
  ];

  for (const c of curtains) {
    const topY  = HORIZON - c.h;
    const leftX = c.cx - c.w / 2;

    // Main glow band
    ctx.filter = 'blur(22px)';
    const mg = ctx.createLinearGradient(0, topY, 0, HORIZON);
    mg.addColorStop(0,    'hsla(300,60%,30%,0)');
    mg.addColorStop(0.04, 'hsla(300,55%,32%,' + (c.a*0.28) + ')');
    mg.addColorStop(0.14, 'hsla(' + (c.hue+8) + ',' + c.sat + '%,' + (c.lit+12) + '%,' + (c.a*0.72) + ')');
    mg.addColorStop(0.42, 'hsla(' + c.hue + ',' + c.sat + '%,' + c.lit + '%,' + c.a + ')');
    mg.addColorStop(0.72, 'hsla(' + (c.hue-6) + ',' + (c.sat-8) + '%,' + (c.lit-4) + '%,' + (c.a*0.45) + ')');
    mg.addColorStop(1,    'hsla(' + c.hue + ',' + c.sat + '%,' + c.lit + '%,0)');
    ctx.fillStyle = mg; ctx.fillRect(leftX, topY, c.w, c.h);

    // Crisp ray shafts
    ctx.filter = 'none';
    const nRays = Math.floor(c.w / 6);
    for (let ri = 0; ri < nRays; ri++) {
      const rx    = leftX + c.lean * (ri/nRays) + (ri/nRays) * c.w;
      const rayH  = c.h * (0.38 + 0.5 * Math.abs(Math.sin(ri * PHI)));
      const rayA  = c.a * (0.12 + 0.32 * Math.abs(Math.sin(ri * PHI * 1.618)));
      const rayW  = 1.0 + rng() * 2.5;
      const rayG  = ctx.createLinearGradient(0, HORIZON - rayH, 0, HORIZON);
      rayG.addColorStop(0,    'hsla(' + (c.hue+5) + ',' + c.sat + '%,' + (c.lit+18) + '%,0)');
      rayG.addColorStop(0.18, 'hsla(' + (c.hue+5) + ',' + c.sat + '%,' + (c.lit+14) + '%,' + rayA + ')');
      rayG.addColorStop(0.65, 'hsla(' + c.hue + ',' + c.sat + '%,' + (c.lit+5) + '%,' + (rayA*0.85).toFixed(3) + ')');
      rayG.addColorStop(1,    'hsla(' + c.hue + ',' + c.sat + '%,' + c.lit + '%,0)');
      ctx.strokeStyle = rayG; ctx.lineWidth = rayW;
      ctx.beginPath(); ctx.moveTo(rx, HORIZON-rayH); ctx.lineTo(rx + c.lean*0.3, HORIZON); ctx.stroke();
    }
  }
  ctx.filter = 'none';

  // 4. Horizon glow
  ctx.filter = 'blur(10px)';
  const hg = ctx.createLinearGradient(0, HORIZON-18, 0, HORIZON+18);
  hg.addColorStop(0, 'rgba(15,70,35,0)'); hg.addColorStop(0.5,'rgba(15,70,35,0.22)'); hg.addColorStop(1,'rgba(10,50,25,0)');
  ctx.fillStyle = hg; ctx.fillRect(0, HORIZON-18, W, 36);
  ctx.filter = 'none';

  // 5. Reflection
  ctx.save(); ctx.globalAlpha = 0.28;
  for (const c of curtains) {
    const reflH = (c.h) * 0.32;
    ctx.filter = 'blur(28px)';
    const rg = ctx.createLinearGradient(0, HORIZON, 0, HORIZON+reflH);
    rg.addColorStop(0, 'hsla(' + c.hue + ',' + c.sat + '%,' + (c.lit+4) + '%,' + (c.a*0.7) + ')');
    rg.addColorStop(1, 'hsla(' + c.hue + ',' + c.sat + '%,' + c.lit + '%,0)');
    ctx.fillStyle = rg; ctx.fillRect(c.cx-c.w/2, HORIZON, c.w, reflH);
  }
  ctx.filter = 'none'; ctx.restore();

  ctx.strokeStyle = 'rgba(60,160,90,0.10)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, HORIZON); ctx.lineTo(W, HORIZON); ctx.stroke();

  drawVignette(ctx, 0.68);
  drawGrain(ctx, 102, 0.016);
  drawBleed(ctx, 0, 5, 10, 0.46);
  return canvas;
}

// ═════════════════════════════════════════════════════════════════════════════
// STRIP 3: VIP — "STELLAR FORGE"
// ═════════════════════════════════════════════════════════════════════════════
function makeStripVip() {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  const rng    = makeLcg(3003);

  // 1. Deep space bg
  const bg = ctx.createRadialGradient(CX,CY,60,CX,CY,H);
  bg.addColorStop(0,'rgb(12,3,20)'); bg.addColorStop(0.4,'rgb(8,2,15)'); bg.addColorStop(1,'rgb(4,1,8)');
  ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

  // 2. Background nebula glows
  ctx.filter = 'blur(45px)';
  const nebs = [
    [180,100,220,'160,25,45',0.38],[580,80,280,'20,150,130',0.28],
    [950,120,200,'100,15,35',0.30],[380,280,260,'60,10,100',0.25],[780,200,190,'15,120,110',0.22],
  ];
  for (const [nx,ny,nr,nc,na] of nebs) {
    const g = ctx.createRadialGradient(nx,ny,0,nx,ny,nr);
    g.addColorStop(0,'rgba('+nc+','+na+')'); g.addColorStop(1,'rgba('+nc+',0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  }
  ctx.filter = 'none';

  // 3. Stars
  drawStars(ctx, 340, rng, { alpha: 0.58, maxSz: 1.4 });

  // 4. H-alpha emission
  ctx.filter = 'blur(30px)';
  const ha = ctx.createLinearGradient(0,0,0,H*0.65);
  ha.addColorStop(0,'rgba(190,18,40,0.42)'); ha.addColorStop(0.45,'rgba(160,12,30,0.20)'); ha.addColorStop(1,'rgba(140,8,25,0)');
  ctx.fillStyle = ha; ctx.fillRect(0,0,W,H*0.65);
  ctx.filter = 'none';

  // 5. Gas pillars
  const pillars = [
    { cx:215, w:148, tipY:H*0.06,  leanPx:-8, col1:'85,14,18',  col2:'145,28,38' },
    { cx:560, w:190, tipY:H*-0.04, leanPx: 6, col1:'72,10,14',  col2:'132,22,32' },
    { cx:870, w:128, tipY:H*0.13,  leanPx:-5, col1:'65,11,16',  col2:'118,24,34' },
  ];

  for (const p of pillars) {
    const bY   = H + 30;
    const tX   = p.cx + p.leanPx;
    const tY   = p.tipY;
    const hw   = p.w / 2;

    ctx.filter = 'blur(2.5px)';
    const pilG = ctx.createLinearGradient(p.cx, tY, p.cx, bY);
    pilG.addColorStop(0,'rgba('+p.col1+',0.96)'); pilG.addColorStop(0.45,'rgba('+p.col2+',0.92)'); pilG.addColorStop(1,'rgba(18,4,4,1)');
    ctx.beginPath();
    ctx.moveTo(tX - hw*0.45, tY);
    ctx.bezierCurveTo(tX - hw*0.55, (tY+bY)*0.4, p.cx - hw, (tY+bY)*0.7, p.cx - hw, bY);
    ctx.lineTo(p.cx + hw, bY);
    ctx.bezierCurveTo(p.cx + hw, (tY+bY)*0.7, tX + hw*0.55, (tY+bY)*0.4, tX + hw*0.45, tY);
    ctx.closePath(); ctx.fillStyle = pilG; ctx.fill();

    ctx.filter = 'blur(7px)'; ctx.lineWidth = 5.5; ctx.strokeStyle = 'rgba(255,110,55,0.52)';
    ctx.beginPath(); ctx.moveTo(tX-hw*0.45,tY); ctx.bezierCurveTo(tX-hw*0.55,(tY+bY)*0.4,p.cx-hw,(tY+bY)*0.7,p.cx-hw,bY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tX+hw*0.45,tY); ctx.bezierCurveTo(tX+hw*0.55,(tY+bY)*0.4,p.cx+hw,(tY+bY)*0.7,p.cx+hw,bY); ctx.stroke();

    const eR = 16 + rng()*10;
    ctx.filter = 'blur(5px)';
    const egg = ctx.createRadialGradient(tX,tY,0,tX,tY,eR*1.8);
    egg.addColorStop(0,'rgba('+p.col2+',0.92)'); egg.addColorStop(0.55,'rgba(210,80,40,0.4)'); egg.addColorStop(1,'rgba(210,80,40,0)');
    ctx.fillStyle = egg; ctx.beginPath(); ctx.arc(tX,tY,eR*1.8,0,TAU); ctx.fill();

    ctx.filter = 'blur(2px)';
    const ps = ctx.createRadialGradient(tX,tY-eR*0.4,0,tX,tY-eR*0.4,eR*0.6);
    ps.addColorStop(0,'rgba(255,220,140,0.95)'); ps.addColorStop(1,'rgba(255,180,80,0)');
    ctx.fillStyle = ps; ctx.beginPath(); ctx.arc(tX,tY-eR*0.4,eR*0.6,0,TAU); ctx.fill();
    ctx.filter = 'none';
  }

  // 6. Protostellar jet
  const jX = 566, jY = pillars[1].tipY;
  ctx.filter = 'blur(5px)';
  const jetDirs = [[-1, 210, 0.80], [1, 130, 0.42]];
  for (const [dir, len, al] of jetDirs) {
    const jg = ctx.createLinearGradient(jX, jY, jX, jY + dir*len);
    jg.addColorStop(0,'rgba(120,210,255,'+al+')'); jg.addColorStop(0.45,'rgba(80,165,255,'+(al*0.4)+')'); jg.addColorStop(1,'rgba(60,120,255,0)');
    ctx.strokeStyle = jg; ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(jX,jY); ctx.lineTo(jX, jY+dir*len); ctx.stroke();
    ctx.filter = 'blur(14px)';
    const knot = ctx.createRadialGradient(jX,jY+dir*len,0,jX,jY+dir*len,28);
    knot.addColorStop(0,'rgba(100,195,255,'+(al*0.45)+')'); knot.addColorStop(1,'rgba(80,160,255,0)');
    ctx.fillStyle = knot; ctx.beginPath(); ctx.arc(jX,jY+dir*len,28,0,TAU); ctx.fill();
    ctx.filter = 'blur(5px)';
  }
  ctx.filter = 'none';

  // 7. Young OB stars
  const obStars = [
    [110,52,28000,3.8],[400,35,32000,4.2],[695,62,24000,3.2],
    [995,48,30000,3.6],[1070,82,22000,2.8],[258,78,19000,2.4],[822,88,26000,3.0],
  ];
  for (const [sx,sy,T,sr] of obStars) {
    const col = kelvin(T);
    const scr=col[0],scg=col[1],scb=col[2];
    ctx.filter = 'blur(' + (sr*4) + 'px)';
    const halo = ctx.createRadialGradient(sx,sy,0,sx,sy,sr*14);
    halo.addColorStop(0,'rgba('+scr+','+scg+','+scb+',0.85)'); halo.addColorStop(0.5,'rgba('+scr+','+scg+','+scb+',0.25)'); halo.addColorStop(1,'rgba('+scr+','+scg+','+scb+',0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(sx,sy,sr*14,0,TAU); ctx.fill();
    ctx.filter = 'none';
    ctx.beginPath(); ctx.arc(sx,sy,sr,0,TAU); ctx.fillStyle = 'rgb('+scr+','+scg+','+scb+')'; ctx.fill();
    ctx.strokeStyle = 'rgba('+scr+','+scg+','+scb+',0.35)'; ctx.lineWidth = 0.5;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 4;
      ctx.beginPath(); ctx.moveTo(sx+Math.cos(a)*sr, sy+Math.sin(a)*sr); ctx.lineTo(sx+Math.cos(a)*sr*22, sy+Math.sin(a)*sr*22); ctx.stroke();
    }
  }

  // 8. O-III teal overlay
  ctx.filter = 'blur(40px)';
  const oiii = ctx.createLinearGradient(W,0,0,H*0.55);
  oiii.addColorStop(0,'rgba(15,175,148,0.18)'); oiii.addColorStop(0.5,'rgba(8,155,130,0.10)'); oiii.addColorStop(1,'rgba(5,130,110,0)');
  ctx.fillStyle = oiii; ctx.fillRect(0,0,W,H*0.55);
  ctx.filter = 'none';

  drawVignette(ctx, 0.78);
  drawGrain(ctx, 103, 0.022);
  drawBleed(ctx, 5, 0, 8, 0.45);
  return canvas;
}

// ═════════════════════════════════════════════════════════════════════════════
// STRIP 4: LEGENDARY — "EVENT HORIZON"
// ═════════════════════════════════════════════════════════════════════════════
function makeStripLegendary() {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  const rng    = makeLcg(3004);

  const BHX   = CX + 10, BHY = CY + 8;
  const BH_R  = 70;
  const PHOT  = 82;
  const D_IN  = 78;
  const D_OUT = 292;
  const TILT  = 0.26;

  // 1. Void
  ctx.fillStyle = '#000000'; ctx.fillRect(0,0,W,H);

  // 2. ISM nebulosity
  ctx.filter = 'blur(55px)';
  const ism = [[BHX-240,BHY-80,320,'18,6,45',0.38],[BHX+230,BHY+90,280,'5,12,55',0.30],[BHX-50,BHY-140,200,'28,6,58',0.32]];
  for (const [ix,iy,ir,ic,ia] of ism) {
    const g = ctx.createRadialGradient(ix,iy,60,ix,iy,ir);
    g.addColorStop(0,'rgba('+ic+','+ia+')'); g.addColorStop(1,'rgba('+ic+',0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  }
  ctx.filter = 'none';

  // 3. Stars
  drawStars(ctx, 580, rng, { alpha: 0.82, maxSz: 1.5 });

  // 4. Outer disk bloom
  ctx.save(); ctx.translate(BHX,BHY); ctx.scale(1,TILT);
  ctx.filter = 'blur(38px)';
  const ob = ctx.createRadialGradient(0,0,D_IN,0,0,D_OUT*1.5);
  ob.addColorStop(0,'rgba(255,110,22,0.55)'); ob.addColorStop(0.35,'rgba(255,65,10,0.30)'); ob.addColorStop(0.65,'rgba(220,28,5,0.14)'); ob.addColorStop(1,'rgba(140,8,0,0)');
  ctx.fillStyle = ob; ctx.beginPath(); ctx.arc(0,0,D_OUT*1.5,0,TAU); ctx.fill();
  ctx.restore(); ctx.filter = 'none';

  // 5. Accretion disk — 65 concentric ellipses
  ctx.save(); ctx.translate(BHX,BHY);
  for (let i = 65; i >= 0; i--) {
    const t    = i / 65;
    const dR   = D_IN + t * (D_OUT - D_IN);
    const tempK = 18000 * Math.pow(1-t, 1.5) + 1800;
    const col  = kelvin(tempK);
    const cr=col[0],cg=col[1],cb=col[2];
    const bright = Math.pow(1-t, 1.65) * 0.92 + 0.04;
    ctx.beginPath();
    ctx.ellipse(0, 0, dR, dR*TILT, 0, 0, TAU);
    ctx.strokeStyle = 'rgba('+cr+','+cg+','+cb+','+bright.toFixed(3)+')';
    ctx.lineWidth = (D_OUT-D_IN)/65 * 1.9;
    ctx.stroke();
  }
  ctx.restore();

  // 6. Doppler boosting overlay
  ctx.save();
  ctx.beginPath(); ctx.ellipse(BHX,BHY,D_OUT*1.12,D_OUT*1.12*TILT,0,0,TAU); ctx.clip();
  const dop = ctx.createLinearGradient(BHX-D_OUT,BHY,BHX+D_OUT,BHY);
  dop.addColorStop(0,    'rgba(255,230,155,0.48)');
  dop.addColorStop(0.22, 'rgba(255,165,65,0.22)');
  dop.addColorStop(0.40, 'rgba(0,0,0,0)');
  dop.addColorStop(0.60, 'rgba(0,0,0,0)');
  dop.addColorStop(0.78, 'rgba(0,0,0,0.18)');
  dop.addColorStop(1,    'rgba(0,0,0,0.46)');
  ctx.fillStyle = dop; ctx.fillRect(BHX-D_OUT, BHY-D_OUT, D_OUT*2, D_OUT*2);
  ctx.restore();

  // 7. Inner disk ISCO blaze
  ctx.save(); ctx.translate(BHX,BHY); ctx.scale(1,TILT);
  ctx.filter = 'blur(7px)';
  const ih = ctx.createRadialGradient(0,0,D_IN*0.7,0,0,D_IN*2.6);
  ih.addColorStop(0,'rgba(215,240,255,0.88)'); ih.addColorStop(0.45,'rgba(195,215,255,0.42)'); ih.addColorStop(1,'rgba(175,200,255,0)');
  ctx.fillStyle = ih; ctx.beginPath(); ctx.arc(0,0,D_IN*2.6,0,TAU); ctx.fill();
  ctx.restore(); ctx.filter = 'none';

  // 8. Relativistic jets
  ctx.save(); ctx.translate(BHX,BHY);
  ctx.filter = 'blur(5px)';
  const jUp = ctx.createLinearGradient(0,-BH_R,0,-(BH_R+215));
  jUp.addColorStop(0,'rgba(165,225,255,0.92)'); jUp.addColorStop(0.35,'rgba(105,185,255,0.52)'); jUp.addColorStop(0.72,'rgba(80,148,255,0.18)'); jUp.addColorStop(1,'rgba(65,115,255,0)');
  ctx.fillStyle = jUp; ctx.fillRect(-5,-(BH_R+215),10,215);
  ctx.filter = 'blur(18px)';
  const jHalo = ctx.createLinearGradient(0,-BH_R,0,-(BH_R+200));
  jHalo.addColorStop(0,'rgba(130,210,255,0.38)'); jHalo.addColorStop(1,'rgba(90,170,255,0)');
  ctx.fillStyle = jHalo; ctx.fillRect(-22,-(BH_R+200),44,200);
  ctx.filter = 'blur(8px)';
  const jDn = ctx.createLinearGradient(0,BH_R,0,BH_R+110);
  jDn.addColorStop(0,'rgba(90,148,210,0.48)'); jDn.addColorStop(1,'rgba(70,115,185,0)');
  ctx.fillStyle = jDn; ctx.fillRect(-3.5,BH_R,7,110);
  ctx.filter = 'none'; ctx.restore();

  // 9. Einstein ring
  ctx.save(); ctx.translate(BHX,BHY);
  ctx.filter = 'blur(3.5px)';
  ctx.beginPath(); ctx.ellipse(0,0,PHOT*1.38,PHOT*1.38*(TILT+0.06),0,0,TAU);
  ctx.lineWidth = 2.8; ctx.strokeStyle = 'rgba(255,185,80,0.28)'; ctx.stroke();
  ctx.filter = 'none'; ctx.restore();

  // 10. Photon sphere
  ctx.save(); ctx.translate(BHX,BHY);
  ctx.filter = 'blur(4px)';
  ctx.beginPath(); ctx.arc(0,0,PHOT,0,TAU);
  ctx.lineWidth = 3.8; ctx.strokeStyle = 'rgba(255,158,58,0.58)'; ctx.stroke();
  ctx.filter = 'none'; ctx.restore();

  // 11. Event horizon
  ctx.save(); ctx.translate(BHX,BHY);
  ctx.beginPath(); ctx.arc(0,0,BH_R,0,TAU); ctx.fillStyle = 'rgb(0,0,0)'; ctx.fill();
  ctx.restore();

  drawVignette(ctx, 0.82);
  drawGrain(ctx, 104, 0.013);
  drawBleed(ctx, 0, 0, 0, 0.50);
  return canvas;
}

// ═════════════════════════════════════════════════════════════════════════════
// ICON — Solar eclipse mark
// ═════════════════════════════════════════════════════════════════════════════
function makeIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx    = canvas.getContext('2d');
  const cx = size/2, cy = size/2, R = size*0.38;
  ctx.fillStyle = 'rgb(4,4,12)'; ctx.fillRect(0,0,size,size);
  ctx.filter = 'blur(18px)';
  const glow = ctx.createRadialGradient(cx,cy,R*0.6,cx,cy,R*1.5);
  glow.addColorStop(0,'rgba(215,228,255,0.80)'); glow.addColorStop(0.5,'rgba(200,218,255,0.35)'); glow.addColorStop(1,'rgba(180,210,255,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx,cy,R*1.5,0,TAU); ctx.fill(); ctx.filter = 'none';
  const rng = makeLcg(42);
  for (let i = 0; i < 12; i++) {
    const a = (i/12)*TAU, len = R*(1.35+rng()*0.4);
    ctx.beginPath(); ctx.moveTo(cx+Math.cos(a)*R,cy+Math.sin(a)*R); ctx.lineTo(cx+Math.cos(a)*len,cy+Math.sin(a)*len);
    ctx.strokeStyle = 'rgba(220,235,255,'+(0.35+rng()*0.25)+')'; ctx.lineWidth = R*0.04; ctx.stroke();
  }
  ctx.filter = 'blur(2px)';
  ctx.beginPath(); ctx.arc(cx,cy,R+2,0,TAU); ctx.lineWidth = size*0.018; ctx.strokeStyle = 'rgba(255,50,20,0.85)'; ctx.stroke();
  ctx.filter = 'none';
  ctx.beginPath(); ctx.arc(cx,cy,R,0,TAU); ctx.fillStyle = 'rgb(0,0,0)'; ctx.fill();
  const dotR = size*0.072, dotX = cx+R*0.68, dotY = cy-R*0.68;
  ctx.filter = 'blur(4px)';
  const dot = ctx.createRadialGradient(dotX,dotY,0,dotX,dotY,dotR*1.8);
  dot.addColorStop(0,'rgba(255,185,60,1)'); dot.addColorStop(1,'rgba(255,140,20,0)');
  ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(dotX,dotY,dotR*1.8,0,TAU); ctx.fill();
  ctx.filter = 'none';
  ctx.beginPath(); ctx.arc(dotX,dotY,dotR,0,TAU); ctx.fillStyle = 'rgb(255,195,70)'; ctx.fill();
  return canvas;
}

// ═════════════════════════════════════════════════════════════════════════════
// LOGO — ECLIPSE wordmark
// ═════════════════════════════════════════════════════════════════════════════
function makeLogo() {
  const LW = 600, LH = 120;
  const canvas = createCanvas(LW, LH);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,LW,LH);
  ctx.fillStyle = 'rgb(255,255,255)';
  ctx.font = '900 62px "Arial Black", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('ECLIPSE', 14, LH/2 - 4);
  ctx.fillStyle = 'rgba(255,180,60,0.88)';
  ctx.fillRect(14, LH-14, 540, 2);
  return canvas;
}

// ═════════════════════════════════════════════════════════════════════════════
// FOOTER
// ═════════════════════════════════════════════════════════════════════════════
function makeFooter() {
  const FW = 640, FH = 30;
  const canvas = createCanvas(FW, FH);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,FW,FH);
  const g = ctx.createLinearGradient(0, FH/2, FW, FH/2);
  g.addColorStop(0,'rgba(255,175,50,0)'); g.addColorStop(0.15,'rgba(255,175,50,0.6)');
  g.addColorStop(0.85,'rgba(255,175,50,0.6)'); g.addColorStop(1,'rgba(255,175,50,0)');
  ctx.fillStyle = g; ctx.fillRect(0, FH/2-1, FW, 2);
  return canvas;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n  Eclipse Wallet Assets — Cinematic v5\n');

savePng(makeStripStandard(), 'strip_standard.png');
savePng(makeStripPremium(),  'strip_premium.png');
savePng(makeStripVip(),      'strip_vip.png');
savePng(makeStripLegendary(),'strip_legendary.png');

savePng(makeIcon(300), 'icon.png');
savePng(makeIcon(600), 'icon@2x.png');
savePng(makeIcon(900), 'icon@3x.png');

savePng(makeLogo(), 'logo.png');
savePng(makeLogo(), 'logo@2x.png');
savePng(makeLogo(), 'logo@3x.png');

savePng(makeFooter(), 'footer.png');
savePng(makeFooter(), 'footer@2x.png');
savePng(makeFooter(), 'footer@3x.png');

console.log('\n  Done.\n');
