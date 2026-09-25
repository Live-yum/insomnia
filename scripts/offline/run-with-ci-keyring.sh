#!/usr/bin/env bash
# Run inside dbus-run-session on a disposable Linux CI worker only.
# Never modifies the caller's real keyring or disables Electron's sandbox.
set -euo pipefail
if [[ "${CI:-}" != true || -z "${RUNNER_TEMP:-}" || -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  echo 'This wrapper requires a disposable CI worker and a private D-Bus session.' >&2
  exit 1
fi
umask 077
KEYRING_ROOT=$(mktemp -d "$RUNNER_TEMP/insomnia-keyring-XXXXXXXX")
export XDG_DATA_HOME="$KEYRING_ROOT/share"
export XDG_RUNTIME_DIR="$KEYRING_ROOT/runtime"
export XDG_CURRENT_DESKTOP=GNOME
mkdir -p "$XDG_DATA_HOME" "$XDG_RUNTIME_DIR"
cleanup() {
  gnome-keyring-daemon --shutdown >/dev/null 2>&1 || true
  rm -rf -- "$KEYRING_ROOT"
}
trap cleanup EXIT
# A random test-only password is delivered over stdin, never in argv or logs.
openssl rand -base64 32 | gnome-keyring-daemon --unlock --components=secrets > "$KEYRING_ROOT/startup.log" 2>&1
printf 'keyring-probe' | timeout 20 secret-tool store --label='Offline CI keyring probe' application insomnia-ci-check
[[ "$(timeout 20 secret-tool lookup application insomnia-ci-check)" == keyring-probe ]]
secret-tool clear application insomnia-ci-check
"$@"
