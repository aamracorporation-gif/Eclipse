// ═══════════════════════════════════════════════════════════════════════════════
// generate_eclipse_wallet_assets.mjs  ──  PHENOMENA EDITION
// Eclipse Apple Wallet — 4 completely original visual concepts
//
// GENERAL   → "DEEP OCEAN"     — bioluminescent organisms in total darkness
// VIP       → "LIQUID GOLD"    — molten gold droplets, caustics, luxury surface
// BACKSTAGE → "LAVA FIELD"     — matte black volcanic crust + incandescent cracks
// FASTLANE  → "LIGHT BREAK"    — white light shattering into full spectrum
//
// Strip dimensions: 1125 × 432 px  (@3x)
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

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function makeLcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
}

function drawGrain(ctx, seed, strength) {
  strength = strength || 0.018;
  const rng = makeLcg(seed || 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x += 2) {
      const v = rng();
      if (v < strength * 4) {
        ctx.fillStyle = 'rgba(255,255,255,' + (v * 0.065).toFixed(4) + ')';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

function drawBleed(ctx, r, g, b, from) {
  from = from || 0.40;
  const gr = ctx.createLinearGradient(0, H * from, 0, H);
  gr.addColorStop(0,   'rgba(' + r + ',' + g + ',' + b + ',0)');
  gr.addColorStop(0.55,'rgba(' + r + ',' + g + ',' + b + ',0.65)');
  gr.addColorStop(1,   'rgba(' + r + ',' + g + ',' + b + ',1)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
}

function drawVignette(ctx, s) {
  s = s || 0.7;
  const g = ctx.createRadialGradient(CX, CY * 0.7, H * 0.08, CX, CY * 0.7, H * 0.92);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,' + s + ')');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function savePng(canvas, name) {
  const buf = canvas.toBuffer('image/png');
  writeFileSync(join(OUT, name), buf);
  console.log('  ' + name.padEnd(32) + (buf.length / 1024).toFixed(0) + ' KB');
}

// ═════════════════════════════════════════════════════════════════════════════
//  GENERAL  ──  "DEEP OCEAN"
//
//  Total darkness of the deep ocean floor. Hundreds of bioluminescent organisms
//  glow in electric cyan and blue — some tiny (bacteria), some large (medusae).
//  Faint vertical "marine snow" particles drift downward.
//  The abyss: mysterious, alive, beautiful.
// ═════════════════════════════════════════════════════════════════════════════
function makeStripGeneral() {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  const rng    = makeLcg(5001);

  // 1. Absolute deep ocean darkness — not pure black, has the faintest deep teal
  const bg = ctx.createLinearGradient(0, 0, W * 0.6, H);
  bg.addColorStop(0,   'rgb(0,3,14)');
  bg.addColorStop(0.5, 'rgb(0,5,18)');
  bg.addColorStop(1,   'rgb(0,2,10)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 2. Faint bioluminescent "fog" zones — diffuse glowing patches deep in water
  ctx.filter = 'blur(60px)';
  const fogZones = [
    [220, 180, 200, '0,200,220', 0.07],
    [680, 100, 240, '0,180,210', 0.05],
    [950, 280, 180, '0,160,200', 0.06],
    [420, 340, 160, '20,180,200', 0.05],
  ];
  for (const [fx, fy, fr, fc, fa] of fogZones) {
    const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
    g.addColorStop(0, 'rgba(' + fc + ',' + fa + ')');
    g.addColorStop(1, 'rgba(' + fc + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.filter = 'none';

  // 3. LARGE MEDUSAE (jellyfish-like organisms) — 6 of them
  const medusae = [];
  for (let i = 0; i < 6; i++) {
    medusae.push({
      x: rng() * W,
      y: rng() * H,
      r: 28 + rng() * 55,
      hue: 175 + rng() * 40, // cyan to teal range
      alpha: 0.25 + rng() * 0.40,
    });
  }
  for (const m of medusae) {
    // Soft outer glow
    ctx.filter = 'blur(20px)';
    const mg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 2.2);
    mg.addColorStop(0,   'hsla(' + m.hue + ',100%,65%,' + m.alpha + ')');
    mg.addColorStop(0.4, 'hsla(' + m.hue + ',100%,55%,' + (m.alpha * 0.5) + ')');
    mg.addColorStop(1,   'hsla(' + m.hue + ',100%,45%,0)');
    ctx.fillStyle = mg;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 2.2, 0, TAU); ctx.fill();

    // Crisp bell (semi-transparent dome)
    ctx.filter = 'blur(2px)';
    const bell = ctx.createRadialGradient(m.x - m.r * 0.2, m.y - m.r * 0.25, 0, m.x, m.y, m.r);
    bell.addColorStop(0,   'hsla(' + m.hue + ',100%,88%,' + (m.alpha * 0.9) + ')');
    bell.addColorStop(0.5, 'hsla(' + m.hue + ',100%,65%,' + (m.alpha * 0.55) + ')');
    bell.addColorStop(0.85,'hsla(' + m.hue + ',100%,50%,' + (m.alpha * 0.2) + ')');
    bell.addColorStop(1,   'hsla(' + m.hue + ',100%,45%,0)');
    ctx.fillStyle = bell;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.fill();
    ctx.filter = 'none';

    // Tentacles — thin glowing threads hanging down
    const nTent = 5 + Math.floor(rng() * 6);
    for (let t = 0; t < nTent; t++) {
      const tx  = m.x + (t / nTent - 0.5) * m.r * 1.6;
      const len = m.r * (1.5 + rng() * 2.5);
      const tg  = ctx.createLinearGradient(tx, m.y + m.r * 0.4, tx + (rng() - 0.5) * 20, m.y + m.r * 0.4 + len);
      tg.addColorStop(0, 'hsla(' + m.hue + ',100%,75%,' + (m.alpha * 0.7) + ')');
      tg.addColorStop(1, 'hsla(' + m.hue + ',100%,60%,0)');
      ctx.strokeStyle = tg;
      ctx.lineWidth = 0.8 + rng() * 0.8;
      ctx.filter = 'blur(1px)';
      ctx.beginPath();
      ctx.moveTo(tx, m.y + m.r * 0.4);
      ctx.quadraticCurveTo(tx + (rng() - 0.5) * m.r * 0.5, m.y + m.r + len * 0.4, tx + (rng() - 0.5) * 12, m.y + m.r * 0.4 + len);
      ctx.stroke();
      ctx.filter = 'none';
    }
  }

  // 4. SMALL ORGANISMS — hundreds of tiny glowing points
  // Three size classes: micro, small, medium
  const organisms = [
    { n: 180, rMin: 0.6, rMax: 1.8, aMin: 0.35, aMax: 0.85, hMin: 175, hVar: 50, bloom: 6  },
    { n: 80,  rMin: 1.8, rMax: 3.5, aMin: 0.50, aMax: 0.95, hMin: 170, hVar: 55, bloom: 12 },
    { n: 30,  rMin: 3.5, rMax: 6.0, aMin: 0.60, aMax: 1.00, hMin: 165, hVar: 60, bloom: 22 },
  ];

  for (const tier of organisms) {
    for (let i = 0; i < tier.n; i++) {
      const x    = rng() * W;
      const y    = rng() * H;
      const r    = tier.rMin + rng() * (tier.rMax - tier.rMin);
      const a    = tier.aMin + rng() * (tier.aMax - tier.aMin);
      const hue  = tier.hMin + rng() * tier.hVar;

      // Bloom
      ctx.filter = 'blur(' + (tier.bloom * 0.6) + 'px)';
      const bloom = ctx.createRadialGradient(x, y, 0, x, y, tier.bloom);
      bloom.addColorStop(0, 'hsla(' + hue + ',100%,70%,' + (a * 0.5) + ')');
      bloom.addColorStop(1, 'hsla(' + hue + ',100%,55%,0)');
      ctx.fillStyle = bloom;
      ctx.beginPath(); ctx.arc(x, y, tier.bloom, 0, TAU); ctx.fill();

      // Core
      ctx.filter = 'none';
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = 'hsla(' + hue + ',100%,90%,' + a + ')';
      ctx.fill();
    }
  }

  // 5. Marine snow — tiny white particles drifting
  ctx.filter = 'blur(0.5px)';
  for (let i = 0; i < 120; i++) {
    const sx = rng() * W, sy = rng() * H;
    const sa = 0.08 + rng() * 0.18;
    const ss = 0.4 + rng() * 0.6;
    ctx.beginPath(); ctx.arc(sx, sy, ss, 0, TAU);
    ctx.fillStyle = 'rgba(180,220,230,' + sa.toFixed(3) + ')';
    ctx.fill();
  }
  ctx.filter = 'none';

  // 6. Top-to-bottom pressure gradient (very subtle — deeper = darker)
  const pressure = ctx.createLinearGradient(0, 0, 0, H);
  pressure.addColorStop(0, 'rgba(0,0,0,0.18)');
  pressure.addColorStop(0.5, 'rgba(0,0,0,0)');
  pressure.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pressure; ctx.fillRect(0, 0, W, H);

  drawVignette(ctx, 0.72);
  drawGrain(ctx, 201, 0.015);
  drawBleed(ctx, 0, 5, 16, 0.45);
  return canvas;
}

// ═════════════════════════════════════════════════════════════════════════════
//  VIP  ──  "LIQUID GOLD"
//
//  A mass of molten gold suspended in zero gravity — spherical droplets with
//  perfect specular highlights, caustic light patterns reflected on dark
//  surfaces, liquid surface with ripple rings. The definition of VIP luxury.
// ═════════════════════════════════════════════════════════════════════════════
function makeStripVip() {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  const rng    = makeLcg(5002);

  // 1. Warm void background — almost black with warmth
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0,   'rgb(10,6,0)');
  bg.addColorStop(0.5, 'rgb(14,8,0)');
  bg.addColorStop(1,   'rgb(8,4,0)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // 2. Ambient golden atmosphere — warm glow filling the space
  ctx.filter = 'blur(80px)';
  const ambientZones = [
    [CX - 150, CY - 40, 380, '200,120,0', 0.18],
    [CX + 200, CY + 60, 300, '180,100,0', 0.14],
    [CX - 300, CY + 80, 250, '220,140,0', 0.12],
  ];
  for (const [ax, ay, ar, ac, aa] of ambientZones) {
    const g = ctx.createRadialGradient(ax, ay, 0, ax, ay, ar);
    g.addColorStop(0, 'rgba(' + ac + ',' + aa + ')');
    g.addColorStop(1, 'rgba(' + ac + ',0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.filter = 'none';

  // 3. CAUSTIC LIGHT PATTERNS — light refracted through gold surface
  // These are bright, curvy lines of concentrated light
  ctx.filter = 'blur(3px)';
  const nCaustics = 35;
  for (let i = 0; i < nCaustics; i++) {
    const cx2  = rng() * W;
    const cy2  = rng() * H;
    const len  = 40 + rng() * 120;
    const curv = (rng() - 0.5) * 80;
    const ang  = rng() * TAU;
    const alpha = 0.08 + rng() * 0.22;
    const width = 0.8 + rng() * 2.5;
    const hue   = 38 + rng() * 20; // amber-gold range

    const cg = ctx.createLinearGradient(
      cx2, cy2,
      cx2 + Math.cos(ang) * len, cy2 + Math.sin(ang) * len
    );
    cg.addColorStop(0,   'hsla(' + hue + ',100%,70%,0)');
    cg.addColorStop(0.3, 'hsla(' + hue + ',100%,78%,' + alpha + ')');
    cg.addColorStop(0.7, 'hsla(' + hue + ',100%,72%,' + alpha + ')');
    cg.addColorStop(1,   'hsla(' + hue + ',100%,60%,0)');

    ctx.strokeStyle = cg; ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cx2, cy2);
    ctx.quadraticCurveTo(
      cx2 + Math.cos(ang + Math.PI / 2) * curv,
      cy2 + Math.sin(ang + Math.PI / 2) * curv,
      cx2 + Math.cos(ang) * len, cy2 + Math.sin(ang) * len
    );
    ctx.stroke();
  }
  ctx.filter = 'none';

  // 4. LIQUID GOLD DROPLETS — the hero element
  // Droplets of different sizes, each with realistic sphere shading:
  //   - Dark rim at edge (Fresnel)
  //   - Deep gold mid-tones
  //   - Bright specular highlight (off-center, simulating top light)
  //   - White hot specular peak (tiny)
  const droplets = [];
  // Large hero droplets
  for (let i = 0; i < 5; i++) {
    droplets.push({ x: 100 + rng() * (W - 200), y: 50 + rng() * (H - 100), r: 40 + rng() * 70, primary: true });
  }
  // Medium droplets
  for (let i = 0; i < 12; i++) {
    droplets.push({ x: rng() * W, y: rng() * H, r: 15 + rng() * 35, primary: false });
  }
  // Small splash droplets
  for (let i = 0; i < 25; i++) {
    droplets.push({ x: rng() * W, y: rng() * H, r: 4 + rng() * 12, primary: false });
  }
  // Sort by size (paint large first)
  droplets.sort((a, b) => b.r - a.r);

  for (const d of droplets) {
    const { x, y, r } = d;

    // Outer glow (ambient reflection from gold surface)
    ctx.filter = 'blur(' + (r * 0.5) + 'px)';
    const outerGlow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.0);
    outerGlow.addColorStop(0, 'rgba(220,160,0,0.30)');
    outerGlow.addColorStop(0.5, 'rgba(200,130,0,0.12)');
    outerGlow.addColorStop(1, 'rgba(180,100,0,0)');
    ctx.fillStyle = outerGlow;
    ctx.beginPath(); ctx.arc(x, y, r * 2, 0, TAU); ctx.fill();

    // Sphere body — dark edge (Fresnel), gold mid, highlight
    ctx.filter = 'none';
    const body = ctx.createRadialGradient(
      x - r * 0.30, y - r * 0.28, r * 0.02,  // light source offset (upper-left)
      x, y, r
    );
    body.addColorStop(0,   'rgba(255,245,180,0.98)'); // specular highlight center
    body.addColorStop(0.12,'rgba(255,220,80,0.96)');  // bright gold
    body.addColorStop(0.35,'rgba(225,165,0,0.94)');   // deep gold
    body.addColorStop(0.62,'rgba(180,115,0,0.92)');   // shadowed gold
    body.addColorStop(0.82,'rgba(120,65,0,0.90)');    // dark edge
    body.addColorStop(1,   'rgba(60,25,0,0.88)');     // Fresnel rim
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();

    // Specular highlight — white hot peak
    const specX = x - r * 0.28, specY = y - r * 0.26;
    const specR  = r * 0.18;
    ctx.filter = 'blur(' + (specR * 0.4) + 'px)';
    const spec = ctx.createRadialGradient(specX, specY, 0, specX, specY, specR);
    spec.addColorStop(0, 'rgba(255,255,240,0.95)');
    spec.addColorStop(0.5,'rgba(255,250,200,0.45)');
    spec.addColorStop(1, 'rgba(255,240,160,0)');
    ctx.fillStyle = spec;
    ctx.beginPath(); ctx.arc(specX, specY, specR * 1.5, 0, TAU); ctx.fill();
    ctx.filter = 'none';

    // Contact shadow (below larger droplets)
    if (r > 25) {
      ctx.filter = 'blur(' + (r * 0.35) + 'px)';
      const shadow = ctx.createRadialGradient(x, y + r * 0.85, 0, x, y + r * 0.85, r * 1.1);
      shadow.addColorStop(0, 'rgba(0,0,0,0.40)');
      shadow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = shadow;
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.85, r * 1.1, r * 0.3, 0, 0, TAU); ctx.fill();
      ctx.filter = 'none';
    }
  }

  // 5. Ripple rings on liquid surface — top portion
  // These suggest the droplets just landed on a liquid gold surface
  const rippleSources = [
    { x: CX - 180, y: H * 0.25, maxR: 180, n: 4 },
    { x: CX + 220, y: H * 0.35, maxR: 140, n: 3 },
    { x: CX - 50,  y: H * 0.18, maxR: 100, n: 3 },
  ];
  for (const rs of rippleSources) {
    for (let ri = 0; ri < rs.n; ri++) {
      const frac   = (ri + 0.5) / rs.n;
      const ripR   = rs.maxR * frac;
      const ripA   = 0.25 * (1 - frac);
      ctx.filter   = 'blur(1.5px)';
      ctx.beginPath();
      ctx.ellipse(rs.x, rs.y, ripR, ripR * 0.28, 0, 0, TAU);
      ctx.strokeStyle = 'rgba(220,165,0,' + ripA.toFixed(3) + ')';
      ctx.lineWidth   = 1.2 - frac * 0.8;
      ctx.stroke();
    }
  }
  ctx.filter = 'none';

  drawVignette(ctx, 0.68);
  drawGrain(ctx, 202, 0.016);
  drawBleed(ctx, 8, 5, 0, 0.42);
  return canvas;
}

// ═════════════════════════════════════════════════════════════════════════════
//  BACKSTAGE  ──  "LAVA FIELD"
//
//  Aerial view of a solidified lava field at night. The matte black volcanic
//  crust is fractured into an irregular network of cracks revealing the
//  incandescent molten rock below. Three layers of glow per crack: wide orange
//  ambient heat, medium amber light, white-yellow burning core.
// ═════════════════════════════════════════════════════════════════════════════
function makeStripBackstage() {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  const rng    = makeLcg(5003);

  // 1. Matte black volcanic rock
  ctx.fillStyle = 'rgb(4,2,1)'; ctx.fillRect(0, 0, W, H);

  // 2. Very faint ambient heat haze — a barely visible warm glow
  ctx.filter = 'blur(80px)';
  const haze = ctx.createRadialGradient(CX, CY, 0, CX, CY, W * 0.7);
  haze.addColorStop(0,   'rgba(80,20,0,0.12)');
  haze.addColorStop(0.6, 'rgba(50,10,0,0.06)');
  haze.addColorStop(1,   'rgba(20,5,0,0)');
  ctx.fillStyle = haze; ctx.fillRect(0, 0, W, H);
  ctx.filter = 'none';

  // 3. CRACK NETWORK — Voronoi-like fracture pattern
  // Generate seed points, then connect nearby seeds with cracks
  const N_SEEDS = 42;
  const seeds   = [];
  for (let i = 0; i < N_SEEDS; i++) {
    seeds.push({ x: rng() * W, y: rng() * H });
  }

  // Collect all crack segments (pair of nearby seeds)
  const MAX_DIST  = 200;
  const crackSegs = [];
  for (let i = 0; i < seeds.length; i++) {
    for (let j = i + 1; j < seeds.length; j++) {
      const dx = seeds[j].x - seeds[i].x;
      const dy = seeds[j].y - seeds[i].y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < MAX_DIST && rng() < 0.65) {
        // Midpoint with slight offset — makes cracks look natural
        const mx = (seeds[i].x + seeds[j].x) / 2 + (rng() - 0.5) * 30;
        const my = (seeds[i].y + seeds[j].y) / 2 + (rng() - 0.5) * 30;
        const heat = 0.4 + rng() * 0.6; // crack heat intensity
        crackSegs.push({ x1: seeds[i].x, y1: seeds[i].y, mx, my, x2: seeds[j].x, y2: seeds[j].y, heat });
      }
    }
  }

  // Add a few forced horizontal / diagonal cracks for composition
  const forcedCracks = [
    { x1: 0,    y1: CY - 40, mx: CX * 0.5,  my: CY - 20, x2: CX,   y2: CY + 10,  heat: 0.9 },
    { x1: CX,   y1: CY + 10, mx: CX * 1.5,  my: CY - 30, x2: W,    y2: CY - 50,  heat: 0.85 },
    { x1: 150,  y1: 0,       mx: 180,        my: CY * 0.6, x2: 220,  y2: H,        heat: 0.75 },
    { x1: 600,  y1: 0,       mx: 580,        my: CY,       x2: 560,  y2: H,        heat: 0.80 },
    { x1: 900,  y1: 60,      mx: 880,        my: CY * 0.8, x2: 860,  y2: H - 40,  heat: 0.70 },
  ];
  crackSegs.push(...forcedCracks);

  // Draw each crack in 3 passes (wide glow → medium → bright core)
  const crackPasses = [
    { blur: 18, width: 18, colFn: h => 'rgba(200,' + Math.round(50+h*60) + ',0,' + (h*0.35).toFixed(3) + ')' },
    { blur: 6,  width: 7,  colFn: h => 'rgba(240,' + Math.round(100+h*80) + ',0,' + (h*0.55).toFixed(3) + ')' },
    { blur: 1,  width: 2,  colFn: h => 'rgba(255,' + Math.round(200+h*55) + ',30,' + (h*0.90).toFixed(3) + ')' },
  ];

  for (const pass of crackPasses) {
    ctx.filter = 'blur(' + pass.blur + 'px)';
    for (const c of crackSegs) {
      ctx.beginPath();
      ctx.moveTo(c.x1, c.y1);
      ctx.quadraticCurveTo(c.mx, c.my, c.x2, c.y2);
      ctx.strokeStyle = pass.colFn(c.heat);
      ctx.lineWidth   = pass.width;
      ctx.lineCap     = 'round';
      ctx.stroke();
    }
  }
  ctx.filter = 'none';

  // 4. LAVA POOLS — open areas of fully molten rock (at crack junctions)
  const poolCenters = [];
  // Find highly connected seeds
  for (let i = 0; i < seeds.length; i++) {
    let connections = 0;
    for (const c of crackSegs) {
      const isEndpoint =
        (Math.abs(c.x1 - seeds[i].x) < 5 && Math.abs(c.y1 - seeds[i].y) < 5) ||
        (Math.abs(c.x2 - seeds[i].x) < 5 && Math.abs(c.y2 - seeds[i].y) < 5);
      if (isEndpoint) connections++;
    }
    if (connections >= 2 && rng() < 0.30) {
      poolCenters.push({ x: seeds[i].x, y: seeds[i].y, r: 8 + rng() * 22 });
    }
  }

  for (const p of poolCenters) {
    // Wide heat glow
    ctx.filter = 'blur(20px)';
    const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
    pg.addColorStop(0,   'rgba(255,180,0,0.60)');
    pg.addColorStop(0.4, 'rgba(255,100,0,0.30)');
    pg.addColorStop(1,   'rgba(200,50,0,0)');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3, 0, TAU); ctx.fill();
    // Bright pool surface
    ctx.filter = 'blur(3px)';
    const ps = ctx.createRadialGradient(p.x - p.r * 0.2, p.y - p.r * 0.15, 0, p.x, p.y, p.r);
    ps.addColorStop(0,   'rgba(255,240,100,0.95)');
    ps.addColorStop(0.4, 'rgba(255,180,20,0.88)');
    ps.addColorStop(0.8, 'rgba(230,80,0,0.70)');
    ps.addColorStop(1,   'rgba(180,30,0,0)');
    ctx.fillStyle = ps; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  }
  ctx.filter = 'none';

  // 5. Cool dark rock texture overlay (slight noise pattern to avoid flat black)
  drawGrain(ctx, 203, 0.025);

  drawVignette(ctx, 0.80);
  drawBleed(ctx, 5, 2, 0, 0.48);
  return canvas;
}

// ═════════════════════════════════════════════════════════════════════════════
//  FASTLANE  ──  "LIGHT BREAK"
//
//  A beam of pure white light smashes into a prism point at center-left and
//  EXPLODES into the full visible spectrum — 7 spectral bands fan out to the
//  right edge. The left side of the image is pure white-hot; the right is a
//  perfect rainbow. Speed, energy, clarity.
// ═════════════════════════════════════════════════════════════════════════════
function makeStripFastlane() {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  const rng    = makeLcg(5004);

  // 1. Pure void
  ctx.fillStyle = 'rgb(0,0,4)'; ctx.fillRect(0, 0, W, H);

  // The prism/burst point — left of center
  const BX = W * 0.28, BY = CY;

  // 2. INPUT BEAM (white light entering from left)
  ctx.filter = 'blur(12px)';
  const beamG = ctx.createLinearGradient(0, BY, BX, BY);
  beamG.addColorStop(0, 'rgba(255,255,255,0)');
  beamG.addColorStop(0.6,'rgba(255,255,255,0.50)');
  beamG.addColorStop(1,  'rgba(255,255,255,0.90)');
  ctx.fillStyle = beamG;
  ctx.fillRect(0, BY - 14, BX, 28);
  ctx.filter = 'blur(3px)';
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillRect(0, BY - 5, BX, 10);
  ctx.filter = 'none';

  // 3. CENTRAL PRISM BURST — intense white flash
  ctx.filter = 'blur(28px)';
  const burst = ctx.createRadialGradient(BX, BY, 0, BX, BY, 200);
  burst.addColorStop(0,   'rgba(255,255,255,0.95)');
  burst.addColorStop(0.15,'rgba(255,255,255,0.60)');
  burst.addColorStop(0.35,'rgba(240,240,255,0.25)');
  burst.addColorStop(1,   'rgba(200,200,255,0)');
  ctx.fillStyle = burst; ctx.beginPath(); ctx.arc(BX, BY, 200, 0, TAU); ctx.fill();
  ctx.filter = 'blur(8px)';
  const burst2 = ctx.createRadialGradient(BX, BY, 0, BX, BY, 50);
  burst2.addColorStop(0, 'rgba(255,255,255,1)');
  burst2.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = burst2; ctx.beginPath(); ctx.arc(BX, BY, 50, 0, TAU); ctx.fill();
  ctx.filter = 'none';

  // 4. SPECTRAL RAYS — the key element
  // The spectrum fans out from BX,BY toward the right edge
  // 7 colors, each a band of 3–4 closely-spaced rays
  // Angle range: from -35° (top, violet) to +35° (bottom, red)
  const spectrumBands = [
    { color: '148,0,211',   name: 'violet',  angleCenter: -0.61, spread: 0.055, brightness: 0.75 },
    { color: '75,0,130',    name: 'indigo',  angleCenter: -0.42, spread: 0.055, brightness: 0.70 },
    { color: '0,0,255',     name: 'blue',    angleCenter: -0.26, spread: 0.060, brightness: 0.80 },
    { color: '0,200,0',     name: 'green',   angleCenter: -0.06, spread: 0.065, brightness: 0.85 },
    { color: '255,255,0',   name: 'yellow',  angleCenter:  0.08, spread: 0.055, brightness: 0.88 },
    { color: '255,127,0',   name: 'orange',  angleCenter:  0.22, spread: 0.060, brightness: 0.82 },
    { color: '255,0,0',     name: 'red',     angleCenter:  0.40, spread: 0.065, brightness: 0.78 },
  ];

  // Draw each spectral band as a solid fan of rays
  for (const band of spectrumBands) {
    const RAYS_PER_BAND = 5;
    for (let ri = 0; ri < RAYS_PER_BAND; ri++) {
      const frac  = ri / (RAYS_PER_BAND - 1);
      const angle = band.angleCenter + (frac - 0.5) * band.spread;
      const rayLen = (W - BX) * 1.25;

      const ex = BX + Math.cos(angle) * rayLen;
      const ey = BY + Math.sin(angle) * rayLen;

      // Wide, soft ray (bloom)
      const spread = band.spread * rayLen * 0.55;
      ctx.filter = 'blur(16px)';
      const rg1 = ctx.createLinearGradient(BX, BY, ex, ey);
      rg1.addColorStop(0,   'rgba(' + band.color + ',' + (band.brightness * 0.3) + ')');
      rg1.addColorStop(0.25,'rgba(' + band.color + ',' + (band.brightness * 0.55) + ')');
      rg1.addColorStop(0.65,'rgba(' + band.color + ',' + (band.brightness * 0.45) + ')');
      rg1.addColorStop(1,   'rgba(' + band.color + ',0)');
      ctx.strokeStyle = rg1;
      ctx.lineWidth = spread;
      ctx.beginPath(); ctx.moveTo(BX, BY); ctx.lineTo(ex, ey); ctx.stroke();

      // Crisp bright core ray
      ctx.filter = 'blur(2px)';
      const rg2 = ctx.createLinearGradient(BX, BY, ex, ey);
      rg2.addColorStop(0,   'rgba(255,255,255,' + band.brightness + ')');
      rg2.addColorStop(0.15,'rgba(' + band.color + ',' + band.brightness + ')');
      rg2.addColorStop(0.7, 'rgba(' + band.color + ',' + (band.brightness * 0.5) + ')');
      rg2.addColorStop(1,   'rgba(' + band.color + ',0)');
      ctx.strokeStyle = rg2;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(BX, BY); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.filter = 'none';
    }
  }

  // 5. White "prism diamond" at the burst point
  ctx.filter = 'blur(1px)';
  ctx.beginPath(); ctx.arc(BX, BY, 6, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,1)'; ctx.fill();
  ctx.filter = 'none';

  // 6. Refraction halos — concentric circles around the prism point
  for (let h = 1; h <= 3; h++) {
    const hr = h * 35;
    ctx.filter = 'blur(4px)';
    ctx.beginPath(); ctx.arc(BX, BY, hr, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.15 / h).toFixed(3) + ')';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.filter = 'none';

  // 7. Speed lines — thin white lines coming from the left at high speed
  ctx.filter = 'blur(1px)';
  for (let i = 0; i < 12; i++) {
    const ly = BY + (rng() - 0.5) * H * 0.6;
    const llen = 80 + rng() * 200;
    const la = 0.04 + rng() * 0.12;
    const slg = ctx.createLinearGradient(BX - llen, ly, BX, ly);
    slg.addColorStop(0, 'rgba(255,255,255,0)');
    slg.addColorStop(1, 'rgba(255,255,255,' + la + ')');
    ctx.strokeStyle = slg; ctx.lineWidth = 0.5 + rng() * 1;
    ctx.beginPath(); ctx.moveTo(BX - llen, ly); ctx.lineTo(BX, ly); ctx.stroke();
  }
  ctx.filter = 'none';

  // Vignette (slightly asymmetric — darker on right where spectrum lives)
  const vg = ctx.createRadialGradient(BX * 0.5, BY, H * 0.1, CX * 1.2, BY, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  drawGrain(ctx, 204, 0.014);
  drawBleed(ctx, 0, 0, 4, 0.50);
  return canvas;
}

// ═════════════════════════════════════════════════════════════════════════════
// ICON — Eclipse mark (unchanged, brand anchor)
// ═════════════════════════════════════════════════════════════════════════════
function makeIcon(size) {
  size = size || 300;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2, R = size * 0.36;
  ctx.fillStyle = 'rgb(4,4,12)'; ctx.fillRect(0, 0, size, size);
  ctx.filter = 'blur(16px)';
  const glow = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R * 1.5);
  glow.addColorStop(0, 'rgba(215,228,255,0.75)');
  glow.addColorStop(1, 'rgba(180,210,255,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R * 1.5, 0, TAU); ctx.fill();
  ctx.filter = 'none';
  const rng = makeLcg(42);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU, len = R * (1.3 + rng() * 0.45);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.strokeStyle = 'rgba(220,235,255,' + (0.3 + rng() * 0.28) + ')';
    ctx.lineWidth = R * 0.04; ctx.stroke();
  }
  ctx.filter = 'blur(2px)';
  ctx.beginPath(); ctx.arc(cx, cy, R + 2, 0, TAU);
  ctx.lineWidth = size * 0.02; ctx.strokeStyle = 'rgba(255,50,20,0.85)'; ctx.stroke();
  ctx.filter = 'none';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = 'rgb(0,0,0)'; ctx.fill();
  const dotR = size * 0.07, dotX = cx + R * 0.65, dotY = cy - R * 0.65;
  ctx.filter = 'blur(4px)';
  const dot = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, dotR * 1.8);
  dot.addColorStop(0, 'rgba(255,185,60,1)'); dot.addColorStop(1, 'rgba(255,140,20,0)');
  ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(dotX, dotY, dotR * 1.8, 0, TAU); ctx.fill();
  ctx.filter = 'none';
  ctx.beginPath(); ctx.arc(dotX, dotY, dotR, 0, TAU); ctx.fillStyle = 'rgb(255,195,70)'; ctx.fill();
  return canvas;
}

function makeLogo() {
  const LW = 600, LH = 120;
  const canvas = createCanvas(LW, LH);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, LW, LH);
  ctx.fillStyle = 'rgb(255,255,255)';
  ctx.font = '900 62px "Arial Black", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('ECLIPSE', 14, LH / 2 - 4);
  ctx.fillStyle = 'rgba(255,180,60,0.88)'; ctx.fillRect(14, LH - 14, 540, 2);
  return canvas;
}

function makeFooter() {
  const FW = 640, FH = 30;
  const canvas = createCanvas(FW, FH);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, FW, FH);
  const g = ctx.createLinearGradient(0, FH / 2, FW, FH / 2);
  g.addColorStop(0, 'rgba(255,175,50,0)'); g.addColorStop(0.15, 'rgba(255,175,50,0.6)');
  g.addColorStop(0.85, 'rgba(255,175,50,0.6)'); g.addColorStop(1, 'rgba(255,175,50,0)');
  ctx.fillStyle = g; ctx.fillRect(0, FH / 2 - 1, FW, 2);
  return canvas;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n  Eclipse Wallet — PHENOMENA edition\n');

savePng(makeStripGeneral(),   'strip_general.png');
savePng(makeStripVip(),       'strip_vip.png');
savePng(makeStripBackstage(), 'strip_backstage.png');
savePng(makeStripFastlane(),  'strip_fastlane.png');

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
