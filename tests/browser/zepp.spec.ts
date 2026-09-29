import { test, expect } from '@playwright/test';

test('direct watch testing, activation and fallback preserve the stored diary', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000001';
  const now = new Date().toISOString(), today = now.slice(0, 10);
  let enabled = false;
  await page.addInitScript(({ id, now, today }) => {
    localStorage.setItem('sb-gpvowddoxzkeopiywvlg-auth-token', JSON.stringify({ access_token: 'test-only-token', refresh_token: 'test-only-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid' } }));
    const open = indexedDB.open('steady-fitness', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('app');
    open.onsuccess = () => {
      const tx = open.result.transaction('app', 'readwrite');
      tx.objectStore('app').put('cloud', 'syncMode');
      tx.objectStore('app').put({ version: 1, profile: { name: 'Test', age: null, height: null, startingWeight: null, calorieGoal: null, stepGoal: null, goalWeight: null }, foods: [], recipes: [], entries: [], weights: [], skippedMeals: [], lastHealthSync: now,
        activities: [{ date: today, source: 'health', stepSource: 'zepp', steps: 706, activeKcal: 10, distanceKm: 0.5, updatedAt: now }] }, 'state');
    };
  }, { id, now, today });
  await page.route('https://*.supabase.co/**', async route => {
    const url = route.request().url();
    let body: unknown = [];
    if (url.includes('/auth/')) body = { id, email: 'test@example.invalid' };
    else if (url.includes('zepp_connections')) body = { device_id: id, enabled, revoked_at: null, last_received_at: now };
    else if (url.includes('zepp_step_days')) body = [{ device_id: id, date: today, steps: 801, captured_at: now, received_at: now }];
    else if (url.includes('set_zepp_enabled')) { enabled = route.request().postDataJSON().use_direct; body = null; }
    else if (url.includes('save_diary')) body = 1;
    else if (url.includes('/diaries')) body = null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/#activity');
  const direct = page.getByRole('region', { name: 'Direct Zepp sync' });
  await expect(direct).toContainText('801 steps'); await expect(direct).toContainText('706 steps');
  await expect(page.locator('.stats-row').first()).toContainText('706');
  await direct.getByRole('button', { name: 'I verified my watch · use direct steps' }).click();
  await expect(page.locator('.stats-row').first()).toContainText('801');
  await expect(page.locator('.stats-row').first()).toContainText('Steps · Direct watch');
  const steps = await page.evaluate(() => new Promise<number>(resolve => {
    const open = indexedDB.open('steady-fitness', 1); open.onsuccess = () => {
      const r = open.result.transaction('app').objectStore('app').get('state'); r.onsuccess = () => resolve(r.result.activities[0].steps);
    };
  }));
  expect(steps).toBe(706);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/zepp-phone.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await direct.getByRole('button', { name: 'Use Health Connect totals' }).click();
  await expect(page.locator('.stats-row').first()).toContainText('706');
});
