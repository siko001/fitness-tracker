import { z } from 'zod';

const number = z.number().finite().nonnegative();
const id = z.string().min(1).max(100);
const text = z.string().trim().min(1).max(200);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(s + 'T12:00:00');
  return !isNaN(d.getTime()) && localDate(d) === s;
}, 'Invalid calendar date');
export const macrosSchema = z.object({ kcal: number.max(1000), protein: number.max(100), carbs: number.max(100), fat: number.max(100), fibre: number.max(100) });
export const foodSchema = z.object({
  id, name: text, group: z.enum(['Protein', 'Grains', 'Vegetables', 'Fruit', 'Dairy', 'Fats', 'Other']),
  preparation: z.enum(['Raw', 'Cooked', 'Dry', 'Ready to eat']),
  per100: macrosSchema, source: text, sourceUrl: z.string().url().optional(),
  custom: z.boolean(),
});
export const recipeSchema = z.object({
  id, name: text, ingredients: z.array(z.object({ food: foodSchema, grams: number.positive().max(100000) })).min(1).max(100),
  yieldGrams: number.positive().max(1000000), servings: number.positive().max(10000),
});
export const meals = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const;
export const skippedMealSchema = z.object({ date: dateSchema, meal: z.enum(meals) });
export const entrySchema = z.object({
  id, date: dateSchema, meal: z.enum(meals), name: text, preparation: z.string().max(200),
  grams: number.positive().max(100000), per100: macrosSchema,
  foodId: id.optional(), recipeId: id.optional(),
});
export const profileSchema = z.object({
  name: z.string().trim().max(80), age: z.number().int().min(18).max(120).nullable(),
  height: number.min(80).max(250).nullable(), startingWeight: number.min(25).max(500).nullable(),
  calorieGoal: number.min(1200).max(6000).nullable(), stepGoal: number.int().min(100).max(100000).nullable(),
  goalWeight: number.min(25).max(500).nullable(),
});
export const activitySchema = z.object({
  date: dateSchema, steps: number.int().max(500000).nullable(),
  activeKcal: number.max(30000).nullable(), distanceKm: number.max(1000).nullable(),
  source: z.enum(['manual', 'health']), updatedAt: z.string().datetime(),
});
export const stateSchema = z.object({
  version: z.literal(1), profile: profileSchema,
  foods: z.array(foodSchema).max(10000), recipes: z.array(recipeSchema).max(10000),
  entries: z.array(entrySchema).max(100000),
  skippedMeals: z.array(skippedMealSchema).max(100000).default([]),
  weights: z.array(z.object({ date: dateSchema, kg: number.min(25).max(500) })).max(20000),
  activities: z.array(activitySchema).max(40000),
  lastHealthSync: z.string().datetime().nullable(),
}).superRefine((s, ctx) => {
  for (const key of ['foods', 'recipes', 'entries'] as const) {
    if (new Set(s[key].map(x => x.id)).size !== s[key].length) ctx.addIssue({ code: 'custom', message: `Duplicate ${key} IDs` });
  }
  if (new Set(s.weights.map(x => x.date)).size !== s.weights.length) ctx.addIssue({ code: 'custom', message: 'Duplicate weight dates' });
  if (new Set(s.skippedMeals.map(x => `${x.date}:${x.meal}`)).size !== s.skippedMeals.length) ctx.addIssue({ code: 'custom', message: 'Duplicate skipped meals' });
  if (new Set(s.activities.map(x => `${x.date}:${x.source}`)).size !== s.activities.length) ctx.addIssue({ code: 'custom', message: 'Duplicate activity records' });
});
export type Macros = z.infer<typeof macrosSchema>;
export type Food = z.infer<typeof foodSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type State = z.infer<typeof stateSchema>;
export type Meal = typeof meals[number];
export type SkippedMeal = z.infer<typeof skippedMealSchema>;
export const zero: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 };
export const uid = () => crypto.randomUUID();
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function shiftDate(date: string, days: number) {
  const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + days); return localDate(d);
}
export function scale(m: Macros, factor: number): Macros {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v * factor])) as Macros;
}
export function sumMacros(items: Macros[]): Macros {
  return items.reduce((total, item) => ({ kcal: total.kcal + item.kcal, protein: total.protein + item.protein, carbs: total.carbs + item.carbs, fat: total.fat + item.fat, fibre: total.fibre + item.fibre }), { ...zero });
}
export const entryMacros = (entry: Entry) => scale(entry.per100, entry.grams / 100);
export const recipeTotals = (recipe: Pick<Recipe, 'ingredients'>) => sumMacros(recipe.ingredients.map(i => scale(i.food.per100, i.grams / 100)));
export const recipePer100 = (recipe: Recipe) => scale(recipeTotals(recipe), 100 / recipe.yieldGrams);
export const dayTotals = (state: State, date: string) => sumMacros(state.entries.filter(e => e.date === date).map(entryMacros));
// Manual totals replace imported totals for that day; they are never added together.
export function dayActivity(state: State, date: string): Activity | undefined {
  return state.activities.find(a => a.date === date && a.source === 'manual') ?? state.activities.find(a => a.date === date && a.source === 'health');
}
export function daysEnding(date: string, count: number) { return Array.from({ length: count }, (_, i) => shiftDate(date, i - count + 1)); }
export function parseBackup(raw: string): State {
  if (raw.length > 20_000_000) throw new Error('This backup is too large (maximum 20 MB).');
  const result = stateSchema.safeParse(JSON.parse(raw));
  if (!result.success) throw new Error('This is not a valid Steady v1 backup. Your existing data has not changed.');
  return result.data;
}
export const fmt = (n: number, decimals = 0) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: decimals }).format(n);
export const dateLabel = (date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) => new Date(date + 'T12:00:00').toLocaleDateString('en-GB', options);
