/* Zaria — Admin loans list */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var state = { status: 'all', q: '' };

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

  function statusClass(s) {
    if (s === 'active') return 'pos';
    if (s === 'repaid') return 'neutral';
    if (s === 'overdue' || s === 'defaulted') return 'neg';
    if (s === 'pending' || s === 'approved') return 'warn';
    return 'neutral';
  }

  async function load() {
    var tbody = $('loansBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:24px">Loading…</td></tr>';

    var params = [];
    if (state.status && state.status !== 'all') params.push('status=' + encodeURIComponent(state.status));
    if (state.q) params.push('q=' + encodeURIComponent(state.q));
    var qs = params.length ? '?' + params.join('&') : '';

    try {
      var res = await fetch('/api/admin/loans' + qs, { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      if (!res.ok) throw new Error('load failed');
      var data = await res.json();
      render(data.loans || []);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neg);padding:24px">Could not load loans</td></tr>';
    }
  }

  function render(loans) {
    var tbody = $('loansBody');
    var count = $('countLabel');
    count.textContent = loans.length + ' loan' + (loans.length === 1 ? '' : 's');

    if (!loans.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:32px">No loans match this filter</td></tr>';
      return;
    }

    tbody.innerHTML = loans.map(function (l) {
      return '<tr data-id="' + l.id + '" style="cursor:pointer">' +
        '<td><span class="name">' + escapeHtml(l.client_name) + '</span><div class="muted">' + escapeHtml(l.client_phone) + '</div></td>' +
        '<td class="muted">#' + l.id + '</td>' +
        '<td class="num">' + fmtMoney(l.principal) + '</td>' +
        '<td class="num">' + fmtMoney(l.outstanding) + '</td>' +
        '<td><span class="pill ' + statusClass(l.status) + '">' + l.status + '</span></td>' +
        '<td>' + fmtDate(l.next_due || l.disbursed_at || l.created_at) + '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('tr[data-id]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        window.location.href = '/admin/loans/' + tr.getAttribute('data-id');
      });
    });
  }

  // Filter tabs
  document.querySelectorAll('[data-filter]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-filter]').forEach(function (b) { b.classList.remove('btn-dark'); b.classList.add('btn-outline'); });
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-dark');
      state.status = btn.getAttribute('data-filter');
      load();
    });
  });

  // Search
  var searchTimer = null;
  var searchInput = $('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', function (e) {
      state.q = e.target.value.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(load, 250);
    });
  }

  // Avatar
  function wireAvatar() {
    var av = $('avatarBtn');
    av.addEventListener('click', async function () {
      if (!confirm('Sign out?')) return;
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.replace('/');
    });
  }

  // Bootstrap
  (async function () {
    try {
      var meRes = await fetch('/api/me', { credentials: 'same-origin' });
      if (!meRes.ok) { window.location.replace('/'); return; }
      var me = await meRes.json();
      if (me.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }
      $('avatarBtn').textContent = me.user.email.charAt(0).toUpperCase();
      wireAvatar();
      load();
    } catch (e) {
      window.location.replace('/');
    }
  })();
})();
