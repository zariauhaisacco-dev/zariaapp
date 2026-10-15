/* Zaria — inject branding into the landing page */
(function () {
  'use strict';

  function set(id, text) {
    var el = document.getElementById(id);
    if (el && text) el.textContent = text;
  }

  function setHtml(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function setHref(id, href) {
    var el = document.getElementById(id);
    if (el && href) el.href = href;
  }

  fetch('/api/branding', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (b) {
      if (!b) return;

      var logoSrc = b.logo_url ? (b.logo_url + '?v=' + Date.now()) : '/logo.png';

      // Brand name
      if (b.sacco_name) {
        set('brandName', b.sacco_name);
        set('heroName', b.sacco_name);
        set('footName', b.sacco_name);
        document.title = b.sacco_name + (b.tagline ? ' — ' + b.tagline : '');
      }

      // Tagline + mission
      if (b.tagline) set('heroTagline', b.tagline);
      if (b.mission_short) set('heroMission', b.mission_short);

      // Logo
      setHtml('brandLogo', '<img src="' + logoSrc + '" alt="">');
      setHtml('heroLogo', ''); // clear
      var heroEl = document.getElementById('heroLogo');
      if (heroEl) heroEl.src = logoSrc;

      // Colors — set CSS custom properties
      if (b.colors) {
        var r = document.documentElement;
        if (b.colors.primary)    r.style.setProperty('--brand-primary', b.colors.primary);
        if (b.colors.accent)     r.style.setProperty('--brand-accent',  b.colors.accent);
        if (b.colors.background) r.style.setProperty('--brand-background', b.colors.background);
      }

      // Contact
      if (b.contact) {
        var c = b.contact;
        if (c.phone)    set('footPhone', c.phone);
        if (c.whatsapp) set('footWhatsapp', c.whatsapp);
        if (c.email) {
          set('footEmail', c.email);
          setHref('footEmailLink', 'mailto:' + c.email);
        }
        if (c.location) set('footLocation', c.location);
        if (c.hours)    set('footHours', c.hours);
      }

      // Meta theme-color
      if (b.colors && b.colors.primary) {
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', b.colors.primary);
      }
    })
    .catch(function (err) {
      console.warn('[landing-branding]', err.message);
    });
})();
