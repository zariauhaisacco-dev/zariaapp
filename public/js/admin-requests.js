/* Zaria — Admin loan request queue */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { status: 'pending', activeId: null, activeRequest: null };

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
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  async function load() {
    var wrap = $('listWrap');
    wrap.innerHTML = '<div class="empty">Loading…</div>';
    try {
      var res = await fetch('/api/admin/loan-requests?status=' + encodeURIComponent(state.status), { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      if (!res.ok) throw new Error('load failed');
      var data = await res.json();
      render(data.requests || []);
    } catch (e) {
      wrap.innerHTML = '<div class="empty">Could not load. Try refreshing.</div>';
    }
  }

  function render(list) {
    var wrap = $('listWrap');
    $('countLabel').textContent = list.length + ' ' + (list.length === 1 ? 'request' : 'requests');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty">Nothing here right now.</div>';
      return;
    }

    wrap.innerHTML = list.map(function (r) {
      var statusClass =
        r.status === 'pending' ? 'warn' :
        r.status === 'approved' ? 'pos' :
        r.status === 'rejected' ? 'neg' : 'neutral';

      var dupBadge = r.client_active_loans > 0
        ? '<span class="pill neg">Client has active loan</span>' : '';

      var actions = '';
      if (r.status === 'pending') {
        actions =
          '<div style="display:flex;gap:6px;flex-direction:column">' +
            '<button type="button" class="btn-sm btn-dark" data-approve="' + r.id + '">Approve</button>' +
            '<button type="button" class="btn-sm btn-outline" data-reject="' + r.id + '">Reject</button>' +
          '</div>';
      }

      return '<div class="attn-item" style="align-items:flex-start;padding:14px 16px">' +
        '<div class="attn-text">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<strong style="font-size:14px">' + escapeHtml(r.client_name) + '</strong>' +
            '<span class="pill ' + statusClass + '">' + r.status + '</span>' +
            dupBadge +
          '</div>' +
          '<div style="font-size:13px;color:var(--ink-700);margin-top:4px">' +
            '<strong>KES ' + fmtMoney(r.requested_amount) + '</strong> · ' +
            r.requested_term_months + ' month' + (r.requested_term_months === 1 ? '' : 's') +
            (r.product_name ? ' · ' + escapeHtml(r.product_name) : '') +
          '</div>' +
          '<div style="font-size:12px;color:var(--ink-500);margin-top:3px">' +
            escapeHtml(r.client_phone) + ' · ID ' + escapeHtml(r.national_id || '—') +
          '</div>' +
          '<div style="font-size:12px;color:var(--ink-400);margin-top:4px">' +
            'Requested ' + fmtDate(r.created_at) +
            ' · Repaid loans: ' + (r.client_repaid_count || 0) +
          '</div>' +
          (r.purpose ? '<div style="font-size:12.5px;color:var(--ink-600);margin-top:6px"><em>“' + escapeHtml(r.purpose) + '”</em></div>' : '') +
          (r.status === 'rejected' && r.rejection_reason ? '<div style="font-size:12px;color:var(--ink-500);margin-top:6px">Rejected: ' + escapeHtml(r.rejection_reason) + '</div>' : '') +
          (r.created_loan_id ? '<div style="font-size:12px;color:var(--ink-500);margin-top:4px">Created loan <a href="/admin/loans/' + r.created_loan_id + '" style="color:var(--navy-700);text-decoration:underline">#' + r.created_loan_id + '</a></div>' : '') +
        '</div>' +
        actions +
      '</div>';
    }).join('');

    wrap.querySelectorAll('[data-approve]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-approve');
        var r = list.find(function (x) { return String(x.id) === String(id); });
        openApprove(r);
      });
    });
    wrap.querySelectorAll('[data-reject]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.activeId = btn.getAttribute('data-reject');
        $('rejectModal').hidden = false;
      });
    });
  }

  function openApprove(r) {
    state.activeId = r.id;
    state.activeRequest = r;
    $('approveBody').innerHTML =
      'Approve <strong>' + escapeHtml(r.client_name) + '</strong>\'s request for <strong>KES ' +
      fmtMoney(r.requested_amount) + '</strong> over ' + r.requested_term_months +
      ' month' + (r.requested_term_months === 1 ? '' : 's') + '. You can adjust the final terms below.';

    $('approveAmount').value = r.requested_amount;
    $('approveRate').value = (Number(r.product_rate) * 100).toFixed(1);
    $('approveTerm').value = r.requested_term_months;
    $('approveModal').hidden = false;
  }

  $('approveCancel').addEventListener('click', function () {
    $('approveModal').hidden = true;
    state.activeId = null;
    state.activeRequest = null;
  });

  $('approveConfirm').addEventListener('click', async function () {
    if (!state.activeId) return;
    var btn = $('approveConfirm');
    btn.disabled = true; btn.textContent = 'Approving…';

    var amount = parseFloat($('approveAmount').value);
    var ratePct = parseFloat($('approveRate').value);
    var term = parseInt($('approveTerm').value, 10);

    if (!(amount > 0) || !(ratePct >= 0) || !(term >= 1)) {
      alert('Please fill in valid amount, rate, and term.');
      btn.disabled = false; btn.textContent = 'Approve & create loan';
      return;
    }

    try {
      var res = await fetch('/api/admin/loan-requests/' + state.activeId + '/approve', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amount,
          interest_rate: ratePct / 100,
          term_months: term,
        }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        alert(data.error || 'Approval failed');
        btn.disabled = false; btn.textContent = 'Approve & create loan';
        return;
      }
      $('approveModal').hidden = true;
      state.activeId = null;
      state.activeRequest = null;
      alert('Loan #' + data.loan_id + ' created. Opening it now.');
      window.location.href = '/admin/loans/' + data.loan_id;
    } catch (e) {
      alert('Network error');
      btn.disabled = false; btn.textContent = 'Approve & create loan';
    }
  });

  $('rejectCancel').addEventListener('click', function () {
    $('rejectModal').hidden = true;
    state.activeId = null;
    $('rejectReason').value = '';
  });

  $('rejectConfirm').addEventListener('click', async function () {
    if (!state.activeId) return;
    var reason = $('rejectReason').value.trim();
    if (reason.length < 3) { alert('Please enter a reason.'); return; }
    var btn = $('rejectConfirm');
    btn.disabled = true; btn.textContent = 'Rejecting…';
    try {
      var res = await fetch('/api/admin/loan-requests/' + state.activeId + '/reject', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason, send_reason: true }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        alert(data.error || 'Rejection failed');
        btn.disabled = false; btn.textContent = 'Reject';
        return;
      }
      $('rejectModal').hidden = true;
      state.activeId = null;
      $('rejectReason').value = '';
      load();
    } catch (e) {
      alert('Network error');
    } finally {
      btn.disabled = false; btn.textContent = 'Reject';
    }
  });

  $('statusFilter').addEventListener('change', function (e) {
    state.status = e.target.value;
    load();
  });
  $('refreshBtn').addEventListener('click', load);

  // Avatar + drawer
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
    } catch (e) {
      window.location.replace('/');
    }
  })();
})();
