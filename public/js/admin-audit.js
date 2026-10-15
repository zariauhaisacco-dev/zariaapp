/* Zaria — Admin audit log */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { page: 1, per_page: 50, q: '', action: '', actor_role: '', from: '', to: '' };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  async function load() {
    var wrap = $('listWrap');
    wrap.innerHTML = '<div class="empty" style="padding:40px 20px">Loading…</div>';

    try {
      var params = new URLSearchParams();
      params.set('page', state.page);
      params.set('per_page', state.per_page);
      if (state.q) params.set('q', state.q);
      if (state.action) params.set('action', state.action);
      if (state.actor_role) params.set('actor_role', state.actor_role);
      if (state.from) params.set('from', state.from);
      if (state.to) params.set('to', state.to);

      var res = await fetch('/api/admin/audit?' + params.toString(), { credentials: 'same-origin' });
      if (res.status === 401) { window.location.replace('/'); return; }
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'load');

      render(data);
      $('exportBtn').href = '/api/admin/audit/export.csv?' + params.toString();
    } catch (e) {
      wrap.innerHTML = '<div class="empty" style="padding:40px 20px;color:var(--neg)">Could not load</div>';
    }
  }

  function render(data) {
    var wrap = $('listWrap');
    var events = data.events || [];
    var total = data.total || 0;
    var pages = data.pages || 1;

    $('countLabel').textContent = total.toLocaleString() + ' event' + (total === 1 ? '' : 's');

    if (!events.length) {
      wrap.innerHTML = '<div class="empty" style="padding:60px 20px">No events match these filters</div>';
      $('paginationWrap').innerHTML = '';
      return;
    }

    var rows = events.map(function (e, idx) {
      var actorText = e.actor_email
        ? escapeHtml(e.actor_email)
        : (e.actor_user_id ? 'User #' + e.actor_user_id : 'System');

      var entityText = e.entity_type + (e.entity_id ? ' #' + e.entity_id : '');

      return '<div class="audit-row" data-idx="' + idx + '">' +
          '<div class="audit-ts">' + fmtDateTime(e.created_at) + '</div>' +
          '<div>' +
            '<div class="audit-action">' + escapeHtml(e.action) + '</div>' +
            '<div class="audit-actor">' + actorText + ' · ' + e.actor_role + '</div>' +
          '</div>' +
          '<div class="audit-entity">' + escapeHtml(entityText) + '</div>' +
          '<div class="audit-ip">' + escapeHtml(e.ip_address || '—') + '</div>' +
          '<div class="audit-actor" style="font-size:11px;text-align:right">' +
            (e.old_values || e.new_values ? 'Details ▾' : '') +
          '</div>' +
        '</div>' +
        '<div class="audit-detail">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
            (e.old_values ? '<div><div class="label">Before</div><pre>' + escapeHtml(JSON.stringify(e.old_values, null, 2)) + '</pre></div>' : '') +
            (e.new_values ? '<div><div class="label">After</div><pre>' + escapeHtml(JSON.stringify(e.new_values, null, 2)) + '</pre></div>' : '') +
          '</div>' +
          (e.user_agent ? '<div style="margin-top:12px"><div class="label">User agent</div><div style="font-family:var(--font-mono);font-size:11px;color:var(--ink-500);word-break:break-all">' + escapeHtml(e.user_agent) + '</div></div>' : '') +
        '</div>';
    }).join('');

    wrap.innerHTML = rows;

    // Row click toggle
    wrap.querySelectorAll('.audit-row').forEach(function (row) {
      row.addEventListener('click', function () {
        row.classList.toggle('expanded');
      });
    });

    renderPagination(data.page, pages, total);
  }

  function renderPagination(current, pages, total) {
    var wrap = $('paginationWrap');
    if (pages <= 1) { wrap.innerHTML = ''; return; }

    function btn(label, page, disabled) {
      return '<button type="button" data-page="' + page + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button>';
    }

    var html = '';
    html += btn('← Prev', current - 1, current <= 1);
    html += '<span class="page-info">Page ' + current + ' of ' + pages + ' · ' + total.toLocaleString() + ' total</span>';
    html += btn('Next →', current + 1, current >= pages);

    wrap.innerHTML = '<div class="pagination">' + html + '</div>';

    wrap.querySelectorAll('[data-page]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = parseInt(b.getAttribute('data-page'), 10);
        if (p >= 1 && p <= pages) {
          state.page = p;
          load();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  // Load action names for the dropdown
  async function loadActions() {
    try {
      var res = await fetch('/api/admin/audit/actions', { credentials: 'same-origin' });
      if (!res.ok) return;
      var data = await res.json();
      var sel = $('actionSelect');
      (data.actions || []).forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        sel.appendChild(opt);
      });
    } catch (e) { /* ignore */ }
  }

  // Filter handlers
  $('applyBtn').addEventListener('click', function () {
    state.q = $('qInput').value.trim();
    state.action = $('actionSelect').value;
    state.actor_role = $('roleSelect').value;
    state.from = $('fromDate').value;
    state.to = $('toDate').value;
    state.page = 1;
    load();
  });

  $('clearBtn').addEventListener('click', function () {
    $('qInput').value = '';
    $('actionSelect').value = '';
    $('roleSelect').value = '';
    $('fromDate').value = '';
    $('toDate').value = '';
    state = { page: 1, per_page: 50, q: '', action: '', actor_role: '', from: '', to: '' };
    load();
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

  // Bootstrap
  (async function bootstrap() {
    try {
      var res = await fetch('/api/me', { credentials: 'same-origin' });
      if (!res.ok) { window.location.replace('/'); return; }
      var d = await res.json();
      if (d.user.role !== 'admin') { window.location.replace('/client/dashboard'); return; }
      $('avatarBtn').textContent = d.user.email.charAt(0).toUpperCase();

      await loadActions();
      load();
    } catch (e) {
      window.location.replace('/');
    }
  })();
})();
