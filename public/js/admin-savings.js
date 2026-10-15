/* Zaria — Admin savings list */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { q: '' };

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

  async function load() {
    var tbody = $('accountsBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:24px">Loading…</td></tr>';

    try {
      var qs = state.q ? '?q=' + encodeURIComponent(state.q) : '';
      var res = await fetch('/api/admin/savings/accounts' + qs, { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'load');
      render(data.accounts || [], data.totals);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neg);padding:24px">Could not load</td></tr>';
    }
  }

  function render(accounts, totals) {
    var tbody = $('accountsBody');
    $('countLabel').textContent = accounts.length + ' account' + (accounts.length === 1 ? '' : 's');

    if (totals) {
      $('statsStrip').style.display = '';
      $('statAccounts').textContent = totals.accounts;
      $('statBalance').innerHTML = '<span class="unit">KES</span>' + fmtMoney(totals.balance);
      var avg = totals.accounts > 0 ? totals.balance / totals.accounts : 0;
      $('statAvg').innerHTML = '<span class="unit">KES</span>' + fmtMoney(avg);
    }

    if (!accounts.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:32px">No savings accounts yet</td></tr>';
      return;
    }

    tbody.innerHTML = accounts.map(function (a) {
      var statusClass = a.status === 'active' ? 'pos' : a.status === 'dormant' ? 'warn' : 'neutral';
      return '<tr data-account-id="' + a.id + '" style="cursor:pointer">' +
        '<td><span style="font-family:var(--font-mono);font-weight:600">' + escapeHtml(a.account_number) + '</span></td>' +
        '<td><span class="name">' + escapeHtml(a.full_name) + '</span><div class="muted">' + escapeHtml(a.phone) + '</div></td>' +
        '<td class="num">' + fmtMoney(a.balance) + '</td>' +
        '<td class="num">' + fmtMoney(a.total_deposited) + '</td>' +
        '<td><span class="pill ' + statusClass + '">' + a.status + '</span></td>' +
        '<td>' + fmtDate(a.last_transaction_at || a.opened_at) + '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('tr[data-account-id]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        window.location.href = '/admin/savings/' + tr.getAttribute('data-account-id');
      });
    });
  }

  var searchTimer = null;
  $('searchInput').addEventListener('input', function (e) {
    state.q = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 250);
  });

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
      if (d.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }
      $('avatarBtn').textContent = d.user.email.charAt(0).toUpperCase();
      load();
    } catch (e) { window.location.replace('/'); }
  })();
})();
