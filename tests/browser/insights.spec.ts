import { test, expect, type Page } from '@playwright/test';

async function seed(page: Page, populated = true) {
  await page.clock.setFixedTime(new Date('2026-10-16T18:00:00Z'));
  await page.goto('/#progress');
  await expect(page.getByRole('heading', { name: 'Progress & insights' })).toBeVisible();
  if (!populated) return;
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('steady-fitness', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('app', 'readwrite'), store = tx.objectStore('app'), request = store.get('state');
      request.onsuccess = () => {
        const state = request.result;
        state.profile = { ...state.profile, name: 'Neil', calorieGoal: 2000, stepGoal: 8000 };
        state.entries = []; state.activities = []; state.skippedMeals = [];
        for (let day = 2; day <= 15; day++) {
          const date = `2026-10-${String(day).padStart(2, '0')}`, current = day >= 9;
          const calories = current ? [2400, 2250, 2050, 2600, 1900, 2300, 2350][day - 9] : 1800;
          for (const meal of ['Lunch', 'Dinner']) state.entries.push({ id: `${date}-${meal}`, date, meal, name: meal === 'Lunch' ? 'Tuna ftira · Panina' : 'Chicken, rice & vegetables', grams: 500, per100: { kcal: calories / 10, protein: 10, carbs: 25, fat: current ? 10 : 6, fibre: current ? 1.5 : 3 }, preparation: 'Cooked', estimated: meal === 'Lunch', time: meal === 'Lunch' ? '13:15' : '20:00' });
          state.skippedMeals.push({ date, meal: 'Breakfast' });
          state.activities.push({ date, source: 'health', stepSource: 'zepp', steps: current ? 5000 + (day % 3) * 600 : 8000, activeKcal: 300, distanceKm: 4.2, updatedAt: `${date}T21:00:00Z` });
        }
        state.weights = [{ date: '2026-10-09', kg: 101 }, { date: '2026-10-12', kg: 100.8 }, { date: '2026-10-15', kg: 100.6 }];
        store.put(state, 'state');
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A few things to adjust' })).toBeVisible();
}

test('reports food, movement, nutrition and coverage across selectable ranges offline', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seed(page);
  await expect(page.locator('.insight-metric').first()).toContainText('2,264');
  await expect(page.locator('.insight-metric').first()).toContainText('+464 kcal/day');
  await expect(page.locator('.insight-verdict')).toContainText('Food intake averaged above your target');
  await expect(page.locator('.insight-verdict')).toContainText('Walking averaged below your step target');
  await expect(page.locator('.insight-value').nth(2)).toContainText('-0.4');
  await expect(page.getByRole('progressbar', { name: 'All meal check-ins: 7 of 7 days' })).toBeVisible();
  await page.getByRole('group', { name: 'Rank foods by' }).getByRole('button', { name: 'Fat', exact: true }).click();
  await expect(page.locator('.insight-contributors')).toContainText('350 g');
  await page.locator('.insight-method summary').click();
  await expect(page.locator('.insight-method')).toContainText('No deficit, surplus or expected weight loss is calculated');
  await page.locator('.insight-method summary').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/insights-desktop.png', fullPage: true, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: '1 week', exact: true })).toHaveCSS('background-color', 'rgb(46, 58, 51)');
  await page.screenshot({ path: 'test-results/insights-desktop-dark.png', fullPage: true, animations: 'disabled' });
  await page.screenshot({ path: 'test-results/insights-overview-dark.png', animations: 'disabled' });
  await page.getByRole('button', { name: '2 weeks', exact: true }).click();
  await expect(page.locator('.insight-data')).toContainText('14 finished days');
  await page.getByRole('button', { name: '4 weeks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'More logs, a clearer picture' })).toBeVisible();
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.getByLabel('Month', { exact: true }).fill('2026-09');
  await expect(page.locator('.insight-data')).toContainText('30 finished days');
  await expect(page.locator('.insight-value').first()).toHaveText('—kcal / day');
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.getByLabel('To', { exact: true }).fill('2026-10-16');
  await page.getByLabel('From', { exact: true }).fill('2026-10-09');
  await expect(page.locator('.insight-detail')).toContainText('in progress');
  await expect(page.locator('.insight-data')).toContainText('7 finished days');
  await page.getByLabel('From', { exact: true }).fill('2025-01-01');
  await expect(page.getByRole('alert')).toHaveText('Choose a range of up to 366 days.');
  await page.getByRole('button', { name: '1 week', exact: true }).click();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true); await page.reload();
  await expect(page.locator('.insight-metric').first()).toContainText('2,264');
  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: 'test-results/insights-mobile-dark.png', fullPage: true });
  }
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test('empty and short periods never imply good nutrition; weight and target actions still work', async ({ page }) => {
  await seed(page, false);
  await expect(page.getByRole('heading', { name: 'More logs, a clearer picture' })).toBeVisible();
  await expect(page.locator('.insight-value').first()).toHaveText('—kcal / day');
  await page.getByRole('button', { name: 'Log weight', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Your targets', exact: true }).click();
  await expect(page.getByLabel('Food target (kcal)')).toBeVisible();
  await page.goto('/#progress');
  await page.clock.setFixedTime(new Date('2026-11-02T12:00:00Z'));
  await page.reload();
  await page.getByRole('button', { name: 'This week', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No finished days yet' })).toBeVisible();
  await page.getByRole('button', { name: 'View last week', exact: true }).click();
  await expect(page.locator('.insight-data')).toContainText('7 finished days');
});
