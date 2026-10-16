import { describe, expect, it } from 'vitest';
import { initialState } from './storage';
import { buildReport, dayCount, nutritionInsights, presetRange, rangeError } from './insights';
import { daysEnding, scale, type State } from './model';

const today = '2026-10-16';
const range = { start: '2026-10-09', end: '2026-10-15' };
function addDay(state: State, date: string, kcal = 2000, steps: number | null = 9000, checked = true) {
  state.entries.push({ id: date, date, name: 'Lunch', meal: 'Lunch', preparation: 'Cooked', grams: 1000, per100: scale({ kcal, protein: 100, carbs: 250, fat: 60, fibre: 30 }, .1), time: '13:00' });
  if (checked) state.skippedMeals.push({ date, meal: 'Breakfast' }, { date, meal: 'Dinner' });
  state.activities.push({ date, steps, activeKcal: 400, distanceKm: 5, source: 'health', updatedAt: `${date}T20:00:00Z` });
}
function filled() {
  const state = initialState(); state.profile.calorieGoal = 2000; state.profile.stepGoal = 8000;
  daysEnding(range.end, 7).forEach(d => addDay(state, d)); return state;
}

describe('insight date ranges', () => {
  it('uses completed local days for rolling weeks and a Monday-based current week', () => {
    expect(presetRange('7', today)).toEqual(range);
    expect(presetRange('14', today)).toEqual({ start: '2026-10-02', end: range.end });
    expect(presetRange('28', today)).toEqual({ start: '2026-09-18', end: range.end });
    expect(presetRange('week', today)).toEqual({ start: '2026-10-12', end: range.end });
    expect(presetRange('week', '2026-10-19')).toEqual({ start: '2026-10-19', end: '2026-10-18' });
  });
  it('handles calendar months, leap years, year boundaries and DST', () => {
    expect(presetRange('month', today)).toEqual({ start: '2026-10-01', end: range.end });
    expect(presetRange('month', today, '2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(presetRange('month', today, '2025-12')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    expect(presetRange('month', '2026-11-01')).toEqual({ start: '2026-11-01', end: '2026-10-31' });
    expect(dayCount('2026-03-28', '2026-03-30')).toBe(3);
    expect(dayCount('2026-10-24', '2026-10-26')).toBe(3);
  });
  it('rejects invalid, reversed, future and oversized dates, including at the calculation boundary', () => {
    for (const r of [{ start: '', end: today }, { start: '2026-02-30', end: today }, { start: today, end: range.end }, { start: today, end: '2026-10-17' }, { start: '2025-01-01', end: today }]) {
      expect(rangeError(r, today)).toBeTruthy(); expect(() => buildReport(initialState(), r, today)).toThrow();
    }
    expect(rangeError(range, today)).toBeNull();
  });
});

describe('progress insights', () => {
  it('does not turn missing days into zero calories or steps or an encouraging verdict', () => {
    const state = filled(); state.entries = state.entries.slice(0, 1); state.activities = state.activities.slice(0, 1);
    const report = buildReport(state, range, today);
    expect(report.current.average?.kcal).toBe(2000); expect(report.current.steps).toBe(9000);
    expect(report.current.foodDays).toBe(1); expect(report.current.stepDays).toBe(1);
    expect(report.verdict.tone).toBe('neutral');
    expect(report.current.days[1].activity).toBeUndefined();
    expect(buildReport(initialState(), range, today).current.average).toBeNull();
  });
  it('keeps explicit zero steps and respects manual overrides without filling missing fields from health', () => {
    const state = initialState(); addDay(state, range.start, 2000, 9000);
    state.activities.push({ ...state.activities[0], source: 'manual', steps: 0, activeKcal: null, distanceKm: null });
    const current = buildReport(state, range, today).current;
    expect(current.steps).toBe(0); expect(current.stepDays).toBe(1); expect(current.activeKcal).toBeNull();
    state.activities.reverse(); expect(buildReport(state, range, today).current.steps).toBe(0);
  });
  it('excludes today from judgments and compares equal numbers of finished days', () => {
    const state = filled(); addDay(state, today, 8000, 100000);
    const report = buildReport(state, { ...range, end: today }, today);
    expect(report.daily).toHaveLength(8); expect(report.current.days).toHaveLength(7);
    expect(report.current.average?.kcal).toBe(2000);
    expect(report.previousRange).toEqual({ start: '2026-10-02', end: '2026-10-08' });
    expect(report.previous.days).toHaveLength(7);
    const onlyToday = buildReport(state, { start: today, end: today }, today);
    expect(onlyToday.current.average).toBeNull(); expect(onlyToday.verdict.title).toBe('Today is still in progress');
  });
  it('accepts explicitly skipped breakfast but does not equate one meal with a checked-in day', () => {
    const state = filled(); expect(buildReport(state, range, today).verdict.tone).toBe('positive');
    state.skippedMeals = [];
    const report = buildReport(state, range, today);
    expect(report.current.foodDays).toBe(7); expect(report.current.checkedDays).toBe(0);
    expect(report.verdict.tone).toBe('neutral');
    expect(nutritionInsights(report.current, state)[0].title).toBe('Finish your meal check-ins');
  });
  it('requires at least 3 days and 70% coverage for whole-period judgments', () => {
    const state = filled(); state.entries = state.entries.slice(0, 4);
    expect(buildReport(state, range, today).verdict.tone).toBe('neutral');
    expect(buildReport(filled(), { start: '2026-10-14', end: range.end }, today).verdict.tone).toBe('neutral');
  });
  it('calculates calorie-weighted fat share and keeps estimates and food contributors visible', () => {
    const state = initialState(); addDay(state, range.start, 1000); addDay(state, range.end, 3000);
    state.entries[0].per100.fat = 5; state.entries[1].per100.fat = 10; state.entries[1].estimated = true;
    const current = buildReport(state, range, today).current;
    expect(current.fatShare).toBeCloseTo(150 * 9 / 4000 * 100);
    expect(current.estimatedEntries).toBe(1);
    expect(current.contributors).toEqual([{ name: 'Lunch', kcal: 4000, fat: 150, count: 2 }]);
    expect(current.mealTimes.find(m => m.meal === 'Lunch')).toMatchObject({ first: '13:00', last: '13:00', count: 2 });
  });
  it('uses current goals and only pairs checked-in food with measured steps', () => {
    const state = filled(); state.entries[0].per100.kcal = 240; state.activities[0].steps = 5000;
    const report = buildReport(state, range, today);
    expect(report.current.higherFoodLowerSteps).toBe(1); expect(report.current.pairedDays).toBe(7);
    expect(report.current.calorieDays).toEqual({ above: 1, near: 6, below: 0 });
    state.activities[0].steps = null;
    expect(buildReport(state, range, today).current.higherFoodLowerSteps).toBe(0);
  });
  it('flags high and low intake without claiming a deficit based on watch energy', () => {
    const state = filled(); state.entries.forEach(e => e.per100.kcal = 260);
    state.activities.forEach(a => a.activeKcal = 5000);
    expect(buildReport(state, range, today).verdict.detail).toContain('above your target');
    state.entries.forEach(e => e.per100.kcal = 150);
    expect(buildReport(state, range, today).verdict.detail).toContain('below your target');
    state.profile.calorieGoal = null;
    expect(buildReport(state, range, today).verdict.title).toBe('Your trends are ready');
  });
  it('flags inconsistent nutrition and does not award lower fat or fibre a better score', () => {
    const state = filled(); state.entries.forEach(e => { e.per100.fat = 1; e.per100.fibre = 1; });
    let report = buildReport(state, range, today);
    expect(report.verdict.tone).toBe('attention'); expect(report.verdict.detail).toContain('Fat’s share'); expect(report.verdict.detail).toContain('fibre');
    state.entries[0].per100.fat = 50;
    report = buildReport(state, range, today);
    expect(report.current.inconsistentNutrition).toBe(true);
    expect(nutritionInsights(report.current, state).some(i => i.title === 'Check food nutrition')).toBe(true);
  });
  it('sorts in-range weights without mutating state and excludes today’s unfinished comparison', () => {
    const state = filled(); state.weights = [{ date: range.end, kg: 100 }, { date: today, kg: 80 }, { date: range.start, kg: 101 }, { date: '2026-10-01', kg: 110 }];
    const report = buildReport(state, range, today);
    expect(report.weightChange).toBe(-1); expect(report.weights.map(w => w.date)).toEqual([range.start, range.end]);
    expect(state.weights[0].date).toBe(range.end);
  });
});

 it('includes drinks without treating missing fibre as zero or requiring a drinks check-in', () => {
  const state = filled();
  state.entries.push({ ...state.entries[0], id: 'drink', meal: 'Drinks', grams: 250, unit: 'ml', fibreMissing: true, per100: { kcal: 48, protein: 0, carbs: 12, fat: 0, fibre: 0 }, time: '21:00' });
  const report = buildReport(state, range, today);
  expect(report.current.drinkKcal).toBe(120); expect(report.current.drinkEntries).toBe(1);
  expect(report.current.checkedDays).toBe(7); expect(report.current.fibreMissing).toBe(true);
  expect(report.verdict.detail).toContain('fibre cannot be assessed');
  expect(nutritionInsights(report.current, state).some(i => i.title === 'Make room for fibre')).toBe(false);
  expect(report.current.mealTimes.find(m => m.meal === 'Drinks')?.first).toBe('21:00');
});
