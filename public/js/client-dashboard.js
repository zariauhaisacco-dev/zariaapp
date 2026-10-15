/* Zaria — Client dashboard */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

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
      ss.textContent = 'Acct ' + escapeHtml(summary.savings.account_number);
    } else {
      sv.innerHTML = '<span class="unit">KES</span>0';
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
      var pct = total > 0 ? Math.round((repaid / total) * 100) : 0;
      var outstanding = total - repaid;

      hero.innerHTML =
        '<div class="label">Next payment</div>' +
        '<div class="amount"><span class="unit">KES</span>' + fmtMoney(next.amountRemaining) + '</div>' +
        '<div class="meta">Due <strong style="color:#fff">' + fmtDate(next.dueDate) + '</strong>' + (dueText ? ' · ' + dueText : '') + '</div>' +
        '<div class="progress-row">' +
          '<span>' + pct + '% repaid</span>' +
          '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
          '<span>KES ' + fmtMoney(outstanding) + ' left</span>' +
        '</div>' +
        '<div class="client-actions">' +
          '<button class="btn-sm btn-amber" id="payBtn">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 5l7 7-7 7"/></svg>' +
            'Pay now via M-Pesa' +
          '</button>' +
          '<a href="/client/loans" class="btn-ghost-light" style="text-decoration:none">View schedule</a>' +
        '</div>';

      if ($('payBtn')) {
        $('payBtn').addEventListener('click', function () {
          alert('M-Pesa STK push integration coming in Phase 4. Contact us on 0746 138 896 to pay.');
        });
      }
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
        '<div class="kv-row"><span class="kv-label">Principal</span><span class="kv-value">KES ' + fmtMoney(loan.principal) + '</span></div>' +
        '<div class="kv-row"><span class="kv-label">Interest rate</span><span class="kv-value">' + (Number(loan.interest_rate) * 100).toFixed(1) + '% flat</span></div>' +
        '<div class="kv-row"><span class="kv-label">Term</span><span class="kv-value">' + loan.term_months + ' month' + (loan.term_months === 1 ? '' : 's') + '</span></div>' +
        '<div class="kv-row"><span class="kv-label">Total repayable</span><span class="kv-value">KES ' + fmtMoney(loan.total_repayable) + '</span></div>' +
        '<div class="kv-row"><span class="kv-label">Total repaid</span><span class="kv-value" style="color:var(--pos)">KES ' + fmtMoney(loan.amount_repaid) + '</span></div>' +
        '<div class="kv-row"><span class="kv-label">Outstanding</span><span class="kv-value">KES ' + fmtMoney(Number(loan.total_repayable) - Number(loan.amount_repaid)) + '</span></div>' +
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
          '<div style="color:var(--ink-900);font-weight:600;font-family:var(--font-mono)">' + sign + fmtMoney(t.amount) + '</div>' +
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
  // Bootstrap
  // ---------------------------------------------------------------

  (async function () {
    try {
      var meRes = await fetch('/api/me', { credentials: 'same-origin' });
      if (!meRes.ok) { window.location.replace('/'); return; }
      var me = await meRes.json();
      if (me.user.role !== 'client') { window.location.replace('/admin/dashboard'); return; }

      wireAvatar(me.user);

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

      renderHero(summary);
      renderMoneyStrip(summary);

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

      renderTransactions(summary.recent_transactions || []);
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
