import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
  getPending: vi.fn(async () => ({ notifications: [{ id: 123 }] })), cancel: vi.fn(async () => {}),
  checkPermissions: vi.fn(async () => ({ display: 'granted' })), requestPermissions: vi.fn(async () => ({ display: 'granted' })),
  createChannel: vi.fn(async () => {}), schedule: vi.fn(async (_: unknown) => {}),
  getDeliveredNotifications: vi.fn(async () => ({ notifications: [] })), removeDeliveredNotifications: vi.fn(async () => {}),
}));
const rolling = vi.hoisted(() => ({ configure: vi.fn(async (_: unknown) => {}), pendingEntries: vi.fn(async (): Promise<{ entries: import('./model').Entry[] }> => ({ entries: [] })), acknowledgeEntries: vi.fn(async (_: unknown) => {}), test: vi.fn(async () => {}), pendingSkips: vi.fn(async (): Promise<{ skips: { date: string; meal: string }[] }> => ({ skips: [] })), acknowledgeSkips: vi.fn(async (_: unknown) => {}), clear: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: native }));
vi.mock('./android-reminders', () => ({ AndroidMealReminders: rolling }));
import { clearLocalData, loadState, mutateState, writeMetadata } from './storage';
import { refreshReminders, saveReminderSettings } from './reminders';
import { defaultReminders } from './reminder-plan';
import { localDate, zero } from './model';

beforeEach(async () => {
  await clearLocalData(); vi.clearAllMocks();
  native.checkPermissions.mockResolvedValue({ display: 'granted' }); native.requestPermissions.mockResolvedValue({ display: 'granted' });
  rolling.pendingSkips.mockResolvedValue({ skips: [] }); rolling.pendingEntries.mockResolvedValue({ entries: [] });
  vi.stubGlobal('window', new EventTarget());
});
it('sends meal completion to the Android rolling scheduler without re-prompting', async () => {
  await writeMetadata('reminders', { ...defaultReminders, enabled: true });
  await mutateState(s => ({ ...s, entries: [{ id: 'dinner', name: 'Dinner', grams: 100, per100: zero, preparation: 'Cooked', date: localDate(), meal: 'Dinner' }] }));
  await refreshReminders();
  expect(native.cancel).toHaveBeenCalledWith({ notifications: [{ id: 123 }] });
  expect(rolling.configure).toHaveBeenCalledWith({ settings: { ...defaultReminders, enabled: true }, logged: [{ date: localDate(), meal: 'Dinner' }], skipped: [], quickMeals: expect.objectContaining({ Dinner: [expect.objectContaining({ name: 'Dinner' })] }) });
  expect(native.requestPermissions).not.toHaveBeenCalled();
  expect(native.schedule).not.toHaveBeenCalled();
});
it('disables the native scheduler when off or permission is revoked', async () => {
  await refreshReminders();
  expect(rolling.configure).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ enabled: false }) }));
  await writeMetadata('reminders', { ...defaultReminders, enabled: true });
  native.checkPermissions.mockResolvedValue({ display: 'denied' });
  await refreshReminders();
  expect(rolling.configure).toHaveBeenLastCalledWith(expect.objectContaining({ settings: expect.objectContaining({ enabled: false }) }));
});
it('does not enable reminders if the user refuses notification permission', async () => {
  native.requestPermissions.mockResolvedValue({ display: 'denied' });
  await expect(saveReminderSettings({ ...defaultReminders, enabled: true })).rejects.toThrow('not allowed');
  expect(rolling.configure).not.toHaveBeenCalled();
});
it('durably imports notification skips before acknowledging them to Android, without duplicates', async () => {
  const skip = { date: '2026-09-28', meal: 'Breakfast' as const };
  rolling.pendingSkips.mockResolvedValue({ skips: [skip] });
  await refreshReminders(); await refreshReminders();
  expect((await loadState()).skippedMeals).toEqual([skip]);
  expect(rolling.configure).toHaveBeenCalledWith(expect.objectContaining({ skipped: [skip] }));
  expect(rolling.acknowledgeSkips).toHaveBeenCalledWith({ skips: [skip] });
  expect(rolling.configure.mock.invocationCallOrder[0]).toBeLessThan(rolling.acknowledgeSkips.mock.invocationCallOrder[0]);
});
it('imports a watch-selected meal once and only acknowledges after the native mirror is updated', async () => {
  const entry = { id: 'watch-lunch', date: localDate(), meal: 'Lunch' as const, name: 'Panina tuna ftira', preparation: 'Ready to eat', grams: 180, per100: { ...zero, kcal: 250 }, estimated: true };
  rolling.pendingEntries.mockResolvedValue({ entries: [entry] });
  await mutateState(s => ({ ...s, skippedMeals: [{ date: localDate(), meal: 'Lunch' }] }));
  await refreshReminders(); await refreshReminders();
  expect((await loadState()).entries).toEqual([entry]);
  expect((await loadState()).skippedMeals).toEqual([]);
  expect(rolling.acknowledgeEntries).toHaveBeenCalledWith({ ids: ['watch-lunch'] });
  expect(rolling.configure.mock.invocationCallOrder[0]).toBeLessThan(rolling.acknowledgeEntries.mock.invocationCallOrder[0]);
});
