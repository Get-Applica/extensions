/**
 * Applica Extension - API client for the app backend
 * App origin: use value from storage, or config.js default (see config.js).
 */

const APPLICA_STORAGE_KEYS = {
  APP_ORIGIN: 'applica_app_origin',
  AUTH_TOKEN: 'applica_auth_token',
  USER: 'applica_user',
};

const DEFAULT_APP_ORIGIN =
  (typeof window !== 'undefined' && window.APPLICA_DEFAULT_APP_ORIGIN) || 'https://app.getapplica.com';

/** Catch "Extension context invalidated" when extension was reloaded while a page was open. */
function safeStorageGet(keys, defaultVal) {
  return new Promise((resolve) => {
    try {
      if (!chrome?.storage?.local) {
        resolve(defaultVal);
        return;
      }
      chrome.storage.local.get(keys, (data) => {
        try {
          const val = keys.length === 1 ? (data?.[keys[0]] ?? defaultVal) : data;
          resolve(val);
        } catch (_) {
          resolve(defaultVal);
        }
      });
    } catch (_) {
      resolve(defaultVal);
    }
  });
}

function safeStorageSet(items, cb) {
  try {
    if (!chrome?.storage?.local) {
      if (cb) cb();
      return;
    }
    chrome.storage.local.set(items, () => { try { if (cb) cb(); } catch (_) {} });
  } catch (_) {
    if (cb) cb();
  }
}

function safeStorageRemove(keys, cb) {
  try {
    if (!chrome?.storage?.local) {
      if (cb) cb();
      return;
    }
    chrome.storage.local.remove(keys, () => { try { if (cb) cb(); } catch (_) {} });
  } catch (_) {
    if (cb) cb();
  }
}

async function getAppOrigin() {
  const val = await safeStorageGet([APPLICA_STORAGE_KEYS.APP_ORIGIN], null);
  return val || DEFAULT_APP_ORIGIN;
}

async function setAppOrigin(origin) {
  return new Promise((resolve) => {
    safeStorageSet({ [APPLICA_STORAGE_KEYS.APP_ORIGIN]: origin }, resolve);
  });
}

/**
 * Build full URL for an app path (e.g. "/user/log_in").
 */
async function appUrl(path) {
  const origin = await getAppOrigin();
  const base = origin.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

async function getAuthToken() {
  return safeStorageGet([APPLICA_STORAGE_KEYS.AUTH_TOKEN], null);
}

async function setAuthToken(token) {
  return new Promise((resolve) => {
    safeStorageSet({ [APPLICA_STORAGE_KEYS.AUTH_TOKEN]: token }, resolve);
  });
}

async function getStoredUser() {
  return safeStorageGet([APPLICA_STORAGE_KEYS.USER], null);
}

async function setStoredUser(user) {
  return new Promise((resolve) => {
    safeStorageSet({ [APPLICA_STORAGE_KEYS.USER]: user }, resolve);
  });
}

async function clearAuthToken() {
  return new Promise((resolve) => {
    safeStorageRemove(
      [APPLICA_STORAGE_KEYS.AUTH_TOKEN, APPLICA_STORAGE_KEYS.USER],
      resolve
    );
  });
}

/**
 * Log in via the app API. On success, stores the token for future appFetch calls.
 * Returns { ok: true, user } or { ok: false, message }.
 */
async function login(email, password) {
  const res = await fetch(await appUrl('/api/auth'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, message: data.message || 'Login failed' };
  }
  if (data.token) {
    await setAuthToken(data.token);
  }
  if (data.user) {
    await setStoredUser(data.user);
  }
  return { ok: true, user: data.user, token: data.token };
}

/**
 * Fetch from the app. Sends stored auth token in Authorization header when present.
 * Throws with a descriptive message if the request fails (network, CORS, etc.).
 */
async function appFetch(path, options = {}) {
  const url = await appUrl(path);
  const token = await getAuthToken();
  const headers = {
    Accept: 'application/json',
    ...options.headers,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });
    return response;
  } catch (err) {
    const msg = err?.message || String(err);
    const cause = err?.cause ? ` (${err.cause?.message || err.cause})` : '';
    throw new Error(`Request to ${url} failed: ${msg}${cause}`);
  }
}

/**
 * appFetch + JSON parse. Throws Error with server message when !res.ok.
 * Returned object is the parsed JSON body.
 */
async function appFetchJson(path, options = {}) {
  const res = await appFetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.message || `Request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

// Export for use in drawer (and potentially other extension pages)
window.ApplicaAPI = {
  getAppOrigin,
  setAppOrigin,
  appUrl,
  appFetch,
  appFetchJson,
  getAuthToken,
  setAuthToken,
  getStoredUser,
  setStoredUser,
  clearAuthToken,
  login,
  DEFAULT_APP_ORIGIN,
  STORAGE_KEYS: APPLICA_STORAGE_KEYS,
};
