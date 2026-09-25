#!/usr/bin/env bash
set -euo pipefail
: "${INSOMNIA_OFFLINE_SMOKE_EXE:?Set the packaged executable path}"
edition="${INSOMNIA_OFFLINE_EDITION:-full}"
case "$edition" in basic|full) ;; *) echo 'Unsupported offline edition' >&2; exit 1 ;; esac
# Preserve Chromium's sandbox; never use --no-sandbox.
sudo chown root:root packages/insomnia/dist/linux-arm64-unpacked/chrome-sandbox
sudo chmod 4755 packages/insomnia/dist/linux-arm64-unpacked/chrome-sandbox
# X11 abstract sockets are namespace-scoped. Run Xvfb and the unprivileged
# desktop together with only loopback; pass only explicit non-secret settings.
sudo unshare --net bash -c '
  set -euo pipefail
  ip link set lo up
  exec runuser -u "$1" -- env PATH="$2" INSOMNIA_OFFLINE_SMOKE_EXE="$3" INSOMNIA_OFFLINE_EDITION="$4" xvfb-run -a node scripts/offline/smoke.mjs
' _ "$USER" "$PATH" "$INSOMNIA_OFFLINE_SMOKE_EXE" "$edition"
