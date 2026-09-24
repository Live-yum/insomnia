import type { AnalyticsEvent } from 'insomnia-analytics/events';

export { AnalyticsEvent } from 'insomnia-analytics/events';

// No SDK construction, persistent event queue, device identifier, or transport in this fork.
export function setCurrentOrganizationId(_id: string | undefined): void {}
export async function trackAnalyticsEvent(_event: AnalyticsEvent, _properties?: Record<string, unknown>) {}
export async function trackPageView(_name: string) {}
