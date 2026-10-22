/* Zaria — Client chama view */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    chama: null,
    myContribution: null,
    pollTimer: null,
    checkoutId: null,
    myPhone: '',
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function statusPill(status) {
    var cls =
      status === 'paid' ? 'pos' :
      status === 'partial' ? 'warn' :
      status === 'overdue' ? 'neg' :
      'neutral';
    return '<span class="pill ' + cls + '">' + escapeHtml(status) + '</span>';
  }

  async function load() {
    try {
      var [meRes, chamaRes, contribRes] = await Promise.all([
        fetch('/api/auth/me', { credentials: 'same-origin' }),
        fetch('/api/me/chama', { credentials: 'same-origin' }),
        fetch('/api/me/chama/contributions', { credentials: 'same-origin' })
      ]);

      if (meRes.status === 401) { window.location.replace('/'); return; }
      if (chamaRes.status === 401) { window.location.replace('/'); return; }

      var meData = await meRes.json();
      var chamaData = await chamaRes.json();
      var contribData = await contribRes.json().catch(function () { return { contributions: [] }; });

      if (meData.user && meData.user.phone) state.myPhone = meData.user.phone;

      if (!chamaData.chama) {
        $('notInChama').hidden = false;
        return;
      }

      $('chamaSection').hidden = false;
      state.chama = chamaData.chama;
      state.myContribution = chamaData.my_contribution;

      $('chamaName').textContent = chamaData.chama.name;
      $('chamaMeta').textContent = chamaData.chama.code + ' · ' + chamaData.chama.member_count + ' member' + (chamaData.chama.member_count === 1 ? '' : 's') + ' · Account ' + (chamaData.chama.account_number || '—');
      $('groupBalance').textContent = 'KES ' + fmtMoney(chamaData.chama.balance);

      renderContribution(chamaData.my_contribution);
      renderHistory(contribData.contributions || []);
      renderTransactions(chamaData.my_recent_transactions || []);
      renderTimesMoney(chamaData.times_money);
    } catch (err) {
      console.error('[client-chama]', err);
      $('pageSub').textContent = 'Failed to load chama. Please refresh.';
    }
  }

  function renderContribution(c) {
    var btn = $('payBtn');
    var msg = $('payMsg');
    if (!c) {
      $('contributionSub').textContent = 'No contribution due this period';
      $('contributionAmount').textContent = '—';
      $('contributionStatus').textContent = '—';
      btn.hidden = true;
      msg.textContent = '';
      return;
    }

    $('contributionSub').textContent = 'Period ' + c.period;
    $('contributionAmount').innerHTML = 'KES ' + fmtMoney(c.amount_paid) + ' <span style="color:var(--ink-500);font-weight:400;font-size:14px">of KES ' + fmtMoney(c.amount_due) + '</span>';
    $('contributionStatus').innerHTML = statusPill(c.status) + (c.last_payment_at ? ' · Last paid ' + fmtDateTime(c.last_payment_at) : '');

    if (c.status === 'paid') {
      btn.hidden = true;
      msg.textContent = '✓ You are up to date for this period.';
    } else if (c.status === 'partial') {
      btn.hidden = false;
      btn.textContent = 'Pay remaining KES ' + fmtMoney(c.amount_due - c.amount_paid);
      msg.textContent = '';
    } else {
      btn.hidden = false;
      btn.textContent = 'Pay KES ' + fmtMoney(c.amount_due) + ' via M-Pesa';
      msg.textContent = '';
    }
  }

  function renderHistory(rows) {
    $('histCount').textContent = rows.length + ' period' + (rows.length === 1 ? '' : 's');
    if (!rows.length) {
      $('histBody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-500);padding:24px">No contributions yet</td></tr>';
      return;
    }
    $('histBody').innerHTML = rows.map(function (r) {
      return '<tr>' +
        '<td>' + escapeHtml(r.period) + '</td>' +
        '<td class="num" style="text-align:right">' + fmtMoney(r.amount_due) + '</td>' +
        '<td class="num" style="text-align:right">' + fmtMoney(r.amount_paid) + '</td>' +
        '<td>' + statusPill(r.status) + '</td>' +
        '<td class="muted">' + (r.last_payment_at ? fmtDateTime(r.last_payment_at) : '—') + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderTransactions(rows) {
    $('txCount').textContent = rows.length + ' transaction' + (rows.length === 1 ? '' : 's');
    if (!rows.length) {
      $('txBody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-500);padding:24px">No transactions yet</td></tr>';
      return;
    }
    $('txBody').innerHTML = rows.map(function (t) {
      var typeLabel = { contribution: 'Contribution', withdrawal: 'Withdrawal', payout: 'Payout', adjustment: 'Adjustment' }[t.type] || t.type;
      return '<tr>' +
        '<td class="muted">' + fmtDateTime(t.created_at) + '</td>' +
        '<td>' + escapeHtml(typeLabel) + '</td>' +
        '<td class="num" style="text-align:right">' + fmtMoney(t.amount) + '</td>' +
        '<td class="num" style="text-align:right">' + fmtMoney(t.balance_after) + '</td>' +
        '<td class="muted" style="font-size:12px">' + escapeHtml(t.mpesa_receipt || t.reference || '—') + '</td>' +
        '</tr>';
    }).join('');
  }

function renderTimesMoney(tm) {
  var card = $('timesMoneyCard');
  if (!card) return;
  if (!tm || !tm.enabled) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  $('tmSub').textContent = 'Merry-go-round · ' + (tm.order || 'rotation');

  $('tmMyPosition').textContent = tm.my_position
    ? '#' + tm.my_position + ' of ' + tm.total_members
    : '—';

  $('tmNext').textContent = tm.next_recipient
    ? tm.next_recipient.full_name
    : '—';

  if (tm.i_received && tm.my_payouts && tm.my_payouts.length > 0) {
    var totalReceived = tm.my_payouts.reduce(function (sum, p) { return sum + Number(p.amount); }, 0);
    var latest = tm.my_payouts[0];
    var d = latest.created_at ? new Date(latest.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    $('tmMyPayoutText').textContent = 'KES ' + fmtMoney(totalReceived) + ' · received ' + d;
  } else {
    $('tmMyPayoutText').textContent = 'Not yet received — you\'ll get paid when it\'s your turn';
  }

  var rows = tm.recent_payouts || [];
  if (!rows.length) {
    $('tmBody').innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--ink-500);padding:16px">No payouts yet</td></tr>';
    return;
  }
  $('tmBody').innerHTML = rows.map(function (p) {
    var d = p.created_at ? new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    return '<tr>' +
      '<td class="muted">' + d + '</td>' +
      '<td>' + escapeHtml(p.client_name || '—') + '</td>' +
      '<td class="num" style="text-align:right">KES ' + fmtMoney(p.amount) + '</td>' +
      '</tr>';
  }).join('');
}

  // ---------------------------------------------------------------
  // STK modal (pattern from client-dashboard.js)
  // ---------------------------------------------------------------
  function showStkState(which) {
    ['stkForm', 'stkWaiting', 'stkSuccess', 'stkFailed'].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = (id !== which);
    });
  }

  function openStkModal() {
    var c = state.myContribution;
    if (!c) return;

    var remaining = Math.max(0, c.amount_due - c.amount_paid);
    var overlay = $('stkOverlay');
    var amt = $('stkAmount');
    var phone = $('stkPhone');
    var hint = $('stkAmountHint');
    var err = $('stkError');
    var btn = $('stkSubmitBtn');

    if (amt) { amt.value = Math.round(remaining); amt.min = 1; }
    if (phone) phone.value = state.myPhone || '';
    if (hint) hint.textContent = 'Due: KES ' + fmtMoney(remaining) + ' for ' + c.period;
    if (err) { err.hidden = true; err.textContent = ''; }
    if (btn) { btn.disabled = false; btn.textContent = 'Pay now'; }

    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    state.checkoutId = null;

    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    showStkState('stkForm');
    setTimeout(function () { if (amt) amt.focus(); }, 50);
  }

  function closeStkModal() {
    var overlay = $('stkOverlay');
    if (overlay) overlay.hidden = true;
    document.body.style.overflow = '';
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  function stkShowError(msg) {
    var err = $('stkError');
    if (err) { err.textContent = msg; err.hidden = false; }
  }

  async function submitStk() {
    var amt = Number($('stkAmount').value);
    var phone = String($('stkPhone').value || '').trim();

    if (!(amt > 0)) return stkShowError('Enter a valid amount.');
    if (!/^2547[0-9]{8}$/.test(phone)) return stkShowError('Phone must be in format 2547XXXXXXXX.');

    var btn = $('stkSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    try {
      var res = await fetch('/api/me/chama/contribute', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, phone: phone }),
      });
      var data = await res.json();

      if (!res.ok) {
        stkShowError(data.error || 'Could not send STK push.');
        if (btn) { btn.disabled = false; btn.textContent = 'Pay now'; }
        return;
      }

      state.checkoutId = data.checkout_request_id;
      showStkState('stkWaiting');
      pollStatus();

    } catch (err) {
      stkShowError('Network error. Try again.');
      if (btn) { btn.disabled = false; btn.textContent = 'Pay now'; }
    }
  }

  function pollStatus() {
    if (!state.checkoutId) return;
    var attempts = 0;
    var maxAttempts = 30;

    state.pollTimer = setInterval(async function () {
      attempts++;
      try {
        var res = await fetch('/api/daraja/status/' + encodeURIComponent(state.checkoutId), {
          credentials: 'same-origin',
        });
        var data = await res.json();

        if (data.status === 'success') {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
          var sa = $('stkSuccessAmount');
          var sr = $('stkSuccessReceipt');
          if (sa) sa.textContent = 'KES ' + Number(data.amount || 0).toLocaleString('en-KE');
          if (sr) sr.textContent = data.mpesa_receipt || '—';
          showStkState('stkSuccess');
          return;
        }

        if (data.status && data.status !== 'pending') {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
          var fr = $('stkFailReason');
          if (fr) fr.textContent = data.result_desc || 'Contribution was not completed.';
          showStkState('stkFailed');
          return;
        }
      } catch (e) {}

      if (attempts >= maxAttempts) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        var fr2 = $('stkFailReason');
        if (fr2) fr2.textContent = 'Timed out waiting for confirmation. Check your phone and try again.';
        showStkState('stkFailed');
      }
    }, 2000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    load();

    $('payBtn').addEventListener('click', openStkModal);
    $('stkClose').addEventListener('click', closeStkModal);
    $('stkCancel').addEventListener('click', closeStkModal);
    $('stkSubmitBtn').addEventListener('click', submitStk);

    $('stkDone').addEventListener('click', function () {
      closeStkModal();
      load();
    });

    $('stkFailClose').addEventListener('click', closeStkModal);
    $('stkRetry').addEventListener('click', function () {
      showStkState('stkForm');
      var btn = $('stkSubmitBtn');
      if (btn) { btn.disabled = false; btn.textContent = 'Pay now'; }
    });

    $('stkOverlay').addEventListener('click', function (e) {
      if (e.target === $('stkOverlay')) closeStkModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeStkModal();
    });
  });
})();
