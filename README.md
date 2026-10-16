# Chrome extensions (seeker + recruiter)

Two installable extensions share one codebase:

- **Seeker** — public Chrome Web Store listing; job seekers sign in with Applica OAuth.
- **Recruiter** — private/unlisted listing; recruiters sign in with recruiter ID + key and pick assigned seekers.

There is **no npm/webpack compile step**. A build copies `shared/` plus a thin overlay (`seeker/` or `recruiter/`) into `dist/` and applies `APPLICA_ENV` (API URL + manifest hosts).

## Layout

```
chrome_extensions/
├── shared/              # Drawer, content script, background, shared lib (both builds)
├── seeker/              # Public overlay: manifest, OAuth api.js, auth.html
├── recruiter/           # Private overlay: manifest, recruiter api.js, icons
├── scripts/
│   ├── dev.sh           # Local dev: one extension, APPLICA_ENV=local
│   ├── release.sh       # Store upload: APPLICA_ENV=production + zips
│   ├── package.sh       # Core assemble script
│   └── env.sh           # APPLICA_ENV → config.js + manifest hosts
└── dist/                # Generated output — do not edit (gitignored)
```

**Overlay wins:** `package.sh` copies `shared/` first, then `seeker/` or `recruiter/` on top.

`drawer.js` reads `window.APPLICA_EXTENSION` (from each overlay’s `lib/extension-config.js`) for recruiter vs seeker behavior.

## Quick start

### Local development (localhost:4000)

```bash
cd chrome_extensions

./scripts/dev.sh recruiter   # or: ./scripts/dev.sh seeker
```

Load unpacked in Chrome → `chrome_extensions/dist/recruiter` (or `dist/seeker`).

After editing `shared/` or an overlay, re-run `./scripts/dev.sh` and click **Reload** on the extension card.

### Production build (app.getapplica.com)

```bash
cd chrome_extensions

./scripts/release.sh              # both extensions + zips
./scripts/release.sh recruiter    # recruiter only
```

Upload `applica-recruiter.zip` / `applica-seeker.zip` to the matching Chrome Web Store listing.

Or manually:

```bash
APPLICA_ENV=production ./scripts/package.sh
```

## APPLICA_ENV

| Value | API origin | Manifest hosts |
|-------|------------|----------------|
| `local` (default for dev.sh) | `http://localhost:4000` | localhost + `*.fly.dev` |
| `production` | `https://app.getapplica.com` | `app.getapplica.com` |

Build writes `dist/*/lib/config.js` and patches `dist/*/manifest.json`. Do not edit those by hand.

**Runtime override (debug only):** `chrome.storage.local` keys `applica_app_origin` / `applica_recruiter_app_origin` override the default if set. Clear them when switching environments.

## Open source vs private recruiter

- **Public (OSS):** `shared/` + `seeker/` — safe to publish on GitHub.
- **Private:** `recruiter/` overlay only (~4 files). Keep in a private repo; pin to a release of the public shared code via submodule or copy.

Never ship recruiter auth or the recruiter zip in the public seeker listing.

## Script reference

```bash
./scripts/dev.sh --help
./scripts/release.sh --help
./scripts/package.sh --help
```

| Command | What it does |
|---------|----------------|
| `./scripts/dev.sh recruiter` | `dist/recruiter`, local API |
| `./scripts/dev.sh seeker production` | `dist/seeker`, prod API |
| `./scripts/release.sh` | Both `dist/*`, production, both zips |
| `TARGET=seeker ./scripts/package.sh --no-zip` | Single target, no zip |

## Troubleshooting

### Extension still hits localhost after prod build

1. Re-run with production: `./scripts/dev.sh recruiter production`
2. Reload the extension in `chrome://extensions`
3. Clear `applica_recruiter_app_origin` in extension storage if it was set during local dev

### Extension changes not showing

1. Re-run `./scripts/dev.sh <target>`
2. Reload the extension
3. Refresh the tab where the drawer is open

## Further reading

- [`shared/README.md`](shared/README.md)
- [`seeker/README.md`](seeker/README.md)
- [`recruiter/README.md`](recruiter/README.md)
