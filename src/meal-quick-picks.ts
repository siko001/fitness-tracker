import { entrySchema, meals, recipePer100, type Entry, type State } from './model';

export function mealQuickPicks(state: State): Record<string, Entry[]> {
  return Object.fromEntries(meals.filter(m => m !== 'Snacks').map(meal => {
    const recent = state.entries.filter(e => e.meal === meal).slice().sort((a, b) => `${b.date}${b.time || ''}`.localeCompare(`${a.date}${a.time || ''}`));
    const recipes: Entry[] = state.recipes.map(r => ({ id: r.id, date: '2000-01-01', meal, name: r.name, preparation: 'Prepared recipe', grams: r.yieldGrams / r.servings, per100: recipePer100(r), recipeId: r.id, estimated: r.estimated }));
    const seen = new Set<string>();
    return [meal, [...recent, ...recipes].filter(e => {
      const key = `${e.recipeId || e.foodId || e.name}:${e.grams}`;
      if (seen.has(key)) return false; seen.add(key); return entrySchema.safeParse(e).success;
    }).slice(0, 3)];
  }));
}
