/*
 * Zaria — placeholder pages for admin and client areas.
 * If the actual HTML file exists in public/, serve it.
 * Otherwise serve a "coming soon" page with dashboard chrome.
 */

const path = require('path');
const fs = require('fs');

const PUBLIC = path.join(__dirname, '..', 'public');

function pageOrPlaceholder(role, page, title) {
  return (req, res) => {
    const file = path.join(PUBLIC, role, page + '.html');
    if (fs.existsSync(file)) {
      return res.sendFile(file);
    }
    res.type('html').send(renderPlaceholder(role, page, title));
  };
}

function renderPlaceholder(role, page, title) {
  const backHref = role === 'admin' ? '/admin/dashboard' : '/client/dashboard';
  const roleName = role === 'admin' ? 'Admin' : 'My account';
  const ADMIN_NAV = [
    ['/admin/dashboard', 'Dashboard'],
    ['/admin/loans', 'Loans'],
    ['/admin/requests', 'Requests'],
    ['/admin/clients', 'Clients'],
    ['/admin/registrations', 'Registrations'],
    ['/admin/transactions', 'Transactions'],
    ['/admin/reports', 'Reports'],
    ['/admin/audit', 'Audit log'],
    ['/admin/settings', 'Settings'],
  ];
  const CLIENT_NAV = [
    ['/client/dashboard', 'Overview'],
    ['/client/loans', 'My loans'],
    ['/client/transactions', 'Transactions'],
    ['/client/request', 'Request a loan'],
    ['/client/statements', 'Statements'],
    ['/client/settings', 'Preferences'],
  ];
  const items = (role === 'admin' ? ADMIN_NAV : CLIENT_NAV)
    .map(function (it) {
      const active = req_path_ends_with(it[0], '/' + role + '/' + page) ? ' active' : '';
      return '<a class="nav-item' + active + '" href="' + it[0] + '">' + it[1] + '</a>';
    }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zaria · ${title}</title>
  <link rel="stylesheet" href="/css/app.css">
  <link rel="stylesheet" href="/css/dashboard.css">
</head>
<body>
<div class="dash">
  <header class="topbar">
    <div class="topbar-brand">
      <span class="brand-chip">Z</span><span class="brand-word">Zaria</span>
    </div>
    <div class="topbar-actions">
      <a class="btn-sm btn-outline" href="${backHref}">Back to dashboard</a>
      <div class="avatar" id="avatarBtn">·</div>
    </div>
  </header>

  <aside class="sidebar" id="sidebar">
    <nav>
      <div class="nav-group">
        <div class="nav-group-label">${roleName}</div>
        ${items}
      </div>
    </nav>
  </aside>

  <main class="main">
    <div class="page-head">
      <div>
        <h1 class="page-title">${title}</h1>
        <p class="page-sub">Coming soon</p>
      </div>
    </div>
    <section class="card">
      <div class="empty" style="padding:60px 20px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;color:var(--ink-300);margin-bottom:10px">
          <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
        </svg>
        <p style="margin:0 0 6px;font-size:14px">This page is under construction.</p>
        <p style="margin:0;font-size:12px;color:var(--ink-400)">We're building it now. Check back soon.</p>
      </div>
    </section>
  </main>
</div>

<script src="/js/placeholder.js" defer></script>
</body>
</html>`;
}

function req_path_ends_with(a, b) { return a === b; }

const ADMIN_PAGES = [];

const CLIENT_PAGES = [
  ['loans', 'My loans'],
  ['transactions', 'Transactions'],
  ['request', 'Request a loan'],
  ['statements', 'Statements'],
  ['settings', 'Preferences'],
];

function mount(app) {
  ADMIN_PAGES.forEach(function (p) {
    app.get('/admin/' + p[0], pageOrPlaceholder('admin', p[0], p[1]));
  });
  CLIENT_PAGES.forEach(function (p) {
    app.get('/client/' + p[0], pageOrPlaceholder('client', p[0], p[1]));
  });
}

module.exports = { mount };
