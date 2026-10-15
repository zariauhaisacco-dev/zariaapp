(function () {
  'use strict';
  (async function () {
    try {
      var res = await fetch('/api/me', { credentials: 'same-origin' });
      if (!res.ok) { window.location.replace('/'); return; }
      var d = await res.json();
      var av = document.getElementById('avatarBtn');
      if (av) {
        av.textContent = d.user.email.charAt(0).toUpperCase();
        av.addEventListener('click', async function () {
          if (!confirm('Sign out?')) return;
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
          window.location.replace('/');
        });
      }
    } catch (e) {
      window.location.replace('/');
    }
  })();
})();
