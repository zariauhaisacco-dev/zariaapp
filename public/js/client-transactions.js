/* Zaria — Client transactions */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var all = [];
  var typeFilter = 'all';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function typeLabel(t) {
    if (t === 'repayment') return 'Payment';
    if (t === 'disbursement') return 'Disbursement';
    if (t === 'late_fee') return 'Late fee';
    if (t === 'adjustment') return 'Adjustment';
    return t;
  }
  function statusClass(s) {
    if (s === 'completed') return 'pos';
    if (s === 'failed' || s === 'reversed') return 'neg';
    return 'warn';
  }

  async function load() {
    try {
      var res = await fetch('/api/me/transactions', { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      if (!res.ok) throw new Error('load');
      var data = await res.json();
      all = data.transactions || [];

      // Compute totals
      var repaid = 0, borrowed = 0;
      all.forEach(function (t) {
        if (t.status !== 'completed') return;
        if (t.type === 'repayment') repaid += Number(t.amount);
        if (t.type === 'disbursement') borrowed += Number(t.amount);
      });
      $('totalRepaid').textContent = 'KES ' + fmtMoney(repaid);
      $('totalBorrowed').textContent = 'KES ' + fmtMoney(borrowed);

      render();
    } catch (e) {
      $('txBody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neg);padding:24px">Could not load transactions</td></tr>';
    }
  }

  function render() {
    var visible = all.filter(function (t) {
      if (typeFilter === 'all') return true;
      return t.type === typeFilter;
    });

    $('countLabel').textContent = visible.length + ' transaction' + (visible.length === 1 ? '' : 's');

    if (!visible.length) {
      $('txBody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:32px">No transactions yet</td></tr>';
      return;
    }

    $('txBody').innerHTML = visible.map(function (t) {
      var sign = t.type === 'repayment' ? '+' : (t.type === 'disbursement' ? '−' : '');
      return '<tr>' +
        '<td>' + fmtDateTime(t.created_at) + '</td>' +
        '<td>' + typeLabel(t.type) + '</td>' +
        '<td><a href="/client/loans/' + t.loan_id + '" style="color:var(--navy-700);text-decoration:underline">#' + t.loan_id + '</a></td>' +
        '<td class="num">' + sign + fmtMoney(t.amount) + '</td>' +
        '<td class="muted">' + escapeHtml(t.mpesa_receipt || t.reference || '—') + '</td>' +
        '<td><span class="pill ' + statusClass(t.status) + '">' + t.status + '</span></td>' +
      '</tr>';
    }).join('');
  }

  $('typeFilter').addEventListener('change', function (e) {
    typeFilter = e.target.value;
    render();
  });

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
