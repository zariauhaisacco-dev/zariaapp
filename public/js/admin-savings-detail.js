(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var accountId = null;
  var account = null;
  var action = null;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) { n = Number(n) || 0; return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDateTime(iso) { if (!iso) return '—'; var d = new Date(iso); return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function typeLabel(t) { return { deposit: 'Deposit', withdrawal: 'Withdrawal', interest: 'Interest', fee: 'Fee', adjustment: 'Adjustment' }[t] || t; }

  async function load() {
    try {
      var res = await fetch('/api/admin/savings/accounts/' + accountId, { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      if (!res.ok) { $('acctSub').textContent = 'Not found'; return; }
      var data = await res.json();
      account = data.account;
      render(data);
    } catch (e) { console.error(e); }
  }

  function render(data) {
    var a = data.account;
    $('acctTitle').textContent = a.account_number;
    $('acctSub').textContent = a.full_name + ' · ' + a.phone;

    $('statBalance').innerHTML = '<span class="unit">KES</span>' + fmtMoney(a.balance);
    $('statDeposited').innerHTML = '<span class="unit">KES</span>' + fmtMoney(a.total_deposited);
    $('statWithdrawn').innerHTML = '<span class="unit">KES</span>' + fmtMoney(a.total_withdrawn);
    $('statInterest').innerHTML = '<span class="unit">KES</span>' + fmtMoney(a.total_interest_earned);

    var txns = data.transactions || [];
    $('txSub').textContent = txns.length + ' transactions';

    if (!txns.length) {
      $('txBody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-500);padding:32px">No transactions</td></tr>';
    } else {
      $('txBody').innerHTML = txns.map(function (t) {
        var sign = (t.type === 'deposit' || t.type === 'interest') ? '+' : '−';
        var cls = t.type === 'deposit' || t.type === 'interest' ? 'var(--pos)' : 'var(--neg)';
        return '<tr>' +
          '<td>' + fmtDateTime(t.created_at) + '</td>' +
          '<td>' + typeLabel(t.type) + '</td>' +
          '<td class="num" style="color:' + cls + '">' + sign + fmtMoney(t.amount) + '</td>' +
          '<td class="num">' + fmtMoney(t.balance_after) + '</td>' +
          '<td class="muted">' + escapeHtml(t.mpesa_receipt || t.reference || '—') + '</td>' +
        '</tr>';
      }).join('');
    }
  }

  function openModal(act) {
    action = act;
    $('modalTitle').textContent = act === 'deposit' ? 'Record deposit' : 'Record withdrawal';
    $('modalBody').textContent = act === 'deposit'
      ? 'Enter the amount received and select the channel.'
      : 'Current balance: KES ' + fmtMoney(account.balance);
    $('amt').value = '';
    $('ref').value = '';
    $('actionModal').hidden = false;
  }

  $('depositBtn').addEventListener('click', function () { openModal('deposit'); });
  $('withdrawBtn').addEventListener('click', function () { openModal('withdraw'); });
  $('modalCancel').addEventListener('click', function () { $('actionModal').hidden = true; });

  $('modalConfirm').addEventListener('click', async function () {
    var amt = parseFloat($('amt').value);
    if (!(amt > 0)) { alert('Enter a valid amount'); return; }
    var btn = $('modalConfirm'); btn.disabled = true; btn.textContent = 'Working…';
    try {
      var url = '/api/admin/savings/accounts/' + accountId + '/' + action;
      var body = { amount: amt, channel: $('chan').value, reference: $('ref').value.trim() || null };
      var res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var data = await res.json();
      if (!res.ok) { alert(data.error || 'Failed'); btn.disabled = false; btn.textContent = 'Confirm'; return; }
      $('actionModal').hidden = true;
      load();
    } catch (e) { alert('Network error'); }
    finally { btn.disabled = false; btn.textContent = 'Confirm'; }
  });

  (function wireChrome() {
    var av = $('avatarBtn');
    var menuBtn = $('menuBtn');
    var sidebar = $('sidebar');
    var backdrop = $('sidebarBackdrop');
    function closeDrawer() { if (sidebar) sidebar.classList.remove('open'); if (backdrop) backdrop.classList.remove('open'); }
    if (menuBtn) menuBtn.addEventListener('click', function () { sidebar.classList.toggle('open'); if (backdrop) backdrop.classList.toggle('open'); });
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
      if (d.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }
      $('avatarBtn').textContent = d.user.email.charAt(0).toUpperCase();
      var m = window.location.pathname.match(/\/admin\/savings\/(\d+)/);
      if (!m) { window.location.replace('/admin/savings'); return; }
      accountId = m[1];
      load();
    } catch (e) { window.location.replace('/'); }
  })();
})();
