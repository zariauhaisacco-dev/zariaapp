/* Zaria — Admin registrations page */
(function () {
  'use strict';

  var currentStatus = 'pending';
  var activeId = null;

  var listWrap = document.getElementById('listWrap');
  var pageSub = document.getElementById('pageSub');

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    return d.toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  async function load() {
    listWrap.innerHTML = '<div class="empty">Loading…</div>';
    try {
      var res = await fetch('/api/admin/registrations?status=' + encodeURIComponent(currentStatus), {
        credentials: 'same-origin'
      });
      if (res.status === 401) { window.location.replace('/'); return; }
      if (!res.ok) throw new Error('load failed');
      var data = await res.json();
      render(data.registrations || []);
    } catch (e) {
      listWrap.innerHTML = '<div class="empty">Could not load. Try refreshing.</div>';
    }
  }

  function render(list) {
    pageSub.textContent = list.length + ' ' + (list.length === 1 ? 'record' : 'records');
    if (!list.length) {
      listWrap.innerHTML = '<div class="empty">Nothing here right now.</div>';
      return;
    }
    var html = list.map(function (r) {
      var statusClass = r.status === 'pending' ? 'warn'
                      : r.status === 'approved' ? 'pos'
                      : r.status === 'rejected' ? 'neg' : 'neutral';
      var dupBadge = (r.duplicates && r.duplicates.length)
        ? '<span class="pill neg">Duplicate?</span>' : '';
      var purposeLine = r.purpose
        ? '<div style="font-size:12.5px;color:var(--ink-600);margin-top:6px"><em>“' + escapeHtml(r.purpose) + '”</em></div>' : '';
      var dupLine = (r.duplicates && r.duplicates.length)
        ? '<div style="font-size:12px;color:var(--neg);margin-top:6px">Possible match: ' +
          r.duplicates.map(function (d) { return escapeHtml(d.full_name) + ' (' + escapeHtml(d.phone) + ')'; }).join(', ') +
          '</div>' : '';
      var reasonLine = (r.status === 'rejected' && r.rejection_reason)
        ? '<div style="font-size:12px;color:var(--ink-500);margin-top:6px">Rejection reason: ' + escapeHtml(r.rejection_reason) + '</div>' : '';
      var actions = (r.status === 'pending')
        ? '<div style="display:flex;gap:6px;flex-direction:column">' +
            '<button type="button" class="btn-sm btn-dark" data-approve="' + r.id + '" data-name="' + escapeHtml(r.full_name) + '">Approve</button>' +
            '<button type="button" class="btn-sm btn-outline" data-reject="' + r.id + '" data-name="' + escapeHtml(r.full_name) + '">Reject</button>' +
          '</div>' : '';

      return '<div class="attn-item" style="align-items:flex-start;padding:14px 16px">' +
        '<div class="attn-text">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<strong style="font-size:14px">' + escapeHtml(r.full_name) + '</strong>' +
            '<span class="pill ' + statusClass + '">' + r.status + '</span>' +
            dupBadge +
          '</div>' +
          '<div style="font-size:12.5px;color:var(--ink-600);margin-top:4px">' +
            escapeHtml(r.email) + ' · ' + escapeHtml(r.phone) + ' · ID ' + escapeHtml(r.national_id) +
          '</div>' +
          '<div style="font-size:12px;color:var(--ink-400);margin-top:4px">' +
            'Applied ' + fmtDate(r.created_at) + ' · IP ' + escapeHtml(r.ip_address || '—') +
          '</div>' +
          purposeLine + dupLine + reasonLine +
        '</div>' +
        actions +
      '</div>';
    }).join('');
    listWrap.innerHTML = html;
  }

  listWrap.addEventListener('click', function (e) {
    var approveBtn = e.target.closest('[data-approve]');
    var rejectBtn = e.target.closest('[data-reject]');

    if (approveBtn) {
      activeId = approveBtn.getAttribute('data-approve');
      document.getElementById('approveBody').innerHTML =
        'You are approving <strong>' + approveBtn.getAttribute('data-name') + '</strong>. ' +
        'This creates their user account and client profile, and sends them a welcome email.';
      document.getElementById('approveModal').hidden = false;
      return;
    }

    if (rejectBtn) {
      activeId = rejectBtn.getAttribute('data-reject');
      document.getElementById('rejectModal').hidden = false;
    }
  });

  document.getElementById('approveCancel').addEventListener('click', function () {
    document.getElementById('approveModal').hidden = true;
    activeId = null;
  });

  document.getElementById('approveConfirm').addEventListener('click', async function () {
    if (!activeId) return;
    var btn = document.getElementById('approveConfirm');
    btn.disabled = true; btn.textContent = 'Approving…';
    try {
      var res = await fetch('/api/admin/registrations/' + activeId + '/approve', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        document.getElementById('approveModal').hidden = true;
        activeId = null;
        load();
      } else {
        var b = await res.json().catch(function () { return {}; });
        alert(b.error || 'Approval failed');
      }
    } catch (e) {
      alert('Network error');
    } finally {
      btn.disabled = false; btn.textContent = 'Approve';
    }
  });

  document.getElementById('rejectCancel').addEventListener('click', function () {
    document.getElementById('rejectModal').hidden = true;
    activeId = null;
    document.getElementById('rejectReason').value = '';
  });

  document.getElementById('rejectConfirm').addEventListener('click', async function () {
    if (!activeId) return;
    var reason = document.getElementById('rejectReason').value.trim();
    if (reason.length < 3) { alert('Please enter a reason.'); return; }
    var sendReason = document.getElementById('sendReason').checked;
    var btn = document.getElementById('rejectConfirm');
    btn.disabled = true; btn.textContent = 'Rejecting…';
    try {
      var res = await fetch('/api/admin/registrations/' + activeId + '/reject', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason, sendReason: sendReason })
      });
      if (res.ok) {
        document.getElementById('rejectModal').hidden = true;
        activeId = null;
        document.getElementById('rejectReason').value = '';
        load();
      } else {
        var b = await res.json().catch(function () { return {}; });
        alert(b.error || 'Rejection failed');
      }
    } catch (e) {
      alert('Network error');
    } finally {
      btn.disabled = false; btn.textContent = 'Reject';
    }
  });

  document.getElementById('statusFilter').addEventListener('change', function (e) {
    currentStatus = e.target.value;
    load();
  });
  document.getElementById('refreshBtn').addEventListener('click', load);

  (async function () {
    try {
      var res = await fetch('/api/me', { credentials: 'same-origin' });
      if (!res.ok) { window.location.replace('/'); return; }
      var d = await res.json();
      if (d.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }
      var av = document.getElementById('avatarBtn');
      av.textContent = d.user.email.charAt(0).toUpperCase();
      av.addEventListener('click', async function () {
        if (!confirm('Sign out?')) return;
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        window.location.replace('/');
      });
      load();
    } catch (e) {
      window.location.replace('/');
    }
  })();
})();
