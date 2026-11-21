#!/usr/bin/env bash
# Contract method coverage report.
#
# Lists every public contract function and whether it has a test, so gaps in
# contract method coverage are visible in CI output. Intended to run on PRs
# that touch contracts (see .github/workflows).
#
# Usage: scripts/contract-method-coverage.sh [contracts-dir] [tests-dir]
#   contracts-dir  Directory containing contract sources (default: contracts)
#   tests-dir      Directory containing tests (default: test)
#
# Exit code is always 0; this is a reporting tool, not a gate.

set -euo pipefail

CONTRACTS_DIR="${1:-contracts}"
TESTS_DIR="${2:-test}"

if [ ! -d "$CONTRACTS_DIR" ]; then
  echo "contract-method-coverage: contracts directory '$CONTRACTS_DIR' not found; skipping report."
  exit 0
fi

# Collect public function names from contract sources.
# Matches Solidity-style `function name(...) public|external` declarations.
mapfile -t PUBLIC_FNS < <(
  grep -rhoE 'function[[:space:]]+[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\([^)]*\)[[:space:]]*(public|external)' "$CONTRACTS_DIR" \
    --include='*.sol' \
    | sed -E 's/function[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*/\1/' \
    | sort -u
)

if [ "${#PUBLIC_FNS[@]}" -eq 0 ]; then
  echo "contract-method-coverage: no public functions found under '$CONTRACTS_DIR'."
  exit 0
fi

# Gather test sources once for reference lookups.
TEST_SOURCES=""
if [ -d "$TESTS_DIR" ]; then
  TEST_SOURCES=$(grep -rh '' "$TESTS_DIR" --include='*.sol' --include='*.ts' --include='*.js' 2>/dev/null || true)
fi

UNTESTED=()
TESTED_COUNT=0

printf '%-40s %s\n' 'PUBLIC FUNCTION' 'HAS TEST'
printf '%-40s %s\n' '---------------' '--------'

for fn in "${PUBLIC_FNS[@]}"; do
  if [ -n "$TEST_SOURCES" ] && printf '%s' "$TEST_SOURCES" | grep -qE "\b${fn}\b"; then
    printf '%-40s %s\n' "$fn" 'yes'
    TESTED_COUNT=$((TESTED_COUNT + 1))
  else
    printf '%-40s %s\n' "$fn" 'NO'
    UNTESTED+=("$fn")
  fi
done

TOTAL=${#PUBLIC_FNS[@]}
printf '\nContract method coverage: %d/%d public functions have a test.\n' "$TESTED_COUNT" "$TOTAL"

if [ "${#UNTESTED[@]}" -gt 0 ]; then
  echo ''
  echo 'Untested public functions:'
  for fn in "${UNTESTED[@]}"; do
    echo "  - $fn"
  done
else
  echo 'All public functions have a test.'
fi

exit 0
