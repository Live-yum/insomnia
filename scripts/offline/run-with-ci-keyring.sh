#!/usr/bin/env bash
# CI-only real native keyring in a fresh private dbus-run-session.
set -euo pipefail
if [[ "${CI:-}" != true || -z "${RUNNER_TEMP:-}" || -z "${DBUS_SESSION_BUS_ADDRESS:-}" || "$#" -eq 0 ]]; then
  echo 'A disposable CI runner, private D-Bus session and command are required.' >&2
  exit 1
fi
owner() {
  gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
    --method org.freedesktop.DBus.NameHasOwner org.freedesktop.secrets
}
if [[ "$(owner)" != '(false,)' ]]; then
  echo 'Refusing to reuse an existing Secret Service; create a fresh D-Bus session.' >&2
  exit 1
fi
umask 077
KEYRING_ROOT=$(mktemp -d "$RUNNER_TEMP/insomnia-keyring-XXXXXXXX")
export XDG_DATA_HOME="$KEYRING_ROOT/share"
export XDG_CONFIG_HOME="$KEYRING_ROOT/config"
export XDG_RUNTIME_DIR="$KEYRING_ROOT/runtime"
export GNOME_KEYRING_CONTROL="$KEYRING_ROOT/control"
export XDG_CURRENT_DESKTOP=GNOME
unset GNOME_KEYRING_PID
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_RUNTIME_DIR" "$GNOME_KEYRING_CONTROL"
KEYRING_PID=''
cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$KEYRING_PID" ]]; then
    kill "$KEYRING_PID" 2>/dev/null || true
    wait "$KEYRING_PID" 2>/dev/null || true
  fi
  rm -rf -- "$KEYRING_ROOT"
  exit "$status"
}
trap cleanup EXIT
# Test-only random password via private stdin, never argv/environment/logs.
openssl rand -base64 32 > "$KEYRING_ROOT/password"
gnome-keyring-daemon --foreground --unlock --components=secrets \
  --control-directory="$GNOME_KEYRING_CONTROL" < "$KEYRING_ROOT/password" \
  > "$KEYRING_ROOT/startup.log" 2>&1 &
KEYRING_PID=$!
ready=false
for ((attempt=0; attempt<200; attempt++)); do
  if ! kill -0 "$KEYRING_PID" 2>/dev/null; then
    cat "$KEYRING_ROOT/startup.log" >&2
    echo 'Native keyring exited before registration.' >&2
    exit 1
  fi
  # Query the bus driver; never auto-activate a second locked daemon.
  if [[ "$(owner)" == '(true,)' ]]; then ready=true; break; fi
  sleep 0.1
done
if [[ "$ready" != true ]]; then
  cat "$KEYRING_ROOT/startup.log" >&2
  echo 'Native Secret Service did not become ready.' >&2
  exit 1
fi
rm -f -- "$KEYRING_ROOT/password"
printf 'keyring-probe' | timeout 20 secret-tool store --label='Offline CI keyring probe' application insomnia-ci-check
[[ "$(timeout 20 secret-tool lookup application insomnia-ci-check)" == keyring-probe ]]
timeout 20 secret-tool clear application insomnia-ci-check
"$@"
