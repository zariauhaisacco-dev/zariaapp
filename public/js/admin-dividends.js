/* Zaria — Admin dividends list */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtRate(n) {
    n = Number(n) || 0;
    // Trim trailing zeros: 15.0000 -> 15, 12.5000 -> 12.5
    return n.toFixed(4).replace(/\.?0+$/, '');
  }
  function statusClass(s) {
    if (s === 'distributed') return 'pos';
    if (s === 'declared') return 'warn';
    if (s === 'cancelled') return 'neg';
    return 'neutral';
  }

  async function load() {
    var tbody = $('declBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:24px">Loading…</td></tr>';

    try {
      var res = await fetch('/api/admin/dividends', { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'load');
      render(data.declarations || []);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neg);padding:24px">Could not load</td></tr>';
    }
  }

  function render(list) {
    var tbody = $('declBody');
    $('countLabel').textContent = list.length + ' declaration' + (list.length === 1 ? '' : 's');

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-500);padding:32px">No dividends declared yet</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function (d) {
      return '<tr data-id="' + d.id + '" style="cursor:pointer">' +
        '<td><span class="name">FY ' + escapeHtml(d.financial_year) + '</span></td>' +
        '<td class="num">' + fmtRate(d.dividend_per_share) + '</td>' +
        '<td class="num">' + d.total_shares_at_declaration + '</td>' +
        '<td class="num">' + fmtMoney(d.total_payout) + '</td>' +
        '<td><span class="pill ' + statusClass(d.status) + '">' + d.status + '</span></td>' +
        '<td>' + fmtDate(d.distributed_at || d.created_at) + '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('tr[data-id]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        window.location.href = '/admin/dividends/' + tr.getAttribute('data-id');
      });
    });
  }

  // ---------------------------------------------------------------
  // Declare modal
  // ---------------------------------------------------------------

  var previewTimer = null;

  function updatePreview() {
    var rate = parseFloat($('rateInput').value);
    if (!(rate > 0)) {
      $('previewBox').style.display = 'none';
      return;
    }
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async function () {
      try {
        var res = await fetch('/api/admin/dividends/preview', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dividend_per_share: rate }),
        });
        var data = await res.json();
        if (!res.ok) { $('previewBox').style.display = 'none'; return; }
        $('previewBox').style.display = 'block';
        $('pvMembers').textContent = data.member_count;
        $('pvShares').textContent = data.total_shares;
        $('pvGross').textContent = 'KES ' + fmtMoney(data.total_gross);
        $('pvTax').textContent = 'KES ' + fmtMoney(data.total_tax);
        $('pvNet').textContent = 'KES ' + fmtMoney(data.total_net);
      } catch (e) { $('previewBox').style.display = 'none'; }
    }, 250);
  }

  function openDeclareModal() {
    $('declareModal').hidden = false;
    $('declareError').hidden = true;
    $('fyInput').value = String(new Date().getFullYear());
    $('rateInput').value = 15;
    $('notesInput').value = '';
    updatePreview();
  }

  $('newBtn').addEventListener('click', openDeclareModal);
  $('rateInput').addEventListener('input', updatePreview);
  $('declareCancel').addEventListener('click', function () {
    $('declareModal').hidden = true;
  });

  $('declareConfirm').addEventListener('click', async function () {
    var fy = $('fyInput').value.trim();
    var rate = parseFloat($('rateInput').value);
    var notes = $('notesInput').value.trim();

    if (!fy) { $('declareError').textContent = 'Financial year required'; $('declareError').hidden = false; return; }
    if (!(rate > 0)) { $('declareError').textContent = 'Rate must be positive'; $('declareError').hidden = false; return; }

    var btn = $('declareConfirm');
    btn.disabled = true; btn.textContent = 'Creating…';

    try {
      var res = await fetch('/api/admin/dividends', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          financial_year: fy,
          dividend_per_share: rate,
          notes: notes || null,
        }),
      });
      var data = await res.json();
      if (!res.ok) {
        $('declareError').textContent = data.error || 'Failed';
        $('declareError').hidden = false;
        return;
      }
      $('declareModal').hidden = true;
      window.location.href = '/admin/dividends/' + data.declarationId;
    } catch (e) {
      $('declareError').textContent = 'Network error';
      $('declareError').hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Create draft';
    }
  });

  // Chrome
  (function wireChrome() {
    var av = $('avatarBtn');
    var menuBtn = $('menuBtn');
    var sidebar = $('sidebar');
    var backdrop = $('sidebarBackdrop');
    function closeDrawer() {
      if (sidebar) sidebar.classList.remove('open');
      if (backdrop) backdrop.classList.remove('open');
    }
    if (menuBtn) menuBtn.addEventListener('click', function () {
      sidebar.classList.toggle('open');
      if (backdrop) backdrop.classList.toggle('open');
    });
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
    av.addEventListener('click', async function () {
      if (!confirm('Sign out?')) return;
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.replace('/');
    });
  })();

  (async function bootstrap() {
    try {
      var res = await fetch('/api/me', { credentials: 'same-origin' });
      if (!res.ok) { window.location.replace('/'); return; }
      var d = await res.json();
      if (d.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }
      $('avatarBtn').textContent = d.user.email.charAt(0).toUpperCase();
      load();
    } catch (e) { window.location.replace('/'); }
  })();
})();
