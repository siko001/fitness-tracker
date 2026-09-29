import { useState } from 'react';
import { candidateFood, loadFoodCatalog, searchCatalog } from './food-import';
import { parseIngredientLines } from './quick-ingredients';
import { Field } from './ui';
import { fmt, type Food, type Recipe } from './model';

type Row = { name: string; grams: string; options: Food[]; chosen: string; included: boolean };
export default function QuickIngredients({ foods, onAdd }: { foods: Food[]; onAdd: (ingredients: Recipe['ingredients']) => void }) {
  const [text, setText] = useState(''), [rows, setRows] = useState<Row[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function match() {
    setBusy(true); setError('');
    try {
      const catalog = (await loadFoodCatalog()).map(candidateFood);
      const combined = [...foods, ...catalog.filter(c => !foods.some(f => f.id === c.id || f.sourceUrl === c.sourceUrl))];
      const parsed = parseIngredientLines(text);
      if (!parsed.length) throw new Error('Paste at least one ingredient.');
      setRows(parsed.map(({ name, grams }) => { const options = searchCatalog(combined, name).slice(0, 8); return { name, grams: grams ? String(grams) : '', options, chosen: options[0]?.id ?? '', included: true }; }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not match ingredients.'); }
    finally { setBusy(false); }
  }
  function update(index: number, patch: Partial<Row>) { setRows(rows.map((r, i) => i === index ? { ...r, ...patch } : r)); }
  const included = rows.filter(r => r.included);
  const ready = included.length > 0 && included.every(r => r.chosen && Number(r.grams) > 0 && Number(r.grams) <= 100000);
  return <div className="quick-ingredients">
    <Field label="Ingredient list" hint="One per line. Include grams if known; otherwise enter them after matching. Up to 30 lines."><textarea rows={5} maxLength={6000} value={text} onChange={e => setText(e.target.value)} placeholder={'Bread 120 g\nTuna 80 g\nTomato paste 15 g\nCapers\nBasil\nOlive oil 10 g'} /></Field>
    <button type="button" className="button secondary" disabled={busy || !text.trim()} onClick={() => void match()}>{busy ? 'Finding foods…' : 'Find ingredients'}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {rows.length > 0 && <><p className="import-note">Review every match and amount. All nutrition below is per 100 g. Missing weights need your estimate or measurement.</p><div className="quick-rows">{rows.map((row, index) => { const food = row.options.find(f => f.id === row.chosen); return <div className="quick-row" key={index}><label className="check-field"><input type="checkbox" checked={row.included} onChange={e => update(index, { included: e.target.checked })} />{row.name}</label><div className="form-grid"><Field label={`Food match for ${row.name}`}><select disabled={!row.included} value={row.chosen} onChange={e => update(index, { chosen: e.target.value })}>{!row.options.length && <option value="">No match — change the name above</option>}{row.options.map(f => <option value={f.id} key={f.id}>{f.name} · {f.preparation}</option>)}</select></Field><Field label={`Grams of ${row.name}`}><input disabled={!row.included} type="number" min="0.1" max="100000" step="any" value={row.grams} onChange={e => update(index, { grams: e.target.value })} placeholder="Enter grams" /></Field></div>{food && <div className="quick-nutrition"><span>{fmt(food.per100.kcal, 1)} kcal · P {fmt(food.per100.protein, 1)} g · C {fmt(food.per100.carbs, 1)} g · F {fmt(food.per100.fat, 1)} g · Fibre {fmt(food.per100.fibre, 1)} g</span>{food.sourceUrl ? <a href={food.sourceUrl} target="_blank" rel="noreferrer">{food.source} ↗</a> : <span>{food.source}</span>}</div>}</div>; })}</div><button type="button" className="button primary" disabled={!ready} onClick={() => { onAdd(included.map(r => ({ food: r.options.find(f => f.id === r.chosen)!, grams: Number(r.grams) }))); setRows([]); setText(''); }}>Add reviewed ingredients</button></>}
  </div>;
}
