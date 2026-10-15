/* Zaria — Password reset */
(function () {
  'use strict';

  var form = document.getElementById('resetForm');
  var errorBox = document.getElementById('formError');
  var submitBtn = document.getElementById('submitBtn');
  var submitLabel = submitBtn.querySelector('.btn-label');
  var submitSpinner = submitBtn.querySelector('.btn-spinner');

  var params = new URLSearchParams(window.location.search);
  var token = params.get('token');

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }
  function clearError() {
    errorBox.hidden = true;
  }
  function setLoading(b) {
    submitBtn.disabled = b;
    submitLabel.hidden = b;
    submitSpinner.hidden = !b;
  }

  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    showError('This reset link is invalid. Please request a new one from the sign-in page.');
    submitBtn.disabled = true;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();

    var password = document.getElementById('password').value;
    var confirm = document.getElementById('confirm').value;

    if (!password || password.length < 8) {
      showError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      showError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      var res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token: token, password: password }),
      });
      var data = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        showError(data.error || 'Could not reset password.');
        setLoading(false);
        return;
      }

      form.hidden = true;
      document.getElementById('successWrap').hidden = false;
    } catch (err) {
      showError('Network error. Please try again.');
      setLoading(false);
    }
  });
})();
