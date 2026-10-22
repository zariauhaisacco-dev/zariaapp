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

  // ---------------------------------------------------------------
  // Branding
  // ---------------------------------------------------------------
  async function loadBranding() {
    try {
      var res = await fetch('/api/admin/settings/branding', { credentials: 'same-origin' });
      if (!res.ok) return;
      var b = await res.json();

      $('brandingName').value = b.sacco_name || '';
      $('brandingTagline').value = b.tagline || '';
      $('brandingMission').value = b.mission_short || '';
      $('brandingVision').value = b.vision || '';

      // Colors
      var cp = b.color_primary || '#0B1F3A';
      var ca = b.color_accent || '#F5B301';
      var cb = b.color_background || '#F8F7F5';
      $('colorPrimary').value = cp;
      $('colorPrimaryHex').value = cp;
      $('colorAccent').value = ca;
      $('colorAccentHex').value = ca;
      $('colorBackground').value = cb;
      $('colorBackgroundHex').value = cb;

      // Contact
      $('contactPhone').value = b.contact_phone || '';
      $('contactWhatsapp').value = b.contact_whatsapp || '';
      $('contactEmail').value = b.contact_email || '';
      $('contactLocation').value = b.contact_location || '';
      $('contactHours').value = b.contact_hours || '';

      // Logo preview
      var img = $('logoImg');
      var placeholder = $('logoPlaceholder');
      if (b.logo_url) {
        img.src = '/api/branding/logo?v=' + Date.now();
        img.onload = function () { img.style.display = 'block'; placeholder.style.display = 'none'; };
        img.onerror = function () { img.style.display = 'none'; placeholder.style.display = 'block'; };
        // Show reset button only if NOT the default
        $('resetLogoBtn').style.display = (b.logo_url === 'logo.png') ? 'none' : 'inline-block';
      } else {
        img.style.display = 'none';
        placeholder.style.display = 'block';
        $('resetLogoBtn').style.display = 'none';
      }
    } catch (e) {
      console.error('[branding load]', e.message);
    }
  }

  function wireBranding() {
    var saveBtn = $('saveBranding');
    var chooseBtn = $('chooseLogoBtn');
    var fileInput = $('logoInput');
    var resetBtn = $('resetLogoBtn');

    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        saveBtn.disabled = true;
        var status = $('brandingStatus');
        var body = {
          sacco_name: $('brandingName').value.trim(),
          tagline: $('brandingTagline').value.trim(),
          mission_short: $('brandingMission').value.trim(),
          vision: $('brandingVision').value.trim(),
          color_primary: $('colorPrimaryHex').value.trim(),
          color_accent: $('colorAccentHex').value.trim(),
          color_background: $('colorBackgroundHex').value.trim(),
          contact_phone: $('contactPhone').value.trim(),
          contact_whatsapp: $('contactWhatsapp').value.trim(),
          contact_email: $('contactEmail').value.trim(),
          contact_location: $('contactLocation').value.trim(),
          contact_hours: $('contactHours').value.trim(),
        };
        try {
          var res = await fetch('/api/admin/settings/branding', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          var data = await res.json();
          if (!res.ok) {
            alert(data.error || 'Could not save');
          } else {
            if (status) { status.style.display = 'inline'; setTimeout(function () { status.style.display = 'none'; }, 2000); }
          }
        } catch (e) {
          alert('Network error');
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    if (chooseBtn && fileInput) {
      chooseBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', async function () {
        var f = fileInput.files && fileInput.files[0];
        if (!f) return;
        if (f.size > 2 * 1024 * 1024) { alert('File too large (max 2 MB)'); fileInput.value = ''; return; }
        var fd = new FormData();
        fd.append('photo', f);
        try {
          var res = await fetch('/api/admin/settings/logo', {
            method: 'POST',
            credentials: 'same-origin',
            body: fd,
          });
          var data = await res.json();
          if (!res.ok) { alert(data.error || 'Upload failed'); return; }
          fileInput.value = '';
          await loadBranding();
        } catch (e) {
          alert('Network error');
        }
      });
    }

    // Sync color pickers with hex text inputs
    function wireColorPair(pickerId, hexId) {
      var p = $(pickerId), h = $(hexId);
      if (!p || !h) return;
      p.addEventListener('input', function () { h.value = p.value.toUpperCase(); });
      h.addEventListener('input', function () {
        var v = h.value.trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(v)) p.value = v;
      });
    }
    wireColorPair('colorPrimary', 'colorPrimaryHex');
    wireColorPair('colorAccent', 'colorAccentHex');
    wireColorPair('colorBackground', 'colorBackgroundHex');

    if (resetBtn) {
      resetBtn.addEventListener('click', async function () {
        if (!confirm('Reset logo to the default?')) return;
        try {
          var res = await fetch('/api/admin/settings/logo', {
            method: 'DELETE',
            credentials: 'same-origin',
          });
          var data = await res.json();
          if (!res.ok) { alert(data.error || 'Could not reset'); return; }
          await loadBranding();
        } catch (e) {
          alert('Network error');
        }
      });
    }
  }

  // ---------------------------------------------------------------
  // M-Pesa (Daraja) settings
  // ---------------------------------------------------------------
  async function loadDaraja() {
    try {
      var res = await fetch('/api/admin/settings/daraja', { credentials: 'same-origin' });
      if (!res.ok) return;
      var d = await res.json();

      $('darajaEnv').value = d.env || 'sandbox';
      $('darajaShortcode').value = d.shortcode || '';
      $('darajaConsumerKey').value = d.consumer_key || '';
      $('darajaCallbackUrl').value = d.callback_url || '';

      var secStatus = $('darajaSecretStatus');
      var secMasked = $('darajaSecretMasked');
      if (d.has_consumer_secret) {
        secStatus.textContent = '✅ Set';
        secStatus.style.color = 'var(--pos)';
        secMasked.value = '•••••••••••••••• (encrypted)';
      } else {
        secStatus.textContent = '⚠️ Not set';
        secStatus.style.color = 'var(--neg)';
        secMasked.value = '(no secret configured)';
      }

      var pkStatus = $('darajaPasskeyStatus');
      var pkMasked = $('darajaPasskeyMasked');
      if (d.has_passkey) {
        pkStatus.textContent = '✅ Set';
        pkStatus.style.color = 'var(--pos)';
        pkMasked.value = '•••••••••••••••• (encrypted)';
      } else {
        pkStatus.textContent = '⚠️ Not set';
        pkStatus.style.color = 'var(--neg)';
        pkMasked.value = '(no passkey configured)';
      }

      var b2c = d.b2c || {};
      $('darajaB2cShortcode').value = b2c.shortcode || '';
      $('darajaB2cInitiatorName').value = b2c.initiator_name || '';
      var b2cStatus = $('darajaB2cStatus');
      var b2cMasked = $('darajaB2cMasked');
      if (b2c.has_initiator_pass) {
        b2cStatus.textContent = '✅ Set';
        b2cStatus.style.color = 'var(--pos)';
        b2cMasked.value = '•••••••••••••••• (encrypted)';
      } else {
        b2cStatus.textContent = '⚠️ Not set';
        b2cStatus.style.color = 'var(--ink-500)';
        b2cMasked.value = '(no initiator password configured)';
      }

      var credStatus = $('darajaB2cCredStatus');
      var credMasked = $('darajaB2cCredMasked');
      if (b2c.has_security_credential) {
        credStatus.textContent = '✅ Set';
        credStatus.style.color = 'var(--pos)';
        credMasked.value = '•••••••••••••••• (encrypted)';
      } else {
        credStatus.textContent = '⚠️ Not set';
        credStatus.style.color = 'var(--neg)';
        credMasked.value = '(no SecurityCredential configured)';
      }

      var warn = $('darajaWarn');
      if (!d.encryption_configured) {
        warn.textContent = 'Encryption key is not configured on the server. Saving credentials is disabled.';
        warn.hidden = false;
      } else {
        warn.hidden = true;
      }
    } catch (e) {
      console.error('[daraja load]', e.message);
    }
  }

  function showDarajaStatus(msg, kind) {
    var el = $('darajaStatus');
    el.textContent = msg;
    el.style.display = 'inline';
    el.style.color = kind === 'error' ? 'var(--neg)' : 'var(--pos)';
    setTimeout(function () { el.style.display = 'none'; }, 4000);
  }

  function wireDaraja() {
    function wireChange(btnId, inputId) {
      var btn = $(btnId);
      var input = $(inputId);
      if (!btn || !input) return;
      btn.addEventListener('click', function () {
        input.style.display = input.style.display === 'none' ? 'block' : 'none';
        if (input.style.display === 'block') input.focus();
      });
    }
    wireChange('darajaSecretChangeBtn', 'darajaSecretNew');
    wireChange('darajaPasskeyChangeBtn', 'darajaPasskeyNew');
    wireChange('darajaB2cChangeBtn', 'darajaB2cNew');
    wireChange('darajaB2cCredChangeBtn', 'darajaB2cCredNew');

    var saveBtn = $('darajaSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        saveBtn.disabled = true;
        var body = {
          env: $('darajaEnv').value,
          shortcode: $('darajaShortcode').value.trim(),
          consumer_key: $('darajaConsumerKey').value.trim(),
          consumer_secret: $('darajaSecretNew').value,
          passkey: $('darajaPasskeyNew').value,
          callback_url: $('darajaCallbackUrl').value.trim(),
          b2c_shortcode: $('darajaB2cShortcode').value.trim(),
          b2c_initiator_name: $('darajaB2cInitiatorName').value.trim(),
          b2c_initiator_pass: $('darajaB2cNew').value,
          b2c_security_credential: $('darajaB2cCredNew').value,
        };
        try {
          var res = await fetch('/api/admin/settings/daraja', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          var data = await res.json();
          if (!res.ok) {
            showDarajaStatus(data.error || 'Save failed', 'error');
          } else {
            showDarajaStatus('Saved', 'ok');
            $('darajaSecretNew').value = '';
            $('darajaPasskeyNew').value = '';
            $('darajaB2cNew').value = '';
            $('darajaB2cCredNew').value = '';
            $('darajaSecretNew').style.display = 'none';
            $('darajaPasskeyNew').style.display = 'none';
            $('darajaB2cNew').style.display = 'none';
            $('darajaB2cCredNew').style.display = 'none';
            await loadDaraja();
          }
        } catch (e) {
          showDarajaStatus('Network error', 'error');
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    var testBtn = $('darajaTestBtn');
    if (testBtn) {
      testBtn.addEventListener('click', async function () {
        testBtn.disabled = true;
        testBtn.textContent = 'Testing…';
        try {
          var res = await fetch('/api/admin/settings/daraja/test', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          var data = await res.json();
          if (data.ok) {
            showDarajaStatus('✅ Connection OK', 'ok');
          } else {
            showDarajaStatus('❌ ' + (data.error || 'Failed'), 'error');
          }
        } catch (e) {
          showDarajaStatus('Network error', 'error');
        } finally {
          testBtn.disabled = false;
          testBtn.textContent = '🔌 Test connection';
        }
      });
    }

    var b2cTestBtn = $('darajaB2cTestBtn');
    if (b2cTestBtn) {
      b2cTestBtn.addEventListener('click', async function () {
        b2cTestBtn.disabled = true;
        b2cTestBtn.textContent = 'Testing B2C…';
        try {
          var res = await fetch('/api/admin/settings/daraja/b2c-test', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          var data = await res.json();
          if (data.ok) {
            showDarajaStatus('✅ B2C sent to test MSISDN. Check sandbox simulator.', 'ok');
          } else {
            showDarajaStatus('❌ ' + (data.error || 'Failed'), 'error');
          }
        } catch (e) {
          showDarajaStatus('Network error', 'error');
        } finally {
          b2cTestBtn.disabled = false;
          b2cTestBtn.textContent = '🔌 Test B2C';
        }
      });
    }
  }


  // ---------------------------------------------------------------
  // SMS / Ping Africa settings
  // ---------------------------------------------------------------
  async function loadPingSettings() {
    try {
      const res = await fetch('/api/admin/settings/ping', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();

      var en = $('pingEnabled');
      if (en) en.checked = data.enabled;
      var sid = $('pingSenderId');
      if (sid) sid.value = data.sender_id || '';
      var wa = $('pingWaInstance');
      if (wa) wa.value = data.whatsapp_instance || '';
      var ussd = $('pingUssdCode');
      if (ussd) ussd.value = data.ussd_code || '';
      var lim = $('pingDailyLimit');
      if (lim) lim.value = data.daily_sms_limit || 10;
      var today = $('smsToday');
      if (today) today.textContent = data.sms_today || 0;
      var month = $('smsMonth');
      if (month) month.textContent = data.sms_this_month || 0;

      var cb = $('smsCreditsBadge');
      if (cb) {
        if (data.credits_balance != null) {
          cb.textContent = data.credits_balance.toFixed(1) + ' credits';
          cb.style.color = data.credits_balance < 5 ? 'var(--neg)' : 'var(--ink-700)';
        } else {
          cb.textContent = 'Offline';
          cb.style.color = 'var(--neg)';
        }
      }

      var sb = $('smsStatusBadge');
      if (sb) {
        sb.textContent = data.enabled ? 'active' : 'disabled';
        sb.className = 'pill ' + (data.enabled ? 'pos' : 'neutral');
      }

      var aap = $('adminAlertPhone');
      if (aap) aap.value = data.admin_alert_phone || '';
      var ase = $('adminSmsEnabled');
      if (ase) ase.checked = data.admin_sms_alerts_enabled !== false;
    } catch (e) {
      console.error('[loadPingSettings]', e);
    }
  }

  async function savePingSettings() {
    try {
      const body = {
        enabled: $('pingEnabled').checked,
        sender_id: $('pingSenderId').value.trim() || null,
        whatsapp_instance: $('pingWaInstance').value.trim() || null,
        ussd_code: $('pingUssdCode').value.trim() || null,
        daily_sms_limit: Number($('pingDailyLimit').value) || 10,
        admin_alert_phone: (document.getElementById('adminAlertPhone') ? document.getElementById('adminAlertPhone').value.trim() : '') || null,
        admin_sms_alerts_enabled: document.getElementById('adminSmsEnabled') ? document.getElementById('adminSmsEnabled').checked : true,
      };
      const res = await fetch('/api/admin/settings/ping', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { alert('Save failed'); return; }
      var st = $('pingStatus');
      if (st) { st.style.display = 'inline'; setTimeout(function () { st.style.display = 'none'; }, 2000); }
      loadPingSettings();
    } catch (e) { alert('Network error: ' + e.message); }
  }

  async function sendTestPing() {
    var phone = $('testPingPhone').value.trim();
    if (!phone) return;
    var res_el = $('testPingResult');
    res_el.textContent = 'Sending…';
    res_el.style.color = 'var(--ink-500)';
    try {
      const res = await fetch('/api/admin/settings/ping/test', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        res_el.textContent = '✓ Sent · ' + data.credits + ' credits charged';
        res_el.style.color = 'var(--pos)';
      } else {
        res_el.textContent = '✗ ' + (data.error || 'Failed');
        res_el.style.color = 'var(--neg)';
      }
    } catch (e) {
      res_el.textContent = '✗ ' + e.message;
      res_el.style.color = 'var(--neg)';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    loadBranding();
    wireBranding();
    loadEligibility();

    if (document.getElementById('smsCard')) {
      loadPingSettings();
      document.getElementById('savePingSettings').addEventListener('click', savePingSettings);
      document.getElementById('testPingBtn').addEventListener('click', function () {
        var block = document.getElementById('testPingBlock');
        block.hidden = !block.hidden;
      });
      document.getElementById('sendTestPing').addEventListener('click', sendTestPing);
    }
    loadDaraja();
    wireDaraja();
  });

  // Since DOMContentLoaded may have already fired, also try immediately
  setTimeout(loadEligibility, 300);
  setTimeout(loadBranding, 300);
  setTimeout(loadDaraja, 300);
  setTimeout(wireDaraja, 300);

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


  // ─────────────────────────────────────────────────────────────
  // Two-factor authentication (admin) — added 2026-10-22
  // ─────────────────────────────────────────────────────────────

  async function loadTwoFA() {
    try {
      var res = await fetch('/api/admin/settings/admin-2fa', { credentials: 'same-origin' });
      if (!res.ok) return;
      var data = await res.json();
      var phoneInput = document.getElementById('twofaPhone');
      var enabledBox = document.getElementById('twofaEnabled');
      var status = document.getElementById('twofaStatus');
      if (!phoneInput || !enabledBox) return;

      phoneInput.value = data.phone || '';
      enabledBox.checked = !!data.enabled;
      status.textContent = data.enabled
        ? '2FA is currently ENABLED. You will need an SMS code on next login.'
        : '2FA is currently DISABLED.';
      status.style.color = data.enabled ? 'var(--pos)' : 'var(--ink-500)';
    } catch (e) {
      console.error('[twofa load]', e);
    }
  }

  function wireTwoFA() {
    var saveBtn = document.getElementById('save2fa');
    if (!saveBtn) return;

    saveBtn.addEventListener('click', async function () {
      var phone = (document.getElementById('twofaPhone').value || '').trim();
      var enabled = document.getElementById('twofaEnabled').checked;
      var status = document.getElementById('twofaStatus');

      if (enabled && !phone) {
        status.textContent = 'Enter your phone number to enable 2FA.';
        status.style.color = 'var(--neg)';
        return;
      }
      if (enabled && !/^254[17]\d{8}$/.test(phone)) {
        status.textContent = 'Phone must be 2547XXXXXXXX or 2541XXXXXXXX.';
        status.style.color = 'var(--neg)';
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        var res = await fetch('/api/admin/settings/admin-2fa', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone || null, enabled: enabled }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          status.textContent = data.error || 'Save failed';
          status.style.color = 'var(--neg)';
          return;
        }
        status.textContent = data.message || 'Saved.';
        status.style.color = 'var(--pos)';
        setTimeout(loadTwoFA, 500);
      } catch (e) {
        status.textContent = 'Network error';
        status.style.color = 'var(--neg)';
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save 2FA settings';
      }
    });

    loadTwoFA();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireTwoFA);
  } else {
    wireTwoFA();
  }

})();
