require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { buildSessionMiddleware } = require('./app/middleware/session');
const { authenticate } = require('./app/middleware/auth');
const { getIcon } = require('./app/services/icon');
const pages = require('./app/pages');

// Routes
const authRoutes = require('./app/routes/auth');
const signupRoutes = require('./app/routes/signup');
const adminRegistrations = require('./app/routes/admin-registrations');
const adminLoanRequests = require('./app/routes/admin-loan-requests');
const adminTransactions = require('./app/routes/admin-transactions');
const adminReports = require('./app/routes/admin-reports');
const adminAudit = require('./app/routes/admin-audit');
const adminSettings = require('./app/routes/admin-settings');
const adminSavings = require('./app/routes/admin-savings');
const adminShares = require('./app/routes/admin-shares');
const adminLoans = require('./app/routes/admin-loans');
const meRoutes = require('./app/routes/me');
const meSavings = require('./app/routes/me-savings');
const meShares = require('./app/routes/me-shares');
const adminDividends = require('./app/routes/admin-dividends');
const meDividends = require('./app/routes/me-dividends');
const pdfRoutes = require('./app/routes/pdf');
const pushRoutes = require('./app/routes/push');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// ============================================================
// Security
// ============================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());
app.use(buildSessionMiddleware());

// Global API rate limit
app.use('/api', rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ============================================================
// Health
// ============================================================
app.get('/health', async (req, res) => {
  try {
    const db = require('./app/db');
    const [r] = await db.query('SELECT 1 AS ok');
    res.json({ status: 'ok', db: r[0].ok === 1, env: process.env.NODE_ENV });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ============================================================
// Server-generated favicon
// ============================================================
const ALLOWED_SIZES = new Set([16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 384, 512]);

app.get('/favicon.ico', (req, res) => {
  try {
    const png = getIcon(32);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.send(png);
  } catch (err) {
    console.error('[favicon]', err.message);
    res.status(500).end();
  }
});

app.get('/favicon/:size', (req, res) => {
  const size = parseInt(req.params.size, 10);
  if (!Number.isInteger(size) || !ALLOWED_SIZES.has(size)) {
    return res.status(400).json({ error: 'Invalid size' });
  }
  try {
    const png = getIcon(size);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.send(png);
  } catch (err) {
    console.error('[favicon]', err.message);
    res.status(500).end();
  }
});

// ============================================================
// API routes
// ============================================================
app.use('/api/auth', authRoutes);
app.use('/api/auth', signupRoutes);

app.use('/api/admin/registrations', adminRegistrations);
app.use('/api/admin/loan-requests', adminLoanRequests);
app.use('/api/admin/transactions', adminTransactions);
app.use('/api/admin/reports', adminReports);
app.use('/api/admin/audit', adminAudit);
app.use('/api/admin/settings', adminSettings);
app.use('/api/admin/savings', adminSavings);
app.use('/api/admin/shares', adminShares);
app.use('/api/admin/dividends', adminDividends);
app.use('/api/admin', adminLoans);

app.use('/api/me', meRoutes);
app.use('/api/me/savings', meSavings);
app.use('/api/me/shares', meShares);
app.use('/api/me/dividends', meDividends);

app.use('/api', pdfRoutes);
app.use('/api/push', pushRoutes);

// ============================================================
// Static files
// ============================================================
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  index: false,
}));

// ============================================================
// Admin pages
// ============================================================
app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
});
app.get('/admin/registrations', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'registrations.html'));
});
app.get('/admin/loans', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'loans.html'));
});
app.get('/admin/loans/new', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'loan-new.html'));
});
app.get('/admin/loans/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'loan-detail.html'));
});
app.get('/admin/requests', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'requests.html'));
});
app.get('/admin/clients', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'clients.html'));
});
app.get('/admin/clients/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'client-detail.html'));
});
app.get('/admin/transactions', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'transactions.html'));
});
app.get('/admin/reports', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'reports.html'));
});
app.get('/admin/audit', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'audit.html'));
});
app.get('/admin/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'settings.html'));
});
app.get('/admin/savings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'savings.html'));
});
app.get('/admin/savings/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'savings-detail.html'));
});
app.get('/admin/shares', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'shares.html'));
});
app.get('/admin/shares/:clientId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'shares-detail.html'));
});

// ============================================================
// Client pages
// ============================================================
app.get('/admin/dividends', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'dividends.html'));
});
app.get('/admin/dividends/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'dividend-detail.html'));
});

app.get('/client/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client', 'dashboard.html'));
});
app.get('/client/loans', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client', 'loans.html'));
});
app.get('/client/loans/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client', 'loan-detail.html'));
});
app.get('/client/transactions', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client', 'transactions.html'));
});
app.get('/client/request', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client', 'request.html'));
});
app.get('/client/savings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client', 'savings.html'));
});
app.get('/client/shares', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client', 'shares.html'));
});

app.get('/client/dividends', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client', 'dividends.html'));
});

// ============================================================
// Public pages
// ============================================================
app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});
app.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'forgot-password.html'));
});
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// 404
// ============================================================
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ============================================================
// Error handler
// ============================================================
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// Start
// ============================================================
app.listen(PORT, () => {
  console.log('Zaria listening on port ' + PORT + ' (' + process.env.NODE_ENV + ')');
});
