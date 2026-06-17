/**
 * ECLIPSE Wallet Pass Asset Generator
 * Generates all PNG assets for Apple Wallet passes matching the ECLIPSE dark aesthetic.
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
  console.log(`  ✓ ${name} (${canvas.width}×${canvas.height})`);
}

// ── ICON ───────────────────────────────────────────────────────────────────
// 87×87 (rendered at @3x = 29pt). ECLIPSE "E" glyph on #0B0B10
function drawIcon(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");

  // Background
  ctx.fillStyle = "#0B0B10";
  ctx.fillRect(0, 0, size, size);

  // Subtle radial glow
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.6);
  grd.addColorStop(0, "rgba(255,179,107,0.12)");
  grd.addColorStop(1, "rgba(255,179,107,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);

  // "E" glyph — clean geometric letterform
  const pad = size * 0.22;
  const w = size - pad * 2;
  const h = size - pad * 2;
  const stroke = size * 0.095;
  const barH = stroke * 0.9;

  ctx.fillStyle = "#FFFFFF";

  // Vertical bar
  ctx.fillRect(pad, pad, stroke, h);

  // Top bar
  ctx.fillRect(pad, pad, w, barH);

  // Middle bar (shorter — 72% width)
  ctx.fillRect(pad, pad + h / 2 - barH / 2, w * 0.72, barH);

  // Bottom bar
  ctx.fillRect(pad, pad + h - barH, w, barH);

  return c;
}

const icon87 = drawIcon(87);
const icon58 = drawIcon(58);
const icon29 = drawIcon(29);

savePng("icon.png", icon29);
savePng("icon@2x.png", icon58);
savePng("icon@3x.png", icon87);

// ── LOGO ───────────────────────────────────────────────────────────────────
// 160×50pt @3x = 480×150px. "ECLIPSE" wordmark on #0B0B10 bg.
function drawLogo(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");

  ctx.fillStyle = "#0B0B10";
  ctx.fillRect(0, 0, w, h);

  const fontSize = Math.round(h * 0.46);
  ctx.font = `700 ${fontSize}px -apple-system, Arial, sans-serif`;
  ctx.letterSpacing = `${fontSize * 0.18}px`;
  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("ECLIPSE", Math.round(w * 0.04), h / 2);

  return c;
}

savePng("logo.png", drawLogo(160, 50));
savePng("logo@2x.png", drawLogo(320, 100));
savePng("logo@3x.png", drawLogo(480, 150));

// ── FOOTER ─────────────────────────────────────────────────────────────────
function drawFooter(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0B0B10";
  ctx.fillRect(0, 0, w, h);
  return c;
}

savePng("footer.png", drawFooter(480, 150));
savePng("footer@2x.png", drawFooter(480, 150));
savePng("footer@3x.png", drawFooter(480, 150));

// ── STRIP ──────────────────────────────────────────────────────────────────
// 375×144pt @3x = 1125×432px

const STRIP_W = 1125;
const STRIP_H = 432;

function drawStripBase(ctx, w, h, bgColor1, bgColor2, spotColor) {
  // Background radial gradient (top-left warm, dark right)
  const bgGrd = ctx.createRadialGradient(w * 0.30, h * 0.40, 0, w * 0.30, h * 0.40, w * 0.80);
  bgGrd.addColorStop(0, bgColor1);
  bgGrd.addColorStop(1, bgColor2);
  ctx.fillStyle = bgGrd;
  ctx.fillRect(0, 0, w, h);

  // Warm spotlight: ellipse at 55% h-center, 40% v-center
  const spotGrd = ctx.createRadialGradient(w * 0.55, h * 0.40, 0, w * 0.55, h * 0.40, w * 0.45);
  spotGrd.addColorStop(0, hexToRgba(spotColor, 0.25));
  spotGrd.addColorStop(1, hexToRgba(spotColor, 0));
  ctx.fillStyle = spotGrd;
  ctx.fillRect(0, 0, w, h);

  // Top overlay: rgba(10,10,15) 0.92→0.18
  const topGrd = ctx.createLinearGradient(0, 0, 0, h);
  topGrd.addColorStop(0, "rgba(10,10,15,0.92)");
  topGrd.addColorStop(1, "rgba(10,10,15,0.18)");
  ctx.fillStyle = topGrd;
  ctx.fillRect(0, 0, w, h);

  // Bottom vignette: bottom 20%
  const vigGrd = ctx.createLinearGradient(0, h * 0.80, 0, h);
  vigGrd.addColorStop(0, "rgba(0,0,0,0)");
  vigGrd.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vigGrd;
  ctx.fillRect(0, 0, w, h);
}

function drawWaveform(ctx, w, h, color) {
  ctx.save();
  ctx.globalAlpha = 0.06;

  // Wave 1: stroke-width 1.5px, full sine
  ctx.beginPath();
  const waveY1 = h * 0.72;
  const amp = h * 0.065;
  const freq = (2 * Math.PI) / (w / 8);
  for (let x = 0; x <= w; x += 2) {
    const y = waveY1 + Math.sin(x * freq) * amp;
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Wave 2: stroke-width 0.8px, phase-shifted 15px
  ctx.beginPath();
  const waveY2 = waveY1 + h * 0.025;
  for (let x = 0; x <= w; x += 2) {
    const y = waveY2 + Math.sin((x + 15) * freq) * amp * 0.85;
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.restore();
}

function drawParticles(ctx, w, h) {
  const particles = [
    { x: 0.16, y: 0.18, r: 1.0 },
    { x: 0.32, y: 0.11, r: 0.8 },
    { x: 0.58, y: 0.25, r: 1.2 },
    { x: 0.82, y: 0.14, r: 0.8 },
    { x: 0.93, y: 0.32, r: 1.0 },
    { x: 0.21, y: 0.82, r: 0.8 },
    { x: 0.77, y: 0.73, r: 1.0 },
    { x: 0.50, y: 0.08, r: 0.9 },
  ];
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (const p of particles) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// MUSIC — #2A1A3E → #0A0A10 | Spotlight #FFB36B | Waveform YES
function makeStripMusic(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  drawStripBase(ctx, w, h, "#2A1A3E", "#0A0A10", "#FFB36B");
  drawWaveform(ctx, w, h, "#FFB36B");
  drawParticles(ctx, w, h);
  return c;
}

// SPORTS — #0D1F35 → #0A0A10 | Spotlight #7DD3FF | No waveform
function makeStripSports(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  drawStripBase(ctx, w, h, "#0D1F35", "#0A0A10", "#7DD3FF");
  // Stadium silhouette watermark (abstract arch at 6% opacity)
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#7DD3FF";
  const archW = w * 0.5;
  const archH = h * 0.55;
  const archX = w * 0.25;
  const archY = h * 0.45;
  ctx.beginPath();
  ctx.ellipse(archX + archW / 2, archY + archH, archW / 2, archH, 0, Math.PI, 0);
  ctx.fill();
  ctx.restore();
  drawParticles(ctx, w, h);
  return c;
}

// CORPORATE — Solid #111118, no spotlight, no decoration
function makeStripCorporate(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#111118";
  ctx.fillRect(0, 0, w, h);
  // Subtle top gradient overlay
  const topGrd = ctx.createLinearGradient(0, 0, 0, h);
  topGrd.addColorStop(0, "rgba(182,187,198,0.04)");
  topGrd.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topGrd;
  ctx.fillRect(0, 0, w, h);
  return c;
}

// ART — #1A0E2A → #0A0A10 | Spotlight #C7B2FF (lavender)
function makeStripArt(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  drawStripBase(ctx, w, h, "#1A0E2A", "#0A0A10", "#C7B2FF");
  drawParticles(ctx, w, h);
  return c;
}

// DEFAULT — same as music
function makeStripDefault(w, h) {
  return makeStripMusic(w, h);
}

console.log("\nGenerating strip images...");

const variants = [
  ["strip_music.png", makeStripMusic],
  ["strip_sports.png", makeStripSports],
  ["strip_corporate.png", makeStripCorporate],
  ["strip_art.png", makeStripArt],
  ["strip_default.png", makeStripDefault],
];

for (const [name, fn] of variants) {
  // We save only @3x resolution — the PowerShell bundler reads one file per variant
  savePng(name, fn(STRIP_W, STRIP_H));
}

console.log("\nAll ECLIPSE wallet assets generated successfully.\n");
console.log("Next step: run scripts\\generate_wallet_assets_module.ps1 to rebuild bundledAssets.ts\n");
