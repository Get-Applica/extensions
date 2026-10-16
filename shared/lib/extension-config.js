/**
 * Extension variant config. Overlays (seeker/ or recruiter/) set window.APPLICA_EXTENSION
 * before this file loads, or replace this file entirely.
 */
(function (root) {
  const defaults = {
    kind: 'seeker',
    personaPickerLabel: 'Profile',
    alwaysShowPersonaPicker: false,
    features: {
      applications: true,
      hiringCafe: true,
    },
  };

  root.APPLICA_EXTENSION = {
    ...defaults,
    ...(root.APPLICA_EXTENSION || {}),
    features: {
      ...defaults.features,
      ...((root.APPLICA_EXTENSION && root.APPLICA_EXTENSION.features) || {}),
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
