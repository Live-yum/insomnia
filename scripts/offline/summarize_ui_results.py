"""Read-only bounded JUnit aggregation; missing or failed shards cannot pass."""
import html
import json
import os
from pathlib import Path
import re
import xml.etree.ElementTree as ET


def summarize(root, run_number, build_result, test_result, shards=6):
    failures, diagnostics, present = [], [], []
    total = skipped = 0
    for index in range(1, shards + 1):
        file = Path(root) / f'junit-results-{run_number}-shard-{index}' / 'test-results.xml'
        if not file.is_file() or file.is_symlink() or file.stat().st_size > 20 * 1024 * 1024:
            diagnostics.append(f'Shard {index}: missing, linked or oversized report')
            continue
        raw = file.read_bytes()
        if b'\0' in raw or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
            diagnostics.append(f'Shard {index}: disallowed XML encoding or entity declaration')
            continue
        try:
            cases = list(ET.fromstring(raw.decode('utf-8-sig')).iter('testcase'))
        except (ValueError, UnicodeError, ET.ParseError):
            diagnostics.append(f'Shard {index}: malformed UTF-8 XML')
            continue
        if not cases or len(cases) > 10000:
            diagnostics.append(f'Shard {index}: missing or excessive case records')
            continue
        present.append(index)
        total += len(cases)
        for case in cases:
            skipped += int(case.find('skipped') is not None)
            for failure in list(case.findall('failure')) + list(case.findall('error')):
                message = re.sub(r'\x1b\[[0-9;]*m', '', failure.text or failure.get('message', ''))
                message = ''.join(c for c in message if c in '\n\t' or ord(c) >= 32)
                failures.append({'shard': index, 'name': case.get('name', '')[:500],
                                 'file': case.get('classname', '')[:300], 'message': message[:4000]})
    passed = (build_result == test_result == 'success' and present == list(range(1, shards + 1))
              and total > skipped and not failures and not diagnostics)
    return {'status': 'passed' if passed else 'failed', 'cases': total, 'skipped': skipped,
            'reports': present, 'failures': failures, 'diagnostics': diagnostics,
            'buildResult': build_result, 'testResult': test_result}


def main():
    number = os.environ['GITHUB_RUN_NUMBER']
    if not number.isdecimal():
        raise ValueError('Invalid run number')
    report = summarize('junit-input', number, os.environ['BUILD_RESULT'], os.environ['TEST_RESULT'])
    print(json.dumps(report, ensure_ascii=False), flush=True)
    summary = (f"## Full UI results\n\n{report['cases']} cases; {len(report['failures'])} failures; "
               f"{report['skipped']} existing skipped cases; {len(report['reports'])}/6 reports.\n\n"
               'Missing, skipped, failed or cancelled jobs are never accepted as successful validation.\n\n')
    for item in report['diagnostics']:
        summary += html.escape(item) + '\n\n'
    for failure in report['failures']:
        part = f"### Shard {failure['shard']}: {html.escape(failure['name'])}\n\n<pre>{html.escape(failure['message'])}</pre>\n\n"
        if len((summary + part).encode('utf-8')) > 60000:
            summary += 'Further details are retained in the per-shard JUnit and trace artifacts.\n'
            break
        summary += part
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as stream:
        stream.write(summary)
    raise SystemExit(0 if report['status'] == 'passed' else 1)


if __name__ == '__main__':
    main()
