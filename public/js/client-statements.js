/* Zaria — Client statements page */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function statusBadge(status) {
    var s = String(status || '').toLowerCase();
    return '<span class="search-result-badge" data-status="' + escapeHtml(s) + '">' + escapeHtml(s) + '</span>';
  }

  function renderLoan(l) {
    var outstanding = Number(l.outstanding) || 0;
    var progress = Math.max(0, Math.min(100, Number(l.progress_pct) || 0));

    return '' +
      '<section class="card" style="margin-bottom:12px">' +
        '<div class="card-head" style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
          '<div>' +
            '<h2 class="card-title" style="margin:0">Loan #' + l.id + ' · ' + escapeHtml(l.product_name || '—') + '</h2>' +
            '<p class="muted small" style="margin:4px 0 0">' +
              'Disbursed ' + fmtDate(l.disbursed_at || l.created_at) +
              ' · ' + l.term_months + ' month' + (l.term_months === 1 ? '' : 's') +
              ' · ' + (Number(l.interest_rate) * 100).toFixed(1) + '%' +
            '</p>' +
          '</div>' +
          statusBadge(l.status) +
        '</div>' +
        '<div class="card-body">' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px">' +
            '<div><div class="muted small">Principal</div><div style="font-weight:600;font-family:ui-monospace,monospace">KES ' + fmtMoney(l.principal) + '</div></div>' +
            '<div><div class="muted small">Repaid</div><div style="font-weight:600;font-family:ui-monospace,monospace;color:#1B7F4B">KES ' + fmtMoney(l.amount_repaid) + '</div></div>' +
            '<div><div class="muted small">Outstanding</div><div style="font-weight:600;font-family:ui-monospace,monospace;color:' + (outstanding > 0 ? '#B23A2F' : '#1B7F4B') + '">KES ' + fmtMoney(outstanding) + '</div></div>' +
          '</div>' +
          '<div style="background:var(--surface-2);border-radius:6px;height:6px;overflow:hidden;margin-bottom:14px">' +
            '<div style="height:100%;width:' + progress + '%;background:#1B7F4B"></div>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px">' +
            '<span class="muted small">' + progress + '% repaid</span>' +
            '<a class="btn-sm btn-amber" href="/api/statements/' + l.id + '" target="_blank" rel="noopener" style="text-decoration:none">Download statement (PDF)</a>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  function render(data) {
    var loading = $('loading');
    if (loading) loading.hidden = true;

    var list = $('list');
    var loans = (data && data.loans) || [];

    if (!loans.length) {
      list.innerHTML =
        '<div class="card"><div class="card-body" style="text-align:center;padding:40px 20px">' +
          '<p class="muted" style="margin:0">You don\'t have any loans yet.</p>' +
          '<p class="muted small" style="margin:8px 0 0">Statements will appear here once you take a loan.</p>' +
        '</div></div>';
      return;
    }

    list.innerHTML = loans.map(renderLoan).join('');
  }

  async function load() {
    try {
      var res = await fetch('/api/me/statements', { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      var data = await res.json();
      if (!res.ok) {
        var loading = $('loading');
        if (loading) loading.hidden = true;
        $('list').innerHTML = '<div class="alert alert-error">' + escapeHtml(data.error || 'Could not load statements') + '</div>';
        return;
      }
      render(data);
    } catch (err) {
      var loading = $('loading');
      if (loading) loading.hidden = true;
      $('list').innerHTML = '<div class="alert alert-error">Network error</div>';
    }
  }

  function wireSidebar() {
    var menuBtn = $('menuBtn');
    var sidebar = $('sidebar');
    var backdrop = $('sidebarBackdrop');
    if (!menuBtn || !sidebar) return;
    function open() { sidebar.classList.add('open'); if (backdrop) backdrop.hidden = false; }
    function close() { sidebar.classList.remove('open'); if (backdrop) backdrop.hidden = true; }
    menuBtn.addEventListener('click', function () {
      if (sidebar.classList.contains('open')) close(); else open();
    });
    if (backdrop) backdrop.addEventListener('click', close);
    sidebar.querySelectorAll('.nav-item').forEach(function (el) {
      el.addEventListener('click', function () {
        if (window.matchMedia('(max-width: 1023px)').matches) close();
      });
    });
  }

  function wireAvatar() {
    var av = $('avatarBtn');
    if (!av) return;
    fetch('/api/me', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.user && d.user.email) av.textContent = d.user.email.charAt(0).toUpperCase();
      })
      .catch(function () {});
    av.addEventListener('click', async function () {
      if (!confirm('Sign out of Zaria?')) return;
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.replace('/');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    wireSidebar();
    wireAvatar();
    load();
  });
})();
