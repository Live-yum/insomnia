#!/usr/bin/env python3
"""One-time migration of the reviewed ae09eea offline patch. Not a runtime/build hook.

The resulting source files are committed to Git; normal builds never apply patches.
Checks BOTH before and after Git blob hashes before writing any changed source.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

def main():
    changes = []
    for edit in json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8')):
        path = ROOT / edit['path']
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise RuntimeError('Invalid source path')
        data = path.read_bytes().replace(b'\r\n', b'\n')
        if blob(data) == edit['after']:
            continue
        if blob(data) != edit['sha']:
            raise RuntimeError('Source drift: ' + edit['path'])
        text = data.decode('utf-8')
        for op in edit['operations']:
            if 'remove_between' in op:
                start, end = op['remove_between']
                if text.count(start) != 1 or text.count(end) != 1 or text.index(end) <= text.index(start):
                    raise RuntimeError('Non-unique section markers')
                text = text[:text.index(start)] + text[text.index(end):]
            else:
                count = text.count(op['old'])
                if not op['old'] or (count < 1 if op.get('all') else count != 1):
                    raise RuntimeError('Anchor drift: ' + edit['path'])
                text = text.replace(op['old'], op['new'])
        after = text.encode('utf-8')
        if blob(after) != edit['after']:
            raise RuntimeError('Output hash mismatch: ' + edit['path'])
        changes.append((path, after))
    for path, data in changes:
        path.write_bytes(data)
    print(f'Materialized {len(changes)} reviewed source changes; no runtime patching required.')

if __name__ == '__main__':
    main()
