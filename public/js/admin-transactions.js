/* Zaria — Admin transactions */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { page: 1, per_page: 50, q: '', type: '', status: '', from: '', to: '' };

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
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }
  function isoDate(d) { return d.toISOString().slice(0, 10); }

  function typeLabel(t) {
    return { disbursement: 'Disbursement', repayment: 'Repayment',
             late_fee: 'Late fee', adjustment: 'Adjustment' }[t] || t;
  }
  function statusClass(s) {
    return s === 'completed' ? 'pos' : s === 'failed' || s === 'reversed' ? 'neg' : 'warn';
  }

  async function load() {
    var tbody = $('txBody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--ink-500);padding:24px">Loading…</td></tr>';

    try {
      var params = new URLSearchParams();
      params.set('page', state.page);
      params.set('per_page', state.per_page);
      if (state.q) params.set('q', state.q);
      if (state.type) params.set('type', state.type);
      if (state.status) params.set('status', state.status);
      if (state.from) params.set('from', state.from);
      if (state.to) params.set('to', state.to);

      var res = await fetch('/api/admin/transactions?' + params.toString(), {
        credentials: 'same-origin'
      });
      if (res.status === 401) { window.location.replace('/'); return; }
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'load');

      render(data);
      $('exportBtn').href = '/api/admin/transactions/export.csv?' + params.toString();
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--neg);padding:24px">Could not load</td></tr>';
    }
  }

  function render(data) {
    var tbody = $('txBody');
    var txs = data.transactions || [];

    $('countLabel').textContent = data.total.toLocaleString() + ' transaction' + (data.total === 1 ? '' : 's');

    // Totals strip
    if (data.totals) {
      $('totalsStrip').style.display = '';
      $('totalDisbursed').textContent = 'KES ' + fmtMoney(data.totals.disbursed);
      $('totalRepaid').textContent = 'KES ' + fmtMoney(data.totals.repaid);
    }

    if (!txs.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--ink-500);padding:32px">No transactions match</td></tr>';
      $('paginationWrap').innerHTML = '';
      return;
    }

    tbody.innerHTML = txs.map(function (t) {
      var sign = t.type === 'repayment' ? '+' : (t.type === 'disbursement' ? '−' : '');
      return '<tr>' +
        '<td style="white-space:nowrap">' + fmtDateTime(t.created_at) + '</td>' +
        '<td><span class="name">' + escapeHtml(t.client_name) + '</span><div class="muted">' + escapeHtml(t.client_phone) + '</div></td>' +
        '<td>' + typeLabel(t.type) + '</td>' +
        '<td class="num">' + sign + fmtMoney(t.amount) + '</td>' +
        '<td class="muted">' + escapeHtml(t.mpesa_receipt || t.reference || '—') + '</td>' +
        '<td><a href="/admin/loans/' + t.loan_id + '" style="color:var(--navy-700);text-decoration:underline">#' + t.loan_id + '</a></td>' +
        '<td><span class="pill ' + statusClass(t.status) + '">' + t.status + '</span></td>' +
      '</tr>';
    }).join('');

    renderPagination(data.page, data.pages, data.total);
  }

  function renderPagination(current, pages, total) {
    var wrap = $('paginationWrap');
    if (pages <= 1) { wrap.innerHTML = ''; return; }
    function btn(label, page, disabled) {
      return '<button type="button" data-page="' + page + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button>';
    }
    wrap.innerHTML = '<div class="pagination">' +
      btn('← Prev', current - 1, current <= 1) +
      '<span class="page-info">Page ' + current + ' of ' + pages + ' · ' + total.toLocaleString() + ' total</span>' +
      btn('Next →', current + 1, current >= pages) +
      '</div>';
    wrap.querySelectorAll('[data-page]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = parseInt(b.getAttribute('data-page'), 10);
        if (p >= 1 && p <= pages) {
          state.page = p;
          load();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  // Filters
  $('applyBtn').addEventListener('click', function () {
    state.q = $('qInput').value.trim();
    state.type = $('typeSelect').value;
    state.status = $('statusSelect').value;
    state.from = $('fromDate').value;
    state.to = $('toDate').value;
    state.page = 1;
    load();
  });

  $('clearBtn').addEventListener('click', function () {
    $('qInput').value = '';
    $('typeSelect').value = '';
    $('statusSelect').value = '';
    $('fromDate').value = '';
    $('toDate').value = '';
    state = { page: 1, per_page: 50, q: '', type: '', status: '', from: '', to: '' };
    load();
  });

  // Date presets
  document.querySelectorAll('[data-preset]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var p = btn.getAttribute('data-preset');
      var now = new Date();
      if (p === 'today') {
        $('fromDate').value = isoDate(now);
        $('toDate').value = isoDate(now);
      } else if (p === '7d') {
        var d7 = new Date(now); d7.setDate(d7.getDate() - 6);
        $('fromDate').value = isoDate(d7);
        $('toDate').value = isoDate(now);
      } else if (p === '30d') {
        var d30 = new Date(now); d30.setDate(d30.getDate() - 29);
        $('fromDate').value = isoDate(d30);
        $('toDate').value = isoDate(now);
      }
      $('applyBtn').click();
    });
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

  // Bootstrap
  (async function bootstrap() {
    try {
      var res = await fetch('/api/me', { credentials: 'same-origin' });
      if (!res.ok) { window.location.replace('/'); return; }
      var d = await res.json();
      if (d.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }
      $('avatarBtn').textContent = d.user.email.charAt(0).toUpperCase();

      // Default to last 30 days
      var now = new Date();
      var d30 = new Date(now); d30.setDate(d30.getDate() - 29);
      $('fromDate').value = isoDate(d30);
      $('toDate').value = isoDate(now);
      state.from = $('fromDate').value;
      state.to = $('toDate').value;

      load();
    } catch (e) {
      window.location.replace('/');
    }
  })();
})();
