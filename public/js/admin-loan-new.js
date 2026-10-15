/* Zaria — Admin new loan form */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var state = { clients: [], products: [], selectedClient: null, selectedProduct: null };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function addMonths(date, months) {
    var d = new Date(date.getTime());
    d.setMonth(d.getMonth() + months);
    return d;
  }
  function fmtDate(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function showError(msg) {
    var e = $('formError');
    e.textContent = msg;
    e.hidden = false;
  }
  function clearError() {
    $('formError').hidden = true;
    $('formError').textContent = '';
  }

  // ---------------------------------------------------------------
  // Client picker
  // ---------------------------------------------------------------

  async function loadClients(q) {
    try {
      var res = await fetch('/api/admin/clients' + (q ? '?q=' + encodeURIComponent(q) : ''), { credentials: 'same-origin' });
      if (!res.ok) return;
      var data = await res.json();
      state.clients = data.clients || [];
      renderClientResults();
    } catch (e) { console.error(e); }
  }

  function renderClientResults() {
    var box = $('clientResults');
    if (!state.clients.length) {
      box.style.display = 'block';
      box.innerHTML = '<div style="padding:10px 12px;font-size:13px;color:var(--ink-500)">No clients match</div>';
      return;
    }
    box.style.display = 'block';
    box.innerHTML = state.clients.map(function (c) {
      var badge = c.active_loans > 0 ? ' <span class="pill neg" style="margin-left:6px">Has active loan</span>' : '';
      return '<div data-client-id="' + c.id + '" style="padding:10px 12px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--line-1)">' +
        '<strong>' + escapeHtml(c.full_name) + '</strong>' + badge +
        '<div style="color:var(--ink-500);font-size:12px;margin-top:2px">' + escapeHtml(c.phone) + '</div>' +
      '</div>';
    }).join('');

    box.querySelectorAll('[data-client-id]').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-client-id');
        state.selectedClient = state.clients.find(function (c) { return String(c.id) === id; });
        showSelectedClient();
        box.style.display = 'none';
        $('clientSearch').value = state.selectedClient.full_name;
      });
    });
  }

  function showSelectedClient() {
    var el = $('selectedClient');
    var c = state.selectedClient;
    if (!c) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = '<strong>' + escapeHtml(c.full_name) + '</strong> · ' + escapeHtml(c.phone) +
      ' · ID ' + escapeHtml(c.national_id || '—') +
      (c.active_loans > 0 ? ' <span style="color:var(--neg);font-weight:600">· Already has ' + c.active_loans + ' active loan</span>' : '');
  }

  var searchTimer = null;
  $('clientSearch').addEventListener('input', function (e) {
    var q = e.target.value.trim();
    state.selectedClient = null;
    $('selectedClient').style.display = 'none';
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { loadClients(q); }, 200);
  });
  $('clientSearch').addEventListener('focus', function () {
    if (state.clients.length) renderClientResults();
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#clientSearch') && !e.target.closest('#clientResults')) {
      $('clientResults').style.display = 'none';
    }
  });

  // ---------------------------------------------------------------
  // Product picker
  // ---------------------------------------------------------------

  async function loadProducts() {
    try {
      var res = await fetch('/api/admin/loan-products', { credentials: 'same-origin' });
      if (!res.ok) return;
      var data = await res.json();
      state.products = data.products || [];
      var sel = $('productPicker');
      sel.innerHTML = '<option value="">Select a product…</option>' +
        state.products.map(function (p) {
          return '<option value="' + p.id + '">' + escapeHtml(p.name) +
            ' — KES ' + Number(p.min_amount).toLocaleString() + '–' + Number(p.max_amount).toLocaleString() +
            ' · ' + (Number(p.interest_rate) * 100).toFixed(1) + '% · ' + p.term_months + ' mo</option>';
        }).join('');
    } catch (e) { console.error(e); }
  }

  $('productPicker').addEventListener('change', function (e) {
    var id = e.target.value;
    state.selectedProduct = state.products.find(function (p) { return String(p.id) === id; }) || null;
    if (state.selectedProduct) {
      var p = state.selectedProduct;
      $('amountInput').min = p.min_amount;
      $('amountInput').max = p.max_amount;
      $('amountInput').value = p.min_amount;
      $('rateInput').value = (Number(p.interest_rate) * 100).toFixed(1);
      $('termInput').value = p.term_months;
      $('productHint').textContent = 'Range: KES ' + Number(p.min_amount).toLocaleString() + ' – ' + Number(p.max_amount).toLocaleString() +
        ' · Term locked to ' + p.term_months + ' month(s) · Rate ' + (Number(p.interest_rate) * 100).toFixed(1) + '%';
    } else {
      $('productHint').textContent = '';
      $('amountInput').value = '';
      $('rateInput').value = '';
      $('termInput').value = '';
    }
    updatePreview();
  });

  // ---------------------------------------------------------------
  // Live preview
  // ---------------------------------------------------------------

  function updatePreview() {
    var principal = parseFloat($('amountInput').value) || 0;
    var ratePct = parseFloat($('rateInput').value) || 0;
    var term = parseInt($('termInput').value, 10) || 0;

    if (!principal || !term) {
      $('pvPrincipal').textContent = '—';
      $('pvInterest').textContent = '—';
      $('pvTotal').textContent = '—';
      $('pvInstallment').textContent = '—';
      $('pvFirstDue').textContent = '—';
      return;
    }

    var rate = ratePct / 100;
    var interest = Math.round(principal * rate * 100) / 100;
    var total = Math.round((principal + interest) * 100) / 100;
    var installment = Math.round((total / term) * 100) / 100;
    var firstDue = addMonths(new Date(), 1);

    $('pvPrincipal').textContent = 'KES ' + fmtMoney(principal);
    $('pvInterest').textContent = 'KES ' + fmtMoney(interest);
    $('pvTotal').textContent = 'KES ' + fmtMoney(total);
    $('pvInstallment').textContent = 'KES ' + fmtMoney(installment);
    $('pvFirstDue').textContent = fmtDate(firstDue);
  }

  ['amountInput', 'rateInput', 'termInput'].forEach(function (id) {
    $(id).addEventListener('input', updatePreview);
  });

  // ---------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------

  $('submitBtn').addEventListener('click', async function () {
    clearError();

    if (!state.selectedClient) { return showError('Please select a client.'); }
    if (state.selectedClient.active_loans > 0) {
      return showError('This client already has an active loan. Repay or cancel it first.');
    }
    if (!state.selectedProduct) { return showError('Please select a loan product.'); }

    var principal = parseFloat($('amountInput').value);
    var ratePct = parseFloat($('rateInput').value);
    var term = parseInt($('termInput').value, 10);

    if (!(principal > 0)) return showError('Enter a valid amount.');
    if (!(ratePct >= 0)) return showError('Enter a valid interest rate.');
    if (!(term >= 1 && term <= 24)) return showError('Term must be 1–24 months.');

    var btn = $('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
      var res = await fetch('/api/admin/loans', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: state.selectedClient.id,
          product_id: state.selectedProduct.id,
          principal: principal,
          interest_rate: ratePct / 100,
          term_months: term,
          purpose: $('purposeInput').value.trim() || null,
        }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        showError(data.error || 'Could not create loan.');
        btn.disabled = false;
        btn.textContent = 'Create loan';
        return;
      }
      window.location.href = '/admin/loans/' + data.loanId;
    } catch (e) {
      showError('Network error. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Create loan';
    }
  });

  // ---------------------------------------------------------------
  // Chrome (avatar + drawer) and bootstrap
  // ---------------------------------------------------------------

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
      await Promise.all([loadClients(''), loadProducts()]);
    } catch (e) {
      window.location.replace('/');
    }
  })();
})();
