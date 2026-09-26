"""Remove only byte-identical, known wrapper test copies before portable archiving."""
import hashlib
from pathlib import Path
import re


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def cleanup_windows_test_payload(directory, version):
    root = Path(directory)
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?', version):
        raise ValueError('Invalid portable version')
    if root.is_symlink() or not root.is_dir():
        raise ValueError('A regular portable output directory is required')
    if (root / 'installer-info.json').exists():
        raise ValueError('Do not remove NSIS-installed runtime files')
    payload = root / 'insomnia.dll'
    entry = root / 'Insomnia.exe'
    for file in (payload, entry):
        if file.is_symlink() or not file.is_file() or not file.stat().st_size:
            raise ValueError('Missing regular wrapper or preserved runtime payload')
    expected = digest(payload)
    candidates = [root / f'Insomnia-origin-{version}.exe', root / f'insomnia-{version}.exe']
    removal = []
    # Validate all candidates first; never partially clean up mismatched files.
    for file in candidates:
        if file.is_symlink():
            raise ValueError('Refuse linked wrapper test output')
        if not file.exists():
            continue
        if not file.is_file() or file.stat().st_size != payload.stat().st_size or digest(file) != expected:
            raise ValueError('Wrapper test copy does not match preserved payload: ' + file.name)
        removal.append({'path': file.name, 'bytes': file.stat().st_size, 'sha256': expected})
    for item in removal:
        (root / item['path']).unlink()
    return removal
