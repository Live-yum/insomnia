import type { ElectronApplication, PlaywrightWorkerArgs } from '@playwright/test';

import { createOfflineTestProject } from './offline-project';
import { bundleType, cwd, executablePath, mainPath } from './paths';

export interface EnvOptions {
  INSOMNIA_DATA_PATH: string;
  INSOMNIA_OFFLINE_BROWSER_ORIGINS?: string;
  INSOMNIA_API_URL: string;
  INSOMNIA_APP_WEBSITE_URL: string;
  INSOMNIA_AI_URL: string;
  INSOMNIA_MOCK_API_URL: string;
  INSOMNIA_GITHUB_REST_API_URL: string;
  INSOMNIA_GITHUB_API_URL: string;
  INSOMNIA_GITLAB_API_URL: string;
  INSOMNIA_UPDATES_URL: string;
  INSOMNIA_SKIP_ONBOARDING: string;
  INSOMNIA_PUBLIC_KEY: string;
  INSOMNIA_SECRET_KEY: string;
  INSOMNIA_SESSION?: string;
  INSOMNIA_VAULT_KEY: string;
  INSOMNIA_VAULT_SALT: string;
  INSOMNIA_VAULT_SRP_SECRET: string;
  KONNECT_API_URL: string;
  KONNECT_API_REGIONS?: string;
}

/** Tracks all launched instances so fixture teardown also closes relaunched apps. */
export const liveApps = new Set<ElectronApplication>();
const preparedBuildProfiles = new Set<string>();

/** Launch the actual offline application; never simulate a vendor account. */
export async function launchInsomnia(
  playwright: PlaywrightWorkerArgs['playwright'],
  envOptions: EnvOptions,
): Promise<ElectronApplication> {
  const { INSOMNIA_DATA_PATH: dataPath, ...offlineOptions } = envOptions;
  const launchEnv: NodeJS.ProcessEnv = { ...process.env, ...offlineOptions };
  // Neither the legacy profile override nor CI credentials belong in a desktop test process.
  for (const key of ['ELECTRON_RUN_AS_NODE', 'INSOMNIA_DATA_PATH', 'GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN']) {
    delete launchEnv[key];
  }
  const app = await playwright._electron.launch({
    cwd,
    executablePath,
    args: bundleType() === 'package' ? [] : [mainPath],
    env: {
      ...launchEnv,
      INSOMNIA_OFFLINE_DATA_PATH: dataPath,
      PLAYWRIGHT: 'true',
    },
  });
  app.process().stderr?.on('data', (chunk: Buffer) => {
    console.error('[electron stderr]', chunk.toString('utf8'));
  });
  liveApps.add(app);
  app.on('close', () => liveApps.delete(app));

  try {
    // The legacy build-based smoke suite expects an initial Personal Workspace.
    // Create a real LOCAL project through the UI instead of relying on cloud login
    // side effects. Fresh-profile package tests create their own projects explicitly.
    // Prepare only once: deleting a project and relaunching must not recreate it.
    if (bundleType() === 'build' && envOptions.INSOMNIA_SKIP_ONBOARDING === 'true' && !preparedBuildProfiles.has(dataPath)) {
      const page = await app.firstWindow();
      await page.getByTestId('offline-mode').waitFor({ state: 'visible' });
      const projects = await page.evaluate(() => window._dataServicesInvoke('project', 'list'));
      if (!projects.some(project => project.parentId === 'org_offline')) {
        await createOfflineTestProject(app, page);
      }
      preparedBuildProfiles.add(dataPath);
    }
    return app;
  } catch (error) {
    await app.close().catch(() => {});
    throw error;
  }
}
