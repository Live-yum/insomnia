#!/usr/bin/env python3
"""One-time, hash-checked migration. This is not a build-time source substitution.

CI commits the resulting source files to the PR. Normal application builds never
run this script. A mismatch aborts before changing any source file.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / 'docs/OFFLINE-SOURCE-STATUS.json'


def blob_sha(data: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def transform(text: str, edit: dict) -> str:
    if 'content' in edit:
        return edit['content']
    if 'json_updates' in edit:
        obj = json.loads(text)
        obj.update(edit['json_updates'])
        return json.dumps(obj, ensure_ascii=False, indent=2) + '\n'
    for operation in edit['operations']:
        if 'remove_between' in operation:
            start, end = operation['remove_between']
            if text.count(start) != 1 or text.count(end) != 1:
                raise ValueError('Removal anchors are not unique: ' + edit['path'])
            a, b = text.index(start), text.index(end)
            if b <= a:
                raise ValueError('Removal anchors are reversed')
            text = text[:a] + text[b:]
        else:
            old, new = operation['old'], operation['new']
            count = text.count(old)
            if not count or (not operation.get('all') and count != 1):
                raise ValueError('Replacement anchor mismatch: ' + edit['path'])
            text = text.replace(old, new)
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if REPORT.exists():
        report = json.loads(REPORT.read_text())
        for entry in report['files']:
            actual = hashlib.sha256((ROOT / entry['path']).read_bytes()).hexdigest()
            if actual != entry['sha256']:
                raise ValueError('Source was already migrated and subsequently edited; do not reapply the migration')
        print('Offline application source is already materialized.')
        return
    status = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT, text=True)
    if status.strip():
        raise ValueError('Refuse to migrate a worktree with tracked modifications')
    edits = []
    for source in sorted((Path(__file__).parent / 'migration').glob('*.json')):
        edits.extend(json.loads(source.read_text(encoding='utf-8')))
    if len(edits) < 35:
        raise ValueError('Incomplete application migration')
    planned = []
    seen = set()
    for edit in edits:
        relative = PurePosixPath(edit['path'])
        if relative.is_absolute() or '..' in relative.parts or relative.parts[0] != 'packages' or '\\' in edit['path'] or ':' in edit['path']:
            raise ValueError('Invalid migration path')
        if edit['path'] in seen:
            raise ValueError('Duplicate migration path')
        seen.add(edit['path'])
        target = ROOT.joinpath(*relative.parts)
        if any(p.is_symlink() for p in (target, *target.parents)):
            raise ValueError('Symlink migration target')
        if edit['sha'] is None:
            if target.exists():
                raise ValueError('New source path already exists: ' + edit['path'])
            original = b''
        else:
            original = target.read_bytes()
            if blob_sha(original) != edit['sha']:
                raise ValueError('Source baseline hash mismatch: ' + edit['path'])
        result = transform(original.decode('utf-8'), edit).encode('utf-8')
        planned.append((target, result))
    print('Preflight passed for', len(planned), 'source files.')
    if not args.apply:
        return
    for target, result in planned:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + '.offline-migration.tmp')
        with temporary.open('xb') as file:
            file.write(result)
        os.replace(temporary, target)
    report = {'baseCommit': 'ae09eea24dc00594dd9acbe0a7e27ae5fa9bcc9c', 'buildValidated': False,
              'files': [{'path': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(data).hexdigest()} for path, data in planned]}
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('Source files materialized. Compilation and runtime validation remain separate gates.')


if __name__ == '__main__':
    main()
