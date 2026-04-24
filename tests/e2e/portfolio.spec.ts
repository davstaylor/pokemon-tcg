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

test('trend chart renders an SVG polyline for a non-empty portfolio', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pokemon-tcg:portfolio', JSON.stringify({
      version: 1,
      entries: [{ cardId: 'base1-4', qty: 1, costValue: 300, costCurrency: 'GBP', addedAt: '2026-04-20' }],
    }));
    // Seed display currency for locale determinism (CurrencySelect would otherwise infer USD on en-US runners)
    localStorage.setItem('pokemon-tcg-currency', 'GBP');
  });
  await page.goto('portfolio/');
  const chart = page.locator('.portfolio-trend svg polyline');
  await expect(chart).toBeVisible();
  const points = await chart.getAttribute('points');
  expect(points).toBeTruthy();
  expect(points!.split(' ').length).toBeGreaterThanOrEqual(2);
});

test('autocomplete adds a card to the portfolio', async ({ page }) => {
  await page.addInitScript(() => {
    // Pin display currency for locale determinism.
    localStorage.setItem('pokemon-tcg-currency', 'GBP');
  });
  await page.goto('portfolio/');
  // Empty state: the form should still render even without entries.
  const search = page.locator('.portfolio-add input[type=search]');
  await expect(search).toBeVisible();
  await search.fill('Charizard');

  // Pick the first dropdown result (base1-4).
  const firstResult = page.locator('.portfolio-add .suggestions li').first();
  await expect(firstResult).toBeVisible();
  await firstResult.click();

  // Qty auto-focused — fill qty + cost and click Add.
  await page.locator('.portfolio-add input[name=qty]').fill('2');
  await page.locator('.portfolio-add input[name=cost]').fill('150');
  await page.locator('.portfolio-add button[data-action=add]').click();

  // Summary updates.
  const stats = page.locator('.portfolio-stats');
  await expect(stats.locator('[data-stat=cards]')).toHaveText('2');
  await expect(stats.locator('[data-stat=paid]')).toContainText(/£\s*150/);
});

test('holdings table supports inline edit + remove', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pokemon-tcg:portfolio', JSON.stringify({
      version: 1,
      entries: [{ cardId: 'base1-4', qty: 1, costValue: 100, costCurrency: 'GBP', addedAt: '2026-04-20' }],
    }));
    // Pin the display currency for locale determinism.
    localStorage.setItem('pokemon-tcg-currency', 'GBP');
  });
  await page.goto('portfolio/');
  const row = page.locator('.portfolio-table tbody tr').first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('Charizard');
  await expect(row).toContainText('Base');

  // Edit qty: 1 → 3.
  const qtyInput = row.locator('input[name=qty]');
  await qtyInput.fill('3');
  await qtyInput.blur();
  await expect(page.locator('.portfolio-stats [data-stat=cards]')).toHaveText('3');

  // Remove the row.
  await row.locator('button[data-action=remove]').click();
  await expect(page.locator('.portfolio-empty')).toBeVisible();
});

test('import JSON replaces the portfolio', async ({ page }) => {
  await page.addInitScript(() => {
    // Pin display currency for locale determinism.
    localStorage.setItem('pokemon-tcg-currency', 'GBP');
  });
  await page.goto('portfolio/');
  await page.locator('button[data-action=import]').click();
  const payload = JSON.stringify({
    version: 1,
    entries: [
      { cardId: 'base1-4', qty: 1, costValue: 200, costCurrency: 'GBP', addedAt: '2026-04-22' },
      { cardId: 'base1-2', qty: 2, costValue: 40, costCurrency: 'GBP', addedAt: '2026-04-22' },
    ],
  });
  await page.locator('.portfolio-import-modal textarea').fill(payload);
  await page.locator('.portfolio-import-modal button[data-action=replace]').click();
  await expect(page.locator('.portfolio-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.portfolio-stats [data-stat=cards]')).toHaveText('3');  // 1 + 2
});

test('autocomplete with already-owned card switches to Update mode', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pokemon-tcg-currency', 'GBP');
    localStorage.setItem('pokemon-tcg:portfolio', JSON.stringify({
      version: 1,
      entries: [{ cardId: 'base1-4', qty: 2, costValue: 200, costCurrency: 'GBP', addedAt: '2026-04-20' }],
    }));
  });
  await page.goto('portfolio/');
  await page.locator('.portfolio-add input[type=search]').fill('Charizard');
  await page.locator('.portfolio-add .suggestions li').first().click();

  // Qty and cost should be pre-filled from the existing entry.
  await expect(page.locator('.portfolio-add input[name=qty]')).toHaveValue('2');
  await expect(page.locator('.portfolio-add input[name=cost]')).toHaveValue('200');
  // Button text changes.
  await expect(page.locator('.portfolio-add button[data-action=add]')).toHaveText(/Update/i);

  // Edit cost to 500 and save.
  await page.locator('.portfolio-add input[name=cost]').fill('500');
  await page.locator('.portfolio-add button[data-action=add]').click();

  // Still 1 row (not 2), with the new cost — NOT sum of old and new.
  await expect(page.locator('.portfolio-table tbody tr')).toHaveCount(1);
  // Cost input in the table shows 500.
  await expect(page.locator('.portfolio-table tbody tr input[name=cost]').first()).toHaveValue('500');
});
