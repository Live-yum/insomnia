"""Preserve local migration ordering and explicitly model its test boundary."""
from pathlib import Path

root = Path(__file__).resolve().parents[2]
file = root / 'packages/insomnia/src/ui/utils/router.ts'
text = file.read_text(encoding='utf-8')
before = ').map(p => p.gitRepositoryId);'
after = ').map(p => models.project.decodeRepoId(p.gitRepositoryId));'
assert text.count(before) == 1
text = text.replace(before, after)
before = "  } catch {\n    return href('/organization/:organizationId/project/:projectId/workspace/:workspaceId/debug', {"
after = "  } catch (error) {\n    if (OFFLINE_BUILD) {\n      throw new Error('Unable to prepare local offline projects', { cause: error });\n    }\n    return href('/organization/:organizationId/project/:projectId/workspace/:workspaceId/debug', {"
assert text.count(before) == 1
file.write_text(text.replace(before, after), encoding='utf-8', newline='\n')
file = root / 'packages/insomnia/src/ui/utils/router-offline.test.ts'
text = file.read_text(encoding='utf-8')
for method in ('update', 'get'):
    before = f'services.project.{method}.mock.invocationCallOrder'
    assert text.count(before) == 1
    text = text.replace(before, f'vi.mocked(services.project.{method}).mock.invocationCallOrder')
file.write_text(text, encoding='utf-8', newline='\n')
