# Offline plugin distribution

This fork targets Windows x64 and Linux arm64 portable use without a vendor account.

## Scope

The plugin inventory must cover the full public Insomnia Plugin Hub snapshot, not only Crypto Plugin. Include every discoverable package in the inventory and record exact versions, source URLs, integrity hashes, dependency closure, licenses, and an explicit disposition for every package. Preserve the upstream license notices.

Bundled means available from local files without npm, a login, or Internet access on the target machine. A package name, an npm cache without a verified lockfile, or a workflow that merely downloads plugins later is not a vendored runtime bundle.

Downloading a plugin does not establish its compatibility or safety. Plugins that require a cloud service, an additional external executable, native platform-specific components, or a conflicting hook must be identified rather than silently advertised as fully offline. All unreviewed community plugins must be staged disabled by default, with explicit local activation after review. Core local-only functionality should remain available without those plugins.

## Required release gates

1. Materialize application offline changes as source files in the PR, not only build-time substitutions.
2. Store the complete plugin inventory and the actual reproducible plugin packages/dependencies in the repository. Reject missing packages, unresolved dependencies, or integrity mismatches with an actionable report.
3. Never run untrusted package lifecycle scripts or plugin entrypoints while inventorying or downloading packages. A separate test job must have no repository write token or secrets when loading plugins.
4. Build and test Windows x64 and Linux arm64 independently. Do not describe a source archive or an untested archive as a portable release.
5. Test a fresh profile without Internet access, including startup, local projects, imports, scripting, encryption/decryption, and offline plugin activation. Check the complete process tree with operating-system egress controls.
6. Merge and publish only after review and passing build/test gates. No TLS verification, Electron isolation, or credential protections may be weakened for convenience.

## Current status

This document records scope only. It is not evidence that all plugins have been downloaded, that the application has compiled, or that a release has passed an offline network audit.
