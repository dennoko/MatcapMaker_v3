import { defineConfig } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const singleURL = pathToFileURL(resolve('dist-single/MatcapMaker.html')).href;

export default defineConfig({
  testDir: 'tests/golden',
  timeout: 120_000,
  projects: [
    { name: 'dev', testIgnore: /single\.spec\.ts/, metadata: { appURL: '/' } },
    { name: 'single', testIgnore: /render\.spec\.ts/, metadata: { appURL: singleURL } },
    ...(process.env.CROSS_BROWSER ? ['firefox', 'webkit'].map((browserName) => ({
      name: browserName,
      testMatch: /single\.spec\.ts/,
      grep: /portable PNG/,
      metadata: { appURL: singleURL },
      use: { browserName: browserName as 'firefox' | 'webkit', launchOptions: {} },
    })) : []),
  ],
  use: {
    browserName: 'chromium',
    baseURL: 'http://localhost:1430',
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'pnpm vite --port 1430 --strictPort',
    url: 'http://localhost:1430/tests/golden/harness.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
