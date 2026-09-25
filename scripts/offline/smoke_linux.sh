#!/usr/bin/env bash
set -euo pipefail
: "${1:?Usage: smoke_linux.sh path/to/packaged/insomnia}"
exe=$(realpath "$1")
helper="$(dirname "$exe")/chrome-sandbox"
test -f "$helper"
test ! -L "$helper"
test "$(id -u)" -ne 0
# Configure the trusted, packaged Chromium SUID helper for the disposable CI
# host, rather than disabling sandboxing or changing host-wide kernel policy.
sudo chown root:root "$helper"
sudo chmod 4755 "$helper"
# X11 abstract sockets are scoped to the network namespace: Xvfb, the test
# server and the unprivileged app must all run inside this same namespace.
sudo unshare --net bash -c '
  set -euo pipefail
  ip link set lo up
  test "$(ip -o link show | wc -l)" -eq 1
  test -z "$(ip route show default)"
  test -z "$(ip -6 route show default)"
  echo "Linux smoke: isolated network namespace, loopback only, unprivileged application, sandbox enabled."
  exec runuser -u "$1" -- env PATH="$2" INSOMNIA_OFFLINE_TEST_NETNS=1 xvfb-run -a node scripts/offline/smoke.mjs "$3"
' _ "$(id -un)" "$PATH" "$exe"
