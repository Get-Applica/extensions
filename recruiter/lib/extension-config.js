/**
 * Recruiter extension — auth and picker differ from public seeker build.
 */
(function (root) {
  root.APPLICA_EXTENSION = {
    kind: 'recruiter',
    storagePrefix: 'applica_recruiter',
    personaPickerLabel: 'Seeker',
    alwaysShowPersonaPicker: true,
    features: {
      applications: true,
      applicationListStatusEdit: false,
      hiringCafe: true,
      setupEmails: true,
      setupEmailsDefaultCollapsed: true,
    },
    profileHeaderStat: 'applications_today',
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
