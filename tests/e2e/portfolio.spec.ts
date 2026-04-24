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

test('summary dashboard shows 4 stats when portfolio has entries', async ({ page }) => {
  // Seed a GBP portfolio of 1 Charizard at £300.
  await page.addInitScript(() => {
    localStorage.setItem('pokemon-tcg:portfolio', JSON.stringify({
      version: 1,
      entries: [
        { cardId: 'base1-4', qty: 1, costValue: 300, costCurrency: 'GBP', addedAt: '2026-04-20' },
      ],
    }));
    // Pin the display currency so the test is deterministic across locales
    // (otherwise CurrencySelect's locale inference may default to USD on en-US runners).
    localStorage.setItem('pokemon-tcg-currency', 'GBP');
  });
  await page.goto('portfolio/');
  // Summary card renders once the sparkline-dump fetch resolves.
  const stat = page.locator('.portfolio-stats');
  await expect(stat).toBeVisible();
  await expect(stat.locator('[data-stat="cards"]')).toHaveText('1');
  // Fixture puts base1-4 at €360 today. Converted to GBP at the stubbed
  // exchange-rates.json (lives alongside the cards build), the displayed
  // value will be close to but not exactly 300. Assert it's present and > 0.
  await expect(stat.locator('[data-stat="paid"]')).toContainText(/£\s*300/);
  await expect(stat.locator('[data-stat="value"]')).toContainText(/£\s*\d+/);
  await expect(stat.locator('[data-stat="pnl"]')).toContainText(/[+−]£\s*\d+/);
});
