#!/usr/bin/env bash
# Assemble one extension for local Chrome testing (Load unpacked).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-recruiter}"
APPLICA_ENV="${APPLICA_ENV:-local}"

usage() {
  cat <<'EOF'
Usage: dev.sh [seeker|recruiter] [local|production]

Assembles dist/<target>/ from shared/ + overlay. Defaults to local API (localhost:4000).

Examples:
  ./scripts/dev.sh recruiter
  ./scripts/dev.sh seeker production
  APPLICA_ENV=production ./scripts/dev.sh recruiter

After editing shared/ or the overlay, re-run this script and Reload the extension.
EOF
}

case "$TARGET" in
  seeker|recruiter) ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    echo "error: unknown target '$TARGET' (use seeker or recruiter)" >&2
    usage >&2
    exit 1
    ;;
esac

if [[ "${2:-}" != "" ]]; then
  APPLICA_ENV="$2"
fi

export APPLICA_ENV
export TARGET

"$ROOT/scripts/package.sh" --no-zip --target="$TARGET"

echo ""
echo "Load unpacked in Chrome:"
echo "  chrome://extensions → Developer mode → Load unpacked"
echo "  → $ROOT/dist/$TARGET"
echo ""
echo "APPLICA_ENV=$APPLICA_ENV ($( [[ "$APPLICA_ENV" == production || "$APPLICA_ENV" == prod ]] && echo 'https://app.getapplica.com' || echo 'http://localhost:4000'))"
echo ""
echo "After editing shared/ or $TARGET/, re-run:  ./scripts/dev.sh $TARGET"
