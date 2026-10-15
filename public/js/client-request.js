/* Zaria — Client request a loan */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var state = { products: [], selected: null, blocked: false, blockingReason: '' };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  function showBanner(kind, html) {
    var b = $('statusBanner');
    if (!html) { b.innerHTML = ''; return; }
    b.innerHTML = '<div class="notice ' + (kind || '') + '">' + html + '</div>';
  }

  // Check for active loan or pending request first
  async function checkBlockers() {
    try {
      var res = await fetch('/api/me/summary', { credentials: 'same-origin' });
      if (!res.ok) return;
      var s = await res.json();

      if (s.active_loan) {
        state.blocked = true;
        state.blockingReason = 'active_loan';
        showBanner('error',
          '<strong>You have an active loan.</strong> ' +
          'You must fully repay loan <strong>#' + s.active_loan.id + '</strong> before requesting another. ' +
          '<a href="/client/loans/' + s.active_loan.id + '" style="color:var(--navy-700);text-decoration:underline">View it →</a>');
        $('formArea').style.display = 'none';
        return;
      }
      if (s.pending_request) {
        state.blocked = true;
        state.blockingReason = 'pending_request';
        showBanner('warn',
          '<strong>You already have a pending request</strong> for KES ' +
          Number(s.pending_request.requested_amount).toLocaleString() + '. ' +
          'Please wait for our team to review it.');
        $('formArea').style.display = 'none';
        return;
      }
    } catch (e) { /* ignore */ }
  }

  // Load products and render picker
  
  // Fetch and display savings-based eligibility
  async function loadEligibility() {
    try {
      var res = await fetch('/api/me/savings/eligibility', { credentials: 'same-origin' });
      if (!res.ok) return null;
      var elig = await res.json();

      var banner = document.getElementById('eligibilityBanner');
      if (!banner) return elig;

      if (!elig.settings || !elig.settings.require_savings_for_loan) {
        banner.style.display = 'none';
        return elig;
      }

      if (!elig.has_account) {
        banner.style.display = 'block';
        banner.innerHTML = '<div class="notice error"><strong>No savings account.</strong> You need a savings account before you can apply for a loan. Please contact us on 0746 138 896.</div>';
        // Hide the form since they can't apply
        document.getElementById('formArea').style.display = 'none';
        document.getElementById('productGrid').style.display = 'none';
        return elig;
      }

      banner.style.display = 'block';
      banner.innerHTML = '<div class="notice success"><strong>Your eligibility:</strong> With a savings balance of KES ' + Number(elig.balance).toLocaleString() + ', you can borrow up to <strong>KES ' + Number(elig.max_loan_amount).toLocaleString() + '</strong> (' + elig.settings.loan_multiplier + '× your savings).</div>';

      // Remember max for validation
      window.__maxEligibleLoan = elig.max_loan_amount;
      return elig;
    } catch (e) {
      console.warn('[eligibility]', e);
      return null;
    }
  }

async function loadProducts() {
    var grid = $('productGrid');
    try {
      var res = await fetch('/api/me/loan-products', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('load failed');
      var data = await res.json();
      state.products = data.products || [];

      if (!state.products.length) {
        grid.innerHTML = '<div class="empty" style="grid-column:1/-1">No products available at the moment.</div>';
        return;
      }

      grid.innerHTML = state.products.map(function (p) {
        return '<div class="product-card" data-id="' + p.id + '">' +
          '<h3 class="product-name">' + escapeHtml(p.name) + '</h3>' +
          '<p class="product-range">KES ' + Number(p.min_amount).toLocaleString() + ' – ' + Number(p.max_amount).toLocaleString() + '</p>' +
          '<div class="product-meta">' +
            '<strong>' + (Number(p.interest_rate) * 100).toFixed(1) + '%</strong> flat<br>' +
            '<strong>' + p.term_months + '</strong> month' + (p.term_months === 1 ? '' : 's') +
          '</div>' +
        '</div>';
      }).join('');

      grid.querySelectorAll('.product-card').forEach(function (card) {
        card.addEventListener('click', function () {
          grid.querySelectorAll('.product-card').forEach(function (c) { c.classList.remove('selected'); });
          card.classList.add('selected');
          var id = card.getAttribute('data-id');
          state.selected = state.products.find(function (p) { return String(p.id) === id; });
          onProductSelect();
        });
      });
    } catch (e) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Could not load products.</div>';
    }
  }

  function onProductSelect() {
    if (!state.selected) return;
    var p = state.selected;
    $('formArea').style.display = 'block';
    $('amountInput').min = p.min_amount;
    $('amountInput').max = p.max_amount;
    $('amountInput').value = p.min_amount;
    $('amountHint').textContent = 'Between KES ' + Number(p.min_amount).toLocaleString() +
      ' and KES ' + Number(p.max_amount).toLocaleString();
    $('pvRateLabel').textContent = (Number(p.interest_rate) * 100).toFixed(1);
    updatePreview();
    $('amountInput').focus();
  }

  function updatePreview() {
    if (!state.selected) return;
    var p = state.selected;
    var amount = parseFloat($('amountInput').value) || 0;
    var rate = Number(p.interest_rate);
    var term = p.term_months;

    var interest = Math.round(amount * rate * 100) / 100;
    var total = Math.round((amount + interest) * 100) / 100;
    var installment = Math.round((total / term) * 100) / 100;

    $('pvAmount').textContent = 'KES ' + fmtMoney(amount);
    $('pvInterest').textContent = 'KES ' + fmtMoney(interest);
    $('pvTotal').textContent = 'KES ' + fmtMoney(total);
    $('pvInstallments').textContent = term + ' × KES ' + fmtMoney(installment);
  }

  $('amountInput').addEventListener('input', updatePreview);

  $('submitBtn').addEventListener('click', async function () {
    clearError();
    if (!state.selected) return showError('Pick a product first.');

    var amount = parseFloat($('amountInput').value);
    var p = state.selected;

    if (!(amount >= Number(p.min_amount) && amount <= Number(p.max_amount))) {
      return showError('Amount must be between KES ' + Number(p.min_amount).toLocaleString() +
        ' and KES ' + Number(p.max_amount).toLocaleString());
    }

    var btn = $('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    try {
      var res = await fetch('/api/me/loan-requests', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: p.id,
          requested_amount: amount,
          purpose: $('purposeInput').value.trim() || null,
        }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        showError(data.error || 'Could not submit request.');
        btn.disabled = false;
        btn.textContent = 'Submit request';
        return;
      }
      showBanner('success',
        '<strong>Request submitted.</strong> We received your request for KES ' +
        Number(amount).toLocaleString() + '. Our team will review it and you\'ll be notified.');
      $('formArea').style.display = 'none';
      $('productGrid').style.display = 'none';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      showError('Network error. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Submit request';
    }
  });

  // Drawer + avatar
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
  (async function () {
    try {
      var res = await fetch('/api/me', { credentials: 'same-origin' });
      if (!res.ok) { window.location.replace('/'); return; }
      var d = await res.json();
      if (d.user.role !== 'client') { window.location.replace('/admin/dashboard'); return; }
      $('avatarBtn').textContent = d.user.email.charAt(0).toUpperCase();

      await loadEligibility();
      await checkBlockers();
      if (!state.blocked) await loadProducts();
    } catch (e) {
      window.location.replace('/');
    }
  })();
})();
