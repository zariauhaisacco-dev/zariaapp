/* Zaria — Admin client detail */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var clientId = null;
  var current = null;

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
    try {
      var res = await fetch('/api/admin/clients/' + clientId, { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      if (res.status === 404) {
        $('clientName').textContent = 'Client not found';
        return;
      }
      if (!res.ok) throw new Error('load');
      var data = await res.json();
      current = data;
      render(data);
    } catch (e) {
      $('clientSub').textContent = 'Could not load';
    }
  }

  function render(data) {
    var c = data.client;
    var loans = data.loans || [];

    $('clientName').textContent = c.full_name;
    $('clientSub').textContent = 'Joined ' + fmtDate(c.created_at) + ' · ' + c.email;

    $('statBorrowed').innerHTML = '<span class="unit">KES</span>' + fmtMoney(c.total_borrowed);
    $('statRepaid').innerHTML = '<span class="unit">KES</span>' + fmtMoney(c.total_repaid);
    $('statActive').textContent = c.active_loans;
    $('statTotal').textContent = c.total_loans;

    var statusClass = c.status === 'active' ? 'pos' : c.status === 'suspended' ? 'neg' : 'neutral';
    $('statusPill').className = 'pill ' + statusClass;
    $('statusPill').textContent = c.status;

    $('infoList').innerHTML =
      '<div class="kv-row"><span class="kv-label">Email</span><span class="kv-value" style="font-family:var(--font-sans);font-weight:400">' + escapeHtml(c.email) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Phone</span><span class="kv-value">' + escapeHtml(c.phone) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">National ID</span><span class="kv-value">' + escapeHtml(c.national_id || '—') + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Client ID</span><span class="kv-value">#' + c.id + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">User ID</span><span class="kv-value">#' + c.user_id + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">ID document</span><span class="kv-value">' +
        (c.has_id_document
          ? '<a id="idDocLink" href="/api/admin/clients/' + c.id + '/id-document" target="_blank" rel="noopener" style="color:#0B1F3A;text-decoration:underline">View document</a>'
          : '<span class="muted">Not uploaded</span>') +
      '</span></div>';

    // Danger zone labels
    $('toggleStatusLabel').textContent = c.status === 'active' ? 'Suspend client' : 'Activate client';

    // Loans
    $('loansSub').textContent = loans.length + ' loan' + (loans.length === 1 ? '' : 's');
    if (!loans.length) {
      $('loansBody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:32px">No loans yet</td></tr>';
    } else {
      $('loansBody').innerHTML = loans.map(function (l) {
        var cls = l.status === 'active' ? 'pos' : l.status === 'repaid' ? 'neutral' : l.status === 'overdue' ? 'neg' : 'warn';
        var outstanding = Number(l.total_repayable) - Number(l.amount_repaid);
        return '<tr data-loan-id="' + l.id + '" style="cursor:pointer">' +
          '<td class="muted">#' + l.id + '</td>' +
          '<td class="num">' + fmtMoney(l.principal) + '</td>' +
          '<td class="num">' + fmtMoney(l.amount_repaid) + '</td>' +
          '<td class="num">' + fmtMoney(outstanding) + '</td>' +
          '<td><span class="pill ' + cls + '">' + l.status + '</span></td>' +
          '<td>' + fmtDate(l.disbursed_at || l.created_at) + '</td>' +
        '</tr>';
      }).join('');
      $('loansBody').querySelectorAll('tr[data-loan-id]').forEach(function (tr) {
        tr.addEventListener('click', function () {
          window.location.href = '/admin/loans/' + tr.getAttribute('data-loan-id');
        });
      });
    }
  }

  // Suspend / activate
  $('toggleStatusBtn').addEventListener('click', async function () {
    if (!current) return;
    var c = current.client;
    var newStatus = c.status === 'active' ? 'suspended' : 'active';
    var label = newStatus === 'suspended' ? 'Suspend' : 'Activate';
    if (!confirm(label + ' ' + c.full_name + '?')) return;
    try {
      var res = await fetch('/api/admin/clients/' + clientId + '/status', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        var b = await res.json().catch(function () { return {}; });
        alert(b.error || 'Failed');
        return;
      }
      load();
    } catch (e) { alert('Network error'); }
  });

  // Reset password
  $('resetPwdBtn').addEventListener('click', async function () {
    if (!current) return;
    var c = current.client;
    var pwd = prompt('Enter a new password for ' + c.full_name + ' (min 8 chars):\n\nThe client will be signed out of all devices.');
    if (!pwd) return;
    if (pwd.length < 8) { alert('Password must be at least 8 characters'); return; }
    try {
      var res = await fetch('/api/admin/clients/' + clientId + '/reset-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: pwd }),
      });
      var b = await res.json().catch(function () { return {}; });
      if (!res.ok) { alert(b.error || 'Failed'); return; }
      alert('Password updated. Give the new password to ' + c.full_name + ' directly.');
    } catch (e) { alert('Network error'); }
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

  (async function bootstrap() {
    try {
      var res = await fetch('/api/me', { credentials: 'same-origin' });
      if (!res.ok) { window.location.replace('/'); return; }
      var d = await res.json();
      if (d.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }
      $('avatarBtn').textContent = d.user.email.charAt(0).toUpperCase();

      var m = window.location.pathname.match(/\/admin\/clients\/(\d+)/);
      if (!m) { window.location.replace('/admin/clients'); return; }
      clientId = m[1];
      load();
    } catch (e) { window.location.replace('/'); }
  })();
})();
