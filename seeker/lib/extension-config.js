/**
 * Seeker (public) extension — explicit defaults.
 */
(function (root) {
  root.APPLICA_EXTENSION = {
    kind: 'seeker',
    storagePrefix: 'applica',
    personaPickerLabel: 'Profile',
    alwaysShowPersonaPicker: false,
    features: {
      applications: true,
      hiringCafe: true,
      tabbedLayout: true,
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
