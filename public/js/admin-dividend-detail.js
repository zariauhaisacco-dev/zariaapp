/* Zaria — Admin dividend detail */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var declarationId = null;
  var current = null;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtRate(n) {
    n = Number(n) || 0;
    return n.toFixed(4).replace(/\.?0+$/, '');
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function statusClass(s) {
    if (s === 'distributed') return 'pos';
    if (s === 'declared') return 'warn';
    if (s === 'cancelled') return 'neg';
    return 'neutral';
  }
  function payoutStatusClass(s) {
    if (s === 'credited' || s === 'paid') return 'pos';
    if (s === 'failed') return 'neg';
    return 'warn';
  }

  async function load() {
    try {
      var res = await fetch('/api/admin/dividends/' + declarationId, { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      if (res.status === 404) {
        $('declTitle').textContent = 'Not found';
        return;
      }
      if (!res.ok) throw new Error('load');
      var data = await res.json();
      current = data;
      render(data);
    } catch (e) {
      $('declSub').textContent = 'Could not load';
    }
  }

  function render(data) {
    var d = data.declaration;
    var payouts = data.payouts || [];

    $('declTitle').textContent = 'FY ' + d.financial_year;
    $('declSub').textContent = 'Declared ' + fmtDateTime(d.created_at) +
      (d.distributed_at ? ' · Distributed ' + fmtDateTime(d.distributed_at) : '');

    $('statRate').textContent = fmtRate(d.dividend_per_share);
    $('statShares').textContent = d.total_shares_at_declaration;
    $('statGross').innerHTML = '<span class="unit">KES</span>' + fmtMoney(d.total_payout);

    // Net = total payout × 0.95
    var net = Number(d.total_payout) * 0.95;
    $('statNet').innerHTML = '<span class="unit">KES</span>' + fmtMoney(net);

    // Status pill
    $('statusPill').className = 'pill ' + statusClass(d.status);
    $('statusPill').textContent = d.status;

    // Info list
    $('infoSub').textContent = 'Ref: DIV-' + d.id;
    $('infoList').innerHTML =
      '<div class="kv-row"><span class="kv-label">Financial year</span><span class="kv-value">' + escapeHtml(d.financial_year) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Rate per share</span><span class="kv-value">KES ' + fmtRate(d.dividend_per_share) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Total shares at declaration</span><span class="kv-value">' + d.total_shares_at_declaration + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Total gross payout</span><span class="kv-value">KES ' + fmtMoney(d.total_payout) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Withholding tax (5%)</span><span class="kv-value">KES ' + fmtMoney(net === 0 ? 0 : Number(d.total_payout) - net) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Net payout</span><span class="kv-value">KES ' + fmtMoney(net) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Created by</span><span class="kv-value" style="font-family:var(--font-sans);font-weight:400">' + escapeHtml(d.created_by_email || '—') + '</span></div>' +
      (d.notes ? '<div class="kv-row"><span class="kv-label">Notes</span><span class="kv-value" style="font-family:var(--font-sans);font-weight:400;max-width:60%;text-align:right">' + escapeHtml(d.notes) + '</span></div>' : '');

    // Action buttons
    var actionsHtml = '';
    if (d.status === 'draft') {
      actionsHtml += '<button type="button" class="btn-sm btn-dark" id="distributeBtn">Distribute</button>';
      actionsHtml += '<button type="button" class="btn-sm btn-outline" id="cancelBtn" style="margin-left:8px">Cancel declaration</button>';
    }
    $('actionButtons').innerHTML = actionsHtml;

    if (d.status === 'draft') {
      $('distributeBtn').addEventListener('click', openDistributeConfirm);
      $('cancelBtn').addEventListener('click', cancelDeclaration);
    }

    // Payouts table
    $('payoutsSub').textContent = payouts.length + ' member' + (payouts.length === 1 ? '' : 's');
    if (!payouts.length) {
      if (d.status === 'draft') {
        $('payoutsBody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:32px">Not distributed yet — click Distribute above to credit savings</td></tr>';
      } else {
        $('payoutsBody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:32px">No payouts</td></tr>';
      }
    } else {
      $('payoutsBody').innerHTML = payouts.map(function (p) {
        return '<tr>' +
          '<td><span class="name">' + escapeHtml(p.full_name) + '</span><div class="muted">' + escapeHtml(p.phone) + '</div></td>' +
          '<td class="num">' + p.shares_at_declaration + '</td>' +
          '<td class="num">' + fmtMoney(p.gross_amount) + '</td>' +
          '<td class="num">' + fmtMoney(p.withholding_tax) + '</td>' +
          '<td class="num" style="font-weight:600">' + fmtMoney(p.net_amount) + '</td>' +
          '<td><span class="pill ' + payoutStatusClass(p.status) + '">' + p.status + '</span></td>' +
        '</tr>';
      }).join('');
    }
  }

  // ---------------------------------------------------------------
  // Distribute
  // ---------------------------------------------------------------

  function openDistributeConfirm() {
    var net = (Number(current.declaration.total_payout) * 0.95).toFixed(2);
    if (!confirm(
      'Distribute dividend FY ' + current.declaration.financial_year + '?\n\n' +
      'Total gross payout: KES ' + fmtMoney(current.declaration.total_payout) + '\n' +
      'Net (after 5% tax): KES ' + net + '\n\n' +
      'This will credit each member\'s savings account immediately. ' +
      'This action cannot be undone.'
    )) return;

    doDistribute();
  }

  async function doDistribute() {
    try {
      var res = await fetch('/api/admin/dividends/' + declarationId + '/distribute', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credit_to_savings: true }),
      });
      var data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Distribution failed');
        return;
      }
      alert(
        'Distributed successfully.\n\n' +
        'Total payouts: ' + data.totalPayouts + '\n' +
        'Credited: ' + data.credited + '\n' +
        'Failed: ' + data.failed
      );
      await load();
    } catch (e) {
      alert('Network error');
    }
  }

  // ---------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------

  async function cancelDeclaration() {
    if (!confirm('Cancel this declaration? It will not be distributed.')) return;

    try {
      var res = await fetch('/api/admin/dividends/' + declarationId + '/cancel', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
      var data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Cancel failed');
        return;
      }
      await load();
    } catch (e) {
      alert('Network error');
    }
  }

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

      var m = window.location.pathname.match(/\/admin\/dividends\/(\d+)/);
      if (!m) { window.location.replace('/admin/dividends'); return; }
      declarationId = m[1];
      load();
    } catch (e) { window.location.replace('/'); }
  })();
})();
