/* Zaria — Admin shares list */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { q: '', selectedClient: null };

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

  async function loadPortfolio() {
    try {
      var res = await fetch('/api/admin/shares/portfolio', { credentials: 'same-origin' });
      if (!res.ok) return;
      var p = await res.json();
      $('statsStrip').style.display = '';
      $('statMembers').textContent = p.members;
      $('statShares').textContent = Number(p.total_shares).toLocaleString();
      $('statCapital').innerHTML = '<span class="unit">KES</span>' + fmtMoney(p.share_capital);
      $('statPar').innerHTML = '<span class="unit">KES</span>' + fmtMoney(p.par_value);
    } catch (e) { console.error(e); }
  }

  async function loadHoldings() {
    var tbody = $('holdingsBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-500);padding:24px">Loading…</td></tr>';

    try {
      var qs = state.q ? '?q=' + encodeURIComponent(state.q) : '';
      var res = await fetch('/api/admin/shares/holdings' + qs, { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'load');
      render(data.holdings || []);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--neg);padding:24px">Could not load</td></tr>';
    }
  }

  function render(holdings) {
    var tbody = $('holdingsBody');
    $('countLabel').textContent = holdings.length + ' shareholder' + (holdings.length === 1 ? '' : 's');

    if (!holdings.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-500);padding:32px">No shareholdings yet</td></tr>';
      return;
    }

    tbody.innerHTML = holdings.map(function (h) {
      return '<tr data-client-id="' + h.client_id + '" style="cursor:pointer">' +
        '<td><span class="name">' + escapeHtml(h.full_name) + '</span><div class="muted">' + escapeHtml(h.phone) + '</div></td>' +
        '<td class="num">' + h.shares_held + '</td>' +
        '<td class="num">' + fmtMoney(h.current_value) + '</td>' +
        '<td class="num">' + fmtMoney(h.total_invested) + '</td>' +
        '<td>' + fmtDate(h.last_transaction_at || h.first_purchase_at) + '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('tr[data-client-id]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        window.location.href = '/admin/shares/' + tr.getAttribute('data-client-id');
      });
    });
  }

  // Search
  var searchTimer = null;
  $('searchInput').addEventListener('input', function (e) {
    state.q = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadHoldings, 250);
  });

  // ===============================================================
  // Buy shares modal
  // ===============================================================

  function openBuyModal() {
    $('buyModal').hidden = false;
    $('buyError').hidden = true;
    $('buyClientSearch').value = '';
    $('buyClientResults').style.display = 'none';
    $('buySelectedClient').style.display = 'none';
    $('buyShares').value = 10;
    $('buySource').value = 'cash';
    state.selectedClient = null;
  }

  $('buyBtn').addEventListener('click', openBuyModal);

  $('buyCancel').addEventListener('click', function () {
    $('buyModal').hidden = true;
  });

  // Client search in buy modal
  var buySearchTimer = null;
  $('buyClientSearch').addEventListener('input', function (e) {
    var q = e.target.value.trim();
    state.selectedClient = null;
    $('buySelectedClient').style.display = 'none';
    clearTimeout(buySearchTimer);
    if (q.length < 2) { $('buyClientResults').style.display = 'none'; return; }
    buySearchTimer = setTimeout(async function () {
      try {
        var res = await fetch('/api/admin/clients?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
        var data = await res.json();
        var clients = data.clients || [];
        var box = $('buyClientResults');
        if (!clients.length) { box.style.display = 'none'; return; }
        box.style.display = 'block';
        box.innerHTML = clients.map(function (c) {
          return '<div data-client-id="' + c.id + '" data-name="' + escapeHtml(c.full_name) + '" data-phone="' + escapeHtml(c.phone) + '" style="padding:10px 12px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--line-1)">' +
            '<strong>' + escapeHtml(c.full_name) + '</strong> · ' + escapeHtml(c.phone) +
          '</div>';
        }).join('');
        box.querySelectorAll('[data-client-id]').forEach(function (row) {
          row.addEventListener('click', function () {
            state.selectedClient = {
              id: row.getAttribute('data-client-id'),
              name: row.getAttribute('data-name'),
              phone: row.getAttribute('data-phone'),
            };
            $('buyClientSearch').value = state.selectedClient.name;
            $('buyClientResults').style.display = 'none';
            $('buySelectedClient').style.display = 'block';
            $('buySelectedClient').innerHTML = '<strong>' + escapeHtml(state.selectedClient.name) + '</strong> · ' + escapeHtml(state.selectedClient.phone);
          });
        });
      } catch (e) { console.error(e); }
    }, 250);
  });

  $('buyConfirm').addEventListener('click', async function () {
    if (!state.selectedClient) { alert('Select a client first'); return; }

    var shares = parseInt($('buyShares').value, 10);
    if (!(shares > 0)) { alert('Shares must be a positive integer'); return; }

    var btn = $('buyConfirm');
    btn.disabled = true; btn.textContent = 'Buying…';

    try {
      var res = await fetch('/api/admin/shares/buy', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: state.selectedClient.id,
          shares: shares,
          payment_source: $('buySource').value,
          reference: 'ADMIN-BUY-' + Date.now(),
        }),
      });
      var body = await res.json();
      if (!res.ok) {
        var errEl = $('buyError');
        errEl.textContent = body.error || 'Purchase failed';
        errEl.hidden = false;
        return;
      }
      $('buyModal').hidden = true;
      await loadHoldings();
      await loadPortfolio();
    } catch (e) {
      var errEl = $('buyError');
      errEl.textContent = 'Network error';
      errEl.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Buy shares';
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

  (async function bootstrap() {
    try {
      var res = await fetch('/api/me', { credentials: 'same-origin' });
      if (!res.ok) { window.location.replace('/'); return; }
      var d = await res.json();
      if (d.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }
      $('avatarBtn').textContent = d.user.email.charAt(0).toUpperCase();
      await Promise.all([loadPortfolio(), loadHoldings()]);
    } catch (e) { window.location.replace('/'); }
  })();
})();
