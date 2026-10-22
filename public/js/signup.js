/* Zaria — Signup page */
(function () {
  'use strict';

  var form = document.getElementById('signupForm');
  var errorBox = document.getElementById('formError');
  var submitBtn = document.getElementById('submitBtn');
  var submitLabel = submitBtn.querySelector('.btn-label');
  var submitSpinner = submitBtn.querySelector('.btn-spinner');

  // ---------------------------------------------------------------
  // Load branding (logo + SACCO name from admin settings)
  // ---------------------------------------------------------------
  (function () {
    fetch('/api/branding', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) {
        if (!b) return;
        var nameEl = document.getElementById('brandName');
        if (nameEl && b.sacco_name) {
          nameEl.textContent = b.sacco_name;
          document.title = b.sacco_name + ' · Become a member';
        }
        var logoEl = document.getElementById('brandLogo');
        if (logoEl && b.logo_url) {
          logoEl.src = b.logo_url + '?v=' + Date.now();
          logoEl.alt = b.sacco_name || 'Logo';
        }
      })
      .catch(function () {});
  })();

  // Chama invite banner (if ?chama_invite=<token> present)
  var chamaInviteToken = null;
  (function () {
    var params = new URLSearchParams(window.location.search);
    var token = params.get('chama_invite');
    if (!token) return;
    fetch('/api/chama-invites/' + encodeURIComponent(token) + '/preview')
      .then(function(r){return r.json();})
      .then(function(p){
        if (!p.valid) {
          var map = {not_found:'Invite not found.',expired:'Invite expired.',cancelled:'Invite cancelled.',declined:'Invite declined.',already_used:'Invite already used.',chama_inactive:'Chama inactive.'};
          var errEl = document.getElementById('inviteError');
          if (errEl) { errEl.textContent = map[p.reason] || 'Invite not valid.'; errEl.hidden = false; }
          return;
        }
        chamaInviteToken = token;
        var nameEl = document.getElementById('inviteChamaName');
        var codeEl = document.getElementById('inviteChamaCode');
        var byEl = document.getElementById('inviteByEmail');
        var bannerEl = document.getElementById('inviteBanner');
        var tokEl = document.getElementById('chamaInviteToken');
        if (nameEl) nameEl.textContent = p.chama_name;
        if (codeEl) codeEl.textContent = p.chama_code || '';
        if (byEl) byEl.textContent = p.inviter_email || 'your chama admin';
        if (bannerEl) bannerEl.hidden = false;
        if (tokEl) tokEl.value = token;
      })
      .catch(function(){});
  })();

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }
  function setLoading(b) {
    submitBtn.disabled = b;
    submitLabel.hidden = b;
    submitSpinner.hidden = !b;
  }

  function clientValidate(data) {
    if (!data.full_name || data.full_name.trim().length < 2) return 'Enter your full name.';
    if (!/^\S+@\S+\.\S+$/.test(data.email || '')) return 'Enter a valid email.';
    var digits = (data.phone || '').replace(/\D/g, '');
    var ok = /^(254)?[17]\d{8}$/.test(digits) || /^0[17]\d{8}$/.test(digits);
    if (!ok) return 'Enter a valid Kenyan phone number.';
    if (!/^\d{7,8}$/.test(data.national_id || '')) return 'National ID must be 7 or 8 digits.';
    if (!data.password || data.password.length < 8) return 'Password must be at least 8 characters.';
    if (data.password !== data.confirm_password) return 'Passwords do not match.';
    return null;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();

    var fd = new FormData(form);
    var data = {
      full_name: (fd.get('full_name') || '').toString().trim(),
      email: (fd.get('email') || '').toString().trim(),
      phone: (fd.get('phone') || '').toString().trim(),
      national_id: (fd.get('national_id') || '').toString().trim(),
      password: (fd.get('password') || '').toString(),
      confirm_password: (fd.get('confirm_password') || '').toString(),
      heard_about: (fd.get('heard_about') || '').toString(),
      website: (fd.get('website') || '').toString()
    };
    if (chamaInviteToken) data.chama_invite_token = chamaInviteToken;

    var preErr = clientValidate(data);
    if (preErr) { showError(preErr); return; }

    setLoading(true);

    try {
      var res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(data)
      });

      var body = {};
      try { body = await res.json(); } catch (_) {}

      if (!res.ok) {
        var msg = body.error || 'Could not submit. Please try again.';
        if (Array.isArray(body.details) && body.details.length) {
          msg = body.details.map(function (d) { return d.message; }).join(' · ');
        }
        showError(msg);
        setLoading(false);
        return;
      }

      form.hidden = true;
      document.getElementById('success-wrap').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      showError(!navigator.onLine
        ? 'You are offline. Check your connection and try again.'
        : 'Could not reach the server. Please try again.');
      setLoading(false);
    }
  });
})();
