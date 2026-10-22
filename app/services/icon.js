const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

// ============================================================
// Zaria PWA / favicon icon service.
//
// Source of truth (in priority order):
//   1. data/uploads/brand-hero.png      (admin-uploaded square logo)
//   2. public/images/brand-hero.png     (bundled square logo — 900x900)
//   3. legacy SVG (inline)              (fallback if neither PNG exists)
//
// Cache key includes ICON_VERSION so bumping .env invalidates the
// in-memory cache without a Passenger restart.
// ============================================================

const ROOT = path.join(__dirname, '..', '..');
const UPLOADS_LOGO = path.join(ROOT, 'data', 'uploads', 'brand-hero.png');
const PUBLIC_LOGO  = path.join(ROOT, 'public', 'logo.png');

function resolveBrandPng() {
  if (fs.existsSync(UPLOADS_LOGO)) return UPLOADS_LOGO;
  if (fs.existsSync(PUBLIC_LOGO))  return PUBLIC_LOGO;
  return null;
}

const ICON_SVG = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#12294B"/>
      <stop offset="100%" stop-color="#0B1F3A"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.2" r="0.9">
      <stop offset="0%" stop-color="#F5B301" stop-opacity="0.28"/>
      <stop offset="60%" stop-color="#F5B301" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect width="512" height="512" rx="112" fill="url(#glow)"/>
  <path d="M 148 156 L 364 156 L 364 200 L 218 356 L 364 356 L 364 400 L 148 400 L 148 356 L 294 200 L 148 200 Z" fill="#F5B301"/>
  <circle cx="366" cy="150" r="14" fill="#F5B301"/>
</svg>
`;

function renderLegacySvg(size) {
  const svg = ICON_SVG(size);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });
  return resvg.render().asPng();
}

async function renderBrandPng(size) {
  const src = resolveBrandPng();
  if (!src) throw new Error("no brand png");
  const PAD = { r: 11, g: 31, b: 58, alpha: 1 }; // #0B1F3A navy
  return sharp(src)
    .resize(size, size, { fit: "contain", background: PAD })
    .flatten({ background: PAD })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer();
}

const cache = new Map();
const MAX_CACHE = 100;

function cacheKey(size) {
  const v = process.env.ICON_VERSION || '1';
  return size + ':' + v;
}

async function getIcon(size) {
  const key = cacheKey(size);
  if (cache.has(key)) return cache.get(key);

  let png;
  try {
    png = await renderBrandPng(size);
  } catch (err) {
    console.error('[icon] brand png unavailable, using svg fallback:', err.message);
    png = renderLegacySvg(size);
  }

  if (cache.size >= MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, png);
  return png;
}

module.exports = { getIcon, ICON_SVG };
