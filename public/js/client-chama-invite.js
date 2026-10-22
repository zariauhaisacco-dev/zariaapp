/* Zaria — Client chama invite landing */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function show(stateId) {
    ['loadingState', 'errorState', 'inviteState', 'successState', 'declinedState'].forEach(function (id) {
      const el = $(id);
      if (el) el.hidden = (id !== stateId);
    });
  }

  function showError(title, msg) {
    $('errorTitle').textContent = title || 'Invite not valid';
    $('errorMessage').textContent = msg || '—';
    show('errorState');
  }

  function getQuery(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  async function init() {
    const token = getQuery('token');
    const action = getQuery('action');

    if (!token) {
      showError('Missing invite token', 'The link is missing its unique identifier. Please check the email and try again.');
      return;
    }

    // Check we're logged in as a client — try /api/auth/me
    let me;
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (res.status === 401) {
        // Redirect to login, come back here after
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace('/?next=' + next);
        return;
      }
      if (!res.ok) {
        showError('Session error', 'Could not verify your login. Please try again.');
        return;
      }
      me = await res.json();
    } catch (ex) {
      showError('Network error', 'Could not reach the server. Please try again.');
      return;
    }

    if (!me.user || me.user.role !== 'client') {
      showError('Client account required', 'You need to be logged in as a client to accept a chama invite.');
      return;
    }

    // Fetch preview
    let preview;
    try {
      const res = await fetch('/api/chama-invites/' + encodeURIComponent(token) + '/preview', {
        credentials: 'same-origin',
      });
      preview = await res.json();
    } catch (ex) {
      showError('Network error', 'Could not load invite. Please try again.');
      return;
    }

    if (!preview.valid) {
      const reasonMap = {
        not_found: 'This invite link is not recognized. It may have been deleted.',
        expired: 'This invite has expired. Contact your chama admin for a new one.',
        cancelled: 'This invite was cancelled by the admin.',
        declined: 'This invite was already declined.',
        already_used: 'This invite has already been used. If you joined, visit My Chama.',
        chama_inactive: 'The chama is no longer active.',
        server_error: 'Server error loading invite.',
      };
      showError('Invite not valid', reasonMap[preview.reason] || 'This invite cannot be used.');
      return;
    }

    // Populate invite card
    $('chamaName').textContent = preview.chama_name;
    $('chamaCode').textContent = preview.chama_code || '—';
    $('inviterEmail').textContent = preview.inviter_email || 'your chama admin';
    $('maskedEmail').textContent = preview.client_email_masked || '—';
    $('expiresAt').textContent = fmtDate(preview.expires_at);

    // If action=decline in URL, auto-decline
    if (action === 'decline') {
      await doDecline(token);
      return;
    }

    show('inviteState');

    // Wire buttons
    $('acceptBtn').addEventListener('click', function () { doAccept(token); });
    $('declineBtn').addEventListener('click', function () { doDecline(token); });
  }

  async function doAccept(token) {
    const btn = $('acceptBtn');
    const err = $('actionError');
    err.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Accepting…';

    try {
      const res = await fetch('/api/me/chama/invite/' + encodeURIComponent(token) + '/accept', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json();

      if (!res.ok) {
        err.textContent = data.error || 'Could not accept invite.';
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Accept invite';
        return;
      }

      $('successTitle').textContent = 'You\'ve joined ' + (data.chama_name || 'the chama');
      $('successMessage').textContent = 'Your contribution for this period has been recorded as pending. You can pay via M-Pesa from the chama page.';
      show('successState');
    } catch (ex) {
      err.textContent = 'Network error. Try again.';
      err.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Accept invite';
    }
  }

  async function doDecline(token) {
    try {
      const res = await fetch('/api/me/chama/invite/' + encodeURIComponent(token) + '/decline', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json();

      if (!res.ok) {
        // If already declined, show as declined anyway
        if (res.status === 409) {
          show('declinedState');
          return;
        }
        showError('Could not decline', data.error || 'Try again or contact support.');
        return;
      }

      show('declinedState');
    } catch (ex) {
      showError('Network error', 'Try again or contact support.');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
