# Seeker extension overlay

Only files that **differ** from `../shared/` belong here. Everything else is shared.

## Build

```bash
cd ..
./scripts/dev.sh seeker             # local: dist/seeker
./scripts/package.sh --from-source  # release: dist/seeker + applica-seeker.zip
```

See [`../README.md`](../README.md) for full build instructions.

## Overlay files

| File | Why |
|------|-----|
| `manifest.json` | Public listing name, `tabs` permission, OAuth content script |
| `lib/api.js` | User OAuth token storage (`applica_auth_token`) |
| `lib/extension-config.js` | `kind: 'seeker'` feature flags |
| `auth.html` | Extension OAuth redirect target |

Drawer and content script live in `../shared/`.
