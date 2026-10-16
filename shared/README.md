# Shared extension code

Used by both seeker and recruiter builds. Assembled into `dist/` by [`../scripts/package.sh`](../scripts/package.sh) or [`../scripts/dev.sh`](../scripts/dev.sh).

## Build

From the repo root:

```bash
./scripts/dev.sh recruiter   # or seeker — see ../README.md
```

Do not load this folder directly in Chrome; use `../dist/seeker` or `../dist/recruiter` after a build.

## What lives here vs overlays

| Here (`shared/`) | In overlay (`seeker/` or `recruiter/`) |
|------------------|----------------------------------------|
| `drawer/drawer.js`, `drawer.css`, `drawer.html` | `manifest.json` |
| `drawer/tabbed-views.js`, `tabbed.css` (seeker tabs) | |
| `content/content.js`, `content.css` | `lib/api.js`, `lib/extension-config.js` |
| `lib/config.js`, `constants.js`, `util.js` | `recruiter/images/` (orange icons) |
| `background.js` | `seeker/auth.html` (OAuth callback only) |
| `images/` (seeker mint icons) | |

There is no manifest here. Each build uses its overlay's `manifest.json`, so version bumps and permission changes go in `seeker/manifest.json` or `recruiter/manifest.json`.

`drawer.js` reads `window.APPLICA_EXTENSION` for recruiter vs seeker login and picker behavior.

`features.tabbedLayout` (on in the seeker overlay) switches the drawer to Analyze / History tabs. The recruiter build keeps the worklist layout. The seeker manifest's `commands` (Alt+J analyze, Alt+A fill) are handled in `background.js` and forwarded to the drawer by `content.js`.
