(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtMoneyShort(n) {
    n = Number(n) || 0;
    if (n === 0) return '—';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function typeLabel(t) {
    return { deposit: 'Deposit', withdrawal: 'Withdrawal', interest: 'Interest', fee: 'Fee', adjustment: 'Contribution' }[t] || t;
  }

  var state = { monthly: null, activeYear: null };

  function renderYearTabs(years) {
    $('yearTabs').innerHTML = years.map(function (y) {
      var active = y.year === state.activeYear ? ' active' : '';
      return '<button type="button" class="year-tab' + active + '" data-year="' + y.year + '">' + y.year + '</button>';
    }).join('');

    Array.prototype.forEach.call($('yearTabs').querySelectorAll('.year-tab'), function (btn) {
      btn.addEventListener('click', function () {
        state.activeYear = Number(btn.getAttribute('data-year'));
        Array.prototype.forEach.call($('yearTabs').querySelectorAll('.year-tab'), function (b) {
          b.classList.toggle('active', b === btn);
        });
        renderMonthly();
      });
    });
  }

  function renderMonthly() {
    if (!state.monthly) return;
    var yr = state.monthly.years.find(function (y) { return y.year === state.activeYear; });
    if (!yr) return;

    $('monthlyTitle').textContent = 'Monthly contributions · ' + yr.year;
    $('monthlySub').textContent = yr.total > 0
      ? 'Total for ' + yr.year + ': KES ' + fmtMoney(yr.total)
      : 'No contributions recorded for ' + yr.year;
    $('yearTotal').textContent = 'KES ' + fmtMoney(yr.total);

    $('monthGrid').innerHTML = yr.months.map(function (m) {
      var hasAmount = m.amount > 0;
      var tooltip = m.refs.length ? ' title="' + escapeHtml(m.refs.join(', ')) + '"' : '';
      return '<div class="month-cell' + (hasAmount ? ' has-amount' : '') + '"' + tooltip + '>' +
        '<div class="month-label">' + m.label + '</div>' +
        '<div class="month-amount">' + fmtMoneyShort(m.amount) + '</div>' +
      '</div>';
    }).join('');
    renderChart(yr);
  }

  function renderChart(yr) {
    var container = document.getElementById('chartContainer');
    var titleEl = document.getElementById('chartTitle');
    var subEl = document.getElementById('chartSub');
    if (!container || !titleEl || !subEl) return;

    titleEl.textContent = 'Monthly chart · ' + yr.year;
    subEl.textContent = yr.total > 0
      ? 'Total for ' + yr.year + ': KES ' + Number(yr.total).toLocaleString('en-KE')
      : 'No contributions for ' + yr.year;

    var W = 500, H = 220;
    var padLeft = 44, padRight = 20, padTop = 20, padBottom = 40;
    var chartW = W - padLeft - padRight;
    var chartH = H - padTop - padBottom;

    var maxAmount = 0;
    yr.months.forEach(function (m) { if (m.amount > maxAmount) maxAmount = m.amount; });
    if (maxAmount === 0) maxAmount = 1;

    var barGap = 6;
    var barW = (chartW - (barGap * 11)) / 12;

    var bars = '';
    var labels = '';

    yr.months.forEach(function (m, i) {
      var x = padLeft + i * (barW + barGap);
      var barH = m.amount > 0 ? (m.amount / maxAmount) * chartH : 2;
      var y = padTop + chartH - barH;
      var fill = m.amount > 0 ? '#F5B301' : '#E5E3DF';

      bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" ' +
              'width="' + barW.toFixed(1) + '" height="' + barH.toFixed(1) + '" ' +
              'fill="' + fill + '" rx="2">' +
              '<title>' + m.label + ': KES ' + Number(m.amount).toLocaleString('en-KE') + '</title>' +
              '</rect>';

      if (m.amount > 0) {
        bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" ' +
                'text-anchor="middle" font-size="9" fill="#4A5568" font-family="ui-monospace,monospace">' +
                fmtMoneyShort(m.amount) + '</text>';
      }

      labels += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (padTop + chartH + 16) + '" ' +
                'text-anchor="middle" font-size="9" fill="#718096">' + m.label + '</text>';
    });

    var yLabel = '<text x="' + (padLeft - 6) + '" y="' + (padTop + 8) + '" ' +
                 'text-anchor="end" font-size="9" fill="#718096" font-family="ui-monospace,monospace">' +
                 fmtMoneyShort(maxAmount) + '</text>';

    var baseline = '<line x1="' + padLeft + '" y1="' + (padTop + chartH) +
                   '" x2="' + (W - padRight) + '" y2="' + (padTop + chartH) +
                   '" stroke="#E5E3DF" stroke-width="1"/>';

    container.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" ' +
      'style="width:100%;height:auto;display:block" ' +
      'preserveAspectRatio="xMidYMid meet" ' +
      'role="img" aria-label="Monthly contributions chart for ' + yr.year + '">' +
      baseline + yLabel + bars + labels +
      '</svg>';
  }


  async function load() {
    try {
      var results = await Promise.all([
        fetch('/api/me/savings', { credentials: 'same-origin' }),
        fetch('/api/me/savings/monthly', { credentials: 'same-origin' }),
      ]);
      if (results[0].status === 401) { window.location.replace('/'); return; }
      var data = await results[0].json();
      var monthly = await results[1].json();

      if (!data.account) { $('noAccount').hidden = false; return; }

      $('accountSection').hidden = false;
      var a = data.account;
      $('acctSub').textContent = 'Account ' + a.account_number + ' · Opened ' + new Date(a.opened_at).toLocaleDateString('en-GB');

      state.monthly = monthly;
      var currentYear = new Date().getFullYear();
      var currentYearTotal = 0;
      if (monthly.years) {
        var cy = monthly.years.find(function (y) { return y.year === currentYear; });
        if (cy) currentYearTotal = cy.total;
      }

      $('grandTotal').textContent = fmtMoney(monthly.grand_total || 0);
      $('thisYearTotal').textContent = 'KES ' + fmtMoney(currentYearTotal);
      $('currentBalance').textContent = 'KES ' + fmtMoney(a.balance);

      if (monthly.last_contribution) {
        $('lastContrib').textContent = 'Last contribution: KES ' +
          fmtMoney(monthly.last_contribution.amount) + ' on ' +
          fmtDateTime(monthly.last_contribution.date);
      } else {
        $('lastContrib').textContent = 'No contributions yet';
      }

      state.activeYear = (monthly.years && monthly.years.length) ? monthly.years[0].year : currentYear;
      renderYearTabs(monthly.years || []);
      renderMonthly();

      var txns = data.transactions || [];
      $('txCount').textContent = txns.length + ' transaction' + (txns.length === 1 ? '' : 's');

      if (!txns.length) {
        $('txBody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-500);padding:32px">No activity yet</td></tr>';
      } else {
        $('txBody').innerHTML = txns.map(function (t) {
          var isCredit = (t.type === 'deposit' || t.type === 'interest' || t.type === 'adjustment');
          var sign = isCredit ? '+' : '−';
          var cls = isCredit ? 'var(--pos)' : (t.type === 'withdrawal' ? 'var(--neg)' : 'var(--ink-700)');
          return '<tr>' +
            '<td>' + fmtDateTime(t.created_at) + '</td>' +
            '<td>' + typeLabel(t.type) + '</td>' +
            '<td class="num" style="color:' + cls + '">' + sign + fmtMoney(t.amount) + '</td>' +
            '<td class="num">' + fmtMoney(t.balance_after) + '</td>' +
            '<td class="muted">' + escapeHtml(t.mpesa_receipt || t.reference || '—') + '</td>' +
          '</tr>';
        }).join('');
      }
    } catch (e) {
      console.error(e);
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
      load();
    } catch (e) { window.location.replace('/'); }
  })();
})();
