import { z } from 'zod';
import { localDate, shiftDate, type Entry, type Meal, type SkippedMeal } from './model';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const reminderSchema = z.object({
  enabled: z.boolean(), mode: z.enum(['meals', 'daily']),
  breakfast: time, lunch: time, dinner: time,
  quietStart: time.default('23:00'),
});
export type ReminderSettings = z.infer<typeof reminderSchema>;
export const defaultReminders: ReminderSettings = { enabled: false, mode: 'meals', breakfast: '10:00', lunch: '14:00', dinner: '21:00', quietStart: '23:00' };
export type FoodReminder = { id: number; date: string; meals: Meal[]; at: Date; title: string; body: string };
export function reminderNeeded(entries: Entry[], date: string, meal: Meal | null, skips: SkippedMeal[] = []) {
  return !entries.some(e => e.date === date && (meal === null || e.meal === meal)) && !skips.some(s => s.date === date && (meal === null || s.meal === meal));
}
export function reminderSlots(settings: ReminderSettings): { meal: Meal; time: string }[] {
  return settings.mode === 'daily' ? [{ meal: 'Dinner', time: settings.dinner }] : [
    { meal: 'Breakfast', time: settings.breakfast }, { meal: 'Lunch', time: settings.lunch }, { meal: 'Dinner', time: settings.dinner },
  ];
}
// iOS can hold only 64 pending requests. Coalesce reminders due at the same time,
// and reserve four slots for tests/system additions. Android uses its native rolling alarm.
export function planReminders(settings: ReminderSettings, entries: Entry[], now = new Date(), skips: SkippedMeal[] = []): FoodReminder[] {
  if (!settings.enabled) return [];
  const planned: FoodReminder[] = [];
  for (let day = 0; day < 20; day++) {
    const date = shiftDate(localDate(now), day);
    const stop = settings.quietStart === '00:00' ? new Date(`${shiftDate(date, 1)}T00:00:00`) : new Date(`${date}T${settings.quietStart}:00`);
    const grouped = new Map<number, Meal[]>();
    for (const slot of reminderSlots(settings)) {
      if (!reminderNeeded(entries, date, settings.mode === 'daily' ? null : slot.meal, skips)) continue;
      const first = new Date(`${date}T${slot.time}:00`);
      for (let at = first.getTime(); at < stop.getTime(); at += 20 * 60000) {
        if (at <= now.getTime()) continue;
        grouped.set(at, [...(grouped.get(at) ?? []), slot.meal]);
      }
    }
    for (const [stamp, meals] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
      const at = new Date(stamp);
      // IDs use local date, minute slot, and a fixed epoch, not 13-digit timestamps.
      const id = Math.floor(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / 86400000) * 1440 + at.getHours() * 60 + at.getMinutes();
      planned.push({ id, date, meals, at, title: 'A little meal check-in 🌿', body: `${meals.join(' & ')} still to check. Log what you ate or skip each meal for today.` });
      if (planned.length === 60) return planned;
    }
  }
  return planned;
}
