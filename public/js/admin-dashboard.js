/* Zaria — Admin dashboard */
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
    return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtMoney2(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function shortTime(iso) {
    var d = new Date(iso);
    var diff = Math.round((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  // ---------------------------------------------------------------
  // Stats strip
  // ---------------------------------------------------------------

  async function loadStats() {
    var res = await fetch('/api/admin/stats', { credentials: 'same-origin' });
    if (res.status === 401) { window.location.replace('/'); return; }
    var s = await res.json();

    $('statOutstanding').innerHTML = '<span class="unit">KES</span>' + fmtMoney(s.outstanding);
    $('statCollected').innerHTML = '<span class="unit">KES</span>' + fmtMoney(s.collected_mtd);
    $('statActive').textContent = s.active_loans;
    $('statOverdue').textContent = s.overdue_loans;

    // --- Member funds strip ---
    var sav = $('statSavings');
    if (sav) {
      sav.innerHTML = '<span class="unit">KES</span>' + fmtMoney(s.savings_total || 0);
      var savSub = $('statSavingsSub');
      if (savSub) {
        savSub.textContent = (s.savings_accounts || 0) + ' active account' + ((s.savings_accounts || 0) === 1 ? '' : 's');
      }
    }

    var sh = $('statShares');
    if (sh) {
      sh.innerHTML = '<span class="unit">KES</span>' + fmtMoney(s.shares_capital || 0);
      var shSub = $('statSharesSub');
      if (shSub) {
        shSub.textContent = (s.shares_total || 0) + ' shares · ' + (s.shares_holders || 0) + ' holder' + ((s.shares_holders || 0) === 1 ? '' : 's');
      }
    }

    var dv = $('statDividends');
    if (dv) {
      dv.innerHTML = '<span class="unit">KES</span>' + fmtMoney(s.dividends_declared || 0);
      var dvSub = $('statDividendsSub');
      if (dvSub) {
        var cnt = s.dividends_count || 0;
        var paid = s.dividends_paid || 0;
        dvSub.textContent = cnt + ' declaration' + (cnt === 1 ? '' : 's') + ' · KES ' + fmtMoney(paid) + ' credited';
      }
    }

    // Badges on sidebar
    if (s.pending_loans > 0) {
      var badge = $('pendingLoansBadge');
      if (badge) { badge.textContent = s.pending_loans; badge.hidden = false; }
    }
    if (s.pending_registrations > 0) {
      var rbadge = $('pendingRegsBadge');
      if (rbadge) { rbadge.textContent = s.pending_registrations; rbadge.hidden = false; }
    }
    if (s.pending_loan_requests > 0) {
      var reqbadge = $("pendingRequestsBadge");
      if (reqbadge) { reqbadge.textContent = s.pending_loan_requests; reqbadge.hidden = false; }
    }

    // Chama stats
    var cb = $('statChamaBalance');
    if (cb) {
      cb.innerHTML = '<span class="unit">KES</span>' + fmtMoney(s.chama_balance || 0);
      var cbSub = $('statChamaBalanceSub');
      if (cbSub) {
        var nActive = s.chama_active || 0;
        cbSub.textContent = nActive + ' active chama' + (nActive === 1 ? '' : 's');
      }
    }
    var cm = $('statChamaMembers');
    if (cm) {
      cm.textContent = s.chama_members || 0;
      var cmSub = $('statChamaMembersSub');
      if (cmSub) {
        var nA = s.chama_active || 0;
        cmSub.textContent = 'Across ' + nA + ' chama' + (nA === 1 ? '' : 's');
      }
    }
    var cp = $('statChamaPayouts');
    if (cp) {
      cp.innerHTML = '<span class="unit">KES</span>' + fmtMoney(s.chama_payouts_total || 0);
      var cpSub = $('statChamaPayoutsSub');
      if (cpSub) {
        var nP = s.chama_payouts_count || 0;
        cpSub.textContent = nP + ' payout' + (nP === 1 ? '' : 's') + ' · all time';
      }
    }

    // SMS stats
    var sc = $('statSmsCredits');
    if (sc) {
      var bal = s.sms_credits_balance;
      if (bal != null) {
        sc.textContent = Number(bal).toFixed(1);
        var scSub = $('statSmsCreditsSub');
        if (scSub) {
          scSub.textContent = bal < 5 ? '⚠️ Low — top up soon' : 'Ping Africa balance';
          scSub.style.color = bal < 5 ? 'var(--neg)' : 'var(--ink-500)';
        }
      } else {
        sc.textContent = '—';
        var scSub2 = $('statSmsCreditsSub');
        if (scSub2) { scSub2.textContent = 'Ping Africa offline'; scSub2.style.color = 'var(--neg)'; }
      }
    }
    if ($('statSmsToday')) $('statSmsToday').textContent = s.sms_today || 0;
    if ($('statSmsMonth')) $('statSmsMonth').textContent = s.sms_this_month || 0;

    return s;
  }

  // ---------------------------------------------------------------
  // Recent loans table
  // ---------------------------------------------------------------

  async function loadRecentLoans() {
    var res = await fetch('/api/admin/loans?status=all', { credentials: 'same-origin' });
    if (!res.ok) return;
    var data = await res.json();
    var loans = (data.loans || []).slice(0, 8);

    var tbody = $('recentLoansBody');
    if (!loans.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:24px">No loans yet</td></tr>';
      return;
    }

    tbody.innerHTML = loans.map(function (l) {
      var statusClass =
        l.status === 'active' ? 'pos' :
        l.status === 'repaid' ? 'neutral' :
        l.status === 'overdue' ? 'neg' :
        l.status === 'pending' || l.status === 'approved' ? 'warn' : 'neutral';

      return '<tr>' +
        '<td><span class="name">' + escapeHtml(l.client_name) + '</span><div class="muted">' + escapeHtml(l.client_phone) + '</div></td>' +
        '<td class="muted">#' + l.id + '</td>' +
        '<td class="num">' + fmtMoney(l.principal) + '</td>' +
        '<td class="num">' + fmtMoney(l.outstanding) + '</td>' +
        '<td><span class="pill ' + statusClass + '">' + l.status + '</span></td>' +
        '<td>' + fmtDate(l.next_due || l.disbursed_at || l.created_at) + '</td>' +
      '</tr>';
    }).join('');
  }

  // ---------------------------------------------------------------
  // Recent activity feed (from audit_logs on the server — we derive from loans + requests)
  // ---------------------------------------------------------------

  async function loadActivity() {
    var feed = $('activityFeed');
    feed.innerHTML = '<div class="feed-item"><div class="feed-text">Loading…</div></div>';

    // We don't have a dedicated audit-log endpoint yet, so compose a feed from
    // the most recent loans and requests we already have access to.
    var [loansRes, reqRes] = await Promise.all([
      fetch('/api/admin/loans?status=all', { credentials: 'same-origin' }),
      fetch('/api/admin/loan-requests?status=all', { credentials: 'same-origin' }),
    ]);

    if (!loansRes.ok || !reqRes.ok) {
      feed.innerHTML = '<div class="feed-item"><div class="feed-text" style="color:var(--ink-500)">Could not load activity</div></div>';
      return;
    }

    var loansData = await loansRes.json();
    var reqData = await reqRes.json();

    var items = [];

    (loansData.loans || []).forEach(function (l) {
      var icon = 'neutral', text = '';
      if (l.status === 'repaid') {
        icon = 'pos'; text = '<strong>' + escapeHtml(l.client_name) + '</strong> repaid <strong>KES ' + fmtMoney(l.total_repayable) + '</strong> on loan #' + l.id;
      } else if (l.status === 'active') {
        icon = 'info'; text = 'Loan <strong>#' + l.id + '</strong> disbursed — <strong>KES ' + fmtMoney(l.principal) + '</strong> to ' + escapeHtml(l.client_name);
      } else if (l.status === 'overdue') {
        icon = 'neg'; text = 'Loan <strong>#' + l.id + '</strong> for ' + escapeHtml(l.client_name) + ' is overdue';
      } else if (l.status === 'pending') {
        icon = 'warn'; text = 'Loan <strong>#' + l.id + '</strong> created for <strong>' + escapeHtml(l.client_name) + '</strong>';
      } else if (l.status === 'approved') {
        icon = 'warn'; text = 'Loan <strong>#' + l.id + '</strong> approved — awaiting disbursement';
      } else {
        return;
      }
      items.push({
        ts: l.disbursed_at || l.created_at,
        icon: icon,
        text: text,
      });
    });

    (reqData.requests || []).forEach(function (r) {
      var icon = 'info', text = '';
      if (r.status === 'pending') {
        icon = 'warn';
        text = '<strong>' + escapeHtml(r.client_name) + '</strong> requested <strong>KES ' + fmtMoney(r.requested_amount) + '</strong>';
      } else if (r.status === 'approved') {
        icon = 'pos';
        text = 'Request from <strong>' + escapeHtml(r.client_name) + '</strong> approved';
      } else if (r.status === 'rejected') {
        icon = 'neg';
        text = 'Request from <strong>' + escapeHtml(r.client_name) + '</strong> rejected';
      } else {
        return;
      }
      items.push({
        ts: r.reviewed_at || r.created_at,
        icon: icon,
        text: text,
      });
    });

    items.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
    items = items.slice(0, 8);

    if (!items.length) {
      feed.innerHTML = '<div class="feed-item"><div class="feed-text" style="color:var(--ink-500)">No activity yet</div></div>';
      return;
    }

    var iconSvg = {
      pos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l4 4 10-10"/></svg>',
      neg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg>',
      warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 8v5"/><circle cx="12" cy="16.5" r="0.6" fill="currentColor"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
      neutral: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>',
    };

    feed.innerHTML = items.map(function (i) {
      return '<div class="feed-item">' +
        '<div class="feed-icon ' + i.icon + '">' + iconSvg[i.icon] + '</div>' +
        '<div class="feed-text">' + i.text + '</div>' +
        '<div class="feed-time">' + shortTime(i.ts) + '</div>' +
      '</div>';
    }).join('');
  }

  // ---------------------------------------------------------------
  // "Needs attention"
  // ---------------------------------------------------------------

  async function loadAttention() {
    var list = $('attnList');
    list.innerHTML = '<div class="attn-item"><div class="attn-text">Loading…</div></div>';

    var [reqRes, loansRes] = await Promise.all([
      fetch('/api/admin/loan-requests?status=pending', { credentials: 'same-origin' }),
      fetch('/api/admin/loans?status=overdue', { credentials: 'same-origin' }),
    ]);

    var items = [];

    if (reqRes.ok) {
      var rq = await reqRes.json();
      var pendingReqs = rq.requests || [];
      if (pendingReqs.length) {
        items.push({
          dot: 'warn',
          strong: pendingReqs.length + ' loan request' + (pendingReqs.length === 1 ? '' : 's'),
          meta: 'awaiting review · oldest ' + fmtDate(pendingReqs[pendingReqs.length - 1].created_at),
          href: '/admin/requests',
        });
      }
    }

    if (loansRes.ok) {
      var ln = await loansRes.json();
      var overdue = ln.loans || [];
      if (overdue.length) {
        var highest = overdue.reduce(function (m, l) {
          return Number(l.outstanding) > Number(m.outstanding) ? l : m;
        }, overdue[0]);
        items.push({
          dot: 'neg',
          strong: overdue.length + ' loan' + (overdue.length === 1 ? '' : 's') + ' overdue',
          meta: 'Highest: KES ' + fmtMoney(highest.outstanding) + ' · ' + escapeHtml(highest.client_name),
          href: '/admin/loans?status=overdue',
        });
      }
    }

    // Also check pending registrations count from stats
    try {
      var statsRes = await fetch('/api/admin/stats', { credentials: 'same-origin' });
      if (statsRes.ok) {
        var stats = await statsRes.json();
        if (stats.pending_registrations > 0) {
          items.push({
            dot: 'warn',
            strong: stats.pending_registrations + ' registration' + (stats.pending_registrations === 1 ? '' : 's'),
            meta: 'pending approval',
            href: '/admin/registrations',
          });
        }
      }
    } catch (_) {}

    if (!items.length) {
      list.innerHTML = '<div class="attn-item"><div class="attn-text" style="color:var(--ink-500)">All clear — nothing needs attention</div></div>';
      return;
    }

    var arrow = '<svg class="attn-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>';

    list.innerHTML = items.map(function (it) {
      return '<a class="attn-item" href="' + it.href + '" style="text-decoration:none;color:inherit">' +
        '<span class="attn-dot ' + it.dot + '"></span>' +
        '<div class="attn-text"><strong>' + it.strong + '</strong><div class="attn-meta">' + it.meta + '</div></div>' +
        arrow +
      '</a>';
    }).join('');
  }

  // ---------------------------------------------------------------
  // Chart: outstanding vs collected over 12 weeks
  // ---------------------------------------------------------------

  async function loadChart() {
    var res = await fetch('/api/admin/stats', { credentials: 'same-origin' });
    if (!res.ok) return;
    var s = await res.json();
    var series = s.weekly_series || [];

    var svg = document.getElementById('chartSvg');
    if (!svg) return;

    // If no data, show a flat baseline
    if (!series.length) {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#96A0B0" font-size="12">No data yet</text>';
      return;
    }

    var w = 800, h = 200;
    var pad = 8;
    var n = series.length;
    var maxVal = 1;
    series.forEach(function (r) {
      var c = Number(r.collected) || 0;
      var d = Number(r.disbursed) || 0;
      if (c > maxVal) maxVal = c;
      if (d > maxVal) maxVal = d;
    });
    maxVal *= 1.15;

    function x(i) { return n === 1 ? w / 2 : (i / (n - 1)) * (w - pad * 2) + pad; }
    function y(v) { return h - ((Number(v) || 0) / maxVal) * (h - pad * 2) - pad; }

    var collectedPath = series.map(function (r, i) {
      return (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(r.collected).toFixed(1);
    }).join(' ');

    var disbursedPath = series.map(function (r, i) {
      return (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(r.disbursed).toFixed(1);
    }).join(' ');

    var lastCollected = y(series[n - 1].collected);
    var lastDisbursed = y(series[n - 1].disbursed);
    var lastX = x(n - 1);

    var areaPath = collectedPath + ' L' + lastX.toFixed(1) + ',' + h + ' L' + x(0).toFixed(1) + ',' + h + ' Z';

    svg.innerHTML =
      '<defs>' +
        '<linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#F5B301" stop-opacity="0.22"/>' +
          '<stop offset="100%" stop-color="#F5B301" stop-opacity="0"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<g stroke="#E5E2DD" stroke-width="0.5">' +
        '<line x1="0" y1="40" x2="800" y2="40"/>' +
        '<line x1="0" y1="80" x2="800" y2="80"/>' +
        '<line x1="0" y1="120" x2="800" y2="120"/>' +
        '<line x1="0" y1="160" x2="800" y2="160"/>' +
      '</g>' +
      '<path d="' + areaPath + '" fill="url(#areaFill)"/>' +
      '<path d="' + collectedPath + '" fill="none" stroke="#F5B301" stroke-width="2"/>' +
      '<path d="' + disbursedPath + '" fill="none" stroke="#1E3A66" stroke-width="2"/>' +
      '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastCollected.toFixed(1) + '" r="3.5" fill="#F5B301" stroke="#fff" stroke-width="1.5"/>' +
      '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastDisbursed.toFixed(1) + '" r="3.5" fill="#1E3A66" stroke="#fff" stroke-width="1.5"/>';
  }

  // ---------------------------------------------------------------
  // Avatar / logout
  // ---------------------------------------------------------------

  function wireAvatar(user) {
    var av = $('avatarBtn');
    av.textContent = user.email.charAt(0).toUpperCase();
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
      fetch('/api/admin/notifications', { credentials: 'same-origin' })
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

    // Initial badge count
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
      if (me.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }

      var hour = new Date().getHours();
      var greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      var first = me.user.email.split('@')[0];
      $('greeting').textContent = greet + ', ' + first;
      $('pageSub').textContent = new Date().toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });

      wireAvatar(me.user);
      wireNotifications();

      await Promise.all([
        loadStats(),
        loadRecentLoans(),
        loadActivity(),
        loadAttention(),
        loadChart(),
      ]);
    } catch (e) {
      console.error('[admin-dashboard]', e);
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

  // ---------------------------------------------------------------
  // Global search (topbar)
  // ---------------------------------------------------------------
  (function () {
    var input = document.getElementById('global-search');
    var panel = document.getElementById('search-results');
    if (!input || !panel) return;

    var debounceTimer = null;
    var currentQuery = '';
    var lastResults = null;

    function hide() {
      panel.hidden = true;
      panel.innerHTML = '';
      currentQuery = '';
      lastResults = null;
    }

    function buildHref(entity, row) {
      if (entity === 'client') return '/admin/client-detail.html?id=' + row.id;
      if (entity === 'loan')   return '/admin/loan-detail.html?id=' + row.id;
      if (entity === 'transaction') {
        var ref = row.mpesa_receipt || row.reference || row.id;
        return '/admin/transactions.html?q=' + encodeURIComponent(ref);
      }
      return '/admin/dashboard.html';
    }

    function renderSection(title, entity, rows) {
      if (!rows.length) return '';
      var html = '<div class="search-section"><div class="search-section-title">' + escapeHtml(title) + '</div>';
      rows.forEach(function (row) {
        var name, meta, badge, statusVal;
        if (entity === 'client') {
          name = row.full_name;
          meta = row.phone || '';
          statusVal = row.status || 'active';
          badge = statusVal;
        } else if (entity === 'loan') {
          name = 'Loan #' + row.id + ' — ' + row.client_name;
          meta = 'KES ' + fmtMoney(row.principal);
          statusVal = row.status || '';
          badge = statusVal;
        } else {
          name = row.type + ' — ' + row.client_name;
          meta = 'KES ' + fmtMoney2(row.amount) + (row.mpesa_receipt ? ' · ' + row.mpesa_receipt : '');
          statusVal = '';
          badge = '';
        }
        html += '<a class="search-result" href="' + buildHref(entity, row) + '">' +
          '<span class="search-result-main">' +
            '<span class="search-result-name">' + escapeHtml(name) + '</span>' +
            (meta ? ' <span class="search-result-meta">' + escapeHtml(meta) + '</span>' : '') +
          '</span>' +
          (badge ? '<span class="search-result-badge" data-status="' + escapeHtml(statusVal) + '">' + escapeHtml(badge) + '</span>' : '') +
        '</a>';
      });
      html += '</div>';
      return html;
    }

    function render(data) {
      var total = (data.clients || []).length + (data.loans || []).length + (data.transactions || []).length;
      if (total === 0) {
        panel.innerHTML = '<div class="search-empty">No matches for “' + escapeHtml(data.query || '') + '”</div>';
        panel.hidden = false;
        return;
      }
      var html = '';
      html += renderSection('Clients', 'client', data.clients || []);
      html += renderSection('Loans', 'loan', data.loans || []);
      html += renderSection('Transactions', 'transaction', data.transactions || []);
      panel.innerHTML = html;
      panel.hidden = false;
    }

    function search(q) {
      currentQuery = q;
      fetch('/api/admin/search?q=' + encodeURIComponent(q), { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          // Ignore stale responses (query changed while in-flight)
          if (currentQuery !== q) return;
          if (data.error) {
            panel.innerHTML = '<div class="search-empty">' + escapeHtml(data.error) + '</div>';
            panel.hidden = false;
            return;
          }
          lastResults = data;
          render(data);
        })
        .catch(function () {
          panel.innerHTML = '<div class="search-empty">Search failed</div>';
          panel.hidden = false;
        });
    }

    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (debounceTimer) clearTimeout(debounceTimer);
      if (q.length < 2) {
        hide();
        return;
      }
      debounceTimer = setTimeout(function () { search(q); }, 300);
    });

    input.addEventListener('focus', function () {
      if (input.value.trim().length >= 2 && !lastResults) {
        search(input.value.trim());
      }
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.topbar-search')) hide();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) {
        hide();
        input.blur();
      }
    });
  })();
})();
