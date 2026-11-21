// Runs before the app renders so the page never flashes the wrong theme or text direction.
(function () {
  var pref = 'dark';
  var lang = null;
  try {
    pref = localStorage.getItem('sb-theme') || 'dark';
    lang = localStorage.getItem('bm-lang'); // 'en' | 'ar' | null (= follow the device)
  } catch (e) {}
  if (lang !== 'ar' && lang !== 'en') {
    // Default: the device's language (Arabic phones get Arabic, everything else English).
    lang = 'en';
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < list.length; i++) {
      var base = String(list[i] || '').toLowerCase().split('-')[0];
      if (base === 'ar' || base === 'en') { lang = base; break; }
    }
  }
  var light = pref === 'light' || (pref === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
  var root = document.documentElement;
  root.setAttribute('data-theme', light ? 'light' : 'dark');
  root.setAttribute('lang', lang);
  root.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
})();
