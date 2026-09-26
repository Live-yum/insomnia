# Offline fork CI coverage

This fork's requested portable targets are Windows x64 and Linux ARM64. `Offline portable build` and `Release Recurring` both call the same read-only native validation workflow. A pull request checks `github.sha` (GitHub's proposed merge commit), not an older head or the default branch. Their required aggregate jobs reject failure, cancellation and skipped native validation. Neither pull request workflow publishes a release or needs a signing/deployment secret.

## Warning remediation

The artifact actions use pinned Node 24 implementations. The workspace lint gate and a separate uncached smoke-test lint gate require zero warnings. Semgrep retains its automatic rule selection, real findings, JSON/SARIF reports, and failure exit status. Tests use a fixed legacy SRI input vector rather than computing SHA-1. Embedded Python is explicitly invoked by a quoted here-document; PowerShell signature verification lives in a PowerShell source file. Shell inputs use quoted environment variables rather than template interpolation.

Electron 43 downloads its development runtime on demand. Build-based UI jobs explicitly run the installer from the already-installed, lockfile-selected Electron package before configuring the trusted Linux `chrome-sandbox` helper. They do not disable Chromium sandboxing or change the machine-wide user-namespace policy. The test launcher uses a fresh `INSOMNIA_OFFLINE_DATA_PATH`; the application's rejection of the legacy data override remains intact.

## Critical test migration

The upstream critical cases assume a cloud account, bundled cloud credential providers and update-triggered automatic backups. Those assumptions contradict the offline fork. The cases are migrated, not skipped:

| Existing coverage | Offline counterpart |
| --- | --- |
| Bundled providers and request engine | Both reviewed local crypto bundles are present; actual JSON request, raw response, curl code generation and pre-request execution still run. |
| External script modules | The original imported script fixture is executed and must return HTTP 200. |
| Custom CA | An untrusted certificate must fail, then the explicitly supplied fixture CA must allow HTTP 200. TLS verification is never disabled. |
| Update-triggered backup | Manual update checks remain idle, no automatic updater backup runs, and actual local project data survives process shutdown/relaunch. This does not claim automatic backup functionality. |
| Logout into a limited scratchpad | A local project and collection are created without a vendor session or an unlock prompt. |

These five critical tests run against each real unpacked native application before the Windows anti-debugging wrapper is installed. The final Windows wrapper then has its own normal-start test with outbound traffic blocked; Linux additionally runs the existing loopback-only smoke. A failing critical case blocks portable artifact creation. The legacy macOS and Linux x64 recurring matrix is not a supported portable deliverable for this fork and is not represented as tested.

The full six-shard Smoke project remains separate and is not narrowed to a curated passing subset. Its incompatible cloud-specific cases must be migrated individually as actual failures are diagnosed. No claim is made that those cases already pass merely because this file or a workflow was committed.

## Diagnostics

Raw Playwright trace names can contain reserved characters from test titles. The diagnostic collector does not mutate the test output: it archives every regular file using unique cross-platform member names, preserves exact bytes, and records original paths and SHA-256 in `MANIFEST.json`. Symlinks, special files, recursive output placement and overwriting an existing archive are rejected. The collector has regression tests. Test failures remain failures regardless of successful diagnostic upload.

## Acceptance boundaries

Successful builds and plugin discovery are not blanket third-party-plugin compatibility or site-specific security certification. The catalog's explicit exceptions, default-disabled community plugins and release limitations remain authoritative. Preserve historical run results; evaluate the latest exact source revision rather than deleting old failure or warning evidence.
