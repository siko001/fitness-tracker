import { describe, expect, it } from 'vitest';
import { initialState } from './storage';
import { dayActivity } from './model';
import { withZeppSteps, type ZeppData } from './zepp';
const id = '00000000-0000-4000-8000-000000000001';
const date = '2026-09-29';
function fixture() {
  const state = initialState();
  state.activities = [{ date, steps: 706, activeKcal: 20, distanceKm: 0.5, source: 'health', stepSource: 'zepp', updatedAt: '2026-09-29T07:00:00Z' }];
  const data: ZeppData = { connection: { device_id: id, enabled: true, revoked_at: null, last_received_at: null }, snapshots: [{ device_id: id, date, steps: 801, captured_at: '2026-09-29T06:55:00Z', received_at: '2026-09-29T07:01:00Z' }] };
  return { state, data };
}
describe('direct watch display without modifying the synced diary', () => {
  it('shows 801 alongside a preserved 706 health reading, never their sum', () => {
    const { state, data } = fixture(); const display = withZeppSteps(state, data);
    expect(dayActivity(display, date)).toMatchObject({ steps: 801, activeKcal: 20, distanceKm: 0.5, stepSource: 'zepp-direct' });
    expect(state.activities[0].steps).toBe(706);
    expect(display.entries).toBe(state.entries);
  });
  it('leaves existing totals alone in testing mode and after revocation', () => {
    const { state, data } = fixture(); data.connection!.enabled = false;
    expect(withZeppSteps(state, data)).toBe(state);
    data.connection!.enabled = true; data.connection!.revoked_at = '2026-09-29T07:00:00Z';
    expect(withZeppSteps(state, data)).toBe(state);
  });
  it('preserves manual overrides and falls back when Health Connect catches up', () => {
    const { state, data } = fixture(); state.activities[0].steps = 900;
    expect(dayActivity(withZeppSteps(state, data), date)?.steps).toBe(900);
    state.activities.push({ ...state.activities[0], source: 'manual', steps: 123 });
    expect(dayActivity(withZeppSteps(state, data), date)?.steps).toBe(123);
  });
  it('does not use phone-inclusive totals or another pairing as watch fallback', () => {
    const { state, data } = fixture(); state.activities[0].steps = 2000; state.activities[0].stepSource = 'combined';
    expect(dayActivity(withZeppSteps(state, data), date)?.steps).toBe(801);
    data.connection!.device_id = '00000000-0000-4000-8000-000000000002';
    expect(dayActivity(withZeppSteps(state, data), date)?.steps).toBe(2000);
  });
  it('uses the watch date for delayed readings and preserves other dates', () => {
    const { state, data } = fixture(); data.snapshots[0].date = '2026-09-28';
    const display = withZeppSteps(state, data);
    expect(dayActivity(display, date)?.steps).toBe(706);
    expect(dayActivity(display, '2026-09-28')?.steps).toBe(801);
  });
});
