/**
 * Shared constants for drawer, content script, and background.
 */
(function (root) {
  const STORAGE_PREFIX =
    (root.APPLICA_EXTENSION && root.APPLICA_EXTENSION.storagePrefix) || 'applica';

  const APPLICATION_STATUS_OPTIONS = [
    ['Applied', 'applied'],
    ['Interviewing - Screening', 'screening'],
    ['Interviewing - Early', 'early'],
    ['Interviewing - Mid', 'mid'],
    ['Interviewing - Late', 'late'],
    ['Offered', 'offered'],
    ['Closed - Rejected', 'rejected'],
    ['Closed - Declined', 'declined'],
    ['Closed - Hired', 'hired']
  ];

  root.ApplicaConstants = {
    APPLICATION_STATUS_OPTIONS,
    STORAGE: {
      AUTH_TOKEN: `${STORAGE_PREFIX}_auth_token`,
      APP_ORIGIN: `${STORAGE_PREFIX}_app_origin`,
      DRAWER_VIEW_STATE: `${STORAGE_PREFIX}_drawer_view_state`,
      DRAWER_APPLICATIONS_VIEW: `${STORAGE_PREFIX}_drawer_applications_view_state`,
      DRAWER_SELECTED_PERSONA: `${STORAGE_PREFIX}_drawer_selected_persona_id`,
      SETUP_EMAILS_SEEN_IDS: `${STORAGE_PREFIX}_setup_emails_seen_ids`,
      REOPEN_DRAWER_TS: `${STORAGE_PREFIX}_reopen_drawer_ts`,
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
