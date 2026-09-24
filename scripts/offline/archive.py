"""Create a portable, clean archive; test data are never copied into the distribution."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tarfile
import zipfile

root = Path(__file__).resolve().parents[2]
target = sys.argv[1]
assert target in ('windows-x64', 'linux-arm64'), target
out = root / 'release-assets'
out.mkdir(exist_ok=True)
folders = list((root / 'packages/insomnia/dist-offline').glob('*unpacked'))
assert len(folders) == 1, folders
source = folders[0]
version = json.loads((root / 'packages/insomnia/package.json').read_text())['version']
sha = os.environ['OFFLINE_SOURCE_SHA']
name = f'Insomnia-Offline-{version}-{target}-{sha[:8]}'
stage = root / 'portable-stage' / name
shutil.copytree(source, stage)
(stage / 'data').mkdir()
(stage / 'data/.portable').write_text('Portable user data directory. Keep this folder private.\n')
shutil.copy(root / 'docs/OFFLINE.md', stage / 'OFFLINE-README.md')
shutil.copy(root / 'LICENSE', stage / 'SOURCE-LICENSE.txt')
if target == 'windows-x64':
    executables = list(stage.glob('*.exe'))
    assert len(executables) == 1, executables
    (stage / 'Start-Insomnia.cmd').write_text('@echo off\nsetlocal\nif not defined INSOMNIA_DATA_PATH set "INSOMNIA_DATA_PATH=%~dp0data"\n"%~dp0' + executables[0].name + '" %*\n', newline='\r\n')
else:
    launcher = stage / 'start-insomnia.sh'
    launcher.write_text('#!/bin/sh\nset -eu\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport INSOMNIA_DATA_PATH="${INSOMNIA_DATA_PATH:-$HERE/data}"\nexec "$HERE/insomnia-offline" "$@"\n')
    launcher.chmod(0o755)
manifest = {'sourceCommit': sha, 'target': target, 'applicationVersion': version, 'offlineBuild': True, 'builtInPlugin': 'insomnia-plugin-offline-toolkit', 'pluginVersion': '1.0.0', 'runtimeDownloads': False, 'signed': False, 'cloudServices': False}
(stage / 'OFFLINE-MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n')
manifest_path = out / (name + '.manifest.json')
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
if target == 'windows-x64':
    archive = out / (name + '.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for item in sorted(stage.rglob('*')):
            if item.is_file(): z.write(item, item.relative_to(stage.parent))
else:
    archive = out / (name + '.tar.gz')
    with tarfile.open(archive, 'w:gz', compresslevel=6) as t: t.add(stage, arcname=name)
hasher = hashlib.sha256()
with archive.open('rb') as f:
    for block in iter(lambda: f.read(1024 * 1024), b''):
        hasher.update(block)
digest = hasher.hexdigest()
(out / (archive.name + '.sha256')).write_text(f'{digest}  {archive.name}\n')
shutil.copy(root / 'offline-test-results/smoke.json', out / (name + '.smoke.json'))
print(archive)
