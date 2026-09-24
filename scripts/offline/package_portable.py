#!/usr/bin/env python3
"""Archive an already built and tested application; never download at runtime."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import tarfile
import zipfile


def check_machine(path: Path, target: str):
    with path.open('rb') as file:
        header = file.read(64)
        if target == 'win32-x64':
            if header[:2] != b'MZ':
                raise ValueError('Expected Windows PE executable')
            file.seek(struct.unpack_from('<I', header, 0x3c)[0])
            pe = file.read(6)
            if pe[:4] != b'PE\0\0' or struct.unpack_from('<H', pe, 4)[0] != 0x8664:
                raise ValueError('Expected Windows AMD64 machine type')
        elif header[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', header, 18)[0] != 183:
            raise ValueError('Expected Linux AArch64 ELF executable')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--target', choices=['win32-x64', 'linux-arm64'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    directory = args.directory.resolve()
    executable = directory / ('Insomnia.exe' if args.target == 'win32-x64' else 'insomnia')
    check_machine(executable, args.target)
    catalog_file = directory / 'resources/offline-plugins/catalog.json'
    catalog = json.loads(catalog_file.read_text(encoding='utf-8'))
    if catalog['target'] != args.target or len(catalog['entries']) < 50:
        raise ValueError('Missing or incorrect target plugin catalog')
    if args.target == 'win32-x64':
        check_machine(directory / 'insomnia.dll', args.target)
        for original in directory.glob('Insomnia-origin-*.exe'):
            original.unlink()
        launcher = '@echo off\r\nsetlocal\r\nset "INSOMNIA_DATA_PATH="\r\nset "INSOMNIA_OFFLINE_DATA_PATH=%~dp0data"\r\nstart "" "%~dp0Insomnia.exe" %*\r\n'
        (directory / 'Start-Insomnia-Offline.cmd').write_bytes(launcher.encode('utf-8'))
    else:
        launcher = '#!/bin/sh\nset -eu\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nunset INSOMNIA_DATA_PATH\nexport INSOMNIA_OFFLINE_DATA_PATH="$HERE/data"\nexec "$HERE/insomnia" "$@"\n'
        (directory / 'start-insomnia-offline.sh').write_text(launcher)
        (directory / 'start-insomnia-offline.sh').chmod(0o755)
    (directory / 'OFFLINE-README.txt').write_text(
        'Insomnia Offline - portable review build\n\n'
        'Start using the included launcher. User data is written to the adjacent data folder.\n'
        'Plugins and complete dependency profiles are included under resources/offline-plugins.\n'
        'No npm installation is needed on the target machine. Preinstalled community plugins start disabled;\n'
        'activate reviewed plugins in Preferences / Plugins. Cloud integrations still need their services.\n'
        'Read resources/OFFLINE-PLUGIN-EXCEPTIONS.json for packages that could not be included completely.\n'
        'This archive is unsigned unless a separate signing process was explicitly applied.\n'
        'Linux requires compatible system GUI libraries and a supported Chromium sandbox configuration.\n'
        'Do not disable sandboxing or TLS checks. Enforce an OS-level outbound allowlist for the process tree.\n'
        'Keychain-encrypted credentials may be machine-specific; use supported export/import for migration.\n', encoding='utf-8')
    args.output.mkdir(parents=True, exist_ok=True)
    name = 'Insomnia-Offline-' + args.target + '-portable'
    if args.target == 'win32-x64':
        output = args.output / (name + '.zip')
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
            for file in sorted(directory.rglob('*')):
                if file.is_symlink():
                    raise ValueError('Unexpected Windows portable symlink')
                if file.is_file():
                    archive.write(file, Path(name) / file.relative_to(directory))
    else:
        output = args.output / (name + '.tar.gz')
        with tarfile.open(output, 'w:gz', compresslevel=1) as archive:
            archive.add(directory, arcname=name)
    digest = hashlib.file_digest(output.open('rb'), 'sha256').hexdigest()
    output.with_name(output.name + '.sha256').write_text(digest + '  ' + output.name + '\n')
    print(output)


if __name__ == '__main__':
    main()
