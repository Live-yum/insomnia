import { InsoEvent } from 'insomnia-analytics';

export { InsoEvent };

// This fork is offline-only. Keep the public API for CLI callers, but never
// construct a telemetry client, read desktop settings, create an anonymous ID,
// enqueue events or start a network flush. Environment variables cannot opt in.
export const trackInsoEvent = async (_event: InsoEvent, _properties?: Record<string, unknown>): Promise<void> => {
  return;
};

export const flushAnalytics = async (): Promise<void> => {
  return;
};
