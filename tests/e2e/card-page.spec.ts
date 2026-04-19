import { test, expect } from '@playwright/test';

test('card page renders all four regional prints for base1-4', async ({ page }) => {
  await page.goto('card/base1-4');
  await expect(page.locator('h1')).toHaveText('Charizard');

  const gallery = page.locator('.print-gallery');
  await expect(gallery.locator('.print')).toHaveCount(4);
  await expect(gallery.locator('.lang-label')).toHaveText(['EN', 'JA', 'KO', 'ZH']);
  await expect(gallery.getByText('リザードン')).toBeVisible();
  await expect(gallery.getByText('리자몽')).toBeVisible();
  await expect(gallery.getByText('喷火龙')).toBeVisible();
});

test('card page renders a single print when only one exists (Blastoise)', async ({ page }) => {
  await page.goto('card/base1-2');
  await expect(page.locator('h1')).toHaveText('Blastoise');
  await expect(page.locator('.print-gallery .print')).toHaveCount(1);
});
