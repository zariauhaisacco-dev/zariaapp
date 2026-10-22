/* Zaria — landing page branding + behavior */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { var el = $(id); if (el && txt) el.textContent = txt; }
  function setHref(id, href) { var el = $(id); if (el && href) el.href = href; }

  // ---- Password show/hide ----
  var passwordInput = $('password');
  var toggleBtn = $('togglePassword');
  if (toggleBtn && passwordInput) {
    toggleBtn.addEventListener('click', function () {
      var showing = passwordInput.type === 'password';
      passwordInput.type = showing ? 'text' : 'password';
      toggleBtn.setAttribute('aria-pressed', String(showing));
      toggleBtn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
      toggleBtn.textContent = showing ? '◎' : '◉';
      passwordInput.focus();
    });
  }

  // ---- Year ----
  var year = $('year');
  if (year) year.textContent = new Date().getFullYear();

  // ---- Fetch branding ----
  fetch('/api/branding', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (b) {
      if (!b) return;

      var logoSrc = b.logo_url ? (b.logo_url + '?v=' + Date.now()) : '/logo.png';

      // Names
      if (b.sacco_name) {
        setText('brandName', b.sacco_name);
        setText('heroName', b.sacco_name);
        setText('footName', b.sacco_name);
        document.title = b.sacco_name + ' | Member Login';
      }

      // Tagline
      if (b.tagline) {
        setText('heroTagline', b.tagline.toUpperCase());
        setText('navTagline', b.tagline.toUpperCase());
      }

      // Mission
      if (b.mission_short) setText('heroMission', b.mission_short);

      // Logos (3 places: nav, hero, login mark)
      ['brandSymbol', 'heroSymbol', 'loginMark'].forEach(function (id) {
        var el = $(id);
        if (el) el.innerHTML = '<img src="' + logoSrc + '" alt="">';
      });

      // Contact
      if (b.contact) {
        var c = b.contact;
        if (c.phone) {
          setText('footPhone', c.phone);
          setHref('footPhone', 'tel:' + c.phone.replace(/[^\d+]/g, ''));
        }
        if (c.whatsapp) {
          setHref('footWhatsapp', 'https://wa.me/' + c.whatsapp.replace(/[^\d]/g, ''));
        }
        if (c.email) {
          setText('footEmail', c.email);
          setHref('footEmailLink', 'mailto:' + c.email);
        }
        if (c.location) setText('footLocation', c.location);
        if (c.hours) setText('footHours', c.hours);
      }
    })
    .catch(function (err) {
      console.warn('[landing-branding]', err.message);
    });

})();
