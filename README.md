# Applica Chrome extensions

Chrome extensions for [Applica](https://app.getapplica.com), a job-search tool. A drawer opens beside any job posting to score it against your resume, fill the application form from your profile, and track what you've applied to.

Two extensions are built from this one codebase:

- **Seeker**: the public Chrome Web Store extension for job seekers. Signs in with your Applica account.
- **Recruiter**: an unlisted extension for Applica recruiters who apply on behalf of the job seekers assigned to them. Signs in with a recruiter ID and key, and can only reach the seekers assigned to that recruiter. The server enforces that; nothing in this code grants extra access.

There is **no npm/webpack compile step**. A build copies `shared/` plus a thin overlay (`seeker/` or `recruiter/`) into `dist/` and applies `APPLICA_ENV` (API URL and manifest hosts).

## Layout

```
.
├── shared/              # Drawer, content script, background worker, shared lib (both builds)
├── seeker/              # Seeker overlay: manifest, OAuth api.js, auth.html
├── recruiter/           # Recruiter overlay: manifest, recruiter api.js, orange icons
├── scripts/
│   ├── dev.sh           # Local dev: one extension, APPLICA_ENV=local
│   ├── release.sh       # Store upload: APPLICA_ENV=production + zips
│   ├── package.sh       # Core assemble script
│   └── env.sh           # APPLICA_ENV → config.js + manifest hosts
└── dist/                # Generated output; do not edit (gitignored)
```

**Overlay wins:** `package.sh` copies `shared/` first, then `seeker/` or `recruiter/` on top. There is no shared manifest: each overlay has its own `manifest.json`, so set the version and permissions there.

`drawer.js` reads `window.APPLICA_EXTENSION` (from each overlay's `lib/extension-config.js`) for seeker vs recruiter behavior.

## Quick start

### Local development (localhost:4000)

From the repo root:

```bash
./scripts/dev.sh seeker      # or: ./scripts/dev.sh recruiter
```

In Chrome, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and pick `dist/seeker` (or `dist/recruiter`).

After editing `shared/` or an overlay, re-run `./scripts/dev.sh` and click **Reload** on the extension card.

### Production build (app.getapplica.com)

```bash
./scripts/release.sh              # both extensions + zips
./scripts/release.sh seeker       # one extension
```

Upload `applica-seeker.zip` / `applica-recruiter.zip` to the matching Chrome Web Store listing.

Or manually:

```bash
APPLICA_ENV=production ./scripts/package.sh
```

## APPLICA_ENV

| Value | API origin | Manifest hosts |
|-------|------------|----------------|
| `local` (default for dev.sh) | `http://localhost:4000` | localhost + `*.fly.dev` |
| `production` | `https://app.getapplica.com` | `app.getapplica.com` |

The build writes `dist/*/lib/config.js` and patches `dist/*/manifest.json`. Do not edit those by hand.

**Runtime override (debug only):** `chrome.storage.local` keys `applica_app_origin` / `applica_recruiter_app_origin` override the default if set. Clear them when switching environments.

## How the pieces talk

- **Background worker** (`shared/background.js`): opens and closes the drawer when you click the toolbar icon, and handles the keyboard shortcuts (seeker manifest `commands`).
- **Content script** (`shared/content/content.js`): injected into the current tab on demand. Hosts the drawer iframe, reads the page for analysis, and fills application forms.
- **Drawer** (`shared/drawer/`): an extension page in an iframe. Talks to the Applica API with the stored token.

The drawer and content script exchange messages only through Chrome extension messaging, never `window.postMessage`. A job site's own scripts can't read profile data sent for form fill, and can't send fake messages to the drawer.

## Script reference

```bash
./scripts/dev.sh --help
./scripts/release.sh --help
./scripts/package.sh --help
```

| Command | What it does |
|---------|----------------|
| `./scripts/dev.sh seeker` | `dist/seeker`, local API |
| `./scripts/dev.sh recruiter production` | `dist/recruiter`, prod API |
| `./scripts/release.sh` | Both `dist/*`, production, both zips |
| `TARGET=seeker ./scripts/package.sh --no-zip` | Single target, no zip |

## Troubleshooting

### Extension still hits localhost after prod build

1. Re-run with production: `./scripts/dev.sh seeker production`
2. Reload the extension in `chrome://extensions`
3. Clear `applica_app_origin` (or `applica_recruiter_app_origin`) in extension storage if it was set during local dev

### Extension changes not showing

1. Re-run `./scripts/dev.sh <target>`
2. Reload the extension
3. Refresh the tab where the drawer is open

## Further reading

- [`shared/README.md`](shared/README.md)
- [`seeker/README.md`](seeker/README.md)
- [`recruiter/README.md`](recruiter/README.md)

## License

[MIT](LICENSE)
