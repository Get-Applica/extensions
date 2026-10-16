# Shared extension code

Used by both seeker and recruiter builds. Assembled into `dist/` by [`../scripts/package.sh`](../scripts/package.sh) or [`../scripts/dev.sh`](../scripts/dev.sh).

## Build

From `chrome_extensions/`:

```bash
./scripts/dev.sh recruiter   # or seeker — see ../README.md
```

Do not load this folder directly in Chrome; use `../dist/seeker` or `../dist/recruiter` after a build.

## What lives here vs overlays

| Here (`shared/`) | In overlay (`seeker/` or `recruiter/`) |
|------------------|----------------------------------------|
| `drawer/drawer.js`, `drawer.css`, `drawer.html` | `manifest.json` |
| `content/content.js`, `content.css` | `lib/api.js`, `lib/extension-config.js` |
| `lib/config.js`, `constants.js`, `util.js` | `recruiter/images/` (orange icons) |
| `background.js` | `seeker/auth.html` (OAuth callback only) |
| `images/` (seeker mint icons) | |

`drawer.js` reads `window.APPLICA_EXTENSION` for recruiter vs seeker login and picker behavior.
