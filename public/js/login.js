/* Zaria — login page logic (with admin 2FA support) */
(function () {
  'use strict';

  // ─── Element refs ───────────────────────────────────────
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const errorBox = document.getElementById('formError');
  const submitBtn = document.getElementById('submitBtn');
  const submitLabel = submitBtn ? submitBtn.querySelector('.btn-label') : null;
  const submitSpinner = submitBtn ? submitBtn.querySelector('.btn-spinner') : null;

  // OTP panel refs
  const otpPanel = document.getElementById('otpPanel');
  const otpForm = document.getElementById('otpForm');
  const otpCode = document.getElementById('otpCode');
  const otpError = document.getElementById('otpError');
  const otpMasked = document.getElementById('otpMasked');
  const otpSubmitBtn = document.getElementById('otpSubmitBtn');
  const otpSubmitLabel = otpSubmitBtn ? otpSubmitBtn.querySelector('.btn-label') : null;
  const otpSubmitSpinner = otpSubmitBtn ? otpSubmitBtn.querySelector('.btn-spinner') : null;
  const resendSmsBtn = document.getElementById('resendSmsBtn');
  const resendEmailBtn = document.getElementById('resendEmailBtn');
  const otpCancelBtn = document.getElementById('otpCancelBtn');
  const otpStatus = document.getElementById('otpStatus');

  // State
  let activeChallengeId = null;

  // ─── Helpers ────────────────────────────────────────────
  function showError(msg) {
    if (!errorBox) return;
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }

  function clearError() {
    if (!errorBox) return;
    errorBox.hidden = true;
    errorBox.textContent = '';
    emailInput.removeAttribute('aria-invalid');
    passwordInput.removeAttribute('aria-invalid');
  }

  function setLoading(loading) {
    if (!submitBtn) return;
    submitBtn.disabled = loading;
    if (submitLabel) submitLabel.hidden = loading;
    if (submitSpinner) submitSpinner.hidden = !loading;
  }

  function setOtpLoading(loading) {
    if (!otpSubmitBtn) return;
    otpSubmitBtn.disabled = loading;
    if (otpSubmitLabel) otpSubmitLabel.hidden = loading;
    if (otpSubmitSpinner) otpSubmitSpinner.hidden = !loading;
  }

  function showOtpError(msg) {
    if (!otpError) return;
    otpError.textContent = msg;
    otpError.hidden = false;
  }

  function clearOtpError() {
    if (!otpError) return;
    otpError.hidden = true;
    otpError.textContent = '';
  }

  function showOtpStatus(msg, isError) {
    if (!otpStatus) return;
    otpStatus.textContent = msg || '';
    otpStatus.style.color = isError ? 'var(--neg)' : 'var(--ink-500)';
  }

  function focusFirstError() {
    if (!emailInput.value) return emailInput.focus();
    if (!passwordInput.value) return passwordInput.focus();
  }

  // ─── Password show/hide toggle ─────────────────────────
  var toggleBtn = document.getElementById('togglePassword');
  if (toggleBtn && passwordInput) {
    toggleBtn.addEventListener('click', function () {
      var isHidden = passwordInput.type === 'password';
      passwordInput.type = isHidden ? 'text' : 'password';
      toggleBtn.classList.toggle('revealed', isHidden);
      toggleBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
      passwordInput.focus();
    });
  }

  // Force-clear password on navigation
  var forceClearPassword = function () {
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.type = 'password';
    }
  };
  window.addEventListener('pageshow', forceClearPassword);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && document.activeElement !== passwordInput) {
      forceClearPassword();
    }
  });

  // ─── Show/hide panels ─────────────────────────────────
  function showOtpPanel(masked, sentTo, challengeId, emailMasked) {
    activeChallengeId = challengeId;
    if (otpMasked) otpMasked.textContent = masked || '';
    if (resendEmailBtn) {
      // If SMS primary, email fallback available. Show email fallback button.
      resendEmailBtn.style.display = sentTo === 'email' ? 'none' : 'inline';
    }
    if (resendSmsBtn) {
      // If email primary, allow SMS resend too (though normally SMS first)
      resendSmsBtn.style.display = sentTo === 'sms' ? 'inline' : 'none';
    }
    if (form) form.parentElement && form.style && (form.style.display = 'none');
    if (form) form.style.display = 'none';
    if (otpPanel) otpPanel.hidden = false;
    if (otpCode) {
      otpCode.value = '';
      otpCode.focus();
    }
    showOtpStatus(sentTo === 'sms'
      ? 'Code sent via SMS. If not received, click "Send to email".'
      : 'Code sent via email (' + (emailMasked || '') + ').');
  }

  function backToLogin() {
    activeChallengeId = null;
    if (otpPanel) otpPanel.hidden = true;
    if (form) form.style.display = '';
    clearOtpError();
    showOtpStatus('');
    setOtpLoading(false);
    focusFirstError();
  }

  // ─── Login form submit ────────────────────────────────
  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearError();

      const email = emailInput.value.trim();
      const password = passwordInput.value;

      if (!email) {
        emailInput.setAttribute('aria-invalid', 'true');
        showError('Please enter your email.');
        return focusFirstError();
      }
      if (!password) {
        passwordInput.setAttribute('aria-invalid', 'true');
        showError('Please enter your password.');
        return focusFirstError();
      }

      setLoading(true);

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email, password }),
        });

        let data = {};
        try { data = await res.json(); } catch (_) {}

        if (!res.ok) {
          const msg = data.error || 'Sign in failed. Please try again.';
          showError(msg);
          setLoading(false);
          return;
        }

        // Admin 2FA branch
        if (data.requires2fa) {
          setLoading(false);
          showOtpPanel(data.maskedTo, data.sentTo, data.challengeId, data.emailMasked);
          return;
        }

        // Regular login success
        const target = data.redirect || '/';
        window.location.replace(target);

      } catch (err) {
        if (!navigator.onLine) {
          showError('You are offline. Check your internet connection and try again.');
        } else {
          showError('Could not reach the server. Please try again.');
        }
        setLoading(false);
      }
    });
  }

  // ─── OTP form submit ──────────────────────────────────
  if (otpForm) {
    otpForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearOtpError();

      const code = (otpCode.value || '').trim();
      if (!/^\d{6}$/.test(code)) {
        showOtpError('Enter the 6-digit code from your SMS/email.');
        return;
      }
      if (!activeChallengeId) {
        showOtpError('Session expired. Please log in again.');
        return;
      }

      setOtpLoading(true);

      try {
        const res = await fetch('/api/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ challengeId: activeChallengeId, code: code }),
        });

        let data = {};
        try { data = await res.json(); } catch (_) {}

        if (!res.ok) {
          showOtpError(data.error || 'Verification failed.');
          setOtpLoading(false);
          return;
        }

        window.location.replace(data.redirect || '/admin/dashboard');

      } catch (err) {
        if (!navigator.onLine) {
          showOtpError('You are offline. Check your connection and try again.');
        } else {
          showOtpError('Could not reach the server. Please try again.');
        }
        setOtpLoading(false);
      }
    });
  }

  // ─── Resend buttons ───────────────────────────────────
  async function resendOtp(channel) {
    if (!activeChallengeId) {
      showOtpError('Session expired. Please log in again.');
      return;
    }
    clearOtpError();
    showOtpStatus('Sending new code…');

    try {
      const res = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ challengeId: activeChallengeId, channel: channel }),
      });

      let data = {};
      try { data = await res.json(); } catch (_) {}

      if (!res.ok) {
        showOtpError(data.error || 'Could not send new code.');
        showOtpStatus('');
        return;
      }

      // New challenge id from server
      activeChallengeId = data.challengeId;
      if (otpMasked) otpMasked.textContent = data.maskedTo || '';
      if (otpCode) { otpCode.value = ''; otpCode.focus(); }
      showOtpStatus(channel === 'sms'
        ? 'New code sent via SMS.'
        : 'New code sent via email.');
    } catch (err) {
      showOtpError('Network error. Please try again.');
      showOtpStatus('');
    }
  }

  if (resendSmsBtn) resendSmsBtn.addEventListener('click', function () { resendOtp('sms'); });
  if (resendEmailBtn) resendEmailBtn.addEventListener('click', function () { resendOtp('email'); });
  if (otpCancelBtn) otpCancelBtn.addEventListener('click', backToLogin);

  // ─── Misc clearing on typing ──────────────────────────
  if (emailInput) emailInput.addEventListener('input', clearError);
  if (passwordInput) passwordInput.addEventListener('input', clearError);
  if (otpCode) otpCode.addEventListener('input', clearOtpError);

  // Handle "check loan status" CTA
  const checkStatusBtn = document.getElementById('checkStatusBtn');
  if (checkStatusBtn) {
    checkStatusBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => emailInput && emailInput.focus(), 250);
    });
  }

  // Handle "Apply" links
  document.querySelectorAll('#applyBtn, #applyLink').forEach(el => {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      alert('Registration portal is coming next. Please call 0746 138 896 to apply.');
    });
  });

  // Autofocus email on desktop
  if (emailInput && window.matchMedia('(min-width: 900px)').matches) {
    emailInput.focus();
  }

})();
