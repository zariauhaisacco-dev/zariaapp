/* Zaria — inject branding into the landing page */
(function () {
  'use strict';

  function $(sel) { return document.querySelector(sel); }

  function setText(sel, text) {
    var el = document.querySelector(sel);
    if (el && text) el.textContent = text;
  }

  function setHtml(sel, html) {
    var el = document.querySelector(sel);
    if (el) el.innerHTML = html;
  }

  fetch('/api/branding', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (b) {
      if (!b) return;

      // 1. Nav brand — swap "Zaria" text and inject logo image
      var navBrand = document.querySelector('.land-brand');
      if (navBrand) {
        var markEl = navBrand.querySelector('.land-brand-mark');
        var wordEl = navBrand.querySelector('.land-brand-word');
        if (markEl && b.logo_url) {
          markEl.innerHTML = '<img src="' + b.logo_url + '?v=' + Date.now() + '" alt="" style="width:100%;height:100%;object-fit:contain">';
          markEl.style.background = 'transparent';
          markEl.style.padding = '0';
          markEl.style.overflow = 'hidden';
        }
        if (wordEl && b.sacco_name) {
          wordEl.textContent = b.sacco_name;
        }
      }

      // 2. Colors — set CSS custom properties on :root
      if (b.colors) {
        var root = document.documentElement;
        if (b.colors.primary)    root.style.setProperty('--land-accent-primary', b.colors.primary);
        if (b.colors.accent)     root.style.setProperty('--land-accent-gold',    b.colors.accent);
        if (b.colors.background) root.style.setProperty('--land-bg',             b.colors.background);
      }

      // 3. Tagline / hero — optionally inject into the eyebrow or lede
      var eyebrow = document.querySelector('.land-eyebrow span:last-child');
      if (eyebrow && b.tagline) eyebrow.textContent = b.tagline;

      // 4. Footer contact — find the footer and rebuild the contact line
      var foot = document.querySelector('.land-foot');
      if (foot && b.contact) {
        var c = b.contact;
        var line1 = [];
        if (c.phone) line1.push('Talk to us · ' + c.phone);
        if (c.whatsapp) line1.push('WhatsApp ' + c.whatsapp);
        if (c.email) line1.push('<a href="mailto:' + c.email + '">' + c.email + '</a>');

        var line2 = [];
        if (c.location) line2.push(c.location);
        if (c.hours) line2.push(c.hours);

        var html = '';
        if (line1.length) html += '<div style="margin-bottom:8px">' + line1.join(' · ') + '</div>';
        if (line2.length) html += '<div style="margin-bottom:8px">' + line2.join(' · ') + '</div>';
        html += '<div>© <span id="year"></span> ' + (b.sacco_name || 'Zaria Uhai SACCO') + ' · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></div>';

        foot.innerHTML = html;

        // Re-apply year
        var yr = document.getElementById('year');
        if (yr) yr.textContent = new Date().getFullYear();
      }

      // 5. Page title
      if (b.sacco_name) {
        document.title = b.sacco_name + (b.tagline ? ' — ' + b.tagline : '');
      }
    })
    .catch(function (err) {
      console.warn('[landing-branding]', err.message);
    });
})();
