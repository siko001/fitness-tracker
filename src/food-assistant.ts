import { Capacitor } from '@capacitor/core';
import { cloud } from './cloud';
import { readMetadata } from './storage';
import type { LocalConnection } from './local-sync';
import { assistantResponseSchema, foodIdentity, resolvedItemSchema, type ChatMessage, type DraftItem, type ResolvedItem } from './assistant-schema';
import { entrySchema, foodSchema, recipePer100, type Meal, type State } from './model';
import { recipeFromAssistant, type AssistantRecipeOptions } from './assistant-recipes';

// Optional session key stays in memory, never IndexedDB, localStorage or backups.
let sessionKey = '';
export const getAssistantKey = () => sessionKey;
export const setAssistantKey = (key: string) => { sessionKey = key.trim(); };
let keyAccount: string | null | undefined;
cloud?.auth.onAuthStateChange((event, session) => {
  const next = session?.user.id ?? null;
  if (event === 'SIGNED_OUT' || keyAccount !== undefined && keyAccount !== next) sessionKey = '';
  keyAccount = next;
});
export async function assistantDestination() {
  const mode = await readMetadata<string>('syncMode');
  if (mode === 'local') {
    const local = await readMetadata<LocalConnection>('localConnection');
    if (local) return { url: `${local.url}/api/food-assistant`, token: local.key };
  }
  const { data } = cloud ? await cloud.auth.getSession() : { data: { session: null } };
  const base = Capacitor.isNativePlatform() ? (import.meta.env.VITE_FOOD_API_URL || 'https://fitness-tracker-one-steel.vercel.app').replace(/\/$/, '') : '';
  return { url: `${base}/api/food-assistant`, token: data.session?.access_token };
}
export type AssistantStatus = { configured: boolean; savedKey: boolean; canSaveKey: boolean; signedIn: boolean };
export async function assistantStatus(): Promise<AssistantStatus> {
  const { url, token } = await assistantDestination();
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not check your saved key.');
  return { configured: result.configured === true, savedKey: result.savedKey === true, canSaveKey: result.canSaveKey === true, signedIn: result.signedIn === true };
}
export async function updateAssistantKey(key: string | null): Promise<AssistantStatus> {
  const { url, token } = await assistantDestination();
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(key === null ? { action: 'remove_key' } : { action: 'save_key', apiKey: key.trim() }), signal: AbortSignal.timeout(25000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not save your key. Please try again.');
  return result;
}
export async function askAssistant(state: State, messages: ChatMessage[], draft: DraftItem[], webSearch: boolean, signal: AbortSignal) {
  if (!navigator.onLine) throw new Error('AI needs internet. Find a list in your saved foods and offline catalog instead.');
  // Retain the full history locally; send recent turns plus the current meal draft.
  const recentMessages = messages.slice(-24);
  const { url, token } = await assistantDestination();
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages: recentMessages, draft, foods: state.foods, recipes: state.recipes, webSearch, ...(sessionKey ? { apiKey: sessionKey } : {}) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(115000)]),
  });
  const raw = await response.json();
  if (!response.ok) throw new Error(raw.error || 'The food assistant is unavailable. Your draft is safe.');
  return assistantResponseSchema.parse(raw);
}

// One transaction saves library items AND their diary entries. Read the current
// state again so another tab's changes cannot silently be replaced.
export function applyAssistantItems(state: State, items: ResolvedItem[], entryIds: string[], log: { date: string; meal: Meal; time?: string } | null, recipeOptions?: AssistantRecipeOptions): State {
  const foods = [...state.foods], entries = [...state.entries];
  const canonicalItems: ResolvedItem[] = [];
  items.forEach((raw, i) => {
    const row = resolvedItemSchema.parse(raw);
    let food = foodSchema.parse(row.food);
    if (row.recipeId) {
      const recipe = state.recipes.find(r => r.id === row.recipeId);
      if (!recipe) throw new Error('This recipe was removed. Look it up again.');
      // Compare against the complete preview snapshot before recording a portion.
      const totals = recipePer100(recipe);
      if (Object.keys(totals).some(k => Math.abs(totals[k as keyof typeof totals] - food.per100[k as keyof typeof totals]) > .0001)) throw new Error('This recipe changed during your conversation. Look it up again.');
      food = { ...food, fibreMissing: recipe.ingredients.some(i => i.food.fibreMissing) || undefined };
    } else {
      const existing = foods.find(f => f.id === food.id || foodIdentity(f) === foodIdentity(food) || f.sourceUrl && f.sourceUrl === food.sourceUrl && (f.brand || '') === (food.brand || '') && f.preparation === food.preparation);
      if (existing) {
        if ((existing.unit ?? 'g') !== (food.unit ?? 'g') || JSON.stringify(existing.per100) !== JSON.stringify(food.per100)) throw new Error(`${food.name} changed or has different saved nutrition. Look up the saved item again.`);
        food = existing;
      } else if (row.existing) throw new Error(`${food.name} was removed. Look it up again.`);
      else foods.push(food);
    }
    canonicalItems.push({ ...row, food });
    if (log) {
      if (!row.grams) throw new Error(`Choose the portion for ${food.name}.`);
      const entry = entrySchema.parse({ id: entryIds[i], ...log, name: food.brand && !food.name.toLowerCase().includes(food.brand.toLowerCase()) ? `${food.name} · ${food.brand}` : food.name,
        preparation: food.preparation, grams: row.grams, per100: food.per100, estimated: food.estimated, unit: food.unit, fibreMissing: food.fibreMissing,
        ...(row.recipeId ? { recipeId: row.recipeId } : { foodId: food.id }),
      });
      if (!entries.some(e => e.id === entry.id)) entries.push(entry);
    }
  });
  let recipes = state.recipes;
  if (recipeOptions) {
    const recipe = recipeFromAssistant(state, canonicalItems, recipeOptions);
    const existing = recipes.find(r => r.id === recipe.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(recipe)) throw new Error('This recipe was already saved. Edit it in Recipes instead of replacing it.');
    if (!existing) recipes = [...recipes, recipe];
  }
  return { ...state, foods, recipes, entries, skippedMeals: log ? state.skippedMeals.filter(x => x.date !== log.date || x.meal !== log.meal) : state.skippedMeals };
}
