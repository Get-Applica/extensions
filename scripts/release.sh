#!/usr/bin/env bash
# Production build + zips for Chrome Web Store upload.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-all}"

case "$TARGET" in
  seeker|recruiter|all) ;;
  -h|--help)
    echo "Usage: $0 [seeker|recruiter|all]"
    echo ""
    echo "  APPLICA_ENV=production build with store zips (default: both extensions)"
    exit 0
    ;;
  *)
    echo "error: unknown target '$TARGET' (use seeker, recruiter, or all)" >&2
    exit 1
    ;;
esac

export APPLICA_ENV=production
export TARGET

"$ROOT/scripts/package.sh" --target="$TARGET"
