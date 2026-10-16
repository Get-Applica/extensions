/**
 * Applica Extension - Drawer UI logic
 *
 * Navigation chrome is driven by applyDrawerLayout().
 * Sign-in opens the app in a new tab; auth.html stores the token. Shared helpers live in
 * lib/api.js, lib/constants.js, and lib/util.js.
 */

(function () {
  const { escapeHtml, setVisible, parseRecruiterLoginUrl, copyToClipboard } = window.ApplicaUtil;
  const { APPLICATION_STATUS_OPTIONS, STORAGE } = window.ApplicaConstants;
  const EXT = window.APPLICA_EXTENSION || { kind: 'seeker', features: {} };
  const isRecruiter = EXT.kind === 'recruiter';
  /** Seeker Analyze/History tabs. When on, the worklist sections stay in the DOM but hidden. */
  const tabbedLayout = !isRecruiter && EXT.features?.tabbedLayout === true;

  // Tabbed layout state (declared up front so worklist code can call the tabbed hooks safely).
  let tabbedTab = 'analyze';
  let tabbedPersonasState = { loaded: false, error: null };
  let tabbedOpeningsError = null;
  /** { found, title, company, pageTitle } from content.js detectJobPosting(). found = JobPosting data. */
  let currentPageJob = null;
  /** Most recent form fill on this page: { openingId, pending, result }. */
  let tabbedFill = null;
  let tabbedFillTimeoutId = null;
  let tabbedApplyingOpeningId = null;
  let tabbedCustomResumeBusy = false;
  let tabbedSwitcherOpen = false;
  let tabbedHistoryFilter = 'all';
  let tabbedHistorySort = 'newest';
  let tabbedHistoryQuery = '';
  let tabbedHistoryDetailKey = null;
  let tabbedConfirmKey = null;
  let tabbedPendingCommand = null;
  let tabbedRenderQueued = false;
  let tabbedShortcutLabels = { analyze: '', fill: '' };
  const tabbedPolledOpeningIds = new Set();
  const tabbedLinks = { dashboard: null, profiles: null, upgrade: null };
  const tabbedLastHtml = { analyze: null, history: null, detail: null };

  function setupEmailsEnabled() {
    return (
      isRecruiter &&
      EXT.features?.setupEmails === true &&
      typeof window.ApplicaAPI?.fetchEmails === 'function'
    );
  }

  const loginSection = document.getElementById('login-section');
  const loginSeekerPanel = document.getElementById('login-seeker');
  const loginRecruiterPanel = document.getElementById('login-recruiter');
  const scoreQueueSection = document.getElementById('score-queue-section');
  const signedInSection = document.getElementById('signed-in-section');
  const signedInEmail = document.getElementById('signed-in-email');
  const openLoginTabBtn = document.getElementById('open-login-tab');
  const recruiterLoginForm = document.getElementById('recruiter-login-form');
  const recruiterLoginUrlInput = document.getElementById('recruiter-login-url');
  const loginErrorEl = document.getElementById('login-error');
  const recruiterLoginBtn = document.getElementById('recruiter-login-btn');
  const signOutBtn = document.getElementById('sign-out-btn');
  const closeDrawerBtn = document.getElementById('close-drawer');
  const apiErrorBanner = document.getElementById('api-error-banner');
  const personaPickerLabel = document.getElementById('drawer-persona-picker-label');

  function usesApplicationsTodayStat() {
    return EXT.profileHeaderStat === 'applications_today';
  }

  let lastApplicationsPersonaId = null;

  function utcCalendarDate(iso) {
    if (!iso) return null;
    try {
      const t = new Date(iso).getTime();
      if (Number.isNaN(t)) return null;
      return new Date(t).toISOString().slice(0, 10);
    } catch (_) {
      return null;
    }
  }

  function countApplicationsCreatedToday(apps) {
    if (!Array.isArray(apps)) return 0;
    const today = new Date().toISOString().slice(0, 10);
    return apps.filter((a) => utcCalendarDate(a?.inserted_at || a?.applied_at) === today).length;
  }

  function updateApplicationsTodayDisplay(count) {
    if (!usesApplicationsTodayStat()) return;
    const scoreEl = document.getElementById('applica-profile-score');
    const scoreBadgeEl = document.getElementById('applica-profile-score-badge');
    if (!scoreEl) return;
    scoreEl.textContent = count != null ? String(count) : '—';
    scoreEl.className = 'drawer-profile-score-value';
    if (scoreBadgeEl) scoreBadgeEl.hidden = true;
  }

  function configureExtensionChrome() {
    if (loginSeekerPanel) loginSeekerPanel.hidden = isRecruiter;
    if (loginRecruiterPanel) loginRecruiterPanel.hidden = !isRecruiter;
    if (personaPickerLabel && EXT.personaPickerLabel) {
      personaPickerLabel.textContent = EXT.personaPickerLabel;
    }
    const appsSection = document.getElementById('applications-section-content');
    if (appsSection && EXT.features && EXT.features.applications === false) {
      appsSection.hidden = true;
    }
    if (isRecruiter) {
      const manageLink = document.getElementById('applica-profile-manage-link');
      if (manageLink) manageLink.hidden = true;
      const customResumeSection = document.getElementById('opening-detail-custom-resume');
      if (customResumeSection) customResumeSection.hidden = true;
    } else {
      const prefsSection = document.getElementById('drawer-profile-preferences');
      if (prefsSection) prefsSection.hidden = true;
      const networkingSection = document.getElementById('opening-detail-networking');
      if (networkingSection) networkingSection.hidden = true;
    }
    if (usesApplicationsTodayStat()) {
      const scoreLabel = document.querySelector('.drawer-profile-score-label');
      const scoreSuffix = document.querySelector('.drawer-profile-score-suffix');
      const scoreWrap = document.querySelector('.drawer-profile-score-wrap');
      if (scoreLabel) scoreLabel.textContent = 'Apps today';
      if (scoreSuffix) scoreSuffix.hidden = true;
      if (scoreWrap) scoreWrap.classList.add('drawer-profile-stat--applications');
    }
    const setupEmailsSection = document.getElementById('setup-emails-section-content');
    if (setupEmailsSection && !setupEmailsEnabled()) {
      setupEmailsSection.hidden = true;
    }
  }

  configureExtensionChrome();

  const APPLICANT_DETAIL_FIELDS = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'password', label: 'Workday Password', masked: true },
    { key: 'phone', label: 'Phone number' },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'Zip' },
    { key: 'linkedin_url', label: 'LinkedIn URL' },
    { key: 'race', label: 'Race' },
    { key: 'gender', label: 'Gender' },
    { key: 'disabilities', label: 'Disabilities', when: (d) => d.is_disabled },
    { key: 'is_veteran', label: 'Is Veteran' },
    { key: 'authorized_countries', label: 'Authorized Countries' },
    { key: 'is_willing_to_relocate', label: 'Is Willing to Relocate' },
    { key: 'willing_to_travel', label: 'Is Willing to Travel' },
    { key: 'most_recent_salary', label: 'Recent Salary' },
    { key: 'years_experience', label: 'Years of Experience' },
    { key: 'years_management_experience', label: 'Years of Management Experience' },
  ];

  let applicantCopyValueSeq = 0;
  const applicantCopyValues = new Map();

  function rememberApplicantCopyValue(value) {
    const id = String(++applicantCopyValueSeq);
    applicantCopyValues.set(id, value == null ? '' : String(value));
    return id;
  }

  function readApplicantCopyValue(id) {
    return applicantCopyValues.get(String(id)) || '';
  }

  function formatApplicantDetailValue(value) {
    if (value == null) return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }

  function clearOpeningApplicantInfo() {
    const section = document.getElementById('opening-detail-applicant-info');
    const fieldsEl = document.getElementById('opening-detail-applicant-fields');
    if (fieldsEl) fieldsEl.innerHTML = '';
    if (section) section.hidden = true;
  }

  function renderApplicantCopyField(label, value, options = {}) {
    const displayValue = formatApplicantDetailValue(value);
    const copyValue = value == null ? '' : String(value);
    const copyId = rememberApplicantCopyValue(copyValue);
    const masked = options.masked && copyValue !== '';
    const shown = masked ? '••••••••' : displayValue;
    return (
      '<div class="drawer-applicant-copy-field">' +
      '<span class="drawer-applicant-copy-label">' +
      escapeHtml(label) +
      '</span>' +
      '<button type="button" class="drawer-applicant-copy-value" data-copy-id="' +
      escapeHtml(copyId) +
      '" title="Click to copy">' +
      '<span class="drawer-applicant-copy-text">' +
      escapeHtml(shown || '—') +
      '</span>' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="drawer-applicant-copy-icon" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>' +
      '</button>' +
      '</div>'
    );
  }

  function showApplicantCopyFeedback(copyBtn) {
    if (!copyBtn) return;
    const fieldEl = copyBtn.closest('.drawer-applicant-copy-field');
    const labelEl = fieldEl?.querySelector('.drawer-applicant-copy-label');
    const originalLabel = labelEl?.dataset.originalLabel || labelEl?.textContent || '';
    if (labelEl && !labelEl.dataset.originalLabel) {
      labelEl.dataset.originalLabel = originalLabel;
    }
    copyBtn.classList.add('is-copied');
    if (labelEl) {
      labelEl.classList.add('is-copied');
      labelEl.textContent = 'Copied!';
    }
    window.setTimeout(() => {
      copyBtn.classList.remove('is-copied');
      if (labelEl) {
        labelEl.classList.remove('is-copied');
        labelEl.textContent = originalLabel;
      }
    }, 1200);
  }

  async function handleApplicantCopyClick(copyBtn) {
    const copyId = copyBtn.getAttribute('data-copy-id');
    const value = readApplicantCopyValue(copyId);
    // Copy inside the drawer (iframe has allow="clipboard-write"). Values such as passwords never
    // pass through the host page.
    await copyToClipboard(value);
    showApplicantCopyFeedback(copyBtn);
  }

  function bindApplicantCopyHandlers() {
    const fieldsEl = document.getElementById('opening-detail-applicant-fields');
    if (!fieldsEl || fieldsEl.dataset.copyBound === 'true') return;
    fieldsEl.dataset.copyBound = 'true';
    fieldsEl.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.drawer-applicant-copy-value');
      if (!copyBtn || !fieldsEl.contains(copyBtn)) return;
      e.preventDefault();
      e.stopPropagation();
      handleApplicantCopyClick(copyBtn).catch(() => {
        copyBtn.classList.add('is-copied');
        window.setTimeout(() => copyBtn.classList.remove('is-copied'), 1200);
      });
    });
  }

  bindApplicantCopyHandlers();

  function renderOpeningApplicantInfo(details) {
    const section = document.getElementById('opening-detail-applicant-info');
    const fieldsEl = document.getElementById('opening-detail-applicant-fields');
    if (!section || !fieldsEl || !details || typeof details !== 'object') {
      clearOpeningApplicantInfo();
      return;
    }

    applicantCopyValues.clear();
    applicantCopyValueSeq = 0;

    const parts = [];
    for (const field of APPLICANT_DETAIL_FIELDS) {
      if (typeof field.when === 'function' && !field.when(details)) continue;
      parts.push(
        renderApplicantCopyField(field.label, details[field.key], { masked: field.masked })
      );
    }

    const portfolios = Array.isArray(details.portfolio_urls) ? details.portfolio_urls : [];
    for (const portfolio of portfolios) {
      const label = portfolio?.label || 'Portfolio URL';
      const url = portfolio?.url;
      if (url) parts.push(renderApplicantCopyField(label, url));
    }

    fieldsEl.innerHTML = parts.join('');
    section.hidden = parts.length === 0;
  }

  async function loadOpeningApplicantInfo(opening) {
    if (!isRecruiter || !opening?.id) {
      clearOpeningApplicantInfo();
      return;
    }

    const section = document.getElementById('opening-detail-applicant-info');
    const fieldsEl = document.getElementById('opening-detail-applicant-fields');
    if (section) section.hidden = false;
    if (fieldsEl) {
      fieldsEl.innerHTML =
        '<p class="drawer-applicant-info-hint">Loading applicant details…</p>';
    }

    try {
      const data = await window.ApplicaAPI.appFetchJson(
        '/api/openings/' + encodeURIComponent(opening.id) + '/form_details'
      );
      renderOpeningApplicantInfo(data.applicant_details);
    } catch (_) {
      if (fieldsEl) {
        fieldsEl.innerHTML =
          '<p class="drawer-applicant-info-hint">Could not load applicant details.</p>';
      }
      if (section) section.hidden = false;
    }
  }

  const API_FEEDBACK_DISMISS_MS = 4000;
  const ANALYZE_PAGE_DATA_TIMEOUT_MS = 15000;
  let apiErrorBannerTimeout = null;
  let analyzeStatusClearTimeout = null;
  let parentPageOrigin = '*';
  let analyzeRequestSeq = 0;
  /** @type {Map<string, { personaId: string, timeoutId: number }>} */
  const pendingAnalyzeByRequestId = new Map();

  function isHttpPageOrigin(origin) {
    return (
      typeof origin === 'string' &&
      (origin.startsWith('http://') || origin.startsWith('https://'))
    );
  }

  function rememberParentPageOrigin(origin) {
    if (isHttpPageOrigin(origin)) {
      parentPageOrigin = origin;
    }
  }

  function showApiErrorBanner() {
    if (!apiErrorBanner) return;
    if (apiErrorBannerTimeout) clearTimeout(apiErrorBannerTimeout);
    apiErrorBanner.hidden = false;
    apiErrorBannerTimeout = setTimeout(() => {
      apiErrorBanner.hidden = true;
      apiErrorBannerTimeout = null;
    }, API_FEEDBACK_DISMISS_MS);
  }

  function showSection(section) {
    loginSection.hidden = section !== 'login';
    scoreQueueSection.hidden = section !== 'signed-in';
    signedInSection.hidden = section !== 'signed-in';
    if (tabbedLayout) {
      const footer = document.getElementById('tb-footer');
      if (footer) footer.hidden = section !== 'signed-in';
    }
  }

  /*
   * Drawer <-> content script transport.
   *
   * Never window.postMessage: messages to window.parent are readable by the host page's own
   * scripts (form data, profile details), and the page can post forged messages into this iframe.
   * Instead: chrome.tabs.sendMessage to frame 0 of our tab out, chrome.runtime.onMessage in,
   * keeping only messages whose sender is our content script in that same tab.
   */
  const inHostPage = window.parent !== window;
  let hostTabId = null;
  const contentOutbox = [];

  function postToContent(message) {
    if (!inHostPage) return;
    if (hostTabId == null) {
      contentOutbox.push(message);
      return;
    }
    try {
      chrome.tabs.sendMessage(hostTabId, message, { frameId: 0 }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {
      // Extension context invalidated
    }
  }

  /** Ask the background worker which tab this iframe is in, then flush anything queued. */
  function resolveHostTab() {
    if (!inHostPage) return;
    try {
      chrome.runtime.sendMessage({ type: 'applica-drawer-whoami' }, (response) => {
        if (chrome.runtime.lastError || response?.tabId == null) {
          console.debug('Applica: could not identify the drawer tab', chrome.runtime.lastError);
          return;
        }
        hostTabId = response.tabId;
        contentOutbox.splice(0).forEach(postToContent);
      });
    } catch (_) {
      // Extension context invalidated
    }
  }

  function isFromOurContentScript(sender) {
    return (
      sender?.id === chrome.runtime.id &&
      hostTabId != null &&
      sender.tab?.id === hostTabId &&
      sender.frameId === 0
    );
  }

  function senderOrigin(sender) {
    if (typeof sender?.origin === 'string') return sender.origin;
    try {
      return new URL(sender.url).origin;
    } catch (_) {
      return '';
    }
  }

  function clearAnalyzePageDataTimeout(requestId) {
    if (requestId) {
      const pending = pendingAnalyzeByRequestId.get(requestId);
      if (pending?.timeoutId != null) clearTimeout(pending.timeoutId);
      return;
    }
    for (const pending of pendingAnalyzeByRequestId.values()) {
      if (pending.timeoutId != null) clearTimeout(pending.timeoutId);
    }
  }

  function cancelPendingAnalyze(requestId) {
    if (requestId) {
      clearAnalyzePageDataTimeout(requestId);
      pendingAnalyzeByRequestId.delete(requestId);
    } else {
      clearAnalyzePageDataTimeout();
      pendingAnalyzeByRequestId.clear();
    }
    syncAnalyzeJobButtonState();
  }

  function takePendingAnalyze(requestId) {
    if (requestId && pendingAnalyzeByRequestId.has(requestId)) {
      const pending = pendingAnalyzeByRequestId.get(requestId);
      clearAnalyzePageDataTimeout(requestId);
      pendingAnalyzeByRequestId.delete(requestId);
      return pending;
    }
    // Legacy / missing id: only safe when a single request is in flight.
    if (!requestId && pendingAnalyzeByRequestId.size === 1) {
      const onlyId = pendingAnalyzeByRequestId.keys().next().value;
      return takePendingAnalyze(onlyId);
    }
    return null;
  }

  function personaLastName(name) {
    if (!name || typeof name !== 'string') return '';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function personaPickerOptionLabel(persona) {
    const last = personaLastName(persona?.name);
    const title = (persona?.title || '').trim();
    if (last && title) return `${last}: ${title}`;
    if (last) return last;
    if (title) return title;
    return persona?.name || 'Persona';
  }

  async function fetchPersonas() {
    const picker = document.getElementById('applica-persona-picker');
    if (picker) picker.innerHTML = '<option value="">Loading…</option>';
    try {
      const data = await window.ApplicaAPI.appFetchJson('/api/personas');
      await renderPersonas({ loggedIn: true, data });
    } catch (err) {
      showApiErrorBanner();
      const msg = err?.message || 'Failed to load personas';
      const hint = msg.includes('failed') || msg.includes('CORS') || msg.includes('fetch')
        ? ' Check that the app is running and the app URL is correct.'
        : '';
      await renderPersonas({ loggedIn: false, error: msg + hint });
    }
  }

  function openingsSnapshot(openings) {
    if (!openings || !openings.length) return '';
    return JSON.stringify(
      openings
        .map((o) => ({ id: o.id, current_match_score: o.current_match_score }))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
    );
  }

  let lastOpeningsSnapshot = null;

  function openingHasScore(opening) {
    return opening != null && Number(opening.current_match_score) > 0;
  }

  function openingHasTitleAndCompany(opening) {
    if (!opening) return false;
    return (
      opening.title != null &&
      String(opening.title).trim() !== '' &&
      opening.company != null &&
      String(opening.company).trim() !== ''
    );
  }

  /** URL-keyed in-flight analyze placeholders/records (supports multiple concurrent jobs). */
  const analyzingOpeningsByUrl = new Map();

  function rememberAnalyzingOpening(opening) {
    if (!opening?.url) return;
    analyzingOpeningsByUrl.set(normalizeUrlForCompare(opening.url), opening);
  }

  function forgetAnalyzingOpening(openingOrUrl) {
    const url = typeof openingOrUrl === 'string' ? openingOrUrl : openingOrUrl?.url;
    if (url) analyzingOpeningsByUrl.delete(normalizeUrlForCompare(url));
  }

  function getAnalyzingOpeningByUrl(url) {
    if (!url) return null;
    return analyzingOpeningsByUrl.get(normalizeUrlForCompare(url)) || null;
  }

  function analyzingOpeningEntries() {
    return [...analyzingOpeningsByUrl.values()];
  }

  function clearAnalyzingOpenings() {
    analyzingOpeningsByUrl.clear();
  }

  function openingListedInProcessing(list, opening) {
    if (!opening) return false;
    const analyzingUrl = opening.url ? normalizeUrlForCompare(opening.url) : null;
    const analyzingId = opening.id != null ? String(opening.id) : null;
    return list.some((o) => {
      if (analyzingId && o.id != null && String(o.id) === analyzingId) return true;
      if (analyzingUrl && o.url && normalizeUrlForCompare(o.url) === analyzingUrl) return true;
      return false;
    });
  }

  /** All unscored openings in the processing queue, plus in-flight placeholders not yet listed. */
  function buildProcessingQueueRows(processing) {
    const sorted = sortWithCurrentPageFirst(processing, openingMatchesCurrentPage);
    const placeholders = analyzingOpeningEntries().filter((o) => !openingListedInProcessing(sorted, o));
    return placeholders.concat(sorted);
  }

  function isQueueItemInProgress(opening) {
    if (!opening || openingHasScore(opening)) return false;
    if (isOpeningScoring(opening)) return true;
    return !!(opening.url && getAnalyzingOpeningByUrl(opening.url));
  }

  function queueItemStatusLabel(opening, inProgress) {
    if (inProgress) return 'In Progress';
    if (!openingHasTitleAndCompany(opening)) return 'Incomplete';
    return 'Queued';
  }

  function isOpeningScoring(opening) {
    if (!opening || openingHasScore(opening)) return false;
    if (opening.id != null && pollingWatchOpeningIds.has(String(opening.id))) return true;
    return !!(opening.url && getAnalyzingOpeningByUrl(opening.url));
  }

  function updateOpeningDetailScoringIndicator(opening) {
    const scoringEl = document.getElementById('opening-detail-scoring');
    if (!scoringEl) return;
    scoringEl.hidden = !isOpeningScoring(opening);
  }

  function findOpeningById(openingId) {
    const openings = lastOpeningsPayload?.data?.openings || [];
    return openings.find((o) => o != null && String(o.id) === String(openingId));
  }

  async function fetchOpenings(personaId, options = {}) {
    if (!personaId) return;
    const showLoading = options.silent !== true;
    const queueEl = document.getElementById('score-queue-list');
    const listEl = document.getElementById('openings-list');
    if (showLoading && queueEl) queueEl.innerHTML = '<p class="drawer-hint">Loading…</p>';
    if (showLoading && listEl) listEl.innerHTML = '<p class="drawer-hint">Loading…</p>';
    try {
      const data = await window.ApplicaAPI.appFetchJson(
        `/api/openings?persona_id=${encodeURIComponent(personaId)}`
      );
      const openings = data?.openings || [];
      const snapshot = openingsSnapshot(openings);
      const unchanged = snapshot === lastOpeningsSnapshot;
      if (unchanged && options.silent === true) {
        maybeResumeScoringPoll(personaId);
        return;
      }
      lastOpeningsSnapshot = snapshot;
      renderOpenings({ loggedIn: true, data });
      maybeStopOpeningsPollAfterFetch();
      maybeResumeScoringPoll(personaId);
    } catch (err) {
      showApiErrorBanner();
      lastOpeningsSnapshot = null;
      const msg = err?.message || 'Failed to load openings';
      const hint = msg.includes('failed') || msg.includes('CORS') || msg.includes('fetch')
        ? ' Check that the app is running.'
        : '';
      renderOpenings({ loggedIn: true, error: msg + hint });
    }
  }

  function renderOpenings(payload) {
    const queueEl = document.getElementById('score-queue-list');
    const listEl = document.getElementById('openings-list');
    const hintEl = document.getElementById('openings-section-hint');
    const badgeEl = document.getElementById('openings-section-badge');
    if (!queueEl || !listEl) return;
    const queueSection = document.getElementById('score-queue-section-content');
    const openingsSection = document.getElementById('openings-section-content');

    if (!payload.loggedIn) {
      queueEl.innerHTML = '';
      listEl.innerHTML = '';
      openingsSectionAvailable = false;
      applyDrawerLayout();
      return;
    }
    openingsSectionAvailable = true;
    if (payload.error) {
      const msg = escapeHtml(payload.error);
      listEl.innerHTML = '<div class="drawer-worklist-empty">' + msg + '</div>';
      if (tabbedLayout) {
        tabbedOpeningsError = payload.error;
        applyDrawerLayout();
        return;
      }
      if (openingsSection) openingsSection.hidden = false;
      return;
    }
    if (tabbedLayout) tabbedOpeningsError = null;
    const openings = payload.data?.openings || [];
    const hasMessage = payload.data?.message;
    const limits = payload.data?.limits;
    lastOpeningsPayload = payload;

    const processing = openings.filter((o) => !Number(o.current_match_score));
    const scored = openings.filter((o) => Number(o.current_match_score) > 0);

    for (const opening of scored) {
      forgetAnalyzingOpening(opening);
      if (opening.id != null) pollingWatchOpeningIds.delete(String(opening.id));
    }
    const queueRows = buildProcessingQueueRows(processing);

    if (queueRows.length > 0) {
      queueEl.innerHTML = queueRows.map((o) => queueItemHtml(o, isQueueItemInProgress(o))).join('');
      if (getDrawerLayoutMode() === DrawerLayoutMode.MAIN) {
        scrollHighlightedWorklistItemIntoView(queueEl);
      }
    } else {
      queueEl.innerHTML = '';
    }

    if (badgeEl) badgeEl.innerHTML = usageBadgeHtml(limits);
    if (hintEl) {
      const atLimit = limits != null && typeof limits.remaining === 'number' && limits.remaining === 0;
      hintEl.innerHTML = atLimit
        ? '<p class="drawer-hint">You have reached your limit of openings. Upgrade to create more.</p>'
        : '';
    }

    const bulkToolbar = document.getElementById('openings-bulk-delete-toolbar');
    if (bulkToolbar) bulkToolbar.hidden = openings.length === 0;

    syncAnalyzeJobButtonState();

    if (scored.length > 0) {
      const sortedScored = sortWithCurrentPageFirst(scored, openingMatchesCurrentPage, (a, b) => {
        return (Number(b.current_match_score) || 0) - (Number(a.current_match_score) || 0);
      });
      listEl.innerHTML = sortedScored.map(openingRowHtml).join('');
      if (getDrawerLayoutMode() === DrawerLayoutMode.MAIN) {
        scrollHighlightedWorklistItemIntoView(listEl);
      }
    } else {
      listEl.innerHTML = '<div class="drawer-worklist-empty">No openings yet.</div>';
    }
    if (tabbedLayout) {
      maybePollCurrentPageOpening();
      applyDrawerLayout();
      return;
    }
    if (isApplicationDetailActive()) {
      applyDrawerLayout();
    } else {
      applyDrawerViewStateSync();
    }
  }

  function tryShowDetailViewForCurrentPage() {
    if (!currentPageUrl) return;
    const openings = lastOpeningsPayload?.data?.openings;
    if (!Array.isArray(openings)) return;
    const normalized = normalizeUrlForCompare(currentPageUrl);
    const opening = openings.find((o) => o && o.url && normalizeUrlForCompare(o.url) === normalized);
    if (opening) showOpeningDetail(opening);
  }

  function tryShowApplicationDetailForCurrentPage() {
    if (!currentPageUrl || isOpeningDetailActive()) return;
    const apps = lastApplicationsPayload?.data?.applications;
    if (!Array.isArray(apps)) return;
    const normalized = normalizeUrlForCompare(currentPageUrl);
    const app = apps.find((a) => a?.link && normalizeUrlForCompare(a.link) === normalized);
    if (app) showApplicationDetail(app);
  }

  function applyDrawerViewStateSync() {
    if (isApplicationDetailActive()) {
      applyDrawerLayout();
      return;
    }
    const openings = lastOpeningsPayload?.data?.openings || [];
    if (drawerViewMemory.view === 'list') {
      showOpeningsList();
      return;
    }
    if (drawerViewMemory.view === 'detail' && drawerViewMemory.openingId != null) {
      const opening = openings.find(
        (o) => o != null && String(o.id) === String(drawerViewMemory.openingId)
      );
      if (opening) {
        showOpeningDetail(opening);
        return;
      }
      saveDrawerViewState('list', null);
    }
    showOpeningsList();
  }

  function normalizeApplicationStatus(status) {
    if (status == null || String(status).trim() === '') return 'applied';
    const normalized = String(status).trim().toLowerCase();
    if (APPLICATION_STATUS_OPTIONS.some(([, value]) => value === normalized)) return normalized;
    return 'applied';
  }

  function populateStatusSelect(selectEl, selectedStatus) {
    if (!selectEl) return;
    const status = normalizeApplicationStatus(selectedStatus);
    selectEl.innerHTML = APPLICATION_STATUS_OPTIONS.map(
      ([label, value]) =>
        '<option value="' +
        escapeHtml(value) +
        '">' +
        escapeHtml(label) +
        '</option>'
    ).join('');
    selectEl.value = status;
    if (!selectEl.value && APPLICATION_STATUS_OPTIONS.length > 0) {
      selectEl.value = APPLICATION_STATUS_OPTIONS[0][1];
    }
  }

  function initApplicationFormSelects() {
    populateStatusSelect(document.getElementById('application-detail-status'), 'applied');
  }

  function statusOptionsHtml(selectedStatus) {
    const status = normalizeApplicationStatus(selectedStatus);
    return APPLICATION_STATUS_OPTIONS.map(
      ([label, value]) =>
        '<option value="' +
        escapeHtml(value) +
        '"' +
        (value === status ? ' selected' : '') +
        '>' +
        escapeHtml(label) +
        '</option>'
    ).join('');
  }

  function formatAppliedDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) {
      return String(iso).slice(0, 10);
    }
  }

  const APPLICATION_DETAIL_PREFIX = 'application-detail';

  function applicationFieldId(name) {
    return APPLICATION_DETAIL_PREFIX + '-' + name;
  }

  function readApplicationFields() {
    return {
      status: document.getElementById(applicationFieldId('status'))?.value,
      notes: document.getElementById(applicationFieldId('notes'))?.value || '',
      contact_name: document.getElementById(applicationFieldId('contact-name'))?.value || '',
      contact_email: document.getElementById(applicationFieldId('contact-email'))?.value || '',
      contact_url: document.getElementById(applicationFieldId('contact-url'))?.value || ''
    };
  }

  function fillApplicationFields(app) {
    populateStatusSelect(document.getElementById(applicationFieldId('status')), app?.status || 'applied');
    const notesEl = document.getElementById(applicationFieldId('notes'));
    const contactNameEl = document.getElementById(applicationFieldId('contact-name'));
    const contactEmailEl = document.getElementById(applicationFieldId('contact-email'));
    const contactUrlEl = document.getElementById(applicationFieldId('contact-url'));
    if (notesEl) notesEl.value = app?.notes || '';
    if (contactNameEl) contactNameEl.value = app?.contact_name || '';
    if (contactEmailEl) contactEmailEl.value = app?.contact_email || '';
    if (contactUrlEl) contactUrlEl.value = app?.contact_url || '';
  }

  let applicationsViewMemory = { view: 'list', applicationId: null };
  let lastApplicationsPayload = null;
  let selectedApplication = null;
  let applicationsSectionAvailable = EXT.features?.applications !== false;
  let setupEmailsSectionAvailable = false;
  let lastSetupEmailsPayload = null;
  let setupEmailsPollIntervalId = null;
  let setupEmailsSectionExpanded = false;
  let currentSetupEmailsPersonaId = null;
  let setupEmailsSeenByPersona = {};
  let setupEmailsSeenLoaded = false;

  function getSetupEmailsSeenIdSet(personaId) {
    if (!personaId) return new Set();
    const arr = setupEmailsSeenByPersona[String(personaId)];
    return new Set((arr || []).map(String));
  }

  function persistSetupEmailsSeenForPersona(personaId, idSet) {
    if (!personaId) return;
    setupEmailsSeenByPersona[String(personaId)] = [...idSet];
    try {
      chrome.storage.local.set({
        [STORAGE.SETUP_EMAILS_SEEN_IDS]: setupEmailsSeenByPersona,
      });
    } catch (_) {
      // Extension context invalidated
    }
  }

  function loadSetupEmailsSeenState() {
    if (setupEmailsSeenLoaded) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE.SETUP_EMAILS_SEEN_IDS], (data) => {
          try {
            const raw = data?.[STORAGE.SETUP_EMAILS_SEEN_IDS];
            setupEmailsSeenByPersona =
              raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
          } catch (_) {
            setupEmailsSeenByPersona = {};
          }
          setupEmailsSeenLoaded = true;
          resolve();
        });
      } catch (_) {
        setupEmailsSeenLoaded = true;
        resolve();
      }
    });
  }

  function updateSetupEmailsBadgeDisplay(count) {
    const badge = document.getElementById('setup-emails-new-badge');
    if (!badge) return;
    if (count > 0) {
      badge.hidden = false;
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.setAttribute(
        'aria-label',
        count === 1 ? '1 new message' : `${count} new messages`
      );
    } else {
      badge.hidden = true;
      badge.textContent = '';
      badge.removeAttribute('aria-label');
    }
  }

  function markSetupEmailsSeen(personaId, emails) {
    if (!personaId) return;
    const seen = getSetupEmailsSeenIdSet(personaId);
    for (const email of emails || []) {
      if (email?.id != null) seen.add(String(email.id));
    }
    persistSetupEmailsSeenForPersona(personaId, seen);
    updateSetupEmailsBadgeDisplay(0);
  }

  function updateSetupEmailsNewState(personaId, emails) {
    if (!personaId) return;
    const list = emails || [];
    const ids = list.filter((e) => e?.id != null).map((e) => String(e.id));
    const seen = getSetupEmailsSeenIdSet(personaId);

    if (seen.size === 0 && ids.length > 0) {
      markSetupEmailsSeen(personaId, list);
      return;
    }

    const newCount = ids.filter((id) => !seen.has(id)).length;
    updateSetupEmailsBadgeDisplay(newCount);
  }
  let openingsSectionAvailable = true;
  let drawerViewMemory = { view: 'list', openingId: null };
  let selectedOpening = null;

  /** Single source of truth for which drawer chrome is visible. */
  const DrawerLayoutMode = {
    MAIN: 'main',
    OPENING_DETAIL: 'opening-detail',
    APPLICATION_DETAIL: 'application-detail'
  };

  function getDrawerLayoutMode() {
    if (
      applicationsViewMemory.view === 'detail' &&
      applicationsViewMemory.applicationId != null
    ) {
      return DrawerLayoutMode.APPLICATION_DETAIL;
    }
    if (drawerViewMemory.view === 'detail' && selectedOpening != null) {
      return DrawerLayoutMode.OPENING_DETAIL;
    }
    return DrawerLayoutMode.MAIN;
  }

  function isOpeningDetailActive() {
    return getDrawerLayoutMode() === DrawerLayoutMode.OPENING_DETAIL;
  }

  function isApplicationDetailActive() {
    return getDrawerLayoutMode() === DrawerLayoutMode.APPLICATION_DETAIL;
  }

  function queuePanelHasContent() {
    const queueEl = document.getElementById('score-queue-list');
    return !!(queueEl && queueEl.innerHTML.trim());
  }

  /**
   * Apply layout from getDrawerLayoutMode(). Call after any navigation or list refresh
   * that might affect chrome visibility — do not toggle sections ad hoc elsewhere.
   */
  function applyDrawerLayout() {
    if (tabbedLayout) {
      applyTabbedLayout();
      scheduleTabbedRender();
      flushPendingTabbedCommand();
      return;
    }
    const mode = getDrawerLayoutMode();
    const isMain = mode === DrawerLayoutMode.MAIN;
    const isOpeningDetail = mode === DrawerLayoutMode.OPENING_DETAIL;
    const isAppDetail = mode === DrawerLayoutMode.APPLICATION_DETAIL;

    setVisible(document.getElementById('drawer-list-only-block'), isMain);
    setVisible(
      document.getElementById('openings-section-content'),
      openingsSectionAvailable && (isMain || isOpeningDetail)
    );
    setVisible(
      document.getElementById('applications-section-content'),
      applicationsSectionAvailable && (isMain || isAppDetail)
    );
    setVisible(
      document.getElementById('score-queue-section-content'),
      isMain && queuePanelHasContent()
    );
    setVisible(
      document.getElementById('setup-emails-section-content'),
      setupEmailsEnabled() && setupEmailsSectionAvailable && isMain
    );

    setVisible(document.getElementById('openings-list-view'), isMain);
    setVisible(document.getElementById('opening-detail-view'), isOpeningDetail);
    setVisible(document.getElementById('applications-list-view'), isMain);
    setVisible(document.getElementById('application-detail-view'), isAppDetail);

    const analyzeStatusEl = document.getElementById('analyze-status');
    if (analyzeStatusEl) {
      if (!isMain) {
        analyzeStatusEl.hidden = true;
      } else if (!analyzeStatusEl.textContent) {
        analyzeStatusEl.hidden = true;
      }
    }
  }

  async function fetchApplications(personaId, options = {}) {
    if (!personaId) return;
    lastApplicationsPersonaId = personaId;
    if (usesApplicationsTodayStat() && options.silent !== true) {
      updateApplicationsTodayDisplay(null);
    }
    const listEl = document.getElementById('applications-list');
    if (options.silent !== true && listEl) {
      listEl.innerHTML = '<p class="drawer-hint">Loading…</p>';
    }
    try {
      const data = await window.ApplicaAPI.appFetchJson(
        `/api/applications?persona_id=${encodeURIComponent(personaId)}`
      );
      renderApplications({ loggedIn: true, data });
    } catch (err) {
      renderApplications({ loggedIn: true, error: err?.message || 'Failed to load applications' });
    }
  }

  function setupEmailsDefaultCollapsed() {
    return setupEmailsEnabled() && EXT.features?.setupEmailsDefaultCollapsed === true;
  }

  function setSetupEmailsSectionExpanded(expanded) {
    setupEmailsSectionExpanded = expanded;
    const toggle = document.getElementById('setup-emails-section-toggle');
    const body = document.getElementById('setup-emails-card-body');
    const card = document.querySelector('.drawer-setup-emails-card');
    if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (body) body.hidden = !expanded;
    if (card) card.classList.toggle('is-collapsed', !expanded);
    if (expanded && currentSetupEmailsPersonaId && lastSetupEmailsPayload?.data) {
      const emails = sortSetupEmails(lastSetupEmailsPayload.data?.emails || []);
      markSetupEmailsSeen(currentSetupEmailsPersonaId, emails);
    }
  }

  function resetSetupEmailsSectionCollapsed() {
    if (setupEmailsEnabled()) {
      setSetupEmailsSectionExpanded(!setupEmailsDefaultCollapsed());
    }
  }

  const SETUP_EMAIL_SORTING_TYPES = new Set([
    'setup_forwarding_rule',
    'system_verification_code'
  ]);

  function formatRelativeTime(iso) {
    if (!iso) return '';
    try {
      const then = new Date(iso).getTime();
      if (Number.isNaN(then)) return '';
      const diffSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
      if (diffSeconds < 60) return 'Just now';
      const minutes = Math.floor(diffSeconds / 60);
      if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
      const days = Math.floor(hours / 24);
      return days === 1 ? '1 day ago' : `${days} days ago`;
    } catch (_) {
      return '';
    }
  }

  function setupEmailTypeLabel(sortingType) {
    if (sortingType === 'system_verification_code') return 'Verification';
    if (sortingType === 'setup_forwarding_rule') return 'Forwarding';
    return 'Other';
  }

  function extractFirstHttpUrl(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/https?:\/\/[^\s<>"']+/i);
    return match ? match[0] : null;
  }

  function sortSetupEmails(emails) {
    return [...(emails || [])].sort((a, b) => {
      const aSetup = SETUP_EMAIL_SORTING_TYPES.has(a?.sorting_type) ? 0 : 1;
      const bSetup = SETUP_EMAIL_SORTING_TYPES.has(b?.sorting_type) ? 0 : 1;
      if (aSetup !== bSetup) return aSetup - bSetup;
      const aTime = a?.inserted_at ? new Date(a.inserted_at).getTime() : 0;
      const bTime = b?.inserted_at ? new Date(b.inserted_at).getTime() : 0;
      return bTime - aTime;
    });
  }

  function setupEmailRowHtml(email) {
    const subject = escapeHtml(email.subject || '(No subject)');
    const from = escapeHtml(email.from || 'Unknown sender');
    const when = escapeHtml(formatRelativeTime(email.inserted_at));
    const typeLabel = escapeHtml(setupEmailTypeLabel(email.sorting_type));
    const emailId = escapeHtml(String(email.id));
    const link = extractFirstHttpUrl(email.content);
    const linkHtml = link
      ? '<a class="drawer-setup-email-link" href="' +
        escapeHtml(link) +
        '" target="_blank" rel="noopener noreferrer">Open verification link</a>'
      : '';
    const preview = escapeHtml((email.content || '').trim().slice(0, 280));
    return (
      '<article class="drawer-setup-email-item" data-email-id="' +
      emailId +
      '">' +
      '<button type="button" class="drawer-setup-email-summary" aria-expanded="false">' +
      '<div class="drawer-setup-email-summary-top">' +
      '<span class="drawer-setup-email-type">' +
      typeLabel +
      '</span>' +
      '<span class="drawer-setup-email-time">' +
      when +
      '</span>' +
      '</div>' +
      '<div class="drawer-setup-email-subject">' +
      subject +
      '</div>' +
      '<div class="drawer-setup-email-from">' +
      from +
      '</div>' +
      '</button>' +
      '<div class="drawer-setup-email-body" hidden>' +
      (linkHtml ? '<div class="drawer-setup-email-actions">' + linkHtml + '</div>' : '') +
      '<pre class="drawer-setup-email-content">' +
      preview +
      '</pre>' +
      '</div>' +
      '</article>'
    );
  }

  function renderSetupEmails(payload) {
    const section = document.getElementById('setup-emails-section-content');
    const listEl = document.getElementById('setup-emails-list');
    if (!section || !listEl || !setupEmailsEnabled()) return;

    if (!payload?.loggedIn) {
      setupEmailsSectionAvailable = false;
      listEl.innerHTML = '';
      updateSetupEmailsBadgeDisplay(0);
      applyDrawerLayout();
      return;
    }

    setupEmailsSectionAvailable = true;

    if (payload.error) {
      listEl.innerHTML =
        '<div class="drawer-worklist-empty">' + escapeHtml(payload.error) + '</div>';
      applyDrawerLayout();
      return;
    }

    lastSetupEmailsPayload = payload;
    const emails = sortSetupEmails(payload.data?.emails || []);
    if (emails.length === 0) {
      listEl.innerHTML =
        '<div class="drawer-worklist-empty">No emails for this seeker.</div>';
    } else {
      listEl.innerHTML = emails.map(setupEmailRowHtml).join('');
    }

    const personaId = payload.personaId || currentSetupEmailsPersonaId;
    if (personaId) {
      if (setupEmailsSectionExpanded) {
        markSetupEmailsSeen(personaId, emails);
      } else {
        updateSetupEmailsNewState(personaId, emails);
      }
    }

    applyDrawerLayout();
  }

  async function fetchSetupEmails(personaId, options = {}) {
    if (!setupEmailsEnabled() || !personaId) return;
    await loadSetupEmailsSeenState();
    currentSetupEmailsPersonaId = personaId;
    const listEl = document.getElementById('setup-emails-list');
    if (options.silent !== true && listEl) {
      setupEmailsSectionAvailable = true;
      listEl.innerHTML = '<p class="drawer-hint">Loading…</p>';
      applyDrawerLayout();
    }
    try {
      const data = await window.ApplicaAPI.fetchEmails(personaId, { folderType: 'setup' });
      renderSetupEmails({ loggedIn: true, data, personaId });
    } catch (err) {
      renderSetupEmails({
        loggedIn: true,
        error: err?.message || 'Could not load setup emails.',
      });
    }
  }

  function stopSetupEmailsPoll() {
    if (setupEmailsPollIntervalId != null) {
      clearInterval(setupEmailsPollIntervalId);
      setupEmailsPollIntervalId = null;
    }
  }

  const SETUP_EMAILS_POLL_INTERVAL_MS = 3 * 60 * 1000;

  function startSetupEmailsPoll(personaId) {
    stopSetupEmailsPoll();
    if (!setupEmailsEnabled() || !personaId) return;
    setupEmailsPollIntervalId = setInterval(() => {
      fetchSetupEmails(personaId, { silent: true });
    }, SETUP_EMAILS_POLL_INTERVAL_MS);
  }

  function applicationListStatusEditable() {
    return EXT.features?.applicationListStatusEdit !== false;
  }

  function syncApplicationsListSubtitle() {
    const el = document.querySelector('#applications-section-content .drawer-worklist-subtitle');
    if (!el) return;
    el.textContent = applicationListStatusEditable()
      ? 'Change status on a card, or click for details.'
      : 'Click a card for details.';
  }

  function applicationRowHtml(app) {
    const company = escapeHtml(app.company || '—');
    const title = escapeHtml(app.title || '');
    const appliedAt = formatAppliedDate(app.applied_at);
    const appliedMeta = appliedAt
      ? '<div class="drawer-worklist-item-applied">Applied ' + escapeHtml(appliedAt) + '</div>'
      : '';
    const dataApplicationId =
      app.id != null ? ' data-application-id="' + escapeHtml(String(app.id)) + '"' : '';
    const normalizedStatus = normalizeApplicationStatus(app.status);
    const statusControl = applicationListStatusEditable()
      ? '<select class="drawer-application-row-status drawer-field-select" data-application-id="' +
        escapeHtml(String(app.id)) +
        '" aria-label="Application status for ' +
        escapeHtml(app.company || 'application') +
        '">' +
        statusOptionsHtml(normalizedStatus) +
        '</select>'
      : '<span class="drawer-application-row-status-label">' +
        escapeHtml(applicationStatusLabel(normalizedStatus)) +
        '</span>';
    const isCurrentPage = applicationMatchesCurrentPage(app);
    const rowClass =
      'drawer-worklist-item drawer-application-item' +
      (isCurrentPage ? ' drawer-opening-item-current' : '');
    const dataLink = app.link ? ' data-link="' + escapeHtml(app.link) + '"' : '';
    return (
      '<div class="' +
      rowClass +
      '"' +
      dataApplicationId +
      dataLink +
      '><div class="drawer-worklist-item-top"><div class="drawer-worklist-item-left"><div class="drawer-worklist-item-company">' +
      company +
      '</div><div class="drawer-worklist-item-position">' +
      title +
      '</div>' +
      appliedMeta +
      '</div><div class="drawer-worklist-item-score-wrap drawer-application-item-status-wrap">' +
      statusControl +
      '</div></div></div>'
    );
  }

  function renderApplications(payload) {
    syncApplicationsListSubtitle();
    const listEl = document.getElementById('applications-list');
    const section = document.getElementById('applications-section-content');
    if (!listEl) return;
    if (!payload.loggedIn) {
      listEl.innerHTML = '';
      applicationsSectionAvailable = false;
      applyDrawerLayout();
      syncAnalyzeJobButtonState();
      return;
    }
    applicationsSectionAvailable = true;
    if (payload.error) {
      listEl.innerHTML = '<div class="drawer-worklist-empty">' + escapeHtml(payload.error) + '</div>';
      applyDrawerLayout();
      syncAnalyzeJobButtonState();
      if (usesApplicationsTodayStat()) updateApplicationsTodayDisplay(null);
      return;
    }
    lastApplicationsPayload = payload;
    const apps = payload.data?.applications || [];
    if (apps.length === 0) {
      listEl.innerHTML = '<div class="drawer-worklist-empty">No applications yet.</div>';
      applyDrawerLayout();
      syncAnalyzeJobButtonState();
      if (usesApplicationsTodayStat()) updateApplicationsTodayDisplay(0);
      return;
    }
    const sortedApps = sortWithCurrentPageFirst(apps, applicationMatchesCurrentPage, (a, b) => {
      const aT = a?.applied_at ? new Date(a.applied_at).getTime() : 0;
      const bT = b?.applied_at ? new Date(b.applied_at).getTime() : 0;
      return bT - aT;
    });
    listEl.innerHTML = sortedApps.slice(0, 12).map(applicationRowHtml).join('');
    if (getDrawerLayoutMode() === DrawerLayoutMode.MAIN) {
      scrollHighlightedWorklistItemIntoView(listEl);
    }
    applyDrawerLayout();
    if (
      applicationsViewMemory.view === 'detail' &&
      applicationsViewMemory.applicationId != null
    ) {
      const active = sortedApps.find(
        (a) => a != null && String(a.id) === String(applicationsViewMemory.applicationId)
      );
      if (active) showApplicationDetail(active, { skipSaveState: true });
      else showApplicationsList();
    }
    syncAnalyzeJobButtonState();
    if (usesApplicationsTodayStat()) {
      updateApplicationsTodayDisplay(countApplicationsCreatedToday(apps));
    }
  }

  function upsertApplicationInList(application) {
    if (!application?.id) return;
    const existing = lastApplicationsPayload?.data?.applications || [];
    const apps = [...existing];
    const idx = apps.findIndex((a) => a != null && String(a.id) === String(application.id));
    if (idx >= 0) apps[idx] = application;
    else apps.unshift(application);
    renderApplications({ loggedIn: true, data: { applications: apps } });
  }

  function patchApplicationInList(applicationId, partial) {
    const existing = lastApplicationsPayload?.data?.applications || [];
    const apps = existing.map((a) =>
      a != null && String(a.id) === String(applicationId) ? { ...a, ...partial } : a
    );
    if (lastApplicationsPayload?.data) {
      lastApplicationsPayload = {
        ...lastApplicationsPayload,
        data: { ...lastApplicationsPayload.data, applications: apps }
      };
    }
  }

  async function updateApplication(applicationId, attrs) {
    const data = await window.ApplicaAPI.appFetchJson(
      '/api/applications/' + encodeURIComponent(applicationId),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attrs)
      }
    );
    if (!data.application) {
      throw new Error('Invalid response from server');
    }
    return data.application;
  }

  function readOpeningNetworkingFields() {
    return {
      contact_name: document.getElementById('opening-detail-contact-name')?.value?.trim() || '',
      contact_email: document.getElementById('opening-detail-contact-email')?.value?.trim() || '',
      contact_url: document.getElementById('opening-detail-contact-url')?.value?.trim() || ''
    };
  }

  function resetOpeningNetworkingFields() {
    ['opening-detail-contact-name', 'opening-detail-contact-email', 'opening-detail-contact-url'].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      }
    );
  }

  function syncOpeningDetailNetworkingFields(opening, previousOpeningId) {
    const section = document.getElementById('opening-detail-networking');
    if (!section) return;
    if (!isRecruiter) {
      section.hidden = true;
      return;
    }
    const hasApp = !!(opening?.has_application || opening?.linked_application?.id);
    section.hidden = hasApp;
    if (hasApp) {
      resetOpeningNetworkingFields();
      return;
    }
    if (opening?.id != null && String(opening.id) !== String(previousOpeningId ?? '')) {
      resetOpeningNetworkingFields();
    }
  }

  function syncOpeningDetailApplicationActions(opening) {
    const applyBtn = document.getElementById('opening-detail-remove');
    const hasApp = !!(opening?.has_application || opening?.linked_application?.id);
    if (applyBtn) applyBtn.hidden = hasApp;
  }

  async function renderCustomResumeSection(opening) {
    const section = document.getElementById('opening-detail-custom-resume');
    const locked = document.getElementById('opening-detail-custom-resume-locked');
    const uploadInput = document.getElementById('opening-detail-resume-upload');
    const uploadBtn = document.getElementById('opening-detail-upload-resume');
    const upgradeLink = document.getElementById('opening-detail-upgrade-link');
    if (!section) return;
    if (isRecruiter) {
      section.hidden = true;
      return;
    }
    const hasApp = opening?.has_application || opening?.linked_application;
    if (hasApp || isOpeningScoring(opening)) {
      section.hidden = true;
      if (uploadInput) uploadInput.value = '';
      if (uploadBtn) uploadBtn.hidden = true;
      return;
    }
    const canCustomize = lastOpeningsPayload?.data?.entitlements?.custom_resume_scoring === true;
    section.hidden = false;
    if (upgradeLink && window.ApplicaAPI?.appUrl) {
      try {
        upgradeLink.href = await window.ApplicaAPI.appUrl('/dashboard/settings#billing');
      } catch (_) {}
    }
    if (canCustomize) {
      if (locked) locked.hidden = true;
      if (uploadBtn) uploadBtn.hidden = false;
      const aside = section.querySelector('.drawer-custom-resume-aside');
      if (aside) aside.hidden = false;
    } else {
      if (locked) locked.hidden = false;
      if (uploadBtn) uploadBtn.hidden = true;
      const aside = section.querySelector('.drawer-custom-resume-aside');
      if (aside) aside.hidden = true;
    }
  }

  async function submitCustomResumeUpload(file) {
    if (!selectedOpening?.id || !file) return;
    const uploadBtn = document.getElementById('opening-detail-upload-resume');
    const uploadInput = document.getElementById('opening-detail-resume-upload');
    setAnalyzeStatus('', 'Uploading resume…');
    if (uploadBtn) uploadBtn.disabled = true;
    if (tabbedLayout) {
      tabbedCustomResumeBusy = true;
      scheduleTabbedRender();
    }
    try {
      const updatedOpening = await uploadCustomResumeForOpening(selectedOpening, file);
      selectedOpening = { ...selectedOpening, ...updatedOpening };
      if (uploadInput) uploadInput.value = '';
      if (!tabbedLayout) showOpeningDetail(selectedOpening);
      const personaId = personaPicker?.value;
      if (personaId) {
        startOpeningsPoll(personaId, { openingId: selectedOpening.id });
        await fetchOpenings(personaId, { silent: true, watchOpeningId: selectedOpening.id });
      }
      setAnalyzeStatus('', 'Resume uploaded. Re-scoring…');
      setTimeout(() => setAnalyzeStatus('', ''), 4000);
    } catch (err) {
      showApiErrorBanner();
      setAnalyzeStatus('error', err?.message || 'Upload failed.');
    } finally {
      if (uploadBtn) uploadBtn.disabled = false;
      if (tabbedLayout) {
        tabbedCustomResumeBusy = false;
        scheduleTabbedRender();
      }
    }
  }

  async function uploadCustomResumeForOpening(opening, file) {
    const formData = new FormData();
    formData.append('resume', file);
    const data = await window.ApplicaAPI.appFetchJson(
      '/api/openings/' + encodeURIComponent(opening.id) + '/resume_upload',
      { method: 'POST', body: formData }
    );
    return data.opening;
  }

  function showApplicationDetail(app, options = {}) {
    if (!app) return;
    selectedApplication = app;
    if (!options.skipSaveState) {
      applicationsViewMemory = { view: 'detail', applicationId: app.id ?? null };
      saveApplicationsViewState();
      setApplicationDetailSaveStatus('', '');
    }
    applyDrawerLayout();
    const companyEl = document.getElementById('application-detail-company');
    const titleEl = document.getElementById('application-detail-title');
    const appliedEl = document.getElementById('application-detail-applied');
    const salaryEl = document.getElementById('application-detail-salary');
    if (companyEl) companyEl.textContent = app.company || '—';
    if (titleEl) titleEl.textContent = app.title || '';
    if (appliedEl) {
      const appliedAt = formatAppliedDate(app.applied_at);
      appliedEl.textContent = appliedAt ? 'Applied ' + appliedAt : '';
      appliedEl.hidden = !appliedAt;
    }
    if (salaryEl) {
      if (app.salary) {
        salaryEl.textContent = 'Salary: ' + app.salary;
        salaryEl.hidden = false;
      } else {
        salaryEl.textContent = '';
        salaryEl.hidden = true;
      }
    }
    if (!options.skipFormFill) {
      fillApplicationFields(app);
    }
    const openLink = document.getElementById('application-detail-open-link');
    if (openLink) {
      openLink.href = app.link || '#';
      openLink.hidden = !app.link;
    }
  }

  function showApplicationsList() {
    applicationsViewMemory = { view: 'list', applicationId: null };
    saveApplicationsViewState();
    applyDrawerLayout();
  }

  function usageBadgeHtml(limits) {
    if (limits == null || limits === '') return '';
    if (limits === 'unlimited' || limits.unlimited === true) {
      return '<span class="drawer-usage-badge drawer-usage-badge--unlimited">unlimited</span>';
    }
    const remaining = limits.remaining;
    const count = limits.count;
    const period = limits.period != null ? String(limits.period) : '';
    if (typeof remaining !== 'number' || typeof count !== 'number') return '';
    const label = remaining + '/' + count + ' ' + period;
    const modifier =
      remaining > 0 ? 'drawer-usage-badge--remaining' : 'drawer-usage-badge--limit';
    return (
      '<span class="drawer-usage-badge ' + modifier + '">' + escapeHtml(label) + '</span>'
    );
  }

  /** Pull a stable job id from common ATS listing/detail URL shapes. */
  function extractJobIdentity(parsedUrl) {
    if (!parsedUrl) return null;
    const paramId =
      parsedUrl.searchParams.get('currentjobid') ||
      parsedUrl.searchParams.get('jobid') ||
      parsedUrl.searchParams.get('gh_jid') ||
      parsedUrl.searchParams.get('job_id');
    if (paramId) return paramId;
    const path = parsedUrl.pathname || '';
    const pathMatch =
      path.match(/\/jobs\/view\/(\d+)/) ||
      path.match(/\/job\/view\/([^/]+)/) ||
      path.match(/\/jobs\/(\d+)(?:\/|$)/) ||
      path.match(/\/job\/(\d+)(?:\/|$)/) ||
      // A UUID segment identifies the posting on Ashby, Lever and others, and stays the same on
      // its /application and /apply pages (jobs.ashbyhq.com/acme/<uuid>/application).
      path.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i);
    return pathMatch ? pathMatch[1].toLowerCase() : null;
  }

  /** Trailing "apply" pages of a posting (…/Engineer_R123/apply/applyManually) are the same job. */
  const APPLY_PATH_SUFFIX = /(?:\/(?:apply|application|applications|applymanually|apply-now|applynow))+\/?$/;

  function normalizeUrlForCompare(url) {
    if (!url || typeof url !== 'string') return '';
    let u = url.trim().toLowerCase();
    try {
      const parsed = new URL(u);
      const jobId = extractJobIdentity(parsed);
      if (jobId) return parsed.origin + '/__job__/' + jobId;
      u = parsed.origin + parsed.pathname.replace(APPLY_PATH_SUFFIX, '');
    } catch (_) {}
    return u.endsWith('/') && u.length > 1 ? u.slice(0, -1) : u;
  }

  function openingMatchesCurrentPage(opening) {
    return (
      currentPageUrl != null &&
      opening?.url != null &&
      normalizeUrlForCompare(opening.url) === normalizeUrlForCompare(currentPageUrl)
    );
  }

  function applicationMatchesCurrentPage(app) {
    return (
      currentPageUrl != null &&
      app?.link != null &&
      normalizeUrlForCompare(app.link) === normalizeUrlForCompare(currentPageUrl)
    );
  }

  function sortWithCurrentPageFirst(items, matchesFn, compareOtherwise) {
    return [...items].sort((a, b) => {
      const aCurrent = matchesFn(a);
      const bCurrent = matchesFn(b);
      if (aCurrent && !bCurrent) return -1;
      if (!aCurrent && bCurrent) return 1;
      return compareOtherwise ? compareOtherwise(a, b) : 0;
    });
  }

  function scrollHighlightedWorklistItemIntoView(listEl) {
    if (!listEl) return;
    requestAnimationFrame(() => {
      const match = listEl.querySelector(
        '.drawer-opening-item-current, .drawer-queue-item-current'
      );
      if (match) match.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function pageAlreadyTrackedAsOpening() {
    const openings = lastOpeningsPayload?.data?.openings || [];
    if (openings.some((o) => openingMatchesCurrentPage(o))) return true;
    if (currentPageUrl && getAnalyzingOpeningByUrl(currentPageUrl)) return true;
    return false;
  }

  function pageAlreadyTrackedAsApplication() {
    const apps = lastApplicationsPayload?.data?.applications || [];
    return apps.some((a) => applicationMatchesCurrentPage(a));
  }

  function syncAnalyzeJobButtonState() {
    scheduleTabbedRender();
    const analyzeBtn = document.getElementById('analyze-job-posting-btn');
    if (!analyzeBtn) return;
    const alreadyTracked = pageAlreadyTrackedAsOpening() || pageAlreadyTrackedAsApplication();
    analyzeBtn.disabled = alreadyTracked;
    analyzeBtn.title = alreadyTracked
      ? 'This job is already in your queue or applications.'
      : 'Analyze the current tab as a new job posting';
  }

  /** Score colors and badges — mirrors YouWeb.Helpers.LiveHelpers + ScoreSentiment */
  function scoreColor(score) {
    const n = Number(score);
    if (n !== n) return '#333333';
    if (n >= 80) return '#70C494';
    if (n >= 65) return '#EAB308';
    if (n >= 50) return '#F29A4B';
    return '#D94A3A';
  }

  function scoreLabel(score) {
    const n = Number(score);
    if (n !== n) return null;
    if (n >= 90) return 'Excellent';
    if (n >= 80) return 'Great';
    if (n >= 70) return 'Good';
    if (n >= 55) return 'Review';
    return 'Needs Work';
  }

  function hexToRgb(hex) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!match) return null;
    return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) };
  }

  function rgbToHex(r, g, b) {
    return (
      '#' +
      [r, g, b]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('')
    );
  }

  function darkenRgb(rgb, amount) {
    const factor = 1 - amount;
    return {
      r: Math.round(rgb.r * factor),
      g: Math.round(rgb.g * factor),
      b: Math.round(rgb.b * factor)
    };
  }

  function scoreBadgeStyle(score) {
    if (score == null || Number(score) !== Number(score)) {
      return 'background-color: rgba(51, 51, 51, 0.12); color: #333333; border-color: rgba(51, 51, 51, 0.2);';
    }
    const color = scoreColor(score);
    const rgb = hexToRgb(color);
    if (!rgb) return '';
    const text = darkenRgb(rgb, 0.2);
    return (
      'background-color: rgba(' +
      rgb.r +
      ', ' +
      rgb.g +
      ', ' +
      rgb.b +
      ', 0.18); color: ' +
      rgbToHex(text.r, text.g, text.b) +
      '; border-color: rgba(' +
      rgb.r +
      ', ' +
      rgb.g +
      ', ' +
      rgb.b +
      ', 0.35);'
    );
  }

  function scoreSentimentBadgeStyle(score) {
    const n = Number(score);
    if (n !== n) return null;
    if (n >= 90) return { color: '#AFDFDF', background: 'rgba(175, 223, 223, 0.1)' };
    if (n >= 80) return { color: '#70C494', background: 'rgba(112, 196, 148, 0.1)' };
    if (n >= 70) return { color: '#a16207', background: '#fef9c3' };
    if (n >= 55) return { color: '#ea580c', background: '#ffedd5' };
    return { color: '#dc2626', background: '#fee2e2' };
  }

  function applyScoreSentimentBadge(el, score) {
    if (!el) return;
    const label = scoreLabel(score);
    const style = scoreSentimentBadgeStyle(score);
    if (!label || !style) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = label;
    el.style.color = style.color;
    el.style.backgroundColor = style.background;
  }

  function applyCompactScoreDisplay(valueEl, badgeEl, score) {
    const n = score != null && score !== '' ? Math.round(Number(score)) : null;
    if (valueEl) {
      if (n == null || Number.isNaN(n)) {
        valueEl.textContent = '—';
        valueEl.style.color = '#333333';
      } else {
        valueEl.textContent = String(n);
        valueEl.style.color = scoreColor(n);
      }
    }
    applyScoreSentimentBadge(badgeEl, n);
  }

  /** Normalize score like app: 0–10 scale becomes 0–100 for display */
  function normalizeScore(score) {
    const n = Number(score);
    if (n !== n) return 0;
    if (n > 10) return Math.round(n);
    return Math.round(n * 10);
  }

  function getScoreFromAnalysis(analysis, key) {
    if (!analysis || typeof analysis !== 'object') return null;
    const raw = analysis[key] ?? analysis.analysis?.[key];
    if (raw == null) return null;
    const n = normalizeScore(raw);
    return n > 0 ? n : null;
  }

  function setCategoryScore(name, score) {
    const wrap = document.getElementById('opening-detail-score-' + name);
    const barEl = document.getElementById('opening-detail-score-' + name + '-bar');
    if (!wrap) return;
    if (score != null && score > 0) {
      wrap.hidden = false;
      const label =
        name === 'skill' ? 'Skill' : name === 'experience' ? 'Experience' : 'Education';
      wrap.setAttribute('aria-label', label + ' match ' + score + ' out of 100');
      if (barEl) {
        barEl.style.width = Math.min(100, Math.max(0, score)) + '%';
        barEl.style.backgroundColor = scoreColor(score);
      }
    } else {
      wrap.hidden = true;
    }
    refreshCategoriesCompactVisibility();
  }

  function refreshCategoriesCompactVisibility() {
    const container = document.getElementById('opening-detail-score-categories');
    if (!container) return;
    const anyVisible = ['skill', 'experience', 'education'].some((name) => {
      const wrap = document.getElementById('opening-detail-score-' + name);
      return wrap && !wrap.hidden;
    });
    container.hidden = !anyVisible;
  }

  const trashIconSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="drawer-queue-item-trash-icon" aria-hidden="true"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" x2="10" y1="11" y2="17"></line><line x1="14" x2="14" y1="11" y2="17"></line></svg>';

  const matchingAppsWarningIconSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="drawer-worklist-matching-apps-warning" aria-label="Has matching applications at this company"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

  function queueItemHtml(o, isInProgress) {
    const inProgress = !!isInProgress;
    const hasMeta = openingHasTitleAndCompany(o);
    const titleText = hasMeta
      ? [o.company, o.title].filter(Boolean).join(' - ')
      : o.url || 'Job posting';
    const titleEscaped = escapeHtml(titleText);
    const urlDisplay = o.url ? escapeHtml(o.url) : '';
    const badgeText = queueItemStatusLabel(o, inProgress);
    const incomplete = !inProgress && !hasMeta;
    const modifier = inProgress
      ? 'drawer-queue-item--in-progress'
      : incomplete
        ? 'drawer-queue-item--incomplete'
        : 'drawer-queue-item--queued';
    const currentClass = openingMatchesCurrentPage(o) ? ' drawer-queue-item-current' : '';
    const dataUrl = o.url ? ' data-url="' + escapeHtml(o.url) + '"' : '';
    const dataOpeningId =
      o.id != null ? ' data-opening-id="' + escapeHtml(String(o.id)) + '"' : '';
    const trackedAnalyzing = !!(o.url && getAnalyzingOpeningByUrl(o.url));
    const urlRow =
      hasMeta && urlDisplay
        ? '<p class="drawer-queue-item-url">' + urlDisplay + '</p>'
        : incomplete
          ? trackedAnalyzing
            ? '<p class="drawer-queue-item-hint">Still processing — you can analyze other jobs while this finishes</p>'
            : '<p class="drawer-queue-item-hint">Processing did not finish — remove and try again</p>'
          : '';
    const removeBtn = queueItemRemoveButtonHtml(o, inProgress);
    return (
      '<div class="drawer-queue-item ' +
      modifier +
      currentClass +
      '"' +
      dataUrl +
      dataOpeningId +
      '><div class="drawer-queue-item-main"><div class="drawer-queue-item-dot"></div><div class="drawer-queue-item-text"><p class="drawer-queue-item-title">' +
      titleEscaped +
      '</p>' +
      urlRow +
      '</div></div><div class="drawer-queue-item-actions"><span class="drawer-queue-item-badge">' +
      escapeHtml(badgeText) +
      '</span>' +
      removeBtn +
      '</div></div>'
    );
  }

  function queueItemRemoveButtonHtml(o, inProgress) {
    const btnClass = 'drawer-worklist-item-delete drawer-queue-item-remove';
    if (o.id != null) {
      return (
        '<button type="button" class="' +
        btnClass +
        '" aria-label="Remove from processing queue" data-opening-id="' +
        escapeHtml(String(o.id)) +
        '">' +
        trashIconSvg +
        '</button>'
      );
    }
    if (inProgress && o.url) {
      return (
        '<button type="button" class="' +
        btnClass +
        '" aria-label="Cancel analyzing this job" data-cancel-queue="true" data-url="' +
        escapeHtml(o.url) +
        '">' +
        trashIconSvg +
        '</button>'
      );
    }
    return '';
  }

  function openingRowHtml(o) {
    const company = escapeHtml(o.company || '');
    const position = escapeHtml(o.title || '');
    const score = o.current_match_score;
    const scoreNum =
      score != null && score !== '' && score != 0 ? Math.round(Number(score)) : null;
    const hasMatchingApps = Array.isArray(o.matching_applications) && o.matching_applications.length > 0;
    const hasCompanyAlerts =
      !!o.company_avoid_warning || !!o.interview_in_progress_warning || hasMatchingApps;
    const matchingAppsTitle = o.company_avoid_warning
      ? 'Company on avoid list'
      : o.interview_in_progress_warning
        ? 'Interview in progress at this company'
        : 'Existing applications at this company';
    const matchingAppsWarning = hasCompanyAlerts
      ? '<span class="drawer-worklist-matching-apps-wrap" title="' +
        escapeHtml(matchingAppsTitle) +
        '">' +
        matchingAppsWarningIconSvg +
        '</span>'
      : '';
    const scoreHtml =
      scoreNum != null
        ? '<span class="drawer-worklist-match-badge" style="' + scoreBadgeStyle(scoreNum) + '">' + scoreNum + '</span>'
        : '—';
    const isCurrentPage = openingMatchesCurrentPage(o);
    const rowClass =
      'drawer-worklist-item' + (isCurrentPage ? ' drawer-opening-item-current' : '');
    const dataUrl = o.url ? ' data-url="' + escapeHtml(o.url) + '"' : '';
    const dataOpeningId = o.id != null ? ' data-opening-id="' + escapeHtml(String(o.id)) + '"' : '';
    const hasResume = o.cv_filename != null && String(o.cv_filename).trim() !== '';
    const resumeName = hasResume ? escapeHtml(String(o.cv_filename)) : '';
    const resumePart = hasResume
      ? (o.cv_url
          ? '<div class="drawer-worklist-item-resume">Resume: <a class="drawer-worklist-item-resume-name" href="' + escapeHtml(o.cv_url) + '" target="_blank" rel="noopener">' + resumeName + '</a></div>'
          : '<div class="drawer-worklist-item-resume">Resume: <span class="drawer-worklist-item-resume-name">' + resumeName + '</span></div>')
      : '';
    const deleteBtn =
      '<button type="button" class="drawer-worklist-item-delete" aria-label="Remove from worklist"' +
      dataOpeningId +
      '>' + trashIconSvg + '</button>';
    const hasBottom = !!hasResume;
    const bottomRow = hasBottom
      ? '<div class="drawer-worklist-item-bottom">' + resumePart + '</div>'
      : '';
    return (
      '<div class="' +
      rowClass +
      '"' +
      dataUrl +
      dataOpeningId +
      '><div class="drawer-worklist-item-top"><div class="drawer-worklist-item-left"><div class="drawer-worklist-item-company">' +
      company +
      '</div><div class="drawer-worklist-item-position">' +
      position +
      '</div></div><div class="drawer-worklist-item-score-wrap">' +
      matchingAppsWarning +
      scoreHtml +
      deleteBtn +
      '</div></div>' +
      bottomRow +
      '</div>'
    );
  }

  let lastPersonas = [];

  function syncProfilePickerLayout() {
    const showPicker = EXT.alwaysShowPersonaPicker || lastPersonas.length > 1;
    const pickerBlock = document.getElementById('drawer-profile-picker-block');
    const resumeRow = document.getElementById('drawer-profile-resume-row');
    const resumeSingle = document.getElementById('drawer-profile-resume-single');
    const profileCard = document.getElementById('drawer-profile-card');
    if (pickerBlock) pickerBlock.hidden = !showPicker;
    if (resumeRow) resumeRow.hidden = !showPicker;
    if (resumeSingle) resumeSingle.hidden = showPicker;
    if (profileCard) {
      profileCard.classList.toggle('drawer-profile-card--single', !showPicker);
      profileCard.classList.toggle('drawer-profile-card--multi', showPicker);
    }
  }

  let profilePreferencesExpanded = true;

  function formatSalaryAmount(amount) {
    if (amount == null || amount === '') return null;
    return '$' + Number(amount).toLocaleString('en-US');
  }

  function formatSalaryRange(minSalary, maxSalary) {
    const min = formatSalaryAmount(minSalary);
    const max = formatSalaryAmount(maxSalary);
    if (min && max) return min + ' - ' + max;
    if (min) return min + '+';
    if (max) return 'Up to ' + max;
    return '—';
  }

  function applicationStatusLabel(status) {
    const labels = {
      draft: 'Draft',
      applied: 'Applied',
      screening: 'Interviewing - Screening',
      early: 'Interviewing - Early',
      mid: 'Interviewing - Mid',
      late: 'Interviewing - Late',
      rejected: 'Rejected',
      offered: 'Offered',
      declined: 'Declined',
      hired: 'Hired'
    };
    return labels[status] || status || '';
  }

  function profilePrefBlock(label, valueHtml, valueClass) {
    const valueClasses = ['drawer-profile-pref-value'];
    if (valueClass) valueClasses.push(valueClass);
    return (
      '<div class="drawer-profile-pref-row">' +
      '<div class="drawer-profile-pref-label">' +
      escapeHtml(label) +
      '</div>' +
      '<div class="' +
      valueClasses.join(' ') +
      '">' +
      valueHtml +
      '</div></div>'
    );
  }

  function profilePrefTags(label, value, tagClass) {
    const items = String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const tagClasses = ['drawer-profile-pref-tag'];
    if (tagClass) tagClasses.push(tagClass);
    const tags = items
      .map(
        (item) =>
          '<span class="' + tagClasses.join(' ') + '">' + escapeHtml(item) + '</span>'
      )
      .join('');
    return (
      '<div class="drawer-profile-pref-row">' +
      '<div class="drawer-profile-pref-label">' +
      escapeHtml(label) +
      '</div>' +
      '<div class="drawer-profile-pref-tags">' +
      tags +
      '</div></div>'
    );
  }

  function setProfilePreferencesExpanded(expanded) {
    profilePreferencesExpanded = expanded;
    const toggle = document.getElementById('drawer-profile-preferences-toggle');
    const section = document.getElementById('drawer-profile-preferences');
    if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (section) section.classList.toggle('is-collapsed', !expanded);
  }

  function bindProfilePreferencesToggle() {
    const section = document.getElementById('drawer-profile-preferences');
    if (!section || section.dataset.toggleBound === 'true') return;
    section.dataset.toggleBound = 'true';
    section.addEventListener('click', (e) => {
      const toggle = e.target.closest('#drawer-profile-preferences-toggle');
      if (!toggle) return;
      e.preventDefault();
      e.stopPropagation();
      setProfilePreferencesExpanded(!profilePreferencesExpanded);
    });
  }

  function bindProfilePreferencesCopy() {
    const body = document.getElementById('drawer-profile-preferences-body');
    if (!body || body.dataset.copyBound === 'true') return;
    body.dataset.copyBound = 'true';
    body.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.drawer-applicant-copy-value');
      if (!copyBtn || !body.contains(copyBtn)) return;
      e.preventDefault();
      e.stopPropagation();
      handleApplicantCopyClick(copyBtn).catch(() => {
        copyBtn.classList.add('is-copied');
        window.setTimeout(() => copyBtn.classList.remove('is-copied'), 1200);
      });
    });
  }

  function renderProfilePreferences(persona) {
    const section = document.getElementById('drawer-profile-preferences');
    const body = document.getElementById('drawer-profile-preferences-body');
    if (!section || !body) return;
    if (!isRecruiter || !persona?.profile_preferences) {
      section.hidden = true;
      body.innerHTML = '';
      return;
    }

    const prefs = persona.profile_preferences;
    const rows = [];
    if (prefs.workday_password) {
      rows.push(renderApplicantCopyField('Workday password', prefs.workday_password, { masked: true }));
    }
    if (prefs.title_notes) {
      rows.push(
        profilePrefBlock('Notes for recruiter', escapeHtml(prefs.title_notes), 'drawer-profile-pref-notes')
      );
    }
    if (prefs.alt_titles) {
      rows.push(profilePrefTags('Target job titles', prefs.alt_titles));
    }
    if (prefs.min_salary != null || prefs.max_salary != null) {
      rows.push(
        profilePrefBlock('Salary range', escapeHtml(formatSalaryRange(prefs.min_salary, prefs.max_salary)))
      );
    }
    if (prefs.preferred_locations) {
      rows.push(profilePrefBlock('Preferred locations', escapeHtml(prefs.preferred_locations)));
    }
    if (prefs.companies_to_avoid) {
      rows.push(profilePrefTags('Do not apply to', prefs.companies_to_avoid, 'drawer-profile-pref-tag--avoid'));
    }

    if (rows.length === 0) {
      section.hidden = true;
      body.innerHTML = '';
      return;
    }

    body.innerHTML = rows.join('');
    section.hidden = false;
    setProfilePreferencesExpanded(profilePreferencesExpanded);
  }

  function setProfileResumeLink(el, persona) {
    if (!el) return;
    const resumeName = persona?.cv_filename ?? '—';
    const downloadPath = persona?.resume_download_path || '';
    const canDownload = resumeName !== '—' && !!downloadPath;
    el.textContent = resumeName;
    el.title = canDownload ? `Download ${resumeName}` : resumeName !== '—' ? resumeName : '';
    el.classList.toggle('is-downloadable', canDownload);
    if (downloadPath) {
      el.dataset.resumeDownloadPath = downloadPath;
      el.dataset.filename = resumeName;
    } else {
      delete el.dataset.resumeDownloadPath;
      delete el.dataset.filename;
    }
    el.removeAttribute('href');
    el.removeAttribute('target');
    el.removeAttribute('rel');
  }

  function triggerBlobDownload(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename || 'resume.pdf';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  async function downloadPersonaResume(el) {
    const downloadPath = el.dataset.resumeDownloadPath;
    const filename = el.dataset.filename || el.textContent?.trim() || 'resume.pdf';
    if (!downloadPath || !window.ApplicaAPI || typeof window.ApplicaAPI.appFetch !== 'function') {
      throw new Error('Resume is not available.');
    }
    const res = await window.ApplicaAPI.appFetch(downloadPath, {
      headers: { Accept: '*/*' },
    });
    if (!res.ok) {
      throw new Error('Could not download resume.');
    }
    triggerBlobDownload(await res.blob(), filename);
  }

  function bindProfileResumeDownload() {
    const card = document.getElementById('drawer-profile-card');
    if (!card || card.dataset.resumeDownloadBound === 'true') return;
    card.dataset.resumeDownloadBound = 'true';
    card.addEventListener('click', (e) => {
      const link = e.target.closest('.drawer-profile-resume-name, .drawer-profile-resume-single');
      if (!link?.classList.contains('is-downloadable')) return;
      e.preventDefault();
      e.stopPropagation();
      downloadPersonaResume(link).catch((err) => {
        setDrawerFeedback('error', err?.message || 'Could not download resume.');
      });
    });
  }

  async function updateProfileCard(persona) {
    const scoreEl = document.getElementById('applica-profile-score');
    const scoreBadgeEl = document.getElementById('applica-profile-score-badge');
    const resumeEl = document.getElementById('applica-profile-resume');
    const resumeSingleEl = document.getElementById('drawer-profile-resume-single');
    const linkEl = document.getElementById('applica-profile-manage-link');
    const hiringCafeLink = document.getElementById('applica-profile-hiring-cafe-link');
    if (scoreEl) {
      if (usesApplicationsTodayStat()) {
        const personaId = persona?.id;
        const hasCachedApps =
          personaId &&
          lastApplicationsPersonaId &&
          String(personaId) === String(lastApplicationsPersonaId) &&
          lastApplicationsPayload?.data;
        updateApplicationsTodayDisplay(
          hasCachedApps
            ? countApplicationsCreatedToday(lastApplicationsPayload.data.applications || [])
            : null
        );
      } else {
        const hasScore = persona && persona.match_score != null && persona.match_score !== '';
        applyCompactScoreDisplay(scoreEl, scoreBadgeEl, hasScore ? persona.match_score : null);
      }
    }
    setProfileResumeLink(resumeEl, persona);
    setProfileResumeLink(resumeSingleEl, persona);
    if (linkEl && window.ApplicaAPI && typeof window.ApplicaAPI.appUrl === 'function') {
      try {
        linkEl.href = await window.ApplicaAPI.appUrl('/dashboard/profiles');
      } catch (_) {}
    }
    if (hiringCafeLink) {
      const url = persona?.hiring_cafe_url;
      if (url && EXT.features?.hiringCafe !== false) {
        hiringCafeLink.href = url;
        hiringCafeLink.hidden = false;
      } else {
        hiringCafeLink.href = '#';
        hiringCafeLink.hidden = true;
      }
    }
    renderProfilePreferences(persona);
    syncProfilePickerLayout();
    scheduleTabbedRender();
  }

  function saveSelectedPersonaId(personaId) {
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        chrome.storage.local.set({
          [STORAGE.DRAWER_SELECTED_PERSONA]: personaId ? String(personaId) : null
        }, () => {});
      }
    } catch (_) {}
  }

  function loadSelectedPersonaId() {
    return new Promise((resolve) => {
      try {
        if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
          resolve(null);
          return;
        }
        chrome.storage.local.get([STORAGE.DRAWER_SELECTED_PERSONA], (data) => {
          try {
            const raw = data?.[STORAGE.DRAWER_SELECTED_PERSONA];
            resolve(raw != null && raw !== '' ? String(raw) : null);
          } catch (_) {
            resolve(null);
          }
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function renderPersonas(payload) {
    const picker = document.getElementById('applica-persona-picker');
    if (!picker) return;
    if (payload.error) {
      lastPersonas = [];
      tabbedPersonasState = { loaded: true, error: payload.error };
      syncProfilePickerLayout();
      picker.innerHTML = `<option value="">${escapeHtml(payload.error)}</option>`;
      picker.disabled = true;
      updateProfileCard(null);
      return;
    }
    const personas = payload.data?.personas || [];
    lastPersonas = personas;
    tabbedPersonasState = { loaded: true, error: null };
    syncProfilePickerLayout();
    picker.disabled = false;
    picker.innerHTML = personas.length
      ? personas
          .map(
            (p) =>
              `<option value="${escapeHtml(String(p.id))}">${escapeHtml(personaPickerOptionLabel(p))}</option>`
          )
          .join('')
      : '<option value="">No personas</option>';
    if (personas.length > 0) {
      const savedPersonaId = await loadSelectedPersonaId();
      const selectedPersona =
        (savedPersonaId && personas.find((p) => String(p.id) === savedPersonaId)) || personas[0];
      picker.value = String(selectedPersona.id);
      saveSelectedPersonaId(selectedPersona.id);
      updateProfileCard(selectedPersona);
      fetchOpenings(selectedPersona.id);
      if (applicationsSectionAvailable) fetchApplications(selectedPersona.id);
      if (setupEmailsEnabled()) {
        resetSetupEmailsSectionCollapsed();
        fetchSetupEmails(selectedPersona.id);
        startSetupEmailsPoll(selectedPersona.id);
      }
    } else {
      updateProfileCard(null);
      const listEl = document.getElementById('openings-list');
      if (listEl) listEl.innerHTML = '';
      stopSetupEmailsPoll();
      renderSetupEmails({ loggedIn: false });
    }
  }

  async function refreshAuthState() {
    if (isRecruiter) {
      const token = await window.ApplicaAPI.getAuthToken();
      const actor =
        typeof window.ApplicaAPI.getStoredRecruiter === 'function'
          ? await window.ApplicaAPI.getStoredRecruiter()
          : null;
      if (token && actor) {
        if (signedInEmail) {
          signedInEmail.textContent = actor.name || actor.id || 'Recruiter';
        }
        showSection('signed-in');
        fetchPersonas();
      } else {
        showSection('login');
        stopSetupEmailsPoll();
        renderSetupEmails({ loggedIn: false });
      }
      return;
    }

    const user = await window.ApplicaAPI.getStoredUser();
    if (user && user.email) {
      signedInEmail.textContent = user.email;
      showSection('signed-in');
      fetchPersonas();
    } else {
      showSection('login');
    }
  }

  function saveDrawerViewState(view, openingId) {
    drawerViewMemory = { view, openingId: openingId ?? null };
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        chrome.storage.local.set({
          [STORAGE.DRAWER_VIEW_STATE]: drawerViewMemory
        }, () => {});
      }
    } catch (_) {}
  }

  function saveApplicationsViewState() {
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        chrome.storage.local.set({
          [STORAGE.DRAWER_APPLICATIONS_VIEW]: applicationsViewMemory
        }, () => {});
      }
    } catch (_) {}
  }

  function loadApplicationsViewState() {
    return new Promise((resolve) => {
      try {
        if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
          resolve(null);
          return;
        }
        chrome.storage.local.get([STORAGE.DRAWER_APPLICATIONS_VIEW], (data) => {
          try {
            const raw = data?.[STORAGE.DRAWER_APPLICATIONS_VIEW];
            if (raw && (raw.view === 'list' || raw.view === 'detail')) {
              resolve({
                view: raw.view,
                applicationId: raw.applicationId ?? null
              });
            } else {
              resolve(null);
            }
          } catch (_) {
            resolve(null);
          }
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function loadDrawerViewState() {
    return new Promise((resolve) => {
      try {
        if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
          resolve(null);
          return;
        }
        chrome.storage.local.get([STORAGE.DRAWER_VIEW_STATE], (data) => {
          try {
            const raw = data?.[STORAGE.DRAWER_VIEW_STATE];
            if (raw && (raw.view === 'list' || raw.view === 'detail')) {
              resolve({ view: raw.view, openingId: raw.openingId ?? null });
            } else {
              resolve(null);
            }
          } catch (_) {
            resolve(null);
          }
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  let currentPageUrl = null;
  let lastOpeningsPayload = null;

  /** Messages from our content script (sender-checked in the runtime.onMessage listener below). */
  async function handleContentMessage(data, origin) {
    if (data?.type === 'applica-drawer-opened') {
      rememberParentPageOrigin(data.pageOrigin);
      if (!isHttpPageOrigin(parentPageOrigin)) {
        rememberParentPageOrigin(origin);
      }
      if (!isHttpPageOrigin(parentPageOrigin)) return;
      const previousPageUrl = currentPageUrl;
      currentPageUrl = data.currentPageUrl || null;
      if (tabbedLayout) {
        currentPageJob = data.pageJob || null;
        // Moving from a posting to its application form is the same job: keep the fill result.
        if (normalizeUrlForCompare(previousPageUrl) !== normalizeUrlForCompare(currentPageUrl)) {
          tabbedFill = null;
        }
      }
      if (lastOpeningsPayload) renderOpenings(lastOpeningsPayload);
      if (lastApplicationsPayload) renderApplications(lastApplicationsPayload);
      if (lastSetupEmailsPayload) renderSetupEmails(lastSetupEmailsPayload);
      refreshAuthState();
      const storedApps = await loadApplicationsViewState();
      if (storedApps) {
        applicationsViewMemory = storedApps;
      }
      if (tabbedLayout) {
        // Opening detail lives on the Analyze tab now; only an application detail is restored.
        if (previousPageUrl == null && isApplicationDetailActive()) setTabbedTab('history');
        refreshShortcutLabels();
        applyDrawerLayout();
        syncAnalyzeJobButtonState();
        return;
      }
      const storedOpenings = await loadDrawerViewState();
      if (storedOpenings) {
        drawerViewMemory = storedOpenings;
      }
      if (isApplicationDetailActive()) {
        applyDrawerLayout();
      } else if (storedOpenings) {
        applyDrawerViewStateSync();
      } else {
        tryShowDetailViewForCurrentPage();
        if (!isOpeningDetailActive()) {
          tryShowApplicationDetailForCurrentPage();
        }
      }
      syncAnalyzeJobButtonState();
      return;
    }
    if (data?.type === 'applica-page-data') {
      if (!isHttpPageOrigin(origin)) return;
      handlePageDataForAnalyze(data);
    }
    if (data?.type === 'applica-show-api-error-banner') {
      if (!isHttpPageOrigin(origin)) return;
      showApiErrorBanner();
    }
    if (data?.type === 'applica-run-command') {
      if (tabbedLayout) runTabbedCommand(data.command);
      return;
    }
    if (data?.type === 'applica-fill-form-result') {
      if (!isHttpPageOrigin(origin)) return;
      const r = data;
      if (tabbedLayout) {
        if (tabbedFillTimeoutId) {
          clearTimeout(tabbedFillTimeoutId);
          tabbedFillTimeoutId = null;
        }
        if (r.error) {
          tabbedFill = null;
          showApiErrorBanner();
          setAnalyzeStatus('error', r.error);
        } else if (tabbedFill) {
          tabbedFill = {
            ...tabbedFill,
            pending: false,
            result: {
              filled: Number(r.filled) || 0,
              resumeAttached: Number(r.resumeAttached) || 0,
              resumeError: r.resumeError || null
            }
          };
        }
        scheduleTabbedRender();
        return;
      }
      if (r.error) {
        showApiErrorBanner();
        setAnalyzeStatus('error', r.error);
      } else if (r.filled != null && r.total != null) {
        let msg = r.filled > 0 ? `Filled ${r.filled} of ${r.total} fields.` : 'No matching form fields found.';
        if (r.resumeAttached > 0) {
          msg += ' Resume attached.';
        } else if (r.resumeError) {
          msg += ` ${r.resumeError}`;
        } else if (r.resumeAttached === 0 && r.total > 0) {
          msg += ' No resume file input found.';
        }
        setAnalyzeStatus('', msg);
        setTimeout(() => setAnalyzeStatus('', ''), 4000);
      }
    }
  }

  let openingsPollIntervalId = null;
  let openingsPollDelayId = null;
  let openingsPollStopId = null;
  let openingsPollPersonaId = null;
  let openingsPollStartedAt = null;
  const pollingWatchOpeningIds = new Set();

  const OPENINGS_POLL_INTERVAL_MS = 2000;
  const OPENINGS_POLL_INITIAL_DELAY_MS = 30000;
  const OPENINGS_POLL_MAX_DURATION_MS = 90000;
  /** Keep polling while jobs are still scoring, up to this hard cap from first ensure. */
  const OPENINGS_POLL_HARD_CAP_MS = 5 * 60 * 1000;

  function hasPendingAnalyzingWork() {
    if (pollingWatchOpeningIds.size > 0) return true;
    return analyzingOpeningEntries().some((opening) => {
      if (opening.id != null) {
        const listed = findOpeningById(opening.id);
        return !listed || !openingHasScore(listed);
      }
      return true;
    });
  }

  function maybeStopOpeningsPollAfterFetch() {
    for (const id of [...pollingWatchOpeningIds]) {
      const opening = findOpeningById(id);
      if (opening && openingHasScore(opening)) {
        pollingWatchOpeningIds.delete(id);
        forgetAnalyzingOpening(opening);
      }
    }
    if (!hasPendingAnalyzingWork()) stopOpeningsPoll();
  }

  function clearOpeningsPollTimers() {
    if (openingsPollDelayId != null) {
      clearTimeout(openingsPollDelayId);
      openingsPollDelayId = null;
    }
    if (openingsPollIntervalId != null) {
      clearInterval(openingsPollIntervalId);
      openingsPollIntervalId = null;
    }
    if (openingsPollStopId != null) {
      clearTimeout(openingsPollStopId);
      openingsPollStopId = null;
    }
  }

  function openingsPollDeadlineMs(requestedMaxMs) {
    const windowMs = requestedMaxMs != null ? requestedMaxMs : OPENINGS_POLL_MAX_DURATION_MS;
    const startedAt = openingsPollStartedAt || Date.now();
    const elapsed = Date.now() - startedAt;
    const remainingHardCap = Math.max(0, OPENINGS_POLL_HARD_CAP_MS - elapsed);
    return Math.min(windowMs, remainingHardCap);
  }

  function scheduleOpeningsPollStop(personaId, requestedMaxMs) {
    if (openingsPollStopId != null) {
      clearTimeout(openingsPollStopId);
      openingsPollStopId = null;
    }
    const stopAfterMs = openingsPollDeadlineMs(requestedMaxMs);
    if (stopAfterMs <= 0) {
      finishOpeningsPollWindow(personaId);
      return;
    }
    openingsPollStopId = setTimeout(() => finishOpeningsPollWindow(personaId), stopAfterMs);
  }

  /** Soft end: one last fetch; extend if work remains and hard cap allows; else stop timers only. */
  function finishOpeningsPollWindow(personaId) {
    openingsPollStopId = null;
    if (!personaId) {
      stopOpeningsPoll();
      return;
    }
    fetchOpenings(personaId, { silent: true }).finally(() => {
      if (!hasPendingAnalyzingWork()) {
        stopOpeningsPoll();
        return;
      }
      const extendMs = openingsPollDeadlineMs(OPENINGS_POLL_MAX_DURATION_MS);
      if (extendMs <= OPENINGS_POLL_INTERVAL_MS) {
        // Hard cap reached — leave analyzing map so UI can still say "Still processing",
        // but stop timers. maybeResumeScoringPoll can restart on next user fetch.
        clearOpeningsPollTimers();
        openingsPollPersonaId = null;
        openingsPollStartedAt = null;
        return;
      }
      if (openingsPollIntervalId == null && openingsPollDelayId == null) {
        openingsPollPersonaId = personaId;
        const pollOnce = () => fetchOpenings(personaId, { silent: true });
        openingsPollIntervalId = setInterval(pollOnce, OPENINGS_POLL_INTERVAL_MS);
      }
      scheduleOpeningsPollStop(personaId, OPENINGS_POLL_MAX_DURATION_MS);
    });
  }

  function ensureOpeningsPoll(personaId, options = {}) {
    if (!personaId) return;
    if (options.openingId != null) pollingWatchOpeningIds.add(String(options.openingId));

    const maxPollMs =
      options.maxPollMs != null ? options.maxPollMs : OPENINGS_POLL_MAX_DURATION_MS;

    const alreadyScheduledForPersona =
      openingsPollPersonaId === personaId &&
      (openingsPollIntervalId != null || openingsPollDelayId != null);

    if (alreadyScheduledForPersona) {
      // New job arrived while polling — extend the stop window; keep watch ids.
      scheduleOpeningsPollStop(personaId, maxPollMs);
      return;
    }

    // Restart timers without clearing watch ids (previous stopOpeningsPoll wiped the first id).
    clearOpeningsPollTimers();
    openingsPollPersonaId = personaId;
    if (openingsPollStartedAt == null) openingsPollStartedAt = Date.now();

    const delayMs =
      options.delayMs != null ? options.delayMs : OPENINGS_POLL_INITIAL_DELAY_MS;

    const beginPolling = () => {
      openingsPollDelayId = null;
      const pollOnce = () => {
        fetchOpenings(personaId, { silent: true });
      };
      pollOnce();
      openingsPollIntervalId = setInterval(pollOnce, OPENINGS_POLL_INTERVAL_MS);
      scheduleOpeningsPollStop(personaId, maxPollMs);
    };

    if (delayMs > 0) {
      openingsPollDelayId = setTimeout(beginPolling, delayMs);
    } else {
      beginPolling();
    }
  }

  function startOpeningsPoll(personaId, options = {}) {
    ensureOpeningsPoll(personaId, options);
  }

  function stopOpeningsPoll() {
    clearOpeningsPollTimers();
    openingsPollPersonaId = null;
    openingsPollStartedAt = null;
    pollingWatchOpeningIds.clear();
  }

  /** Resume polling after navigation reloads the drawer iframe mid-score. */
  function maybeResumeScoringPoll(personaId) {
    if (!personaId || openingsPollIntervalId != null || openingsPollDelayId != null) return;
    const detailOpening = isOpeningDetailActive() && selectedOpening;
    const hasScoringDetail = detailOpening && isOpeningScoring(detailOpening);
    const hasTrackedOpenings = analyzingOpeningEntries().some((opening) => isOpeningScoring(opening));
    if (!hasScoringDetail && !hasTrackedOpenings && pollingWatchOpeningIds.size === 0) return;
    ensureOpeningsPoll(personaId, {
      openingId: detailOpening?.id ?? null,
      delayMs: 0,
      maxPollMs: OPENINGS_POLL_MAX_DURATION_MS
    });
  }

  function handlePageDataForAnalyze(data) {
    const pending = takePendingAnalyze(data.requestId);
    syncAnalyzeJobButtonState();
    if (data.error) {
      setAnalyzeStatus('error', data.error);
      return;
    }
    const personaId = pending?.personaId;
    if (!personaId) {
      setAnalyzeStatus('error', 'No profile selected.');
      return;
    }
    if (data.htmlTruncated) {
      setAnalyzeStatus(
        '',
        'Page is very large — sent a trimmed snapshot. Analysis may be less accurate.'
      );
    }
    submitOpeningFromPage(data.url, data.html, personaId);
  }

  function setAnalyzeStatus(kind, message) {
    const el = document.getElementById('analyze-status');
    if (!el) return;
    if (analyzeStatusClearTimeout) {
      clearTimeout(analyzeStatusClearTimeout);
      analyzeStatusClearTimeout = null;
    }
    el.textContent = message || '';
    el.hidden = !message;
    el.className = 'drawer-hint drawer-global-status' + (kind === 'error' ? ' drawer-status-error' : '');
    if (kind === 'error' && message) {
      analyzeStatusClearTimeout = setTimeout(() => {
        analyzeStatusClearTimeout = null;
        el.textContent = '';
        el.hidden = true;
        el.className = 'drawer-hint drawer-global-status';
      }, API_FEEDBACK_DISMISS_MS);
    }
  }

  function setApplicationDetailSaveStatus(kind, message) {
    const el = document.getElementById('application-detail-save-status');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
    el.classList.remove('is-error', 'is-success');
    if (kind === 'error') el.classList.add('is-error');
    if (kind === 'success') el.classList.add('is-success');
  }

  function setDrawerFeedback(kind, message) {
    setAnalyzeStatus(kind === 'success' ? '' : kind, message);
    if (isApplicationDetailActive()) {
      setApplicationDetailSaveStatus(kind, message);
    }
  }

  async function submitOpeningFromPage(url, html, personaId) {
    const startedAt = Date.now();
    rememberAnalyzingOpening({ url, title: 'Analyzing job posting…', company: '', startedAt });
    renderOpenings(lastOpeningsPayload || { loggedIn: true, data: { openings: [], limits: {} } });
    try {
      const data = await window.ApplicaAPI.appFetchJson('/api/openings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, persona_id: personaId, html })
      });
      if (data.opening) {
        rememberAnalyzingOpening({ ...data.opening, url: data.opening.url || url, startedAt });
      }
      fetchOpenings(personaId);
      const watchId = data.opening?.id ?? null;
      if (watchId) ensureOpeningsPoll(personaId, { openingId: watchId });
      setTimeout(() => setAnalyzeStatus('', ''), 3000);
    } catch (err) {
      showApiErrorBanner();
      forgetAnalyzingOpening(url);
      renderOpenings(lastOpeningsPayload || { loggedIn: true, data: { openings: [], limits: {} } });
      setAnalyzeStatus('error', err?.message || 'Request failed');
    }
  }

  const personaPicker = document.getElementById('applica-persona-picker');
  if (personaPicker) {
    personaPicker.addEventListener('change', () => {
      stopOpeningsPoll();
      clearAnalyzingOpenings();
      stopSetupEmailsPoll();
      lastOpeningsSnapshot = null;
      const id = personaPicker.value;
      saveSelectedPersonaId(id || null);
      const persona = id ? lastPersonas.find((p) => String(p.id) === id) : null;
      updateProfileCard(persona || null);
      if (id) {
        fetchOpenings(id);
        fetchApplications(id);
        if (setupEmailsEnabled()) {
          resetSetupEmailsSectionCollapsed();
          updateSetupEmailsBadgeDisplay(0);
          fetchSetupEmails(id);
          startSetupEmailsPoll(id);
        }
      } else {
        renderSetupEmails({ loggedIn: false });
      }
    });
  }

  function openUrlInNewTab(url) {
    openJobPostingUrl(url, { sameTab: false });
  }

  /**
   * Open a job URL and keep drawer context (application detail, etc.) across navigation.
   * Same-tab: navigates the host page and reopens the drawer there (default from application detail).
   * New tab: opens a tab with drawer auto-open; persisted view state restores application detail.
   */
  function openJobPostingUrl(url, options = {}) {
    if (!url) return;
    const sameTab = options.sameTab === true;
    saveApplicationsViewState();
    if (window.parent !== window) {
      postToContent({ type: sameTab ? 'applica-navigate-to' : 'applica-open-tab', url });
    } else if (sameTab) {
      window.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function handleCancelInProgressQueueItem(url) {
    if (!url) return;
    forgetAnalyzingOpening(url);
    maybeStopOpeningsPollAfterFetch();
    renderOpenings(lastOpeningsPayload || { loggedIn: true, data: { openings: [], limits: {} } });
    syncAnalyzeJobButtonState();
  }

  async function handleDeleteQueueItem(openingId, options = {}) {
    const personaId = personaPicker?.value;
    if (!personaId) return;
    if (!options.skipConfirm) {
      const confirmed = window.confirm('Remove this job from your processing queue?');
      if (!confirmed) return;
    }
    try {
      await window.ApplicaAPI.appFetchJson(`/api/openings/${openingId}`, { method: 'DELETE' });
      const removed = (lastOpeningsPayload?.data?.openings || []).find(
        (o) => o != null && String(o.id) === String(openingId)
      );
      if (removed?.url) forgetAnalyzingOpening(removed.url);
      pollingWatchOpeningIds.delete(String(openingId));
      if (selectedOpening?.id != null && String(selectedOpening.id) === String(openingId)) {
        showOpeningsList();
      }
      maybeStopOpeningsPollAfterFetch();
      fetchOpenings(personaId);
      syncAnalyzeJobButtonState();
    } catch (err) {
      showApiErrorBanner();
      setAnalyzeStatus('error', err?.message || 'Could not remove.');
    }
  }

  async function handleBulkDeleteBelowScore(threshold) {
    const personaId = personaPicker?.value;
    if (!personaId) return;
    const confirmed = window.confirm(
      'Delete all jobs with a match score below ' + threshold + '? This cannot be undone.'
    );
    if (!confirmed) return;
    try {
      const data = await window.ApplicaAPI.appFetchJson(
        '/api/openings/bulk?persona_id=' +
          encodeURIComponent(personaId) +
          '&score=' +
          encodeURIComponent(String(threshold)),
        { method: 'DELETE' }
      );
      if (selectedOpening) showOpeningsList();
      setAnalyzeStatus('', data.message || 'Deleted.');
      fetchOpenings(personaId);
      setTimeout(() => setAnalyzeStatus('', ''), 4000);
    } catch (err) {
      showApiErrorBanner();
      setAnalyzeStatus('error', err?.message || 'Could not delete openings.');
    }
  }

  function closeBulkDeleteMenu() {
    const menu = document.getElementById('openings-bulk-delete-menu');
    const toggle = document.getElementById('openings-bulk-delete-toggle');
    const chevron = document.getElementById('openings-bulk-delete-chevron');
    if (menu) menu.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    if (chevron) chevron.innerHTML = '<path d="m6 9 6 6 6-6"></path>';
  }

  function openBulkDeleteMenu() {
    const menu = document.getElementById('openings-bulk-delete-menu');
    const toggle = document.getElementById('openings-bulk-delete-toggle');
    const chevron = document.getElementById('openings-bulk-delete-chevron');
    if (menu) menu.hidden = false;
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    if (chevron) chevron.innerHTML = '<path d="m18 15-6-6-6 6"></path>';
  }

  const bulkDeleteToggle = document.getElementById('openings-bulk-delete-toggle');
  const bulkDeleteMenu = document.getElementById('openings-bulk-delete-menu');
  const bulkDeleteWrap = document.querySelector('.drawer-bulk-delete-wrap');

  if (bulkDeleteMenu) {
    bulkDeleteMenu.querySelectorAll('[data-bulk-delete-score]').forEach((btn) => {
      const score = Number(btn.getAttribute('data-bulk-delete-score'));
      btn.style.cssText = scoreBadgeStyle(score);
    });
  }

  if (bulkDeleteToggle && bulkDeleteMenu) {
    bulkDeleteToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (bulkDeleteMenu.hidden) openBulkDeleteMenu();
      else closeBulkDeleteMenu();
    });

    bulkDeleteMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bulk-delete-score]');
      if (!btn) return;
      e.stopPropagation();
      closeBulkDeleteMenu();
      const threshold = btn.getAttribute('data-bulk-delete-score');
      if (threshold) handleBulkDeleteBelowScore(threshold);
    });
  }

  document.addEventListener('click', (e) => {
    if (bulkDeleteWrap && !bulkDeleteWrap.contains(e.target)) closeBulkDeleteMenu();
  });

  function showOpeningDetail(opening) {
    const previousOpeningId = selectedOpening?.id ?? null;
    selectedOpening = opening;
    applicationsViewMemory = { view: 'list', applicationId: null };
    saveDrawerViewState('detail', opening.id ?? null);
    applyDrawerLayout();

    const avoidWarningEl = document.getElementById('opening-detail-company-avoid-warning');
    if (avoidWarningEl) avoidWarningEl.hidden = !opening.company_avoid_warning;

    const interviewWarningEl = document.getElementById('opening-detail-interview-warning');
    if (interviewWarningEl) interviewWarningEl.hidden = !opening.interview_in_progress_warning;

    const matchingAppsEl = document.getElementById('opening-detail-matching-apps');
    const matchingAppsTitleEl = matchingAppsEl?.querySelector('.drawer-detail-matching-apps-title');
    const matchingAppsListEl = matchingAppsEl?.querySelector('.drawer-detail-matching-apps-list');
    const apps = opening.matching_applications;
    if (matchingAppsEl && Array.isArray(apps) && apps.length > 0) {
      matchingAppsEl.hidden = false;
      if (matchingAppsTitleEl) {
        matchingAppsTitleEl.textContent = isRecruiter
          ? 'Existing applications at this company (any profile):'
          : 'You have applied at this company:';
      }
      if (matchingAppsListEl) {
        matchingAppsListEl.innerHTML = apps
          .map((a) => {
            const company = escapeHtml(a.company || '');
            const title = escapeHtml(a.title || '');
            const appliedAt = a.applied_at ? escapeHtml(String(a.applied_at).slice(0, 10)) : '';
            const personaName = a.persona_name ? escapeHtml(a.persona_name) : '';
            const statusLabel = a.status ? escapeHtml(applicationStatusLabel(a.status)) : '';
            const itemClass =
              'drawer-detail-matching-apps-item' +
              (a.interviewing ? ' drawer-detail-matching-apps-item--interview' : '');
            const personaPart = personaName
              ? '<span class="drawer-detail-matching-apps-persona">' + personaName + '</span> · '
              : '';
            const statusPart = statusLabel
              ? ' <span class="drawer-detail-matching-apps-status' +
                (a.interviewing ? ' drawer-detail-matching-apps-status--interview' : '') +
                '">' +
                statusLabel +
                '</span>'
              : '';
            return (
              '<li class="' +
              itemClass +
              '">' +
              personaPart +
              (company ? '<span class="drawer-detail-matching-apps-company">' + company + '</span>' : '') +
              (title ? ' – ' + title : '') +
              statusPart +
              (appliedAt ? ' <span class="drawer-detail-matching-apps-date">(' + appliedAt + ')</span>' : '') +
              '</li>'
            );
          })
          .join('');
      }
    } else if (matchingAppsEl) {
      matchingAppsEl.hidden = true;
    }

    document.getElementById('opening-detail-company').textContent = opening.company || '—';
    document.getElementById('opening-detail-position').textContent = opening.title || '—';
    const resumeEl = document.getElementById('opening-detail-resume');
    if (opening.cv_filename) {
      if (opening.cv_url) {
        resumeEl.innerHTML =
          'Resume: <a href="' + escapeHtml(opening.cv_url) + '" class="drawer-opening-detail-resume-link" download target="_blank" rel="noopener">' + escapeHtml(opening.cv_filename) + '</a>';
      } else {
        resumeEl.textContent = 'Resume: ' + opening.cv_filename;
      }
      resumeEl.hidden = false;
    } else {
      resumeEl.textContent = '';
      resumeEl.hidden = true;
    }
    const coverLetterEl = document.getElementById('opening-detail-cover-letter');
    if (coverLetterEl) {
      if (opening.cover_letter_filename) {
        if (opening.cover_letter_url) {
          coverLetterEl.innerHTML =
            'Cover letter: <a href="' +
            escapeHtml(opening.cover_letter_url) +
            '" class="drawer-opening-detail-resume-link" download target="_blank" rel="noopener">' +
            escapeHtml(opening.cover_letter_filename) +
            '</a>';
        } else {
          coverLetterEl.textContent = 'Cover letter: ' + opening.cover_letter_filename;
        }
        coverLetterEl.hidden = false;
      } else {
        coverLetterEl.textContent = '';
        coverLetterEl.hidden = true;
      }
    }
    let mainScore = null;
    if (opening.current_match_score != null && opening.current_match_score !== '') {
      const n = Number(opening.current_match_score);
      mainScore = n > 10 ? Math.round(n) : Math.round(n * 10);
    } else {
      mainScore = getScoreFromAnalysis(opening.resume_analysis, 'match_score');
    }
    const scoreWrap = document.getElementById('opening-detail-score-wrap');
    if (scoreWrap) {
      if (mainScore != null && mainScore > 0) {
        scoreWrap.hidden = false;
        const scoreValueEl = document.getElementById('opening-detail-score-value');
        const scoreLabelEl = document.getElementById('opening-detail-score-label');
        const color = scoreColor(mainScore);
        if (scoreValueEl) {
          scoreValueEl.textContent = mainScore;
          scoreValueEl.style.color = color;
        }
        applyScoreSentimentBadge(scoreLabelEl, mainScore);
        const analysis = opening.resume_analysis || {};
        const skillScore = getScoreFromAnalysis(analysis, 'skill_match_score');
        const experienceScore = getScoreFromAnalysis(analysis, 'experience_match_score');
        const educationScore = getScoreFromAnalysis(analysis, 'education_match_score');
        setCategoryScore('skill', skillScore);
        setCategoryScore('experience', experienceScore);
        setCategoryScore('education', educationScore);
      } else {
        scoreWrap.hidden = true;
      }
    }
    updateOpeningDetailScoringIndicator(opening);
    const openLink = document.getElementById('opening-detail-open-url');
    openLink.href = opening.url || '#';
    openLink.hidden = !opening.url;
    syncOpeningDetailApplicationActions(opening);
    syncOpeningDetailNetworkingFields(opening, previousOpeningId);
    renderCustomResumeSection(opening);
    applyDrawerLayout();
    if (isRecruiter) {
      loadOpeningApplicantInfo(opening);
    } else {
      clearOpeningApplicantInfo();
    }
    const personaId = document.getElementById('applica-persona-picker')?.value;
    if (personaId) maybeResumeScoringPoll(personaId);
  }

  function showOpeningsList() {
    selectedOpening = null;
    clearOpeningApplicantInfo();
    saveDrawerViewState('list', null);
    applyDrawerLayout();
    const personaId = document.getElementById('applica-persona-picker')?.value;
    if (personaId) {
      fetchApplications(personaId, { silent: true });
      if (setupEmailsEnabled()) fetchSetupEmails(personaId, { silent: true });
    }
  }

  const scoreQueueList = document.getElementById('score-queue-list');
  if (scoreQueueList) {
    scoreQueueList.addEventListener('click', (e) => {
      const queueRemoveBtn = e.target.closest('button.drawer-queue-item-remove');
      if (queueRemoveBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (queueRemoveBtn.getAttribute('data-cancel-queue') === 'true') {
          handleCancelInProgressQueueItem(queueRemoveBtn.getAttribute('data-url'));
        } else {
          const openingId = queueRemoveBtn.getAttribute('data-opening-id');
          if (openingId) handleDeleteQueueItem(openingId);
        }
        return;
      }
      if (e.target.closest('.drawer-queue-item-actions')) return;
      const queueItem = e.target.closest('.drawer-queue-item[data-url]');
      if (queueItem) {
        e.preventDefault();
        openUrlInNewTab(queueItem.getAttribute('data-url'));
      }
    });
  }

  if (scoreQueueSection) {
    scoreQueueSection.addEventListener('click', (e) => {
      const worklistDeleteBtn = e.target.closest('button.drawer-worklist-item-delete');
      if (worklistDeleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        const openingId = worklistDeleteBtn.getAttribute('data-opening-id');
        if (openingId) {
          handleDeleteQueueItem(openingId);
        }
        return;
      }
      const row = e.target.closest('.drawer-worklist-item[data-url]');
      if (row) {
        e.preventDefault();
        e.stopPropagation();
        const openingId = row.getAttribute('data-opening-id');
        const url = row.getAttribute('data-url');
        let opening = null;
        if (openingId) {
          const openings = lastOpeningsPayload?.data?.openings;
          opening = Array.isArray(openings)
            ? openings.find((o) => o != null && String(o.id) === openingId)
            : null;
          if (!opening) {
            const companyEl = row.querySelector('.drawer-worklist-item-company');
            const positionEl = row.querySelector('.drawer-worklist-item-position');
            const resumeEl = row.querySelector('.drawer-worklist-item-resume-name');
            const scoreBadge = row.querySelector('.drawer-worklist-match-badge');
            opening = {
              id: openingId,
              url: url || undefined,
              company: companyEl?.textContent?.trim() || '',
              title: positionEl?.textContent?.trim() || '',
              cv_filename: resumeEl?.textContent?.trim() || undefined,
              current_match_score: scoreBadge?.textContent?.trim()?.replace(/%$/, '') || undefined
            };
          }
        }
        if (opening) {
          showOpeningDetail(opening);
        } else {
          openUrlInNewTab(url);
        }
        return;
      }
      const link = e.target.closest('a.drawer-opening-link');
      if (link?.href) {
        e.preventDefault();
        e.stopPropagation();
        openUrlInNewTab(link.href);
        return;
      }
    });
  }

  const applicationDetailBack = document.getElementById('application-detail-back');
  if (applicationDetailBack) {
    applicationDetailBack.addEventListener('click', () => showApplicationsList());
  }

  const applicationsSection = document.getElementById('applications-section-content');
  const applicationsList = document.getElementById('applications-list');
  const setupEmailsToggle = document.getElementById('setup-emails-section-toggle');
  if (setupEmailsToggle && setupEmailsEnabled()) {
    resetSetupEmailsSectionCollapsed();
    setupEmailsToggle.addEventListener('click', () => {
      setSetupEmailsSectionExpanded(!setupEmailsSectionExpanded);
    });
  }
  bindProfilePreferencesToggle();
  bindProfilePreferencesCopy();
  if (isRecruiter) {
    setProfilePreferencesExpanded(true);
  }

  const setupEmailsList = document.getElementById('setup-emails-list');
  if (setupEmailsList) {
    setupEmailsList.addEventListener('click', (e) => {
      const link = e.target.closest('a.drawer-setup-email-link');
      if (link?.href) {
        e.preventDefault();
        e.stopPropagation();
        openUrlInNewTab(link.href);
        return;
      }
      const summary = e.target.closest('.drawer-setup-email-summary');
      if (!summary) return;
      const item = summary.closest('.drawer-setup-email-item');
      const body = item?.querySelector('.drawer-setup-email-body');
      if (!body) return;
      const expanded = summary.getAttribute('aria-expanded') === 'true';
      summary.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      body.hidden = expanded;
    });
  }
  if (applicationsSection) {
    applicationsSection.addEventListener('click', (e) => {
      if (e.target.closest('#application-detail-view')) return;
      if (applicationListStatusEditable() && e.target.closest('select.drawer-application-row-status')) return;
      const row = e.target.closest('.drawer-application-item[data-application-id]');
      if (!row) return;
      e.preventDefault();
      const applicationId = row.getAttribute('data-application-id');
      const apps = lastApplicationsPayload?.data?.applications || [];
      const app = apps.find((a) => a != null && String(a.id) === applicationId);
      if (app) showApplicationDetail(app);
    });
  }

  if (applicationsList && applicationListStatusEditable()) {
    applicationsList.addEventListener('mousedown', (e) => {
      if (e.target.closest('select.drawer-application-row-status')) {
        e.stopPropagation();
      }
    });
    applicationsList.addEventListener('change', async (e) => {
      const select = e.target.closest('select.drawer-application-row-status');
      if (!select) return;
      const applicationId = select.getAttribute('data-application-id');
      const status = select.value;
      if (!applicationId || !status) return;
      select.disabled = true;
      try {
        const updated = await updateApplication(applicationId, { status });
        patchApplicationInList(applicationId, { status: updated.status });
        if (selectedApplication != null && String(selectedApplication.id) === applicationId) {
          selectedApplication = { ...selectedApplication, status: updated.status };
          if (isApplicationDetailActive()) {
            fillApplicationFields(selectedApplication);
          }
        }
        if (!isApplicationDetailActive()) {
          setDrawerFeedback('success', 'Status updated.');
          setTimeout(() => setDrawerFeedback('', ''), 2500);
        }
      } catch (err) {
        const apps = lastApplicationsPayload?.data?.applications || [];
        const app = apps.find((a) => a != null && String(a.id) === applicationId);
        if (app) select.value = normalizeApplicationStatus(app.status);
        setDrawerFeedback('error', err?.message || 'Could not update status.');
      } finally {
        select.disabled = false;
      }
    });
  }

  initApplicationFormSelects();
  syncApplicationsListSubtitle();
  bindProfileResumeDownload();

  const applicationDetailSave = document.getElementById('application-detail-save');
  if (applicationDetailSave) {
    applicationDetailSave.addEventListener('click', async () => {
      const appId = selectedApplication?.id;
      if (!appId) {
        setDrawerFeedback('error', 'Could not save — open the application again.');
        return;
      }
      const saveLabel = applicationDetailSave.textContent;
      applicationDetailSave.disabled = true;
      setApplicationDetailSaveStatus('', 'Saving…');
      try {
        const fields = readApplicationFields();
        if (!fields.status) {
          throw new Error('Status is required.');
        }
        const updated = await updateApplication(appId, fields);
        selectedApplication = updated;
        upsertApplicationInList(updated);
        fillApplicationFields(updated);
        setApplicationDetailSaveStatus('success', 'Application saved.');
        setTimeout(() => setApplicationDetailSaveStatus('', ''), 3000);
      } catch (err) {
        setApplicationDetailSaveStatus('error', err?.message || 'Could not save application.');
      } finally {
        applicationDetailSave.disabled = false;
        applicationDetailSave.textContent = saveLabel;
      }
    });
  }

  const applicationDetailOpenLink = document.getElementById('application-detail-open-link');
  if (applicationDetailOpenLink) {
    applicationDetailOpenLink.addEventListener('click', (e) => {
      e.preventDefault();
      const href = applicationDetailOpenLink.getAttribute('href');
      if (!href || href === '#') return;
      const sameTab = !(e.metaKey || e.ctrlKey || e.shiftKey);
      openJobPostingUrl(href, { sameTab });
    });
  }

  const openingDetailBack = document.getElementById('opening-detail-back');
  if (openingDetailBack) {
    openingDetailBack.addEventListener('click', () => showOpeningsList());
  }

  /** Fetch form data for an opening and ask the host page to fill its form. Returns true if sent. */
  async function requestFormFill(openingId) {
    if (!openingId || window.parent === window) return false;
    try {
      const data = await window.ApplicaAPI.appFetchJson(
        '/api/openings/' + encodeURIComponent(openingId) + '/form_details'
      );
      const formData = data.form_data;
      if (!formData || typeof formData !== 'object') {
        showApiErrorBanner();
        setAnalyzeStatus('error', 'Invalid response: form_data missing.');
        return false;
      }
      postToContent({ type: 'applica-fill-form-with-data', form_data: formData });
      return true;
    } catch (err) {
      showApiErrorBanner();
      setAnalyzeStatus('error', err?.message || 'Request failed.');
      return false;
    }
  }

  const openingDetailFillForm = document.getElementById('opening-detail-fill-form');
  if (openingDetailFillForm) {
    openingDetailFillForm.addEventListener('click', async () => {
      if (!selectedOpening?.id || window.parent === window) return;
      setAnalyzeStatus('', 'Filling form…');
      await requestFormFill(selectedOpening.id);
    });
  }

  const openingDetailOpenUrl = document.getElementById('opening-detail-open-url');
  if (openingDetailOpenUrl) {
    openingDetailOpenUrl.addEventListener('click', (e) => {
      e.preventDefault();
      if (selectedOpening?.url) openUrlInNewTab(selectedOpening.url);
    });
  }

  /** POST /api/applications for an opening. Throws on failure. */
  async function createApplicationForOpening(openingId, networking = {}) {
    const payload = { opening_id: String(openingId) };
    if (networking.contact_name) payload.contact_name = networking.contact_name;
    if (networking.contact_email) payload.contact_email = networking.contact_email;
    if (networking.contact_url) payload.contact_url = networking.contact_url;
    return window.ApplicaAPI.appFetchJson('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  const openingDetailRemove = document.getElementById('opening-detail-remove');
  if (openingDetailRemove) {
    openingDetailRemove.addEventListener('click', async () => {
      if (!selectedOpening?.id) return;
      setAnalyzeStatus('', 'Recording application…');
      try {
        const networking = readOpeningNetworkingFields();
        const data = await createApplicationForOpening(selectedOpening.id, networking);
        resetOpeningNetworkingFields();
        const personaId = personaPicker?.value;
        selectedApplication = data.application || null;
        selectedOpening = {
          ...selectedOpening,
          has_application: true,
          linked_application: data.application || null
        };
        upsertApplicationInList(data.application);
        syncOpeningDetailApplicationActions(selectedOpening);
        renderCustomResumeSection(selectedOpening);
        if (isRecruiter) loadOpeningApplicantInfo(selectedOpening);
        if (personaId) {
          await fetchApplications(personaId, { silent: true });
          await fetchOpenings(personaId, { silent: true });
        }
        setAnalyzeStatus('', 'Application recorded.');
        setTimeout(() => setAnalyzeStatus('', ''), 3000);
      } catch (err) {
        showApiErrorBanner();
        setAnalyzeStatus('error', err?.message || 'Request failed.');
      }
    });
  }

  const openingDetailResumeUpload = document.getElementById('opening-detail-resume-upload');
  const openingDetailUploadResumeBtn = document.getElementById('opening-detail-upload-resume');
  if (openingDetailUploadResumeBtn && openingDetailResumeUpload) {
    openingDetailUploadResumeBtn.addEventListener('click', () => {
      openingDetailResumeUpload.click();
    });
    openingDetailResumeUpload.addEventListener('change', () => {
      const file = openingDetailResumeUpload.files?.[0];
      if (!file) return;
      submitCustomResumeUpload(file);
    });
  }

  /** Ask the host page for its HTML; handlePageDataForAnalyze submits it as a new opening. */
  function requestAnalyzeCurrentPage() {
    const personaId = personaPicker?.value;
    if (!personaId) {
      setAnalyzeStatus('error', 'Select a profile first.');
      return;
    }
    if (analyzeBtn) analyzeBtn.disabled = true;
    setAnalyzeStatus('', '');
    if (window.parent !== window) {
      const requestId = String(++analyzeRequestSeq);
      const timeoutId = setTimeout(() => {
        if (!pendingAnalyzeByRequestId.has(requestId)) return;
        cancelPendingAnalyze(requestId);
        setAnalyzeStatus(
          'error',
          'Could not read this page. Try reloading and opening the drawer again.'
        );
      }, ANALYZE_PAGE_DATA_TIMEOUT_MS);
      pendingAnalyzeByRequestId.set(requestId, { personaId, timeoutId });
      scheduleTabbedRender();
      postToContent({ type: 'applica-analyze-current-page', requestId });
    } else {
      cancelPendingAnalyze();
      setAnalyzeStatus('error', 'Open the drawer on a job page to analyze it.');
    }
  }

  const analyzeBtn = document.getElementById('analyze-job-posting-btn');
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', requestAnalyzeCurrentPage);
  }

  function isContextInvalidated(e) {
    return String(e?.message ?? e).includes('Extension context invalidated');
  }

  if (openLoginTabBtn) {
    openLoginTabBtn.addEventListener('click', async () => {
      try {
        if (typeof chrome === 'undefined' || !chrome?.runtime?.getURL) {
          alert('Extension context unavailable. Open the drawer from the extension icon on a page.');
          return;
        }
        const origin = await ApplicaAPI.getAppOrigin();
        const base = origin.replace(/\/$/, '');
        const redirectUri = encodeURIComponent(chrome.runtime.getURL('auth.html'));
        const loginUrl = `${base}/user/log_in?redirect_extension=1&redirect_uri=${redirectUri}`;
        chrome.tabs.create({ url: loginUrl });
      } catch (e) {
        if (isContextInvalidated(e)) {
          alert('Extension was reloaded. Please close the drawer and open it again.');
        } else {
          throw e;
        }
      }
    });
  }

  if (recruiterLoginForm) {
    recruiterLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const parsed = parseRecruiterLoginUrl(recruiterLoginUrlInput?.value);
      if (!parsed.ok) {
        if (loginErrorEl) {
          loginErrorEl.textContent = parsed.message || 'Invalid login URL';
          loginErrorEl.hidden = false;
        }
        return;
      }
      if (loginErrorEl) loginErrorEl.hidden = true;
      if (recruiterLoginBtn) recruiterLoginBtn.disabled = true;
      try {
        const result = await window.ApplicaAPI.login(parsed.id, parsed.key);
        if (!result.ok) {
          if (loginErrorEl) {
            loginErrorEl.textContent = result.message || 'Login failed';
            loginErrorEl.hidden = false;
          }
          return;
        }
        if (recruiterLoginUrlInput) recruiterLoginUrlInput.value = '';
        await refreshAuthState();
      } finally {
        if (recruiterLoginBtn) recruiterLoginBtn.disabled = false;
      }
    });
  }

  signOutBtn.addEventListener('click', async () => {
    try {
      await window.ApplicaAPI.clearAuthToken();
      refreshAuthState();
    } catch (e) {
      if (isContextInvalidated(e)) {
        alert('Extension was reloaded. Please close the drawer and open it again.');
      } else {
        throw e;
      }
    }
  });

  closeDrawerBtn.addEventListener('click', () => {
    postToContent({ type: 'applica-drawer-close' });
  });

  const authStorageChanged = (changes, areaName) => {
    if (areaName !== 'local') return;
    const keys = window.ApplicaAPI?.STORAGE_KEYS;
    if (!keys) return;
    const authChanged =
      changes[keys.AUTH_TOKEN] ||
      changes[keys.USER] ||
      changes[keys.ACTOR];
    if (authChanged) refreshAuthState();
  };

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      try {
        authStorageChanged(changes, areaName);
      } catch (_) {
        // Extension context invalidated (e.g. extension reloaded)
      }
    });
  } catch (_) {
    // Extension context invalidated
  }

  /* ==========================================================================
   * Seeker tabbed layout (features.tabbedLayout)
   *
   * Analyze tab: the profile, the job in this tab, and its match / fill / applied state.
   * History tab: openings (not applied) and applications (applied) in one list.
   * Reuses the worklist data, polling and API helpers above. Markup: tabbed-views.js.
   * ======================================================================== */

  const TabbedViews = window.ApplicaTabbedViews;
  const tbEl = (id) => document.getElementById(id);
  const TABBED_SLOW_SCORING_MS = 3 * 60 * 1000;
  const TABBED_INCOMPLETE_NO_META_MS = 5 * 60 * 1000;
  const TABBED_INCOMPLETE_MS = 30 * 60 * 1000;
  const TABBED_FILL_TIMEOUT_MS = 15000;
  const TABBED_MENUS = [
    ['tb-settings-toggle', 'tb-settings-menu'],
    ['tb-sort-toggle', 'tb-sort-menu'],
    ['tb-more-toggle', 'tb-more-menu']
  ];

  function scheduleTabbedRender() {
    if (!tabbedLayout || tabbedRenderQueued) return;
    tabbedRenderQueued = true;
    queueMicrotask(() => {
      tabbedRenderQueued = false;
      renderTabbed();
    });
  }

  function applyTabbedLayout() {
    [
      'drawer-list-only-block',
      'openings-section-content',
      'applications-section-content',
      'score-queue-section-content',
      'setup-emails-section-content'
    ].forEach((id) => setVisible(tbEl(id), false));
    const isHistory = tabbedTab === 'history';
    const appDetail = isApplicationDetailActive();
    setVisible(tbEl('tb-panel-analyze'), !isHistory);
    setVisible(tbEl('tb-panel-history'), isHistory);
    setVisible(tbEl('tb-history-list-view'), !appDetail && !tabbedHistoryDetailKey);
    setVisible(tbEl('tb-history-detail'), !appDetail && !!tabbedHistoryDetailKey);
    setVisible(tbEl('application-detail-view'), appDetail);
  }

  function setTabbedTab(tab) {
    tabbedTab = tab === 'history' ? 'history' : 'analyze';
    tabbedSwitcherOpen = false;
    closeTabbedMenus();
    ['analyze', 'history'].forEach((name) => {
      const btn = tbEl('tb-tab-' + name);
      if (!btn) return;
      const selected = name === tabbedTab;
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      btn.tabIndex = selected ? 0 : -1;
    });
    applyDrawerLayout();
  }

  function currentPersona() {
    const id = personaPicker?.value;
    if (!id) return null;
    return lastPersonas.find((p) => String(p.id) === String(id)) || null;
  }

  function personaTitle(persona) {
    return (persona?.title || '').trim() || (persona?.name || '').trim() || 'Profile';
  }

  function personaResumeScore(persona) {
    if (!persona || persona.match_score == null || persona.match_score === '') return null;
    const n = Math.round(Number(persona.match_score));
    return Number.isNaN(n) ? null : n;
  }

  function hostOf(url) {
    if (!url) return '';
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  }

  function openingStartedAt(opening) {
    if (!opening) return null;
    if (opening.startedAt) return opening.startedAt;
    const t = opening.inserted_at ? Date.parse(opening.inserted_at) : NaN;
    return Number.isNaN(t) ? null : t;
  }

  /** 'scored' | 'scoring' | 'incomplete' for an opening (or in-flight placeholder). */
  function tabbedOpeningState(opening) {
    if (openingHasScore(opening)) return 'scored';
    const since = openingStartedAt(opening);
    const age = since ? Date.now() - since : 0;
    if (age > TABBED_INCOMPLETE_MS) return 'incomplete';
    if (!openingHasTitleAndCompany(opening) && age > TABBED_INCOMPLETE_NO_META_MS) return 'incomplete';
    return 'scoring';
  }

  function openingScoreDetail(opening) {
    if (!opening) return null;
    let total = null;
    if (opening.current_match_score != null && opening.current_match_score !== '') {
      const n = Number(opening.current_match_score);
      if (n > 0) total = n > 10 ? Math.round(n) : Math.round(n * 10);
    }
    if (total == null) total = getScoreFromAnalysis(opening.resume_analysis, 'match_score');
    if (total == null) return null;
    const analysis = opening.resume_analysis || {};
    const persona = currentPersona();
    return {
      total,
      label: scoreLabel(total),
      skill: getScoreFromAnalysis(analysis, 'skill_match_score'),
      exp: getScoreFromAnalysis(analysis, 'experience_match_score'),
      edu: getScoreFromAnalysis(analysis, 'education_match_score'),
      against: persona ? personaTitle(persona) : null
    };
  }

  function openingWarnings(opening) {
    const matching = (Array.isArray(opening?.matching_applications) ? opening.matching_applications : [])
      .filter(Boolean)
      .map((a) => ({
        title: a.title,
        statusLabel: a.status ? applicationStatusLabel(a.status) : '',
        appliedAt: formatAppliedDate(a.applied_at)
      }));
    return {
      avoid: !!opening?.company_avoid_warning,
      interview: !!opening?.interview_in_progress_warning,
      matching
    };
  }

  function currentPageOpening() {
    if (!currentPageUrl) return null;
    const openings = lastOpeningsPayload?.data?.openings || [];
    return (
      openings.find((o) => o != null && openingMatchesCurrentPage(o)) ||
      getAnalyzingOpeningByUrl(currentPageUrl) ||
      null
    );
  }

  function currentPageApplication(opening) {
    const apps = lastApplicationsPayload?.data?.applications || [];
    if (opening?.id != null) {
      const byOpening = apps.find(
        (a) => a?.opening_id != null && String(a.opening_id) === String(opening.id)
      );
      if (byOpening) return byOpening;
    }
    const byLink = apps.find((a) => a != null && applicationMatchesCurrentPage(a));
    if (byLink) return byLink;
    if (opening?.linked_application?.id != null) {
      return {
        ...opening.linked_application,
        company: opening.company,
        title: opening.title,
        link: opening.url,
        opening_id: opening.id
      };
    }
    return null;
  }

  function findApplicationById(applicationId) {
    const apps = lastApplicationsPayload?.data?.applications || [];
    const listed = apps.find((a) => a != null && String(a.id) === String(applicationId));
    if (listed) return listed;
    const opening = currentPageOpening();
    const fromOpening = currentPageApplication(opening);
    return fromOpening && String(fromOpening.id) === String(applicationId) ? fromOpening : null;
  }

  function buildTabbedAnalyzeContext() {
    const persona = currentPersona();
    const profile = {
      loading: !tabbedPersonasState.loaded,
      error: tabbedPersonasState.error,
      title: persona ? personaTitle(persona) : null,
      cvFilename: persona?.cv_filename || null,
      downloadPath: persona?.resume_download_path || null,
      resumeScore: personaResumeScore(persona),
      personas: lastPersonas.map((p) => ({
        id: String(p.id),
        title: personaTitle(p),
        cvFilename: p.cv_filename || null,
        score: personaResumeScore(p),
        selected: persona != null && String(p.id) === String(persona.id)
      })),
      switcherOpen: tabbedSwitcherOpen && lastPersonas.length > 1,
      manageHref: tabbedLinks.profiles
    };

    const page = {
      inFrame: window.parent !== window && !!currentPageUrl,
      host: hostOf(currentPageUrl),
      detected: !!currentPageJob?.found,
      title: currentPageJob?.title || currentPageJob?.pageTitle || null,
      company: currentPageJob?.company || null
    };

    const opening = currentPageOpening();
    const application = currentPageApplication(opening);
    let job = { state: 'ready' };
    if (opening || application) {
      const state = application ? 'applied' : tabbedOpeningState(opening);
      const openingId = opening?.id != null ? String(opening.id) : null;
      const since = openingStartedAt(opening);
      const appliedAt = application ? formatAppliedDate(application.applied_at) : '';
      job = {
        state,
        title: opening?.title || application?.title || page.title,
        company: opening?.company || application?.company || page.company,
        url: opening?.url || application?.link || currentPageUrl,
        openingId,
        scoringSince: state === 'scoring' ? since : null,
        slow: state === 'scoring' && since != null && Date.now() - since > TABBED_SLOW_SCORING_MS,
        score: openingScoreDetail(opening),
        cvFilename: opening?.cv_filename || persona?.cv_filename || null,
        // Once applied, "you've applied here before" would just list this job.
        warnings: opening
          ? application
            ? { avoid: !!opening.company_avoid_warning, interview: false, matching: [] }
            : openingWarnings(opening)
          : null,
        canFill: !!openingId && !application,
        fill: tabbedFill && openingId && tabbedFill.openingId === openingId ? tabbedFill : null,
        applying: openingId != null && tabbedApplyingOpeningId === openingId,
        application: application
          ? {
              id: String(application.id),
              statusLabel: applicationStatusLabel(normalizeApplicationStatus(application.status)),
              appliedAt
            }
          : null,
        customResume:
          opening && openingId && state === 'scored' && !application
            ? {
                canCustomize: lastOpeningsPayload?.data?.entitlements?.custom_resume_scoring === true,
                upgradeHref: tabbedLinks.upgrade,
                busy: tabbedCustomResumeBusy
              }
            : null
      };
    }

    const limits = lastOpeningsPayload?.data?.limits;
    const atLimit = limits != null && typeof limits.remaining === 'number' && limits.remaining === 0;
    const unlimited = limits === 'unlimited' || limits?.unlimited === true;
    const busy = pendingAnalyzeByRequestId.size > 0;
    const analyze = {
      busy,
      disabled: busy || atLimit || !persona,
      disabledReason: !persona
        ? 'Create a profile first.'
        : atLimit
          ? 'You’ve used all your job analyses for now.'
          : '',
      usageHtml: limits && !unlimited ? usageBadgeHtml(limits) : '',
      atLimit,
      upgradeHref: tabbedLinks.upgrade
    };

    return { profile, page, job, analyze, keys: tabbedShortcutLabels };
  }

  function tabbedOpeningRow(opening, persona) {
    const state = tabbedOpeningState(opening);
    const score = state === 'scored' ? openingScoreDetail(opening) : null;
    const since = openingStartedAt(opening);
    return {
      key: opening.id != null ? 'o:' + opening.id : 'p:' + normalizeUrlForCompare(opening.url),
      kind: 'opening',
      openingId: opening.id != null ? String(opening.id) : null,
      url: opening.url || null,
      host: hostOf(opening.url),
      title: opening.title || hostOf(opening.url),
      company: opening.company || '',
      when: since ? formatRelativeTime(new Date(since).toISOString()) : '',
      time: since || Date.now(),
      state,
      score: score?.total ?? null,
      scoreLabel: score?.label ?? null,
      scoreDetail: score,
      warnings: openingWarnings(opening),
      cvFilename: opening.cv_filename || persona?.cv_filename || null,
      isCurrentPage: openingMatchesCurrentPage(opening)
    };
  }

  /** Applications first-class; openings that already have an application are folded into them. */
  function buildTabbedHistoryRows() {
    const persona = currentPersona();
    const openings = (lastOpeningsPayload?.data?.openings || []).filter(Boolean);
    const apps = (lastApplicationsPayload?.data?.applications || []).filter(Boolean);
    const openingById = new Map(openings.map((o) => [String(o.id), o]));
    const appliedOpeningIds = new Set(
      apps.filter((a) => a.opening_id != null).map((a) => String(a.opening_id))
    );
    const rows = [];
    for (const app of apps) {
      const opening = app.opening_id != null ? openingById.get(String(app.opening_id)) : null;
      const score = openingScoreDetail(opening);
      const status = normalizeApplicationStatus(app.status);
      const dateIso = app.applied_at || app.inserted_at;
      const time = dateIso ? Date.parse(dateIso) : NaN;
      rows.push({
        key: 'a:' + app.id,
        kind: 'application',
        applicationId: String(app.id),
        url: app.link || null,
        host: hostOf(app.link),
        title: app.title || hostOf(app.link),
        company: app.company || '',
        when: formatRelativeTime(dateIso),
        time: Number.isNaN(time) ? 0 : time,
        state: 'scored',
        status,
        statusLabel: applicationStatusLabel(status),
        score: score?.total ?? null,
        scoreLabel: score?.label ?? null,
        cvFilename: opening?.cv_filename || persona?.cv_filename || null,
        isCurrentPage: applicationMatchesCurrentPage(app)
      });
    }
    for (const opening of openings) {
      if (opening.has_application || appliedOpeningIds.has(String(opening.id))) continue;
      rows.push(tabbedOpeningRow(opening, persona));
    }
    for (const placeholder of analyzingOpeningEntries()) {
      if (openingListedInProcessing(openings, placeholder)) continue;
      if (placeholder.id != null && appliedOpeningIds.has(String(placeholder.id))) continue;
      rows.push(tabbedOpeningRow(placeholder, persona));
    }
    return rows;
  }

  function filterTabbedHistoryRows(rows) {
    let out = rows;
    if (tabbedHistoryFilter === 'applied') out = out.filter((r) => r.kind === 'application');
    else if (tabbedHistoryFilter === 'open') out = out.filter((r) => r.kind === 'opening');
    const q = tabbedHistoryQuery.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        [r.title, r.company, r.host, r.cvFilename, r.kind === 'application' ? r.statusLabel : 'not applied']
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }
    const byTime = (a, b) => b.time - a.time;
    const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1) || byTime(a, b);
    return [...out].sort(tabbedHistorySort === 'score' ? byScore : byTime);
  }

  function setInnerHtmlIfChanged(el, cacheKey, html) {
    if (!el || tabbedLastHtml[cacheKey] === html) return;
    el.innerHTML = html;
    tabbedLastHtml[cacheKey] = html;
  }

  function renderTabbed() {
    if (!tabbedLayout || !TabbedViews) return;
    setInnerHtmlIfChanged(
      tbEl('tb-panel-analyze'),
      'analyze',
      TabbedViews.analyzePanelHtml(buildTabbedAnalyzeContext())
    );

    const rows = buildTabbedHistoryRows();
    const counts = {
      all: rows.length,
      open: rows.filter((r) => r.kind === 'opening').length,
      applied: rows.filter((r) => r.kind === 'application').length
    };
    const countEl = tbEl('tb-history-count');
    if (countEl) countEl.textContent = rows.length ? String(rows.length) : '';
    document.querySelectorAll('[data-tb-count]').forEach((el) => {
      el.textContent = String(counts[el.getAttribute('data-tb-count')] ?? 0);
    });
    document.querySelectorAll('[data-tb-filter]').forEach((el) => {
      el.setAttribute('aria-pressed', el.getAttribute('data-tb-filter') === tabbedHistoryFilter ? 'true' : 'false');
    });
    document.querySelectorAll('[data-tb-sort]').forEach((el) => {
      el.setAttribute('aria-checked', el.getAttribute('data-tb-sort') === tabbedHistorySort ? 'true' : 'false');
    });
    const sortToggle = tbEl('tb-sort-toggle');
    if (sortToggle) {
      sortToggle.title = tabbedHistorySort === 'score' ? 'Sorted by best match' : 'Sorted by newest';
    }

    let listHtml = TabbedViews.historyListHtml(filterTabbedHistoryRows(rows), {
      confirmKey: tabbedConfirmKey,
      query: tabbedHistoryQuery.trim(),
      filter: tabbedHistoryFilter
    });
    if (tabbedOpeningsError) {
      listHtml = '<div class="tb-empty tb-empty--error">' + escapeHtml(tabbedOpeningsError) + '</div>' + listHtml;
    }
    setInnerHtmlIfChanged(tbEl('tb-history-list'), 'history', listHtml);

    if (tabbedHistoryDetailKey) {
      const row = rows.find((r) => r.key === tabbedHistoryDetailKey && r.kind === 'opening');
      if (!row) {
        tabbedHistoryDetailKey = null;
        applyTabbedLayout();
      } else {
        setInnerHtmlIfChanged(
          tbEl('tb-history-detail'),
          'detail',
          TabbedViews.historyOpeningDetailHtml(row, {
            confirmKey: tabbedConfirmKey,
            fillKey: tabbedShortcutLabels.fill,
            applying: row.openingId != null && tabbedApplyingOpeningId === row.openingId
          })
        );
      }
    }
    syncTabbedChrome();
  }

  /** Settings menu links, footer labels: everything outside the two panels. */
  function syncTabbedChrome() {
    const persona = currentPersona();
    const hiringCafe = tbEl('tb-hiring-cafe');
    if (hiringCafe) {
      const url = persona?.hiring_cafe_url;
      const show = typeof url === 'string' && /^https?:\/\//i.test(url) && EXT.features?.hiringCafe !== false;
      hiringCafe.hidden = !show;
      hiringCafe.href = show ? url : '#';
    }
    const profilesLink = tbEl('tb-manage-profiles');
    if (profilesLink && tabbedLinks.profiles) profilesLink.href = tabbedLinks.profiles;
    const dashboardLink = tbEl('tb-dashboard-link');
    if (dashboardLink && tabbedLinks.dashboard) dashboardLink.href = tabbedLinks.dashboard;
    const signedInAs = tbEl('tb-signed-in-as');
    if (signedInAs) {
      const who = signedInEmail?.textContent?.trim();
      signedInAs.textContent = who ? 'Signed in as ' + who : '';
      signedInAs.hidden = !who;
    }
    const shortcutsLink = tbEl('tb-shortcuts-link');
    if (shortcutsLink) {
      const anyBound = !!(tabbedShortcutLabels.analyze || tabbedShortcutLabels.fill);
      shortcutsLink.textContent = anyBound ? 'Keyboard shortcuts' : 'Set up shortcuts';
    }
  }

  function updateTabbedElapsed() {
    const el = tbEl('tb-elapsed');
    if (!el || !TabbedViews) return;
    const since = Number(el.getAttribute('data-since'));
    if (since) el.textContent = TabbedViews.formatElapsed(Date.now() - since);
  }

  /** After a drawer reload mid-score, keep polling the current page's opening until it scores. */
  function maybePollCurrentPageOpening() {
    const personaId = personaPicker?.value;
    if (!personaId || !currentPageUrl) return;
    const openings = lastOpeningsPayload?.data?.openings || [];
    const opening = openings.find((o) => o != null && openingMatchesCurrentPage(o));
    if (!opening || opening.id == null || openingHasScore(opening) || opening.has_application) return;
    const id = String(opening.id);
    if (pollingWatchOpeningIds.has(id) || tabbedPolledOpeningIds.has(id)) return;
    if (tabbedOpeningState(opening) === 'incomplete') return;
    tabbedPolledOpeningIds.add(id);
    ensureOpeningsPoll(personaId, { openingId: id, delayMs: 0 });
  }

  async function loadTabbedLinks() {
    if (typeof window.ApplicaAPI?.appUrl !== 'function') return;
    try {
      tabbedLinks.dashboard = await window.ApplicaAPI.appUrl('/dashboard');
      tabbedLinks.profiles = await window.ApplicaAPI.appUrl('/dashboard/profiles');
      tabbedLinks.upgrade = await window.ApplicaAPI.appUrl('/dashboard/settings#billing');
    } catch (_) {}
    scheduleTabbedRender();
  }

  /** Read the user's actual bindings; Chrome drops our suggested keys if they clash. */
  function refreshShortcutLabels() {
    try {
      if (typeof chrome === 'undefined' || !chrome?.commands?.getAll) return;
      chrome.commands.getAll((commands) => {
        if (chrome.runtime?.lastError) return;
        const byName = {};
        for (const c of commands || []) byName[c.name] = c.shortcut || '';
        tabbedShortcutLabels = {
          analyze: byName['analyze-job'] || '',
          fill: byName['fill-form'] || ''
        };
        scheduleTabbedRender();
      });
    } catch (_) {
      // Extension context invalidated
    }
  }

  function openShortcutSettings() {
    try {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    } catch (_) {
      setAnalyzeStatus('error', 'Open chrome://extensions/shortcuts to set Applica shortcuts.');
    }
  }

  function runTabbedCommand(command) {
    if (command !== 'analyze-job' && command !== 'fill-form') return;
    if (isApplicationDetailActive()) showApplicationsList();
    tabbedHistoryDetailKey = null;
    setTabbedTab('analyze');
    tabbedPendingCommand = command;
    flushPendingTabbedCommand();
  }

  /** Shortcut commands wait until the profile and openings have loaded. */
  function flushPendingTabbedCommand() {
    if (!tabbedLayout || !tabbedPendingCommand) return;
    if (!personaPicker?.value || !lastOpeningsPayload || !currentPageUrl) return;
    const command = tabbedPendingCommand;
    tabbedPendingCommand = null;
    const opening = currentPageOpening();
    const application = currentPageApplication(opening);
    if (command === 'analyze-job') {
      // Already analyzed or applied: the Analyze tab is showing it.
      if (opening || application || pendingAnalyzeByRequestId.size > 0) return;
      requestAnalyzeCurrentPage();
      return;
    }
    if (application) {
      setAnalyzeStatus('', 'You’ve already marked this job as applied.');
      setTimeout(() => setAnalyzeStatus('', ''), 3000);
      return;
    }
    if (opening?.id != null) {
      startTabbedFill(String(opening.id));
      return;
    }
    setAnalyzeStatus(
      '',
      'Analyze this job first, then fill the form.' +
        (tabbedShortcutLabels.analyze ? ' Press ' + tabbedShortcutLabels.analyze + ' to analyze.' : '')
    );
    setTimeout(() => setAnalyzeStatus('', ''), 4000);
  }

  async function startTabbedFill(openingId) {
    if (tabbedFill?.pending) return;
    tabbedFill = { openingId, pending: true, result: null };
    scheduleTabbedRender();
    if (tabbedFillTimeoutId) clearTimeout(tabbedFillTimeoutId);
    tabbedFillTimeoutId = setTimeout(() => {
      tabbedFillTimeoutId = null;
      if (!tabbedFill?.pending) return;
      tabbedFill = null;
      setAnalyzeStatus('error', 'The page didn’t respond. Reload it and try again.');
      scheduleTabbedRender();
    }, TABBED_FILL_TIMEOUT_MS);
    const sent = await requestFormFill(openingId);
    if (!sent) {
      tabbedFill = null;
      scheduleTabbedRender();
    }
  }

  async function markOpeningApplied(openingId, options = {}) {
    if (!openingId || tabbedApplyingOpeningId) return;
    tabbedApplyingOpeningId = String(openingId);
    scheduleTabbedRender();
    try {
      const data = await createApplicationForOpening(openingId);
      if (data.application) upsertApplicationInList(data.application);
      const personaId = personaPicker?.value;
      if (personaId) {
        await fetchApplications(personaId, { silent: true });
        await fetchOpenings(personaId, { silent: true });
      }
      if (options.openDetail && data.application) {
        tabbedHistoryDetailKey = null;
        showApplicationDetail(findApplicationById(data.application.id) || data.application);
      } else {
        setAnalyzeStatus('', 'Marked as applied. It’s in History under Applied.');
        setTimeout(() => setAnalyzeStatus('', ''), 3000);
      }
    } catch (err) {
      showApiErrorBanner();
      setAnalyzeStatus('error', err?.message || 'Could not mark as applied.');
    } finally {
      tabbedApplyingOpeningId = null;
      scheduleTabbedRender();
    }
  }

  async function removeTabbedRow(key) {
    tabbedConfirmKey = null;
    const row = buildTabbedHistoryRows().find((r) => r.key === key);
    if (!row || row.kind !== 'opening') {
      scheduleTabbedRender();
      return;
    }
    if (tabbedHistoryDetailKey === key) tabbedHistoryDetailKey = null;
    if (row.openingId) {
      await handleDeleteQueueItem(row.openingId, { skipConfirm: true });
    } else if (row.url) {
      handleCancelInProgressQueueItem(row.url);
    }
    applyDrawerLayout();
  }

  function closeTabbedMenus() {
    for (const [toggleId, menuId] of TABBED_MENUS) {
      const menu = tbEl(menuId);
      const toggle = tbEl(toggleId);
      if (menu) menu.hidden = true;
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }
  }

  function toggleTabbedMenu(toggleId, menuId) {
    const menu = tbEl(menuId);
    const toggle = tbEl(toggleId);
    if (!menu || !toggle) return;
    const opening = menu.hidden;
    closeTabbedMenus();
    if (tabbedSwitcherOpen) {
      tabbedSwitcherOpen = false;
      scheduleTabbedRender();
    }
    menu.hidden = !opening;
    toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) menu.querySelector('.tb-pop-item')?.focus();
  }

  function handleTabbedAction(action, el) {
    switch (action) {
      case 'switcher':
        closeTabbedMenus();
        tabbedSwitcherOpen = !tabbedSwitcherOpen;
        scheduleTabbedRender();
        if (tabbedSwitcherOpen) {
          queueMicrotask(() => document.querySelector('.tb-persona-item[aria-checked="true"]')?.focus());
        }
        return;
      case 'pick-persona': {
        const id = el.getAttribute('data-persona-id');
        tabbedSwitcherOpen = false;
        if (personaPicker && id && personaPicker.value !== id) {
          tabbedFill = null;
          tabbedHistoryDetailKey = null;
          tabbedConfirmKey = null;
          tabbedPolledOpeningIds.clear();
          if (isApplicationDetailActive()) showApplicationsList();
          personaPicker.value = id;
          personaPicker.dispatchEvent(new Event('change'));
        }
        scheduleTabbedRender();
        return;
      }
      case 'download-resume': {
        const persona = currentPersona();
        if (!persona?.resume_download_path) return;
        downloadPersonaResume({
          dataset: { resumeDownloadPath: persona.resume_download_path, filename: persona.cv_filename || '' },
          textContent: persona.cv_filename || ''
        }).catch((err) => setDrawerFeedback('error', err?.message || 'Could not download resume.'));
        return;
      }
      case 'analyze':
        requestAnalyzeCurrentPage();
        return;
      case 'fill': {
        const opening = currentPageOpening();
        if (opening?.id != null) startTabbedFill(String(opening.id));
        return;
      }
      case 'mark-applied':
        markOpeningApplied(el.getAttribute('data-opening-id'), { openDetail: tabbedTab === 'history' });
        return;
      case 'upload-resume': {
        const opening = currentPageOpening();
        const input = tbEl('opening-detail-resume-upload');
        if (!opening?.id || !input) return;
        selectedOpening = opening;
        input.click();
        return;
      }
      case 'view-application': {
        const app = findApplicationById(el.getAttribute('data-application-id'));
        if (!app) return;
        tabbedHistoryDetailKey = null;
        setTabbedTab('history');
        showApplicationDetail(app);
        return;
      }
      case 'remove-current': {
        const openingId = el.getAttribute('data-opening-id');
        const url = el.getAttribute('data-url');
        if (openingId) handleDeleteQueueItem(openingId);
        else if (url) handleCancelInProgressQueueItem(url);
        return;
      }
      case 'open-row': {
        const key = el.getAttribute('data-row-key');
        const row = buildTabbedHistoryRows().find((r) => r.key === key);
        if (!row) return;
        tabbedConfirmKey = null;
        if (row.kind === 'application') {
          const app = findApplicationById(row.applicationId);
          if (app) showApplicationDetail(app);
        } else {
          tabbedHistoryDetailKey = key;
          tabbedLastHtml.detail = null;
          applyDrawerLayout();
        }
        window.scrollTo(0, 0);
        return;
      }
      case 'ask-remove':
        tabbedConfirmKey = el.getAttribute('data-row-key');
        scheduleTabbedRender();
        return;
      case 'cancel-remove':
        tabbedConfirmKey = null;
        scheduleTabbedRender();
        return;
      case 'confirm-remove':
        removeTabbedRow(el.getAttribute('data-row-key'));
        return;
      case 'detail-back':
        tabbedHistoryDetailKey = null;
        tabbedConfirmKey = null;
        applyDrawerLayout();
        return;
      case 'open-posting': {
        const url = el.getAttribute('data-url');
        if (url) openUrlInNewTab(url);
        return;
      }
      case 'shortcuts':
        closeTabbedMenus();
        openShortcutSettings();
        return;
      default:
    }
  }

  function handleTabbedClick(e) {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const menuToggle = target.closest('#tb-settings-toggle, #tb-sort-toggle, #tb-more-toggle');
    if (menuToggle) {
      const pair = TABBED_MENUS.find(([toggleId]) => toggleId === menuToggle.id);
      if (pair) toggleTabbedMenu(pair[0], pair[1]);
      return;
    }
    const tabBtn = target.closest('[data-tb-tab]');
    if (tabBtn) {
      setTabbedTab(tabBtn.getAttribute('data-tb-tab'));
      return;
    }
    const filterBtn = target.closest('[data-tb-filter]');
    if (filterBtn) {
      tabbedHistoryFilter = filterBtn.getAttribute('data-tb-filter') || 'all';
      tabbedConfirmKey = null;
      scheduleTabbedRender();
      return;
    }
    const sortBtn = target.closest('[data-tb-sort]');
    if (sortBtn) {
      tabbedHistorySort = sortBtn.getAttribute('data-tb-sort') === 'score' ? 'score' : 'newest';
      closeTabbedMenus();
      scheduleTabbedRender();
      return;
    }
    const bulkBtn = target.closest('[data-tb-bulk]');
    if (bulkBtn) {
      closeTabbedMenus();
      handleBulkDeleteBelowScore(bulkBtn.getAttribute('data-tb-bulk'));
      return;
    }
    if (target.closest('#tb-sign-out')) {
      closeTabbedMenus();
      signOutBtn.click();
      return;
    }
    if (target.closest('.tb-pop a')) {
      closeTabbedMenus();
      return;
    }
    const actionEl = target.closest('[data-tb-action]');
    if (!actionEl) {
      if (!target.closest('.tb-pop')) {
        closeTabbedMenus();
        if (tabbedSwitcherOpen) {
          tabbedSwitcherOpen = false;
          scheduleTabbedRender();
        }
      }
      return;
    }
    if (actionEl.disabled) return;
    handleTabbedAction(actionEl.getAttribute('data-tb-action'), actionEl);
  }

  function handleTabbedTabKeydown(e) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const next =
      e.key === 'Home' ? 'analyze' : e.key === 'End' ? 'history' : tabbedTab === 'analyze' ? 'history' : 'analyze';
    setTabbedTab(next);
    tbEl('tb-tab-' + next)?.focus();
  }

  function initTabbedLayout() {
    if (!tabbedLayout) return;
    if (!TabbedViews) {
      console.error('Applica: tabbed-views.js did not load');
      return;
    }
    document.body.classList.add('drawer-tabbed');
    const shell = tbEl('tb-shell');
    if (shell) shell.hidden = false;
    const statusSlot = tbEl('tb-status-slot');
    const statusEl = tbEl('analyze-status');
    if (statusSlot && statusEl) statusSlot.appendChild(statusEl);
    const historyPanel = tbEl('tb-panel-history');
    const appDetail = tbEl('application-detail-view');
    if (historyPanel && appDetail) historyPanel.appendChild(appDetail);

    document.addEventListener('click', handleTabbedClick);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      closeTabbedMenus();
      if (tabbedSwitcherOpen) {
        tabbedSwitcherOpen = false;
        scheduleTabbedRender();
      }
    });
    tbEl('tb-shell')?.querySelector('.tb-tabs')?.addEventListener('keydown', handleTabbedTabKeydown);
    tbEl('tb-history-query')?.addEventListener('input', (e) => {
      tabbedHistoryQuery = e.target.value || '';
      tabbedConfirmKey = null;
      scheduleTabbedRender();
    });
    setInterval(updateTabbedElapsed, 1000);

    loadTabbedLinks();
    refreshShortcutLabels();
    setTabbedTab('analyze');
  }

  try {
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (!isFromOurContentScript(sender)) return;
      handleContentMessage(message, senderOrigin(sender));
    });
  } catch (_) {
    // Extension context invalidated
  }

  initTabbedLayout();
  refreshAuthState();

  // Tell the content script we're ready so it sends drawer-opened (avoids a race after extension
  // reload). Queued until resolveHostTab() learns which tab we're in.
  if (inHostPage) {
    postToContent({ type: 'applica-drawer-ready' });
    resolveHostTab();
  }
})();
