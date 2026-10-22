/* Zaria — shared client sidebar renderer.
 * Injects a uniform sidebar into any page that has <aside id="sidebarHost"></aside>.
 * Falls back to replacing an existing .sidebar element if present.
 * Highlights the active item based on window.location.pathname.
 *
 * Added: 2026-10-21
 */
(function () {
  'use strict';

  var ITEMS = [
    { section: 'My account' },
    { label: 'Overview',         href: '/client/dashboard',    icon: 'grid'  },
    { label: 'My loans',         href: '/client/loans',        icon: 'card'  },
    { label: 'My contributions', href: '/client/savings',      icon: 'cash'  },
    { label: 'Transactions',     href: '/client/transactions', icon: 'list'  },
    { label: 'My shares',        href: '/client/shares',       icon: 'chart' },
    { label: 'My dividends',     href: '/client/dividends',    icon: 'coin'  },
    { label: 'Profile',          href: '/client/profile',      icon: 'user'  },
    { section: 'Services' },
    { label: 'Request a loan',   href: '/client/request',      icon: 'plus'  },
    { label: 'My Chama',         href: '/client/chama',        icon: 'users' },
    { label: 'Statements',       href: '/client/statements',   icon: 'file'  }
  ];

  var ICONS = {
    grid:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h7V3H3zM14 21h7V10h-7zM3 21h7v-6H3zM14 7h7V3h-7z"/></svg>',
    card:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16v12H4zM4 11h16"/></svg>',
    cash:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M6 8h12M6 16h12"/></svg>',
    list:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v6H4zM4 14h16v6H4z"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20h18M7 16v-6M12 16V6M17 16v-9"/></svg>',
    coin:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    user:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2"/></svg>',
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><path d="M2 21v-2a4 4 0 014-4h6a4 4 0 014 4v2M14 21v-2a4 4 0 014-4h2a4 4 0 014 4v2"/></svg>',
    file:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h9l5 5v13H6z"/><path d="M14 3v6h6"/></svg>'
  };

  function isActive(href, path) {
    if (href === '/client/dashboard') {
      return path === '/client/dashboard' || path === '/client/' || path === '/client';
    }
    if (href === '/client/loans') {
      // /client/loans and /client/loans/123 and /client/loan-detail all count as loans
      return path === '/client/loans' || path.indexOf('/client/loans/') === 0 || path === '/client/loan-detail';
    }
    return path === href || path.indexOf(href + '/') === 0;
  }

  function render() {
    var host = document.getElementById('sidebar') || document.getElementById('sidebarHost');
    if (!host) {
      // Backwards-compat: replace existing .sidebar element
      host = document.querySelector('.sidebar');
      if (!host) return;
    }

    var path = window.location.pathname;
    var html = '<nav>';
    var sectionOpen = false;

    ITEMS.forEach(function (item) {
      if (item.section) {
        if (sectionOpen) html += '</div>';
        html += '<div class="nav-group"><div class="nav-group-label">' + item.section + '</div>';
        sectionOpen = true;
        return;
      }
      var active = isActive(item.href, path) ? ' active' : '';
      var icon = item.icon && ICONS[item.icon] ? ICONS[item.icon] : '';
      html += '<a class="nav-item' + active + '" href="' + item.href + '">' +
                icon +
                '<span>' + item.label + '</span>' +
              '</a>';
    });
    if (sectionOpen) html += '</div>';
    html += '</nav>';

    host.innerHTML = html;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
