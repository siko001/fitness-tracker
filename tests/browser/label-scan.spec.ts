import { test, expect, type Page } from '@playwright/test';
const reading = { name: 'Cranberry juice', brand: 'Test Drinks', category: 'Drinks', barcode: '1234567890123', basisAmount: 100, unit: 'ml', nutrients: { kcal: 48, kj: null, protein: 0, carbs: 12, fat: 0, fibre: null }, servingAmount: 250, servingUnit: 'ml', notes: '', warnings: [] };
async function setup(page: Page, result = reading, failed = false) {
  await page.route('**/api/food-assistant', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, savedKey: true, canSaveKey: true, signedIn: true } });
    const body = route.request().postDataJSON();
    expect(body.operation).toBe('scan_label'); expect(body.images).toHaveLength(1);
    expect(body.images[0]).toMatch(/^data:image\/jpeg;base64,/); expect(body.images[0].length).toBeLessThan(800000);
    expect(body.foods).toBeUndefined(); expect(body.apiKey).toBeUndefined();
    return route.fulfill({ status: failed ? 429 : 200, json: failed ? { error: 'Groq’s scan limit was reached.' } : result });
  });
  await page.goto('/#foods');
  await page.getByRole('button', { name: 'Scan label', exact: true }).click();
}
async function upload(page: Page) {
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 700;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 700); ctx.fillStyle = '#000'; ctx.font = '24px sans-serif';
    ['Test Drinks', 'Cranberry juice', 'Nutrition per 100 ml', 'Energy 48 kcal', 'Fat 0 g', 'Carbs 12 g', 'Protein 0 g'].forEach((t, i) => ctx.fillText(t, 30, 60 + i * 60));
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Upload label photo').setInputFiles({ name: 'test-label.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await expect(page.getByRole('button', { name: 'Read label', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Read label', exact: true }).click();
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(r => { const req = indexedDB.open('steady-fitness', 1); req.onsuccess = () => r(req.result); });
    const read = (key: string) => new Promise<any>(r => { const req = db.transaction('app').objectStore('app').get(key); req.onsuccess = () => r(req.result); });
    const result = { state: await read('state'), draft: await read('labelScanDraft') }; db.close(); return result;
  });
}
test('review label, preserve draft, log a drink and reuse its saved volume offline', async ({ page, context }) => {
  await setup(page); await expect(page.getByLabel('Take label photo')).toHaveAttribute('capture', 'environment');
  await upload(page);
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('Cranberry juice');
  await page.getByRole('button', { name: 'View label photo 1' }).click();
  await expect(page.getByAltText('Expanded nutrition label')).toBeVisible();
  await page.getByRole('button', { name: 'Close photo', exact: true }).click();
  await expect(page.getByLabel('Fibre is not listed or cannot be read')).toBeChecked();
  await page.getByLabel('Amount drunk (ml)').fill('250');
  await expect(page.locator('.scan-portion')).toContainText('120 kcal');
  await expect(page.getByRole('button', { name: 'Save & log drink' })).toBeDisabled();
  await expect.poll(async () => (await snapshot(page)).draft?.amount).toBe('250');
  const before = await snapshot(page); expect(before.state.entries).toHaveLength(0); expect(JSON.stringify(before.draft)).not.toContain('data:image');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload(); await page.getByRole('button', { name: 'Scan label', exact: true }).click();
  await expect(page.getByText('Unsaved draft restored', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Amount drunk (ml)')).toHaveValue('250');
  await page.getByLabel('I’ve checked the product, label column and nutrition.').check();
  await page.getByRole('button', { name: 'Save & log drink' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Food diary', exact: true }).click();
  await expect(page.locator('[data-meal="Drinks"] .diary-entry')).toContainText('250 ml');
  await expect(page.locator('[data-meal="Drinks"]')).toContainText('120 kcal');
  expect((await snapshot(page)).state.entries[0].fibreMissing).toBe(true);
  await page.getByRole('button', { name: 'Food library', exact: true }).click();
  await page.getByLabel('Search food library').fill('Cranberry');
  await expect(page.locator('.food-row')).toContainText('100 ml');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Log Cranberry juice Ready to eat' }).click();
  await expect(page.getByLabel('Amount drunk (ml)')).toHaveValue('250');
  await expect(page.getByLabel('Meal', { exact: true })).toHaveValue('Drinks');
  await page.getByLabel('Amount drunk (ml)').fill('500');
  await expect(page.locator('.nutrition-preview strong')).toHaveText('240');
  await page.getByRole('button', { name: 'Add to diary', exact: true }).click();
  expect((await snapshot(page)).state.entries).toHaveLength(2);
});
test('mobile scanner has stationary header/footer, readable values and no overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' });
  await setup(page); await upload(page);
  await page.getByLabel('Amount drunk (ml)').fill('250');
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('Cranberry juice');
  const header = await page.locator('.modal-header').boundingBox(), footer = await page.locator('.modal-footer').boundingBox();
  await page.locator('.modal-body').evaluate(el => el.scrollTop = el.scrollHeight);
  expect((await page.locator('.modal-header').boundingBox())!.y).toBe(header!.y);
  expect((await page.locator('.modal-footer').boundingBox())!.y).toBe(footer!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/label-scan-mobile-dark.png' });
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Save & log drink' })).toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 1080 }); await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('.modal-body').evaluate(el => el.scrollTop = 0);
  await page.screenshot({ path: 'test-results/label-scan-desktop-light.png' });
});
test('scan errors retain photos and never save or create entries', async ({ page }) => {
  await setup(page, reading, true); await upload(page);
  await expect(page.getByRole('alert')).toContainText('limit was reached');
  await expect(page.getByAltText('Your label photo 1')).toBeVisible();
  expect((await snapshot(page)).state.entries).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Read label', exact: true })).toBeEnabled();
});
test('scanning the same product reuses the library entry and honours per-serving values', async ({ page }) => {
  await setup(page, { ...reading, basisAmount: 250, nutrients: { ...reading.nutrients, kcal: 120, carbs: 30 } });
  await upload(page); await page.getByLabel('Also log it now').uncheck();
  await page.getByLabel('I’ve checked the product, label column and nutrition.').check();
  await page.getByRole('button', { name: 'Save to library', exact: true }).click();
  await page.getByRole('button', { name: 'Scan label', exact: true }).click(); await upload(page);
  await expect(page.getByText('Already in your library:', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Use saved product' }).click();
  await expect(page.getByLabel('Energy (kcal)')).toHaveValue('48');
  await page.getByLabel('Amount drunk (ml)').fill('500');
  await page.getByLabel('I’ve checked the product, label column and nutrition.').check();
  await page.getByRole('button', { name: 'Save & log drink' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const { state } = await snapshot(page);
  expect(state.foods.filter((f: any) => f.name === 'Cranberry juice')).toHaveLength(1);
  expect(state.entries).toHaveLength(1); expect(state.entries[0].per100.kcal * 5).toBe(240);
});

test('solid food labels use grams, and missing values require review before saving', async ({ page }) => {
  await setup(page, { ...reading, name: 'Test cereal', category: 'Grains', unit: 'g', servingUnit: 'g', nutrients: { ...reading.nutrients, protein: null } } as any);
  await upload(page);
  await expect(page.getByLabel('Meal', { exact: true })).toHaveValue('Snacks');
  await page.getByLabel('Amount eaten (g)').fill('50');
  await page.getByLabel('I’ve checked the product, label column and nutrition.').check();
  await expect(page.getByRole('button', { name: 'Save & log food' })).toBeDisabled();
  await page.getByLabel('Protein (g)', { exact: true }).fill('5');
  await expect(page.getByLabel('I’ve checked the product, label column and nutrition.')).not.toBeChecked();
  await page.getByLabel('I’ve checked the product, label column and nutrition.').check();
  await page.getByRole('button', { name: 'Save & log food' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const { state } = await snapshot(page);
  expect(state.entries[0]).toMatchObject({ meal: 'Snacks', grams: 50, name: 'Test cereal · Test Drinks' });
  expect(state.entries[0].unit).toBeUndefined();
});
