(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  var state = { page: 1, filters: {} };

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function buildQuery() {
    var parts = [];
    if (state.filters.from) parts.push('from=' + encodeURIComponent(state.filters.from));
    if (state.filters.to) parts.push('to=' + encodeURIComponent(state.filters.to));
    if (state.filters.status) parts.push('status=' + encodeURIComponent(state.filters.status));
    if (state.filters.q) parts.push('q=' + encodeURIComponent(state.filters.q));
    parts.push('page=' + state.page);
    return parts.join('&');
  }

  async function load() {
    var tbody = $('tableBody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--ink-500)">Loading…</td></tr>';

    try {
      var res = await fetch('/api/admin/reports/sms?' + buildQuery(), { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'load failed');
      render(data);
    } catch (e) {
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--neg)">Could not load SMS reports</td></tr>';
    }
  }

  function render(data) {
    var s = data.summary || {};
    $('statTotal').textContent = s.total || 0;
    $('statSent').textContent = s.sent || 0;
    $('statFailed').textContent = s.failed || 0;
    $('statCost').textContent = Number(s.total_credits || 0).toFixed(2);

    $('pageSub').textContent = (s.total || 0) + ' SMS messages';

    var rows = data.sms || [];
    var tbody = $('tableBody');

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--ink-500)">No SMS messages match these filters</td></tr>';
    } else {
      tbody.innerHTML = rows.map(function (r) {
        var statusClass = r.status === 'delivered' ? 'pos'
                        : r.status === 'failed' ? 'neg'
                        : r.status === 'sent' ? 'warn' : 'neutral';
        var msgPreview = escapeHtml((r.message || '').slice(0, 60)) + ((r.message || '').length > 60 ? '…' : '');

        return '<tr>' +
          '<td>' + fmtDateTime(r.created_at) + '</td>' +
          '<td><span style="font-family:var(--font-mono);font-size:12px">' + escapeHtml(r.phone) + '</span></td>' +
          '<td>' + (r.client_name ? escapeHtml(r.client_name) : '<span style="color:var(--ink-400)">—</span>') + '</td>' +
          '<td>' + (r.template ? '<span class="pill neutral" style="font-size:11px">' + escapeHtml(r.template) + '</span>' : '—') + '</td>' +
          '<td title="' + escapeHtml(r.message || '') + '">' + msgPreview + '</td>' +
          '<td><span class="pill ' + statusClass + '">' + r.status + '</span></td>' +
          '<td class="num" style="text-align:right">' + Number(r.credits_charged || 0).toFixed(2) + '</td>' +
        '</tr>';
      }).join('');
    }

    var p = data.pagination || {};
    $('paginationInfo').textContent = 'Page ' + p.page + ' of ' + p.pages + ' (' + p.total + ' total)';
    $('prevBtn').disabled = p.page <= 1;
    $('nextBtn').disabled = p.page >= p.pages;
  }

  function applyFilters() {
    state.filters = {
      from: $('fromInput').value || null,
      to: $('toInput').value || null,
      status: $('statusFilter').value || null,
      q: $('searchInput').value.trim() || null,
    };
    state.page = 1;
    load();
  }

  $('applyBtn').addEventListener('click', applyFilters);

  $('resetBtn').addEventListener('click', function () {
    $('fromInput').value = '';
    $('toInput').value = '';
    $('statusFilter').value = '';
    $('searchInput').value = '';
    state.filters = {};
    state.page = 1;
    load();
  });

  $('prevBtn').addEventListener('click', function () {
    if (state.page > 1) { state.page--; load(); }
  });

  $('nextBtn').addEventListener('click', function () {
    state.page++;
    load();
  });

  $('exportBtn').addEventListener('click', function (e) {
    e.preventDefault();
    var params = [];
    if (state.filters.from) params.push('from=' + encodeURIComponent(state.filters.from));
    if (state.filters.to) params.push('to=' + encodeURIComponent(state.filters.to));
    if (state.filters.status) params.push('status=' + encodeURIComponent(state.filters.status));
    if (state.filters.q) params.push('q=' + encodeURIComponent(state.filters.q));
    window.location.href = '/api/admin/reports/sms/export.csv?' + params.join('&');
  });

  // Default: current month
  (function initDates() {
    var now = new Date();
    var first = new Date(now.getFullYear(), now.getMonth(), 1);
    var iso = function (d) {
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + m + '-' + day;
    };
    $('fromInput').value = iso(first);
    $('toInput').value = iso(now);
    state.filters = { from: iso(first), to: iso(now) };
  })();

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

    if (av) av.addEventListener('click', async function () {
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
