#!/usr/bin/env bash
# Assemble seeker and recruiter Chrome extensions and zip for store upload.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
SCRIPTS="$ROOT/scripts"
SKIP_ZIP=0
TARGET="${TARGET:-all}"

# shellcheck source=env.sh
source "$SCRIPTS/env.sh"

usage() {
  cat <<'EOF'
Usage: package.sh [options]

Assembles shared/ + seeker|recruiter overlays into dist/ (default).

Options:
  --no-zip        Skip creating .zip files
  --target NAME   Build seeker, recruiter, or all (default: all)
  -h, --help      Show this help

Environment:
  APPLICA_ENV     local (default) or production
                  Sets API origin and manifest host_permissions in dist/

Examples:
  APPLICA_ENV=local ./scripts/dev.sh recruiter
  APPLICA_ENV=production ./scripts/package.sh
  TARGET=seeker APPLICA_ENV=production ./scripts/package.sh --no-zip
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --legacy)
      echo "error: --legacy was removed; use shared/ + seeker|recruiter overlays" >&2
      exit 1
      ;;
    --no-zip)
      SKIP_ZIP=1
      shift
      ;;
    --from-source)
      # Back-compat: was required before shared/ became the default.
      shift
      ;;
    --target)
      if [[ $# -lt 2 ]]; then
        echo "error: --target requires a value (seeker|recruiter|all)" >&2
        exit 1
      fi
      TARGET="$2"
      shift 2
      ;;
    --target=*)
      TARGET="${1#*=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option '$1'" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$TARGET" in
  seeker|recruiter|all) ;;
  *)
    echo "error: TARGET must be seeker, recruiter, or all (got '$TARGET')" >&2
    exit 1
    ;;
esac

APPLICA_ENV_RESOLVED="$(resolve_applica_env)"

assemble_overlay() {
  local name="$1"
  local out="$DIST/$name"
  local shared="$ROOT/shared"
  local overlay="$ROOT/$name"

  if [[ ! -d "$shared" ]] || [[ -z "$(ls -A "$shared" 2>/dev/null)" ]]; then
    echo "error: shared/ is empty" >&2
    exit 1
  fi
  if [[ ! -d "$overlay" ]]; then
    echo "error: missing overlay $overlay" >&2
    exit 1
  fi

  mkdir -p "$out"
  rsync -a \
    --exclude '.git' --exclude '.DS_Store' --exclude 'README.md' \
    "$shared/" "$out/"
  rsync -a \
    --exclude '.git' --exclude '.DS_Store' --exclude 'README.md' \
    "$overlay/" "$out/"
}

zip_extension() {
  local name="$1"
  local zip_path="$ROOT/applica-${name}.zip"

  rm -f "$zip_path"
  (cd "$DIST/$name" && zip -r "$zip_path" . -x "*.DS_Store" -x "*/.git/*")
  echo "  → $zip_path"
}

build_one() {
  local name="$1"
  echo "==> Building $name (APPLICA_ENV=$APPLICA_ENV_RESOLVED)"
  assemble_overlay "$name"
  apply_env_to_dist "$DIST/$name" "$APPLICA_ENV_RESOLVED"
  echo "    API origin: $(app_origin_for_env "$APPLICA_ENV_RESOLVED")"
}

echo "==> Cleaning $DIST"
rm -rf "$DIST"
mkdir -p "$DIST"

if [[ "$TARGET" == "all" ]]; then
  build_one seeker
  build_one recruiter
else
  build_one "$TARGET"
fi

if [[ "$SKIP_ZIP" -eq 0 ]]; then
  echo "==> Zipping for Chrome Web Store"
  if [[ "$TARGET" == "all" ]]; then
    zip_extension seeker
    zip_extension recruiter
  else
    zip_extension "$TARGET"
  fi
fi

echo ""
echo "Done."
echo "  APPLICA_ENV=$APPLICA_ENV_RESOLVED"
echo "  Load unpacked: chrome://extensions → $DIST/<seeker|recruiter>"
if [[ "$SKIP_ZIP" -eq 0 ]]; then
  echo "  Upload applica-<name>.zip to the matching Chrome Web Store listing"
fi
