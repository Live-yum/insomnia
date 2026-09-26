#!/usr/bin/env bash
# Test the real packaged app before the Windows anti-debugging wrapper is added.
# The wrapper itself has its separate no-debugger/blocked-egress validation gate.
set -euo pipefail
: "${PACKAGE_DIRECTORY:?Set the native unpacked package directory}"
: "${RUNNER_TEMP:?Set an isolated diagnostics directory}"
if [ "${RUNNER_OS:-}" = Linux ]; then
  sandbox="$PACKAGE_DIRECTORY/chrome-sandbox"
  test -f "$sandbox"
  sudo chown root:root "$sandbox"
  sudo chmod 4755 "$sandbox"
fi
set +e
npm run test:crit:package > "$RUNNER_TEMP/offline-critical.log" 2>&1
result=$?
set -e
if [ "$result" -ne 0 ]; then
  tail -n 180 "$RUNNER_TEMP/offline-critical.log"
fi
python scripts/offline/collect_playwright_traces.py \
  --source packages/insomnia-smoke-test/traces \
  --output offline-test-results/critical-traces.zip
exit "$result"
