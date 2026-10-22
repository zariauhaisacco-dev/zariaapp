/* Zaria — Admin registrations page (with merge support) */
(function () {
  'use strict';

  var currentStatus = 'pending';
  var activeId = null;
  var currentReg = null;  // holds the pending registration object currently in the modal

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

  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
            '<button type="button" class="btn-sm btn-dark" data-approve="' + r.id + '" data-name="' + escapeHtml(r.full_name) + '">Review</button>' +
            '<button type="button" class="btn-sm btn-outline" data-reject="' + r.id + '" data-name="' + escapeHtml(r.full_name) + '">Reject</button>' +
          '</div>' : '';

      return '<div class="attn-item" style="align-items:flex-start;padding:14px 16px">' +
        '<div class="attn-text">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<strong style="font-size:14px">' + escapeHtml(r.full_name) + '</strong>' +
            (r.chama_name ? ' <span class="pill info" style="font-size:11px;margin-left:6px" title="Invited to chama">🏘 ' + escapeHtml(r.chama_name) + '</span>' : '') +
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

  // ---------- Modal open ----------

  function renderCandidate(c) {
    var matchLabel = c.match_type === 'national_id' ? 'national ID'
                   : c.match_type === 'phone' ? 'phone'
                   : 'full name';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#fff;border:1px solid var(--line-1);border-radius:6px;margin-bottom:8px">' +
      '<div style="flex:1">' +
        '<div style="font-weight:600;font-size:13px">Client #' + c.client_id + ' — ' + escapeHtml(c.full_name) + '</div>' +
        '<div style="font-size:12px;color:var(--ink-500);margin-top:2px">Matched: ' + matchLabel + ' · ' + escapeHtml(c.historic_email) + '</div>' +
        '<div style="font-size:12px;color:var(--ink-500);margin-top:2px">Savings: KES ' + fmtMoney(c.savings_balance) +
          ' · Shares: ' + (c.shares_held || 0) + '</div>' +
      '</div>' +
      '<button type="button" class="btn-sm btn-dark" data-merge="' + c.client_id + '" data-name="' + escapeHtml(c.full_name) + '" style="white-space:nowrap">Merge</button>' +
    '</div>';
  }

  function renderSearchResult(c) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#fff;border:1px solid var(--line-1);border-radius:6px;margin-bottom:6px">' +
      '<div style="flex:1">' +
        '<div style="font-weight:600;font-size:13px">#' + c.client_id + ' — ' + escapeHtml(c.full_name) + '</div>' +
        '<div style="font-size:12px;color:var(--ink-500);margin-top:2px">' + escapeHtml(c.phone) + ' · ' + escapeHtml(c.national_id || 'no ID') + ' · Savings: KES ' + fmtMoney(c.savings_balance) + '</div>' +
      '</div>' +
      '<button type="button" class="btn-sm btn-dark" data-merge="' + c.client_id + '" data-name="' + escapeHtml(c.full_name) + '" style="white-space:nowrap">Merge</button>' +
    '</div>';
  }

  async function openApproveModal(id, name) {
    activeId = id;
    currentReg = null;

    document.getElementById('approveBody').innerHTML =
      'Loading details for <strong>' + escapeHtml(name) + '</strong>…';
    document.getElementById('candidatesSection').hidden = true;
    document.getElementById('candidatesList').innerHTML = '';
    document.getElementById('histSearchInput').value = '';
    document.getElementById('histSearchResults').innerHTML = '';
    document.getElementById('approveModal').hidden = false;

    try {
      var res = await fetch('/api/admin/registrations/' + id + '/candidates', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('candidates failed');
      var data = await res.json();
      currentReg = data.registration;

      document.getElementById('approveBody').innerHTML =
        '<strong>' + escapeHtml(currentReg.full_name) + '</strong><br>' +
        escapeHtml(currentReg.email) + ' · ' + escapeHtml(currentReg.phone) + ' · ID ' + escapeHtml(currentReg.national_id) +
        '<br><span style="color:var(--ink-500);font-size:13px">Choose: merge with an existing historic client, or create a brand new client.</span>';

      if (data.candidates && data.candidates.length) {
        document.getElementById('candidatesSection').hidden = false;
        document.getElementById('candidatesList').innerHTML = data.candidates.map(renderCandidate).join('');
      }
    } catch (e) {
      document.getElementById('approveBody').innerHTML =
        'Could not load candidate details. You can still approve or cancel.';
    }
  }

  // ---------- Event wiring ----------

  listWrap.addEventListener('click', function (e) {
    var approveBtn = e.target.closest('[data-approve]');
    var rejectBtn = e.target.closest('[data-reject]');

    if (approveBtn) {
      openApproveModal(approveBtn.getAttribute('data-approve'), approveBtn.getAttribute('data-name'));
      return;
    }

    if (rejectBtn) {
      activeId = rejectBtn.getAttribute('data-reject');
      document.getElementById('rejectModal').hidden = false;
    }
  });

  // Merge buttons in candidates / search results
  document.getElementById('approveModal').addEventListener('click', async function (e) {
    var mergeBtn = e.target.closest('[data-merge]');
    if (!mergeBtn || !activeId) return;

    var cid = mergeBtn.getAttribute('data-merge');
    var cname = mergeBtn.getAttribute('data-name');
    if (!confirm('Merge this signup with historic client #' + cid + ' (' + cname + ')?\n\nThe historic client\'s savings, shares, and history will be preserved. This cannot be undone.')) return;

    mergeBtn.disabled = true;
    mergeBtn.textContent = 'Merging…';
    try {
      var res = await fetch('/api/admin/registrations/' + activeId + '/merge', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: Number(cid) })
      });
      var body = await res.json().catch(function () { return {}; });
      if (res.ok) {
        document.getElementById('approveModal').hidden = true;
        activeId = null;
        currentReg = null;
        load();
      } else {
        alert(body.error || 'Merge failed');
        mergeBtn.disabled = false;
        mergeBtn.textContent = 'Merge';
      }
    } catch (err) {
      alert('Network error');
      mergeBtn.disabled = false;
      mergeBtn.textContent = 'Merge';
    }
  });

  // Search historic (debounced)
  var searchTimer = null;
  document.getElementById('histSearchInput').addEventListener('input', function (e) {
    var q = e.target.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) {
      document.getElementById('histSearchResults').innerHTML = '';
      return;
    }
    searchTimer = setTimeout(async function () {
      try {
        var res = await fetch('/api/admin/registrations/historic/search?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
        if (!res.ok) return;
        var data = await res.json();
        if (!data.clients || !data.clients.length) {
          document.getElementById('histSearchResults').innerHTML = '<div style="font-size:12px;color:var(--ink-500);padding:6px">No matches</div>';
          return;
        }
        document.getElementById('histSearchResults').innerHTML = data.clients.map(renderSearchResult).join('');
      } catch (e) {
        document.getElementById('histSearchResults').innerHTML = '<div style="font-size:12px;color:var(--neg);padding:6px">Search failed</div>';
      }
    }, 300);
  });

  document.getElementById('approveCancel').addEventListener('click', function () {
    document.getElementById('approveModal').hidden = true;
    activeId = null;
    currentReg = null;
  });

  document.getElementById('approveConfirm').addEventListener('click', async function () {
    if (!activeId) return;
    if (!confirm('Create a brand new client for this signup? (This will NOT use any historic record.)')) return;
    var btn = document.getElementById('approveConfirm');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      var res = await fetch('/api/admin/registrations/' + activeId + '/approve', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        document.getElementById('approveModal').hidden = true;
        activeId = null;
        currentReg = null;
        load();
      } else {
        var b = await res.json().catch(function () { return {}; });
        alert(b.error || 'Approval failed');
      }
    } catch (e) {
      alert('Network error');
    } finally {
      btn.disabled = false; btn.textContent = 'Create new client';
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
