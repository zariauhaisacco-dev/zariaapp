/* Zaria — Client dividends page */
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
    return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtRate(n) {
    n = Number(n) || 0;
    return n.toFixed(4).replace(/\.?0+$/, '');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function statusClass(s) {
    if (s === 'credited' || s === 'paid') return 'pos';
    if (s === 'failed') return 'neg';
    return 'warn';
  }

  async function load() {
    var tbody = $('payoutsBody');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--ink-500);padding:24px">Loading…</td></tr>';

    try {
      var res = await fetch('/api/me/dividends', { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'load');
      render(data);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--neg);padding:24px">Could not load</td></tr>';
    }
  }

  function render(data) {
    var payouts = data.payouts || [];
    var totals = data.totals || { gross: 0, tax: 0, net: 0 };

    // Stats strip only if there are any payouts
    if (payouts.length > 0) {
      $('statsStrip').style.display = '';
      $('statGross').innerHTML = '<span class="unit">KES</span>' + fmtMoney(totals.gross);
      $('statTax').innerHTML = '<span class="unit">KES</span>' + fmtMoney(totals.tax);
      $('statNet').innerHTML = '<span class="unit">KES</span>' + fmtMoney(totals.net);
      $('statCount').textContent = payouts.length;
    } else {
      $('statsStrip').style.display = 'none';
    }

    $('payoutsSub').textContent = payouts.length + ' payout' + (payouts.length === 1 ? '' : 's');

    if (!payouts.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--ink-500);padding:32px">No dividends yet. When Zaria declares a dividend, it will appear here.</td></tr>';
      return;
    }

    tbody.innerHTML = payouts.map(function (p) {
      var creditedText = p.status === 'credited' || p.status === 'paid'
        ? (p.credited_to_savings ? 'Savings' : 'Cash') + ' · ' + fmtDate(p.paid_at)
        : '—';

      return '<tr>' +
        '<td><strong>FY ' + escapeHtml(p.financial_year) + '</strong></td>' +
        '<td class="num">' + p.shares_at_declaration + '</td>' +
        '<td class="num">' + fmtRate(p.dividend_per_share) + '</td>' +
        '<td class="num">' + fmtMoney(p.gross_amount) + '</td>' +
        '<td class="num">' + fmtMoney(p.withholding_tax) + '</td>' +
        '<td class="num" style="font-weight:600;color:var(--pos)">' + fmtMoney(p.net_amount) + '</td>' +
        '<td><span class="pill ' + statusClass(p.status) + '">' + p.status + '</span></td>' +
        '<td class="muted" style="font-size:12px">' + creditedText + '</td>' +
      '</tr>';
    }).join('');
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
    } catch (e) { window.location.replace('/'); }
  })();
})();
