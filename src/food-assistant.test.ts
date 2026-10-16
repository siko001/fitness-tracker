import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./cloud', () => ({ cloud: null }));
import { applyAssistantItems } from './food-assistant';
import { initialState } from './storage';
import { recipePer100, recipeTotals, stateSchema, type Food } from './model';
import { assistantRecipeId, recipeFromDiaryEntry } from './assistant-recipes';
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
it('saves an AI recipe and diary atomically with sources, correct yield and no duplicate calories', () => {
  const settings = { id: assistantRecipeId('entry-1'), name: 'Panina ftira for next time', yieldGrams: 180, servings: 2 };
  const next = applyAssistantItems(initialState(), [row], ['entry-1'], log, settings);
  expect(next.entries).toHaveLength(1); expect(next.recipes).toHaveLength(1);
  expect(next.recipes[0].ingredients[0]).toEqual({ food: panina, grams: 180 });
  expect(next.recipes[0].estimated).toBe(true);
  expect(recipeTotals(next.recipes[0]).kcal / next.recipes[0].servings).toBe(225);
  expect(recipePer100(next.recipes[0]).kcal).toBe(250);
  const again = applyAssistantItems(next, [row], ['entry-1'], log, settings);
  expect(again.recipes).toHaveLength(1); expect(again.entries).toHaveLength(1);
  expect(stateSchema.safeParse(again).success).toBe(true);
});
it('can save only a recipe, or make one after logging without adding another diary entry', () => {
  const settings = { id: assistantRecipeId('entry-1'), name: 'My lunch', yieldGrams: 180, servings: 1 };
  expect(applyAssistantItems(initialState(), [row], ['entry-1'], null, settings).entries).toHaveLength(0);
  const logged = applyAssistantItems(initialState(), [row], ['entry-1'], log);
  const saved = applyAssistantItems(logged, [row], ['entry-1'], null, settings);
  expect(saved.entries).toEqual(logged.entries); expect(saved.recipes).toHaveLength(1);
  expect(() => applyAssistantItems(saved, [row], ['entry-1'], null, { ...settings, name: 'Changed' })).toThrow('already saved');
});
it('validates recipe portions and settings before any diary or recipe changes', () => {
  const state = initialState(), settings = { id: 'r', name: 'Meal', yieldGrams: 180, servings: 1 };
  expect(() => applyAssistantItems(state, [{ ...row, grams: null }], ['entry'], null, settings)).toThrow('Choose the portion');
  expect(() => applyAssistantItems(state, [row], ['entry'], log, { ...settings, servings: 0 })).toThrow();
  expect(state.entries).toHaveLength(0); expect(state.recipes).toHaveLength(0);
  expect(state.foods.some(f => f.id === panina.id)).toBe(false);
});
it('scales ingredients of an existing recipe to the proposed portion without inventing a food copy', () => {
  const state = initialState();
  state.recipes = [{ id: 'batch', name: 'Batch', ingredients: [{ food: panina, grams: 400 }], yieldGrams: 320, servings: 2, estimated: true }];
  const batch = state.recipes[0];
  const portion = { ...row, recipeId: 'batch', grams: 160, food: { ...panina, id: 'batch', per100: recipePer100(batch) } };
  const next = applyAssistantItems(state, [portion], ['entry'], null, { id: 'new', name: 'Half batch', yieldGrams: 160, servings: 1 });
  expect(next.recipes[1].ingredients[0].grams).toBe(200);
  expect(recipeTotals(next.recipes[1]).kcal).toBe(500);
  expect(next.foods).toEqual(state.foods);
});
it('a diary recipe uses the logged snapshot if its library food was edited or removed', () => {
  const logged = applyAssistantItems(initialState(), [row], ['entry-1'], log);
  const original = recipeFromDiaryEntry(logged, logged.entries[0]);
  expect(original.ingredients[0].food.brand).toBe('Panina');
  expect(original.ingredients[0].food.source).toBe('AI estimate · Groq');
  const changed = { ...logged, foods: logged.foods.map(f => f.id === panina.id ? { ...f, per100: { ...f.per100, kcal: 999 } } : f) };
  const snapshot = recipeFromDiaryEntry(changed, logged.entries[0]);
  expect(snapshot.ingredients[0].food.per100.kcal).toBe(250);
  expect(snapshot.ingredients[0].food.source).toBe('Diary snapshot');
  expect(snapshot.estimated).toBe(true);
  expect(recipeTotals(snapshot).kcal).toBe(450);
  expect(recipeTotals(recipeFromDiaryEntry({ ...logged, foods: [] }, logged.entries[0])).kcal).toBe(450);
  expect(changed.entries).toEqual(logged.entries);
});
