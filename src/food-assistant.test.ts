import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./cloud', () => ({ cloud: null }));
import { applyAssistantItems } from './food-assistant';
import { initialState } from './storage';
import { stateSchema, type Food } from './model';
import type { ResolvedItem } from './assistant-schema';
import { mealQuickPicks } from './meal-quick-picks';

const panina: Food = { id: 'panina-tuna', name: 'Tuna ftira', brand: 'Panina', custom: true, estimated: true, group: 'Other', preparation: 'Ready to eat', source: 'AI estimate · Groq', per100: { kcal: 250, protein: 12, carbs: 30, fat: 9, fibre: 2 } };
const row: ResolvedItem = { food: panina, grams: 180, existing: false, notes: 'Half of an estimated 360 g ftira.' };
const log = { date: '2026-10-15', meal: 'Lunch' as const, time: '13:20' };
it('saves and logs atomically, preserves brand/estimate, and handles duplicate submission', () => {
  const state = initialState(); state.skippedMeals.push({ date: log.date, meal: log.meal });
  const next = applyAssistantItems(state, [row], ['entry-1'], log);
  expect(next.entries[0]).toMatchObject({ name: 'Tuna ftira · Panina', grams: 180, estimated: true, time: '13:20' });
  expect(next.foods.at(-1)).toMatchObject({ brand: 'Panina' }); expect(next.skippedMeals).toEqual([]);
  const again = applyAssistantItems(next, [row], ['entry-1'], log);
  expect(again.foods.length).toBe(next.foods.length); expect(again.entries).toHaveLength(1);
  expect(state.entries).toHaveLength(0); expect(stateSchema.safeParse(next).success).toBe(true);
});
it('keeps restaurants distinct and refuses changed nutrition instead of overwriting it', () => {
  const state = initialState(); state.foods.push({ ...panina, id: 'other', brand: 'Other café' });
  const next = applyAssistantItems(state, [row], ['entry'], null);
  expect(next.foods.filter(f => f.name === 'Tuna ftira')).toHaveLength(2);
  expect(() => applyAssistantItems(next, [{ ...row, food: { ...panina, per100: { ...panina.per100, kcal: 999 } } }], ['entry'], log)).toThrow('different saved nutrition');
});
it('never logs a missing portion and reuses saved recipes without creating a food copy', () => {
  expect(() => applyAssistantItems(initialState(), [{ ...row, grams: null }], ['entry'], log)).toThrow('Choose the portion');
  const state = initialState(); state.recipes.push({ id: 'recipe', name: 'My ftira', ingredients: [{ food: panina, grams: 360 }], yieldGrams: 360, servings: 2 });
  const next = applyAssistantItems(state, [{ ...row, recipeId: 'recipe' }], ['entry'], log);
  expect(next.foods.length).toBe(state.foods.length); expect(next.entries[0].recipeId).toBe('recipe');
});
it('watch choices use recent exact portions, deduplicate and cap at three', () => {
  let state = initialState();
  for (let i = 0; i < 5; i++) state = applyAssistantItems(state, [{ ...row, grams: 100 + i }], [`entry-${i}`], { ...log, date: `2026-10-${10 + i}` });
  const picks = mealQuickPicks(state);
  expect(picks.Lunch).toHaveLength(3); expect(picks.Lunch[0].grams).toBe(104); expect(picks.Breakfast).toEqual([]);
});
