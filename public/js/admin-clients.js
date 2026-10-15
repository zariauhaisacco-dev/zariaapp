/* Zaria — Admin clients list */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { q: '' };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async function load() {
    var tbody = $('clientsBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:24px">Loading…</td></tr>';

    try {
      var qs = state.q ? '?q=' + encodeURIComponent(state.q) : '';
      var res = await fetch('/api/admin/clients' + qs, { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      if (!res.ok) throw new Error('load failed');
      var data = await res.json();
      render(data.clients || []);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neg);padding:24px">Could not load</td></tr>';
    }
  }

  function render(list) {
    var tbody = $('clientsBody');
    $('countLabel').textContent = list.length + ' client' + (list.length === 1 ? '' : 's');

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:32px">No clients match</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function (c) {
      var statusClass = c.status === 'active' ? 'pos' : c.status === 'suspended' ? 'neg' : 'neutral';
      return '<tr data-client-id="' + c.id + '" style="cursor:pointer">' +
        '<td><span class="name">' + escapeHtml(c.full_name) + '</span></td>' +
        '<td class="muted">' + escapeHtml(c.phone) + '</td>' +
        '<td class="muted">' + escapeHtml(c.national_id || '—') + '</td>' +
        '<td class="num">' + (c.active_loans || 0) + '</td>' +
        '<td><span class="pill ' + statusClass + '">' + c.status + '</span></td>' +
        '<td>' + fmtDate(c.created_at) + '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('tr[data-client-id]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        window.location.href = '/admin/clients/' + tr.getAttribute('data-client-id');
      });
    });
  }

  var searchTimer = null;
  $('searchInput').addEventListener('input', function (e) {
    state.q = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 250);
  });

  // Chrome + auth
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

  // ===============================================================
  // Import / Export / New client
  // ===============================================================

  function showImportResult(data) {
    var el = $('importResult');
    var created = data.created || 0;
    var skipped = data.skipped || 0;
    var errors = data.errors || [];

    var html = '<div style="padding:12px;border-radius:6px;background:' + (created > 0 ? 'var(--pos-bg)' : 'var(--warn-bg)') + '">';
    html += '<div style="font-weight:600;font-size:13px;margin-bottom:6px">';
    html += created + ' created · ' + skipped + ' skipped';
    html += '</div>';
    if (errors.length) {
      html += '<div style="font-size:12px;color:var(--ink-600);max-height:120px;overflow-y:auto">';
      errors.slice(0, 20).forEach(function (e) {
        html += 'Row ' + e.row + ': ' + e.error + '<br>';
      });
      if (errors.length > 20) html += '… and ' + (errors.length - 20) + ' more';
      html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
    el.hidden = false;
  }

  function parseCSV(text) {
    var lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    var headers = lines[0].split(',').map(function (h) { return h.trim().toLowerCase(); });

    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) continue;
      // Simple CSV parsing (does not handle quoted commas — sufficient for our data)
      var cells = [];
      var cur = '';
      var inQuotes = false;
      for (var j = 0; j < line.length; j++) {
        var c = line[j];
        if (c === '"') { inQuotes = !inQuotes; continue; }
        if (c === ',' && !inQuotes) { cells.push(cur); cur = ''; continue; }
        cur += c;
      }
      cells.push(cur);

      var row = {};
      headers.forEach(function (h, idx) {
        row[h] = (cells[idx] || '').trim();
      });
      rows.push(row);
    }
    return rows;
  }

  // Import modal open
  $('importBtn').addEventListener('click', function () {
    $('importModal').hidden = false;
    $('importResult').hidden = true;
    $('csvPaste').value = '';
    $('csvFile').value = '';
  });

  $('importCancel').addEventListener('click', function () {
    $('importModal').hidden = true;
  });

  // Read file when selected
  $('csvFile').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      $('csvPaste').value = reader.result;
    };
    reader.readAsText(file);
  });

  $('importConfirm').addEventListener('click', async function () {
    var text = $('csvPaste').value.trim();
    if (!text) { alert('Paste or upload CSV data first'); return; }

    var rows = parseCSV(text);
    if (!rows.length) { alert('No data rows found'); return; }
    if (rows.length > 500) { alert('Max 500 rows per import'); return; }

    var btn = $('importConfirm');
    btn.disabled = true;
    btn.textContent = 'Importing…';

    try {
      var res = await fetch('/api/admin/clients/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rows }),
      });
      var data = await res.json();
      if (!res.ok) { alert(data.error || 'Import failed'); return; }
      showImportResult(data);
      // Refresh list after a moment
      setTimeout(function () { load(); }, 500);
    } catch (e) {
      alert('Network error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Import';
    }
  });

  // New client modal
  $('newClientBtn').addEventListener('click', function () {
    $('newClientModal').hidden = false;
    $('newClientError').hidden = true;
    $('ncFullName').value = '';
    $('ncEmail').value = '';
    $('ncPhone').value = '';
    $('ncNationalId').value = '';
    $('ncPassword').value = 'Zaria@2026';
  });

  $('newClientCancel').addEventListener('click', function () {
    $('newClientModal').hidden = true;
  });

  $('newClientConfirm').addEventListener('click', async function () {
    var payload = {
      rows: [{
        full_name: $('ncFullName').value.trim(),
        email: $('ncEmail').value.trim(),
        phone: $('ncPhone').value.trim(),
        national_id: $('ncNationalId').value.trim(),
        initial_password: $('ncPassword').value.trim(),
      }],
    };

    var btn = $('newClientConfirm');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
      var res = await fetch('/api/admin/clients/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var data = await res.json();
      if (!res.ok || data.created === 0) {
        var err = (data.errors && data.errors[0]) ? data.errors[0].error : 'Failed';
        var errEl = $('newClientError');
        errEl.textContent = err;
        errEl.hidden = false;
        return;
      }
      $('newClientModal').hidden = true;
      load();
    } catch (e) {
      var errEl = $('newClientError');
      errEl.textContent = 'Network error';
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create';
    }
  });

})();
