import { test, expect } from '@playwright/test';

test('set page /set/base1/ renders header and card grid', async ({ page }) => {
  await page.goto('set/base1/');
  // Fixture set name is "Base" (not "Base Set") — fixture uses the abbreviation.
  await expect(page.locator('h1')).toHaveText('Base');
  await expect(page.locator('.set-header .meta')).toContainText('2 cards');
  await expect(page.locator('.card-tile')).toHaveCount(2);

  // Breadcrumb points up to the series page.
  const crumb = page.locator('.breadcrumb a');
  await expect(crumb).toHaveAttribute('href', /\/pokemon-tcg\/series\/base\/$/);
  await expect(crumb).toContainText('Base');
});

test('set page sorts cards by local id (base1-2 before base1-4)', async ({ page }) => {
  await page.goto('set/base1/');
  // Fixture has Blastoise (localId 2) and Charizard (localId 4); after
  // numeric-aware sort, Blastoise must appear first.
  const tiles = page.locator('.card-tile strong');
  await expect(tiles.first()).toHaveText('Blastoise');
  await expect(tiles.nth(1)).toHaveText('Charizard');
});

test('series page /series/base/ lists sets linking to /set/[setId]/', async ({ page }) => {
  await page.goto('series/base/');
  // Fixture series "base" has only set "base1" (name "Base").
  await expect(page.locator('h1')).toHaveText('Base');
  await expect(page.locator('.series-header .meta')).toContainText('1 set');
  await expect(page.locator('.series-header .meta')).toContainText('2 cards');

  const firstLink = page.locator('.set-list a').first();
  await expect(firstLink).toHaveAttribute('href', /\/pokemon-tcg\/set\/base1\/$/);
  await expect(firstLink).toContainText('Base');
});

test('sets index /sets/ lists every series as a tile', async ({ page }) => {
  await page.goto('sets/');
  await expect(page.locator('h1')).toHaveText('All sets');
  // Fixture: only "base" series exists.
  const tiles = page.locator('.series-tile');
  await expect(tiles).toHaveCount(1);
  await expect(tiles.first()).toContainText('Base');
  await expect(tiles.first()).toHaveAttribute('href', /\/pokemon-tcg\/series\/base\/$/);
});
