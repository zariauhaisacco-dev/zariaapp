/* Zaria — login page logic */
(function () {
  'use strict';

  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const errorBox = document.getElementById('formError');
  const submitBtn = document.getElementById('submitBtn');
  const submitLabel = submitBtn.querySelector('.btn-label');
  const submitSpinner = submitBtn.querySelector('.btn-spinner');

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
    emailInput.removeAttribute('aria-invalid');
    passwordInput.removeAttribute('aria-invalid');
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitLabel.hidden = loading;
    submitSpinner.hidden = !loading;
  }

  function focusFirstError() {
    if (!emailInput.value) return emailInput.focus();
    if (!passwordInput.value) return passwordInput.focus();
  }

    // Password show/hide toggle
  var toggleBtn = document.getElementById('togglePassword');
  if (toggleBtn && passwordInput) {
    toggleBtn.addEventListener('click', function () {
      var isHidden = passwordInput.type === 'password';
      passwordInput.type = isHidden ? 'text' : 'password';
      toggleBtn.classList.toggle('revealed', isHidden);
      toggleBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
      // Keep focus on the input so typing continues seamlessly
      passwordInput.focus();
    });
  }

  // Force-clear the password field on load.
  // Browsers sometimes restore a saved password from a previous user on shared devices.
  var forceClearPassword = function () {
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.type = 'password';
    }
  };
  window.addEventListener('pageshow', forceClearPassword);
  // Also clear when page becomes visible after being hidden (iOS)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && document.activeElement !== passwordInput) {
      forceClearPassword();
    }
  });

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
      try { data = await res.json(); } catch (_) { /* ignore */ }

      if (!res.ok) {
        // Generic message from server — but network/offline is different
        const msg = data.error || 'Sign in failed. Please try again.';
        showError(msg);
        setLoading(false);
        return;
      }

      // Success — redirect to role-appropriate dashboard
      const target = data.redirect || '/';
      window.location.replace(target);

    } catch (err) {
      // Network error
      if (!navigator.onLine) {
        showError('You are offline. Check your internet connection and try again.');
      } else {
        showError('Could not reach the server. Please try again.');
      }
      setLoading(false);
    }
  });

  // Clear error when user starts typing
  emailInput.addEventListener('input', clearError);
  passwordInput.addEventListener('input', clearError);

  // Handle "check loan status" CTA — scroll to login form and focus
  const checkStatusBtn = document.getElementById('checkStatusBtn');
  if (checkStatusBtn) {
    checkStatusBtn.addEventListener('click', function (e) {
      e.preventDefault();
      document.getElementById('loginForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => emailInput.focus(), 250);
    });
  }

  // Handle "Apply" links — for now, noop with a friendly alert; real signup page in Phase 2.6
  document.querySelectorAll('#applyBtn, #applyLink').forEach(el => {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      alert('Registration portal is coming next. Please call 0746 138 896 to apply.');
    });
  });

  // Autofocus email on load (only on desktop to avoid keyboard popping on mobile)
  if (window.matchMedia('(min-width: 900px)').matches) {
    emailInput.focus();
  }
})();
