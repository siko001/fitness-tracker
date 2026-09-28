import { Capacitor } from '@capacitor/core';
import { Health, type HealthDataType } from '@capgo/capacitor-health';
import { daysEnding, localDate, shiftDate, type Activity } from './model';

const read: HealthDataType[] = ['steps', 'calories', 'distance'];
export const isNative = Capacitor.isNativePlatform();
export const healthName = Capacitor.getPlatform() === 'ios' ? 'Apple Health' : 'Health Connect';

export async function syncHealth(prompt = true): Promise<{ records: Activity[]; incomplete: boolean }> {
  if (!isNative) throw new Error('Automatic health sync is available in the Android and iPhone app. In this browser version, you can enter your daily activity manually.');
  const availability = await Health.isAvailable();
  if (!availability.available) throw new Error('Health data is unavailable. On Android, enable or install Health Connect, then try again.');
  const authorization = await (prompt ? Health.requestAuthorization({ read, write: [] }) : Health.checkAuthorization({ read, write: [] }));
  const allowed = Capacitor.getPlatform() === 'android' ? read.filter(r => authorization.readAuthorized.includes(r)) : read;
  if (!allowed.length) throw new Error('No health permissions were granted. You can change access in your phone’s health settings.');
  const records: Activity[] = [];
  let incomplete = allowed.length < read.length;
  // Query each local calendar day explicitly. UTC dates would shift Malta's daily totals.
  // Native aggregate APIs resolve overlapping sources using the OS's activity priorities.
  for (const date of daysEnding(localDate(), 7)) {
    const startDate = new Date(date + 'T00:00:00').toISOString();
    const endDate = new Date(Math.min(new Date(shiftDate(date, 1) + 'T00:00:00').getTime(), Date.now())).toISOString();
    const values = await Promise.allSettled(read.map(async dataType => {
      if (!allowed.includes(dataType)) return null;
      const result = await Health.queryAggregated({ dataType, startDate, endDate, bucket: 'day', aggregation: 'sum' });
      if (!result.samples.length) return null;
      return result.samples.reduce((sum, s) => sum + s.value, 0);
    }));
    const value = (i: number) => { const r = values[i]; if (r.status === 'rejected') { incomplete = true; return null; } return r.value; };
    const steps = value(0), activeKcal = value(1), metres = value(2);
    if ([steps, activeKcal, metres].some(v => v !== null)) records.push({ date, steps: steps === null ? null : Math.round(steps), activeKcal, distanceKm: metres === null ? null : metres / 1000, source: 'health', updatedAt: new Date().toISOString() });
  }
  return { records, incomplete };
}
