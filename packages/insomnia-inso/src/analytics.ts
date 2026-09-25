import type { InsoEvent } from 'insomnia-analytics/events';

export { InsoEvent } from 'insomnia-analytics/events';

/** Offline CLI: never initialize a telemetry client, identifier, queue or timer. */
export const trackInsoEvent = async (_event: InsoEvent, _properties?: Record<string, unknown>): Promise<void> => {};

/** Retained for CLI call-site compatibility; there is no telemetry queue to flush. */
export const flushAnalytics = async (): Promise<void> => {};
