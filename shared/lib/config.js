/**
 * Local-dev default only. Builds overwrite dist/<target>/lib/config.js from APPLICA_ENV
 * (see scripts/package.sh). At runtime, chrome.storage.local
 * may override via applica_*_app_origin if set in DevTools.
 */
window.APPLICA_DEFAULT_APP_ORIGIN = 'http://localhost:4000';
