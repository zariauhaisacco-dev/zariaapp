const { Resvg } = require('@resvg/resvg-js');

// ============================================================
// The Zaria icon — a single SVG source of truth.
// Navy rounded square + amber "Z" + subtle inner glow.
// Change the SVG below and every size updates everywhere.
// ============================================================
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

  <!-- Rounded square background -->
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect width="512" height="512" rx="112" fill="url(#glow)"/>

  <!-- The Z mark — geometric, drawn as a path so it scales crisply -->
  <path d="
    M 148 156
    L 364 156
    L 364 200
    L 218 356
    L 364 356
    L 364 400
    L 148 400
    L 148 356
    L 294 200
    L 148 200
    Z
  " fill="#F5B301"/>

  <!-- Small dot for character -->
  <circle cx="366" cy="150" r="14" fill="#F5B301"/>
</svg>
`;

// ============================================================
// Render to PNG buffer at the requested size.
// ============================================================
function renderIcon(size) {
  const svg = ICON_SVG(size);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)', // transparent
  });
  const png = resvg.render().asPng();
  return png;
}

// In-memory LRU-ish cache. Cap at 100 entries.
const cache = new Map();
const MAX_CACHE = 100;

function getIcon(size) {
  if (cache.has(size)) return cache.get(size);
  const png = renderIcon(size);
  if (cache.size >= MAX_CACHE) {
    // Drop the oldest entry
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(size, png);
  return png;
}

module.exports = { getIcon, ICON_SVG };
