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

// ─────────────────────────────────────────────────────────────
// Yearly savings collection (added 2026-10-21)
// ─────────────────────────────────────────────────────────────
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { data: null, activeYear: null };

  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function fmtShort(n) {
    n = Number(n) || 0;
    if (n === 0) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function renderTabs() {
    if (!state.data || !state.data.years) return;
    $('yearTabs').innerHTML = state.data.years.map(function (y) {
      var active = y.year === state.activeYear ? ' active' : '';
      return '<button type="button" class="year-tab' + active + '" data-year="' + y.year + '">' + y.year + '</button>';
    }).join('');

    Array.prototype.forEach.call($('yearTabs').querySelectorAll('.year-tab'), function (btn) {
      btn.addEventListener('click', function () {
        state.activeYear = Number(btn.getAttribute('data-year'));
        Array.prototype.forEach.call($('yearTabs').querySelectorAll('.year-tab'), function (b) {
          b.classList.toggle('active', b === btn);
        });
        renderMonths();
      });
    });
  }

  function renderMonths() {
    if (!state.data || !state.data.years) return;
    var yr = state.data.years.find(function (y) { return y.year === state.activeYear; });
    if (!yr) return;

    $('yearlySub').textContent = yr.txn_count + ' transaction' + (yr.txn_count === 1 ? '' : 's') +
      ' · up to ' + yr.client_count + ' client' + (yr.client_count === 1 ? '' : 's') +
      ' · ' + yr.year;

    $('yearTotal').textContent = 'KES ' + fmtMoney(yr.total);

    $('monthGrid').innerHTML = yr.months.map(function (m) {
      var has = m.total > 0;
      var title = m.txn_count ? ' title="' + m.txn_count + ' txn from ' + m.client_count + ' client(s)"' : '';
      return '<div class="month-cell' + (has ? ' has-amount' : '') + '"' + title + '>' +
        '<div class="month-label">' + m.label + '</div>' +
        '<div class="month-amount">' + fmtShort(m.total) + '</div>' +
      '</div>';
    }).join('');
  }

  async function load() {
    try {
      var res = await fetch('/api/admin/savings/monthly', { credentials: 'same-origin' });
      if (!res.ok) {
        $('yearlySub').textContent = 'Could not load';
        return;
      }
      state.data = await res.json();
      var currentYear = new Date().getFullYear();
      var hasCurrent = (state.data.years || []).some(function (y) { return y.year === currentYear; });
      state.activeYear = hasCurrent ? currentYear : (state.data.years[0] || {}).year;
      renderTabs();
      renderMonths();
    } catch (e) {
      console.error('[admin savings monthly]', e);
      $('yearlySub').textContent = 'Could not load';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
