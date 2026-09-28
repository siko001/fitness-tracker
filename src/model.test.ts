import { describe, expect, it } from 'vitest';
import { dateSchema, dayActivity, dayTotals, entryMacros, localDate, parseBackup, recipePer100, recipeTotals, shiftDate, type Entry, type Recipe } from './model';
import { initialState, loadState, mutateState, clearLocalData } from './storage';
import { mergeStates, SyncConflict } from './merge';

const example = (id = 'meal-1'): Entry => ({ id, date: '2026-09-28', meal: 'Lunch', name: 'Label chicken', preparation: 'Raw', grams: 200, per100: { kcal: 120, protein: 23, carbs: 0, fat: 3, fibre: 0 } });
describe('nutrition and diary', () => {
  it('calculates grams without rounding each ingredient', () => { expect(entryMacros(example()).kcal).toBe(240); expect(entryMacros({ ...example(), grams: 37.5 }).protein).toBe(8.625); });
  it('uses finished recipe yield rather than raw ingredient weight', () => {
    const food = { ...initialState().foods[0], per100: example().per100 };
    const recipe: Recipe = { id: 'r', name: 'Batch', ingredients: [{ food, grams: 1000 }], yieldGrams: 800, servings: 4 };
    expect(recipeTotals(recipe).kcal).toBe(1200); expect(recipePer100(recipe).kcal).toBe(150);
    expect(entryMacros({ ...example(), grams: 200, per100: recipePer100(recipe) }).kcal).toBe(300);
  });
  it('keeps food entry nutrition unchanged when its library food changes', () => {
    const state = initialState(); state.entries = [{ ...example(), foodId: state.foods[0].id }]; state.foods[0].per100.kcal = 900;
    expect(dayTotals(state, '2026-09-28').kcal).toBe(240); expect(dayTotals(state, '2026-09-27').kcal).toBe(0);
  });
  it('manual activity replaces imported totals instead of double counting', () => {
    const state = initialState(); state.activities = [{ date: '2026-09-28', steps: 5000, activeKcal: 240, distanceKm: 4, source: 'health', updatedAt: new Date().toISOString() }, { date: '2026-09-28', steps: 5200, activeKcal: null, distanceKm: null, source: 'manual', updatedAt: new Date().toISOString() }];
    expect(dayActivity(state, '2026-09-28')?.steps).toBe(5200); expect(dayActivity(state, '2026-09-28')?.activeKcal).toBeNull();
  });
  it('keeps local dates and DST day shifts correct', () => {
    expect(localDate(new Date('2026-09-27T22:30:00Z'))).toBe('2026-09-28');
    expect(shiftDate('2026-03-28', 1)).toBe('2026-03-29'); expect(shiftDate('2026-10-25', 1)).toBe('2026-10-26');
    expect(dateSchema.safeParse('2026-02-30').success).toBe(false);
  });
  it('rejects malformed or duplicate backups before changing data', () => {
    const state = initialState(); state.entries = [example(), example()]; expect(() => parseBackup(JSON.stringify(state))).toThrow();
    state.entries = [{ ...example(), grams: -1 }]; expect(() => parseBackup(JSON.stringify(state))).toThrow();
    expect(parseBackup(JSON.stringify(initialState())).foods).toHaveLength(24);
  });
});
describe('device merging', () => {
  it('combines independent offline entries and preserves a deletion', () => {
    const base = initialState(); base.entries = [example('old')];
    const local = structuredClone(base); local.entries = [example('phone')];
    const remote = structuredClone(base); remote.entries.push(example('desktop'));
    expect(mergeStates(base, local, remote).entries.map(e => e.id)).toEqual(['phone', 'desktop']);
  });
  it('merges profile fields independently', () => {
    const base = initialState(), local = structuredClone(base), remote = structuredClone(base); local.profile.name = 'Neil'; remote.profile.age = 33;
    expect(mergeStates(base, local, remote).profile).toMatchObject({ name: 'Neil', age: 33 });
  });
  it('does not restore a deleted record or silently choose between conflicting edits', () => {
    const base = initialState(); base.entries = [example()];
    const local = structuredClone(base), remote = structuredClone(base); local.entries = []; remote.entries[0].grams = 400;
    expect(() => mergeStates(base, local, remote)).toThrow(SyncConflict);
  });
  it('retries identical changes idempotently', () => {
    const base = initialState(), local = structuredClone(base); local.entries.push(example());
    expect(mergeStates(base, local, structuredClone(local)).entries).toHaveLength(1);
  });
});
describe('atomic offline storage', () => {
  it('preserves concurrent writes and leaves existing data intact on invalid writes', async () => {
    await clearLocalData();
    await Promise.all([mutateState(s => ({ ...s, entries: [...s.entries, example('a')] })), mutateState(s => ({ ...s, entries: [...s.entries, example('b')] }))]);
    expect((await loadState()).entries).toHaveLength(2);
    await expect(mutateState(s => ({ ...s, entries: [{ ...example('bad'), grams: -5 }] }))).rejects.toThrow();
    expect((await loadState()).entries).toHaveLength(2);
  });
});
