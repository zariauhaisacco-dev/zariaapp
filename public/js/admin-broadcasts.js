/* Zaria — Admin broadcasts */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showAlert(kind, msg) {
    var el = $('alert');
    el.className = 'alert alert-' + kind;
    el.textContent = msg;
    el.hidden = false;
    setTimeout(function () { el.hidden = true; }, 6000);
  }

  function showStatus(msg, kind) {
    var el = $('statusText');
    el.textContent = msg;
    el.style.display = 'inline';
    el.style.color = kind === 'error' ? 'var(--neg)' : 'var(--pos)';
    setTimeout(function () { el.style.display = 'none'; }, 5000);
  }

  var selectedChannel = 'email';

  function getChannels() {
    return selectedChannel;
  }

  function setSelectedChannel(channel) {
    selectedChannel = channel;
    document.querySelectorAll('.channel-card').forEach(function (card) {
      card.classList.toggle('is-selected', card.getAttribute('data-channel') === channel);
    });
  }

  function wireChannelCards() {
    var cards = document.querySelectorAll('.channel-card');
    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        if (card.disabled) return;
        setSelectedChannel(card.getAttribute('data-channel'));
      });
    });
  }

  function updateChannelCounts(preview) {
    var total = preview.total || 0;
    var withEmail = preview.with_email || 0;
    var withPush = preview.with_push || 0;
    var both = Math.min(withEmail, withPush); // conservative: at least one email + one push
    // For "both" the real number is clients with both channels; use min as approximation.
    // Server currently returns only with_email/with_push, not "both". min is safe.

    var cEmail = $('countEmail');
    var cPush = $('countPush');
    var cBoth = $('countBoth');
    var cSms = $('countSms');
    var cAll = $('countAll');
    var withSms = preview.with_sms || 0;
    var all = Math.min(withEmail, withPush, withSms);
    if (cEmail) cEmail.textContent = withEmail + ' client' + (withEmail === 1 ? '' : 's');
    if (cPush) cPush.textContent = withPush + ' client' + (withPush === 1 ? '' : 's');
    if (cBoth) cBoth.textContent = both + ' client' + (both === 1 ? '' : 's');
    if (cSms) cSms.textContent = withSms + ' client' + (withSms === 1 ? '' : 's');
    if (cAll) cAll.textContent = all + ' client' + (all === 1 ? '' : 's');

    // Disable push card if 0 push subscribers
    var pushCard = document.querySelector('.channel-card[data-channel="push"]');
    var bothCard = document.querySelector('.channel-card[data-channel="both"]');
    if (pushCard) {
      pushCard.disabled = (withPush === 0);
      pushCard.classList.toggle('is-disabled', withPush === 0);
    }
    if (bothCard) {
      bothCard.disabled = (both === 0);
      bothCard.classList.toggle('is-disabled', both === 0);
    }
    var smsCard = document.querySelector('.channel-card[data-channel="sms"]');
    var allCard = document.querySelector('.channel-card[data-channel="all"]');
    if (smsCard) {
      smsCard.disabled = (withSms === 0);
      smsCard.classList.toggle('is-disabled', withSms === 0);
    }
    if (allCard) {
      allCard.disabled = (all === 0);
      allCard.classList.toggle('is-disabled', all === 0);
    }

    // Smart default: if current selection is disabled, switch to email
    var current = document.querySelector('.channel-card[data-channel="' + selectedChannel + '"]');
    if (!current || current.disabled) {
      setSelectedChannel('email');
    }
  }

  function wireCharacterCount() {
    var body = $('body');
    var count = $('charCount');
    body.addEventListener('input', function () {
      count.textContent = body.value.length;
    });
  }

  async function preview() {
    var audience = $('audience').value;
    var btn = $('previewBtn');
    btn.disabled = true;
    btn.textContent = 'Previewing…';
    try {
      var res = await fetch('/api/admin/broadcasts/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience_status: audience }),
      });
      var data = await res.json();
      if (!res.ok) {
        showAlert('error', data.error || 'Preview failed');
        return;
      }
      var text = data.total + ' client' + (data.total === 1 ? '' : 's') +
        ' · ' + data.with_email + ' with email' +
        ' · ' + data.with_push + ' with push';
      $('previewText').textContent = text;
      $('sendBtn').disabled = (data.total === 0);
      updateChannelCounts(data);
    } catch (e) {
      showAlert('error', 'Network error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Preview';
    }
  }

  async function sendToSelf() {
    var subject = $('subject').value.trim();
    var body = $('body').value.trim();
    if (!subject || subject.length < 3) return showAlert('error', 'Subject must be at least 3 characters');
    if (!body || body.length < 5) return showAlert('error', 'Message must be at least 5 characters');

    var btn = $('testSelfBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      var res = await fetch('/api/admin/broadcasts/test-self', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject, body: body }),
      });
      var data = await res.json();
      if (!res.ok) {
        showAlert('error', data.error || 'Send failed');
      } else {
        showAlert('success', data.message || 'Test email sent');
      }
    } catch (e) {
      showAlert('error', 'Network error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send to myself';
    }
  }

  async function sendBroadcast() {
    var subject = $('subject').value.trim();
    var body = $('body').value.trim();
    var channels = getChannels();
    var audience = $('audience').value;

    if (!subject || subject.length < 3) return showAlert('error', 'Subject must be at least 3 characters');
    if (!body || body.length < 5) return showAlert('error', 'Message must be at least 5 characters');

    var countText = $('previewText').textContent;
    var countMatch = countText.match(/^(\d+)/);
    if (!countMatch || countMatch[1] === '0') {
      return showAlert('error', 'Click Preview first to confirm recipient count');
    }
    var count = countMatch[1];

    var typed = prompt('This will send to ' + count + ' client(s) via ' + channels + '. Type the number to confirm:');
    if (typed !== count) {
      showAlert('error', 'Confirmation cancelled — count did not match');
      return;
    }

    var btn = $('sendBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      var res = await fetch('/api/admin/broadcasts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject,
          body: body,
          channels: channels,
          audience_status: audience,
        }),
      });
      var data = await res.json();
      if (!res.ok) {
        showAlert('error', data.error || 'Send failed');
      } else {
        showAlert('success', 'Broadcast #' + data.broadcast_id + ' queued for ' + data.preview.total + ' client(s)');
        $('subject').value = '';
        $('body').value = '';
        $('charCount').textContent = '0';
        $('previewText').textContent = 'Click "Preview" to see how many clients will receive this.';
        await loadHistory();
        showDeliveryStatus(data.broadcast_id);
      }
    } catch (e) {
      showAlert('error', 'Network error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send broadcast';
    }
  }

  // ---------------------------------------------------------------
  // Delivery status panel — poll broadcast until completed
  // ---------------------------------------------------------------
  var statusPollTimer = null;

  function closeStatusPanel() {
    var card = $('statusCard');
    if (card) card.hidden = true;
    if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; }
  }

  async function showDeliveryStatus(broadcastId) {
    var card = $('statusCard');
    var body = $('statusBody');
    var sub = $('statusSub');
    if (!card || !body || !sub) return;

    card.hidden = false;
    body.innerHTML = '<div class="muted" style="padding:12px">Loading status…</div>';
    sub.textContent = 'Broadcast #' + broadcastId;

    if (statusPollTimer) clearInterval(statusPollTimer);

    async function refresh() {
      try {
        var res = await fetch('/api/admin/broadcasts/' + broadcastId, { credentials: 'same-origin' });
        if (!res.ok) {
          body.innerHTML = '<div style="padding:12px;color:var(--neg)">Could not load status</div>';
          return;
        }
        var b = await res.json();
        var isDone = b.status === 'completed' || b.status === 'failed';
        var total = Number(b.recipient_count) || 0;
        var eSent = Number(b.email_sent_count) || 0;
        var eFail = Number(b.email_failed_count) || 0;
        var pSent = Number(b.push_sent_count) || 0;
        var pFail = Number(b.push_failed_count) || 0;
        var sSent = Number(b.sms_sent_count) || 0;
        var sFail = Number(b.sms_failed_count) || 0;

        var wantEmail = b.channels === 'email' || b.channels === 'both' || b.channels === 'all';
        var wantPush  = b.channels === 'push'  || b.channels === 'both' || b.channels === 'all';
        var wantSms   = b.channels === 'sms'   || b.channels === 'all';

        var rows = '';
        if (wantEmail) {
          rows += '<div class="status-row">' +
            '<span class="status-icon">✉</span>' +
            '<span class="status-name">Email</span>' +
            '<span class="status-counts">' + eSent + ' sent · ' + eFail + ' failed</span>' +
            '<span class="status-badge ' + (eFail === 0 ? 'pos' : 'neg') + '">' + (eFail === 0 ? '✅' : '⚠️') + '</span>' +
            '</div>';
        }
        if (wantPush) {
          rows += '<div class="status-row">' +
            '<span class="status-icon">🔔</span>' +
            '<span class="status-name">Push</span>' +
            '<span class="status-counts">' + pSent + ' sent · ' + pFail + ' failed</span>' +
            '<span class="status-badge ' + (pFail === 0 ? 'pos' : 'neg') + '">' + (pFail === 0 ? '✅' : '⚠️') + '</span>' +
            '</div>';
        }

        if (wantSms) {
          rows += '<div class="status-row">' +
            '<span class="status-icon">📱</span>' +
            '<span class="status-name">SMS</span>' +
            '<span class="status-counts">' + sSent + ' sent · ' + sFail + ' failed</span>' +
            '<span class="status-badge ' + (sFail === 0 ? 'pos' : 'neg') + '">' + (sFail === 0 ? '✅' : '⚠️') + '</span>' +
            '</div>';
        }
        if (!wantEmail && !wantPush && !wantSms) {
          rows = '<div class="muted" style="padding:12px">No channels configured</div>';
        }

        body.innerHTML = '<div class="status-list">' + rows + '</div>';

        if (isDone) {
          sub.textContent = (b.status === 'completed' ? 'Completed' : 'Failed') + ' · ' + total + ' recipient(s)';
          if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; }
        } else {
          sub.textContent = 'Sending… ' + total + ' recipient(s)';
        }
      } catch (e) {
        body.innerHTML = '<div style="padding:12px;color:var(--neg)">Network error</div>';
      }
    }

    await refresh();
    if ($('statusCard') && !$('statusCard').hidden) {
      // Poll every 2s until completed
      statusPollTimer = setInterval(function () {
        refresh().then(function () {
          var b = $('statusSub');
          if (b && b.textContent && b.textContent.indexOf('Completed') === 0) {
            if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; }
          }
        });
      }, 2000);
    }
  }

  async function loadHistory() {
    var wrap = $('historyWrap');
    try {
      var res = await fetch('/api/admin/broadcasts', { credentials: 'same-origin' });
      var data = await res.json();
      var list = data.broadcasts || [];
      if (!list.length) {
        wrap.innerHTML = '<div class="empty" style="padding:32px;text-align:center;color:var(--ink-500)">No broadcasts yet.</div>';
        return;
      }
      var rows = list.map(function (b) {
        var statusCls = b.status === 'completed' ? 'pos' : b.status === 'failed' ? 'neg' : 'warn';
        return '<tr>' +
          '<td class="muted">#' + b.id + '</td>' +
          '<td>' + escapeHtml(b.subject) + '</td>' +
          '<td>' + escapeHtml(b.channels) + '</td>' +
          '<td>' + escapeHtml(b.audience_status) + '</td>' +
          '<td class="num">' + b.email_sent_count + ' / ' + b.push_sent_count + '</td>' +
          '<td class="num">' + (b.email_failed_count + b.push_failed_count) + '</td>' +
          '<td><span class="pill ' + statusCls + '">' + escapeHtml(b.status) + '</span></td>' +
          '<td class="muted">' + new Date(b.started_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</td>' +
          '</tr>';
      }).join('');

      wrap.innerHTML =
        '<table class="table" style="width:100%">' +
        '<thead><tr>' +
        '<th>ID</th><th>Subject</th><th>Channels</th><th>Audience</th>' +
        '<th>Sent</th><th>Failed</th><th>Status</th><th>When</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '</table>';

      // If any broadcast is still 'sending', refresh in 3s
      var anySending = list.some(function (b) { return b.status === 'sending'; });
      if (anySending) {
        setTimeout(loadHistory, 3000);
      }
    } catch (e) {
      wrap.innerHTML = '<div class="empty" style="padding:32px;text-align:center;color:var(--neg)">Could not load broadcasts.</div>';
    }
  }

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

  function wireAvatar() {
    var av = $('avatarBtn');
    if (!av) return;
    fetch('/api/me', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.user && d.user.email) av.textContent = d.user.email.charAt(0).toUpperCase();
      })
      .catch(function () {});
    av.addEventListener('click', async function () {
      if (!confirm('Sign out of Zaria?')) return;
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.replace('/');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    wireSidebar();
    wireAvatar();
    wireCharacterCount();
    wireChannelCards();
    setSelectedChannel('email');
    $('previewBtn').addEventListener('click', preview);
    $('testSelfBtn').addEventListener('click', sendToSelf);
    $('sendBtn').addEventListener('click', sendBroadcast);
    $('audience').addEventListener('change', preview);
    var closeBtn = $('statusCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeStatusPanel);
    loadHistory();
    // Auto-preview on load to populate channel counts
    preview();
  });
})();
