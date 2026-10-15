/* Zaria — Signup page */
(function () {
  'use strict';

  var form = document.getElementById('signupForm');
  var errorBox = document.getElementById('formError');
  var submitBtn = document.getElementById('submitBtn');
  var submitLabel = submitBtn.querySelector('.btn-label');
  var submitSpinner = submitBtn.querySelector('.btn-spinner');

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
      purpose: (fd.get('purpose') || '').toString().trim(),
      heard_about: (fd.get('heard_about') || '').toString(),
      website: (fd.get('website') || '').toString()
    };

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
