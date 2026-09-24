// No Customer.io SDK, remote script, iframe, identify call, or event queue.
export function trackCioEvent(_event: string, _properties?: Record<string, unknown>): void {}
export const useCio = () => {};
