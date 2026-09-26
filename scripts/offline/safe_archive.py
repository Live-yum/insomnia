"""Extract only the exact, locally validated portable inventory into a private directory.

No extractall(), owner restoration, special files, or archive-controlled write paths.
The expected inventory comes from the tested build, not from inside the archive.
"""
import hashlib
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import zipfile

MAX_ENTRIES = 2000
MAX_BYTES = 900 * 1024 * 1024


def _parts(name):
    if not isinstance(name, str) or not name or name.startswith('/') or '\\' in name or ':' in name:
        raise ValueError('Invalid portable archive path')
    parts = name.rstrip('/').split('/')
    if any(part in ('', '.', '..') or any(ord(char) < 32 for char in part) for part in parts):
        raise ValueError('Unsafe portable archive path')
    return tuple(parts)


def extract_verified_archive(archive_path, destination, basename, manifest, windows):
    """Verify names, types, lengths and hashes before accepting a fresh extraction."""
    if len(_parts(basename)) != 1 or not isinstance(manifest, dict) or len(manifest) > MAX_ENTRIES:
        raise ValueError('Invalid expected inventory')
    destination = Path(destination)
    if destination.is_symlink() or not destination.is_dir() or any(destination.iterdir()):
        raise ValueError('Extraction requires a new empty private directory')
    root = destination / basename
    expected = {}
    total = 0
    for relative, metadata in manifest.items():
        parts = _parts(relative)
        if not isinstance(metadata, dict):
            raise ValueError('Invalid inventory record')
        if 'link' in metadata:
            if windows:
                raise ValueError('Links are not permitted in Windows portable output')
            link = metadata['link']
            if not isinstance(link, str) or not link or PurePosixPath(link).is_absolute() or '\\' in link or ':' in link:
                raise ValueError('Invalid expected link')
            target = (root.joinpath(*parts).parent / link).resolve()
            if not target.is_relative_to(root.resolve()):
                raise ValueError('Expected link escapes portable root')
        else:
            size = metadata.get('bytes')
            digest = metadata.get('sha256')
            if type(size) is not int or size < 0 or not isinstance(digest, str) or len(digest) != 64:
                raise ValueError('Invalid expected file metadata')
            total += size
        expected['/'.join((basename, *parts))] = metadata
    if total > MAX_BYTES:
        raise ValueError('Expected inventory exceeds extraction budget')
    root.mkdir(mode=0o700)
    manager = zipfile.ZipFile(archive_path) if windows else tarfile.open(archive_path, 'r:gz')
    with manager as archive:
        members = archive.infolist() if windows else archive.getmembers()
        if len(members) > MAX_ENTRIES:
            raise ValueError('Archive exceeds entry budget')
        seen = set()
        found = set()
        pending_links = []
        total_read = 0
        for member in members:
            name = member.filename if windows else member.name
            parts = _parts(name)
            canonical = '/'.join(parts)
            identity = canonical.casefold() if windows else canonical
            if parts[0] != basename or identity in seen:
                raise ValueError('Unexpected prefix or duplicate archive member')
            seen.add(identity)
            is_directory = member.is_dir() if windows else member.isdir()
            if is_directory:
                if canonical in expected or not any(key.startswith(canonical + '/') for key in expected):
                    raise ValueError('Unexpected archive directory')
                continue
            if canonical not in expected:
                raise ValueError('Archive contains an unvalidated file')
            metadata = expected[canonical]
            found.add(canonical)
            target = root.joinpath(*parts[1:])
            if not target.resolve().is_relative_to(root.resolve()):
                raise ValueError('Archive path escapes portable root')
            is_link = not windows and member.issym()
            if 'link' in metadata:
                if not is_link or member.linkname != metadata['link']:
                    raise ValueError('Archive link does not match validated inventory')
                pending_links.append((target, member.linkname))
                continue
            if not windows and not member.isfile():
                # Hardlinks, device nodes, FIFOs and sparse pseudo-files are not part of this format.
                raise ValueError('Unsupported archive entry type')
            if windows and (member.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Unexpected ZIP symlink')
            size = member.file_size if windows else member.size
            if size != metadata['bytes'] or (not windows and member.sparse is not None):
                raise ValueError('Archive file length or sparse metadata mismatch')
            target.parent.mkdir(parents=True, exist_ok=True)
            stream = archive.open(member) if windows else archive.extractfile(member)
            if stream is None:
                raise ValueError('Missing archive file data')
            digest = hashlib.sha256()
            count = 0
            with stream, target.open('xb') as output:
                while True:
                    chunk = stream.read(min(1024 * 1024, size - count + 1))
                    if not chunk:
                        break
                    count += len(chunk)
                    total_read += len(chunk)
                    if count > size or total_read > MAX_BYTES:
                        raise ValueError('Archive expands beyond validated lengths')
                    digest.update(chunk)
                    output.write(chunk)
            if count != size or digest.hexdigest() != metadata['sha256']:
                raise ValueError('Archive file bytes differ from tested build')
            if not windows:
                target.chmod(member.mode & 0o777)
        if found != set(expected):
            raise ValueError('Archive omits validated files')
        # Never create symlinks before writing regular files: an archive cannot use
        # an earlier link as a parent of a subsequent file write.
        for target, link in pending_links:
            target.parent.mkdir(parents=True, exist_ok=True)
            os.symlink(link, target)
        for target, _ in pending_links:
            if not target.resolve(strict=True).is_relative_to(root.resolve()):
                raise ValueError('Broken, cyclic or escaping portable symlink')
    return root
