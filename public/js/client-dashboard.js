/* Zaria — Client dashboard */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtProgress(repaid, total) {
    if (!(total > 0)) return '0%';
    var raw = (repaid / total) * 100;
    if (raw > 0 && raw < 1) return '<1%';
    return Math.round(raw) + '%';
  }

  function pctWidth(repaid, total) {
    if (!(total > 0)) return 0;
    var pct = (repaid / total) * 100;
    if (pct > 0 && pct < 2) return 2; // visible sliver for any progress
    return Math.min(pct, 100);
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

  function daysUntil(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    var now = new Date();
    return Math.round((d - now) / (1000 * 60 * 60 * 24));
  }

  // ---------------------------------------------------------------
  // My money strip (savings · shares · dividends)
  // ---------------------------------------------------------------

  function renderMoneyStrip(summary) {
    var strip = $('moneyStrip');
    if (!strip) return;

    // Savings
    var sv = $('moneySavingsValue');
    var ss = $('moneySavingsSub');
    if (summary.savings) {
      sv.innerHTML = '<span class="unit">KES</span>' + fmtMoney(summary.savings.balance);

      // Add "Save money" button to the savings card
      setTimeout(function () {
        var card = document.getElementById('moneySavings');
        if (card && !document.getElementById('saveMoneyBtn')) {
          var btn = document.createElement('button');
          btn.id = 'saveMoneyBtn';
          btn.className = 'btn-sm btn-amber';
          btn.style.cssText = 'margin-top:10px;font-size:12.5px;padding:7px 12px';
          btn.innerHTML = '+ Save money';
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            openStkModal({ target: 'savings' });
          });
          var body = card.querySelector('.money-body');
          if (body) body.appendChild(btn);
        }
      }, 0);
      ss.textContent = 'Acct ' + escapeHtml(summary.savings.account_number);
    } else {
      sv.innerHTML = '<span class="unit">KES</span>0';

      setTimeout(function () {
        var card = document.getElementById('moneySavings');
        if (card && !document.getElementById('saveMoneyBtn')) {
          var btn = document.createElement('button');
          btn.id = 'saveMoneyBtn';
          btn.className = 'btn-sm btn-amber';
          btn.style.cssText = 'margin-top:10px;font-size:12.5px;padding:7px 12px';
          btn.innerHTML = '+ Save money';
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            openStkModal({ target: 'savings' });
          });
          var body = card.querySelector('.money-body');
          if (body) body.appendChild(btn);
        }
      }, 0);
      ss.textContent = 'No savings account yet';
    }

    // Shares
    var hv = $('moneySharesValue');
    var hs = $('moneySharesSub');
    var shares = summary.shares || { shares_held: 0, shares_value: 0 };
    hv.innerHTML = shares.shares_held + ' <span class="unit" style="font-size:11px;color:var(--ink-500)">shares</span>';
    hs.textContent = 'KES ' + fmtMoney(shares.shares_value) + ' at par';

    // Dividends
    var dv = $('moneyDividendsValue');
    var ds = $('moneyDividendsSub');
    var div = summary.dividends || { net: 0, count: 0 };
    dv.innerHTML = '<span class="unit">KES</span>' + fmtMoney(div.net);
    ds.textContent = div.count + ' payout' + (div.count === 1 ? '' : 's') + ' received';

    strip.hidden = false;
  }

  // ---------------------------------------------------------------
  // Hero: next payment (active loan) OR "no active loan" OR "pending"
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // NEW REDESIGNED HERO — 4 quick stats
  // ---------------------------------------------------------------
  function renderHeroNew(summary) {
    var savings = summary.savings ? Number(summary.savings.balance) : 0;
    var shares = summary.shares ? Number(summary.shares.shares_held) : 0;
    var sharesValue = summary.shares ? Number(summary.shares.shares_value) : 0;
    var chamaPaid = summary.chama && summary.chama.my_contribution ? Number(summary.chama.my_contribution.amount_paid) : 0;
    var loanOutstanding = summary.active_loan 
      ? Number(summary.active_loan.total_repayable) - Number(summary.active_loan.amount_repaid)
      : 0;

    $('heroSavings').innerHTML = '<span class="unit" style="font-size:10px">KES</span>' + fmtMoney(savings);
    $('heroSavingsSub').textContent = savings > 0 ? 'Personal savings' : 'No account yet';

    $('heroShares').innerHTML = shares + ' <span style="font-size:11px;font-weight:400">shares</span>';
    $('heroSharesSub').textContent = shares > 0 ? 'KES ' + fmtMoney(sharesValue) + ' at par' : 'No shares held';

    $('heroChama').innerHTML = summary.chama 
      ? '<span class="unit" style="font-size:10px">KES</span>' + fmtMoney(chamaPaid)
      : '—';
    $('heroChamaSub').textContent = summary.chama 
      ? summary.chama.name + ' · ' + (summary.chama.my_contribution ? summary.chama.my_contribution.status : 'no contribution')
      : 'Not in a chama';

    $('heroLoans').innerHTML = loanOutstanding > 0 
      ? '<span class="unit" style="font-size:10px">KES</span>' + fmtMoney(loanOutstanding)
      : '—';
    $('heroLoansSub').textContent = loanOutstanding > 0 ? 'Outstanding' : 'No active loan';


    // Update stat strip (share capital + outstanding principal)
    var statShareCapital = $('statMyShareCapital');
    if (statShareCapital) {
      statShareCapital.innerHTML = '<span class="unit">KES</span>' + fmtMoney(sharesValue);
      var shareSub = $('statMyShareCapitalSub');
      if (shareSub) {
        var parValue = (summary.shares && summary.shares.share_par_value) || 100;
        shareSub.textContent = shares + ' share' + (shares === 1 ? '' : 's') + ' × KES ' + parValue + ' par';
      }
    }

    var statOutstanding = $('statMyOutstanding');
    if (statOutstanding) {
      statOutstanding.innerHTML = '<span class="unit">KES</span>' + fmtMoney(loanOutstanding);
      var outSub = $('statMyOutstandingSub');
      if (outSub) {
        if (summary.active_loan && summary.next_payment) {
          var dueDate = new Date(summary.next_payment.dueDate);
          outSub.textContent = 'Next due: ' + dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        } else if (summary.active_loan) {
          outSub.textContent = 'Active loan';
        } else {
          outSub.textContent = 'No active loans';
        }
      }
    }

    // Interest earned stat
    var statInterest = $('statMyInterest');
    if (statInterest) {
      var interestEarned = (summary.savings && summary.savings.total_interest_earned)
        ? Number(summary.savings.total_interest_earned) : 0;
      statInterest.innerHTML = '<span class="unit">KES</span>' + fmtMoney(interestEarned);
      var intSub = $('statMyInterestSub');
      if (intSub) {
        if (summary.savings && summary.savings.last_interest_posted_at) {
          var intDate = new Date(summary.savings.last_interest_posted_at);
          intSub.textContent = 'Last posted: ' + intDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        } else {
          intSub.textContent = interestEarned > 0 ? 'Total earned' : 'No interest yet';
        }
      }
    }
    var eye = $('heroEye');
    if (eye && !eye._wired) {
      eye._wired = true;
      eye.addEventListener('click', function (e) {
        e.stopPropagation();
        var on = !document.body.classList.contains('is-masked');
        document.body.classList.toggle('is-masked', on);
        try { localStorage.setItem('zaria.mask.balances', on ? '1' : '0'); } catch (_) {}
      });
    }
  }

  // ---------------------------------------------------------------
  // Chama card
  // ---------------------------------------------------------------
  function renderChamaCard(summary) {
    var card = $('chamaCard');
    if (!card) return;
    var c = summary.chama;
    if (!c) { card.hidden = true; return; }
    card.hidden = false;

    $('chamaSub').textContent = c.name + ' · ' + c.code + (c.account_number ? ' · ' + c.account_number : '');

    var mc = c.my_contribution;
    if (mc) {
      $('chamaMyContrib').innerHTML = 'KES ' + fmtMoney(mc.amount_paid) + ' <span style="color:var(--ink-500);font-weight:400;font-size:13px">of ' + fmtMoney(mc.amount_due) + '</span>';
      $('chamaMyContribSub').textContent = mc.status + (mc.last_payment_at ? ' · ' + fmtDate(mc.last_payment_at) : '');
    } else {
      $('chamaMyContrib').textContent = '—';
      $('chamaMyContribSub').textContent = 'No contribution this period';
    }

    $('chamaGroupBalance').innerHTML = 'KES ' + fmtMoney(c.group_balance);
    $('chamaGroupBalanceSub').textContent = c.member_count + ' member' + (c.member_count === 1 ? '' : 's');

    var tm = c.times_money;
    var tmRow = $('chamaTmRow');
    if (tm && tm.enabled && tmRow) {
      tmRow.hidden = false;
      $('chamaTmPosition').textContent = tm.my_position ? '#' + tm.my_position + ' of ' + tm.total_members : '—';
      $('chamaTmReceived').textContent = tm.i_received ? 'Received KES ' + fmtMoney(tm.my_total_received) : 'Not yet received';
      $('chamaTmNext').textContent = tm.next_recipient ? tm.next_recipient.full_name : '—';
    } else if (tmRow) {
      tmRow.hidden = true;
    }

    var btn = $('chamaPayBtn');
    if (btn) {
      if (mc && mc.status !== 'paid') {
        var remaining = Number(mc.amount_due) - Number(mc.amount_paid);
        btn.hidden = false;
        btn.textContent = 'Pay remaining KES ' + fmtMoney(remaining) + ' via M-Pesa';
        btn.onclick = function () { window.location.href = '/client/chama'; };
      } else {
        btn.hidden = true;
      }
    }
  }

  // ---------------------------------------------------------------
  // Loan card
  // ---------------------------------------------------------------
  function renderLoanCard(summary) {
    var card = $('loanCard');
    if (!card) return;
    var loan = summary.active_loan;
    if (!loan) { card.hidden = true; return; }
    card.hidden = false;

    var total = Number(loan.total_repayable);
    var repaid = Number(loan.amount_repaid);
    var outstanding = total - repaid;
    var pct = total > 0 ? Math.round((repaid / total) * 100) : 0;

    $('loanSub').textContent = loan.status === 'overdue' ? 'Overdue — action needed' : 'Active loan';
    $('loanOutstanding').innerHTML = 'KES ' + fmtMoney(outstanding);
    $('loanNextDue').textContent = summary.next_payment ? fmtDate(summary.next_payment.dueDate) : '—';
    $('loanProgress').textContent = pct + '% repaid';

    var btn = $('loanPayBtn');
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', function () {
        if (typeof openStkModal === 'function') {
          openStkModal({ target: 'loan', loanId: loan.id, outstanding: outstanding, defaultPhone: window.__mePhone || '' });
        } else {
          window.location.href = '/client/loans';
        }
      });
    }

    // Hide old loanSummaryCard
    var oldLoanCard = $('loanSummaryCard');
    if (oldLoanCard) oldLoanCard.hidden = true;
  }

  // ---------------------------------------------------------------
  // Unified activity feed
  // ---------------------------------------------------------------
  function renderUnifiedActivity(activity) {
    var card = $('recentTxnsCard');
    if (!card) return;
    var items = activity || [];

    if (!items.length) {
      card.innerHTML =
        '<div class="card-head"><div><h2 class="card-title">Recent activity</h2><p class="card-sub">No activity yet</p></div></div>' +
        '<div class="empty">Your recent transactions will appear here once you start saving or contributing.</div>';
      return;
    }

    var rows = items.map(function (a) {
      var isCredit = a.sign === '+';
      var iconClass = isCredit ? 'pos' : 'info';
      var label = a.label || 'Transaction';
      var sub = a.ref ? 'Receipt ' + escapeHtml(a.ref) : (a.source ? a.source.charAt(0).toUpperCase() + a.source.slice(1) : '');
      var sign = isCredit ? '+' : '−';
      var iconSvg = isCredit
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l4 4 10-10"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>';

      return '<div class="feed-item">' +
        '<div class="feed-icon ' + iconClass + '">' + iconSvg + '</div>' +
        '<div class="feed-text">' + escapeHtml(label) + '<br><span style="color:var(--ink-500);font-size:12px">' + sub + '</span></div>' +
        '<div class="feed-time" style="text-align:right">' +
          '<div class="masked-balance" data-masked style="color:var(--ink-900);font-weight:600;font-family:var(--font-mono)">' + sign + fmtMoney(a.amount) + '</div>' +
          '<div>' + fmtDate(a.date) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    card.innerHTML =
      '<div class="card-head">' +
        '<div><h2 class="card-title">Recent activity</h2><p class="card-sub">Across all accounts</p></div>' +
        '<a class="card-link" href="/client/transactions">View all →</a>' +
      '</div>' +
      '<div class="feed">' + rows + '</div>';
  }

  function renderHero(summary) {
    var hero = $('clientHero');
    var loan = summary.active_loan;
    var next = summary.next_payment;
    var pending = summary.pending_request;

    if (loan && next) {
      var days = daysUntil(next.dueDate);
      var dueText = days === null ? '' :
        days > 0 ? ('in ' + days + ' day' + (days === 1 ? '' : 's')) :
        days === 0 ? 'today' :
        (Math.abs(days) + ' day' + (Math.abs(days) === 1 ? '' : 's') + ' overdue');

      var total = Number(loan.total_repayable);
      var repaid = Number(loan.amount_repaid);
      var outstanding = total - repaid;
      var pctLabel = fmtProgress(repaid, total);
      var pctWidthValue = pctWidth(repaid, total);

      hero.innerHTML =
        '<div class="label">Next payment</div>' +
        '<div class="amount-row">' +
          '<div class="amount masked-balance" data-masked><span class="unit">KES</span>' + fmtMoney(next.amountRemaining) + '</div>' +
          '<button class="eye-inline" id="heroEye" aria-label="Hide balances" title="Hide / show balances">' +
            '<svg class="eye-visible" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>' +
            '<svg class="eye-masked" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.45 18.45 0 0 1 4.06-5.06"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M1 1l22 22"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="meta">Due <strong style="color:#fff">' + fmtDate(next.dueDate) + '</strong>' + (dueText ? ' · ' + dueText : '') + '</div>' +
        '<div class="progress-row">' +
          '<span>' + pctLabel + ' repaid · KES ' + fmtMoney(repaid) + ' of ' + fmtMoney(total) + '</span>' +
          '<div class="progress-bar"><div class="progress-fill" style="width:' + pctWidthValue + '%"></div></div>' +
          '<span>KES ' + fmtMoney(outstanding) + ' left</span>' +
        '</div>' +
        '<div class="client-actions">' +
          '<button class="btn-sm btn-amber" id="payBtn">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 5l7 7-7 7"/></svg>' +
            'Pay now via M-Pesa' +
          '</button>' +
          '<a href="/client/loans" class="btn-ghost-light" style="text-decoration:none">View schedule</a>' +
        '</div>';

      setTimeout(function () {
        var eye = document.getElementById('heroEye');
        if (eye) {
          eye.addEventListener('click', function (e) {
            e.stopPropagation();
            var on = !document.body.classList.contains('is-masked');
            document.body.classList.toggle('is-masked', on);
            localStorage.setItem('zaria.mask.balances', on ? '1' : '0');
          });
        }
        var pay = document.getElementById('payBtn');
        if (pay) {
          pay.addEventListener('click', function () {
            openStkModal({
              loanId: loan.id,
              outstanding: outstanding,
              defaultPhone: (window.__mePhone || '') || ''
            });
          });
        }
      }, 0);
      return;
    }

    if (pending) {
      hero.innerHTML =
        '<div class="label">Loan request</div>' +
        '<div class="amount"><span class="unit">KES</span>' + fmtMoney(pending.requested_amount) + '</div>' +
        '<div class="meta">Submitted ' + fmtDate(pending.created_at) + ' · awaiting admin review</div>' +
        '<div class="client-actions">' +
          '<a href="/client/request" class="btn-ghost-light" style="text-decoration:none">View my requests</a>' +
        '</div>';
      return;
    }

    hero.innerHTML =
      '<div class="label">Welcome to Zaria</div>' +
      '<div class="amount"><span class="unit">KES</span>0</div>' +
      '<div class="meta">You have no active loans. Request your first one to get started.</div>' +
      '<div class="client-actions">' +
        '<a href="/client/request" class="btn-sm btn-amber" style="text-decoration:none">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>' +
          'Request a loan' +
        '</a>' +
      '</div>';
  }

  // ---------------------------------------------------------------
  // Loan summary card
  // ---------------------------------------------------------------

  function renderLoanSummary(loan) {
    var card = $('loanSummaryCard');
    if (!loan) {
      card.innerHTML =
        '<div class="card-head">' +
          '<div><h2 class="card-title">Loan summary</h2><p class="card-sub">No active loan</p></div>' +
        '</div>' +
        '<div class="empty">You have no active loan. Request one to get started.</div>';
      return;
    }

    var statusClass =
      loan.status === 'active' ? 'pos' :
      loan.status === 'overdue' ? 'neg' :
      loan.status === 'repaid' ? 'neutral' : 'warn';

    card.innerHTML =
      '<div class="card-head">' +
        '<div><h2 class="card-title">Loan summary</h2><p class="card-sub">Loan #' + loan.id + '</p></div>' +
        '<span class="pill ' + statusClass + '">' + loan.status + '</span>' +
      '</div>' +
      '<div class="kv-list">' +
        '<div class="kv-row"><span class="kv-label">Principal</span><span class="kv-value masked-balance" data-masked>KES ' + fmtMoney(loan.principal) + '</span></div>' +
        '<div class="kv-row"><span class="kv-label">Interest rate</span><span class="kv-value">' + (Number(loan.interest_rate) * 100).toFixed(1) + '% flat</span></div>' +
        '<div class="kv-row"><span class="kv-label">Term</span><span class="kv-value">' + loan.term_months + ' month' + (loan.term_months === 1 ? '' : 's') + '</span></div>' +
        '<div class="kv-row"><span class="kv-label">Total repayable</span><span class="kv-value masked-balance" data-masked>KES ' + fmtMoney(loan.total_repayable) + '</span></div>' +
        '<div class="kv-row"><span class="kv-label">Total repaid</span><span class="kv-value masked-balance" data-masked style="color:var(--pos)">KES ' + fmtMoney(loan.amount_repaid) + '</span></div>' +
        '<div class="kv-row"><span class="kv-label">Outstanding</span><span class="kv-value masked-balance" data-masked>KES ' + fmtMoney(Number(loan.total_repayable) - Number(loan.amount_repaid)) + '</span></div>' +
      '</div>';
  }

  // ---------------------------------------------------------------
  // Recent transactions
  // ---------------------------------------------------------------

  function renderTransactions(txns) {
    var card = $('recentTxnsCard');
    if (!txns.length) {
      card.innerHTML =
        '<div class="card-head"><div><h2 class="card-title">Recent transactions</h2><p class="card-sub">No activity yet</p></div></div>' +
        '<div class="empty">Transactions will appear here once your loan is active.</div>';
      return;
    }

    var rows = txns.map(function (t) {
      var isRepayment = t.type === 'repayment';
      var icon = isRepayment ? 'pos' : 'info';
      var sign = isRepayment ? '+' : '−';
      var label = t.type === 'repayment' ? 'Payment received' :
                  t.type === 'disbursement' ? 'Loan disbursed' :
                  t.type === 'late_fee' ? 'Late fee' : 'Adjustment';
      var sub = t.mpesa_receipt ? 'Receipt ' + escapeHtml(t.mpesa_receipt) : 'Ref';

      var iconSvg = isRepayment
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l4 4 10-10"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>';

      return '<div class="feed-item">' +
        '<div class="feed-icon ' + icon + '">' + iconSvg + '</div>' +
        '<div class="feed-text">' + label + '<br><span style="color:var(--ink-500);font-size:12px">' + sub + '</span></div>' +
        '<div class="feed-time" style="text-align:right">' +
          '<div class="masked-balance" data-masked style="color:var(--ink-900);font-weight:600;font-family:var(--font-mono)">' + sign + fmtMoney(t.amount) + '</div>' +
          '<div>' + fmtDate(t.created_at) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    card.innerHTML =
      '<div class="card-head">' +
        '<div><h2 class="card-title">Recent transactions</h2><p class="card-sub">Last 5</p></div>' +
        '<a class="card-link" href="/client/transactions">View all →</a>' +
      '</div>' +
      '<div class="feed">' + rows + '</div>';
  }

  // ---------------------------------------------------------------
  // Avatar / logout
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // M-Pesa STK Push modal
  // ---------------------------------------------------------------
  var stkState = { target: 'loan', loanId: null, outstanding: 0, checkoutId: null, pollTimer: null };

  function showStkState(which) {
    ['stkForm', 'stkWaiting', 'stkSuccess', 'stkFailed'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = (id !== which);
    });
  }

  function openStkModal(opts) {
    stkState.target = opts.target || 'loan';
    stkState.loanId = opts.loanId || null;
    stkState.outstanding = opts.outstanding || 0;
    stkState.checkoutId = null;

    // Adjust modal title + button per target
    var title = document.getElementById('stkTitle');
    if (title) title.textContent = stkState.target === 'savings' ? 'Save via M-Pesa' : 'Pay via M-Pesa';
    var submitBtn = document.getElementById('stkSubmitBtn');
    if (submitBtn) submitBtn.textContent = stkState.target === 'savings' ? 'Save now' : 'Pay now';
    var hint = document.getElementById('stkAmountHint');
    if (hint) {
      if (stkState.target === 'savings') {
        hint.textContent = 'Minimum: KES 100';
      } else {
        hint.textContent = 'Max: KES ' + Number(opts.outstanding || 0).toLocaleString('en-KE');
      }
    }
    if (stkState.pollTimer) { clearInterval(stkState.pollTimer); stkState.pollTimer = null; }

    var overlay = document.getElementById('stkOverlay');
    if (!overlay) return;

    var amt = document.getElementById('stkAmount');
    if (amt) {
      amt.value = stkState.target === 'savings' ? 100 : Math.round(opts.outstanding || 0);
      amt.min = stkState.target === 'savings' ? 100 : 1;
    }

    var phone = document.getElementById('stkPhone');
    if (phone) phone.value = opts.defaultPhone || '';

    var err = document.getElementById('stkError');
    if (err) { err.hidden = true; err.textContent = ''; }

    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    showStkState('stkForm');

    setTimeout(function () { if (amt) amt.focus(); }, 50);
  }

  function closeStkModal() {
    var overlay = document.getElementById('stkOverlay');
    if (overlay) overlay.hidden = true;
    document.body.style.overflow = '';
    if (stkState.pollTimer) { clearInterval(stkState.pollTimer); stkState.pollTimer = null; }
  }

  function stkShowError(msg) {
    var err = document.getElementById('stkError');
    if (err) { err.textContent = msg; err.hidden = false; }
  }

  async function submitStk() {
    var amt = Number(document.getElementById('stkAmount').value);
    var phone = String(document.getElementById('stkPhone').value || '').trim();

    if (!(amt > 0)) return stkShowError('Enter a valid amount.');
    if (stkState.target === 'savings') {
      if (amt < 100) return stkShowError('Minimum savings deposit is KES 100.');
    } else {
      if (amt > stkState.outstanding) return stkShowError('Amount cannot exceed KES ' + stkState.outstanding.toFixed(2) + '.');
    }
    if (!/^2547[0-9]{8}$/.test(phone)) return stkShowError('Phone must be in format 2547XXXXXXXX.');

    var btn = document.getElementById('stkSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    try {
      var endpoint = stkState.target === 'savings'
        ? '/api/daraja/stk-push-savings'
        : '/api/daraja/stk-push';
      var payload = stkState.target === 'savings'
        ? { phone: phone, amount: amt }
        : { loan_id: stkState.loanId, phone: phone, amount: amt };

      var res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var data = await res.json();

      if (!res.ok || !data.ok) {
        stkShowError(data.error || 'Could not send STK push.');
        if (btn) { btn.disabled = false; btn.textContent = 'Pay now'; }
        return;
      }

      stkState.checkoutId = data.checkout_request_id;
      showStkState('stkWaiting');
      pollStatus();

    } catch (err) {
      stkShowError('Network error. Try again.');
      if (btn) { btn.disabled = false; btn.textContent = 'Pay now'; }
    }
  }

  function pollStatus() {
    if (!stkState.checkoutId) return;
    var attempts = 0;
    var maxAttempts = 30;

    stkState.pollTimer = setInterval(async function () {
      attempts++;
      try {
        var res = await fetch('/api/daraja/status/' + encodeURIComponent(stkState.checkoutId), {
          credentials: 'same-origin',
        });
        var data = await res.json();

        if (data.status === 'success') {
          clearInterval(stkState.pollTimer);
          stkState.pollTimer = null;
          var sa = document.getElementById('stkSuccessAmount');
          var sr = document.getElementById('stkSuccessReceipt');
          var st = document.querySelector('#stkSuccess h2');
          if (st) st.textContent = stkState.target === 'savings' ? '✓ Savings received' : '✓ Payment received';
          if (sa) sa.textContent = 'KES ' + Number(data.amount || 0).toLocaleString('en-KE');
          if (sr) sr.textContent = data.mpesa_receipt || '—';
          showStkState('stkSuccess');
          return;
        }

        if (data.status && data.status !== 'pending') {
          clearInterval(stkState.pollTimer);
          stkState.pollTimer = null;
          var fr = document.getElementById('stkFailReason');
          if (fr) fr.textContent = data.result_desc || 'Payment was not completed.';
          showStkState('stkFailed');
          return;
        }
      } catch (e) {}

      if (attempts >= maxAttempts) {
        clearInterval(stkState.pollTimer);
        stkState.pollTimer = null;
        var fr2 = document.getElementById('stkFailReason');
        if (fr2) fr2.textContent = 'Timed out waiting for confirmation. Please check your phone and try again.';
        showStkState('stkFailed');
      }
    }, 2000);
  }

  function wireStkModal() {
    var overlay = document.getElementById('stkOverlay');
    if (!overlay) return;

    var closeBtn = document.getElementById('stkCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeStkModal);

    var cancelBtn = document.getElementById('stkCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeStkModal);

    var submitBtn = document.getElementById('stkSubmitBtn');
    if (submitBtn) submitBtn.addEventListener('click', submitStk);

    var doneBtn = document.getElementById('stkDoneBtn');
    if (doneBtn) doneBtn.addEventListener('click', function () { window.location.reload(); });

    var retryBtn = document.getElementById('stkRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', function () { showStkState('stkForm'); });

    var closeFail = document.getElementById('stkCloseFailBtn');
    if (closeFail) closeFail.addEventListener('click', closeStkModal);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeStkModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) closeStkModal();
    });
  }

  // ---------------------------------------------------------------
  // Privacy mask (hide/show balances)
  // ---------------------------------------------------------------
  var MASK_KEY = 'zaria.mask.balances';

  function applyMaskState(on) {
    if (on) {
      document.body.classList.add('is-masked');
    } else {
      document.body.classList.remove('is-masked');
    }
    var btn = $('maskToggleBtn');
    if (btn) {
      btn.setAttribute('aria-label', on ? 'Show balances' : 'Hide balances');
      btn.title = on ? 'Show balances' : 'Hide balances';
    }
  }

  function wireMaskToggle() {
    var saved = localStorage.getItem(MASK_KEY) === '1';
    applyMaskState(saved);

    var btn = $('maskToggleBtn');
    if (!btn) return;

    btn.addEventListener('click', function () {
      var nowMasked = !document.body.classList.contains('is-masked');
      applyMaskState(nowMasked);
      localStorage.setItem(MASK_KEY, nowMasked ? '1' : '0');
    });
  }

  // ---------------------------------------------------------------
  // Collapsible cards
  // ---------------------------------------------------------------
  var COLLAPSE_KEY_PREFIX = 'zaria.collapse.';

  function wireCollapse() {
    document.querySelectorAll('.card[id]').forEach(function (card) {
      var head = card.querySelector('.card-head');
      if (!head) return;

      // Mark as collapsible
      head.classList.add('is-collapsible');

      // Restore saved state
      var id = card.id;
      if (id && localStorage.getItem(COLLAPSE_KEY_PREFIX + id) === '1') {
        card.classList.add('is-collapsed');
      }

      head.addEventListener('click', function () {
        card.classList.toggle('is-collapsed');
        if (id) {
          localStorage.setItem(COLLAPSE_KEY_PREFIX + id, card.classList.contains('is-collapsed') ? '1' : '0');
        }
      });
    });
  }

  function wireAvatar(user) {
    var av = $('avatarBtn');
    // Show uploaded photo if one exists; otherwise fall back to initial
    fetch('/api/me/photo', { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('no photo');
        av.classList.add('has-img');
        av.innerHTML = '<img class="avatar-img" alt="" src="/api/me/photo?v=' + Date.now() + '">';
      })
      .catch(function () {
        av.textContent = user.email.charAt(0).toUpperCase();
      });

    av.addEventListener('click', async function () {
      if (!confirm('Sign out of Zaria?')) return;
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.replace('/');
    });
  }

  // ---------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------
  function wireNotifications() {
    var btn = $('notifBtn');
    var panel = $('notifPanel');
    if (!btn || !panel) return;

    function render(data) {
      var items = (data && data.items) || [];
      if (!items.length) {
        panel.innerHTML = '<div class="notif-empty">You\'re all caught up.</div>';
      } else {
        panel.innerHTML = items.map(function (it) {
          return '<a class="notif-item" href="' + escapeHtml(it.href) + '">' +
                   '<span class="notif-title">' + escapeHtml(it.title) + '</span>' +
                 '</a>';
        }).join('');
      }
    }

    function refresh() {
      fetch('/api/me/notifications', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : { count: 0, items: [] }; })
        .then(function (d) {
          var count = Number(d.count) || 0;
          btn.classList.toggle('has-items', count > 0);
          render(d);
        })
        .catch(function () {
          btn.classList.remove('has-items');
          panel.innerHTML = '<div class="notif-empty">Could not load.</div>';
        });
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      if (!panel.hidden) refresh();
    });

    document.addEventListener('click', function (e) {
      if (!panel.hidden && !e.target.closest('.notif-wrap')) panel.hidden = true;
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) panel.hidden = true;
    });

    refresh();
  }

  // ---------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------

  (async function () {
    try {
      var meRes = await fetch('/api/me', { credentials: 'same-origin' });
      if (!meRes.ok) { window.location.replace('/'); return; }
      var me = await meRes.json();
      if (me.user.role !== 'client') { window.location.replace('/admin/dashboard'); return; }

      wireAvatar(me.user);
      window.__mePhone = me.user.phone || '';
      wireStkModal();
      wireMaskToggle();
      wireCollapse();
      wireNotifications();

      var res = await fetch('/api/me/summary', { credentials: 'same-origin' });
      if (!res.ok) {
        console.error('summary failed');
        $('greeting').textContent = 'Welcome';
        return;
      }
      var summary = await res.json();

      var first = summary.client.full_name.split(' ')[0] || 'there';
      var hour = new Date().getHours();
      var greet = hour < 12 ? 'Habari za asubuhi' : hour < 17 ? 'Habari za mchana' : 'Habari za jioni';
      $('greeting').textContent = greet + ', ' + first;

      renderHeroNew(summary);
      renderMoneyStrip(summary);
      renderChamaCard(summary);
      renderLoanCard(summary);

      if (summary.active_loan) {
        // fetch full loan detail for the summary card
        var loanRes = await fetch('/api/me/loans/' + summary.active_loan.id, { credentials: 'same-origin' });
        if (loanRes.ok) {
          var ld = await loanRes.json();
          renderLoanSummary(ld.loan);
        }
      } else {
        renderLoanSummary(null);
      }

      renderUnifiedActivity(summary.activity || []);
    } catch (e) {
      console.error('[client-dashboard]', e);
      window.location.replace('/');
    }
  })();

  // ===============================================================
  // Mobile drawer
  // ===============================================================
  (function wireDrawer() {
    var menuBtn = document.getElementById('menuBtn');
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('sidebarBackdrop');

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

    if (backdrop) {
      backdrop.addEventListener('click', closeDrawer);
    }

    if (sidebar) {
      sidebar.querySelectorAll('.nav-item').forEach(function (el) {
        el.addEventListener('click', function () {
          if (window.matchMedia('(max-width: 1023px)').matches) {
            closeDrawer();
          }
        });
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });
  })();

  // PWA install prompt
  (function () {
    var deferredPrompt = null;
    var installBar = document.getElementById('installBar');

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      if (installBar) installBar.hidden = false;
    });

    if (installBar) {
      var btn = document.getElementById('installBtn');
      var dismiss = document.getElementById('installDismiss');
      if (btn) btn.addEventListener('click', async function () {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        var choice = await deferredPrompt.userChoice;
        deferredPrompt = null;
        installBar.hidden = true;
      });
      if (dismiss) dismiss.addEventListener('click', function () {
        installBar.hidden = true;
      });
    }
  })();


  // ===============================================================
  // Push notifications
  // ===============================================================
  (function wirePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }

    var prompt = document.getElementById('pushPrompt');
    var enableBtn = document.getElementById('pushEnable');
    var dismissBtn = document.getElementById('pushDismiss');

    function urlBase64ToUint8Array(base64String) {
      var str = String(base64String || '').trim().replace(/=+$/, '');
      if (!/^[A-Za-z0-9_-]+$/.test(str)) {
        throw new Error('Invalid VAPID key format: ' + str.slice(0, 20));
      }
      var padding = '='.repeat((4 - str.length % 4) % 4);
      var base64 = (str + padding).replace(/-/g, '+').replace(/_/g, '/');
      var raw = atob(base64);
      var out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
      return out;
    }

    async function subscribeDevice() {
      var reg = await navigator.serviceWorker.ready;
      var keyRes = await fetch('/api/push/public-key', { credentials: 'same-origin', cache: 'no-store' });
      if (!keyRes.ok) throw new Error('Push not available');
      var payload = await keyRes.json();
      var key = payload && payload.publicKey ? String(payload.publicKey).trim() : null;
      if (!key) throw new Error('No VAPID key returned');

      console.log('[push] key length:', key.length, 'first 8:', key.slice(0, 8));

      var bytes = urlBase64ToUint8Array(key);
      console.log('[push] key bytes:', bytes.byteLength);

      var sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });

      var res = await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) {
        var errBody = await res.json().catch(function () { return {}; });
        throw new Error(errBody.error || 'Server rejected subscription');
      }
      return true;
    }

    async function init() {
      try {
        if (Notification.permission === 'default' && prompt) {
          prompt.hidden = false;
        }

        if (Notification.permission === 'granted') {
          await subscribeDevice().catch(function (e) { console.warn('silent subscribe failed', e); });
        }

        if (enableBtn) {
          enableBtn.addEventListener('click', async function () {
            enableBtn.disabled = true;
            enableBtn.textContent = 'Enabling…';
            try {
              var perm = await Notification.requestPermission();
              if (perm !== 'granted') {
                prompt.hidden = true;
                alert('Notifications were blocked. You can enable them later from your browser settings.');
                return;
              }
              await subscribeDevice();
              prompt.hidden = true;
              try {
                var reg = await navigator.serviceWorker.ready;
                reg.showNotification('Zaria notifications enabled', {
                  body: 'You will now receive payment reminders and updates.',
                  icon: '/favicon/192',
                  tag: 'welcome',
                });
              } catch (_) {}
            } catch (e) {
              alert('Could not enable notifications: ' + e.message);
              enableBtn.disabled = false;
              enableBtn.textContent = 'Enable';
            }
          });
        }

        if (dismissBtn) {
          dismissBtn.addEventListener('click', function () {
            prompt.hidden = true;
            try { localStorage.setItem('pushPromptDismissedAt', String(Date.now())); } catch (_) {}
          });
          try {
            var dismissedAt = parseInt(localStorage.getItem('pushPromptDismissedAt') || '0', 10);
            if (dismissedAt && Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) {
              prompt.hidden = true;
            }
          } catch (_) {}
        }
      } catch (e) {
        console.warn('[push]', e);
      }
    }

    window.addEventListener('load', init);
  })();

})();

// ────────────────────────────────────────────────────────────────
// Contribution hint enhancement — 2026-10-21
// Populates #moneySavingsSub with "This year: KES X · view contributions"
// once the summary loads. Silent no-op if anything fails.
// ────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  function run() {
    var el = document.getElementById('moneySavingsSub');
    if (!el) return;
    fetch('/api/me/savings/monthly', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        if (!m || !m.years) return;
        var y = new Date().getFullYear();
        var cy = m.years.find(function (yr) { return yr.year === y; });
        var total = cy ? cy.total : 0;
        var formatted = total.toLocaleString('en-KE', { maximumFractionDigits: 0 });
        el.innerHTML = 'This year: <strong>KES ' + formatted + '</strong> · ' +
          '<a href="/client/savings" style="color:inherit;text-decoration:underline">view contributions</a>';
      })
      .catch(function () { /* silent */ });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
