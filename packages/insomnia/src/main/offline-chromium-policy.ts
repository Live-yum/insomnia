/** Background browser services must not silently contact the public Internet. */
export const OFFLINE_CHROMIUM_SWITCHES = [
  'disable-background-networking',
  'disable-component-update',
  'disable-domain-reliability',
  'no-pings',
] as const;

interface CommandLinePolicyTarget {
  appendSwitch(name: string): void;
}

/** Call before Electron is ready. Never alter certificate checks or the sandbox. */
export function configureOfflineChromium(target: CommandLinePolicyTarget): void {
  for (const name of OFFLINE_CHROMIUM_SWITCHES) {
    target.appendSwitch(name);
  }
}
