import { describe, expect, it } from 'vitest';
import { offCandidate, offSummary, searchCatalog } from './food-import';
import { parseIngredientLines } from './quick-ingredients';
import { entrySchema, foodSchema } from './model';
import { initialState } from './storage';
import { mergeStates, SyncConflict } from './merge';
import { mergeHealthRecords } from './native-background';

const product = (nutrition: unknown) => ({ code: '3017620422003', product_name: 'Test spread', brands: 'Test brand', nutrition });
const nutrient = (value: number, unit = 'g') => ({ value, unit });
describe('reviewed food data', () => {
  it('reads v3 per-100 g nutrition, converts kJ, and keeps missing nutrients blank', () => {
    const candidate = offCandidate(product({ aggregated_set: { per: '100g', preparation: 'as_sold', nutrients: { 'energy-kj': nutrient(418.4, 'kJ'), proteins: nutrient(7), carbohydrates: nutrient(12), fat: nutrient(0) } } }));
    expect(candidate.per100).toEqual({ kcal: 100, protein: 7, carbs: 12, fat: 0, fibre: undefined });
    expect(candidate.sourceUrl).toBe('https://world.openfoodfacts.org/product/3017620422003');
  });
  it('does not confuse volume or per-serving nutrition with per-100 g', () => {
    for (const per of ['100ml', 'serving', 'unknown']) {
      const candidate = offCandidate(product({ aggregated_set: { per, nutrients: { 'energy-kcal': nutrient(200, 'kcal') } } }));
      expect(candidate.blockedReason).toBeTruthy(); expect(candidate.per100.kcal).toBeUndefined();
    }
    expect(offCandidate({ code: '3017620422003', product_name: 'Liquid', product_quantity_unit: 'ml', nutriments: { 'energy-kcal_100g': 90 } }).blockedReason).toBeTruthy();
  });
  it('only accepts explicit gram serving weights, normalizes barcodes and ignores source URLs supplied by products', () => {
    const p = { code: '3017620422003', product_name: 'Snack', serving_size: '1 slice (45 g)', nutriments: { 'energy-kcal_100g': '250', fiber_100g: '', proteins_100g: null, fat_100g: -1, carbohydrates_100g: 800 }, url: 'javascript:alert(1)' };
    expect(offCandidate(p).portions).toEqual([{ label: '1 slice (45 g)', grams: 45 }]);
    expect(offCandidate({ ...p, serving_size: '1 cup', serving_quantity: 250, serving_quantity_unit: 'ml' }).portions).toEqual([]);
    expect(offCandidate(p).per100).toEqual({ kcal: 250, fibre: undefined, protein: undefined, fat: undefined, carbs: undefined });
    expect(offSummary({ ...p, code: '../bad' })).toBeNull();
    expect(offCandidate(p).sourceUrl).toMatch(/^https:\/\/world.openfoodfacts.org\/product\/\d+$/);
  });
  it('searches portion names and parses ingredient masses without inventing weights', () => {
    expect(searchCatalog([{ name: 'Cake, carrot', portions: [{ label: '1 slice' }] }], 'carrot cake slice')).toHaveLength(1);
    expect(parseIngredientLines('100g rice\nChicken 0.2 kg\nOlive oil 10,5 g\nBasil\n1 tin tuna')).toEqual([
      { name: 'rice', grams: 100 }, { name: 'Chicken', grams: 200 }, { name: 'Olive oil', grams: 10.5 }, { name: 'Basil', grams: undefined }, { name: '1 tin tuna', grams: undefined },
    ]);
  });
  it('preserves food provenance and optional serving weights in backups', () => {
    const food = { ...initialState().foods[0], serving: { label: '1 portion', grams: 120 }, estimated: true, importedFrom: { provider: 'usda', recordId: '123', modified: true } };
    expect(foodSchema.parse(food)).toEqual(food);
    expect(foodSchema.safeParse({ ...food, serving: { label: 'Portion', grams: 0 } }).success).toBe(false);
  });
  it('accepts editable meal times without assigning times to old entries', () => {
    const entry = { id: 'entry', date: '2026-09-29', meal: 'Snacks', name: 'Food', grams: 100, preparation: 'Raw', per100: initialState().foods[0].per100 };
    expect(entrySchema.parse(entry).time).toBeUndefined();
    expect(entrySchema.parse({ ...entry, time: '07:25' }).time).toBe('07:25');
    expect(entrySchema.safeParse({ ...entry, time: '24:01' }).success).toBe(false);
  });
});
describe('background activity merging', () => {
  const record = { date: '2026-09-29', source: 'health' as const, steps: 100, activeKcal: 9, distanceKm: 0.1, updatedAt: '2026-09-29T06:00:00Z' };
  it('merges newer health totals without conflicts or loss of missing measurements', () => {
    const base = initialState(), local = { ...base, activities: [record] }, remote = { ...base, activities: [{ ...record, steps: 200, activeKcal: null, updatedAt: '2026-09-29T06:15:00Z' }] };
    const merged = mergeStates(base, local, remote);
    expect(merged.activities[0]).toMatchObject({ steps: 200, activeKcal: 9 });
    expect(mergeHealthRecords(remote, [record], '2026-09-29T06:00:00Z').activities[0].steps).toBe(200);
  });
  it('still requires review for conflicting manual edits and retains manual overrides', () => {
    const base = initialState(), manual = { ...record, source: 'manual' as const };
    expect(() => mergeStates(base, { ...base, activities: [manual] }, { ...base, activities: [{ ...manual, steps: 200 }] })).toThrow(SyncConflict);
    expect(mergeHealthRecords({ ...base, activities: [manual] }, [record]).activities).toHaveLength(2);
  });
});
