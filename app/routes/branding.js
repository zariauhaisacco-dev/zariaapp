/*
 * Zaria — Public branding endpoint
 *
 * GET /api/branding       — public, no auth. Returns name, tagline, logo path, mission, vision.
 * GET /api/branding/logo  — public, no auth. Streams the current logo (or 404).
 *
 * Used by the landing page and app chrome to display admin-configurable branding.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');

const router = express.Router();

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');

const DEFAULTS = {
  sacco_name: 'Zaria Uhai SACCO',
  tagline: 'Save together. Grow together.',
  logo_url: 'logo.png',
  mission_short: 'Inclusive savings, affordable credit, and member-centered support.',
  vision: '',
  color_primary: '#0B1F3A',
  color_accent: '#F5B301',
  color_background: '#F8F7F5',
  contact_phone: '0746 138 896',
  contact_whatsapp: '254746138896',
  contact_email: 'info@zariauhai.com',
  contact_location: 'Nairobi, Kenya',
  contact_hours: 'Mon–Sat, 8:00–18:00 EAT',
};

async function readBranding() {
  try {
    const [rows] = await db.query(
      `SELECT setting_key, setting_value FROM app_settings
        WHERE setting_key IN (
          'sacco_name','tagline','logo_url','mission_short','vision',
          'color_primary','color_accent','color_background',
          'contact_phone','contact_whatsapp','contact_email','contact_location','contact_hours'
        )`
    );
    const map = Object.assign({}, DEFAULTS);
    rows.forEach(function (r) {
      if (r.setting_value != null && r.setting_value !== '') map[r.setting_key] = r.setting_value;
    });
    return map;
  } catch (err) {
    console.error('[branding]', err.message);
    return DEFAULTS;
  }
}

router.get('/', async (req, res) => {
  const b = await readBranding();
  const hasCustom = await fileExists(b.logo_url);
  res.json({
    sacco_name: b.sacco_name,
    tagline: b.tagline,
    mission_short: b.mission_short,
    vision: b.vision,
    logo_url: hasCustom ? '/api/branding/logo' : '/logo.png',
    colors: {
      primary: b.color_primary,
      accent: b.color_accent,
      background: b.color_background,
    },
    contact: {
      phone: b.contact_phone,
      whatsapp: b.contact_whatsapp,
      email: b.contact_email,
      location: b.contact_location,
      hours: b.contact_hours,
    },
  });
});

async function fileExists(rel) {
  if (!rel) return false;
  try {
    const candidates = [
      path.join(PUBLIC_DIR, rel),
      path.join(UPLOADS_DIR, path.basename(rel)),
    ];
    return candidates.some(p => fs.existsSync(p));
  } catch (_) { return false; }
}

router.get('/logo', async (req, res) => {
  const b = await readBranding();
  if (!b.logo_url) return res.status(404).end();

  // Try uploads first (admin-uploaded), then public (bundled default)
  const uploadPath = path.join(UPLOADS_DIR, path.basename(b.logo_url));
  const publicPath = path.join(PUBLIC_DIR, b.logo_url);

  let target = null;
  if (fs.existsSync(uploadPath)) target = uploadPath;
  else if (fs.existsSync(publicPath)) target = publicPath;

  if (!target) return res.status(404).end();

  const ext = path.extname(target).toLowerCase();
  const type = ext === '.svg' ? 'image/svg+xml'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : 'image/png';

  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'public, max-age=300');
  fs.createReadStream(target).pipe(res);
});

module.exports = router;
