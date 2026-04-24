import { test, expect } from '@playwright/test';

test('card page shows EN + JA primary prints by default, with expander for rest', async ({ page }) => {
  await page.goto('card/base1-4');
  await expect(page.locator('h1')).toHaveText('Charizard');

  const gallery = page.locator('.print-gallery');
  const primary = gallery.locator('[data-print-row="primary"] .primary-print');
  await expect(primary).toHaveCount(2);
  await expect(primary.locator('.lang-label')).toHaveText(['EN', 'JA']);
  await expect(primary).toContainText(['Charizard', 'リザードン']);

  // Expander collapsed by default — secondary prints present in DOM but inside <details>.
  // With 11 total languages in fixture, 9 are "other" (5 European + 4 Asian).
  const summary = gallery.locator('[data-other-toggle]');
  await expect(summary).toContainText(/Show 9 other languages/);
});

test('expanding "other languages" reveals European and Asian groups', async ({ page }) => {
  await page.goto('card/base1-4');
  await page.locator('[data-other-toggle]').click();

  const european = page.locator('[data-print-row="european"] .secondary-print');
  await expect(european).toHaveCount(5);
  await expect(european.locator('.lang-label')).toHaveText(['FR', 'DE', 'IT', 'ES', 'PT']);
  await expect(european).toContainText(['Dracaufeu', 'Glurak']);

  const asian = page.locator('[data-print-row="asian"] .secondary-print');
  await expect(asian).toHaveCount(4);
  await expect(asian.locator('.lang-label')).toHaveText(['ZH-TW', 'ZH-CN', 'TH', 'ID']);
  await expect(asian).toContainText(['噴火龍', '喷火龙']);
});

test('card with only one print shows just that print and no expander', async ({ page }) => {
  await page.goto('card/base1-2');
  await expect(page.locator('h1')).toHaveText('Blastoise');
  await expect(page.locator('.primary-print')).toHaveCount(1);
  await expect(page.locator('[data-other-toggle]')).toHaveCount(0);
});

test('card page set line links to /set/[setId]/', async ({ page }) => {
  await page.goto('card/base1-4');
  const setLink = page.locator('aside a[href*="/set/"]').first();
  await expect(setLink).toHaveAttribute('href', /\/pokemon-tcg\/set\/base1\/$/);
  await expect(setLink).toHaveText('Base'); // fixture set name
});

test('card page "Add to my cards" button adds to portfolio', async ({ page }) => {
  await page.addInitScript(() => {
    // Pin display currency for locale determinism. (Re-runs on every nav; harmless.)
    localStorage.setItem('pokemon-tcg-currency', 'GBP');
  });
  await page.goto('card/base1-4');
  // Clear the portfolio ONCE, AFTER the first navigation. Subsequent reloads
  // will NOT re-clear (addInitScript no longer touches this key).
  await page.evaluate(() => localStorage.removeItem('pokemon-tcg:portfolio'));
  // We need the cleared state to take effect on the page — reload once.
  await page.reload();

  const wrapper = page.locator('.portfolio-add-btn');
  await expect(wrapper).toBeVisible();
  await expect(wrapper).toHaveText(/Add to my cards/);

  await wrapper.locator('button').click();
  await page.locator('.portfolio-add-btn input[name=qty]').fill('1');
  await page.locator('.portfolio-add-btn input[name=cost]').fill('100');
  await page.locator('.portfolio-add-btn button[data-action=save]').click();

  // Transient "✓ Added (×1) — Undo" shows for 5 seconds after Save.
  await expect(page.locator('.portfolio-add-btn')).toContainText(/Added/);
  await expect(page.locator('.portfolio-add-btn [data-action=undo]')).toBeVisible();

  // Reload — transient is cleared (it's in-memory only); button settles into
  // the persistent "Owned (×1) — Update" state via localStorage hydration.
  await page.reload();
  await expect(page.locator('.portfolio-add-btn')).toContainText(/Owned/);
});

test('card page "Undo" reverts a fresh add', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pokemon-tcg-currency', 'GBP');
  });
  await page.goto('card/base1-4');
  await page.evaluate(() => localStorage.removeItem('pokemon-tcg:portfolio'));
  await page.reload();

  // Fresh add.
  await page.locator('.portfolio-add-btn button').click();
  await page.locator('.portfolio-add-btn input[name=qty]').fill('1');
  await page.locator('.portfolio-add-btn input[name=cost]').fill('100');
  await page.locator('.portfolio-add-btn button[data-action=save]').click();

  // Transient state appears.
  await expect(page.locator('.portfolio-add-btn')).toContainText(/Added/);

  // Click Undo — should remove the entry and return to "+ Add to my cards".
  await page.locator('.portfolio-add-btn [data-action=undo]').click();
  await expect(page.locator('.portfolio-add-btn')).toContainText(/Add to my cards/);

  // Verify localStorage was actually cleared — reload and confirm.
  await page.reload();
  await expect(page.locator('.portfolio-add-btn')).toContainText(/Add to my cards/);
});
