/* Zaria — Admin reports */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }
  function setRange(from, to) {
    $('fromDate').value = from;
    $('toDate').value = to;
  }

  async function run() {
    var from = $('fromDate').value;
    var to = $('toDate').value;
    if (!from || !to) { alert('Pick a date range'); return; }

    try {
      var res = await fetch('/api/admin/reports/summary?from=' + from + '&to=' + to, {
        credentials: 'same-origin',
      });
      if (res.status === 401) { window.location.replace('/'); return; }
      var d = await res.json();
      if (!res.ok) { alert(d.error || 'Failed'); return; }

      // Show stats
      $('statsStrip').style.display = '';
      $('statDisbursed').innerHTML = '<span class="unit">KES</span>' + fmtMoney(d.disbursements.total);
      $('statDisbursedCount').textContent = d.disbursements.count + ' transaction' + (d.disbursements.count === 1 ? '' : 's');
      $('statCollected').innerHTML = '<span class="unit">KES</span>' + fmtMoney(d.repayments.total);
      $('statCollectedCount').textContent = d.repayments.count + ' payment' + (d.repayments.count === 1 ? '' : 's');
      $('statNewLoans').textContent = d.new_loans;
      $('statRepaidLoans').textContent = d.repaid_loans + ' repaid in period';
      $('statNewClients').textContent = d.new_clients;

      // Portfolio
      $('pfOutstanding').textContent = 'KES ' + fmtMoney(d.portfolio.outstanding);
      $('pfActive').textContent = d.portfolio.active_count;
      $('pfOverdue').textContent = d.portfolio.overdue_count;
      $('pfRepaid').textContent = d.portfolio.repaid_count;

      // Export links
      $('exportTxns').href = '/api/admin/reports/transactions.csv?from=' + from + '&to=' + to;
      $('exportLoans').href = '/api/admin/reports/loans.csv?from=' + from + '&to=' + to;
    } catch (e) {
      alert('Network error');
    }
  }

  $('runBtn').addEventListener('click', run);

  // Presets
  document.querySelectorAll('[data-preset]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var p = btn.getAttribute('data-preset');
      var now = new Date();
      if (p === 'today') {
        setRange(isoDate(now), isoDate(now));
      } else if (p === '7d') {
        var d7 = new Date(now); d7.setDate(d7.getDate() - 6);
        setRange(isoDate(d7), isoDate(now));
      } else if (p === '30d') {
        var d30 = new Date(now); d30.setDate(d30.getDate() - 29);
        setRange(isoDate(d30), isoDate(now));
      } else if (p === 'mtd') {
        var mtd = new Date(now.getFullYear(), now.getMonth(), 1);
        setRange(isoDate(mtd), isoDate(now));
      } else if (p === 'lastMonth') {
        var lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        var lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
        setRange(isoDate(lmStart), isoDate(lmEnd));
      }
      run();
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

  // Init: default to last 30 days
  (async function bootstrap() {
    try {
      var res = await fetch('/api/me', { credentials: 'same-origin' });
      if (!res.ok) { window.location.replace('/'); return; }
      var d = await res.json();
      if (d.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }
      $('avatarBtn').textContent = d.user.email.charAt(0).toUpperCase();

      var now = new Date();
      var d30 = new Date(now); d30.setDate(d30.getDate() - 29);
      setRange(isoDate(d30), isoDate(now));
      run();
    } catch (e) {
      window.location.replace('/');
    }
  })();
})();
