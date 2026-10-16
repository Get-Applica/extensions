/**
 * Applica Recruiter Extension - API client for the app backend
 */

const APPLICA_STORAGE_KEYS = {
  APP_ORIGIN: 'applica_recruiter_app_origin',
  AUTH_TOKEN: 'applica_recruiter_auth_token',
  ACTOR: 'applica_recruiter_actor',
};

const DEFAULT_APP_ORIGIN =
  (typeof window !== 'undefined' && window.APPLICA_DEFAULT_APP_ORIGIN) || 'https://app.getapplica.com';

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

async function getStoredActor() {
  return safeStorageGet([APPLICA_STORAGE_KEYS.ACTOR], null);
}

async function setStoredActor(actor) {
  return new Promise((resolve) => {
    safeStorageSet({ [APPLICA_STORAGE_KEYS.ACTOR]: actor }, resolve);
  });
}

async function getStoredRecruiter() {
  const actor = await getStoredActor();
  if (actor?.type === 'recruiter') return actor;
  return null;
}

async function setStoredRecruiter(recruiter) {
  if (!recruiter) return;
  return setStoredActor({ type: 'recruiter', ...recruiter });
}

async function clearAuthToken() {
  return new Promise((resolve) => {
    safeStorageRemove(
      [APPLICA_STORAGE_KEYS.AUTH_TOKEN, APPLICA_STORAGE_KEYS.ACTOR],
      resolve
    );
  });
}

/**
 * Authenticate with recruiter ID and access key (same credentials as /recruiter/login).
 * Returns { ok: true, actor, token } or { ok: false, message }.
 */
async function login(recruiterId, key) {
  const res = await fetch(await appUrl('/api/recruiter/auth'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ id: recruiterId, key }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, message: data.message || 'Login failed' };
  }
  if (data.token) {
    await setAuthToken(data.token);
  }
  const actor = data.actor || (data.recruiter ? { type: 'recruiter', ...data.recruiter } : null);
  if (actor) {
    await setStoredActor(actor);
  }
  return { ok: true, actor, token: data.token };
}

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

/**
 * Fetch message-center emails for a seeker persona.
 * @param {string} personaId
 * @param {{ folderType?: string, page?: number, search?: string }} [options]
 */
async function fetchEmails(personaId, { folderType = 'inbox', page = 1, search = '' } = {}) {
  const params = new URLSearchParams({
    persona_id: personaId,
    folder_type: folderType,
    page: String(page),
  });
  if (search) params.set('search', search);
  return appFetchJson(`/api/emails?${params.toString()}`);
}

window.ApplicaAPI = {
  getAppOrigin,
  setAppOrigin,
  appUrl,
  appFetch,
  appFetchJson,
  fetchEmails,
  getAuthToken,
  setAuthToken,
  getStoredActor,
  setStoredActor,
  getStoredRecruiter,
  setStoredRecruiter,
  clearAuthToken,
  login,
  DEFAULT_APP_ORIGIN,
  STORAGE_KEYS: APPLICA_STORAGE_KEYS,
};
