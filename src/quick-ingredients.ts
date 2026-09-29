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
