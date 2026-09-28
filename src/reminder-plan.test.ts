import { describe, expect, it } from 'vitest';
import { defaultReminders, planReminders, reminderSchema } from './reminder-plan';
import { type Entry, zero } from './model';

const entry = (date: string, meal: Entry['meal']): Entry => ({ id: 'one', date, meal, name: 'A meal', preparation: 'Cooked', grams: 100, per100: zero });
const enabled = { ...defaultReminders, enabled: true };
describe('meal checks every 20 minutes', () => {
  it('starts at 10:00, 14:00 and 21:00, combining unanswered meals at the same time', () => {
    const reminders = planReminders(enabled, [], new Date('2026-09-28T09:00:00'));
    const onDay = reminders.filter(r => r.date === '2026-09-28');
    expect(onDay[0].at.getHours()).toBe(10);
    expect(onDay[1].at.getTime() - onDay[0].at.getTime()).toBe(20 * 60000);
    expect(onDay.find(r => r.at.getHours() === 14 && r.at.getMinutes() === 0)?.meals).toEqual(['Breakfast', 'Lunch']);
    expect(onDay.find(r => r.at.getHours() === 21 && r.at.getMinutes() === 0)?.meals).toEqual(['Breakfast', 'Lunch', 'Dinner']);
    expect(reminders.length).toBe(60);
    expect(new Set(reminders.map(r => r.id)).size).toBe(60);
    expect(reminders.every(r => r.id < 2147483647 && r.at.getTime() > new Date('2026-09-28T09:00:00').getTime())).toBe(true);
  });
  it('stops only the logged/skipped meal for that date and resets the next day', () => {
    const now = new Date('2026-10-02T09:00:00'); // Friday
    const reminders = planReminders(enabled, [entry('2026-10-02', 'Lunch')], now, [{ date: '2026-10-02', meal: 'Breakfast' }]);
    expect(reminders.filter(r => r.date === '2026-10-02').every(r => r.meals.join() === 'Dinner')).toBe(true);
    expect(reminders.find(r => r.date === '2026-10-03')?.meals).toEqual(['Breakfast']);
    const dinnerLogged = planReminders(enabled, [entry('2026-10-02', 'Dinner')], new Date('2026-10-02T21:10:00'));
    expect(dinnerLogged[0].meals).toEqual(['Breakfast', 'Lunch']);
  });
  it('stops at the quiet cutoff, supports midnight and never carries old meals forward', () => {
    const now = new Date('2026-09-28T22:50:00');
    expect(planReminders(enabled, [], now)[0].date).toBe('2026-09-29');
    const midnight = planReminders({ ...enabled, quietStart: '00:00' }, [], now);
    expect(midnight[0].at.getHours()).toBe(23);
    expect(midnight.find(r => r.date === '2026-09-29')?.meals).toEqual(['Breakfast']);
    expect(planReminders(defaultReminders, [], now)).toEqual([]);
  });
  it('supports daily mode and respects local time across Malta DST', () => {
    const daily = { ...enabled, mode: 'daily' as const };
    expect(planReminders(daily, [entry('2026-09-28', 'Snacks')], new Date('2026-09-28T08:00:00'))[0].date).toBe('2026-09-29');
    const reminders = planReminders(enabled, [], new Date('2026-10-24T00:00:00'));
    const first = reminders.find(r => r.date === '2026-10-24')!;
    const next = reminders.find(r => r.date === '2026-10-25')!;
    expect(next.at.getHours()).toBe(10);
    expect(next.at.getTime() - first.at.getTime()).toBe(25 * 3600000);
  });
  it('rejects malformed times and upgrades old settings with a quiet cutoff', () => {
    expect(reminderSchema.safeParse({ ...enabled, dinner: '25:00' }).success).toBe(false);
    expect(reminderSchema.safeParse({ ...enabled, lunch: '12:99' }).success).toBe(false);
    expect(reminderSchema.parse({ enabled: true, mode: 'meals', breakfast: '10:00', lunch: '14:00', dinner: '21:00' }).quietStart).toBe('23:00');
  });
});
