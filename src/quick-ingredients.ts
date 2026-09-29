import type { Recipe } from './model';

// Intentionally accept only explicit mass units. "1 tin", teaspoons, slices and
// unlabelled numbers need a reviewed gram weight, never an invented conversion.
export function parseIngredientLines(input: string) {
  return input.split(/\n|;/).map(line => line.trim().replace(/^[-•]\s*/, '')).filter(Boolean).slice(0, 30).map(line => {
    const match = line.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(kg|g|grams?|kilograms?)\b/i);
    const grams = match ? Number(match[1].replace(',', '.')) * (/^k/i.test(match[2]) ? 1000 : 1) : undefined;
    const name = (match ? line.replace(match[0], ' ') : line).replace(/^\s*[-:,]|[-:,]\s*$/g, '').trim();
    return { name, grams: grams && grams <= 100000 ? grams : undefined };
  });
}

// Combine only identical food snapshots, retaining different nutrition/source data.
export function appendIngredients(current: Recipe['ingredients'], added: Recipe['ingredients']): Recipe['ingredients'] {
  const rows = current.map(row => ({ ...row }));
  for (const row of added) {
    const same = rows.find(old => JSON.stringify(old.food) === JSON.stringify(row.food) && old.grams + row.grams <= 100000);
    if (same) same.grams = Math.round((same.grams + row.grams) * 1000000) / 1000000;
    else rows.push({ ...row });
  }
  return rows;
}
