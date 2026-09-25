#!/usr/bin/env python3
"""Verify inert portable artifacts for a separately labelled branch preview.

Does not execute the application, plugins, dependency scripts, or archive members.
The post-merge release workflow retains its independent merge and rebuild gates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

REPO = 'Live-yum/insomnia'
TARGETS = {'win32-x64': '.zip', 'linux-arm64': '.tar.gz'}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256(file: Path) -> str:
    require(file.is_file() and not file.is_symlink(), 'Expected a regular file: ' + str(file))
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read_json(file: Path):
    return json.loads(file.read_text(encoding='utf-8-sig'))


def gh_json(endpoint: str):
    return json.loads(subprocess.check_output(['gh', 'api', endpoint], text=True))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--run-id', type=int, required=True)
    args = parser.parse_args()
    require(bool(re.fullmatch(r'[0-9a-f]{40}', args.source_sha)), 'Use an exact source SHA')
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=args.source, text=True).strip()
    require(actual == args.source_sha, 'Source checkout mismatch')
    run = gh_json(f'repos/{REPO}/actions/runs/{args.run_id}')
    require(run['repository']['full_name'] == REPO and run['head_repository']['full_name'] == REPO, 'Wrong validation repository')
    require(run['head_branch'] == 'offline/standalone-vendored', 'Wrong validation branch')
    require(run['path'] == '.github/workflows/offline-ci-repair.yml', 'Require the full-suite/native validation workflow')
    require(run['status'] == 'completed' and run['conclusion'] == 'success', 'Validation workflow is not fully successful')
    job_data = gh_json(f'repos/{REPO}/actions/runs/{args.run_id}/jobs?filter=latest&per_page=100')
    jobs = job_data['jobs']
    require(job_data['total_count'] == len(jobs) == 4, 'Require prepare, commit and both native targets')
    require(all(job['status'] == 'completed' and job['conclusion'] == 'success' for job in jobs), 'A required job did not pass')
    by_name = {job['name']: job for job in jobs}
    require({'prepare', 'commit'} <= set(by_name), 'Missing full-suite/source-commit jobs')
    prepared_steps = {step['name']: step['conclusion'] for step in by_name['prepare']['steps']}
    for name in ['Require workspace lint without autofix', 'Require complete application and route type checks', 'Compile the real application source', 'Require the full workspace unit suite', 'Require archive safety regressions and byte integrity']:
        require(prepared_steps.get(name) == 'success', 'Missing successful quality gate: ' + name)
    # The prepared patch was committed before the native jobs. All native
    # reports below must identify that resulting exact commit, not run.head_sha.
    for target, step_name in [
        ('win32-x64', 'Final Windows wrapper normal start with application outbound traffic blocked'),
        ('linux-arm64', 'Fresh-profile Linux UI and plugin validation with sandbox and no external network'),
    ]:
        native = [job for job in jobs if target in job['name']]
        require(len(native) == 1, 'Missing or ambiguous native job: ' + target)
        steps = {step['name']: step['conclusion'] for step in native[0]['steps']}
        require(steps.get(step_name) == 'success', 'Missing final native startup gate: ' + target)
    vendor = args.source / 'vendor/offline-plugins'
    manifest = read_json(vendor / 'manifest.json')
    complete = sum(entry['status'] == 'dependency-complete-unreviewed' for entry in manifest['entries'])
    require(len(manifest['entries']) == 552 and complete == 545, 'Unexpected snapshot; review counts before publishing')
    require(not args.output.exists(), 'Use a fresh release asset directory')
    args.output.mkdir(parents=True)
    expected_names = set()
    archives = []
    incompatible = {}
    for target, extension in TARGETS.items():
        basename = 'Insomnia-Offline-' + target + '-portable' + extension
        names = [basename, basename + '.sha256', 'offline-smoke-report-' + target + '.json', 'offline-resource-integrity-' + target + '.json']
        if target == 'win32-x64':
            names.append('offline-wrapper-report-win32-x64.json')
        expected_names.update(names)
        selected = {}
        for name in names:
            matches = list(args.assets.rglob(name))
            require(len(matches) == 1, 'Missing/duplicate release asset: ' + name)
            selected[name] = matches[0]
        archive = selected[basename]
        size = archive.stat().st_size
        require(0 < size < 2 * 1024**3, 'Release archive must be nonempty and below the GitHub per-file limit: ' + basename)
        digest = sha256(archive)
        checksum = selected[basename + '.sha256'].read_text(encoding='utf-8').strip()
        require(checksum == digest + '  ' + basename, 'Archive checksum/name mismatch: ' + basename)
        smoke = read_json(selected['offline-smoke-report-' + target + '.json'])
        integrity = read_json(selected['offline-resource-integrity-' + target + '.json'])
        for report in (smoke, integrity):
            require(report['sourceCommit'] == args.source_sha and report['target'] == target, 'Report source or target mismatch')
            require(report['catalogEntries'] == 552 and report['materializedPlugins'] == 545, 'Partial catalog in release output')
        require(integrity['allSourceFilesPreserved'] is True and integrity['pluginCodeExecuted'] is False, 'Resource byte-preservation failed')
        for flag in ['passed', 'defaultDisabled', 'liveLoopbackControlPassed', 'chromiumSandboxEnabled']:
            require(smoke.get(flag) is True, 'Required packaged smoke assertion missing: ' + flag)
        security = smoke['rendererSecurity']
        require(security['nodeIntegration'] is False and security['nodeIntegrationInWorker'] is False, 'Renderer Node integration must remain disabled')
        require(security['contextIsolation'] is True and security['sandbox'] is True and security['noSandboxArgument'] is False, 'Renderer isolation/sandbox must remain enabled')
        incompatible[target] = smoke['incompatibleManifests']
        if target == 'win32-x64':
            wrapper = read_json(selected['offline-wrapper-report-win32-x64.json'])
            require(wrapper['sourceCommit'] == args.source_sha and wrapper['target'] == target, 'Wrapper provenance mismatch')
            require(wrapper['passed'] is True and wrapper['applicationOutboundBlocked'] is True, 'Final wrapper normal-start test did not pass')
            require(wrapper['debuggerArguments'] is False and wrapper['sandboxDisabledArgument'] is False, 'Final wrapper test used unsafe flags')
            require(wrapper['electronImageSha256'] == smoke['electronImageSha256'], 'Wrapped Electron image differs from UI-tested image')
        for name, file in selected.items():
            require(file.is_file() and not file.is_symlink(), 'Non-regular release asset')
            shutil.copy2(file, args.output / name)
        archives.append({'name': basename, 'target': target, 'bytes': size, 'sha256': digest})
    actual_names = {file.name for file in args.assets.rglob('*') if file.is_file()}
    require(actual_names == expected_names, 'Unexpected input artifacts: ' + repr(actual_names - expected_names))
    for source_name, output_name in [('EXCEPTIONS.json', 'PLUGIN-EXCEPTIONS.json'), ('REPORT.md', 'PLUGIN-CATALOG.md')]:
        shutil.copy2(vendor / source_name, args.output / output_name)
    (args.output / 'PLUGIN-HOST-COMPATIBILITY.json').write_text(json.dumps(incompatible, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    info = {
        'sourceCommit': args.source_sha,
        'validationRun': args.run_id,
        'validationWorkflowCommit': run['head_sha'],
        'validationUrl': run['html_url'],
        'catalogEntries': 552,
        'materializedProfiles': 545,
        'catalogExceptions': 7,
        'archives': archives,
        'jobs': [{'name': job['name'], 'conclusion': job['conclusion'], 'url': job['html_url']} for job in jobs],
        'allPluginFunctionsValidated': False,
        'siteSpecificEgressCertified': False,
        'codeSigned': False,
        'releaseKind': 'unmerged-branch-portable-preview',
    }
    (args.output / 'BUILD-INFO.json').write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    instructions = '''# 全目录离线便携版使用说明

这是可运行程序候选版，不是源码压缩包；无需在目标机器安装 Node、npm 或联网下载插件。

Windows x64：完整解压 Insomnia-Offline-win32-x64-portable.zip，运行 Start-Insomnia-Offline.cmd。
Linux ARM64：完整解压 Insomnia-Offline-linux-arm64-portable.tar.gz，以普通桌面用户运行 ./start-insomnia-offline.sh。
两平台都从随附启动器启动，数据写在便携目录的 data/。升级前关闭程序并备份 data/，不要把真实数据提交到公开仓库。

Linux 需要兼容的 glibc、GTK/NSS/音频等图形系统库、可用桌面会话及系统允许的 Chromium 沙箱。
不使用 --no-sandbox、不关闭 TLS 校验。若系统禁用了用户命名空间，应由管理员按系统政策配置可信的 chrome-sandbox 帮助程序，而非关闭沙箱。

552 是本次公开目录条目数；545 个完整依赖资料随包预置，7 项例外见 PLUGIN-EXCEPTIONS.json。
另有缺少宿主元数据的条目见 PLUGIN-HOST-COMPATIBILITY.json。依赖齐全不等于所有功能已通过验证。
未审核插件默认禁用；在 Preferences → Plugins 中逐项审核后启用。云服务、平台原生依赖及旧插件宿主 API 仍有各自限制。

运行时使用测试已覆盖：全工作区单元测试、原生构建、真实本地界面、插件发现、字节保真、Chromium 沙箱。
Linux 启动测试无外部网络；Windows 另有最终安全启动器阻断应用出站的普通启动测试。二者不是生产内网的全进程树安全认证。
本候选版未代码签名、未宣布全部第三方插件功能兼容。核对归档 .sha256 或 SHA256SUMS 后使用。
PR 合并仍需独立审核；此预览发行不等于 PR 已经合并，也不替代合并后的发布工作流。
'''
    (args.output / 'INSTALL.zh-CN.md').write_text(instructions, encoding='utf-8')
    notes = '# Windows x64 / Linux ARM64 — 全目录离线便携候选版\n\n'
    notes += f'实际源码：`{args.source_sha}`。完整质量与原生验证：{run["html_url"]}\n\n'
    notes += '两个可直接解压运行的完整应用包均附带本地插件资料、SHA-256 和验证报告，不是只有源码或下载脚本。\n\n'
    notes += '| 平台 | 文件 | 字节数 | SHA-256 |\n|---|---|---:|---|\n'
    for archive in archives:
        notes += f'| {archive["target"]} | `{archive["name"]}` | {archive["bytes"]} | `{archive["sha256"]}` |\n'
    notes += '\nWindows 启动 `Start-Insomnia-Offline.cmd`；Linux ARM64 启动 `./start-insomnia-offline.sh`。详情见 INSTALL.zh-CN.md。\n\n'
    notes += '**边界说明：** 552 条目录全部记录、545 个完整依赖资料预置、7 个已列明例外。未审核插件默认禁用，云集成不变成本地服务；不是全部第三方插件功能或生产内网出口认证。程序未代码签名，本次为可下载运行的 Pre-release，PR 尚未合并。\n'
    (args.output.parent / 'release-notes.md').write_text(notes, encoding='utf-8')
    hashes = {file.name: {'sha256': sha256(file), 'bytes': file.stat().st_size} for file in sorted(args.output.iterdir())}
    sums = ''.join(item['sha256'] + '  ' + name + '\n' for name, item in hashes.items())
    (args.output / 'SHA256SUMS').write_text(sums, encoding='utf-8')
    hashes['SHA256SUMS'] = {'sha256': sha256(args.output / 'SHA256SUMS'), 'bytes': (args.output / 'SHA256SUMS').stat().st_size}
    (args.output.parent / 'publication-manifest.json').write_text(json.dumps(hashes, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(info, indent=2), flush=True)


if __name__ == '__main__':
    main()
