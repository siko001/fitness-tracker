import { describe, expect, it } from 'vitest';
import { initialState } from './storage';
import { applyLabelFood, draftFromLabel, draftFromSavedFood, foodFromLabel } from './label-scan';
import { dayTotals, moveDiaryEntry, parseBackup, recipePer100 } from './model';
import { offCandidate, candidateFood } from './food-import';
import { parseIngredientLines } from './quick-ingredients';
import { foodIdentity } from './assistant-schema';
import type { LabelReading } from './label-schema';
const reading: LabelReading = { name: 'Cranberry juice', brand: 'Test brand', category: 'Drinks', barcode: '1234567890123', basisAmount: 250, unit: 'ml', nutrients: { kcal: 120, kj: null, protein: 0, carbs: 30, fat: 0, fibre: null }, servingAmount: 250, servingUnit: 'ml', notes: '', warnings: [] };
const log = { date: '2026-10-16', meal: 'Drinks' as const, amount: 500, time: '20:45' };
describe('nutrition label and drinks', () => {
  it('normalises a per-serving ml label and logs real volume without changing mass defaults', () => {
    const food = foodFromLabel(draftFromLabel(reading));
    expect(food).toMatchObject({ unit: 'ml', per100: { kcal: 48, carbs: 12 }, fibreMissing: true, serving: { grams: 250 } });
    const state = applyLabelFood(initialState(), food, 'juice-entry', log);
    expect(state.entries[0]).toMatchObject({ grams: 500, unit: 'ml', meal: 'Drinks', time: '20:45', fibreMissing: true });
    expect(dayTotals(state, log.date)).toMatchObject({ kcal: 240, carbs: 60 });
    expect(parseBackup(JSON.stringify(state))).toEqual(state);
    expect(moveDiaryEntry(state, 'juice-entry', 'Lunch').entries[0]).toMatchObject({ meal: 'Lunch', grams: 500, unit: 'ml' });
    expect(initialState().foods[0].unit).toBeUndefined();
  });
  it('converts kJ only when kcal is missing and retains printed zeros', () => {
    const food = foodFromLabel(draftFromLabel({ ...reading, basisAmount: 100, nutrients: { ...reading.nutrients, kcal: null, kj: 418.4, fibre: 0 } }));
    expect(food.per100.kcal).toBe(100); expect(food.fibreMissing).toBeUndefined();
    expect(draftFromLabel({ ...reading, nutrients: { ...reading.nutrients, kcal: 0, kj: 418.4 } }).values.kcal).toBe('0');
  });
  it('requires unreadable macronutrients and an explicit measurement basis', () => {
    const draft = draftFromLabel({ ...reading, nutrients: { ...reading.nutrients, protein: null } });
    expect(draft.values.protein).toBe(''); expect(() => foodFromLabel(draft)).toThrow('protein');
    expect(() => foodFromLabel({ ...draftFromLabel(reading), unit: '' })).toThrow('g or ml');
    expect(() => foodFromLabel({ ...draftFromLabel(reading), basisAmount: '0' })).toThrow();
    expect(() => foodFromLabel({ ...draftFromLabel(reading), values: { ...draftFromLabel(reading).values, carbs: '99999' } })).toThrow('same label column');
    expect(draftFromLabel({ ...reading, servingUnit: 'g' }).servingAmount).toBe('');
  });
  it('reuses products, prevents conflicting overwrites and saves atomically and idempotently', () => {
    const food = foodFromLabel(draftFromLabel(reading)), initial = initialState();
    const saved = applyLabelFood(initial, food, 'first', log);
    expect(applyLabelFood(saved, { ...food, id: 'rescan' }, 'first', log)).toEqual(saved);
    const twice = applyLabelFood(saved, food, 'second', log);
    expect(twice.foods.length).toBe(initial.foods.length + 1); expect(twice.entries).toHaveLength(2);
    expect(() => applyLabelFood(saved, { ...food, per100: { ...food.per100, kcal: 60 } }, 'bad', log)).toThrow('different nutrition');
    expect(() => applyLabelFood(saved, food, 'bad', { ...log, amount: -1 })).toThrow();
    expect(saved.entries).toHaveLength(1);
    expect(applyLabelFood(initial, food, 'none', null).entries).toHaveLength(0);
    expect(foodFromLabel(draftFromSavedFood(food)).per100).toEqual(food.per100);
  });
  it('keeps mass and volume distinct in matches, imports, ingredient lists and recipes', () => {
    const food = foodFromLabel(draftFromLabel(reading));
    expect(foodIdentity(food)).not.toBe(foodIdentity({ ...food, unit: 'g' }));
    expect(parseIngredientLines('Juice 250ml\nMilk 0.5 litres\nRice 50g')).toEqual([{ name: 'Juice', grams: 250, unit: 'ml' }, { name: 'Milk', grams: 500, unit: 'ml' }, { name: 'Rice', grams: 50 }]);
    const candidate = offCandidate({ code: '1234567890123', product_name: 'Juice', serving_size: '1 glass (250 ml)', nutrition: { aggregated_set: { per: '100ml', preparation: 'as_sold', nutrients: { 'energy-kcal': { value: 48, unit: 'kcal' }, proteins: { value: 0, unit: 'g' }, carbohydrates: { value: 12, unit: 'g' }, fat: { value: 0, unit: 'g' }, fiber: { value: 0, unit: 'g' } } } } });
    expect(candidate.blockedReason).toBeUndefined(); expect(candidateFood(candidate).unit).toBe('ml');
    expect(candidate.portions).toEqual([{ label: '1 glass (250 ml)', grams: 250 }]);
    expect(recipePer100({ id: 'recipe', name: 'Juice ice', ingredients: [{ food, grams: 500 }], yieldGrams: 600, servings: 2 }).kcal).toBe(40);
  });
});
