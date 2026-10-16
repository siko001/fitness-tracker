import { assistantDestination, getAssistantKey } from './food-assistant';
import { labelReadingSchema, type LabelReading } from './label-schema';
import { entrySchema, foodSchema, portionUnit, uid, type Food, type Meal, type State } from './model';
import { foodIdentity } from './assistant-schema';

export const labelNutrients = ['kcal', 'protein', 'carbs', 'fat', 'fibre'] as const;
export type LabelDraft = {
  id: string; name: string; brand: string; category: Food['group']; barcode: string;
  basisAmount: string; unit: 'g' | 'ml' | ''; values: Record<typeof labelNutrients[number], string>;
  fibreMissing: boolean; servingAmount: string; notes: string; warnings: string[];
};
export function draftFromLabel(reading: LabelReading): LabelDraft {
  const kcal = reading.nutrients.kcal ?? (reading.nutrients.kj != null ? Math.round(reading.nutrients.kj / 4.184 * 1000) / 1000 : null);
  return { id: uid(), name: reading.name ?? '', brand: reading.brand ?? '', category: reading.category ?? 'Other',
    barcode: reading.barcode?.replace(/\s/g, '') ?? '', basisAmount: reading.basisAmount?.toString() ?? '', unit: reading.unit ?? '',
    values: Object.fromEntries(labelNutrients.map(k => [k, (k === 'kcal' ? kcal : reading.nutrients[k])?.toString() ?? ''])) as LabelDraft['values'],
    fibreMissing: reading.nutrients.fibre === null,
    servingAmount: reading.servingUnit && reading.servingUnit === reading.unit ? reading.servingAmount?.toString() ?? '' : '',
    notes: [reading.notes, reading.nutrients.kcal === null && reading.nutrients.kj != null ? 'Energy converted from printed kJ to kcal.' : ''].filter(Boolean).join(' ').slice(0, 1200), warnings: reading.warnings,
  };
}
export function draftFromSavedFood(food: Food): LabelDraft {
  return { id: food.id, name: food.name, brand: food.brand ?? '', category: food.group, barcode: food.barcode ?? '',
    basisAmount: '100', unit: portionUnit(food), values: Object.fromEntries(labelNutrients.map(k => [k, String(food.per100[k])])) as LabelDraft['values'],
    fibreMissing: !!food.fibreMissing, servingAmount: food.serving?.grams.toString() ?? '', notes: food.notes ?? '', warnings: [],
  };
}
export function foodFromLabel(draft: LabelDraft): Food {
  const basis = Number(draft.basisAmount);
  if (!draft.unit || !Number.isFinite(basis) || basis <= 0 || basis > 100000) throw new Error('Confirm the label quantity and whether it uses g or ml.');
  if (!draft.name.trim()) throw new Error('Enter the product name.');
  const values = Object.fromEntries(labelNutrients.map(k => {
    if (k === 'fibre' && draft.fibreMissing) return [k, 0];
    const raw = draft.values[k].trim(), value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < 0) throw new Error(`Enter ${k === 'kcal' ? 'energy' : k} from the label.`);
    return [k, Math.round(value / basis * 100 * 1000000) / 1000000];
  }));
  const result = foodSchema.safeParse({ id: draft.id, name: draft.name.trim(), brand: draft.brand.trim() || undefined,
    group: draft.category, preparation: 'Ready to eat', per100: values, unit: draft.unit === 'ml' ? 'ml' : undefined,
    custom: true, source: 'Nutrition label · photo scan', notes: draft.notes, fibreMissing: draft.fibreMissing || undefined,
    barcode: draft.barcode.trim() || undefined,
    serving: draft.servingAmount.trim() ? { label: '1 serving', grams: Number(draft.servingAmount) } : undefined,
  });
  if (!result.success) throw new Error('Check the barcode, serving size and nutrition values. Make sure all values come from the same label column.');
  return result.data;
}
export function labelMatch(foods: Food[], draft: LabelDraft): Food | undefined {
  return foods.find(f => f.id === draft.id || draft.barcode && f.barcode === draft.barcode || draft.name.trim() && draft.unit && foodIdentity(f) === foodIdentity({ name: draft.name, brand: draft.brand, preparation: 'Ready to eat', unit: draft.unit }));
}
export function applyLabelFood(state: State, food: Food, entryId: string, log: { date: string; meal: Meal; amount: number; time?: string } | null): State {
  food = foodSchema.parse(food);
  const existing = labelMatch(state.foods, draftFromSavedFood(food));
  if (existing) {
    if (portionUnit(existing) !== portionUnit(food) || !!existing.fibreMissing !== !!food.fibreMissing || labelNutrients.some(k => Math.abs(existing.per100[k] - food.per100[k]) > .000001)) throw new Error('This product is already saved with different nutrition. Choose “Use saved product” or edit it in the library.');
    food = existing;
  }
  const foods = existing ? state.foods : [...state.foods, food];
  if (!log) return { ...state, foods };
  const entry = entrySchema.parse({ id: entryId, date: log.date, meal: log.meal, time: log.time,
    name: food.brand && !food.name.toLowerCase().includes(food.brand.toLowerCase()) ? `${food.name} · ${food.brand}` : food.name,
    preparation: food.preparation, grams: log.amount, unit: food.unit, fibreMissing: food.fibreMissing,
    per100: food.per100, foodId: food.id, estimated: food.estimated });
  return { ...state, foods, entries: state.entries.some(e => e.id === entryId) ? state.entries : [...state.entries, entry],
    skippedMeals: state.skippedMeals.filter(s => s.date !== log.date || s.meal !== log.meal) };
}

/** Re-encode on this device: bounded upload, correct camera orientation, no EXIF location metadata. */
export async function prepareLabelPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.size > 20_000_000) throw new Error('Choose an image up to 20 MB.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('This image format could not be opened. Try a JPG, PNG or WebP photo.'); }
  try {
    if (bitmap.width * bitmap.height > 60000000) throw new Error('This image is too large. Use a closer crop of the label.');
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Photo processing is unavailable in this browser.');
    for (const edge of [2000, 1700, 1400, 1100]) {
      const ratio = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', .85);
      if (data.length < 800000) return data;
    }
    throw new Error('The photo is too detailed to upload. Crop closer to the nutrition label.');
  } finally { bitmap.close(); }
}
export async function readLabelPhotos(images: string[], signal: AbortSignal): Promise<LabelReading> {
  if (!navigator.onLine) throw new Error('Scanning needs internet. You can still review or save a draft offline.');
  const { url, token } = await assistantDestination(), key = getAssistantKey();
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ operation: 'scan_label', images, ...(key ? { apiKey: key } : {}) }), signal: AbortSignal.any([signal, AbortSignal.timeout(115000)]) });
  let result;
  try { result = await response.json(); } catch { throw new Error('The scan could not finish. Your photos are still here; try again.'); }
  if (!response.ok) throw new Error(result.error || 'Could not read the label. Please retry.');
  return labelReadingSchema.parse(result);
}
