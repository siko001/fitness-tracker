import { useRef, useState, type FormEvent } from 'react';
import { Plus, Search, Trash2, Check, Utensils, ArrowLeft } from 'lucide-react';
import QuickIngredients from './QuickIngredients';
import { appendIngredients } from './quick-ingredients';
import Pagination, { paginate, matchesSearch } from './Pagination';
import { Field, FormActions, MacroStrip, formValues, numeric, optionalNumeric } from './ui';
import { activitySchema, entrySchema, foodSchema, recipeSchema, dateSchema, meals, fmt, uid, localDate, scale, recipePer100, recipeTotals, type Food, type Recipe, type Entry, type Meal, type State, type Activity, type Macros } from './model';

function useSubmit(onSave: (value: any) => Promise<void>) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(produce: () => unknown) {
    setBusy(true); setError('');
    try { await onSave(produce()); } catch (e) { setError(e instanceof Error && e.name !== 'ZodError' ? e.message : 'Please check the values. Use positive amounts and complete the required fields.'); } finally { setBusy(false); }
  }
  return { busy, error, submit };
}

const nowTime = () => new Date().toTimeString().slice(0, 5);
type Selection = { id: string; name: string; preparation: string; per100: Macros; foodId?: string; recipeId?: string; servingGrams?: number };
export function LogForm({ state, date, meal, entry, onSave, onClose }: { state: State; date: string; meal: Meal; entry?: Entry; onSave: (e: Entry) => Promise<void>; onClose: () => void }) {
  const [query, setQuery] = useState(''), [tab, setTab] = useState<'Foods' | 'Recipes'>('Foods'), [page, setPage] = useState(1);
  const picker = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(entry ? { id: entry.foodId ?? entry.recipeId ?? entry.id, name: entry.name, preparation: entry.preparation, per100: entry.per100, foodId: entry.foodId, recipeId: entry.recipeId, servingGrams: entry.recipeId ? (() => { const r = state.recipes.find(r => r.id === entry.recipeId); return r ? r.yieldGrams / r.servings : undefined; })() : state.foods.find(f => f.id === entry.foodId)?.serving?.grams } : null);
  const [amount, setAmount] = useState(String(entry?.grams ?? 100)), [unit, setUnit] = useState('grams');
  const { submit, error, busy } = useSubmit(onSave);
  const grams = Number(amount) * (unit === 'servings' ? selection?.servingGrams ?? 1 : 1);
  const options: Selection[] = tab === 'Foods' ? state.foods.map(f => ({ ...f, foodId: f.id, servingGrams: f.serving?.grams })) : state.recipes.map(r => ({ id: r.id, recipeId: r.id, name: r.name, preparation: 'Prepared recipe', per100: recipePer100(r), servingGrams: r.yieldGrams / r.servings }));
  const result = paginate(options.filter(f => matchesSearch(`${f.name} ${f.preparation}`, query)), page, 20);
  function save(e: FormEvent<HTMLFormElement>) {
    const data = formValues(e);
    void submit(() => { if (!selection) throw new Error('Choose a food or recipe first.'); return entrySchema.parse({ id: entry?.id ?? uid(), date: data.get('date'), meal: data.get('meal'), name: selection.name, preparation: selection.preparation, grams, per100: selection.per100, time: data.get('time') || undefined, foodId: selection.foodId, recipeId: selection.recipeId }); });
  }
  return <form onSubmit={save}>
    {!selection ? <><div className="segmented">{(['Foods', 'Recipes'] as const).map(t => <button type="button" key={t} className={tab === t ? 'selected' : ''} onClick={() => { setTab(t); setPage(1); picker.current?.scrollTo(0, 0); }}>{t}</button>)}</div><div className="search-box"><Search size={18} /><input autoFocus aria-label="Search foods or recipes" value={query} onChange={e => { setQuery(e.target.value); setPage(1); picker.current?.scrollTo(0, 0); }} placeholder={tab === 'Foods' ? 'Search chicken, rice, beans…' : 'Search your recipes…'} /></div>
      <div className="food-picker" ref={picker}>{result.items.map(f => <button className="food-option" type="button" key={f.id} onClick={() => { setSelection(f); setUnit('grams'); }}><span className="food-icon"><Utensils size={18} /></span><span><strong>{f.name}</strong><small>{f.preparation} · per 100 g</small></span><b>{fmt(f.per100.kcal)}<small> kcal</small></b><Plus size={17} /></button>)}{!result.total && <p className="muted picker-empty">{tab === 'Recipes' ? 'Create a recipe in the Recipes tab first.' : 'No matches. Add your own food in the Food library.'}</p>}</div><div className="picker-pagination"><Pagination {...result} label="Food picker pages" onChange={next => { setPage(next); picker.current?.scrollTo(0, 0); }} /></div></> : <><button className="text-button back" type="button" onClick={() => setSelection(null)}><ArrowLeft size={16} />Choose another food</button><div className="selected-food"><span className="food-icon"><Check size={22} /></span><div><h3>{selection.name}</h3><p>{selection.preparation} · {fmt(selection.per100.kcal)} kcal per 100 g</p></div></div><div className="form-grid"><Field label={unit === 'servings' ? 'Servings eaten' : 'Amount eaten (g)'}><input autoFocus type="number" min="0.1" max="100000" step="any" required value={amount} onChange={e => setAmount(e.target.value)} /></Field>{selection.servingGrams && <Field label="Measure"><select value={unit} onChange={e => { setUnit(e.target.value); setAmount(e.target.value === 'servings' ? '1' : '100'); }}><option value="grams">Grams</option><option value="servings">Servings ({fmt(selection.servingGrams)} g each)</option></select></Field>}</div><div className="nutrition-preview"><div><strong>{fmt(Number.isFinite(grams) ? selection.per100.kcal * grams / 100 : 0)}</strong><span>kcal for this portion</span></div><MacroStrip macros={scale(selection.per100, Number.isFinite(grams) ? grams / 100 : 0)} /></div></>}
    <Field label="Time eaten" hint="Optional · use the time you ate, even when logging later."><input name="time" type="time" defaultValue={entry?.time ?? (state.entries.some(e => e.id === entry?.id) || date !== localDate() ? '' : nowTime())} /></Field>
    <div className="form-grid"><Field label="Meal"><select name="meal" defaultValue={meal}>{meals.map(m => <option key={m}>{m}</option>)}</select></Field><Field label="Date"><input name="date" type="date" required defaultValue={date} /></Field></div>{error && <p className="form-error" role="alert">{error}</p>}<FormActions busy={busy} onClose={onClose} label={entry && state.entries.some(e => e.id === entry.id) ? 'Save changes' : 'Add to diary'} />
  </form>;
}

export function FoodForm({ food, importing = false, onSave, onClose }: { food?: Food; importing?: boolean; onSave: (f: Food) => Promise<void>; onClose: () => void }) {
  const { submit, busy, error } = useSubmit(onSave);
  function save(e: FormEvent<HTMLFormElement>) {
    const d = formValues(e);
    void submit(() => {
      const servingGrams = optionalNumeric(d, 'servingGrams');
      const per100 = Object.fromEntries(['kcal', 'protein', 'carbs', 'fat', 'fibre'].map(k => [k, numeric(d, k)]));
      const edited = food && (JSON.stringify(per100) !== JSON.stringify(food.per100) || d.get('name') !== food.name || d.get('preparation') !== food.preparation);
      return foodSchema.parse({ ...food, id: food?.id ?? uid(), name: d.get('name'), group: d.get('group'), preparation: d.get('preparation'), custom: true,
        source: food?.source ?? 'Your nutrition label', per100, estimated: d.get('estimated') === 'on',
        serving: servingGrams === null ? undefined : { label: String(d.get('servingLabel') || '').trim() || '1 serving', grams: servingGrams },
        importedFrom: food?.importedFrom ? { ...food.importedFrom, modified: food.importedFrom.modified || !!edited } : undefined,
      });
    });
  }
  return <form onSubmit={save}>
    {!importing && food?.sourceUrl && <div className="import-source"><a href={food.sourceUrl} target="_blank" rel="noreferrer">{food.source} ↗</a>{food.importedFrom?.modified && <small>Locally edited</small>}</div>}
    <Field label="Food name"><input autoFocus name="name" required maxLength={200} defaultValue={food?.name} placeholder="e.g. My favourite chicken breast" /></Field>
    <div className="form-grid"><Field label="Category"><select name="group" defaultValue={food?.group ?? 'Other'}>{['Protein', 'Grains', 'Vegetables', 'Fruit', 'Dairy', 'Fats', 'Other'].map(g => <option key={g}>{g}</option>)}</select></Field><Field label="Weighed as"><select name="preparation" defaultValue={food?.preparation ?? 'Ready to eat'}>{['Raw', 'Cooked', 'Dry', 'Ready to eat'].map(g => <option key={g}>{g}</option>)}</select></Field></div>
    <div className="callout">Nutrition <strong>per 100 g</strong>.{importing && ' Check the source and fill any missing values.'}</div>
    <div className="form-grid">{(['kcal', 'protein', 'carbs', 'fat', 'fibre'] as const).map(k => <Field key={k} label={k === 'kcal' ? 'Energy (kcal)' : `${k.charAt(0).toUpperCase() + k.slice(1)} (g)`}><input type="number" name={k} min="0" max={k === 'kcal' ? 1000 : 100} step="any" required defaultValue={food?.per100[k] ?? (importing || k === 'kcal' ? '' : 0)} placeholder={importing ? 'Missing — enter from label' : undefined} /></Field>)}</div>
    <h3 className="form-section">Optional serving</h3><div className="form-grid"><Field label="Serving name"><input name="servingLabel" maxLength={200} defaultValue={food?.serving?.label} placeholder="e.g. 1 slice or 1 sandwich" /></Field><Field label="Serving weight (g)"><input type="number" name="servingGrams" min="0.1" max="100000" step="any" defaultValue={food?.serving?.grams} placeholder="Weighed or estimated grams" /></Field></div>
    <label className="check-field"><input type="checkbox" name="estimated" defaultChecked={food?.estimated} />Reference or estimated food</label>
    {importing && <label className="check-field"><input type="checkbox" required />I’ve checked the food, source and nutrition.</label>}
    {error && <p className="form-error" role="alert">{error}</p>}<FormActions busy={busy} onClose={onClose} label={importing ? 'Add to library' : food ? 'Save food' : 'Create food'} />
  </form>;
}

export function RecipeForm({ state, recipe, onSave, onClose }: { state: State; recipe?: Recipe; onSave: (r: Recipe) => Promise<void>; onClose: () => void }) {
  const [ingredients, setIngredients] = useState(recipe?.ingredients ?? []);
  const [ingredientMode, setIngredientMode] = useState<'single' | 'paste'>('single');
  const [foodId, setFoodId] = useState(state.foods[0]?.id ?? ''), [grams, setGrams] = useState('100');
  const [ingredientQuery, setIngredientQuery] = useState(''), [ingredientPage, setIngredientPage] = useState(1);
  const ingredientResult = paginate(state.foods.filter(f => matchesSearch(`${f.name} ${f.preparation}`, ingredientQuery)), ingredientPage, 30);
  const selectedId = ingredientResult.items.some(f => f.id === foodId) ? foodId : ingredientResult.items[0]?.id ?? '';
  const { submit, busy, error } = useSubmit(onSave);
  const totals = recipeTotals({ ingredients });
  function save(e: FormEvent<HTMLFormElement>) {
    const d = formValues(e); void submit(() => recipeSchema.parse({ id: recipe?.id ?? uid(), name: d.get('name'), ingredients, yieldGrams: numeric(d, 'yield'), servings: numeric(d, 'servings'), estimated: d.get('estimated') === 'on' }));
  }
  return <form onSubmit={save}><Field label="Recipe name"><input autoFocus name="name" required maxLength={200} defaultValue={recipe?.name} placeholder="e.g. Chicken, rice & greens" /></Field><h3 className="form-section">Ingredients</h3><div className="segmented ingredient-method" role="group" aria-label="Add ingredients"><button type="button" aria-pressed={ingredientMode === 'single'} className={ingredientMode === 'single' ? 'selected' : ''} onClick={() => setIngredientMode('single')}>Add one</button><button type="button" aria-pressed={ingredientMode === 'paste'} className={ingredientMode === 'paste' ? 'selected' : ''} onClick={() => setIngredientMode('paste')}>Paste a list</button></div><fieldset className="ingredient-mode-pane" hidden={ingredientMode !== 'paste'} disabled={ingredientMode !== 'paste'}><QuickIngredients foods={state.foods} onAdd={items => setIngredients(current => appendIngredients(current, items))} /></fieldset><fieldset className="ingredient-mode-pane" hidden={ingredientMode !== 'single'} disabled={ingredientMode !== 'single'}>{state.foods.length > 30 && <div className="ingredient-search"><div className="search-box"><Search size={18} /><input aria-label="Search ingredients" placeholder="Search ingredients…" value={ingredientQuery} onChange={e => { setIngredientQuery(e.target.value); setIngredientPage(1); }} /></div><Pagination {...ingredientResult} label="Ingredient pages" onChange={setIngredientPage} /></div>}<div className="ingredient-builder"><Field label="Ingredient"><select value={selectedId} onChange={e => setFoodId(e.target.value)}>{!ingredientResult.total && <option value="">No matches</option>}{ingredientResult.items.map(f => <option value={f.id} key={f.id}>{f.name} · {f.preparation}</option>)}</select></Field><Field label="Grams"><input type="number" min="0.1" max="100000" step="any" value={grams} onChange={e => setGrams(e.target.value)} /></Field><button className="icon-button add-ingredient" aria-label="Add ingredient" type="button" disabled={!selectedId || !(Number(grams) > 0) || Number(grams) > 100000} onClick={() => { const food = state.foods.find(f => f.id === selectedId)!; setIngredients(current => appendIngredients(current, [{ food, grams: Number(grams) }])); }}><Plus size={20} /></button></div></fieldset><div className="ingredient-list-heading">{ingredients.length} {ingredients.length === 1 ? 'ingredient' : 'ingredients'}</div><div className="ingredients" role="region" aria-label="Recipe ingredients" tabIndex={ingredients.length > 4 ? 0 : undefined}>{ingredients.map((i, index) => <div className="ingredient" key={index}><span><strong>{i.food.name}</strong><small>{i.food.preparation} · {fmt(i.grams, 1)} g</small></span><span>{fmt(i.food.per100.kcal * i.grams / 100)} kcal</span><button type="button" className="icon-button" aria-label={`Remove ingredient ${index + 1}`} onClick={() => setIngredients(ingredients.filter((_, n) => n !== index))}><Trash2 size={16} /></button></div>)}{!ingredients.length && <p className="muted">Include cooking oil and sauces.</p>}</div><div className="recipe-total"><span>Whole recipe</span><strong>{fmt(totals.kcal)} kcal</strong></div><MacroStrip macros={totals} /><div className="form-grid"><Field label="Finished dish weight (g)" hint="Weigh the whole cooked dish, without the container."><input name="yield" type="number" min="0.1" max="1000000" step="any" required defaultValue={recipe?.yieldGrams} placeholder="e.g. 1,000" /></Field><Field label="Number of servings"><input name="servings" type="number" min="0.1" max="10000" step="any" required defaultValue={recipe?.servings ?? 1} /></Field></div><label className="check-field"><input name="estimated" type="checkbox" defaultChecked={recipe?.estimated} />Estimated recipe or portions</label>{error && <p className="form-error" role="alert">{error}</p>}<FormActions busy={busy} onClose={onClose} label={recipe ? 'Save recipe' : 'Create recipe'} /></form>;
}

export function ActivityForm({ date, activity, onSave, onClose, onRemove }: { date: string; activity?: Activity; onSave: (a: Activity) => Promise<void>; onClose: () => void; onRemove?: () => void }) {
  const { submit, busy, error } = useSubmit(onSave);
  function save(e: FormEvent<HTMLFormElement>) {
    const d = formValues(e); void submit(() => {
      const record = activitySchema.parse({ date: d.get('date'), steps: optionalNumeric(d, 'steps'), activeKcal: optionalNumeric(d, 'activeKcal'), distanceKm: optionalNumeric(d, 'distanceKm'), source: 'manual', updatedAt: new Date().toISOString() });
      if ([record.steps, record.activeKcal, record.distanceKm].every(v => v === null)) throw new Error('Enter at least one daily total.'); return record;
    });
  }
  return <form onSubmit={save}><div className="callout"><strong>Daily totals</strong> replace imported data for this date. Leave unknown values blank.</div><Field label="Date"><input name="date" type="date" required defaultValue={date} /></Field><div className="form-grid"><Field label="Steps"><input autoFocus name="steps" type="number" min="0" max="500000" step="1" defaultValue={activity?.steps ?? ''} /></Field><Field label="Active calories (kcal)" hint="Use active calories, not total daily burn."><input name="activeKcal" type="number" min="0" max="30000" step="any" defaultValue={activity?.activeKcal ?? ''} /></Field><Field label="Walking / running distance (km)"><input name="distanceKm" type="number" min="0" max="1000" step="any" defaultValue={activity?.distanceKm ?? ''} /></Field></div>{error && <p className="form-error" role="alert">{error}</p>}{onRemove && <button type="button" className="text-button danger" onClick={onRemove}>Remove manual totals for this day</button>}<FormActions busy={busy} onClose={onClose} label="Save daily activity" /></form>;
}
export function WeightForm({ date, kg, onSave, onClose }: { date: string; kg?: number; onSave: (v: { date: string; kg: number }) => Promise<void>; onClose: () => void }) {
  const { submit, busy, error } = useSubmit(onSave);
  return <form onSubmit={e => { const d = formValues(e); void submit(() => { const kg = numeric(d, 'kg'); if (!Number.isFinite(kg) || kg < 25 || kg > 500) throw new Error('Enter a weight between 25 and 500 kg.'); return { date: dateSchema.parse(d.get('date')), kg }; }); }}><div className="form-grid"><Field label="Weight (kg)"><input name="kg" autoFocus type="number" min="25" max="500" step="0.1" required defaultValue={kg} placeholder="110.0" /></Field><Field label="Date"><input name="date" type="date" required defaultValue={date} /></Field></div><p className="muted">One weigh-in per day. Saving again updates that day’s measurement.</p>{error && <p className="form-error" role="alert">{error}</p>}<FormActions busy={busy} onClose={onClose} label="Save weigh-in" /></form>;
}
