/* Zaria — Client profile page */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showAlert(kind, message) {
    var el = $('alert');
    if (!el) return;
    el.className = 'alert alert-' + kind;
    el.textContent = message;
    el.hidden = false;
    setTimeout(function () { el.hidden = true; }, 6000);
  }

  // ---------------------------------------------------------------
  // Change password
  // ---------------------------------------------------------------
  function wirePasswordForm() {
    var form = $('passwordForm');
    if (!form) return;

    var btn = $('submitBtn');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

      var body = {
        current_password: $('current_password').value,
        new_password: $('new_password').value,
        confirm_password: $('confirm_password').value,
      };

      try {
        var res = await fetch('/api/me/password', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        var data = await res.json();

        if (!res.ok) {
          var msg = data.error || 'Could not change password';
          if (data.details && data.details.length) {
            msg = data.details[0].message || msg;
          }
          showAlert('error', msg);
          return;
        }

        showAlert('success', 'Password changed.');
        form.reset();
      } catch (err) {
        showAlert('error', 'Network error. Please try again.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Change password'; }
      }
    });
  }

  // ---------------------------------------------------------------
  // Avatar / logout (matches other client pages)
  // ---------------------------------------------------------------
  function wireAvatar() {
    var av = $('avatarBtn');
    if (!av) return;
    fetch('/api/me', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.user && d.user.email) {
          av.textContent = d.user.email.charAt(0).toUpperCase();
        }
      })
      .catch(function () {});

    av.addEventListener('click', async function () {
      if (!confirm('Sign out of Zaria?')) return;
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.replace('/');
    });
  }

  // ---------------------------------------------------------------
  // Sidebar toggle (matches other client pages)
  // ---------------------------------------------------------------
  function wireSidebar() {
    var menuBtn = $('menuBtn');
    var sidebar = $('sidebar');
    var backdrop = $('sidebarBackdrop');
    if (!menuBtn || !sidebar) return;

    function open() { sidebar.classList.add('open'); if (backdrop) backdrop.hidden = false; }
    function close() { sidebar.classList.remove('open'); if (backdrop) backdrop.hidden = true; }

    menuBtn.addEventListener('click', function () {
      if (sidebar.classList.contains('open')) close(); else open();
    });
    if (backdrop) backdrop.addEventListener('click', close);
    sidebar.querySelectorAll('.nav-item').forEach(function (el) {
      el.addEventListener('click', function () {
        if (window.matchMedia('(max-width: 1023px)').matches) close();
      });
    });
  }

  // ---------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    wireSidebar();
    wireAvatar();
    wirePasswordForm();
  });
})();
