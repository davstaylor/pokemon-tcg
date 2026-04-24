import { test, expect } from '@playwright/test';

test('card tiles carry a data-rarity-tier attribute', async ({ page }) => {
  await page.goto('./');
  const tiles = page.locator('.card-tile');
  await expect(tiles).toHaveCount(2);
  // Fixture cards are "Holo Rare" → foil tier.
  for (const attr of await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('data-rarity-tier')))) {
    expect(attr).toBe('foil');
  }
});

test('foil card tiles include the shimmer overlay markup', async ({ page }) => {
  await page.goto('./');
  const tile = page.locator('.card-tile').first();
  await expect(tile.locator('.shimmer-band')).toHaveCount(1);
  await expect(tile.locator('.shimmer-glow')).toHaveCount(1);
  await expect(tile.locator('.shimmer-glare')).toHaveCount(1);
});

test('hovering a card tile activates tilt; leaving deactivates it', async ({ page }) => {
  await page.goto('./');
  const tile = page.locator('.card-tile').first();
  // Initial state — attribute is "false" from the Astro markup.
  await expect(tile).toHaveAttribute('data-tilt-active', 'false');
  // Hover the tile.
  await tile.hover();
  // The script sets data-tilt-active="true" on the first mousemove.
  await expect(tile).toHaveAttribute('data-tilt-active', 'true');
  // Move somewhere else — tile resets.
  await page.locator('h1').hover();
  await expect(tile).toHaveAttribute('data-tilt-active', 'false');
});

test('card detail page shows the "View in 3D" trigger', async ({ page }) => {
  await page.goto('card/base1-4');
  const trigger = page.locator('.cl-trigger');
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText(/View in 3D/i);
});

test('clicking "View in 3D" opens the lightbox; Escape closes it', async ({ page }) => {
  await page.goto('card/base1-4');
  await page.locator('.cl-trigger').click();
  const backdrop = page.locator('.cl-backdrop');
  await expect(backdrop).toBeVisible();
  // Card image is rendered inside the lightbox.
  await expect(backdrop.locator('.cl-front img')).toBeVisible();
  // Close button reads × — dismiss via Escape instead.
  await page.keyboard.press('Escape');
  await expect(backdrop).toHaveCount(0);
});

test('lightbox flip button toggles the card back into view', async ({ page }) => {
  await page.goto('card/base1-4');
  await page.locator('.cl-trigger').click();
  // Flip button text starts as "flip"; click to reveal the back.
  const flip = page.locator('.cl-hint button', { hasText: /^flip$/i });
  await expect(flip).toBeVisible();
  await flip.click();
  // After flipping, the button's label switches to "flip back".
  await expect(page.locator('.cl-hint button', { hasText: /flip back/i })).toBeVisible();
  // The custom card back DOM renders inside the back face.
  await expect(page.locator('.cl-back .cl-back-design')).toHaveCount(1);
});
