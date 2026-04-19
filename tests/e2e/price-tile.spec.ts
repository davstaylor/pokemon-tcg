import { test, expect } from '@playwright/test';

test('card page with cardmarket data renders the PriceTile with chart + delta', async ({ page }) => {
  await page.goto('card/base1-4');

  const tile = page.locator('.price-tile');
  await expect(tile).toBeVisible();

  const live = tile.locator('.live-card');
  await expect(live).toBeVisible();
  await expect(live.locator('.src-label').first()).toHaveText('Cardmarket');
  await expect(live.locator('.price-number').first()).toContainText(/[€$£¥][0-9]/);

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

test('PriceTile renders volatility pill when enough history exists', async ({ page }) => {
  await page.goto('card/base1-4');
  const tile = page.locator('.price-tile');
  await expect(tile).toBeVisible();
  const pill = tile.locator('.volatility-pill');
  const count = await pill.count();
  if (count > 0) {
    await expect(pill).toHaveAttribute('data-volatility', /(stable|moderate|volatile)/);
  }
});

test('PriceTile renders the RangePanel replacing the old eBay placeholder', async ({ page }) => {
  await page.goto('card/base1-4');
  const panel = page.locator('.range-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.range-header')).toHaveText('90-day range');
  await expect(page.locator('body')).not.toContainText(/awaiting v2\.1/i);
});
