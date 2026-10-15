import { Capacitor } from '@capacitor/core';
import { matchesSearch } from './Pagination';
import type { Food, Macros } from './model';
import { foodGroup, preparation, offSummary, offCandidate, object, text, type ProductSummary } from './food-source';
export { offCandidate, offSummary, foodGroup, preparation } from './food-source';
export type { ProductSummary } from './food-source';

export const nutrientKeys = ['kcal', 'protein', 'carbs', 'fat', 'fibre'] as const;
export type FoodCandidate = Omit<Food, 'per100' | 'custom' | 'importedFrom'> & {
  per100: Partial<Macros>; provider: 'usda' | 'openfoodfacts'; recordId: string;
  portions: NonNullable<Food['serving']>[]; brand?: string; quantity?: string;
  updated?: string; blockedReason?: string;
};
type CatalogRow = [number, string, number, string, number, number, number, number, number, [string, number][]];
let catalog: Promise<FoodCandidate[]> | undefined;
export function loadFoodCatalog(): Promise<FoodCandidate[]> {
  return catalog ??= fetch('/data/usda-foods.json').then(async response => {
    if (!response.ok) throw new Error('Could not load the food catalog. Reconnect and try again.');
    const rows: CatalogRow[] = await response.json();
    return rows.map(([id, name, survey, category, kcal, protein, carbs, fat, fibre, portions]) => ({
      id: `import-usda-${id}`, name, provider: 'usda' as const, recordId: String(id),
      source: survey ? 'USDA FNDDS 2021–2023' : 'USDA SR Legacy · April 2018',
      sourceUrl: `https://fdc.nal.usda.gov/food-details/${id}/nutrients`,
      group: foodGroup(category), preparation: preparation(name), estimated: true,
      per100: { kcal, protein, carbs, fat, fibre }, portions: portions.map(([label, grams]) => ({ label, grams })),
    }));
  }).catch(error => { catalog = undefined; throw error; });
}
export function searchCatalog<T extends { name: string; brand?: string; preparation?: string; portions?: { label: string }[] }>(foods: T[], query: string): T[] {
  const cleaned = query.trim().toLowerCase();
  if (cleaned.length < 2) return [];
  return foods.filter(f => matchesSearch(`${f.name} ${f.brand ?? ''} ${f.preparation ?? ''} ${f.portions?.map(p => p.label).join(' ') ?? ''}`, cleaned))
    .sort((a, b) => Number(b.name.toLowerCase() === cleaned) - Number(a.name.toLowerCase() === cleaned) || a.name.length - b.name.length || a.name.localeCompare(b.name));
}
// The website uses its own API; the installed app uses the same deployed proxy.
// Developers can point a native build at another HTTPS deployment with VITE_FOOD_API_URL.
const apiBase = Capacitor.isNativePlatform() ? (import.meta.env.VITE_FOOD_API_URL || 'https://fitness-tracker-one-steel.vercel.app').replace(/\/$/, '') : '';
const cache = new Map<string, unknown>();
let nextSearchAt = 0;
async function requestFood(params: URLSearchParams, signal: AbortSignal): Promise<unknown> {
  const key = params.toString();
  if (cache.has(key)) return cache.get(key);
  if (!navigator.onLine) throw new Error('Packaged-food search needs internet. General foods and your saved library work offline.');
  if (params.has('q') && Date.now() < nextSearchAt) throw new Error('Please wait a few seconds before searching again.');
  if (params.has('q')) nextSearchAt = Date.now() + 6500;
  let response: Response;
  try { response = await fetch(`${apiBase}/api/food-search?${key}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) }); }
  catch (e) { if (signal.aborted) throw e; throw new Error('Food search could not connect. Try again, or use General foods.'); }
  const result = object(await response.json());
  if (!response.ok) throw new Error(text(result.error) || 'Food search is temporarily unavailable. Try again shortly.');
  if (cache.size > 60) cache.clear();
  cache.set(key, result); return result;
}
export async function searchProducts(query: string, page: number, signal: AbortSignal): Promise<{ products: ProductSummary[]; more: boolean }> {
  const d = object(await requestFood(new URLSearchParams({ q: query, page: String(page) }), signal));
  return { products: Array.isArray(d.hits) ? d.hits.map(offSummary).filter((p): p is ProductSummary => p !== null) : [], more: Number(d.page_count) > page };
}
export async function getProduct(code: string, signal: AbortSignal) {
  const d = object(await requestFood(new URLSearchParams({ code }), signal));
  return offCandidate(d.product);
}
export function existingImport(foods: Food[], candidate: FoodCandidate) {
  return foods.find(f => f.id === candidate.id || f.sourceUrl === candidate.sourceUrl || f.importedFrom?.provider === candidate.provider && f.importedFrom.recordId === candidate.recordId);
}
export function candidateFood(candidate: FoodCandidate): Food {
  // Call only after all required nutrient values have been reviewed/validated.
  return { id: candidate.id, name: candidate.name, group: candidate.group, preparation: candidate.preparation,
    per100: candidate.per100 as Macros, source: candidate.source, sourceUrl: candidate.sourceUrl, custom: true,
    brand: candidate.brand, estimated: candidate.estimated, importedFrom: { provider: candidate.provider, recordId: candidate.recordId, modified: false } };
}
