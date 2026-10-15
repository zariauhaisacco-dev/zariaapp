/* Zaria — Client loan detail */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var loanId = null;

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
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function daysUntil(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    var now = new Date();
    return Math.round((d - now) / (1000 * 60 * 60 * 24));
  }

  async function load() {
    var res = await fetch('/api/me/loans/' + loanId, { credentials: 'same-origin' });
    if (res.status === 401) { window.location.replace('/'); return; }
    if (res.status === 404) {
      $('loanTitle').textContent = 'Loan not found';
      $('loanSub').textContent = '';

    var actionsEl = document.getElementById("pdfActions");
    if (actionsEl) {
      actionsEl.innerHTML =
        '<a class="btn-sm btn-outline" href="/api/statements/' + l.id + '" target="_blank" style="text-decoration:none">Statement</a> ' +
        '<a class="btn-sm btn-outline" href="/api/agreements/' + l.id + '" target="_blank" style="text-decoration:none">Agreement</a>';
    }
      return;
    }
    if (!res.ok) { $('loanSub').textContent = 'Could not load'; return; }
    var data = await res.json();
    render(data);
  }

  function render(data) {
    var l = data.loan;
    var s = data.summary;

    $('loanTitle').textContent = 'Loan #' + l.id;
    $('loanSub').textContent =
      (Number(l.interest_rate) * 100).toFixed(1) + '% flat · ' +
      l.term_months + ' month' + (l.term_months === 1 ? '' : 's') +
      (l.disbursed_at ? ' · Disbursed ' + fmtDate(l.disbursed_at) : ' · Created ' + fmtDate(l.created_at));

    $('statPrincipal').innerHTML = '<span class="unit">KES</span>' + fmtMoney(l.principal);
    $('statTotal').innerHTML = '<span class="unit">KES</span>' + fmtMoney(l.total_repayable);
    $('statRepaid').innerHTML = '<span class="unit">KES</span>' + fmtMoney(l.amount_repaid);
    $('statOutstanding').innerHTML = '<span class="unit">KES</span>' + fmtMoney(s.outstanding);

    var nextWrap = $('nextPaymentCard');
    if (s.nextPayment && (l.status === 'active' || l.status === 'overdue')) {
      var days = daysUntil(s.nextPayment.dueDate);
      var dueText = days === null ? '' :
        days > 0 ? 'in ' + days + ' day' + (days === 1 ? '' : 's') :
        days === 0 ? 'today' :
        Math.abs(days) + ' day' + (Math.abs(days) === 1 ? '' : 's') + ' overdue';

      nextWrap.innerHTML =
        '<section class="client-primary" style="margin-bottom:20px">' +
          '<div class="label">Next payment</div>' +
          '<div class="amount"><span class="unit">KES</span>' + fmtMoney(s.nextPayment.amountRemaining) + '</div>' +
          '<div class="meta">Due <strong style="color:#fff">' + fmtDate(s.nextPayment.dueDate) + '</strong>' +
            (dueText ? ' · ' + dueText : '') + '</div>' +
          '<div class="client-actions">' +
            '<button class="btn-sm btn-amber" id="payBtn">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 5l7 7-7 7"/></svg>' +
              'Pay now via M-Pesa' +
            '</button>' +
          '</div>' +
        '</section>';

      var payBtn = $('payBtn');
      if (payBtn) payBtn.addEventListener('click', function () {
        alert('M-Pesa STK push integration coming in Phase 5. To pay now, call 0746 138 896.');
      });
    } else if (l.status === 'repaid') {
      nextWrap.innerHTML =
        '<section class="client-primary" style="margin-bottom:20px;background:linear-gradient(135deg, #1B7F4B, #145F38)">' +
          '<div class="label">Loan fully repaid</div>' +
          '<div class="amount"><span class="unit">KES</span>' + fmtMoney(l.total_repayable) + '</div>' +
          '<div class="meta">Thank you. You\'re welcome to request another loan any time.</div>' +
          '<div class="client-actions"><a href="/client/request" class="btn-sm btn-amber" style="text-decoration:none">Request a new loan</a></div>' +
        '</section>';
    } else {
      nextWrap.innerHTML = '';
    }

    var statusClass =
      l.status === 'active' ? 'pos' :
      l.status === 'overdue' || l.status === 'defaulted' ? 'neg' :
      l.status === 'repaid' ? 'neutral' : 'warn';

    $('statusPill').className = 'pill ' + statusClass;
    $('statusPill').textContent = l.status;

    $('infoList').innerHTML =
      '<div class="kv-row"><span class="kv-label">Principal</span><span class="kv-value">' + fmtMoney(l.principal) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Interest rate</span><span class="kv-value">' + (Number(l.interest_rate) * 100).toFixed(1) + '% flat</span></div>' +
      '<div class="kv-row"><span class="kv-label">Term</span><span class="kv-value">' + l.term_months + ' month' + (l.term_months === 1 ? '' : 's') + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Total repayable</span><span class="kv-value">' + fmtMoney(l.total_repayable) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Total repaid</span><span class="kv-value" style="color:var(--pos)">' + fmtMoney(l.amount_repaid) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Outstanding</span><span class="kv-value">' + fmtMoney(s.outstanding) + '</span></div>' +
      (l.purpose ? '<div class="kv-row"><span class="kv-label">Purpose</span><span class="kv-value" style="font-family:var(--font-sans);font-weight:400;max-width:60%;text-align:right">' + escapeHtml(l.purpose) + '</span></div>' : '');

    $('scheduleSub').textContent = data.schedule.length + ' installment' + (data.schedule.length === 1 ? '' : 's');
    $('scheduleBody').innerHTML = data.schedule.map(function (p) {
      var cls = p.status === 'paid' ? 'pos' : p.status === 'partial' ? 'warn' : p.status === 'overdue' ? 'neg' : 'neutral';
      return '<tr>' +
        '<td class="muted">' + p.installment_no + '</td>' +
        '<td>' + fmtDate(p.due_date) + '</td>' +
        '<td class="num">' + fmtMoney(p.amount_due) + '</td>' +
        '<td class="num">' + fmtMoney(p.amount_paid) + '</td>' +
        '<td><span class="pill ' + cls + '">' + p.status + '</span></td>' +
      '</tr>';
    }).join('');

    var visibleTx = (data.transactions || []).filter(function (t) {
      return t.type === 'repayment' || t.type === 'disbursement';
    });
    $('txSub').textContent = visibleTx.length + ' transaction' + (visibleTx.length === 1 ? '' : 's');

    if (!visibleTx.length) {
      $('txBody').innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--ink-500);padding:24px">No payments yet</td></tr>';
    } else {
      $('txBody').innerHTML = visibleTx.map(function (t) {
        var label = t.type === 'repayment' ? 'Payment' : 'Disbursement';
        return '<tr>' +
          '<td>' + fmtDateTime(t.created_at) + '</td>' +
          '<td>' + label + '</td>' +
          '<td class="num">' + fmtMoney(t.amount) + '</td>' +
          '<td class="muted">' + escapeHtml(t.mpesa_receipt || t.reference || '—') + '</td>' +
         +
          (t.type === 'repayment' ? '<td><a href="/api/receipts/' + t.id + '" target="_blank" style="color:var(--navy-700);text-decoration:underline">Receipt</a></td>' : '<td></td>') + '</tr>';
      }).join('');
    }
  }

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
      if (d.user.role !== 'client') { window.location.replace('/admin/dashboard'); return; }
      $('avatarBtn').textContent = d.user.email.charAt(0).toUpperCase();

      var m = window.location.pathname.match(/\/client\/loans\/(\d+)/);
      if (!m) { window.location.replace('/client/loans'); return; }
      loanId = m[1];
      load();
    } catch (e) {
      console.error(e);
      window.location.replace('/');
    }
  })();
})();
