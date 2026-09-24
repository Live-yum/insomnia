#!/usr/bin/env bash
set -euo pipefail
: "${INSOMNIA_OFFLINE_SMOKE_EXE:?Set the packaged executable path}"
# Preserve Chromium's sandbox; never use --no-sandbox.
sudo chown root:root packages/insomnia/dist/linux-arm64-unpacked/chrome-sandbox
sudo chmod 4755 packages/insomnia/dist/linux-arm64-unpacked/chrome-sandbox
# X11 abstract Unix sockets are network-namespace scoped. Start both Xvfb
# and the unprivileged app inside the SAME namespace, with only loopback.
sudo unshare --net bash -c '
  set -euo pipefail
  ip link set lo up
  exec runuser -u "$1" -- env PATH="$2" INSOMNIA_OFFLINE_SMOKE_EXE="$3" xvfb-run -a node scripts/offline/smoke.mjs
' _ "$USER" "$PATH" "$INSOMNIA_OFFLINE_SMOKE_EXE"
