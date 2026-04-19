import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:4321/pokemon-tcg/',
  },
  webServer: {
    command: 'npm run build:fixtures && npm run preview',
    url: 'http://localhost:4321/pokemon-tcg/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
