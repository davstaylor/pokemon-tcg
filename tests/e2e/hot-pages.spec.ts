import { test, expect } from '@playwright/test';

test('/hot/7d/ renders header, tabs, and four sections', async ({ page }) => {
  await page.goto('hot/7d/');
  await expect(page.locator('h1')).toHaveText('Hot cards');

  // Tabs: 3 anchors; the 7d one is aria-current="page".
  const tabs = page.locator('.hot-tabs a');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.filter({ hasText: '7 days' })).toHaveAttribute('aria-current', 'page');

  // Four sections, correct headings.
  const sectionHeadings = page.locator('.hot-section h2');
  await expect(sectionHeadings).toHaveCount(4);
  await expect(sectionHeadings).toContainText([
    'Top % risers',
    'Top € gainers',
    'Top % fallers',
    'Top € losers',
  ]);

  // Fixture data puts base1-4 in the risers sections and base1-2 in the fallers.
  await expect(page.locator('.hot-section[data-direction="up"] .hot-row')).toHaveCount(2);
  await expect(page.locator('.hot-section[data-direction="down"] .hot-row')).toHaveCount(2);
  await expect(page.locator('.hot-section[data-direction="up"]').first()).toContainText('Charizard');
  await expect(page.locator('.hot-section[data-direction="down"]').first()).toContainText('Blastoise');
});

test('/hot/ root redirects via meta-refresh to /hot/7d/', async ({ page }) => {
  const resp = await page.goto('hot/');
  // The static HTML includes the meta-refresh; the browser auto-follows it.
  // Either assert the refresh tag is present, or assert the final URL.
  await page.waitForURL(/\/hot\/7d\/$/);
  expect(page.url()).toMatch(/\/pokemon-tcg\/hot\/7d\/$/);
  expect(resp?.ok()).toBe(true);
});

test('other windows are reachable: /hot/24h/ and /hot/30d/', async ({ page }) => {
  const r1 = await page.goto('hot/24h/');
  expect(r1?.ok()).toBe(true);
  await expect(page.locator('.hot-tabs a.on')).toHaveText('24 hours');

  const r2 = await page.goto('hot/30d/');
  expect(r2?.ok()).toBe(true);
  await expect(page.locator('.hot-tabs a.on')).toHaveText('30 days');
});
