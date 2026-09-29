import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/golden',
  timeout: 120_000,
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
