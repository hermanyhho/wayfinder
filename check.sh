#!/usr/bin/env bash
# runs every cheap correctness check: typecheck, unit tests, build.
# one command before pushing.
#
# stops at the first failing step. pass --keep-going to run all steps
# and see every problem at once.

set -uo pipefail
cd "$(dirname "$0")"

KEEP_GOING=0
if [ "${1:-}" = "--keep-going" ] || [ "${1:-}" = "-k" ]; then
  KEEP_GOING=1
fi

declare -a FAILED_STEPS=()
overall_status=0

run() {
  local label=$1
  shift
  echo
  echo "▶ ${label}"
  if ! "$@"; then
    FAILED_STEPS+=("${label}")
    overall_status=1
    if [ "${KEEP_GOING}" -eq 0 ]; then
      echo "✗ ${label} failed, stopping. (pass --keep-going to run the remaining checks)"
      exit 1
    fi
    echo "✗ ${label} failed, continuing because of --keep-going."
  fi
}

run "tsc (typecheck)"    npm run typecheck --silent
run "vitest (unit tests)" npm test --silent
run "esbuild (build)"    npm run build --silent

echo
if [ "${overall_status}" -eq 0 ]; then
  echo "✓ all checks passed."
else
  echo "✗ failed: ${FAILED_STEPS[*]}"
fi
exit "${overall_status}"
