# Recruiter extension overlay

Only files that **differ** from `../shared/` belong here. Everything else is shared.

## Build

```bash
cd ..
./scripts/dev.sh recruiter              # local API (default)
./scripts/dev.sh recruiter production   # app.getapplica.com
./scripts/release.sh recruiter          # production zip for store
```

See [`../README.md`](../README.md) for full build instructions.

## Overlay files

| File | Why |
|------|-----|
| `manifest.json` | Recruiter name, no `tabs`, no OAuth content script |
| `images/*.png` | Orange-tinted icons (distinct from public seeker extension) |
| `lib/api.js` | Recruiter ID+key auth (`applica_recruiter_auth_token`) |
| `lib/extension-config.js` | `kind: 'recruiter'`, seeker picker, setup emails, Hiring Cafe |

Recruiter UI behavior (login form, seeker picker, account-setup emails) is driven by `extension-config.js` and branches in `shared/drawer/drawer.js`.

This overlay is public like the rest of the repo; it holds no credentials. Recruiters sign in with their own ID and key, and the API only returns seekers assigned to that recruiter. Keep these files out of the seeker build: `package.sh` builds each target from `shared/` plus its own overlay only.
