import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { FoodForm } from './dialogs';
import { Field } from './ui';
import { fmt, type Food } from './model';
import Pagination, { paginate } from './Pagination';
import { candidateFood, existingImport, getProduct, loadFoodCatalog, nutrientKeys, searchCatalog, searchProducts, type FoodCandidate, type ProductSummary } from './food-import';

export default function FoodImport({ foods, onSave, onClose }: { foods: Food[]; onSave: (food: Food) => Promise<void>; onClose: () => void }) {
  const [tab, setTab] = useState<'general' | 'packaged'>('general');
  const [query, setQuery] = useState(''), [searched, setSearched] = useState(''), [page, setPage] = useState(1);
  const [general, setGeneral] = useState<FoodCandidate[]>([]), [products, setProducts] = useState<ProductSummary[]>([]), [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [candidate, setCandidate] = useState<FoodCandidate | null>(null), [editing, setEditing] = useState(false), [portion, setPortion] = useState(-1);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; controller.current?.abort(); }, []);
  const resetRequest = () => { controller.current?.abort(); controller.current = new AbortController(); return { signal: controller.current.signal, id: ++sequence.current }; };
  async function search(targetPage = 1) {
    const term = (targetPage === 1 ? query : searched).trim();
    if (term.length < 2) { setError('Enter at least two characters.'); return; }
    const { id, signal } = resetRequest(); setBusy(true); setError('');
    try {
      if (tab === 'general') {
        const result = searchCatalog(await loadFoodCatalog(), term);
        if (id !== sequence.current) return; setGeneral(result);
      } else if (/^\d{8,14}$/.test(term.replace(/[ -]/g, ''))) {
        const result = await getProduct(term.replace(/[ -]/g, ''), signal);
        if (id !== sequence.current) return; choose(result);
      } else {
        const result = await searchProducts(term, targetPage, signal);
        if (id !== sequence.current) return; setProducts(result.products); setMore(result.more);
      }
      setSearched(term); setPage(targetPage);
    } catch (e) { if (id === sequence.current) { setError(e instanceof Error ? e.message : 'Search failed. Please try again.'); setSearched(''); } }
    finally { if (id === sequence.current) setBusy(false); }
  }
  function choose(next: FoodCandidate) { setCandidate(next); setPortion(-1); setEditing(false); setError(''); }
  async function preview(code: string) {
    const { id, signal } = resetRequest(); setBusy(true); setError('');
    try { const next = await getProduct(code, signal); if (id === sequence.current) choose(next); }
    catch (e) { if (id === sequence.current) setError(e instanceof Error ? e.message : 'Could not load this product.'); }
    finally { if (id === sequence.current) setBusy(false); }
  }
  const existing = candidate ? existingImport(foods, candidate) : undefined;
  const results = paginate(general, page, 10);
  const serving = candidate?.portions[portion];
  const source = candidate && <div className="import-source"><strong>{candidate.provider === 'usda' ? 'Reference estimate' : 'Packaged product · check the label'}</strong><a href={candidate.sourceUrl} target="_blank" rel="noreferrer">{candidate.source} ↗</a>{candidate.brand && <span>{candidate.brand}{candidate.quantity ? ` · ${candidate.quantity}` : ''}</span>}<small>{candidate.provider === 'usda' ? `FoodData Central ID ${candidate.recordId}` : `Barcode ${candidate.recordId}`}{candidate.updated ? ` · Updated ${candidate.updated}` : ''}</small></div>;
  return <div className="food-import">
    <ol className="import-steps" aria-label="Import progress"><li aria-current={!candidate ? 'step' : undefined}>1. Search</li><li aria-current={candidate && !editing ? 'step' : undefined}>2. Preview</li><li aria-current={editing ? 'step' : undefined}>3. Review & add</li></ol>
    {candidate ? <>
      <button className="text-button back" onClick={() => { if (editing) setEditing(false); else setCandidate(null); }}><ArrowLeft size={16} />{editing ? 'Back to preview' : 'Back to results'}</button>
      {source}
      {editing ? <FoodForm key={candidate.id} food={{ ...candidateFood(candidate), serving }} importing onSave={onSave} onClose={onClose} /> : <>
        <h3 className="import-food-name">{candidate.name}</h3>
        <p className="muted">{candidate.preparation} · nutrition per 100 g</p>
        {candidate.blockedReason ? <p className="form-error" role="alert">{candidate.blockedReason}</p> : <>
          <table className="import-nutrition"><thead><tr><th>Nutrient</th><th>Per 100 g</th><th>{serving ? `${fmt(serving.grams, 1)} g portion` : 'Your preview'}</th></tr></thead><tbody>{nutrientKeys.map(key => <tr key={key}><th>{key === 'kcal' ? 'Energy' : key.charAt(0).toUpperCase() + key.slice(1)}</th><td>{candidate.per100[key] == null ? 'Missing' : `${fmt(candidate.per100[key]!, 1)} ${key === 'kcal' ? 'kcal' : 'g'}`}</td><td>{candidate.per100[key] == null ? '—' : `${fmt(candidate.per100[key]! * (serving?.grams ?? 100) / 100, 1)} ${key === 'kcal' ? 'kcal' : 'g'}`}</td></tr>)}</tbody></table>
          <Field label="Reference portion"><select value={portion} onChange={e => setPortion(Number(e.target.value))}><option value={-1}>100 g · no saved serving</option>{candidate.portions.map((p, i) => <option value={i} key={i}>{p.label} ({fmt(p.grams, 1)} g)</option>)}</select></Field>
          <p className="import-note">{candidate.provider === 'usda' ? 'Recipes and portion sizes vary. Check the match and weigh your own portion.' : 'Community data can be incomplete. Match the brand, barcode and nutrition label.'} {candidate.portions.length ? 'You can change the serving weight next.' : 'Add your own serving weight in the next step.'}</p>
          {nutrientKeys.some(k => candidate.per100[k] == null) && <p className="callout">Missing nutrients stay blank. Complete them from the label before adding.</p>}
        </>}
        {existing && <p className="callout">Already in your library as <strong>{existing.name}</strong>. Edit it from the library.</p>}
        <div className="form-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!!existing || !!candidate.blockedReason} onClick={() => setEditing(true)}>Review & add</button></div>
      </>}
    </> : <>
      <div className="segmented">{(['general', 'packaged'] as const).map(t => <button type="button" key={t} aria-pressed={tab === t} className={tab === t ? 'selected' : ''} onClick={() => { resetRequest(); setTab(t); setSearched(''); setError(''); setBusy(false); setPage(1); }}>{t === 'general' ? 'General foods' : 'Packaged products'}</button>)}</div>
      <form className="import-search" onSubmit={e => { e.preventDefault(); void search(); }}><div className="search-box"><Search size={18} /><input autoFocus aria-label="Search food sources" maxLength={100} value={query} onChange={e => setQuery(e.target.value)} placeholder={tab === 'general' ? 'e.g. carrot cake, rice, tuna…' : 'Product name or barcode…'} /></div><button className="button primary" disabled={busy || query.trim().length < 2}>{busy ? 'Searching…' : 'Search'}</button></form>
      <p className="import-note">{tab === 'general' ? 'USDA reference foods & dishes · available offline after download' : 'Open Food Facts · internet needed · search by name or type a barcode'}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {busy && <p role="status" className="muted">Loading food information…</p>}
      {searched && !busy && <>
        <div className="import-results">{tab === 'general' ? results.items.map(f => <button className="import-result" key={f.id} onClick={() => choose(f)}><span><strong>{f.name}</strong><small>{f.source} · {f.preparation}</small></span><span>{fmt(f.per100.kcal!)} kcal<small>per 100 g · Preview →</small></span></button>) : products.map(p => <button className="import-result" key={p.code} onClick={() => void preview(p.code)}><span><strong>{p.name}</strong><small>{p.brand || 'Brand not listed'} {p.quantity}</small><small>{p.code}</small></span><span>Preview →</span></button>)}</div>
        {tab === 'general' ? results.total ? <Pagination {...results} label="Import search pages" onChange={setPage} /> : <p className="callout">No matches. Try fewer words, a common ingredient name, or Packaged products.</p> : products.length ? <div className="import-paging"><button className="button secondary" disabled={page <= 1} onClick={() => void search(page - 1)}>Previous</button><span>Page {page}</span><button className="button secondary" disabled={!more} onClick={() => void search(page + 1)}>Next</button></div> : <p className="callout">No products found. Try the barcode or add values from the label.</p>}
      </>}
      <details className="help-details"><summary>Sources & estimates</summary><p>General foods: <a href="https://fdc.nal.usda.gov/download-datasets/" target="_blank" rel="noreferrer">USDA FoodData Central</a>, SR Legacy April 2018 and FNDDS 2021–2023 (public domain). These are reference recipes, not your café’s exact dish.</p><p>Packaged products: <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> contributors, <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL</a>. Only your search or barcode is sent. Reviewing or editing here does not change the public source.</p></details>
    </>}
  </div>;
}
