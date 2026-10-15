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
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function typeLabel(t) {
    return { deposit: 'Deposit', withdrawal: 'Withdrawal', interest: 'Interest', fee: 'Fee', adjustment: 'Adjustment' }[t] || t;
  }

  async function load() {
    try {
      var res = await fetch('/api/me/savings', { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      var data = await res.json();

      if (!data.account) {
        $('noAccount').hidden = false;
        return;
      }

      $('accountSection').hidden = false;
      var a = data.account;
      $('balAmount').textContent = fmtMoney(a.balance);
      $('acctNumber').textContent = 'Account ' + a.account_number + ' · Opened ' + new Date(a.opened_at).toLocaleDateString('en-GB');
      $('balDeposited').textContent = 'KES ' + fmtMoney(a.total_deposited);
      $('balWithdrawn').textContent = 'KES ' + fmtMoney(a.total_withdrawn);
      $('balInterest').textContent = 'KES ' + fmtMoney(a.total_interest_earned);

      var txns = data.transactions || [];
      $('txCount').textContent = txns.length + ' transaction' + (txns.length === 1 ? '' : 's');

      if (!txns.length) {
        $('txBody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-500);padding:32px">No activity yet</td></tr>';
      } else {
        $('txBody').innerHTML = txns.map(function (t) {
          var sign = (t.type === 'deposit' || t.type === 'interest') ? '+' : '−';
          var cls = t.type === 'deposit' || t.type === 'interest' ? 'var(--pos)' : (t.type === 'withdrawal' ? 'var(--neg)' : 'var(--ink-700)');
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
