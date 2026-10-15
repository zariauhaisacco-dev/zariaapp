/* Zaria — Admin settings */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function loadProducts() {
    try {
      var res = await fetch('/api/admin/settings/products', { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      if (!res.ok) throw new Error('load');
      var data = await res.json();
      renderProducts(data.products || []);
    } catch (e) {
      $('productsWrap').innerHTML = '<div class="empty" style="padding:32px;color:var(--neg)">Could not load</div>';
    }
  }

  function renderProducts(products) {
    if (!products.length) {
      $('productsWrap').innerHTML = '<div class="empty" style="padding:32px">No products</div>';
      return;
    }
    var header = '<div class="setting-row header"><div>Product</div><div>Min (KES)</div><div>Max (KES)</div><div>Rate % / Term</div><div></div></div>';
    var rows = products.map(function (p) {
      var ratePct = (Number(p.interest_rate) * 100).toFixed(1);
      return '<div class="setting-row" data-product-id="' + p.id + '">' +
        '<div><strong>' + escapeHtml(p.name) + '</strong></div>' +
        '<div><input type="number" data-field="min_amount" value="' + p.min_amount + '" min="1" step="100"></div>' +
        '<div><input type="number" data-field="max_amount" value="' + p.max_amount + '" min="1" step="100"></div>' +
        '<div style="display:flex;gap:6px">' +
          '<input type="number" data-field="interest_rate" value="' + ratePct + '" min="0" max="99" step="0.1" style="max-width:70px">' +
          '<input type="number" data-field="term_months" value="' + p.term_months + '" min="1" max="24" style="max-width:60px">' +
        '</div>' +
        '<div style="text-align:right"><button type="button" class="btn-sm btn-dark" data-action="save">Save</button></div>' +
      '</div>';
    }).join('');
    $('productsWrap').innerHTML = header + rows;

    $('productsWrap').querySelectorAll('[data-action="save"]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var row = btn.closest('[data-product-id]');
        var id = row.getAttribute('data-product-id');
        var min = parseFloat(row.querySelector('[data-field="min_amount"]').value);
        var max = parseFloat(row.querySelector('[data-field="max_amount"]').value);
        var ratePct = parseFloat(row.querySelector('[data-field="interest_rate"]').value);
        var term = parseInt(row.querySelector('[data-field="term_months"]').value, 10);
        if (!(min > 0 && max > 0 && min <= max)) { alert('Invalid amounts'); return; }
        if (!(ratePct >= 0 && ratePct < 100)) { alert('Invalid rate'); return; }
        if (!(term >= 1 && term <= 24)) { alert('Invalid term'); return; }
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          var res = await fetch('/api/admin/settings/products/' + id, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ min_amount: min, max_amount: max, interest_rate: ratePct / 100, term_months: term }),
          });
          var body = await res.json().catch(function () { return {}; });
          if (!res.ok) { alert(body.error || 'Failed'); btn.disabled = false; btn.textContent = 'Save'; return; }
          btn.textContent = 'Saved';
          setTimeout(function () { btn.disabled = false; btn.textContent = 'Save'; }, 1500);
        } catch (e) { alert('Network error'); btn.disabled = false; btn.textContent = 'Save'; }
      });
    });
  }

  async function loadSystem() {
    try {
      var res = await fetch('/api/admin/settings/system', { credentials: 'same-origin' });
      var data = await res.json();
      var f = data.features || {};
      var chips = '';
      chips += '<span class="feature-chip ' + (f.push ? 'on' : 'off') + '">Push notifications ' + (f.push ? 'enabled' : 'disabled') + '</span>';
      chips += '<span class="feature-chip ' + (f.smtp ? 'on' : 'off') + '">Email/SMTP ' + (f.smtp ? 'configured' : 'not configured') + '</span>';
      chips += '<span class="feature-chip ' + (f.daraja ? 'on' : 'off') + '">Daraja (M-Pesa) ' + (f.daraja ? 'configured' : 'not configured') + '</span>';
      chips += '<span class="feature-chip ' + (f.sms ? 'on' : 'off') + '">SMS ' + (f.sms ? 'configured' : 'not configured') + '</span>';
      $('featuresWrap').innerHTML = chips;

      var c = data.counts || {};
      var d = data.db || {};
      var a = data.app || {};
      var rows = [
        ['Application', a.name + ' v' + a.version],
        ['Environment', a.env],
        ['Users (all)', c.users],
        ['Clients', c.clients],
        ['Loans', c.loans],
        ['Transactions', c.transactions],
        ['Audit events', c.audit_events],
        ['Push subscriptions', c.push_subscriptions],
        ['Active sessions', c.active_sessions],
        ['Migrations applied', c.migrations],
        ['Database size', d.size_mb + ' MB'],
      ];
      $('systemWrap').innerHTML = rows.map(function (r) {
        return '<div class="system-item"><span class="system-label">' + escapeHtml(r[0]) + '</span><span class="system-value">' + escapeHtml(r[1]) + '</span></div>';
      }).join('');
    } catch (e) {
      $('systemWrap').innerHTML = '<div class="empty" style="padding:32px;color:var(--neg)">Could not load</div>';
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
      if (d.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }
      $('avatarBtn').textContent = d.user.email.charAt(0).toUpperCase();
      loadProducts();
      loadSystem();
    } catch (e) { window.location.replace('/'); }
  })();

  // ===============================================================
  // Loan eligibility settings
  // ===============================================================

  async function loadEligibility() {
    try {
      var res = await fetch('/api/admin/settings/eligibility', { credentials: 'same-origin' });
      if (!res.ok) return;
      var data = await res.json();
      if (data.loan_multiplier != null) $('loanMultiplier').value = data.loan_multiplier;
      if (data.min_savings_ratio != null) $('minSavingsRatio').value = data.min_savings_ratio;
      $('requireSavings').value = data.require_savings_for_loan ? '1' : '0';
    } catch (e) { console.error(e); }
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadEligibility();
  });

  // Since DOMContentLoaded may have already fired, also try immediately
  setTimeout(loadEligibility, 300);

  if ($('saveEligibility')) {
    $('saveEligibility').addEventListener('click', async function () {
      var body = {
        loan_multiplier: parseFloat($('loanMultiplier').value),
        min_savings_ratio: parseFloat($('minSavingsRatio').value),
        require_savings_for_loan: $('requireSavings').value === '1',
      };
      if (!(body.loan_multiplier > 0)) { alert('Multiplier must be positive'); return; }
      if (!(body.min_savings_ratio >= 0 && body.min_savings_ratio <= 1)) { alert('Ratio must be 0-1'); return; }

      var btn = $('saveEligibility');
      btn.disabled = true; btn.textContent = 'Saving…';

      try {
        var res = await fetch('/api/admin/settings/eligibility', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        var data = await res.json();
        if (!res.ok) { alert(data.error || 'Failed'); return; }
        var s = $('eligibilityStatus');
        s.style.display = 'inline';
        setTimeout(function () { s.style.display = 'none'; }, 2000);
      } catch (e) { alert('Network error'); }
      finally { btn.disabled = false; btn.textContent = 'Save rules'; }
    });
  }

})();
