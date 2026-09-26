import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  client: vi.fn(),
  track: vi.fn(),
  flush: vi.fn(),
  settings: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@segment/analytics-node', () => ({
  Analytics: spies.client.mockImplementation(function () {
    return { track: spies.track, closeAndFlush: spies.flush };
  }),
}));

vi.mock('./db/adapters/ne-db-adapter', () => ({ default: spies.settings }));

describe('offline CLI analytics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('INSO_TELEMETRY_DISABLED', '');
    vi.stubGlobal('fetch', spies.fetch);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('imports without creating a telemetry client or reading desktop settings', async () => {
    await import('./analytics');
    expect(spies.client).not.toHaveBeenCalled();
    expect(spies.settings).not.toHaveBeenCalled();
    expect(spies.fetch).not.toHaveBeenCalled();
  });

  it('never sends events even with production defaults and repeated calls', async () => {
    const { trackInsoEvent, InsoEvent } = await import('./analytics');
    await trackInsoEvent(InsoEvent.lintSpec, { sensitive: 'must stay local' });
    await trackInsoEvent(InsoEvent.exportSpec);
    expect(spies.client).not.toHaveBeenCalled();
    expect(spies.track).not.toHaveBeenCalled();
    expect(spies.settings).not.toHaveBeenCalled();
    expect(spies.fetch).not.toHaveBeenCalled();
  });

  it('flush resolves without starting a network request or shutdown timer', async () => {
    const { flushAnalytics } = await import('./analytics');
    await expect(flushAnalytics()).resolves.toBeUndefined();
    expect(spies.client).not.toHaveBeenCalled();
    expect(spies.flush).not.toHaveBeenCalled();
    expect(spies.fetch).not.toHaveBeenCalled();
  });

  it('does not reinterpret an environment value as permission to enable telemetry', async () => {
    vi.stubEnv('INSO_TELEMETRY_DISABLED', 'false');
    const { trackInsoEvent, flushAnalytics, InsoEvent } = await import('./analytics');
    await trackInsoEvent(InsoEvent.lintSpec);
    await flushAnalytics();
    expect(spies.client).not.toHaveBeenCalled();
    expect(spies.track).not.toHaveBeenCalled();
    expect(spies.flush).not.toHaveBeenCalled();
    expect(spies.settings).not.toHaveBeenCalled();
  });
});
