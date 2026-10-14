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

  /*
   * Click events — one delegated listener, so new links are tracked without touching
   * the HTML. `location` says WHICH button: nav, hero, download, start (final CTA),
   * footer… taken from the nearest nav/footer or the section's id (or first class).
   *   create_account_click — any link to app.ezchangeorders.com
   *   app_store_click      — the App Store badge
   *   section_link_click   — in-page links like "See how it works" (#how)
   *   language_switch      — the EN / ES toggle
   */
  function where(el) {
    var box = el.closest('nav, footer, section');
    if (!box) return 'other';
    if (box.tagName !== 'SECTION') return box.tagName.toLowerCase();
    return box.id || box.classList[0] || 'section';
  }
  document.addEventListener('click', function (e) {
    var lang = e.target.closest('.lang-button');
    if (lang) { gtag('event', 'language_switch', { language: lang.dataset.lang }); return; }
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    var text = a.textContent.trim().slice(0, 100);
    if (a.hostname === 'app.ezchangeorders.com') {
      gtag('event', 'create_account_click', { location: where(a), link_text: text });
    } else if (a.hostname === 'apps.apple.com') {
      gtag('event', 'app_store_click', { location: where(a) });
    } else if (href.charAt(0) === '#' && href.length > 1) {
      gtag('event', 'section_link_click', { section: href.slice(1), location: where(a), link_text: text });
    }
  });
})();
