import { test, expect } from '@playwright/test';

test('searching "Charizard" finds base1-4', async ({ page }) => {
  await page.goto('/search');
  await page.fill('input[type=search]', 'Charizard');
  await expect(page.locator('ul a[href*="/card/base1-4"]')).toBeVisible();
});

test('searching in Japanese "リザードン" finds base1-4', async ({ page }) => {
  await page.goto('/search');
  await page.fill('input[type=search]', 'リザードン');
  await expect(page.locator('ul a[href*="/card/base1-4"]')).toBeVisible();
});

test('searching in Korean "리자몽" finds base1-4', async ({ page }) => {
  await page.goto('/search');
  await page.fill('input[type=search]', '리자몽');
  await expect(page.locator('ul a[href*="/card/base1-4"]')).toBeVisible();
});

test('searching in Chinese "喷火龙" finds base1-4', async ({ page }) => {
  await page.goto('/search');
  await page.fill('input[type=search]', '喷火龙');
  await expect(page.locator('ul a[href*="/card/base1-4"]')).toBeVisible();
});
