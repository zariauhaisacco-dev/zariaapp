/* Zaria — PWA install prompt for the landing page */
(function () {
  'use strict';

  var deferredPrompt = null;
  var navBtn = document.getElementById('installNavBtn');
  var heroBtn = document.getElementById('installHeroBtn');
  var isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
                    window.navigator.standalone === true;

  // Already installed — never show the buttons
  if (isInstalled) return;

  function showButtons() {
    if (navBtn) navBtn.hidden = false;
    if (heroBtn) heroBtn.hidden = false;
  }

  function hideButtons() {
    if (navBtn) navBtn.hidden = true;
    if (heroBtn) heroBtn.hidden = true;
  }

  // Chrome / Edge / Samsung Internet
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showButtons();
  });

  // iOS Safari — no beforeinstallprompt event. Show a fallback that opens instructions.
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isIOS && isSafari) {
    showButtons();
  }

  async function triggerInstall() {
    // If native prompt is available, use it
    if (deferredPrompt) {
      deferredPrompt.prompt();
      var choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (choice.outcome === 'accepted') {
        hideButtons();
      }
      return;
    }

    // iOS fallback — show instructions
    if (isIOS) {
      alert(
        'To install Zaria on your iPhone:\n\n' +
        '1. Tap the Share button (square with arrow)\n' +
        '2. Scroll down and tap "Add to Home Screen"\n' +
        '3. Tap "Add"'
      );
      return;
    }

    // Other browsers without native prompt
    alert(
      'To install Zaria:\n\n' +
      '• On desktop Chrome / Edge: look for the install icon in the address bar\n' +
      '• On Android Chrome: menu (three dots) → "Install app"'
    );
  }

  if (navBtn) navBtn.addEventListener('click', triggerInstall);
  if (heroBtn) heroBtn.addEventListener('click', triggerInstall);

  // If the app gets installed mid-session, hide buttons
  window.addEventListener('appinstalled', function () {
    hideButtons();
    // Optional: show a small success toast
    var toast = document.createElement('div');
    toast.textContent = 'Zaria installed to your home screen';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
      'background:#0B1F3A;color:#F5B301;padding:12px 20px;border-radius:10px;' +
      'font-size:13px;font-weight:600;box-shadow:0 12px 32px rgba(0,0,0,0.4);z-index:9999;' +
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 4000);
  });
})();
