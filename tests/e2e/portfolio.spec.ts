import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sparklineFixtureJson = readFileSync(
  resolve(process.cwd(), 'data/fixtures/sample-sparkline.json'),
  'utf8',
);

test.beforeEach(async ({ page }) => {
  // Clean slate: empty portfolio + empty sparkline cache on every visit.
  await page.addInitScript(() => {
    localStorage.removeItem('pokemon-tcg:portfolio');
    localStorage.removeItem('pokemon-tcg:sparkline-cache');
  });
  // Intercept the Worker's sparkline-dump fetch with the fixture JSON so
  // tests are deterministic and offline-friendly.
  await page.route('**/sparkline-dump', (route) =>
    route.fulfill({ contentType: 'application/json', body: sparklineFixtureJson }),
  );
});

test('/portfolio/ renders the empty-state welcome when localStorage is empty', async ({ page }) => {
  await page.goto('portfolio/');
  await expect(page.locator('h1')).toHaveText('My portfolio');
  await expect(page.locator('.portfolio-empty')).toBeVisible();
  await expect(page.locator('.portfolio-empty')).toContainText(/haven't added any cards/i);
});
