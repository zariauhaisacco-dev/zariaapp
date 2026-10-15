/* Zaria — Client loans list */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function statusClass(s) {
    if (s === 'active') return 'pos';
    if (s === 'repaid') return 'neutral';
    if (s === 'overdue' || s === 'defaulted') return 'neg';
    if (s === 'pending' || s === 'approved') return 'warn';
    return 'neutral';
  }

  async function load() {
    var wrap = $('loansWrap');
    try {
      var res = await fetch('/api/me/loans', { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      if (!res.ok) throw new Error('load');
      var data = await res.json();
      render(data.loans || []);
    } catch (e) {
      wrap.innerHTML = '<div class="card"><div class="empty">Could not load your loans. Please refresh.</div></div>';
    }
  }

  function render(loans) {
    var wrap = $('loansWrap');
    $('countLabel').textContent = loans.length + ' loan' + (loans.length === 1 ? '' : 's');

    if (!loans.length) {
      wrap.innerHTML =
        '<div class="card"><div class="empty" style="padding:60px 20px">' +
          '<p style="margin:0 0 12px;font-size:14px">You don\'t have any loans yet.</p>' +
          '<a class="btn-sm btn-dark" href="/client/request" style="text-decoration:none;display:inline-flex;height:38px;padding:0 18px;align-items:center">Request your first loan</a>' +
        '</div></div>';
      return;
    }

    wrap.innerHTML = loans.map(function (l) {
      var cls = statusClass(l.status);
      var pct = l.progressPct || 0;
      var total = Number(l.total_repayable);
      var repaid = Number(l.amount_repaid);
      var outstanding = total - repaid;

      return '<div class="card" style="margin-bottom:14px;cursor:pointer" data-loan-id="' + l.id + '">' +
        '<div class="card-body">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px">' +
            '<div>' +
              '<h3 style="margin:0 0 4px;font-size:15px;font-weight:700">Loan #' + l.id + '</h3>' +
              '<div style="font-size:12.5px;color:var(--ink-500)">' +
                (Number(l.interest_rate) * 100).toFixed(1) + '% flat · ' +
                l.term_months + ' month' + (l.term_months === 1 ? '' : 's') +
                (l.disbursed_at ? ' · Disbursed ' + fmtDate(l.disbursed_at) : ' · Created ' + fmtDate(l.created_at)) +
              '</div>' +
            '</div>' +
            '<span class="pill ' + cls + '">' + l.status + '</span>' +
          '</div>' +

          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:14px;font-size:12.5px">' +
            '<div><div style="color:var(--ink-500);margin-bottom:2px">Principal</div><div style="font-family:var(--font-mono);font-weight:600">KES ' + fmtMoney(l.principal) + '</div></div>' +
            '<div><div style="color:var(--ink-500);margin-bottom:2px">Repaid</div><div style="font-family:var(--font-mono);font-weight:600;color:var(--pos)">KES ' + fmtMoney(repaid) + '</div></div>' +
            '<div><div style="color:var(--ink-500);margin-bottom:2px">Outstanding</div><div style="font-family:var(--font-mono);font-weight:600">KES ' + fmtMoney(outstanding) + '</div></div>' +
          '</div>' +

          '<div class="progress-row" style="color:var(--ink-600);font-size:12px">' +
            '<span>' + pct + '% repaid</span>' +
            '<div class="progress-bar" style="background:var(--line-1)"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
            '<span>KES ' + fmtMoney(total) + ' total</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    wrap.querySelectorAll('[data-loan-id]').forEach(function (card) {
      card.addEventListener('click', function () {
        window.location.href = '/client/loans/' + card.getAttribute('data-loan-id');
      });
    });
  }

  // Chrome
  (function wireChrome() {
    var av = $('avatarBtn');
    var menuBtn = $('menuBtn');
    var sidebar = $('sidebar');
    var backdrop = $('sidebarBackdrop');

    function closeDrawer() {
      if (sidebar) sidebar.classList.remove('open');
      if (backdrop) backdrop.classList.remove('open');
    }
    if (menuBtn) menuBtn.addEventListener('click', function () {
      sidebar.classList.toggle('open');
      if (backdrop) backdrop.classList.toggle('open');
    });
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

    av.addEventListener('click', async function () {
      if (!confirm('Sign out?')) return;
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.replace('/');
    });
  })();

  (async function bootstrap() {
    try {
      var res = await fetch('/api/me', { credentials: 'same-origin' });
      if (!res.ok) { window.location.replace('/'); return; }
      var d = await res.json();
      if (d.user.role !== 'client') { window.location.replace('/admin/dashboard'); return; }
      $('avatarBtn').textContent = d.user.email.charAt(0).toUpperCase();
      load();
    } catch (e) {
      window.location.replace('/');
    }
  })();
})();
