import { useState } from 'react';
import { ChefHat, Download, Pencil, Plus, Search } from 'lucide-react';
import { fmt, recipeTotals, type Food, type Recipe, type State } from './model';
import { Empty } from './ui';
import Pagination, { matchesSearch, paginate } from './Pagination';

export function FoodLibrary({ state, add, importFood, edit, log }: { state: State; add: () => void; importFood: () => void; edit: (f: Food) => void; log: (f: Food) => void }) {
  const [query, setQuery] = useState(''), [category, setCategory] = useState('All foods');
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const foods = state.foods.filter(f => matchesSearch(`${f.name} ${f.preparation} ${f.group}`, query) && (category === 'All foods' || category === 'My foods' && f.custom || f.group === category))
    .sort((a, b) => a.name.localeCompare(b.name) || a.preparation.localeCompare(b.preparation) || a.id.localeCompare(b.id));
  const result = paginate(foods, page, pageSize);
  const changePage = (next: number) => { setPage(next); window.scrollTo({ top: 0, behavior: 'instant' }); };
  return <>
    <div className="page-heading"><div><h1>Food library</h1></div><div className="heading-actions"><button className="button secondary" onClick={importFood}><Download size={17} />Import food</button><button className="button primary" onClick={add}><Plus size={18} />New food</button></div></div>
    <div className="library-tools"><div className="search-box"><Search size={18} /><input aria-label="Search food library" placeholder="Search foods…" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></div><select aria-label="Food category" value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}>{['All foods', 'My foods', 'Protein', 'Grains', 'Vegetables', 'Fruit', 'Dairy', 'Fats', 'Other'].map(c => <option key={c}>{c}</option>)}</select></div>
    <Pagination {...result} label="Food library pages" onChange={changePage} pageSize={pageSize} onPageSize={size => { setPageSize(size); setPage(1); }} />
    {foods.length ? <section className="card food-list" aria-label="Foods">
      <div className="food-list-heading"><span>Food</span><span>Per 100 g</span></div>
      {result.items.map(f => <article className="food-row" key={f.id}>
        <div className="food-row-name"><h2>{f.name}</h2><div><span className="tag">{f.preparation}</span><span>{f.group}</span>{f.estimated && <span>· Estimate</span>}{f.custom && <span>· My food</span>}</div></div>
        <div className="food-row-energy"><strong>{fmt(f.per100.kcal)}</strong><span>kcal</span></div>
        <div className="food-row-macros">{(['protein', 'carbs', 'fat'] as const).map(key => <span key={key}><small>{key.charAt(0).toUpperCase() + key.slice(1)}</small>{fmt(f.per100[key], 1)} g</span>)}</div>
        <div className="food-row-actions">{f.custom ? <button className="icon-button" aria-label={`Edit ${f.name}`} title="Edit food" onClick={() => edit(f)}><Pencil size={16} /></button> : null}{f.sourceUrl && <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="source-link" aria-label={`Source for ${f.name} ${f.preparation}`}>Source ↗</a>}<button className="round-add" aria-label={`Log ${f.name} ${f.preparation}`} title="Log food" onClick={() => log(f)}><Plus size={19} /></button></div>
      </article>)}
    </section> : <Empty title="No foods found" detail="Try another search or add a food." action={<button className="button primary" onClick={add}>Create a food</button>} />}
    {result.pages > 1 && <Pagination {...result} label="Food library pages, bottom" onChange={changePage} />}
    <details className="help-details"><summary>About nutrition values</summary><p>Values are per 100 g. Match raw, dry or cooked to how you weigh your food. Use package values when available.</p><p>Reference foods: USDA FoodData Central, SR Legacy (April 2018).</p></details>
  </>;
}

export function Recipes({ state, add, edit, log }: { state: State; add: () => void; edit: (r: Recipe) => void; log: (r: Recipe) => void }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(1);
  const recipes = state.recipes.filter(r => matchesSearch(r.name, query)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const result = paginate(recipes, page, 12);
  return <>
    <div className="page-heading"><div><h1>Recipes</h1></div><button className="button primary" onClick={add}><Plus size={18} />New recipe</button></div>
    {state.recipes.length > 0 && <><div className="search-box"><Search size={18} /><input aria-label="Search recipes" placeholder="Search recipes…" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></div><Pagination {...result} label="Recipe pages" onChange={setPage} /></>}
    {recipes.length ? <div className="recipe-grid">{result.items.map(r => { const totals = recipeTotals(r); return <article key={r.id} className="card recipe-card"><div className="recipe-content"><h2>{r.name}</h2><p>{fmt(r.servings, 1)} servings · {fmt(r.yieldGrams)} g finished weight{r.estimated ? ' · Estimate' : ''}</p><strong className="recipe-kcal">{fmt(totals.kcal / r.servings)}<small> kcal / serving</small></strong><div className="recipe-actions"><button className="button secondary" onClick={() => edit(r)}><Pencil size={15} />Edit</button><button className="button primary" onClick={() => log(r)}><Plus size={16} />Log a portion</button></div></div></article>; })}</div> : <section className="card"><Empty title={state.recipes.length ? 'No recipes found' : 'Your recipes'} detail={state.recipes.length ? 'Try another search.' : 'Save a batch, then log portions in grams or servings.'} action={<button className="button primary" onClick={add}><ChefHat size={17} />Create a recipe</button>} /></section>}
    <details className="help-details"><summary>Batch cooking help</summary><p>Add each ingredient with its measured weight, including oil and sauces. Weigh the finished dish without its container and save that cooked weight. Log only the grams or servings you eat.</p></details>
  </>;
}
