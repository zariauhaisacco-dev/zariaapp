/* Zaria — Admin shares detail */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var clientId = null;
  var current = null;
  var modalAction = null;

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
      var res = await fetch('/api/admin/shares/holdings/' + clientId, { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      if (res.status === 404) {
        $('holderTitle').textContent = 'Not found';
        $('holderSub').textContent = '';
        return;
      }
      if (!res.ok) throw new Error('load');
      var data = await res.json();
      current = data;
      render(data);
    } catch (e) {
      $('holderSub').textContent = 'Could not load';
    }
  }

  function render(data) {
    var h = data.holding;
    var c = data.config;

    $('holderTitle').textContent = h.full_name;
    $('holderSub').textContent = h.phone + ' · ' + h.email;

    $('statShares').textContent = h.shares_held;
    $('statValue').innerHTML = '<span class="unit">KES</span>' + fmtMoney(h.current_value);
    $('statInvested').innerHTML = '<span class="unit">KES</span>' + fmtMoney(h.total_invested);
    $('statPar').innerHTML = '<span class="unit">KES</span>' + fmtMoney(c.par_value);

    var txns = data.transactions || [];
    $('txSub').textContent = txns.length + ' transaction' + (txns.length === 1 ? '' : 's');

    if (!txns.length) {
      $('txBody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--ink-500);padding:32px">No transactions yet</td></tr>';
    } else {
      $('txBody').innerHTML = txns.map(function (t) {
        var sign = (t.type === 'purchase' || t.type === 'transfer_in' || t.type === 'bonus') ? '+' : '−';
        var cls = sign === '+' ? 'var(--pos)' : 'var(--neg)';
        return '<tr>' +
          '<td>' + fmtDateTime(t.created_at) + '</td>' +
          '<td>' + typeLabel(t.type) + '</td>' +
          '<td class="num" style="color:' + cls + '">' + sign + t.shares + '</td>' +
          '<td class="num">' + fmtMoney(t.price_per_share) + '</td>' +
          '<td class="num">' + fmtMoney(t.total_amount) + '</td>' +
          '<td class="num">' + t.shares_after + '</td>' +
          '<td class="muted">' + escapeHtml(t.payment_source) + '</td>' +
        '</tr>';
      }).join('');
    }
  }

  // ---------------------------------------------------------------
  // Modal handling
  // ---------------------------------------------------------------

  function closeModal() {
    $('actionModal').hidden = true;
    $('modalError').hidden = true;
    modalAction = null;
  }

  function openBuyModal() {
    modalAction = 'buy';
    $('modalTitle').textContent = 'Buy shares';
    $('modalBody').innerHTML = 'Buy shares for <strong>' + escapeHtml(current.holding.full_name) + '</strong> at KES ' + fmtMoney(current.config.par_value) + ' per share.';
    $('modalFields').innerHTML =
      '<div class="field" style="margin-bottom:12px">' +
        '<label for="inpShares">Number of shares</label>' +
        '<input type="number" id="inpShares" min="1" step="1" value="10" style="width:100%;padding:10px 12px;font-size:15px;font-weight:600;border:1px solid var(--line-1);border-radius:6px;font-family:var(--font-mono)">' +
      '</div>' +
      '<div class="field" style="margin-bottom:12px">' +
        '<label for="inpSource">Payment source</label>' +
        '<select id="inpSource" style="width:100%;padding:10px 12px;font-size:14px;border:1px solid var(--line-1);border-radius:6px">' +
          '<option value="cash">Cash (external)</option>' +
          '<option value="savings">Deduct from savings</option>' +
        '</select>' +
      '</div>' +
      '<div class="field" style="margin-bottom:12px">' +
        '<label for="inpRef">Reference (optional)</label>' +
        '<input type="text" id="inpRef" maxlength="100" placeholder="e.g. M-Pesa receipt" style="width:100%;padding:10px 12px;font-size:14px;border:1px solid var(--line-1);border-radius:6px">' +
      '</div>';
    $('modalConfirm').textContent = 'Buy shares';
    $('actionModal').hidden = false;
  }

  function openRedeemModal() {
    modalAction = 'redeem';
    $('modalTitle').textContent = 'Redeem shares';
    $('modalBody').innerHTML = 'Currently holding <strong>' + current.holding.shares_held + ' shares</strong>. Redemption pays out at par (KES ' + fmtMoney(current.config.par_value) + ' per share).';
    $('modalFields').innerHTML =
      '<div class="field" style="margin-bottom:12px">' +
        '<label for="inpShares">Shares to redeem</label>' +
        '<input type="number" id="inpShares" min="1" max="' + current.holding.shares_held + '" step="1" value="' + current.holding.shares_held + '" style="width:100%;padding:10px 12px;font-size:15px;font-weight:600;border:1px solid var(--line-1);border-radius:6px;font-family:var(--font-mono)">' +
      '</div>' +
      '<div class="field" style="margin-bottom:12px">' +
        '<label for="inpRef">Reference (optional)</label>' +
        '<input type="text" id="inpRef" maxlength="100" style="width:100%;padding:10px 12px;font-size:14px;border:1px solid var(--line-1);border-radius:6px">' +
      '</div>';
    $('modalConfirm').textContent = 'Redeem shares';
    $('actionModal').hidden = false;
  }

  function openTransferModal() {
    modalAction = 'transfer';
    $('modalTitle').textContent = 'Transfer shares';
    $('modalBody').innerHTML = 'Transfer shares from <strong>' + escapeHtml(current.holding.full_name) + '</strong> to another client.';
    $('modalFields').innerHTML =
      '<div class="field" style="margin-bottom:12px">' +
        '<label for="inpRecipient">Recipient</label>' +
        '<input type="text" id="inpRecipient" placeholder="Search recipient by name or phone…" style="width:100%;padding:10px 12px;font-size:14px;border:1px solid var(--line-1);border-radius:6px">' +
        '<div id="recipientResults" style="display:none;margin-top:6px;border:1px solid var(--line-1);border-radius:6px;background:#fff;max-height:180px;overflow-y:auto"></div>' +
        '<div id="selectedRecipient" style="display:none;margin-top:8px;padding:10px 12px;background:var(--surface-2);border-radius:6px;font-size:13px"></div>' +
      '</div>' +
      '<div class="field" style="margin-bottom:12px">' +
        '<label for="inpShares">Shares to transfer</label>' +
        '<input type="number" id="inpShares" min="1" max="' + current.holding.shares_held + '" step="1" value="1" style="width:100%;padding:10px 12px;font-size:15px;font-weight:600;border:1px solid var(--line-1);border-radius:6px;font-family:var(--font-mono)">' +
      '</div>' +
      '<div class="field" style="margin-bottom:12px">' +
        '<label for="inpRef">Reference (optional)</label>' +
        '<input type="text" id="inpRef" maxlength="100" style="width:100%;padding:10px 12px;font-size:14px;border:1px solid var(--line-1);border-radius:6px">' +
      '</div>';

    // Wire recipient search
    var searchTimer = null;
    var selectedRecipient = null;
    $('inpRecipient').addEventListener('input', function (e) {
      var q = e.target.value.trim();
      selectedRecipient = null;
      $('selectedRecipient').style.display = 'none';
      clearTimeout(searchTimer);
      if (q.length < 2) { $('recipientResults').style.display = 'none'; return; }
      searchTimer = setTimeout(async function () {
        try {
          var r = await fetch('/api/admin/clients?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
          var d = await r.json();
          var clients = (d.clients || []).filter(function (c) { return String(c.id) !== String(clientId); });
          if (!clients.length) { $('recipientResults').style.display = 'none'; return; }
          $('recipientResults').style.display = 'block';
          $('recipientResults').innerHTML = clients.map(function (c) {
            return '<div data-id="' + c.id + '" data-name="' + escapeHtml(c.full_name) + '" data-phone="' + escapeHtml(c.phone) + '" style="padding:8px 12px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--line-1)">' +
              '<strong>' + escapeHtml(c.full_name) + '</strong> · ' + escapeHtml(c.phone) +
            '</div>';
          }).join('');
          $('recipientResults').querySelectorAll('[data-id]').forEach(function (row) {
            row.addEventListener('click', function () {
              selectedRecipient = { id: row.getAttribute('data-id'), name: row.getAttribute('data-name'), phone: row.getAttribute('data-phone') };
              $('inpRecipient').value = selectedRecipient.name;
              $('recipientResults').style.display = 'none';
              $('selectedRecipient').style.display = 'block';
              $('selectedRecipient').innerHTML = '<strong>' + escapeHtml(selectedRecipient.name) + '</strong> · ' + escapeHtml(selectedRecipient.phone);
            });
          });
        } catch (e) { console.error(e); }
      }, 250);
    });

    $('modalConfirm').textContent = 'Transfer shares';
    $('actionModal').hidden = false;

    // Store the selectedRecipient getter so confirm can read it
    $('actionModal')._getRecipient = function () { return selectedRecipient; };
  }

  $('buyBtn').addEventListener('click', openBuyModal);
  $('redeemBtn').addEventListener('click', openRedeemModal);
  $('transferBtn').addEventListener('click', openTransferModal);
  $('modalCancel').addEventListener('click', closeModal);

  $('modalConfirm').addEventListener('click', async function () {
    var btn = $('modalConfirm');
    btn.disabled = true;
    var originalText = btn.textContent;
    btn.textContent = 'Working…';

    try {
      var body;
      var url;

      if (modalAction === 'buy') {
        var shares = parseInt($('inpShares').value, 10);
        if (!(shares > 0)) throw new Error('Shares must be a positive number');
        url = '/api/admin/shares/buy';
        body = {
          client_id: clientId,
          shares: shares,
          payment_source: $('inpSource').value,
          reference: $('inpRef').value.trim() || null,
        };
      } else if (modalAction === 'redeem') {
        var sharesRedeem = parseInt($('inpShares').value, 10);
        if (!(sharesRedeem > 0)) throw new Error('Shares must be a positive number');
        url = '/api/admin/shares/redeem';
        body = {
          client_id: clientId,
          shares: sharesRedeem,
          reference: $('inpRef').value.trim() || null,
        };
      } else if (modalAction === 'transfer') {
        var recipient = $('actionModal')._getRecipient();
        if (!recipient) throw new Error('Select a recipient');
        var sharesTransfer = parseInt($('inpShares').value, 10);
        if (!(sharesTransfer > 0)) throw new Error('Shares must be a positive number');
        url = '/api/admin/shares/transfer';
        body = {
          from_client_id: clientId,
          to_client_id: recipient.id,
          shares: sharesTransfer,
          reference: $('inpRef').value.trim() || null,
        };
      }

      var res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      var data = await res.json();
      if (!res.ok) {
        var errEl = $('modalError');
        errEl.textContent = data.error || 'Action failed';
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = originalText;
        return;
      }
      closeModal();
      await load();
    } catch (e) {
      var errEl = $('modalError');
      errEl.textContent = e.message || 'Error';
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // Chrome
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
      if (d.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }
      $('avatarBtn').textContent = d.user.email.charAt(0).toUpperCase();

      var m = window.location.pathname.match(/\/admin\/shares\/(\d+)/);
      if (!m) { window.location.replace('/admin/shares'); return; }
      clientId = m[1];
      // Wire certificate button
      setTimeout(function () {
        var certBtn = $('certBtn');
        if (certBtn) certBtn.href = '/api/certificate/' + clientId;
      }, 100);

      load();
    } catch (e) { window.location.replace('/'); }
  })();
})();
