/* Zaria — Admin chama detail */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  function fmtMoney2(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function statusPill(status) {
    var cls =
      status === 'active' || status === 'paid' ? 'pos' :
      status === 'inactive' || status === 'overdue' ? 'neg' :
      status === 'pending' ? 'warn' :
      status === 'partial' ? 'info' : 'neutral';
    return '<span class="pill ' + cls + '">' + escapeHtml(status) + '</span>';
  }

  var chamaId = (function () {
    var parts = window.location.pathname.split('/').filter(Boolean);
    var last = parts[parts.length - 1];
    return last && /^\d+$/.test(last) ? Number(last) : null;
  })();

  var current = null;

  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }
  function closeAll() {
    ['addMemberModal', 'recordModal', 'editModal'].forEach(function (m) { $(m).hidden = true; });
  }

  async function loadDetail() {
    if (!chamaId) {
      $('chamaSub').textContent = 'Invalid chama id';
      return;
    }
    var res = await fetch('/api/admin/chamas/' + chamaId, { credentials: 'same-origin' });
    if (res.status === 401) { window.location.replace('/'); return; }
    if (res.status === 404) {
      $('chamaSub').textContent = 'Chama not found';
      return;
    }
    if (!res.ok) {
      $('chamaSub').textContent = 'Failed to load chama';
      return;
    }
    var data = await res.json();
    current = data;
    render(data);
    loadPayouts();
  }

  function render(data) {
    var c = data.chama;
    var a = data.savingsAccount;
    var s = data.stats || {};
    var members = data.members || [];
    var tx = data.recentTransactions || [];

    $('chamaName').textContent = c.name;
    $('chamaSub').textContent = c.code + ' · ' + (s.memberCount || 0) + ' member' + (s.memberCount === 1 ? '' : 's');
    var pill = $('statusPill');
    if (pill) {
      var tmp = document.createElement('div');
      tmp.innerHTML = statusPill(c.status);
      var newPill = tmp.firstChild;
      newPill.id = 'statusPill';
      pill.parentNode.replaceChild(newPill, pill);
    }

    $('statBalance').innerHTML = '<span class="unit">KES</span>' + fmtMoney(s.balance);
    $('statBalanceSub').textContent = a ? a.account_number : 'No account';
    $('statMembers').textContent = s.memberCount || 0;
    $('statMembersSub').textContent = (s.memberCount === 1 ? 'one member' : s.memberCount + ' members');
    $('statPaid').textContent = (s.paidThisPeriod || 0) + '/' + (s.memberCount || 0);
    $('statPaidSub').textContent = 'Period ' + data.currentPeriod;
    $('statContributed').innerHTML = '<span class="unit">KES</span>' + fmtMoney(s.totalContributed);

    $('detailsSub').textContent = 'Period ' + data.currentPeriod;
    $('infoList').innerHTML = [
      kv('Name', c.name),
      kv('Code', c.code),
      kv('Description', c.description || '—'),
      kv('Monthly minimum', 'KES ' + fmtMoney(c.monthly_contribution_min)),
      kv('Times-money', c.times_money_enabled ? 'Enabled (' + c.times_money_order + ')' : 'Disabled'),
      kv('Created', fmtDate(c.created_at)),
      kv('Created by', c.created_by_email || '—'),
    ].join('');

    $('acctList').innerHTML = a ? [
      kv('Account number', a.account_number),
      kv('Status', a.status),
      kv('Balance', 'KES ' + fmtMoney2(a.balance)),
      kv('Total contributed', 'KES ' + fmtMoney2(a.total_contributed)),
      kv('Total withdrawn', 'KES ' + fmtMoney2(a.total_withdrawn)),
      kv('Opened', fmtDate(a.opened_at)),
      kv('Last transaction', fmtDateTime(a.last_transaction_at)),
    ].join('') : '<div style="padding:16px;color:var(--ink-500)">No savings account linked.</div>';

    $('membersSub').textContent = members.length + ' member' + (members.length === 1 ? '' : 's') + ' · period ' + data.currentPeriod;
    var mb = $('membersBody');
    if (!members.length) {
      mb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:24px">No members yet. Click "Add member" to enrol one.</td></tr>';
    } else {
      mb.innerHTML = members.map(function (m) {
        return '<tr>' +
          '<td><span class="name">' + escapeHtml(m.full_name) + '</span><div class="muted">' + escapeHtml(m.phone || '') + '</div></td>' +
          '<td class="num" style="text-align:right">' + fmtMoney2(m.amount_due) + '</td>' +
          '<td class="num" style="text-align:right">' + fmtMoney2(m.amount_paid) + '</td>' +
          '<td>' + statusPill(m.contribution_status || 'pending') + '</td>' +
          '<td class="muted">' + (m.last_payment_at ? fmtDate(m.last_payment_at) : '—') + '</td>' +
          '<td style="text-align:right"><button type="button" class="btn-sm btn-outline" data-remove="' + m.client_id + '" data-name="' + escapeHtml(m.full_name) + '">Remove</button></td>' +
          '</tr>';
      }).join('');
    }

    $('txSub').textContent = tx.length + ' transaction' + (tx.length === 1 ? '' : 's') + ' (most recent first)';
    var tb = $('txBody');
    if (!tx.length) {
      tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--ink-500);padding:24px">No transactions yet.</td></tr>';
    } else {
      tb.innerHTML = tx.map(function (t) {
        var ref = t.mpesa_receipt || t.reference || '—';
        return '<tr>' +
          '<td class="muted">' + fmtDateTime(t.created_at) + '</td>' +
          '<td>' + (t.client_name ? escapeHtml(t.client_name) : '—') + '</td>' +
          '<td>' + escapeHtml(t.type) + '</td>' +
          '<td class="num" style="text-align:right">' + fmtMoney2(t.amount) + '</td>' +
          '<td class="num" style="text-align:right">' + fmtMoney2(t.balance_after) + '</td>' +
          '<td>' + escapeHtml(t.channel) + '</td>' +
          '<td class="muted" style="font-size:12px">' + escapeHtml(ref) + '</td>' +
          '</tr>';
      }).join('');
    }

    $('editName').value = c.name || '';
    $('editCode').value = c.code || '';
    $('editDesc').value = c.description || '';
    $('editMin').value = c.monthly_contribution_min || 300;
    $('editStatus').value = c.status || 'active';
    $('editTm').checked = !!c.times_money_enabled;

    var memberOptions = members.map(function (m) {
      return '<option value="' + m.client_id + '">' + escapeHtml(m.full_name) + ' (' + escapeHtml(m.phone || '') + ')</option>';
    }).join('');
    $('recordMember').innerHTML = '<option value="">Select member…</option>' + memberOptions;
  }

  function kv(label, value) {
    return '<div class="kv-row"><span class="kv-label">' + escapeHtml(label) + '</span><span class="kv-value">' + value + '</span></div>';
  }

  async function loadEligibleClients() {
    var res = await fetch('/api/admin/clients?status=active', { credentials: 'same-origin' });
    if (!res.ok) {
      $('memberSelect').innerHTML = '<option value="">Failed to load clients</option>';
      return;
    }
    var data = await res.json();
    var clients = (data.clients || []).filter(function (c) { return !c.chama_id; });
    if (!clients.length) {
      $('memberSelect').innerHTML = '<option value="">No eligible clients (all active clients are already in a chama)</option>';
      return;
    }
    $('memberSelect').innerHTML = '<option value="">Select client…</option>' + clients.map(function (c) {
      return '<option value="' + c.id + '">' + escapeHtml(c.full_name) + ' (' + escapeHtml(c.phone || '') + ')</option>';
    }).join('');
  }

// ---------------------------------------------------------------
// Invites
// ---------------------------------------------------------------
async function loadInvites() {
  var showAll = $('showAllInvites') && $('showAllInvites').checked;
  var statusParam = showAll ? '?status=all' : '';
  var res = await fetch('/api/admin/chamas/' + chamaId + '/invites' + statusParam, { credentials: 'same-origin' });
  if (!res.ok) {
    $('invitesBody').innerHTML = '<tr><td colspan="4" style="text-align:center;color:#cf2632;padding:24px">Failed to load invites</td></tr>';
    return;
  }
  var data = await res.json();
  var invites = data.invites || [];
  $('invitesSub').textContent = invites.length + ' ' + (showAll ? 'invite' + (invites.length === 1 ? '' : 's') : 'pending invite' + (invites.length === 1 ? '' : 's'));
  if (!invites.length) {
    $('invitesBody').innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--ink-500);padding:24px">No ' + (showAll ? '' : 'pending ') + 'invites. Click "+ Send invite" to add one.</td></tr>';
    return;
  }
  $('invitesBody').innerHTML = invites.map(function (inv) {
    var recipient = inv.client_name || inv.email || '—';
    var sub = inv.client_name && inv.email ? '<div class="muted" style="font-size:11px">' + escapeHtml(inv.email) + '</div>' : '';
    var statusCls = inv.status === 'accepted' ? 'pos' : inv.status === 'declined' ? 'neg' : inv.status === 'pending' ? 'warn' : 'neutral';
    var expires = inv.expires_at ? new Date(inv.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    var cancelBtn = inv.status === 'pending' ? '<button type="button" class="btn-sm btn-outline" data-cancel="' + inv.id + '" data-name="' + escapeHtml(recipient) + '">Cancel</button>' : '';
    return '<tr>' +
      '<td><span class="name">' + escapeHtml(recipient) + '</span>' + sub + '</td>' +
      '<td><span class="pill ' + statusCls + '">' + escapeHtml(inv.status) + '</span></td>' +
      '<td class="muted">' + expires + '</td>' +
      '<td style="text-align:right">' + cancelBtn + '</td>' +
      '</tr>';
  }).join('');
}

async function openInviteModal() {
  $('inviteError').hidden = true;
  $('inviteEmail').value = '';
  $('inviteClientSelect').innerHTML = '<option value="">Loading clients…</option>';
  $('inviteModal').hidden = false;
  document.body.style.overflow = 'hidden';
  document.querySelector('input[name="inviteType"][value="client"]').checked = true;
  $('inviteClientSection').hidden = false;
  $('inviteEmailSection').hidden = true;
  await loadInviteClients();
}

async function loadInviteClients() {
  var res = await fetch('/api/admin/clients?status=active', { credentials: 'same-origin' });
  if (!res.ok) { $('inviteClientSelect').innerHTML = '<option value="">Failed to load clients</option>'; return; }
  var data = await res.json();
  var clients = (data.clients || []).filter(function (c) { return !c.chama_id; });
  if (!clients.length) { $('inviteClientSelect').innerHTML = '<option value="">No eligible clients</option>'; return; }
  $('inviteClientSelect').innerHTML = '<option value="">Select client…</option>' + clients.map(function (c) {
    return '<option value="' + c.id + '">' + escapeHtml(c.full_name) + ' (' + escapeHtml(c.phone || '') + ')</option>';
  }).join('');
}

async function submitInvite() {
  $('inviteError').hidden = true;
  var inviteType = document.querySelector('input[name="inviteType"]:checked').value;
  var body = {};
  if (inviteType === 'client') {
    var cid = Number($('inviteClientSelect').value);
    if (!cid) { $('inviteError').textContent = 'Select a client.'; $('inviteError').hidden = false; return; }
    body.client_id = cid;
  } else {
    var em = String($('inviteEmail').value || '').trim().toLowerCase();
    if (!em || !/^\S+@\S+\.\S+$/.test(em)) { $('inviteError').textContent = 'Enter a valid email.'; $('inviteError').hidden = false; return; }
    body.email = em;
  }
  var btn = $('inviteSubmit');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    var res = await fetch('/api/admin/chamas/' + chamaId + '/invites', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await res.json();
    if (!res.ok) { $('inviteError').textContent = data.error || 'Could not send invite.'; $('inviteError').hidden = false; return; }
    $('inviteModal').hidden = true;
    document.body.style.overflow = '';
    await loadInvites();
    if (data.email_sent === false) {
      alert('Invite created, but the email failed. Share this link manually:\n\n' + (data.accept_url || ''));
    }
  } catch (ex) {
    $('inviteError').textContent = 'Network error.'; $('inviteError').hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Send invite';
  }
}

async function cancelInvite(inviteId, recipientName) {
  if (!confirm('Cancel invite for ' + recipientName + '?')) return;
  try {
    var res = await fetch('/api/admin/chamas/' + chamaId + '/invites/' + inviteId, {
      method: 'DELETE', credentials: 'same-origin',
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) { alert(data.error || 'Cancel failed'); return; }
    await loadInvites();
  } catch (ex) { alert('Network error'); }
}


// ---------------------------------------------------------------
// Times-money payouts
// ---------------------------------------------------------------
async function loadPayouts() {
  if (!current || !current.chama) return;
  var tmEnabled = !!current.chama.times_money_enabled;

  if (!tmEnabled) {
    $('tmDisabled').hidden = false;
    $('tmEnabled').hidden = true;
    $('payoutBtn').hidden = true;
    $('tmSub').textContent = 'Not enabled';
    return;
  }

  $('tmDisabled').hidden = true;
  $('tmEnabled').hidden = false;
  $('payoutBtn').hidden = false;
  $('tmSub').textContent = 'Merry-go-round · ' + (current.chama.times_money_order || 'rotation');

  $('tmBalance').textContent = 'KES ' + fmtMoney2(current.savingsAccount ? current.savingsAccount.balance : 0);

  // Load next recipient
  try {
    var nrRes = await fetch('/api/admin/chamas/' + chamaId + '/next-recipient', { credentials: 'same-origin' });
    if (nrRes.ok) {
      var nr = await nrRes.json();
      $('tmNext').textContent = nr.next_recipient
        ? nr.next_recipient.full_name + (nr.next_recipient.phone ? ' (' + nr.next_recipient.phone + ')' : '')
        : '—';
    } else {
      $('tmNext').textContent = '—';
    }
  } catch (_) { $('tmNext').textContent = '—'; }

  // Load payouts
  try {
    var res = await fetch('/api/admin/chamas/' + chamaId + '/payouts', { credentials: 'same-origin' });
    if (!res.ok) {
      $('tmBody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:#cf2632;padding:24px">Failed to load payouts</td></tr>';
      return;
    }
    var data = await res.json();
    var payouts = data.payouts || [];
    if (!payouts.length) {
      $('tmBody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-500);padding:24px">No payouts yet.</td></tr>';
      return;
    }
    $('tmBody').innerHTML = payouts.map(function (p) {
      var d = p.created_at ? new Date(p.created_at) : null;
      var dateStr = d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
      return '<tr>' +
        '<td class="muted">' + dateStr + '</td>' +
        '<td><span class="name">' + escapeHtml(p.client_name || '—') + '</span></td>' +
        '<td class="num" style="text-align:right">KES ' + fmtMoney2(p.amount) + '</td>' +
        '<td>' + escapeHtml(p.channel) + '</td>' +
        '<td class="muted" style="font-size:12px">' + escapeHtml(p.mpesa_receipt || p.notes || '—') + '</td>' +
        '</tr>';
    }).join('');
  } catch (_) {
    $('tmBody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:#cf2632;padding:24px">Failed to load payouts</td></tr>';
  }
}

async function openPayoutModal() {
  $('payoutError').hidden = true;
  $('payoutNotes').value = '';
  $('payoutRecipient').innerHTML = '<option value="">Loading members…</option>';
  $('payoutAmount').value = '';
  $('payoutHint').textContent = '—';
  $('payoutAmountHint').textContent = '—';
  $('payoutModal').hidden = false;
  document.body.style.overflow = 'hidden';

  // Populate members from `current`
  var members = (current && current.members) || [];
  if (members.length) {
    $('payoutRecipient').innerHTML = '<option value="">Select recipient…</option>' + members.map(function (m) {
      return '<option value="' + m.client_id + '">' + escapeHtml(m.full_name) + (m.phone ? ' (' + m.phone + ')' : '') + '</option>';
    }).join('');
  } else {
    $('payoutRecipient').innerHTML = '<option value="">No members</option>';
  }

  // Fetch suggested next recipient + balance
  try {
    var nrRes = await fetch('/api/admin/chamas/' + chamaId + '/next-recipient', { credentials: 'same-origin' });
    if (nrRes.ok) {
      var nr = await nrRes.json();
      if (nr.next_recipient_client_id) {
        $('payoutRecipient').value = String(nr.next_recipient_client_id);
        $('payoutHint').textContent = 'Suggested next in rotation';
      }
    }
  } catch (_) {}

  var balance = current && current.savingsAccount ? Number(current.savingsAccount.balance) : 0;
  $('payoutAmount').value = Math.round(balance * 100) / 100;
  $('payoutAmount').max = balance;
  $('payoutAmountHint').textContent = 'Chama balance: KES ' + fmtMoney2(balance);
}

async function submitPayout() {
  $('payoutError').hidden = true;
  var recipientId = Number($('payoutRecipient').value);
  var amount = Number($('payoutAmount').value);
  if (!recipientId) { $('payoutError').textContent = 'Select a recipient.'; $('payoutError').hidden = false; return; }
  if (!(amount > 0)) { $('payoutError').textContent = 'Enter a positive amount.'; $('payoutError').hidden = false; return; }

  var btn = $('payoutSubmit');
  btn.disabled = true; btn.textContent = 'Recording…';

  try {
    var res = await fetch('/api/admin/chamas/' + chamaId + '/payouts', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient_client_id: recipientId,
        amount: amount,
        channel: $('payoutChannel').value,
        notes: $('payoutNotes').value.trim() || null,
      }),
    });
    var data = await res.json();
    if (!res.ok) {
      $('payoutError').textContent = data.error || 'Could not record payout.';
      $('payoutError').hidden = false;
      return;
    }
    $('payoutModal').hidden = true;
    document.body.style.overflow = '';
    // Refresh entire detail (balance, payouts, next recipient)
    await loadDetail();
  } catch (ex) {
    $('payoutError').textContent = 'Network error. Try again.';
    $('payoutError').hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Record payout';
  }
}

  async function submitAddMember() {
    var err = $('addMemberError');
    err.hidden = true;
    var sel = $('memberSelect');
    var clientId = Number(sel.value);
    if (!clientId) { err.textContent = 'Select a client'; err.hidden = false; return; }
    var btn = $('addMemberSubmit');
    btn.disabled = true; btn.textContent = 'Enrolling…';
    try {
      var res = await fetch('/api/admin/chamas/' + chamaId + '/members', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });
      var data = await res.json();
      if (!res.ok) { err.textContent = data.error || 'Enrol failed'; err.hidden = false; return; }
      closeModal('addMemberModal');
      await loadDetail();
    } catch (ex) {
      err.textContent = 'Network error'; err.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Enrol';
    }
  }

  async function submitRecord() {
    var err = $('recordError');
    err.hidden = true;
    var clientId = Number($('recordMember').value);
    var amount = Number($('recordAmount').value);
    if (!clientId) { err.textContent = 'Select a member'; err.hidden = false; return; }
    if (!(amount > 0)) { err.textContent = 'Enter a positive amount'; err.hidden = false; return; }
    var btn = $('recordSubmit');
    btn.disabled = true; btn.textContent = 'Recording…';
    try {
      var res = await fetch('/api/admin/chamas/' + chamaId + '/contributions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          amount: amount,
          channel: $('recordChannel').value,
          notes: $('recordNotes').value.trim() || null,
        }),
      });
      var data = await res.json();
      if (!res.ok) { err.textContent = data.error || 'Record failed'; err.hidden = false; return; }
      closeModal('recordModal');
      $('recordForm').reset();
      await loadDetail();
    } catch (ex) {
      err.textContent = 'Network error'; err.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Record';
    }
  }

  async function submitEdit() {
    var err = $('editError');
    err.hidden = true;
    var btn = $('editSubmit');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      var res = await fetch('/api/admin/chamas/' + chamaId, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: $('editName').value.trim(),
          code: $('editCode').value.trim().toUpperCase(),
          description: $('editDesc').value.trim() || null,
          monthly_contribution_min: Number($('editMin').value),
          status: $('editStatus').value,
          times_money_enabled: $('editTm').checked,
        }),
      });
      var data = await res.json();
      if (!res.ok) { err.textContent = data.error || 'Save failed'; err.hidden = false; return; }
      closeModal('editModal');
      await loadDetail();
    } catch (ex) {
      err.textContent = 'Network error'; err.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Save';
    }
  }

  async function removeMember(clientId, name) {
    if (!confirm('Remove ' + name + ' from this chama?\n\nTheir contribution history is preserved.')) return;
    try {
      var res = await fetch('/api/admin/chamas/' + chamaId + '/members/' + clientId, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) { alert(data.error || 'Remove failed'); return; }
      await loadDetail();
    } catch (ex) {
      alert('Network error');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!chamaId) { $('chamaSub').textContent = 'Invalid chama id'; return; }
    loadDetail();

    $('addMemberBtn').addEventListener('click', async function () {
      $('addMemberError').hidden = true;
      $('memberSelect').innerHTML = '<option value="">Loading clients…</option>';
      openModal('addMemberModal');
      await loadEligibleClients();
    });

    $('recordBtn').addEventListener('click', function () {
      $('recordError').hidden = true;
      $('recordForm').reset();
      $('recordAmount').value = current && current.chama ? current.chama.monthly_contribution_min : 300;
      openModal('recordModal');
    });

    $('editBtn').addEventListener('click', function () {
      $('editError').hidden = true;
      openModal('editModal');
    });

    $('addMemberSubmit').addEventListener('click', submitAddMember);
    $('recordSubmit').addEventListener('click', submitRecord);
    $('editSubmit').addEventListener('click', submitEdit);

    document.querySelectorAll('[data-close]').forEach(function (el) {
      el.addEventListener('click', function () { closeModal(el.getAttribute('data-close')); });
    });

    document.querySelectorAll('.modal-backdrop').forEach(function (bd) {
      bd.addEventListener('click', function (e) {
        if (e.target === bd) bd.hidden = true;
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll();
    });

    $('membersBody').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-remove]');
      if (!btn) return;
      removeMember(Number(btn.getAttribute('data-remove')), btn.getAttribute('data-name'));
    });
    // Times-money payouts
    if ($('payoutBtn')) {
      $('payoutBtn').addEventListener('click', openPayoutModal);
    }
    if ($('payoutSubmit')) {
      $('payoutSubmit').addEventListener('click', submitPayout);
    }

    // Invites
    if ($('inviteBtn')) {
      $('inviteBtn').addEventListener('click', openInviteModal);
      loadInvites();
    }
    if ($('showAllInvites')) {
      $('showAllInvites').addEventListener('change', loadInvites);
    }
    if ($('inviteSubmit')) {
      $('inviteSubmit').addEventListener('click', submitInvite);
    }
    document.querySelectorAll('input[name="inviteType"]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (r.value === 'client') {
          $('inviteClientSection').hidden = false;
          $('inviteEmailSection').hidden = true;
        } else {
          $('inviteClientSection').hidden = true;
          $('inviteEmailSection').hidden = false;
        }
      });
    });
    if ($('invitesBody')) {
      $('invitesBody').addEventListener('click', function (e) {
        var btn = e.target.closest('[data-cancel]');
        if (!btn) return;
        cancelInvite(Number(btn.getAttribute('data-cancel')), btn.getAttribute('data-name'));
      });
    }


  });
})();
