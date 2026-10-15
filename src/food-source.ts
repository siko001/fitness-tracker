import type { Food } from './model.ts';
import type { FoodCandidate } from './food-import.ts';
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
export const object = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
export const text = (x: unknown, max = 200) => typeof x === 'string' ? x.trim().slice(0, max) : '';
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
  const per100: Partial<Food['per100']> = {
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

