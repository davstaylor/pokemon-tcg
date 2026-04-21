import { test, expect } from '@playwright/test';

// The fixture has 2 cards: base1-4 (Charizard) and base1-2 (Blastoise).
// The search box filters the grid by toggling `.hidden-by-search` on tile
// wrappers, so each language test asserts the grid is narrowed to 1 visible
// tile whose name matches the expected card.

test('searching "Charizard" narrows grid to base1-4', async ({ page }) => {
  await page.goto('search');
  await page.fill('input[type=search]', 'Charizard');
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(1);
  await expect(page.locator('[data-card-tile]:visible')).toContainText('Charizard');
});

test('searching in Japanese "リザードン" narrows grid to base1-4', async ({ page }) => {
  await page.goto('search');
  await page.fill('input[type=search]', 'リザードン');
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(1);
  await expect(page.locator('[data-card-tile]:visible')).toContainText('Charizard');
});

test('searching in French "Dracaufeu" narrows grid to base1-4', async ({ page }) => {
  await page.goto('search');
  await page.fill('input[type=search]', 'Dracaufeu');
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(1);
  await expect(page.locator('[data-card-tile]:visible')).toContainText('Charizard');
});

test('searching in German "Glurak" narrows grid to base1-4', async ({ page }) => {
  await page.goto('search');
  await page.fill('input[type=search]', 'Glurak');
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(1);
  await expect(page.locator('[data-card-tile]:visible')).toContainText('Charizard');
});

test('searching in Traditional Chinese "噴火龍" narrows grid to base1-4', async ({ page }) => {
  await page.goto('search');
  await page.fill('input[type=search]', '噴火龍');
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(1);
  await expect(page.locator('[data-card-tile]:visible')).toContainText('Charizard');
});

test('searching in Simplified Chinese "喷火龙" narrows grid to base1-4', async ({ page }) => {
  await page.goto('search');
  await page.fill('input[type=search]', '喷火龙');
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(1);
  await expect(page.locator('[data-card-tile]:visible')).toContainText('Charizard');
});

test('clearing the search box restores the full grid', async ({ page }) => {
  await page.goto('search');
  await page.fill('input[type=search]', 'Charizard');
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(1);
  await page.fill('input[type=search]', '');
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(2);
});

test('search + facet compose: "Charizard" + Water shows zero tiles', async ({ page }) => {
  await page.goto('search');
  await page.fill('input[type=search]', 'Charizard');
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(1);
  // Water is Blastoise's type, Charizard is Fire — intersection is empty.
  await page.locator('input[type=radio][name=type][value="Water"]').check();
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(0);
});

test('filtering by Type=Water narrows results to Blastoise', async ({ page }) => {
  await page.goto('search');
  await page.locator('input[type=radio][name=type][value="Water"]').check();
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(1);
  await expect(page.locator('[data-card-tile]:visible')).toContainText('Blastoise');
});

test('clearing a facet restores all results', async ({ page }) => {
  await page.goto('search');
  await page.locator('input[type=radio][name=type][value="Water"]').check();
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(1);
  await page.getByRole('button', { name: /Clear Type/i }).click();
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(2);
});

test('Set facet shows the human set name, not the set ID', async ({ page }) => {
  await page.goto('search');
  // Fixture's one set is id=base1, name="Base". The Set facet label should be
  // the human name; the radio's value is still the ID so filter logic works.
  const setRadio = page.locator('input[type=radio][name=set][value="base1"]');
  await expect(setRadio).toBeVisible();
  // The <label> wrapping the radio should read "Base", not "base1".
  const setLabelText = await setRadio.locator('..').innerText();
  expect(setLabelText.trim()).toBe('Base');
  // The bare ID must NOT appear as any visible facet label.
  await expect(page.locator('aside').getByText(/^\s*base1\s*$/)).toHaveCount(0);
});
