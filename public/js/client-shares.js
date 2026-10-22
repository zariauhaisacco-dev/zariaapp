/* Zaria — Client shares page */
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
    return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function typeLabel(t) {
    return {
      purchase: 'Purchase',
      redemption: 'Redemption',
      transfer_in: 'Transfer in',
      transfer_out: 'Transfer out',
      bonus: 'Bonus'
    }[t] || t;
  }

  async function load() {
    try {
      var res = await fetch('/api/me/shares', { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'load');

      if (!data.has_holding || !data.holding) {
        $('noHolding').hidden = false;
        $('holdingSection').hidden = true;
        return;
      }

      $('noHolding').hidden = true;
      $('holdingSection').hidden = false;

      var h = data.holding;
      var config = data.config;

      var certBtn = $('certBtn');
      if (certBtn && h && h.client_id) certBtn.href = '/api/certificate/' + h.client_id;

      $('currentValue').textContent = fmtMoney(data.current_value);
      $('sharesCount').textContent = h.shares_held;
      $('parValue').textContent = fmtMoney(config.par_value);
      $('totalInvested').textContent = 'KES ' + fmtMoney(h.total_invested);
      $('totalRedeemed').textContent = 'KES ' + fmtMoney(h.total_redeemed_value);

      var txns = data.transactions || [];
      $('txSub').textContent = txns.length + ' transaction' + (txns.length === 1 ? '' : 's');

      if (!txns.length) {
        $('txBody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-500);padding:32px">No transactions yet</td></tr>';
      } else {
        $('txBody').innerHTML = txns.map(function (t) {
          var sign = (t.type === 'purchase' || t.type === 'transfer_in' || t.type === 'bonus') ? '+' : '−';
          var cls = sign === '+' ? 'var(--pos)' : 'var(--neg)';
          return '<tr>' +
            '<td>' + fmtDateTime(t.created_at) + '</td>' +
            '<td>' + typeLabel(t.type) + '</td>' +
            '<td class="num" style="color:' + cls + '">' + sign + t.shares + '</td>' +
            '<td class="num">' + fmtMoney(t.total_amount) + '</td>' +
            '<td class="num">' + t.shares_after + '</td>' +
          '</tr>';
        }).join('');
      }
    } catch (e) {
      console.error(e);
      $('noHolding').hidden = false;
      $('noHolding').querySelector('h3').textContent = 'Could not load shares';
    }
  }

  // Chrome (drawer + avatar)
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

  // Bootstrap
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
