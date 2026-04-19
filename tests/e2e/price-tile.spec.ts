import { test, expect } from '@playwright/test';

test('card page with cardmarket data renders the PriceTile with chart + delta', async ({ page }) => {
  await page.goto('card/base1-4');

  const tile = page.locator('.price-tile');
  await expect(tile).toBeVisible();

  const live = tile.locator('.live-card');
  await expect(live).toBeVisible();
  await expect(live.locator('.src-label').first()).toHaveText('Cardmarket');
  await expect(live.locator('.price-number').first()).toContainText(/€[0-9]/);

  // Chart canvas hydrates on visibility.
  const canvas = live.locator('canvas');
  await expect(canvas).toBeVisible();

  // Delta should be present with a direction indicator.
  const delta = live.locator('.delta-value');
  await expect(delta).toBeVisible();
  await expect(delta).toHaveAttribute('data-delta-direction', /(up|down|flat)/);
});

test('card page with no pricing data does not render the PriceTile', async ({ page }) => {
  await page.goto('card/base1-2');
  await expect(page.locator('.price-tile')).toHaveCount(0);
});

test('eBay placeholder is rendered alongside the live tile for v2.1 forward-compat', async ({ page }) => {
  await page.goto('card/base1-4');
  const placeholder = page.locator('.price-tile .placeholder-card');
  await expect(placeholder).toBeVisible();
  await expect(placeholder).toContainText(/awaiting v2\.1/i);
  await expect(placeholder.locator('.src-label').first()).toContainText(/eBay/i);
});
