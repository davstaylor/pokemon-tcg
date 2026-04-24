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
    localStorage.removeItem('pokemon-tcg:portfolio');
    // Pin display currency for locale determinism.
    localStorage.setItem('pokemon-tcg-currency', 'GBP');
  });
  await page.goto('card/base1-4');
  const button = page.locator('.portfolio-add-btn');
  await expect(button).toBeVisible();
  await expect(button).toHaveText(/Add to my cards/);

  await button.click();
  await page.locator('.portfolio-add-btn input[name=qty]').fill('1');
  await page.locator('.portfolio-add-btn input[name=cost]').fill('100');
  await page.locator('.portfolio-add-btn button[data-action=save]').click();

  // Button transforms to "Owned" state.
  await expect(page.locator('.portfolio-add-btn')).toContainText(/Owned/);

  // Reload — state persists via localStorage.
  await page.reload();
  await expect(page.locator('.portfolio-add-btn')).toContainText(/Owned/);
});
