import { foodSchema, recipeSchema, portionUnit, type Entry, type Food, type Recipe, type State } from './model';
import type { ResolvedItem } from './assistant-schema';

export type AssistantRecipeOptions = Pick<Recipe, 'id' | 'name' | 'yieldGrams' | 'servings'>;
export const assistantRecipeId = (entryId: string) => `ai-recipe:${entryId}`;
export const assistantRecipeName = (items: ResolvedItem[]) => items.map(({ food }) => food.brand && !food.name.toLowerCase().includes(food.brand.toLowerCase()) ? `${food.name} · ${food.brand}` : food.name).join(' + ').slice(0, 200);

export function recipeFromAssistant(state: State, items: ResolvedItem[], options: AssistantRecipeOptions): Recipe {
  const ingredients: Recipe['ingredients'] = [];
  let estimated = false;
  for (const item of items) {
    if (!item.grams || !Number.isFinite(item.grams) || item.grams <= 0 || item.grams > 100000) throw new Error(`Choose the portion for ${item.food.name} before saving a recipe.`);
    const recipe = item.recipeId ? state.recipes.find(r => r.id === item.recipeId) : undefined;
    if (item.recipeId && !recipe) throw new Error('This recipe was removed. Look it up again.');
    // A portion of a saved recipe contributes that fraction of its ingredients.
    // A whole-dish estimate remains one item; no ingredient breakdown is invented.
    if (recipe) {
      ingredients.push(...recipe.ingredients.map(ingredient => ({ ...ingredient, grams: ingredient.grams * item.grams! / recipe.yieldGrams })));
      estimated ||= !!recipe.estimated;
    } else ingredients.push({ food: item.food, grams: item.grams });
    estimated ||= !!item.food.estimated;
  }
  return recipeSchema.parse({ ...options, ingredients, estimated: estimated || ingredients.some(i => i.food.estimated) });
}

export function recipeFromDiaryEntry(state: State, entry: Entry): Recipe {
  if (entry.unit === 'ml') throw new Error('Use the recipe editor and enter a measured finished weight for drinks.');
  const current = state.foods.find(f => f.id === entry.foodId);
  const sameNutrition = current && Object.keys(entry.per100).every(k => entry.per100[k as keyof typeof entry.per100] === current.per100[k as keyof typeof current.per100]);
  // Use the historical snapshot if the library food has changed or disappeared.
  // Creating a reusable recipe must never rewrite the original diary calories.
  const food: Food = current && sameNutrition && portionUnit(current) === portionUnit(entry) && !!current.fibreMissing === !!entry.fibreMissing && current.preparation === entry.preparation
    ? { ...current, estimated: !!entry.estimated || !!current.estimated }
    : foodSchema.parse({ id: `diary-food:${entry.id}`, name: entry.name, group: 'Other',
      preparation: foodSchema.shape.preparation.safeParse(entry.preparation).success ? entry.preparation : 'Ready to eat',
      per100: entry.per100, fibreMissing: entry.fibreMissing, source: 'Diary snapshot', custom: true, estimated: entry.estimated,
      notes: 'Nutrition and portion copied from the logged entry.',
    });
  return recipeSchema.parse({ id: assistantRecipeId(entry.id), name: entry.name, ingredients: [{ food, grams: entry.grams }], yieldGrams: entry.grams, servings: 1, estimated: entry.estimated || food.estimated });
}
