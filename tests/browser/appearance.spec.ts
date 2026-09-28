import { test, expect } from '@playwright/test';

test('appearance defaults to system, follows changes and remembers an offline override', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your day, at a glance.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/dashboard-dark-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Settings & sync', exact: true }).click();
  await expect(page.getByLabel('Colour theme')).toHaveValue('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Colour theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Settings & sync', exact: true }).click();
  await expect(page.getByLabel('Colour theme')).toHaveValue('dark');
  await page.getByLabel('Colour theme').selectOption('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Colour theme').selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await page.getByRole('button', { name: 'Settings & sync', exact: true }).click();
  await expect(page.getByLabel('Colour theme')).toHaveValue('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('phone controls and dialogs stay outside system bars in portrait and landscape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your day, at a glance.' })).toBeVisible();
  // Supply the same measured insets that Capacitor sends on a notched phone.
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '48px');
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '34px');
  });
  const logo = page.locator('.mobile-brand');
  expect((await logo.boundingBox())!.y).toBeGreaterThanOrEqual(48);
  for (const button of await page.locator('.mobile-nav button').all()) {
    const box = (await button.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(844 - 34);
  }
  await page.screenshot({ path: 'test-results/dashboard-dark-mobile-insets.png', fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 700));
  expect((await logo.boundingBox())!.y).toBeGreaterThanOrEqual(48);
  await page.getByRole('button', { name: 'Recipes', exact: true }).last().click();
  await page.getByRole('button', { name: 'New recipe', exact: true }).click();
  const dialog = (await page.getByRole('dialog').boundingBox())!;
  expect(dialog.y).toBeGreaterThanOrEqual(48);
  expect(dialog.y + dialog.height).toBeLessThanOrEqual(844 - 34);
  await page.screenshot({ path: 'test-results/recipe-dark-mobile-insets.png' });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '0px');
    document.documentElement.style.setProperty('--safe-area-inset-left', '44px');
  });
  expect((await page.locator('.sidebar').boundingBox())!.x).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'New recipe', exact: true }).click();
  const landscape = (await page.getByRole('dialog').boundingBox())!;
  expect(landscape.x).toBeGreaterThanOrEqual(44);
  expect(landscape.y + landscape.height).toBeLessThanOrEqual(390 - 34);
});
