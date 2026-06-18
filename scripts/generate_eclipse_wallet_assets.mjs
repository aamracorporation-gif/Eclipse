/**
 * ECLIPSE Wallet Pass — Asset Generator v3 "SOLAR CORONA"
 *
 * Concept: every strip image is a photorealistic solar eclipse.
 * The moon disk is a perfect matte-black circle; the corona radiates
 * with 360 individual rays whose length varies with summed sine waves
 * (mimicking actual coronal streamers). Stars are placed on a
 * Fibonacci/golden-ratio spiral so they never repeat. Chromatic
 * aberration splits RGB at the limb. Category tints the corona color.
 *
 * Run: node scripts/generate_eclipse_wallet_assets.mjs
 */

import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dirname, "..");
const OUT    = join(ROOT, "assets", "wallet-pass");
mkdirSync(OUT, { recursive: true });

function save(name, canvas) {
  const buf = canvas.toBuffer("image/png");
  writeFileSync(join(OUT, name), buf);
  const kb = (buf.length / 1024).toFixed(0);
  console.log(`  ✓ ${name}  (${canvas.width}×${canvas.height}, ${kb} KB)`);
}

// ── helpers ──────────────────────────────────────────────────────────────────

const hexRgb = hex => ({
  r: parseInt(hex.slice(1,3),16),
  g: parseInt(hex.slice(3,5),16),
  b: parseInt(hex.slice(5,7),16),
});
const rgb   = ({r,g,b})        => `rgb(${r},${g},${b})`;
const rgba  = ({r,g,b}, a)     => `rgba(${r},${g},${b},${a})`;
const mix   = (c1,c2,t)        => ({
  r: Math.round(c1.r+(c2.r-c1.r)*t),
  g: Math.round(c1.g+(c2.g-c1.g)*t),
  b: Math.round(c1.b+(c2.b-c1.b)*t),
});

// ── ICON ─────────────────────────────────────────────────────────────────────
// Geometric "E" with a micro-eclipse dot accent

function drawIcon(size) {
  const c   = createCanvas(size, size);
  const ctx = c.getContext("2d");

  ctx.fillStyle = "#040408";
  ctx.fillRect(0, 0, size, size);

  // Faint amber radial glow
  const g = ctx.createRadialGradient(size*.5, size*.44, 0, size*.5, size*.44, size*.7);
  g.addColorStop(0, "rgba(255,179,107,.16)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0,0,size,size);

  // "E"
  const p  = size*.20, sw = size*.115, bh = sw*.82;
  const w  = size-p*2, h  = size-p*2;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(p,       p,             sw, h);           // vertical
  ctx.fillRect(p,       p,             w,  bh);          // top
  ctx.fillRect(p,       p+h/2-bh/2,   w*.68, bh);       // mid
  ctx.fillRect(p,       p+h-bh,       w,  bh);           // bottom

  // Tiny eclipse accent: amber dot top-right of the "E"
  const dotCx = p + w * .82;
  const dotCy = p + bh * .5;
  const dotR  = size * .065;
  // corona
  const dg = ctx.createRadialGradient(dotCx,dotCy,0,dotCx,dotCy,dotR*2.4);
  dg.addColorStop(0, "rgba(255,179,107,.55)");
  dg.addColorStop(1, "rgba(255,179,107,0)");
  ctx.fillStyle = dg;
  ctx.beginPath(); ctx.arc(dotCx,dotCy,dotR*2.4,0,Math.PI*2); ctx.fill();
  // moon
  ctx.fillStyle = "#040408";
  ctx.beginPath(); ctx.arc(dotCx,dotCy,dotR,0,Math.PI*2); ctx.fill();

  return c;
}

console.log("\nGenerating icons…");
[87,58,29].forEach((s,i) => {
  const suffixes = ["@3x","@2x",""];
  save(`icon${suffixes[i]}.png`, drawIcon(s));
});

// ── LOGO ─────────────────────────────────────────────────────────────────────

function drawLogo(w,h) {
  const c = createCanvas(w,h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#040408";
  ctx.fillRect(0,0,w,h);

  // Hairline separator
  ctx.fillStyle = "rgba(255,179,107,.18)";
  ctx.fillRect(0, h-1, w, 1);

  const fs = Math.round(h*.42);
  ctx.font       = `800 ${fs}px Arial Black, Arial`;
  ctx.fillStyle  = "#FFFFFF";
  ctx.textBaseline = "middle";
  ctx.textAlign    = "left";
  ctx.letterSpacing = `${Math.round(fs*.22)}px`;
  ctx.fillText("ECLIPSE", Math.round(w*.05), h/2+1);
  return c;
}

console.log("Generating logos…");
[[160,50],[320,100],[480,150]].forEach(([w,h],i) => {
  const suf = ["","@2x","@3x"][i];
  save(`logo${suf}.png`, drawLogo(w,h));
});

// ── FOOTER (blank, dark) ─────────────────────────────────────────────────────

const footer = createCanvas(480,150);
footer.getContext("2d").fillStyle = "#040408";
footer.getContext("2d").fillRect(0,0,480,150);
["","@2x","@3x"].forEach(s => save(`footer${s}.png`, footer));

// ── SOLAR CORONA strip  1125 × 432 (@3x = 375 × 144 pt) ─────────────────────

const W = 1125, H = 432;

/**
 * Generates a photorealistic solar-eclipse strip.
 *
 * @param {string}  coronaHex   Accent / corona colour  e.g. "#FFB36B"
 * @param {object}  opts
 *   bgTintHex       Very dark background tint colour
 *   moonY           Moon centre Y as fraction of H  (0..1)
 *   moonX           Moon centre X as fraction of W  (0..1)
 *   coronaScale     How many moon-radii the corona extends beyond the limb
 *   innerBright     0..1 — brightness of inner corona ring
 */
function solarEclipse(coronaHex, {
  bgTintHex   = "#020205",
  moonY       = 0.56,
  moonX       = 0.50,
  coronaScale = 2.20,
  innerBright = 1.0,
} = {}) {
  const c   = createCanvas(W, H);
  const ctx = c.getContext("2d");
  const CC  = hexRgb(coronaHex);

  // ── 1. Deep space background ──────────────────────────────────────────────
  // Two-stop radial: the tint colour very faint near centre, pure black at edges
  const spaceBg = ctx.createRadialGradient(W*.5,H*.52,0, W*.5,H*.52, W*.62);
  spaceBg.addColorStop(0,   rgba(hexRgb(bgTintHex), 1));
  spaceBg.addColorStop(1,   "#000000");
  ctx.fillStyle = spaceBg;
  ctx.fillRect(0, 0, W, H);

  // Distant nebula wisps — two faint radials in the corona tint
  [
    [W*.22, H*.28, W*.35, .030],
    [W*.78, H*.35, W*.30, .022],
  ].forEach(([nx,ny,nr,na]) => {
    const ng = ctx.createRadialGradient(nx,ny,0,nx,ny,nr);
    ng.addColorStop(0, rgba(CC, na));
    ng.addColorStop(1, "transparent");
    ctx.fillStyle = ng; ctx.fillRect(0,0,W,H);
  });

  // ── 2. Stars — Fibonacci / golden-angle spiral ───────────────────────────
  {
    const PHI = 1.6180339887;
    const N   = 220;
    const cx0 = W*.5, cy0 = H*.52;
    const spread = Math.max(W,H) * .82;
    ctx.save();
    for (let i = 1; i <= N; i++) {
      const theta = 2*Math.PI * i * PHI;
      const rr    = Math.sqrt(i/N) * spread;
      const sx    = cx0 + rr*Math.cos(theta);
      const sy    = cy0 + rr*Math.sin(theta);
      if (sx<0||sx>W||sy<0||sy>H) continue;

      const distFrac = Math.min(1, rr / (spread*.55));
      const alpha    = (0.06 + distFrac * .52);
      const starR    = .45 + (i%11===0 ? .80 : 0) + (i%31===0 ? .55 : 0);

      ctx.globalAlpha = Math.min(alpha, .90);
      ctx.beginPath(); ctx.arc(sx, sy, starR, 0, Math.PI*2);

      // Slight color variation: every ~19th star has a warm tint
      ctx.fillStyle = i%19===0 ? rgba(mix(CC,{r:255,g:255,b:255},.4), 1) : "#FFFFFF";
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── 3. Solar corona ───────────────────────────────────────────────────────
  const cx    = W * moonX;
  const cy    = H * moonY;
  const moonR = H * .245;            // moon radius
  const outerR = moonR * coronaScale; // max corona extent

  // 3a. Layered soft-glow rings (inner corona)
  // We draw from outside-in so the inner rings paint over the outer ones
  const glowSteps = 60;
  for (let i = glowSteps; i >= 0; i--) {
    const t  = i / glowSteps;               // 1=outer, 0=inner
    const rr = moonR * .96 + (outerR - moonR*.96) * t;
    // Exponential falloff in brightness
    const a  = .042 * Math.exp(-t * 3.8) * innerBright;
    if (a < .001) continue;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI*2);
    ctx.fillStyle = rgba(CC, a);
    ctx.fill();
  }

  // 3b. 360 individual ray streamers
  // Length function: sum of sines at different frequencies → organic variation
  const rayLen = (deg) => {
    const a = (deg * Math.PI) / 180;
    return (
      1.00 +
      0.32 * Math.abs(Math.sin(a * 3.1)) +
      0.24 * Math.abs(Math.sin(a * 7.3 + 1.14)) +
      0.18 * Math.abs(Math.sin(a * 13.7 + 0.55)) +
      0.12 * Math.abs(Math.sin(a * 23.1 + 2.22)) +
      0.08 * Math.abs(Math.sin(a * 41.0 + 0.77))
    );
  };

  ctx.save();
  for (let deg = 0; deg < 360; deg++) {
    const a     = (deg * Math.PI) / 180;
    const mult  = rayLen(deg);
    const rLen  = moonR * mult * 1.55;
    const hw    = (Math.PI / 180) * .52;   // half-angle of each ray

    const tipX  = cx + Math.cos(a) * (moonR + rLen);
    const tipY  = cy + Math.sin(a) * (moonR + rLen);

    const grad  = ctx.createRadialGradient(cx, cy, moonR*.96, cx, cy, moonR + rLen);
    grad.addColorStop(0,   rgba(CC, .30));
    grad.addColorStop(.25, rgba(CC, .14));
    grad.addColorStop(.65, rgba(CC, .04));
    grad.addColorStop(1,   rgba(CC, .00));

    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a-hw)*(moonR*.97), cy + Math.sin(a-hw)*(moonR*.97));
    ctx.lineTo(cx + Math.cos(a+hw)*(moonR*.97), cy + Math.sin(a+hw)*(moonR*.97));
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.restore();

  // 3c. Chromatic aberration at the limb (RGB split ring)
  // Red ring: slightly inside the limb
  {
    const rg = ctx.createRadialGradient(cx,cy, moonR*.88, cx,cy, moonR*1.06);
    rg.addColorStop(0, "transparent");
    rg.addColorStop(.65, "rgba(255,50,50,.07)");
    rg.addColorStop(1, "transparent");
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(cx,cy,moonR*1.06,0,Math.PI*2); ctx.fill();
  }
  // Blue ring: slightly outside the limb
  {
    const bg_ = ctx.createRadialGradient(cx,cy, moonR*1.01, cx,cy, moonR*1.22);
    bg_.addColorStop(0, "transparent");
    bg_.addColorStop(.5, "rgba(60,100,255,.055)");
    bg_.addColorStop(1, "transparent");
    ctx.fillStyle = bg_;
    ctx.beginPath(); ctx.arc(cx,cy,moonR*1.22,0,Math.PI*2); ctx.fill();
  }

  // ── 4. Moon disk — pure black ─────────────────────────────────────────────
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, moonR, 0, Math.PI*2);
  ctx.fillStyle = "#000000"; ctx.fill();

  // Atmospheric limb: very faint accent ring inside the disk edge
  const limb = ctx.createRadialGradient(cx,cy, moonR*.80, cx,cy, moonR);
  limb.addColorStop(0, "transparent");
  limb.addColorStop(1, rgba(CC, .055));
  ctx.fillStyle = limb;
  ctx.beginPath(); ctx.arc(cx,cy,moonR,0,Math.PI*2); ctx.fill();
  ctx.restore();

  // ── 5. Grain / noise layer ────────────────────────────────────────────────
  // Use deterministic pseudo-noise (avoid Math.random for reproducibility)
  {
    ctx.save();
    // Simple LCG seeded at 42
    let seed = 42;
    const rand = () => { seed = (seed*1664525 + 1013904223) & 0xFFFFFFFF; return (seed>>>0)/0xFFFFFFFF; };
    const count = Math.floor(W*H*.012);
    for (let i=0; i<count; i++) {
      const nx = rand()*W, ny = rand()*H;
      const bright = rand()>.5 ? 255 : 0;
      ctx.globalAlpha = rand()*.05;
      ctx.fillStyle = `rgb(${bright},${bright},${bright})`;
      ctx.fillRect(nx,ny,1,1);
    }
    ctx.globalAlpha = 1; ctx.restore();
  }

  // ── 6. Scanline overlay ───────────────────────────────────────────────────
  ctx.save();
  ctx.globalAlpha = .020;
  ctx.fillStyle   = "#000000";
  for (let y=0; y<H; y+=3) ctx.fillRect(0,y,W,1);
  ctx.restore();

  // ── 7. Top-of-strip darkness gradient (PassKit fields overlay this area) ──
  // Wallet renders the logo + header fields over the top ~55 pt of the strip.
  // We darken it so white text always reads.
  {
    const tg = ctx.createLinearGradient(0,0,0,H);
    tg.addColorStop(0,   "rgba(0,0,0,.92)");
    tg.addColorStop(.38, "rgba(0,0,0,.32)");
    tg.addColorStop(.65, "rgba(0,0,0,.08)");
    tg.addColorStop(1,   "rgba(0,0,0,.00)");
    ctx.fillStyle = tg; ctx.fillRect(0,0,W,H);
  }

  // ── 8. Bottom vignette ────────────────────────────────────────────────────
  {
    const bv = ctx.createLinearGradient(0, H*.58, 0, H);
    bv.addColorStop(0, "transparent");
    bv.addColorStop(1, "rgba(0,0,0,.50)");
    ctx.fillStyle = bv; ctx.fillRect(0,0,W,H);
  }

  return c;
}

// ── Category variants ─────────────────────────────────────────────────────────

console.log("\nGenerating solar eclipse strips…");

const strips = [
  ["strip_music.png",     "#FFB36B", { bgTintHex:"#0C0508", moonY:.55, moonX:.52, coronaScale:2.25, innerBright:1.00 }],
  ["strip_sports.png",    "#7DD3FF", { bgTintHex:"#020610", moonY:.58, moonX:.48, coronaScale:2.15, innerBright:0.90 }],
  ["strip_corporate.png", "#D4D8E2", { bgTintHex:"#040406", moonY:.54, moonX:.50, coronaScale:2.10, innerBright:0.72 }],
  ["strip_art.png",       "#CF9FFF", { bgTintHex:"#060208", moonY:.57, moonX:.53, coronaScale:2.30, innerBright:1.00 }],
  ["strip_default.png",   "#FFB36B", { bgTintHex:"#0C0508", moonY:.55, moonX:.52, coronaScale:2.25, innerBright:1.00 }],
];

for (const [name, color, opts] of strips) {
  save(name, solarEclipse(color, opts));
}

console.log("\n✅  All ECLIPSE v3 Solar Corona assets generated.\n");
console.log("Next: run .\\scripts\\generate_wallet_assets_module.ps1\n");
