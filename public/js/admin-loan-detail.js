/* Zaria — Admin loan detail */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var loanId = null;
  var currentLoan = null;
  var currentSummary = null;

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

  async function load() {
    var res = await fetch('/api/admin/loans/' + loanId, { credentials: 'same-origin' });
    if (res.status === 401) { window.location.replace('/'); return; }
    if (res.status === 404) {
      $('loanTitle').textContent = 'Loan not found';
      $('loanSub').textContent = '';
      return;
    }
    if (!res.ok) { $('loanSub').textContent = 'Could not load'; return; }
    var data = await res.json();
    currentLoan = data.loan;
    currentSummary = data.summary;
    render(data);
  }

  function render(data) {
    var l = data.loan;
    var s = data.summary;

    $('loanTitle').textContent = 'Loan #' + l.id + ' — ' + l.client_name;
    $('loanSub').textContent = 'Created ' + fmtDateTime(l.created_at) +
      (l.disbursed_at ? ' · Disbursed ' + fmtDate(l.disbursed_at) : '');

    $('statPrincipal').innerHTML = '<span class="unit">KES</span>' + fmtMoney(l.principal);
    $('statTotal').innerHTML = '<span class="unit">KES</span>' + fmtMoney(l.total_repayable);
    $('statRepaid').innerHTML = '<span class="unit">KES</span>' + fmtMoney(l.amount_repaid);
    $('statOutstanding').innerHTML = '<span class="unit">KES</span>' + fmtMoney(s.outstanding);

    // Status hint banner
    var hintEl = $('statusHint');
    if (hintEl) {
      if (l.status === 'pending') {
        hintEl.innerHTML = '<div class="notice">This loan is <strong>pending</strong>. Review the terms, then click <strong>Approve</strong> to make it ready for disbursement.</div>';
      } else if (l.status === 'approved') {
        hintEl.innerHTML = '<div class="notice">This loan is <strong>approved</strong> and ready. Send the funds to the client, then click <strong>Disburse</strong> to record it here.</div>';
      } else {
        hintEl.innerHTML = '';
      }
    }

    // Status hint banner
    var hintEl = $('statusHint');
    if (hintEl) {
      if (l.status === 'pending') {
        hintEl.innerHTML = '<div class="notice">This loan is <strong>pending</strong>. Review the terms, then click <strong>Approve</strong> to make it ready for disbursement.</div>';
      } else if (l.status === 'approved') {
        hintEl.innerHTML = '<div class="notice">This loan is <strong>approved</strong> and ready. Send the funds to the client, then click <strong>Disburse</strong> to record it here.</div>';
      } else {
        hintEl.innerHTML = '';
      }
    }

    // Info card
    var statusClass =
      l.status === 'active' ? 'pos' :
      l.status === 'overdue' || l.status === 'defaulted' ? 'neg' :
      l.status === 'repaid' ? 'neutral' : 'warn';

    $('statusPill').className = 'pill ' + statusClass;
    $('statusPill').textContent = l.status;

    $('infoList').innerHTML =
      '<div class="kv-row"><span class="kv-label">Client</span><span class="kv-value" style="font-family:var(--font-sans);font-weight:600">' + escapeHtml(l.client_name) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Phone</span><span class="kv-value">' + escapeHtml(l.client_phone) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Principal</span><span class="kv-value">' + fmtMoney(l.principal) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Interest rate</span><span class="kv-value">' + (Number(l.interest_rate) * 100).toFixed(1) + '% flat</span></div>' +
      '<div class="kv-row"><span class="kv-label">Term</span><span class="kv-value">' + l.term_months + ' month' + (l.term_months === 1 ? '' : 's') + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Total repayable</span><span class="kv-value">' + fmtMoney(l.total_repayable) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Repaid</span><span class="kv-value" style="color:var(--pos)">' + fmtMoney(l.amount_repaid) + '</span></div>' +
      '<div class="kv-row"><span class="kv-label">Outstanding</span><span class="kv-value">' + fmtMoney(s.outstanding) + '</span></div>' +
      (l.purpose ? '<div class="kv-row"><span class="kv-label">Purpose</span><span class="kv-value" style="font-family:var(--font-sans);font-weight:400;max-width:60%;text-align:right">' + escapeHtml(l.purpose) + '</span></div>' : '');

    // Schedule
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

    // Transactions
    $('txSub').textContent = data.transactions.length + ' transaction' + (data.transactions.length === 1 ? '' : 's');
    if (!data.transactions.length) {
      $('txBody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-500);padding:24px">No transactions yet</td></tr>';
    } else {
      $('txBody').innerHTML = data.transactions.map(function (t) {
        var cls = t.status === 'completed' ? 'pos' : t.status === 'failed' ? 'neg' : 'warn';
        var label = t.type === 'disbursement' ? 'Disbursement' :
                    t.type === 'repayment' ? 'Repayment' :
                    t.type === 'late_fee' ? 'Late fee' : 'Adjustment';
        return '<tr>' +
          '<td>' + fmtDateTime(t.created_at) + '</td>' +
          '<td>' + label + '</td>' +
          '<td class="num">' + fmtMoney(t.amount) + '</td>' +
          '<td class="muted">' + escapeHtml(t.mpesa_receipt || t.reference || '—') + '</td>' +
          '<td><span class="pill ' + cls + '">' + t.status + '</span></td>' +
         +
          (t.type === 'repayment' ? '<td><a href="/api/receipts/' + t.id + '" target="_blank" style="color:var(--navy-700);text-decoration:underline">Receipt</a></td>' : '<td></td>') + '</tr>';
      }).join('');
    }

    // Actions
    renderActions(l, s);
  }

  function renderActions(l, s) {
    var html = '';

    if (l.status === 'pending') {
      html += '<button type="button" class="btn-sm btn-dark" data-action="approve">Approve</button>';
      html += '<button type="button" class="btn-sm btn-outline" data-action="reject-pending">Cancel loan</button>';
    }
    if (l.status === 'approved') {
      html += '<button type="button" class="btn-sm btn-amber" data-action="disburse">Disburse</button>';
    }
    if (l.status === 'active' || l.status === 'overdue') {
      html += '<button type="button" class="btn-sm btn-dark" data-action="payment">Record payment</button>';
    }
    $('actionButtons').innerHTML = html;

    // PDF download buttons
    var pdfEl = $('pdfActions');
    if (pdfEl) {
      pdfEl.innerHTML =
        '<a class="btn-sm btn-outline" href="/api/statements/' + l.id + '" target="_blank" style="text-decoration:none">Statement</a> ' +
        '<a class="btn-sm btn-outline" href="/api/agreements/' + l.id + '" target="_blank" style="text-decoration:none">Agreement</a>';
    }

    $('actionButtons').querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var a = btn.getAttribute('data-action');
        if (a === 'approve') openAction('approve');
        if (a === 'disburse') openAction('disburse');
        if (a === 'payment') openAction('payment');
      });
    });
  }

  var currentAction = null;

  function openAction(action) {
    currentAction = action;
    var l = currentLoan, s = currentSummary;
    var modal = $('actionModal');
    var title = $('modalTitle');
    var body = $('modalBody');
    var fields = $('modalFields');
    var confirmBtn = $('modalConfirm');

    if (action === 'approve') {
      title.textContent = 'Approve loan';
      body.innerHTML = 'This approves <strong>loan #' + l.id + '</strong> for <strong>' + escapeHtml(l.client_name) + '</strong>. ' +
        'After approval you can disburse the funds.';
      fields.innerHTML = '';
      confirmBtn.textContent = 'Approve';
    } else if (action === 'disburse') {
      title.textContent = 'Disburse funds';
      body.innerHTML = 'This records <strong>KES ' + fmtMoney(l.principal) + '</strong> as disbursed to <strong>' + escapeHtml(l.client_name) + '</strong>. ' +
        'Confirm the money has actually been sent to their M-Pesa.';
      fields.innerHTML =
        '<div class="field" style="margin-bottom:12px">' +
          '<label for="mpesaReceipt">M-Pesa receipt (optional)</label>' +
          '<input type="text" id="mpesaReceipt" placeholder="e.g. QX12A9B34" style="width:100%;padding:10px 12px;font-size:14px;border:1px solid var(--line-1);border-radius:6px">' +
        '</div>' +
        '<div class="field">' +
          '<label for="reference">Internal reference (optional)</label>' +
          '<input type="text" id="reference" placeholder="e.g. DISB-2026-001" style="width:100%;padding:10px 12px;font-size:14px;border:1px solid var(--line-1);border-radius:6px">' +
        '</div>';
      confirmBtn.textContent = 'Disburse';
    } else if (action === 'payment') {
      title.textContent = 'Record payment';
      body.innerHTML = 'Outstanding: <strong>KES ' + fmtMoney(s.outstanding) + '</strong>. ' +
        'Enter the amount received from ' + escapeHtml(l.client_name) + '.';
      fields.innerHTML =
        '<div class="field" style="margin-bottom:12px">' +
          '<label for="payAmount">Amount (KES)</label>' +
          '<input type="number" id="payAmount" step="0.01" min="0.01" max="' + s.outstanding + '" placeholder="0.00" style="width:100%;padding:10px 12px;font-size:16px;font-weight:600;border:1px solid var(--line-1);border-radius:6px">' +
        '</div>' +
        '<div class="field" style="margin-bottom:12px">' +
          '<label for="payReceipt">M-Pesa receipt (optional)</label>' +
          '<input type="text" id="payReceipt" placeholder="e.g. QX12A9B34" style="width:100%;padding:10px 12px;font-size:14px;border:1px solid var(--line-1);border-radius:6px">' +
        '</div>' +
        '<div class="field">' +
          '<label for="payRef">Reference (optional)</label>' +
          '<input type="text" id="payRef" placeholder="Internal reference" style="width:100%;padding:10px 12px;font-size:14px;border:1px solid var(--line-1);border-radius:6px">' +
        '</div>';
      confirmBtn.textContent = 'Record payment';
    }

    modal.hidden = false;
  }

  function closeModal() {
    $('actionModal').hidden = true;
    currentAction = null;
  }

  $('modalCancel').addEventListener('click', closeModal);

  $('modalConfirm').addEventListener('click', async function () {
    var btn = $('modalConfirm');
    btn.disabled = true;
    var origText = btn.textContent;
    btn.textContent = 'Working…';

    try {
      var url, body;
      if (currentAction === 'approve') {
        url = '/api/admin/loans/' + loanId + '/approve';
        body = {};
      } else if (currentAction === 'disburse') {
        url = '/api/admin/loans/' + loanId + '/disburse';
        body = {
          mpesa_receipt: $('mpesaReceipt') ? $('mpesaReceipt').value.trim() || null : null,
          reference: $('reference') ? $('reference').value.trim() || null : null,
        };
      } else if (currentAction === 'payment') {
        var amt = parseFloat($('payAmount').value);
        if (!(amt > 0)) { alert('Enter a valid amount.'); btn.disabled = false; btn.textContent = origText; return; }
        url = '/api/admin/loans/' + loanId + '/payments';
        body = {
          amount: amt,
          mpesa_receipt: $('payReceipt').value.trim() || null,
          reference: $('payRef').value.trim() || null,
        };
      }

      var res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        alert(data.error || 'Action failed');
        btn.disabled = false;
        btn.textContent = origText;
        return;
      }
      closeModal();
      await load();
    } catch (e) {
      alert('Network error');
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  // Avatar + mobile drawer
  function wireAvatar() {
    var av = $('avatarBtn');
    av.addEventListener('click', async function () {
      if (!confirm('Sign out?')) return;
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.replace('/');
    });
  }

  (function wireDrawer() {
    var menuBtn = $('menuBtn');
    var sidebar = $('sidebar');
    var backdrop = $('sidebarBackdrop');
    function closeDrawer() {
      if (sidebar) sidebar.classList.remove('open');
      if (backdrop) backdrop.classList.remove('open');
    }
    if (menuBtn && sidebar) {
      menuBtn.addEventListener('click', function () {
        sidebar.classList.toggle('open');
        if (backdrop) backdrop.classList.toggle('open');
      });
    }
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  })();

  // Bootstrap
  (async function () {
    try {
      var meRes = await fetch('/api/me', { credentials: 'same-origin' });
      if (!meRes.ok) { window.location.replace('/'); return; }
      var me = await meRes.json();
      if (me.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }
      $('avatarBtn').textContent = me.user.email.charAt(0).toUpperCase();
      wireAvatar();

      // Extract :id from /admin/loans/:id
      var m = window.location.pathname.match(/\/admin\/loans\/(\d+)/);
      if (!m) { window.location.replace('/admin/loans'); return; }
      loanId = m[1];
      await load();
    } catch (e) {
      console.error(e);
      window.location.replace('/');
    }
  })();
})();
