/**
 * Applica Extension - Content Script
 * Injects a left-hand drawer that pops out when the extension is activated.
 * Also detects the app's extension callback page and stores the token so the background can close the tab.
 */

(function () {
  // Idempotent: when injected on click (any page), avoid running twice
  if (window.__applicaContentInjected) return;
  window.__applicaContentInjected = true;

  const DRAWER_WIDTH = 500;
  const EXTENSION_CALLBACK_PATH = '/user/log_in/extension_callback';
  const STORAGE = (typeof window !== 'undefined' && window.ApplicaConstants?.STORAGE) || {};
  const STORAGE_KEYS = {
    AUTH_TOKEN: STORAGE.AUTH_TOKEN || 'applica_auth_token',
    APP_ORIGIN: STORAGE.APP_ORIGIN || 'applica_app_origin',
    REOPEN_DRAWER_TS: STORAGE.REOPEN_DRAWER_TS || 'applica_reopen_drawer_ts',
  };
  const REOPEN_DRAWER_TTL_MS = 20000; // 20s so slow-loading job pages still get the drawer
  const DEFAULT_ORIGIN = (typeof window !== 'undefined' && window.APPLICA_DEFAULT_APP_ORIGIN) || 'https://app.getapplica.com';

  // Detect app extension callback: same-origin page with one-time code in URL; exchange for token via API.
  const params = new URLSearchParams(window.location.search);
  if (window.location.pathname === EXTENSION_CALLBACK_PATH && params.get('code')) {
    const code = params.get('code');
    const origin = window.location.origin;
    (async function () {
      try {
        const res = await fetch(origin + '/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ code: code }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showCallbackError(data.message || 'Could not complete sign-in.');
          return;
        }
        const token = data.token;
        const user = data.user ?? null;
        if (!token) {
          showCallbackError('Invalid response from server.');
          return;
        }
        await new Promise((resolve) => {
          chrome.storage.local.set(
            { applica_auth_token: token, applica_user: user || undefined },
            resolve
          );
        });
        window.close(); // Tab was opened by extension; no "tabs" permission needed
      } catch (err) {
        showCallbackError(err?.message || 'Request failed.');
      }
    })();
  }

  function showCallbackError(message) {
    try {
      const el = document.body || document.documentElement;
      const msg = document.createElement('p');
      msg.style.color = '#b91c1c';
      msg.style.marginTop = '1rem';
      msg.textContent = message;
      el.appendChild(msg);
    } catch (_) {}
  }
  const ANIMATION_MS = 250;

  let drawerEl = null;
  let overlayEl = null;
  let iframeEl = null;
  let isOpen = false;

  function getExtensionURL(path) {
    try {
      var rt = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
      if (rt && typeof rt.getURL === 'function') {
        return rt.getURL(path);
      }
      return '';
    } catch (_) {
      return '';
    }
  }

  function createDrawer() {
    if (drawerEl) return drawerEl;

    overlayEl = document.createElement('div');
    overlayEl.id = 'applica-drawer-overlay';
    overlayEl.className = 'applica-overlay';
    /* Overlay is visual only; no click-to-close so the page stays interactive */

    drawerEl = document.createElement('div');
    drawerEl.id = 'applica-drawer';
    drawerEl.className = 'applica-drawer';

    const logoUrl = getExtensionURL('images/applica_logo.png');
    const header = document.createElement('div');
    header.className = 'applica-drawer-header';
    header.innerHTML = `
      <div class="applica-drawer-header-brand">
        <img src="${logoUrl}" alt="Applica" class="applica-drawer-logo" title="Applica" />
        <p class="applica-drawer-tagline">Make your job hunt strategic.</p>
      </div>
      <button type="button" class="applica-drawer-close" aria-label="Close drawer">&times;</button>
    `;
    header.querySelector('.applica-drawer-close').addEventListener('click', closeDrawer);

    iframeEl = document.createElement('iframe');
    iframeEl.id = 'applica-drawer-frame';
    iframeEl.className = 'applica-drawer-frame';
    iframeEl.allow = 'clipboard-write';
    iframeEl.src = getExtensionURL('drawer/drawer.html');
    iframeEl.addEventListener('load', function onLoad() {
      if (isOpen) {
        lastNotifiedPageUrl = window.location.href;
        notifyDrawerOpened();
      }
    });

    drawerEl.appendChild(header);
    drawerEl.appendChild(iframeEl);

    document.body.appendChild(overlayEl);
    document.body.appendChild(drawerEl);

    return drawerEl;
  }

  function getDrawerContentWindow() {
    const win = iframeEl?.contentWindow;
    if (!win || win === window) return null;
    return win;
  }

  async function copyToClipboardInPage(text) {
    const value = text == null ? '' : String(text);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch (_) {
        // Fall through to execCommand below.
      }
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!copied) {
      throw new Error('Could not copy to clipboard.');
    }
  }

  function sendCopyResultToDrawer(requestId, ok) {
    const win = getDrawerContentWindow();
    if (!win) return;
    try {
      win.postMessage({ type: 'applica-copy-to-clipboard-result', requestId, ok: !!ok }, DRAWER_POST_MESSAGE_TARGET);
    } catch (e) {
      console.debug('Applica: could not send copy result', e);
    }
  }

  /**
   * Parent → drawer postMessage target. Use '*' because before the extension document loads the
   * iframe is about:blank with the host page's origin (e.g. jobs.ashbyhq.com) while iframe.src
   * already points at chrome-extension:// — a specific target origin then throws. Incoming
   * messages are gated by event.source === iframeEl.contentWindow.
   */
  const DRAWER_POST_MESSAGE_TARGET = '*';

  function postToDrawer(message) {
    const win = getDrawerContentWindow();
    if (!win) return;
    try {
      win.postMessage(message, DRAWER_POST_MESSAGE_TARGET);
    } catch (e) {
      console.debug('Applica: could not post to drawer', e);
    }
  }

  function postPageDataToDrawer(drawerWindow, payload) {
    if (!drawerWindow || drawerWindow === window) return;
    const win = getDrawerContentWindow();
    if (!win || drawerWindow !== win) return;
    try {
      drawerWindow.postMessage(payload, DRAWER_POST_MESSAGE_TARGET);
    } catch (e) {
      console.debug('Applica: could not post page data to drawer', e);
    }
  }

  /** Hosts that only serve job postings / applications (any page on them counts). */
  const JOB_SITE_HOSTS = [
    /(^|\.)lever\.co$/,
    /(^|\.)greenhouse\.io$/,
    /(^|\.)ashbyhq\.com$/,
    /(^|\.)myworkdayjobs\.com$/,
    /(^|\.)myworkdaysite\.com$/,
    /(^|\.)smartrecruiters\.com$/,
    /(^|\.)jobvite\.com$/,
    /(^|\.)icims\.com$/,
    /(^|\.)bamboohr\.com$/,
    /(^|\.)workable\.com$/,
    /(^|\.)recruitee\.com$/,
    /(^|\.)breezy\.hr$/,
    /(^|\.)teamtailor\.com$/,
    /(^|\.)applytojob\.com$/,
    /(^|\.)wellfound\.com$/
  ];

  /** Boards that also serve non-job pages: only specific job URLs count. */
  function isJobBoardJobUrl(url) {
    const host = url.hostname;
    if (/(^|\.)linkedin\.com$/.test(host)) {
      return url.pathname.startsWith('/jobs/view/') || url.searchParams.has('currentJobId');
    }
    if (/(^|\.)indeed\.com$/.test(host)) {
      return url.pathname.startsWith('/viewjob') || url.searchParams.has('vjk') || url.searchParams.has('jk');
    }
    if (/(^|\.)glassdoor\.[a-z.]+$/.test(host)) {
      return url.pathname.includes('/job-listing/') || url.searchParams.has('jl');
    }
    return false;
  }

  function findJobPostingNode(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findJobPostingNode(item);
        if (found) return found;
      }
      return null;
    }
    const type = node['@type'];
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return node;
    return findJobPostingNode(node['@graph']);
  }

  function textOrNull(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 200) : null;
  }

  /**
   * Cheap check for "is this a job posting?" so the drawer can say so before analyzing.
   * Structured data (schema.org JobPosting) first, then known job sites. Never throws.
   */
  function detectJobPosting() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        let parsed = null;
        try {
          parsed = JSON.parse(script.textContent || '');
        } catch (_) {
          continue;
        }
        const posting = findJobPostingNode(parsed);
        if (posting) {
          const org = posting.hiringOrganization;
          return {
            found: true,
            source: 'structured-data',
            title: textOrNull(posting.title),
            company: textOrNull(typeof org === 'string' ? org : org?.name)
          };
        }
      }
      const url = new URL(window.location.href);
      if (JOB_SITE_HOSTS.some((re) => re.test(url.hostname)) || isJobBoardJobUrl(url)) {
        // No structured data: the tab title ("Senior Engineer - Acme | Lever") is the best label we have.
        return { found: true, source: 'job-site', title: textOrNull(document.title), company: null };
      }
    } catch (_) {}
    return { found: false, source: null, title: null, company: null };
  }

  function notifyDrawerOpened() {
    postToDrawer({
      type: 'applica-drawer-opened',
      currentPageUrl: window.location.href,
      pageOrigin: window.location.origin,
      pageJob: detectJobPosting()
    });
  }

  /** Shortcut commands from the background worker wait here until the drawer document is ready. */
  let drawerDocReady = false;
  let pendingDrawerCommand = null;

  function flushPendingDrawerCommand() {
    if (!drawerDocReady || !pendingDrawerCommand) return;
    const command = pendingDrawerCommand;
    pendingDrawerCommand = null;
    postToDrawer({ type: 'applica-run-command', command });
  }

  /** Keep drawer page context in sync on SPA job boards (LinkedIn, Workday, etc.). */
  let lastNotifiedPageUrl = window.location.href;
  let spaUrlPollId = null;
  const SPA_URL_POLL_MS = 1000;

  function notifyPageUrlIfDrawerOpen() {
    const href = window.location.href;
    if (!isOpen || href === lastNotifiedPageUrl) return;
    lastNotifiedPageUrl = href;
    notifyDrawerOpened();
  }

  function startSpaUrlWatch() {
    if (spaUrlPollId != null) return;
    spaUrlPollId = window.setInterval(notifyPageUrlIfDrawerOpen, SPA_URL_POLL_MS);
  }

  function stopSpaUrlWatch() {
    if (spaUrlPollId == null) return;
    window.clearInterval(spaUrlPollId);
    spaUrlPollId = null;
  }

  function patchHistoryMethod(methodName) {
    const original = history[methodName];
    if (typeof original !== 'function') return;
    history[methodName] = function (...args) {
      const result = original.apply(this, args);
      notifyPageUrlIfDrawerOpen();
      return result;
    };
  }

  window.addEventListener('popstate', notifyPageUrlIfDrawerOpen);
  window.addEventListener('hashchange', notifyPageUrlIfDrawerOpen);
  patchHistoryMethod('pushState');
  patchHistoryMethod('replaceState');

  /**
   * Wait until after load + a short delay so React/Next.js hydration can finish.
   * Injecting nodes into document.body during hydration causes React error #425 on SSR pages.
   */
  function runWhenDomSafe(fn) {
    const delayMs = 400;
    const run = () => window.setTimeout(fn, delayMs);
    if (document.readyState === 'complete') {
      run();
    } else {
      window.addEventListener('load', run, { once: true });
    }
  }

  function openDrawer() {
    if (isOpen) return;
    createDrawer();
    isOpen = true;
    document.body.classList.add('applica-drawer-open');
    overlayEl.classList.add('applica-overlay-visible');
    drawerEl.classList.add('applica-drawer-visible');
    document.documentElement.style.setProperty('--applica-drawer-width', `${DRAWER_WIDTH}px`);
    startSpaUrlWatch();
    /* notifyDrawerOpened runs on iframe load and applica-drawer-ready (extension doc must be loaded) */
  }

  function closeDrawer() {
    if (!isOpen) return;
    isOpen = false;
    stopSpaUrlWatch();
    document.body.classList.remove('applica-drawer-open');
    overlayEl.classList.remove('applica-overlay-visible');
    drawerEl.classList.remove('applica-drawer-visible');
  }

  function toggleDrawer() {
    isOpen ? closeDrawer() : openDrawer();
  }

  window.addEventListener('applica-drawer-toggle', toggleDrawer);

  window.addEventListener('applica-drawer-command', (event) => {
    const command = event?.detail?.command;
    if (typeof command !== 'string') return;
    pendingDrawerCommand = command;
    if (!isOpen) {
      openDrawer();
      if (drawerDocReady) {
        lastNotifiedPageUrl = window.location.href;
        notifyDrawerOpened();
      }
    }
    flushPendingDrawerCommand();
  });

  const MAX_ANALYZE_HTML_CHARS = 450000;
  const ANALYZE_HTML_SELECTORS = [
    '.jobs-description__container',
    '.jobs-description',
    '.job-view-layout',
    '.jobsearch-JobComponent',
    '[data-testid="job-details"]',
    '.posting',
    '#job-description',
    '.job-description',
    'article',
    'main',
    '[role="main"]'
  ];

  function wrapHtmlFragmentAsDocument(fragment) {
    return (
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
      fragment +
      '</body></html>'
    );
  }

  /**
   * Full page HTML by default (server extract_main_content requires a <body>).
   * If oversized, prefer a job subtree wrapped as a document, then truncate.
   */
  function capturePageHtmlForAnalyze() {
    const fullHtml = document.documentElement?.outerHTML || document.body?.outerHTML || '';
    let html = fullHtml;
    let source = 'document';
    let truncated = false;

    if (fullHtml.length > MAX_ANALYZE_HTML_CHARS) {
      let fragment = '';
      for (const selector of ANALYZE_HTML_SELECTORS) {
        let el = null;
        try {
          el = document.querySelector(selector);
        } catch (_) {
          continue;
        }
        if (!el) continue;
        const slice = el.outerHTML || '';
        if (slice.length < 500) continue;
        fragment = slice;
        source = selector;
        break;
      }
      if (fragment) {
        html = wrapHtmlFragmentAsDocument(fragment);
      }
    }

    if (html.length > MAX_ANALYZE_HTML_CHARS) {
      // Keep a well-formed prefix ending inside body when possible.
      html = html.slice(0, MAX_ANALYZE_HTML_CHARS);
      if (!/<\/body>/i.test(html)) {
        html += '</body></html>';
      }
      truncated = true;
    }

    return { html, truncated, source };
  }

  // Listen for messages from the drawer iframe
  window.addEventListener('message', (event) => {
    if (event.source !== iframeEl?.contentWindow) return;
    if (event.data?.type === 'applica-drawer-close') {
      closeDrawer();
      return;
    }
    if (event.data?.type === 'applica-drawer-ready') {
      drawerDocReady = true;
      if (isOpen) {
        lastNotifiedPageUrl = window.location.href;
        notifyDrawerOpened();
        // Do not fetch personas from content script: fetch runs in page context and is blocked by CORS
        // on strict sites (e.g. Workday). The drawer iframe (extension origin) will fetch on applica-drawer-opened.
        flushPendingDrawerCommand();
      }
      return;
    }
    if (event.data?.type === 'applica-analyze-current-page') {
      const drawerWindow = getDrawerContentWindow();
      if (!drawerWindow || event.source !== drawerWindow) return;
      const requestId = event.data.requestId;
      try {
        const url = window.location.href;
        const captured = capturePageHtmlForAnalyze();
        postPageDataToDrawer(drawerWindow, {
          type: 'applica-page-data',
          requestId,
          url,
          html: captured.html,
          htmlTruncated: captured.truncated,
          htmlSource: captured.source
        });
      } catch (e) {
        console.debug('Applica: could not get page HTML', e);
        postPageDataToDrawer(drawerWindow, {
          type: 'applica-page-data',
          requestId,
          error: e?.message || 'Failed to get page'
        });
      }
    }
    if (event.data?.type === 'applica-navigate-to' && event.data.url) {
      // Legacy same-tab navigation; prefer applica-open-tab to preserve drawer context.
      const url = event.data.url;
      chrome.runtime.sendMessage({ type: 'applica-will-navigate', url }, (response) => {
        if (chrome.runtime.lastError) return;
        window.location.href = url;
      });
    }
    if (event.data?.type === 'applica-open-tab' && event.data.url) {
      chrome.runtime.sendMessage({ type: 'applica-open-tab', url: event.data.url }, () => {
        if (chrome.runtime.lastError) {
          console.debug('Applica: could not open tab', chrome.runtime.lastError);
        }
      });
    }
    if (event.data?.type === 'applica-fill-form-with-data' && event.data.form_data) {
      handleFillFormWithData(event.source, event.data.form_data);
    }
    if (event.data?.type === 'applica-copy-to-clipboard') {
      const requestId = event.data.requestId;
      copyToClipboardInPage(event.data.text)
        .then(() => sendCopyResultToDrawer(requestId, true))
        .catch((e) => {
          console.debug('Applica: copy failed', e);
          sendCopyResultToDrawer(requestId, false);
        });
    }
  });

  /**
   * Fill matching form fields on the page using form_data from the drawer.
   * The drawer (extension iframe) fetches form_details; we only run in page context to access the DOM.
   */
  async function handleFillFormWithData(drawerWindow, formData) {
    const win = getDrawerContentWindow();
    const sendResult = (result) => {
      if (!win || drawerWindow !== win) return;
      try {
        win.postMessage(
          { type: 'applica-fill-form-result', ...result },
          DRAWER_POST_MESSAGE_TARGET
        );
      } catch (e) {
        console.debug('Applica: could not send fill-form result', e);
      }
    };
    try {
      const enrichedFormData = enrichFormDataWithSplitNames(formData);
      const roots = getFillRoots(document);
      for (const root of roots) {
        try {
          root.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (_) {}
        break;
      }
      let filled = 0;
      const used = new Set();
      for (const root of roots) {
        filled += fillFormFields(root, enrichedFormData, used);
      }
      const total = Object.keys(enrichedFormData).length;
      let resumeAttached = 0;
      let resumeError = null;
      const resumePath = formData.resume_download_path;
      const resumeFilename = formData.resume_filename || 'resume.pdf';
      try {
        for (const root of roots) {
          if (resumePath) {
            resumeAttached += await fillResumeFileInputs(root, resumePath, resumeFilename);
          } else if (formData.resume_url) {
            resumeAttached += await fillResumeFileInputs(root, formData.resume_url, resumeFilename, false);
          }
          if (resumeAttached > 0) break;
        }
      } catch (e) {
        resumeError = e?.message || 'Could not attach resume.';
      }
      sendResult({ filled, total, resumeAttached, resumeError });
    } catch (e) {
      sendResult({ error: e?.message || 'Failed to fill form.' });
    }
  }

  const RESUME_INPUT_MATCHERS = ['resume', 'cv', 'curriculum', 'vitae', 'attachment', 'document'];

  async function fetchResumeResponse(resumePathOrUrl, useAuth) {
    if (useAuth) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.get([STORAGE_KEYS.AUTH_TOKEN, STORAGE_KEYS.APP_ORIGIN], async (data) => {
          const token = data[STORAGE_KEYS.AUTH_TOKEN];
          const origin = (data[STORAGE_KEYS.APP_ORIGIN] || DEFAULT_ORIGIN).replace(/\/$/, '');
          if (!token) {
            reject(new Error('Not logged in — could not download resume.'));
            return;
          }
          const path = resumePathOrUrl.startsWith('/') ? resumePathOrUrl : `/${resumePathOrUrl}`;
          try {
            const response = await fetch(`${origin}${path}`, {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/pdf, application/json, */*'
              }
            });
            resolve(response);
          } catch (err) {
            reject(err);
          }
        });
      });
    }
    return fetch(resumePathOrUrl);
  }

  async function fillResumeFileInputs(root, resumePathOrUrl, resumeFilename, useAuth = true) {
    if (!resumePathOrUrl) return 0;
    const response = await fetchResumeResponse(resumePathOrUrl, useAuth);
    if (!response.ok) {
      throw new Error('Could not download resume for upload.');
    }
    const blob = await response.blob();
    const file = new File(
      [blob],
      resumeFilename || 'resume.pdf',
      { type: blob.type || 'application/pdf' }
    );
    let attached = 0;
    const resumeSelectors = [
      'input#resume[type="file"]',
      'input[id="resume"][type="file"]',
      'input[type="file"][name*="resume" i]',
      'input[type="file"][id*="resume" i]',
      'input[type="file"][name*="cv" i]',
      'input[type="file"][id*="cv" i]'
    ];
    const seen = new Set();
    const fileInputs = [];
    for (const selector of resumeSelectors) {
      root.querySelectorAll(selector).forEach((input) => {
        if (!seen.has(input)) {
          seen.add(input);
          fileInputs.push(input);
        }
      });
    }
    root.querySelectorAll('input[type="file"]').forEach((input) => {
      if (!seen.has(input)) {
        seen.add(input);
        fileInputs.push(input);
      }
    });
    if (fileInputs.length === 0) return 0;

    for (const input of fileInputs) {
      if (input.disabled) continue;
      const combined = normalizeForMatch(
        (input.getAttribute('name') || '') +
          (input.getAttribute('id') || '') +
          (input.getAttribute('data-ui') || '') +
          (input.getAttribute('accept') || '') +
          getLabelTextForField(root, input)
      );
      const isResumeField =
        input.id === 'resume' ||
        RESUME_INPUT_MATCHERS.some((m) => combined.includes(normalizeForMatch(m)));
      if (!isResumeField && fileInputs.length > 1) continue;
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        attached++;
      } catch (_) {}
    }
    return attached;
  }

  /** Preferred fill order — specific fields before generic ones (e.g. first/last before full_name). */
  const FILL_FIELD_ORDER = [
    'first_name',
    'last_name',
    'email',
    'phone',
    'linkedin_url',
    'address',
    'city',
    'state',
    'zip',
    'full_name',
    'preferred_salary',
    'gender',
    'race',
    'is_willing_to_relocate',
    'willing_to_travel',
    'is_disabled',
    'disabilities',
    'is_veteran',
    'requires_sponsorship'
  ];

  /** Map our form_data keys to possible input name/id/placeholder/aria-label values (lowercase). */
  const FORM_FIELD_MATCHERS = {
    full_name: ['full_name', 'fullname', 'name', 'applicant_name', 'full-name'],
    first_name: ['first_name', 'firstname', 'first-name', 'givenname', 'given_name', 'fname', 'first'],
    last_name: ['last_name', 'lastname', 'last-name', 'surname', 'familyname', 'family_name', 'lname', 'last'],
    email: ['email', 'e-mail', 'mail'],
    phone: ['phone', 'telephone', 'mobile', 'cell', 'phonenumber'],
    linkedin_url: ['linkedin', 'linked_in', 'linkedin_url', 'linkedinurl', 'linkedin_url'],
    address: ['address', 'street', 'address1', 'address_line_1', 'address_line1'],
    city: ['city'],
    state: ['state', 'region', 'province'],
    zip: ['zip', 'postal', 'postal_code', 'zipcode', 'postalcode'],
    preferred_salary: ['salary', 'preferred_salary', 'compensation', 'expected_salary', 'salaryexpectation'],
    is_willing_to_relocate: ['relocate', 'relocation', 'willingtorelocate', 'willing_to_relocate', 'open_to_relocation'],
    willing_to_travel: ['travel', 'willingtotravel', 'willing_to_travel', 'travelrequired', 'travel_required'],
    gender: ['gender', 'sex', 'eeogender', 'gender_identity'],
    race: ['race', 'ethnicity', 'ethnic', 'eeorace', 'ethnicity_race', 'demographic'],
    is_disabled: ['disability', 'disabled', 'eeodisability', 'has_disability', 'disability_status'],
    disabilities: ['disabilities', 'disability_description', 'disability_detail', 'accommodation'],
    is_veteran: ['veteran', 'veteranstatus', 'veteran_status', 'military', 'protected_veteran'],
    requires_sponsorship: ['sponsorship', 'sponsor', 'work_authorization', 'workauthorization', 'visa', 'require_sponsorship', 'authorized_to_work']
  };

  function splitFullName(fullName) {
    if (fullName == null || typeof fullName !== 'string') {
      return { first_name: '', last_name: '' };
    }
    const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { first_name: '', last_name: '' };
    if (parts.length === 1) return { first_name: parts[0], last_name: '' };
    return {
      first_name: parts[0],
      last_name: parts.slice(1).join(' ')
    };
  }

  function enrichFormDataWithSplitNames(formData) {
    const enriched = { ...formData };
    const full = formData.full_name;
    if (full != null && String(full).trim() !== '') {
      const { first_name, last_name } = splitFullName(full);
      if (enriched.first_name == null) enriched.first_name = first_name;
      if (enriched.last_name == null) enriched.last_name = last_name;
    }
    return enriched;
  }

  function normalizeForMatch(s) {
    if (s == null || typeof s !== 'string') return '';
    return s.toLowerCase().replace(/[\s_-]/g, '');
  }

  function orderedFormDataKeys(formData) {
    const keys = Object.keys(formData);
    const ordered = FILL_FIELD_ORDER.filter((k) => keys.includes(k));
    const rest = keys.filter((k) => !FILL_FIELD_ORDER.includes(k));
    return ordered.concat(rest);
  }

  /** Bare "name" must not match firstname/lastname; bare "first"/"last" need tighter checks. */
  function isFirstOrLastNameField(name, id) {
    return /^(first(name)?|fname|givenname)$/.test(name) ||
      /^(last(name)?|lname|surname|familyname)$/.test(name) ||
      /^(first(name)?|fname|givenname)$/.test(id) ||
      /^(last(name)?|lname|surname|familyname)$/.test(id);
  }

  function fieldMatchesKey(key, el, root, normalizedMatchers) {
    const name = normalizeForMatch(el.getAttribute('name'));
    const id = normalizeForMatch(el.getAttribute('id') || '');
    const dataUi = normalizeForMatch(el.getAttribute('data-ui') || '');
    const placeholder = normalizeForMatch(el.getAttribute('placeholder') || '');
    const ariaLabel = normalizeForMatch(el.getAttribute('aria-label') || '');
    const labelText = normalizeForMatch(getLabelTextForField(root, el));
    const type = (el.getAttribute('type') || '').toLowerCase();
    const nameId = name + id + dataUi;

    if (key === 'email' && type === 'email') return true;

    if (key === 'first_name' && (dataUi === 'firstname' || name === 'firstname' || id === 'firstname')) return true;
    if (key === 'last_name' && (dataUi === 'lastname' || name === 'lastname' || id === 'lastname')) return true;

    for (const m of normalizedMatchers) {
      if (key === 'full_name' && m === 'name') {
        if (isFirstOrLastNameField(name, id)) continue;
        if (nameId === 'name' || nameId === 'fullname' || labelText.includes('fullname')) return true;
        continue;
      }
      if (key === 'first_name' && m === 'first') {
        if (name.includes('first') || id.includes('first') || dataUi.includes('first') || labelText.includes('firstname')) {
          return true;
        }
        continue;
      }
      if (key === 'last_name' && m === 'last') {
        if (name.includes('last') || id.includes('last') || dataUi.includes('last') || labelText.includes('lastname')) {
          return true;
        }
        continue;
      }
      if (name === m || id === m || dataUi === m) return true;
      const combined = nameId + placeholder + ariaLabel + labelText;
      if (combined.includes(m)) return true;
    }
    return false;
  }

  function formatPhoneForField(phone, el) {
    if (phone == null) return '';
    const str = String(phone).trim();
    if (!str) return '';
    const itiRoot = el.closest('.iti');
    if (itiRoot && itiRoot.classList.contains('iti--separate-dial-code')) {
      const digits = str.replace(/\D/g, '');
      if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
      if (digits.length === 10) return digits;
      return digits;
    }
    return str;
  }

  function getRadioOptionLabel(root, radio) {
    const parts = [];
    const labelledBy = radio.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((refId) => {
        const ref = root.querySelector('#' + CSS.escape(refId.trim()));
        if (ref?.textContent) parts.push(ref.textContent.trim());
      });
    }
    let parent = radio.parentElement;
    if (parent?.tagName === 'LABEL' && parent.textContent) parts.push(parent.textContent.trim());
    return parts.join(' ');
  }

  function isYesRadioOption(radio, root) {
    const val = normalizeForMatch(radio.value || '');
    const label = normalizeForMatch(getRadioOptionLabel(root, radio));
    const yesVals = ['yes', 'true', '1', 'y'];
    return yesVals.some((v) => val === v || label === v || label.includes(v));
  }

  function isNoRadioOption(radio, root) {
    const val = normalizeForMatch(radio.value || '');
    const label = normalizeForMatch(getRadioOptionLabel(root, radio));
    const noVals = ['no', 'false', '0', 'n'];
    return noVals.some((v) => val === v || label === v || label.includes(v));
  }

  /** "Authorized to work without sponsorship?" — YES means user does NOT require sponsorship. */
  function isInvertedSponsorshipQuestion(questionText) {
    const q = normalizeForMatch(questionText);
    return q.includes('sponsorship') &&
      (q.includes('without') || q.includes('authorized') || q.includes('legally'));
  }

  function selectRadio(radio) {
    radio.checked = true;
    radio.dispatchEvent(new Event('input', { bubbles: true }));
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    radio.click();
  }

  function fillBooleanRadioGroups(root, formData) {
    let filledCount = 0;
    const fieldsets = root.querySelectorAll('fieldset[role="radiogroup"], fieldset');
    for (const key of BOOLEAN_SELECT_KEYS) {
      const value = formData[key];
      if (typeof value !== 'boolean') continue;
      const matchers = (FORM_FIELD_MATCHERS[key] || []).map(normalizeForMatch);
      if (matchers.length === 0) continue;

      for (const fieldset of fieldsets) {
        const questionText = getGroupQuestionText(root, fieldset);
        const normalizedQuestion = normalizeForMatch(questionText);
        if (!matchers.some((m) => normalizedQuestion.includes(m))) continue;

        const radios = Array.from(fieldset.querySelectorAll('input[type="radio"]'));
        if (radios.length === 0) continue;

        let wantYes = value;
        if (key === 'requires_sponsorship' && isInvertedSponsorshipQuestion(questionText)) {
          wantYes = !value;
        }

        const target = radios.find((r) => (wantYes ? isYesRadioOption(r, root) : isNoRadioOption(r, root)));
        if (target && !target.checked) {
          selectRadio(target);
          filledCount++;
        } else if (target?.checked) {
          filledCount++;
        }
        break;
      }
    }
    return filledCount;
  }

  function getGroupQuestionText(root, fieldset) {
    const parts = [];
    const labelledBy = fieldset.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((refId) => {
        const ref = root.querySelector('#' + CSS.escape(refId.trim()));
        if (ref?.textContent) parts.push(ref.textContent.trim());
      });
    }
    if (parts.length === 0) {
      const prev = fieldset.previousElementSibling;
      if (prev?.textContent) parts.push(prev.textContent.trim());
    }
    return parts.join(' ');
  }

  /** Keys that are booleans in form_data; their dropdowns often use Yes/No or similar. */
  const BOOLEAN_SELECT_KEYS = ['is_disabled', 'is_veteran', 'is_willing_to_relocate', 'willing_to_travel', 'requires_sponsorship'];

  /**
   * Find the best matching <option> in a select for our form_data value.
   * - Booleans: match "Yes"/"No", "True"/"False", "I don't wish to answer", etc.
   * - Strings (gender, race): exact normalized match, or option text contains our value / our value contains option.
   */
  function findMatchingOption(selectEl, key, value, strVal) {
    const options = Array.from(selectEl.options).filter((o) => !o.disabled);
    if (options.length === 0) return null;
    const isBooleanKey = BOOLEAN_SELECT_KEYS.includes(key);
    const normalizedStrVal = normalizeForMatch(strVal);

    if (isBooleanKey && typeof value === 'boolean') {
      const forTrue = ['yes', 'true', '1', 'y'];
      const forFalse = ['no', 'false', '0', 'n', 'prefernottosay', 'decline', 'dontwish', 'idontwish', 'rathernot', 'choosenot', 'noanswer', 'notspecified', 'none', 'na'];
      const accept = value ? forTrue : forFalse;
      const optMatches = (o) => {
        const v = normalizeForMatch((o.value != null && o.value !== '' ? o.value : o.text) || '');
        if (!v) return false;
        return accept.includes(v) || accept.some((a) => v.includes(a) || a.includes(v));
      };
      return options.find(optMatches) || null;
    }

    for (const o of options) {
      const optVal = (o.value != null && o.value !== '' ? o.value : o.text) || '';
      const optNorm = normalizeForMatch(optVal);
      if (optNorm && optNorm === normalizedStrVal) return o;
    }
    for (const o of options) {
      const optVal = (o.value != null && o.value !== '' ? o.value : o.text) || '';
      const optNorm = normalizeForMatch(optVal);
      if (!optNorm || !normalizedStrVal) continue;
      if (optNorm.includes(normalizedStrVal) || normalizedStrVal.includes(optNorm)) return o;
    }
    return null;
  }

  /**
   * Get label text associated with a form field (for matching when name/id/placeholder are missing).
   * Checks: label[for=id], parent <label>, preceding sibling <label>, and label in previous sibling container.
   */
  function getLabelTextForField(root, el) {
    const parts = [];
    const id = el.getAttribute('id');
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((refId) => {
        const ref = root.querySelector('#' + CSS.escape(refId.trim()));
        if (ref?.textContent) parts.push(ref.textContent.trim());
      });
    }
    if (id) {
      const labelByFor = root.querySelector('label[for="' + CSS.escape(id) + '"]');
      if (labelByFor && labelByFor.textContent) parts.push(labelByFor.textContent.trim());
    }
    let parent = el.parentElement;
    if (parent && parent.tagName === 'LABEL' && parent.textContent) {
      parts.push(parent.textContent.trim());
    }
    let prev = el.previousElementSibling;
    if (prev && prev.tagName === 'LABEL' && prev.textContent) {
      parts.push(prev.textContent.trim());
    }
    while (parent && parent !== root) {
      const prevCell = parent.previousElementSibling;
      if (prevCell && prevCell.tagName === 'LABEL' && prevCell.textContent) {
        parts.push(prevCell.textContent.trim());
      }
      parent = parent.parentElement;
    }
    return parts.join(' ');
  }

  /** Standard HTML autocomplete → form_data keys (most reliable on modern ATS forms). */
  const AUTOCOMPLETE_FIELD_MAP = {
    'given-name': 'first_name',
    'family-name': 'last_name',
    email: 'email',
    tel: 'phone',
    'tel-national': 'phone',
    'tel-local': 'phone',
    'street-address': 'address',
    'address-line1': 'address',
    'address-level2': 'city',
    'address-level1': 'state',
    'postal-code': 'zip'
  };

  /** Common ATS form root selectors (Greenhouse, Lever-style, embedded boards). */
  const APPLICATION_FORM_SELECTORS = [
    '[data-ui="application-form"]',
    'form#application-form',
    'form.application--form',
    'form#application_form',
    '#application_form',
    '.application--container form',
    '.application-form form',
    'form[action*="greenhouse"]',
    'form[action*="lever.co"]',
    'form[action*="workable"]',
    'form[action*="ashbyhq"]',
    'form[action*="apply"]'
  ];

  function queryApplicationFormRoot(doc) {
    for (const selector of APPLICATION_FORM_SELECTORS) {
      const el = doc.querySelector(selector);
      if (el) return el;
    }
    for (const iframe of doc.querySelectorAll('iframe')) {
      try {
        const idoc = iframe.contentDocument;
        if (!idoc) continue;
        for (const selector of APPLICATION_FORM_SELECTORS) {
          const el = idoc.querySelector(selector);
          if (el) return el;
        }
      } catch (_) {}
    }
    return null;
  }

  /** Prefer the application modal/form over stray inputs elsewhere on the page. */
  function getFillRoots(doc) {
    const appForm = queryApplicationFormRoot(doc);
    if (appForm) return [appForm];

    const dialog = doc.querySelector('[role="dialog"]:not([aria-hidden="true"]), dialog[open]');
    if (dialog) return [dialog];

    return [doc.body || doc];
  }

  function isSkippableInput(el) {
    if (!el) return true;
    const role = el.getAttribute('role');
    if (role === 'combobox' || role === 'searchbox') return true;
    if (el.classList.contains('select__input')) return true;
    if (el.classList.contains('iti__search-input')) return true;
    const id = (el.id || '').toLowerCase();
    if (id === 'country' && el.closest('.phone-input, .select, .select-shell')) return true;
    return false;
  }

  function isFieldVisible(el) {
    if (!el) return false;
    if (el.type === 'file') {
      if (el.disabled) return false;
      if (el.closest('[hidden]')) return false;
      return true;
    }
    if (el.type === 'hidden') return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.classList.contains('visually-hidden') && el.type !== 'file') return false;
    if (Number(el.tabIndex) === -1 && el.closest('[style*="absolute"][style*="1px"]')) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0 && el.type !== 'file') return false;
    } catch (_) {}
    return true;
  }

  function setInputValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findInputsForKey(inputs, key, root, normalizedMatchers, used) {
    const eligible = inputs.filter(
      (el) =>
        !used.has(el) &&
        !isSkippableInput(el) &&
        el.type !== 'radio' &&
        el.type !== 'checkbox' &&
        fieldMatchesKey(key, el, root, normalizedMatchers)
    );
    return eligible.find(isFieldVisible) || eligible[0] || null;
  }

  function fillKnownFieldIds(root, formData, used) {
    let filledCount = 0;
    const idKeys = ['first_name', 'last_name', 'email', 'phone'];
    for (const key of idKeys) {
      const value = formData[key];
      if (value == null || String(value).trim() === '') continue;
      const el = root.querySelector('#' + CSS.escape(key));
      if (!el || used.has(el) || isSkippableInput(el)) continue;
      if (el.tagName === 'SELECT') continue;
      try {
        const fillVal = key === 'phone' ? formatPhoneForField(String(value).trim(), el) : String(value).trim();
        setInputValue(el, fillVal);
        used.add(el);
        filledCount++;
      } catch (_) {}
    }
    return filledCount;
  }

  function fillAutocompleteFields(root, formData, used) {
    let filledCount = 0;
    for (const [autocomplete, key] of Object.entries(AUTOCOMPLETE_FIELD_MAP)) {
      const value = formData[key];
      if (value == null || String(value).trim() === '') continue;
      const els = root.querySelectorAll(
        'input[autocomplete="' + autocomplete + '"], textarea[autocomplete="' + autocomplete + '"]'
      );
      for (const el of els) {
        if (used.has(el) || isSkippableInput(el) || !isFieldVisible(el)) continue;
        try {
          const fillVal =
            key === 'phone' ? formatPhoneForField(String(value).trim(), el) : String(value).trim();
          setInputValue(el, fillVal);
          used.add(el);
          filledCount++;
          break;
        } catch (_) {}
      }
    }
    return filledCount;
  }

  function fillLinkedInQuestionFields(root, formData, used) {
    const url = formData.linkedin_url;
    if (url == null || String(url).trim() === '') return 0;
    let filledCount = 0;
    const inputs = root.querySelectorAll('input:not([type="hidden"]), textarea');
    for (const el of inputs) {
      if (used.has(el) || isSkippableInput(el)) continue;
      const label = normalizeForMatch(getLabelTextForField(root, el));
      const aria = normalizeForMatch(el.getAttribute('aria-label') || '');
      if (!label.includes('linkedin') && !aria.includes('linkedin')) continue;
      try {
        setInputValue(el, String(url).trim());
        used.add(el);
        filledCount++;
      } catch (_) {}
    }
    return filledCount;
  }

  function fillFormFields(root, formData, used) {
    used = used || new Set();
    let filledCount = 0;
    filledCount += fillKnownFieldIds(root, formData, used);
    filledCount += fillAutocompleteFields(root, formData, used);
    filledCount += fillLinkedInQuestionFields(root, formData, used);

    const inputs = Array.from(root.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'));
    for (const key of orderedFormDataKeys(formData)) {
      const value = formData[key];
      if (value == null) continue;
      const matchers = FORM_FIELD_MATCHERS[key];
      if (!matchers || matchers.length === 0) continue;
      const normalizedMatchers = matchers.map(normalizeForMatch);

      if (typeof value === 'boolean') {
        for (const el of inputs) {
          if (used.has(el) || el.tagName !== 'SELECT') continue;
          if (!fieldMatchesKey(key, el, root, normalizedMatchers)) continue;
          try {
            const opt = findMatchingOption(el, key, value, value ? 'yes' : 'no');
            if (opt) {
              opt.selected = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              filledCount++;
              used.add(el);
            }
          } catch (_) {}
        }
        continue;
      }

      const strVal = String(value).trim();
      if (!strVal) continue;
      const el = findInputsForKey(inputs, key, root, normalizedMatchers, used);
      if (!el) continue;
      try {
        if (el.tagName === 'SELECT') {
          const opt = findMatchingOption(el, key, value, strVal);
          if (opt) {
            opt.selected = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            filledCount++;
            used.add(el);
          }
        } else {
          const fillVal = key === 'phone' ? formatPhoneForField(strVal, el) : strVal;
          setInputValue(el, fillVal);
          filledCount++;
          used.add(el);
        }
      } catch (_) {}
    }
    filledCount += fillBooleanRadioGroups(root, formData);
    return filledCount;
  }

  // Re-open drawer on this page if we just navigated here from a drawer link.
  // Defer past hydration — immediate body mutations break React SSR pages (error #425).
  chrome.storage.local.get([STORAGE_KEYS.REOPEN_DRAWER_TS], (data) => {
    const ts = data[STORAGE_KEYS.REOPEN_DRAWER_TS];
    if (ts && Date.now() - ts < REOPEN_DRAWER_TTL_MS) {
      chrome.storage.local.remove([STORAGE_KEYS.REOPEN_DRAWER_TS]);
      runWhenDomSafe(openDrawer);
    }
  });
})();
