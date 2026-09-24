import type { AnalyticsEvent } from 'insomnia-analytics';

export { AnalyticsEvent } from 'insomnia-analytics';

// Intentionally no analytics client, identifiers, queue, timers, disk spool or transport.
export function setCurrentOrganizationId(_id: string | undefined): void {}
export async function trackAnalyticsEvent(_event: AnalyticsEvent, _properties?: Record<string, unknown>): Promise<void> {}
export async function trackPageView(_name: string): Promise<void> {}
