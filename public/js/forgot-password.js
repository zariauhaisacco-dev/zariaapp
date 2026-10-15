(function () {
  'use strict';
  var form = document.getElementById('forgotForm');
  var errorBox = document.getElementById('formError');
  var submitBtn = document.getElementById('submitBtn');
  var submitLabel = submitBtn.querySelector('.btn-label');
  var submitSpinner = submitBtn.querySelector('.btn-spinner');

  function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; }
  function clearError() { errorBox.hidden = true; }
  function setLoading(b) {
    submitBtn.disabled = b;
    submitLabel.hidden = b;
    submitSpinner.hidden = !b;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();
    var email = document.getElementById('email').value.trim();
    if (!email) { showError('Please enter your email.'); return; }
    setLoading(true);
    try {
      var res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email }),
      });
      // Always show success — never reveal whether the email exists
      form.hidden = true;
      document.getElementById('successWrap').hidden = false;
    } catch (err) {
      showError('Network error. Please try again.');
      setLoading(false);
    }
  });
})();
