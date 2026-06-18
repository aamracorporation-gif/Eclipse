/**
 * ECLIPSE Wallet Pass — Asset Generator v2 (10/10)
 * Generates cinematic PNG strip images + icon/logo for Apple Wallet passes.
 * Run: node scripts/generate_eclipse_wallet_assets.mjs
 */
import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "assets", "wallet-pass");

mkdirSync(OUT, { recursive: true });

function savePng(name, canvas) {
  const buf = canvas.toBuffer("image/png");
  writeFileSync(join(OUT, name), buf);
  console.log(`  ✓ ${name} (${canvas.width}×${canvas.height}, ${(buf.length / 1024).toFixed(0)}KB)`);
}

const hexToRgb = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

const rgba = (hex, a) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

/** Horizontal scanlines overlay — subtle CRT texture */
function drawScanlines(ctx, w, h, alpha = 0.028) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#000000";
  for (let y = 0; y < h; y += 3) {
    ctx.fillRect(0, y, w, 1);
  }
  ctx.restore();
}

/** Noise-dot layer — micro grain texture */
function drawGrain(ctx, w, h, density = 0.018) {
  ctx.save();
  const count = Math.floor(w * h * density);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const bright = Math.random() > 0.5 ? 255 : 0;
    const a = Math.random() * 0.06;
    ctx.fillStyle = `rgba(${bright},${bright},${bright},${a})`;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

/** Precise dots placed at fixed positions (no Math.random) */
function drawStars(ctx, w, h, stars, color = "#FFFFFF", baseAlpha = 0.38) {
  ctx.save();
  for (const { x, y, r, a } of stars) {
    ctx.globalAlpha = (a ?? 1) * baseAlpha;
    ctx.beginPath();
    ctx.arc(x * w, y * h, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

/** Large barely-visible "ECLIPSE" wordmark watermark */
function drawWordmark(ctx, w, h, accentHex, alpha = 0.032) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `900 ${Math.round(h * 0.55)}px Arial`;
  ctx.fillStyle = accentHex;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.letterSpacing = `${Math.round(h * 0.10)}px`;
  ctx.fillText("ECLIPSE", w * 0.5, h * 0.52);
  ctx.restore();
}

/** Dot-grid pattern at very low opacity */
function drawDotGrid(ctx, w, h, color = "#FFFFFF", gap = 22, dotR = 0.9, alpha = 0.045) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let x = gap; x < w; x += gap) {
    for (let y = gap; y < h; y += gap) {
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Thin diagonal grid lines */
function drawDiagGrid(ctx, w, h, color = "#FFFFFF", spacing = 40, alpha = 0.03) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  // forward diagonals
  for (let i = -h; i < w + h; i += spacing) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
    ctx.stroke();
  }
  ctx.restore();
}

/** Single thin horizontal rule */
function drawRule(ctx, w, y, color, alpha = 0.28, thickness = 0.6) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "transparent");
  grad.addColorStop(0.25, color);
  grad.addColorStop(0.75, color);
  grad.addColorStop(1, "transparent");
  ctx.fillStyle = grad;
  ctx.fillRect(0, y, w, thickness);
  ctx.restore();
}

/** Hard darkness overlay from top (readability for Wallet text fields) */
function drawTopDarkness(ctx, w, h, startAlpha = 0.90, endAlpha = 0.10) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(0,0,0,${startAlpha})`);
  g.addColorStop(1, `rgba(0,0,0,${endAlpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Bottom vignette */
function drawBottomVignette(ctx, w, h, alpha = 0.42) {
  const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
  g.addColorStop(0, "transparent");
  g.addColorStop(1, `rgba(0,0,0,${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// ── ICON ─────────────────────────────────────────────────────────────────────

function drawIcon(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");

  // Pure deep background
  ctx.fillStyle = "#0B0B10";
  ctx.fillRect(0, 0, size, size);

  // Subtle amber radial glow
  const grd = ctx.createRadialGradient(size / 2, size * 0.45, 0, size / 2, size * 0.45, size * 0.65);
  grd.addColorStop(0, "rgba(255,179,107,0.18)");
  grd.addColorStop(1, "rgba(255,179,107,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);

  // Bold geometric "E"
  const pad = size * 0.20;
  const w = size - pad * 2;
  const h = size - pad * 2;
  const sw = size * 0.115; // stroke width
  const bh = sw * 0.85;   // bar height

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(pad, pad, sw, h);             // vertical
  ctx.fillRect(pad, pad, w, bh);             // top
  ctx.fillRect(pad, pad + h / 2 - bh / 2, w * 0.68, bh); // mid
  ctx.fillRect(pad, pad + h - bh, w, bh);   // bottom

  return c;
}

const icon87 = drawIcon(87);
const icon58 = drawIcon(58);
const icon29 = drawIcon(29);

console.log("\nGenerating icons...");
savePng("icon.png",    icon29);
savePng("icon@2x.png", icon58);
savePng("icon@3x.png", icon87);

// ── LOGO ─────────────────────────────────────────────────────────────────────

function drawLogo(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");

  ctx.fillStyle = "#0B0B10";
  ctx.fillRect(0, 0, w, h);

  const fontSize = Math.round(h * 0.44);
  ctx.font = `800 ${fontSize}px Arial`;
  ctx.letterSpacing = `${Math.round(fontSize * 0.20)}px`;
  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("ECLIPSE", Math.round(w * 0.05), h / 2 + 1);

  return c;
}

console.log("\nGenerating logos...");
savePng("logo.png",    drawLogo(160, 50));
savePng("logo@2x.png", drawLogo(320, 100));
savePng("logo@3x.png", drawLogo(480, 150));

// ── FOOTER ───────────────────────────────────────────────────────────────────

function drawFooter(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0B0B10";
  ctx.fillRect(0, 0, w, h);
  return c;
}

savePng("footer.png",    drawFooter(480, 150));
savePng("footer@2x.png", drawFooter(480, 150));
savePng("footer@3x.png", drawFooter(480, 150));

// ── STRIP IMAGES — 1125×432 (@3x = 375×144pt) ────────────────────────────────

const W = 1125;
const H = 432;

const STARS_COMMON = [
  { x: 0.062, y: 0.14, r: 1.1, a: 0.9 },
  { x: 0.118, y: 0.28, r: 0.7, a: 0.7 },
  { x: 0.185, y: 0.09, r: 0.9, a: 0.8 },
  { x: 0.245, y: 0.40, r: 0.6, a: 0.6 },
  { x: 0.310, y: 0.18, r: 1.0, a: 1.0 },
  { x: 0.392, y: 0.07, r: 0.8, a: 0.7 },
  { x: 0.458, y: 0.33, r: 0.7, a: 0.65 },
  { x: 0.530, y: 0.12, r: 1.2, a: 0.9 },
  { x: 0.601, y: 0.44, r: 0.8, a: 0.7 },
  { x: 0.660, y: 0.22, r: 0.9, a: 0.85 },
  { x: 0.720, y: 0.08, r: 0.7, a: 0.6 },
  { x: 0.795, y: 0.35, r: 1.0, a: 0.8 },
  { x: 0.842, y: 0.17, r: 0.8, a: 0.7 },
  { x: 0.905, y: 0.29, r: 1.1, a: 0.9 },
  { x: 0.958, y: 0.11, r: 0.7, a: 0.65 },
  { x: 0.078, y: 0.72, r: 0.6, a: 0.5 },
  { x: 0.280, y: 0.78, r: 0.7, a: 0.45 },
  { x: 0.510, y: 0.68, r: 0.8, a: 0.5 },
  { x: 0.740, y: 0.74, r: 0.6, a: 0.45 },
  { x: 0.920, y: 0.65, r: 0.9, a: 0.5 },
];

// ── MUSIC ─────────────────────────────────────────────────────────────────────
// Deep indigo-violet → black | amber accent | equalizer bars | scanlines

console.log("\nGenerating strip images...");

function makeStripMusic(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");

  // 1. Base background — two-stop radial from top-left
  const bg = ctx.createRadialGradient(w * 0.22, h * 0.30, 0, w * 0.22, h * 0.30, w * 0.85);
  bg.addColorStop(0, "#200D3C");
  bg.addColorStop(0.55, "#100820");
  bg.addColorStop(1, "#080810");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 2. Secondary warm spotlight (upper-right) — amber
  const spot1 = ctx.createRadialGradient(w * 0.78, h * 0.22, 0, w * 0.78, h * 0.22, w * 0.50);
  spot1.addColorStop(0, rgba("#FFB36B", 0.22));
  spot1.addColorStop(1, rgba("#FFB36B", 0));
  ctx.fillStyle = spot1;
  ctx.fillRect(0, 0, w, h);

  // 3. Diagonal grid (very faint)
  drawDiagGrid(ctx, w, h, "#FFB36B", 55, 0.025);

  // 4. Equalizer bars — 52 bars, bottom 38%, varying heights
  {
    const barCount = 52;
    const barW = Math.floor(w * 0.72 / barCount);
    const gap = Math.floor(barW * 0.32);
    const maxH = h * 0.36;
    const baseY = h * 0.96;
    const startX = Math.floor(w * 0.14);

    const heights = [
      0.28, 0.42, 0.55, 0.68, 0.82, 0.91, 0.78, 0.65, 0.88, 0.72,
      0.55, 0.45, 0.62, 0.75, 0.92, 0.85, 0.70, 0.58, 0.80, 0.95,
      0.88, 0.76, 0.60, 0.72, 0.84, 0.90, 0.78, 0.65, 0.50, 0.70,
      0.85, 0.92, 0.80, 0.68, 0.56, 0.74, 0.86, 0.94, 0.82, 0.70,
      0.60, 0.78, 0.88, 0.76, 0.62, 0.50, 0.40, 0.55, 0.42, 0.35, 0.28, 0.20,
    ];

    ctx.save();
    ctx.globalAlpha = 0.095;
    for (let i = 0; i < barCount; i++) {
      const bh = maxH * heights[i];
      const bx = startX + i * (barW + gap);
      const by = baseY - bh;

      const barGrad = ctx.createLinearGradient(0, by, 0, baseY);
      barGrad.addColorStop(0, rgba("#FFB36B", 0));
      barGrad.addColorStop(0.4, rgba("#FFB36B", 0.8));
      barGrad.addColorStop(1, rgba("#FFB36B", 1));
      ctx.fillStyle = barGrad;
      ctx.fillRect(bx, by, barW - gap, bh);
    }
    ctx.restore();
  }

  // 5. Sine waveform fine detail (above equalizer zone)
  {
    ctx.save();
    ctx.globalAlpha = 0.055;
    const freq = (2 * Math.PI) / (w / 9);
    const amp = h * 0.055;
    const yBase = h * 0.64;

    // Wave A
    ctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const y = yBase + Math.sin(x * freq) * amp;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#FFB36B";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Wave B (phase +20, lower amp)
    ctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const y = yBase + h * 0.022 + Math.sin((x + 20) * freq) * amp * 0.72;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#FFB36B";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  // 6. Wordmark watermark
  drawWordmark(ctx, w, h, "#FFB36B", 0.028);

  // 7. Stars
  drawStars(ctx, w, h, STARS_COMMON, "#FFD9A8", 0.42);

  // 8. Scanlines
  drawScanlines(ctx, w, h, 0.025);

  // 9. Top darkness (fields readability) + bottom vignette
  drawTopDarkness(ctx, w, h, 0.88, 0.08);
  drawBottomVignette(ctx, w, h, 0.38);

  // 10. Horizontal rule at ~40% height (amber)
  drawRule(ctx, w, Math.floor(h * 0.40), "#FFB36B", 0.22);

  return c;
}

// ── SPORTS ───────────────────────────────────────────────────────────────────
// Deep navy | dual floodlights | motion lines | dot grid | cyan accent

function makeStripSports(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");

  // 1. Background
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#04111E");
  bg.addColorStop(0.55, "#081828");
  bg.addColorStop(1, "#080810");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 2. Left floodlight (cone from upper-left)
  const fl1 = ctx.createRadialGradient(w * 0.08, 0, 0, w * 0.08, 0, w * 0.58);
  fl1.addColorStop(0, rgba("#7DD3FF", 0.20));
  fl1.addColorStop(0.4, rgba("#7DD3FF", 0.06));
  fl1.addColorStop(1, rgba("#7DD3FF", 0));
  ctx.fillStyle = fl1;
  ctx.fillRect(0, 0, w, h);

  // 3. Right floodlight (cone from upper-right)
  const fl2 = ctx.createRadialGradient(w * 0.92, 0, 0, w * 0.92, 0, w * 0.58);
  fl2.addColorStop(0, rgba("#7DD3FF", 0.18));
  fl2.addColorStop(0.4, rgba("#7DD3FF", 0.05));
  fl2.addColorStop(1, rgba("#7DD3FF", 0));
  ctx.fillStyle = fl2;
  ctx.fillRect(0, 0, w, h);

  // 4. Center bottom glow (pitch/arena glow)
  const cg = ctx.createRadialGradient(w * 0.50, h, 0, w * 0.50, h, w * 0.55);
  cg.addColorStop(0, rgba("#7DD3FF", 0.14));
  cg.addColorStop(1, rgba("#7DD3FF", 0));
  ctx.fillStyle = cg;
  ctx.fillRect(0, 0, w, h);

  // 5. Horizontal motion lines (speed streaks)
  {
    ctx.save();
    ctx.globalAlpha = 0.045;
    const linePositions = [0.38, 0.45, 0.52, 0.58, 0.63, 0.68, 0.73, 0.78];
    for (const yRatio of linePositions) {
      const y = h * yRatio;
      const linGrad = ctx.createLinearGradient(0, 0, w, 0);
      linGrad.addColorStop(0, "transparent");
      linGrad.addColorStop(0.15, "#7DD3FF");
      linGrad.addColorStop(0.85, "#7DD3FF");
      linGrad.addColorStop(1, "transparent");
      ctx.fillStyle = linGrad;
      ctx.fillRect(0, y, w, 0.8);
    }
    ctx.restore();
  }

  // 6. Dot grid
  drawDotGrid(ctx, w, h, "#7DD3FF", 26, 0.85, 0.042);

  // 7. Abstract stadium arc (bottom, watermark)
  {
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.strokeStyle = "#7DD3FF";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(w * 0.50, h * 1.05, w * 0.44, h * 0.62, 0, Math.PI, 0, true);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(w * 0.50, h * 1.05, w * 0.32, h * 0.46, 0, Math.PI, 0, true);
    ctx.stroke();
    ctx.restore();
  }

  // 8. Wordmark
  drawWordmark(ctx, w, h, "#7DD3FF", 0.026);

  // 9. Stars
  drawStars(ctx, w, h, STARS_COMMON, "#C8EEFF", 0.38);

  // 10. Scanlines + top darkness + vignette
  drawScanlines(ctx, w, h, 0.020);
  drawTopDarkness(ctx, w, h, 0.88, 0.08);
  drawBottomVignette(ctx, w, h, 0.40);

  // 11. Rule
  drawRule(ctx, w, Math.floor(h * 0.38), "#7DD3FF", 0.20);

  return c;
}

// ── CORPORATE ────────────────────────────────────────────────────────────────
// Near-black | subtle hexagonal lattice | isometric lines | slate accent

function makeStripCorporate(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");

  // 1. Background — near-black gradient
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#0D0D15");
  bg.addColorStop(1, "#080810");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 2. Subtle silver center radial
  const cr = ctx.createRadialGradient(w * 0.50, h * 0.38, 0, w * 0.50, h * 0.38, w * 0.55);
  cr.addColorStop(0, rgba("#B6BBC6", 0.08));
  cr.addColorStop(1, rgba("#B6BBC6", 0));
  ctx.fillStyle = cr;
  ctx.fillRect(0, 0, w, h);

  // 3. Hexagonal lattice (flat-top hexagons)
  {
    const hexR = 28;
    const hexW = hexR * 2;
    const hexH = Math.sqrt(3) * hexR;

    ctx.save();
    ctx.globalAlpha = 0.038;
    ctx.strokeStyle = "#B6BBC6";
    ctx.lineWidth = 0.7;

    const hexPoints = (cx, cy) => {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i - 30);
        pts.push([cx + hexR * Math.cos(angle), cy + hexR * Math.sin(angle)]);
      }
      return pts;
    };

    for (let row = -1; row < Math.ceil(h / hexH) + 1; row++) {
      for (let col = -1; col < Math.ceil(w / hexW) + 1; col++) {
        const cx = col * hexW * 0.75 + hexR;
        const cy = row * hexH + (col % 2 === 0 ? 0 : hexH / 2) + hexH / 2;
        const pts = hexPoints(cx, cy);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 4. Diagonal grid
  drawDiagGrid(ctx, w, h, "#B6BBC6", 60, 0.022);

  // 5. Wordmark
  drawWordmark(ctx, w, h, "#B6BBC6", 0.030);

  // 6. Scanlines (subtler)
  drawScanlines(ctx, w, h, 0.018);

  // 7. Top darkness + vignette
  drawTopDarkness(ctx, w, h, 0.90, 0.10);
  drawBottomVignette(ctx, w, h, 0.35);

  // 8. Silver rule
  drawRule(ctx, w, Math.floor(h * 0.40), "#B6BBC6", 0.25);

  return c;
}

// ── ART ──────────────────────────────────────────────────────────────────────
// Deep violet | watercolor blobs | flowing bezier curves | lavender accent

function makeStripArt(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");

  // 1. Background
  const bg = ctx.createRadialGradient(w * 0.35, h * 0.45, 0, w * 0.35, h * 0.45, w * 0.80);
  bg.addColorStop(0, "#180A2E");
  bg.addColorStop(0.55, "#0E0820");
  bg.addColorStop(1, "#080810");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 2. Lavender blob — upper-left
  {
    const g = ctx.createRadialGradient(w * 0.20, h * 0.30, 0, w * 0.20, h * 0.30, w * 0.35);
    g.addColorStop(0, rgba("#C7B2FF", 0.22));
    g.addColorStop(0.5, rgba("#C7B2FF", 0.06));
    g.addColorStop(1, rgba("#C7B2FF", 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // 3. Rose blob — upper-right
  {
    const g = ctx.createRadialGradient(w * 0.80, h * 0.25, 0, w * 0.80, h * 0.25, w * 0.30);
    g.addColorStop(0, rgba("#FF88CC", 0.12));
    g.addColorStop(1, rgba("#FF88CC", 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // 4. Deep blue blob — bottom center
  {
    const g = ctx.createRadialGradient(w * 0.55, h * 0.85, 0, w * 0.55, h * 0.85, w * 0.38);
    g.addColorStop(0, rgba("#7B5FFF", 0.14));
    g.addColorStop(1, rgba("#7B5FFF", 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // 5. Flowing bezier curves — 5 arcs at low opacity
  {
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = "#C7B2FF";
    ctx.lineWidth = 1.0;

    const curves = [
      { x1: -w*0.05, y1: h*0.70, cx1: w*0.30, cy1: h*0.15, cx2: w*0.70, cy2: h*0.85, x2: w*1.05, y2: h*0.30 },
      { x1: -w*0.05, y1: h*0.45, cx1: w*0.25, cy1: h*0.82, cx2: w*0.75, cy2: h*0.18, x2: w*1.05, y2: h*0.55 },
      { x1: w*0.10,  y1: -h*0.05, cx1: w*0.55, cy1: h*0.55, cx2: w*0.45, cy2: h*0.45, x2: w*0.90, y2: h*1.05 },
      { x1: -w*0.05, y1: h*0.20, cx1: w*0.40, cy1: h*0.60, cx2: w*0.60, cy2: h*0.40, x2: w*1.05, y2: h*0.80 },
      { x1: w*0.05,  y1: h*1.05, cx1: w*0.35, cy1: h*0.30, cx2: w*0.65, cy2: h*0.70, x2: w*0.95, y2: -h*0.05 },
    ];
    for (const { x1, y1, cx1, cy1, cx2, cy2, x2, y2 } of curves) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 6. Dot grid
  drawDotGrid(ctx, w, h, "#C7B2FF", 24, 0.8, 0.038);

  // 7. Wordmark
  drawWordmark(ctx, w, h, "#C7B2FF", 0.030);

  // 8. Stars
  drawStars(ctx, w, h, STARS_COMMON, "#E8DEFF", 0.40);

  // 9. Scanlines
  drawScanlines(ctx, w, h, 0.022);

  // 10. Top darkness + vignette
  drawTopDarkness(ctx, w, h, 0.88, 0.08);
  drawBottomVignette(ctx, w, h, 0.36);

  // 11. Rule
  drawRule(ctx, w, Math.floor(h * 0.40), "#C7B2FF", 0.22);

  return c;
}

// DEFAULT = Music
const makeStripDefault = makeStripMusic;

// Generate all
const strips = [
  ["strip_music.png",     makeStripMusic],
  ["strip_sports.png",    makeStripSports],
  ["strip_corporate.png", makeStripCorporate],
  ["strip_art.png",       makeStripArt],
  ["strip_default.png",   makeStripDefault],
];

for (const [name, fn] of strips) {
  savePng(name, fn(W, H));
}

console.log("\n✅  All ECLIPSE wallet assets generated.\n");
console.log("Next: run scripts\\generate_wallet_assets_module.ps1\n");
