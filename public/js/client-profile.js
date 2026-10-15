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
  // Profile photo
  // ---------------------------------------------------------------
  function wirePhotoUpload() {
    var input = $('photoInput');
    var chooseBtn = $('choosePhotoBtn');
    var uploadBtn = $('uploadPhotoBtn');
    var preview = $('photoPreview');
    if (!input || !chooseBtn || !uploadBtn || !preview) return;

    // Load existing photo (if any) on page open
    fetch('/api/me/photo', { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) return;
        preview.innerHTML = '<img alt="Profile photo" src="/api/me/photo?v=' + Date.now() + '">';
      })
      .catch(function () {});

    chooseBtn.addEventListener('click', function () { input.click(); });

    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) { uploadBtn.disabled = true; return; }
      if (f.size > 2 * 1024 * 1024) {
        showAlert('error', 'File is too large (max 2 MB)');
        input.value = '';
        uploadBtn.disabled = true;
        return;
      }
      var url = URL.createObjectURL(f);
      preview.innerHTML = '<img alt="Preview" src="' + url + '">';
      uploadBtn.disabled = false;
    });

    uploadBtn.addEventListener('click', async function () {
      var f = input.files && input.files[0];
      if (!f) return;

      uploadBtn.disabled = true;
      var oldText = uploadBtn.textContent;
      uploadBtn.textContent = 'Uploading…';

      try {
        var fd = new FormData();
        fd.append('photo', f);

        var res = await fetch('/api/me/photo', {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        });
        var data = await res.json();

        if (!res.ok) {
          showAlert('error', data.error || 'Upload failed');
          uploadBtn.disabled = false;
          return;
        }

        preview.innerHTML = '<img alt="Profile photo" src="' + data.url + '">';
        input.value = '';
        showAlert('success', 'Profile photo updated.');
      } catch (err) {
        showAlert('error', 'Network error. Please try again.');
      } finally {
        uploadBtn.textContent = oldText;
        uploadBtn.disabled = true; // re-disabled until next file chosen
      }
    });
  }

  // ---------------------------------------------------------------
  // ID document
  // ---------------------------------------------------------------
  function wireIdDocUpload() {
    var input = $('idDocInput');
    var chooseBtn = $('chooseIdDocBtn');
    var uploadBtn = $('uploadIdDocBtn');
    var status = $('idDocStatus');
    var viewBtn = $('viewIdDocBtn');
    if (!input || !chooseBtn || !uploadBtn) return;

    function refreshStatus() {
      fetch('/api/me/profile-info', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (d) {
          if (d.has_id_document) {
            var when = d.id_document_uploaded_at ? new Date(d.id_document_uploaded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
            if (status) status.textContent = 'Uploaded' + (when ? ' on ' + when : '') + '. You can replace it below.';
            if (viewBtn) viewBtn.style.display = 'inline-block';
          } else {
            if (status) status.textContent = 'No document uploaded yet.';
            if (viewBtn) viewBtn.style.display = 'none';
          }
        })
        .catch(function () {
          if (status) status.textContent = 'Could not load status.';
        });
    }

    chooseBtn.addEventListener('click', function () { input.click(); });

    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) { uploadBtn.disabled = true; return; }
      if (f.size > 5 * 1024 * 1024) {
        showAlert('error', 'File is too large (max 5 MB)');
        input.value = '';
        uploadBtn.disabled = true;
        return;
      }
      uploadBtn.disabled = false;
    });

    uploadBtn.addEventListener('click', async function () {
      var f = input.files && input.files[0];
      if (!f) return;

      uploadBtn.disabled = true;
      var oldText = uploadBtn.textContent;
      uploadBtn.textContent = 'Uploading…';

      try {
        var fd = new FormData();
        fd.append('document', f);

        var res = await fetch('/api/me/id-document', {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        });
        var data = await res.json();

        if (!res.ok) {
          showAlert('error', data.error || 'Upload failed');
          uploadBtn.disabled = false;
          return;
        }

        input.value = '';
        showAlert('success', 'ID document uploaded.');
        refreshStatus();
      } catch (err) {
        showAlert('error', 'Network error. Please try again.');
      } finally {
        uploadBtn.textContent = oldText;
      }
    });

    refreshStatus();
  }

  // ---------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    wireSidebar();
    wireAvatar();
    wirePasswordForm();
    wirePhotoUpload();
    wireIdDocUpload();
  });
})();
