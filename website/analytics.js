/*
 * Google Analytics 4 — loaded as a deferred asset from every marketing page's <head>
 * (<script defer src="/analytics.js"></script>). Kept as ONE asset rather than inlined
 * per page so the Measurement ID lives in a single place: change it here, not in six
 * files. GitHub Pages serves the static site with no CSP, so Google's gtag.js loads
 * normally.
 *
 * SAFE UNTIL CONFIGURED: with the placeholder id it no-ops — it neither loads gtag.js
 * nor sets a cookie — so shipping the wiring ahead of the real id tracks nothing by
 * accident. Set the real G-XXXXXXXXXX id below (Analytics → Admin → Data streams → Web →
 * Measurement ID) and it goes live on the next deploy.
 */
(function () {
  var ID = 'G-WYVM7KVRMH';
  if (ID.indexOf('G-') !== 0 || ID === 'G-XXXXXXXXXX') return; // no id yet → do nothing
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', ID);
})();
