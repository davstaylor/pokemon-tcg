import { test, expect } from '@playwright/test';

test('home page renders hero and featured grid', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('h1')).toHaveText('Pokémon TCG Catalog');
  await expect(page.locator('.grid .card-tile')).toHaveCount(2); // fixtures have 2 cards
});

test('footer shows TCGdex credit and build timestamp', async ({ page }) => {
  await page.goto('./');
  const footer = page.locator('footer.disclaimer');
  await expect(footer).toContainText('TCGdex');
  await expect(footer).toContainText('© The Pokémon Company');
  await expect(footer.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
});

test('home page has a Browse all sets link', async ({ page }) => {
  await page.goto('./');
  const link = page.locator('a', { hasText: /Browse all sets/i });
  await expect(link).toHaveAttribute('href', /\/pokemon-tcg\/sets\/$/);
});

test('home page has a See hot cards link', async ({ page }) => {
  await page.goto('./');
  const link = page.locator('a', { hasText: /See hot cards/i });
  await expect(link).toHaveAttribute('href', /\/pokemon-tcg\/hot\/$/);
});

test('home page has a My portfolio link', async ({ page }) => {
  await page.goto('./');
  const link = page.locator('a', { hasText: /My portfolio/i });
  await expect(link).toHaveAttribute('href', /\/pokemon-tcg\/portfolio\/$/);
});
