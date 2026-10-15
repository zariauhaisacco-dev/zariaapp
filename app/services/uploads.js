/*
 * Zaria — File upload storage
 *
 * Files live outside the web root at <app>/data/uploads/. They are NEVER
 * served directly; only through authenticated endpoints (see routes). This
 * means an unauthenticated visitor cannot enumerate or fetch private
 * documents even if they guess a filename.
 *
 * Naming: <clientId>-<random8hex>.<ext>
 *   - clientId makes forensics easy
 *   - random8hex prevents enumeration and collisions
 *
 * The DB stores only a relative path: "uploads/<filename>".
 * Helpers below turn that into an absolute path or a filesystem-safe name.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const ROOT = path.join(__dirname, '..', '..', 'data', 'uploads');
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;   // 2 MB
const MAX_DOC_BYTES   = 5 * 1024 * 1024;   // 5 MB

const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const DOC_EXTS   = new Set(['.jpg', '.jpeg', '.png', '.pdf']);

// Ensure the upload directory exists. Cheap, idempotent.
function ensureRoot() {
  if (!fs.existsSync(ROOT)) {
    fs.mkdirSync(ROOT, { recursive: true });
  }
}
ensureRoot();

function safeExt(originalName, allowedSet) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  return allowedSet.has(ext) ? ext : null;
}

function makeFilename(clientId, ext) {
  const rand = crypto.randomBytes(4).toString('hex');
  return String(clientId) + '-' + rand + ext;
}

function absPath(relPath) {
  // Guard against path traversal: only allow paths beginning with "uploads/"
  const s = String(relPath || '');
  if (!s.startsWith('uploads/')) throw new Error('Bad path');
  const name = s.slice('uploads/'.length);
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('Bad path');
  }
  return path.join(ROOT, name);
}

function relFor(name) {
  return 'uploads/' + name;
}

// ---------------------------------------------------------------
// Multer middlewares
// ---------------------------------------------------------------

function makeStorage(kind, allowedExts) {
  return multer.diskStorage({
    destination: function (req, file, cb) {
      ensureRoot();
      cb(null, ROOT);
    },
    filename: function (req, file, cb) {
      const ext = safeExt(file.originalname, allowedExts);
      if (!ext) return cb(new Error('Unsupported file type'));
      // We expect req.clientId to be set by the route before multer runs.
      const cid = req.clientId || req.user && req.user.id || 0;
      cb(null, makeFilename(cid, ext));
    },
  });
}

function makeFilter(allowedExts) {
  return function (req, file, cb) {
    const ext = safeExt(file.originalname, allowedExts);
    if (!ext) return cb(new Error('Unsupported file type'));
    cb(null, true);
  };
}

const uploadPhoto = multer({
  storage: makeStorage('photo', PHOTO_EXTS),
  limits: { fileSize: MAX_PHOTO_BYTES },
  fileFilter: makeFilter(PHOTO_EXTS),
}).single('photo');

const uploadIdDocument = multer({
  storage: makeStorage('document', DOC_EXTS),
  limits: { fileSize: MAX_DOC_BYTES },
  fileFilter: makeFilter(DOC_EXTS),
}).single('document');

// ---------------------------------------------------------------
// Stream / delete helpers
// ---------------------------------------------------------------

function streamFile(relPath, res, contentType) {
  const p = absPath(relPath);
  if (!fs.existsSync(p)) {
    return res.status(404).json({ error: 'File not found' });
  }
  if (contentType) res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(p).pipe(res);
}

function deleteFile(relPath) {
  try {
    const p = absPath(relPath);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
  } catch (_) {
    return false;
  }
}

function contentTypeFor(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png':  return 'image/png';
    case '.webp': return 'image/webp';
    case '.pdf':  return 'application/pdf';
    default:      return 'application/octet-stream';
  }
}

module.exports = {
  ROOT,
  MAX_PHOTO_BYTES,
  MAX_DOC_BYTES,
  PHOTO_EXTS,
  DOC_EXTS,
  uploadPhoto,
  uploadIdDocument,
  absPath,
  relFor,
  streamFile,
  deleteFile,
  contentTypeFor,
};
