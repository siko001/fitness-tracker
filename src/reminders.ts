import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { dateSchema, meals, skippedMealSchema, type Meal, type SkippedMeal } from './model';
import { defaultReminders, planReminders, reminderNeeded, reminderSchema, type ReminderSettings } from './reminder-plan';
import { loadState, mutateState, readMetadata, writeMetadata } from './storage';
import { AndroidMealReminders } from './android-reminders';

const native = Capacitor.isNativePlatform();
const android = Capacitor.getPlatform() === 'android';
const channelId = 'steady-meals';
export async function loadReminderSettings() {
  return reminderSchema.parse(await readMetadata('reminders') ?? defaultReminders);
}
export async function clearPhoneReminders() {
  if (!native) return;
  await pending.catch(() => {});
  if (android) await AndroidMealReminders.clear();
  await LocalNotifications.cancelAll();
  await LocalNotifications.removeAllDeliveredNotifications();
}
async function notificationChannel() {
  if (android) await LocalNotifications.createChannel({ id: channelId, name: 'Food diary reminders', description: 'Reminders until you log or skip a meal for today.', importance: 3, visibility: 0 });
}
export async function saveReminderSettings(value: ReminderSettings) {
  if (!native) throw new Error('Food reminders need the installed Android or iPhone app.');
  const settings = reminderSchema.parse(value);
  if (settings.enabled) {
    const permission = await LocalNotifications.requestPermissions();
    if (permission.display !== 'granted') throw new Error('Notifications are not allowed. Enable Steady notifications in your phone settings, then try again.');
  }
  await writeMetadata('reminders', settings);
  await refreshReminders();
}
export async function skipMeal(date: string, meal: Meal) {
  const skip = skippedMealSchema.parse({ date, meal });
  await mutateState(s => ({ ...s, skippedMeals: [...s.skippedMeals.filter(x => x.date !== date || x.meal !== meal), skip] }));
  window.dispatchEvent(new Event('steady-native-changed'));
  await refreshReminders();
}
let pending: Promise<void> = Promise.resolve();
export function refreshReminders(): Promise<void> {
  if (!native) return Promise.resolve();
  // Serialize cancellation/rescheduling, reading the newest diary inside the queue.
  pending = pending.catch(() => {}).then(async () => {
    const settings = await loadReminderSettings();
    let nativeSkips: SkippedMeal[] = [];
    if (android) {
      nativeSkips = skippedMealSchema.array().parse((await AndroidMealReminders.pendingSkips()).skips);
      if (nativeSkips.length) {
        await mutateState(s => ({ ...s, skippedMeals: [...new Map([...s.skippedMeals, ...nativeSkips].map(x => [`${x.date}:${x.meal}`, x])).values()] }));
        window.dispatchEvent(new Event('steady-native-changed'));
      }
    }
    const state = await loadState();
    const { notifications } = await LocalNotifications.getPending();
    // Keep an explicit test notification intact when an app-resume refresh occurs.
    const managed = notifications.filter(n => n.id !== 42);
    if (managed.length) await LocalNotifications.cancel({ notifications: managed.map(n => ({ id: n.id })) });
    const enabled = settings.enabled && (await LocalNotifications.checkPermissions()).display === 'granted';
    if (android) {
      const logged = [...new Map(state.entries.map(e => [`${e.date}:${e.meal}`, { date: e.date, meal: e.meal }])).values()];
      await AndroidMealReminders.configure({ settings: { ...settings, enabled }, logged, skipped: state.skippedMeals });
      // Native skips stay authoritative until the diary AND native mirror contain them.
      if (nativeSkips.length) await AndroidMealReminders.acknowledgeSkips({ skips: nativeSkips });
      return;
    }
    if (!enabled) return;
    await LocalNotifications.registerActionTypes({ types: meals.filter(m => m !== 'Snacks').map(meal => ({ id: `steady-${meal}`, actions: [
      { id: 'log', title: `Log ${meal.toLowerCase()}`, foreground: true },
      // Capacitor needs its webview to write IndexedDB; iOS brings the app forward.
      { id: 'skip', title: `Skip ${meal.toLowerCase()} today`, foreground: true },
    ] })) });
    const planned = planReminders(settings, state.entries, new Date(), state.skippedMeals);
    if (planned.length) await LocalNotifications.schedule({ notifications: planned.map(r => ({
      id: r.id, title: r.title, body: r.body, channelId, isExactNotification: false,
      actionTypeId: `steady-${r.meals[0]}`, schedule: { at: r.at, allowWhileIdle: true },
      extra: { steadyFood: true, date: r.date, meal: r.meals[0], meals: r.meals },
    })) });
    const delivered = await LocalNotifications.getDeliveredNotifications();
    const done = delivered.notifications.filter(n => n.extra?.steadyFood && !reminderNeeded(state.entries, n.extra.date, n.extra.meal, state.skippedMeals));
    if (done.length) await LocalNotifications.removeDeliveredNotifications({ notifications: done });
  });
  return pending;
}
export async function testReminder() {
  if (!native) throw new Error('Install the phone app to test a reminder.');
  if ((await LocalNotifications.requestPermissions()).display !== 'granted') throw new Error('Allow notifications in your phone settings first.');
  await notificationChannel();
  await LocalNotifications.schedule({ notifications: [{ id: 42, title: 'Your Steady reminder 🌿', body: 'This is how your food diary reminders will look.', channelId, isExactNotification: false, schedule: { at: new Date(Date.now() + 5000) }, extra: { test: true } }] });
}
export async function consumeAndroidReminder(open: (date: string, meal: Meal) => void) {
  if (!native || !android) return;
  const pending = await AndroidMealReminders.consumeOpen();
  if (dateSchema.safeParse(pending.date).success && meals.includes(pending.meal as Meal)) open(pending.date!, pending.meal as Meal);
}
export function onFoodReminder(open: (date: string, meal: Meal) => void, error: (message: string) => void): Promise<PluginListenerHandle> | undefined {
  if (!native) return;
  return LocalNotifications.addListener('localNotificationActionPerformed', event => {
    const extra = event.notification.extra;
    if (!extra?.steadyFood || !dateSchema.safeParse(extra.date).success || !meals.includes(extra.meal)) return;
    if (event.actionId === 'skip') void skipMeal(extra.date, extra.meal).catch(e => error(String(e)));
    else if (event.actionId !== 'dismiss') open(extra.date, extra.meal);
  });
}
