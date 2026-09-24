# Checked-in plugin catalog snapshot

This PR reuses the actual catalog archives from commit `584b696ae1fd7a6115055ed7642622aadba45f50` of this same repository, tree `755bd4f5631844ea8ce73b25778ef50bd994204e`, without copying concurrent application changes or rewriting that branch.

`vendor/offline-plugins/blobs/` contains real npm tarballs, not Git LFS pointers, remote URLs or submodules. Per-plugin lockfiles, recorded registry integrity and SHA-256 metadata are included. `python3 scripts/offline/vendor_plugins.py verify` checks the snapshot offline without installing or running package lifecycle scripts.

Read `vendor/offline-plugins/REPORT.md` and `EXCEPTIONS.json`: some packages have incomplete dependency archives. Downloaded packages are NOT security-audited, compatibility-tested or automatically active. Plugins that require cloud services, external programs or native binaries are not made offline-capable by this snapshot.

The two reviewed crypto plugins under `packages/insomnia/src/vendor/` are integrated into the app and included in its portable build. The broad catalog in this directory is an administrator-maintained source archive, not an assertion that all marketplace plugins are installed and working. For an offline review workstation, the maintenance tool can materialize dependency-complete profiles into a NEW directory using `materialize --output <directory> --target win32-x64` or `--target linux-arm64`. No install scripts run. Review dependencies, licenses, permissions and platform compatibility before copying any profile into an application's plugin directory.

Do not enable arbitrary catalog plugins in a high-security environment just because their files are now available offline. Keep process-tree egress restrictions independent of application settings.
