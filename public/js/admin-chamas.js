/* Zaria — Admin chamas list */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function loadList() {
    var includeInactive = $('showInactive').checked;
    var res = await fetch('/api/admin/chamas' + (includeInactive ? '?include_inactive=1' : ''), {
      credentials: 'same-origin'
    });
    if (res.status === 401) { window.location.replace('/'); return; }
    if (!res.ok) {
      $('chamaBody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:#cf2632;padding:24px">Failed to load chamas</td></tr>';
      return;
    }
    var data = await res.json();
    var list = data.chamas || [];

    $('pageSub').textContent = list.length + ' chama' + (list.length === 1 ? '' : 's');
    $('listSub').textContent = includeInactive ? 'All chamas (including inactive)' : 'Active groups';

    var tbody = $('chamaBody');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:32px">No chamas yet. Click "New chama" to create the first one.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function (c) {
      var statusClass = c.status === 'active' ? 'pos' : 'neutral';
      return '<tr>' +
        '<td><a href="/admin/chamas/' + c.id + '" style="color:var(--ink-900);text-decoration:none;font-weight:600">' + escapeHtml(c.name) + '</a>' +
        (c.description ? '<div class="muted" style="font-size:12px;margin-top:2px">' + escapeHtml(c.description) + '</div>' : '') +
        '</td>' +
        '<td class="muted">' + escapeHtml(c.code) + '</td>' +
        '<td class="num" style="text-align:right">' + (c.member_count || 0) + '</td>' +
        '<td class="num" style="text-align:right">KES ' + fmtMoney(c.balance) + '</td>' +
        '<td><span class="pill ' + statusClass + '">' + escapeHtml(c.status) + '</span></td>' +
        '<td style="text-align:right"><a href="/admin/chamas/' + c.id + '" class="btn-sm btn-outline" style="text-decoration:none">View</a></td>' +
        '</tr>';
    }).join('');
  }

  function openModal() {
    $('createModal').hidden = false;
    $('createError').hidden = true;
    $('createForm').reset();
    $('newMin').value = '300';
    setTimeout(function () { $('newName').focus(); }, 50);
  }

  function closeModal() {
    $('createModal').hidden = true;
  }

  async function submitCreate(e) {
    e.preventDefault();
    var btn = $('createSubmit');
    var err = $('createError');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Creating…';

    var payload = {
      name: $('newName').value.trim(),
      code: $('newCode').value.trim().toUpperCase(),
      description: $('newDesc').value.trim() || null,
      monthly_contribution_min: Number($('newMin').value) || 300,
      times_money_enabled: $('newTm').checked,
    };

    try {
      var res = await fetch('/api/admin/chamas', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var data = await res.json();
      if (!res.ok) {
        err.textContent = data.error || 'Could not create chama';
        err.hidden = false;
        return;
      }
      closeModal();
      await loadList();
      if (data.chamaId) {
        window.location.href = '/admin/chamas/' + data.chamaId;
      }
    } catch (ex) {
      err.textContent = 'Network error. Try again.';
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadList();
    $('newChamaBtn').addEventListener('click', openModal);
    $('createCancel').addEventListener('click', closeModal);
    $('createClose').addEventListener('click', closeModal);
    $('createForm').addEventListener('submit', submitCreate);
    $('showInactive').addEventListener('change', loadList);
  });
})();
