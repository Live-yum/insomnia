import { afterEach, describe, expect, it, vi } from 'vitest';

const { initializeClient, readSettings } = vi.hoisted(() => ({
  initializeClient: vi.fn(() => { throw new Error('Offline telemetry must not initialize'); }),
  readSettings: vi.fn(() => { throw new Error('Offline telemetry must not read user data'); }),
}));

vi.mock('@segment/analytics-node', () => ({ Analytics: initializeClient }));
vi.mock('./db/adapters/ne-db-adapter', () => ({ default: readSettings }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('offline CLI telemetry', () => {
  it.each(['production', 'development', 'test'])('never creates a client or reads identifying data in %s', async mode => {
    vi.stubEnv('NODE_ENV', mode);
    vi.stubEnv('INSO_TELEMETRY_DISABLED', '');
    vi.resetModules();
    const { trackInsoEvent, flushAnalytics, InsoEvent } = await import('./analytics');
    await trackInsoEvent(InsoEvent.lintSpec, { sensitive: 'must-not-leave-process' });
    await trackInsoEvent(InsoEvent.exportSpec);
    await flushAnalytics();
    expect(initializeClient).not.toHaveBeenCalled();
    expect(readSettings).not.toHaveBeenCalled();
  });
});
