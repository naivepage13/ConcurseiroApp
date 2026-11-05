/* Tema claro/escuro. Guarda a escolha só neste aparelho. 'auto' = segue o tema do sistema. */
(function () {
  'use strict';
  var KEY = 'pm_theme';
  function read() { try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; } }
  function apply(v) {
    var el = document.documentElement;
    if (v === 'light' || v === 'dark') el.setAttribute('data-theme', v); else el.removeAttribute('data-theme');
  }
  function set(v) {
    if (v !== 'light' && v !== 'dark') v = 'auto';
    try { if (v === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch (e) { /* sem armazenamento: vale só nesta visita */ }
    apply(v);
  }
  apply(read());
  window.PMTheme = { get: read, set: set };
})();
