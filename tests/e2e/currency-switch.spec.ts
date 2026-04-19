import { test, expect } from '@playwright/test';

test('currency selector is visible in the site header', async ({ page }) => {
  await page.goto('card/base1-4');
  const select = page.locator('[data-currency-select]');
  await expect(select).toBeVisible();
  const options = await select.locator('option').allTextContents();
  expect(options).toEqual(expect.arrayContaining([
    expect.stringContaining('EUR'),
    expect.stringContaining('USD'),
    expect.stringContaining('GBP'),
    expect.stringContaining('JPY'),
  ]));
});

test('changing currency updates every price on the page', async ({ page }) => {
  await page.goto('card/base1-4');
  const priceNumber = page.locator('.price-tile .price-number').first();
  const initialText = await priceNumber.textContent();
  expect(initialText).toMatch(/[€$£¥][0-9]/);

  await page.selectOption('[data-currency-select]', 'USD');
  await expect(priceNumber).toHaveText(/^\$[0-9]/);

  await page.selectOption('[data-currency-select]', 'GBP');
  await expect(priceNumber).toHaveText(/^£[0-9]/);

  await page.selectOption('[data-currency-select]', 'JPY');
  await expect(priceNumber).toHaveText(/^¥[0-9,]+$/);
});

test('currency choice persists across page reload', async ({ page }) => {
  await page.goto('card/base1-4');
  await page.selectOption('[data-currency-select]', 'GBP');
  await page.reload();
  await expect(page.locator('.price-tile .price-number').first()).toHaveText(/^£[0-9]/);
});
