/* Zaria — extracted inline scripts (CSP compliance) */
(function () {
  "use strict";

  /* --- block 1 --- */
  (function () {

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function (e) {
          console.warn('SW registration failed', e);
        });
      });
    }
  
  })();
})();
