import { Capacitor } from '@capacitor/core';
import { matchesSearch } from './Pagination';
import type { Food, Macros } from './model';

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
export function foodGroup(category: string): Food['group'] {
  if (/vegetable|legume|bean|lentil/i.test(category)) return 'Vegetables';
  if (/fruit/i.test(category)) return 'Fruit';
  if (/dairy|milk|cheese|yogurt/i.test(category)) return 'Dairy';
  if (/fat|oil|butter/i.test(category)) return 'Fats';
  if (/poultry|beef|pork|lamb|fish|seafood|egg|meat|protein/i.test(category)) return 'Protein';
  if (/grain|cereal|rice|pasta|bread/i.test(category)) return 'Grains';
  return 'Other';
}
export function preparation(name: string): Food['preparation'] {
  if (/\b(raw|uncooked)\b/i.test(name)) return 'Raw';
  if (/\b(dry|dehydrated)\b/i.test(name)) return 'Dry';
  if (/\b(cooked|roasted|boiled|baked|fried|grilled)\b/i.test(name)) return 'Cooked';
  return 'Ready to eat';
}
export function searchCatalog<T extends { name: string; preparation?: string; portions?: { label: string }[] }>(foods: T[], query: string): T[] {
  const cleaned = query.trim().toLowerCase();
  if (cleaned.length < 2) return [];
  return foods.filter(f => matchesSearch(`${f.name} ${f.preparation ?? ''} ${f.portions?.map(p => p.label).join(' ') ?? ''}`, cleaned))
    .sort((a, b) => Number(b.name.toLowerCase() === cleaned) - Number(a.name.toLowerCase() === cleaned) || a.name.length - b.name.length || a.name.localeCompare(b.name));
}
const object = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
const text = (x: unknown, max = 200) => typeof x === 'string' ? x.trim().slice(0, max) : '';
function value(x: unknown, max = 100) {
  if (x === '' || x === null || typeof x === 'boolean' || (typeof x !== 'number' && typeof x !== 'string')) return undefined;
  const n = Number(x); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 1000) / 1000 : undefined;
}
export function offSummary(raw: unknown) {
  const p = object(raw), code = text(p.code, 32);
  if (!/^\d{8,14}$/.test(code)) return null;
  const name = text(p.product_name_en) || text(p.product_name);
  if (!name) return null;
  return { code, name, brand: Array.isArray(p.brands) ? p.brands.filter(x => typeof x === 'string').join(', ').slice(0, 200) : text(p.brands), quantity: text(p.quantity) };
}
export type ProductSummary = NonNullable<ReturnType<typeof offSummary>>;
export function offCandidate(raw: unknown): FoodCandidate {
  const p = object(raw), summary = offSummary(p);
  if (!summary) throw new Error('This product has no usable name or barcode. Try another result.');
  const set = object(object(p.nutrition).aggregated_set), nutrients = object(set.nutrients);
  const legacy = object(p.nutriments);
  const modern = Object.keys(set).length > 0;
  const basis = modern ? text(set.per) : '100g';
  // v3 explicitly separates mass/volume and prepared/as-sold values. Never use
  // a per-serving or per-100 ml number as a per-100 g nutrient value.
  const volume = /^(100ml|100 ml)$/i.test(basis) || (!modern && /^(ml|l|cl)$/i.test(text(p.product_quantity_unit)));
  const supported = modern ? basis === '100g' && (!set.preparation || set.preparation === 'as_sold') : !volume;
  const get = (key: string, unit: string, max: number) => {
    if (!supported) return undefined;
    if (!modern) return value(legacy[`${key}_100g`], max);
    const n = object(nutrients[key]);
    if (text(n.unit).toLowerCase() !== unit.toLowerCase()) return undefined;
    return value(n.value, max);
  };
  const per100: Partial<Macros> = {
    kcal: get('energy-kcal', 'kcal', 1000) ?? (() => { const kj = get('energy-kj', 'kJ', 4184); return kj === undefined ? undefined : Math.round(kj / 4.184 * 1000) / 1000; })(),
    protein: get('proteins', 'g', 100), carbs: get('carbohydrates', 'g', 100), fat: get('fat', 'g', 100), fibre: get('fiber', 'g', 100),
  };
  const servingText = text(p.serving_size), gramsText = servingText.match(/(?:^|[\s(])(\d+(?:[.,]\d+)?)\s*g\b/i);
  const servingUnit = text(p.serving_quantity_unit);
  const grams = servingUnit === 'g' ? value(p.serving_quantity, 100000) : gramsText ? value(gramsText[1].replace(',', '.'), 100000) : undefined;
  const portions = grams && grams > 0 ? [{ label: servingText || '1 serving', grams }] : [];
  const modified = value(p.last_modified_t, 9e12);
  return {
    id: `import-off-${summary.code}`, recordId: summary.code, provider: 'openfoodfacts', name: summary.name,
    brand: summary.brand, quantity: summary.quantity, source: 'Open Food Facts', sourceUrl: `https://world.openfoodfacts.org/product/${summary.code}`,
    group: 'Other', preparation: 'Ready to eat', per100, portions,
    updated: modified ? new Date(modified * 1000).toISOString().slice(0, 10) : undefined,
    blockedReason: !supported ? volume ? 'This label uses millilitres. Steady currently imports food by grams, so this result cannot be imported.' : 'This source has no nutrition per 100 g as sold. Use another result or add the food manually.' : undefined,
  };
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
    estimated: candidate.estimated, importedFrom: { provider: candidate.provider, recordId: candidate.recordId, modified: false } };
}
