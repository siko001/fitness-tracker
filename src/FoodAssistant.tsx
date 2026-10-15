import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Sparkles, Trash2 } from 'lucide-react';
import { askAssistant, assistantConfigured, getAssistantKey, setAssistantKey } from './food-assistant';
import { type ChatMessage, type DraftItem, type ResolvedItem } from './assistant-schema';
import { candidateFood, loadFoodCatalog, searchCatalog } from './food-import';
import { parseIngredientLines } from './quick-ingredients';
import { fmt, localDate, meals, uid, type Food, type Meal, type State } from './model';
import { Field, ModalActions } from './ui';

export default function FoodAssistant({ state, date, meal: initialMeal, libraryOnly = false, onClose, onSave }: {
  state: State; date: string; meal: Meal; libraryOnly?: boolean; onClose: () => void;
  onSave: (items: ResolvedItem[], ids: string[], log: { date: string; meal: Meal; time?: string } | null) => Promise<void>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]), [input, setInput] = useState('');
  const [draft, setDraft] = useState<DraftItem[]>([]), [items, setItems] = useState<ResolvedItem[]>([]);
  const [alternatives, setAlternatives] = useState<Food[][]>([]), [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [configured, setConfigured] = useState(false), [key, setKey] = useState(getAssistantKey());
  const [web, setWeb] = useState(false), [logMeal, setLogMeal] = useState(!libraryOnly), [meal, setMeal] = useState(initialMeal);
  const [entryDate, setEntryDate] = useState(date), [time, setTime] = useState(date === localDate() ? new Date().toTimeString().slice(0, 5) : '');
  const [reviewed, setReviewed] = useState(false);
  const pending = useRef<AbortController | null>(null), end = useRef<HTMLDivElement>(null), saveLock = useRef(false);
  const ids = useRef<string[]>([]);
  useEffect(() => { void assistantConfigured().then(setConfigured).catch(() => {}); return () => pending.current?.abort(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [messages.length]);
  function showItems(next: ResolvedItem[]) { setItems(next); ids.current = next.map(() => uid()); setReviewed(false); }
  async function send(e: FormEvent) {
    e.preventDefault(); if (!input.trim() || busy) return;
    setError(''); setBusy(true); setAssistantKey(key);
    const next: ChatMessage[] = [...messages, { role: 'user', content: input.trim() }];
    const controller = new AbortController(); pending.current = controller;
    try {
      const result = await askAssistant(state, next, draft, web, controller.signal);
      setMessages([...next, { role: 'assistant', content: result.reply }]); setInput(''); setDraft(result.draft);
      // An unresolved correction must not leave an old proposal saveable.
      showItems(result.items); setAlternatives([]); setWarnings(result.warnings);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not reach Groq. Your draft is safe.'); }
    finally { setBusy(false); }
  }
  async function findList() {
    if (busy || !input.trim()) return;
    setBusy(true); setError('');
    try {
      const rawLines = input.split(/\n|;/).filter(x => x.trim());
      if (rawLines.length > 20) throw new Error('Use up to 20 foods at a time.');
      const catalog = await loadFoodCatalog();
      const rows = parseIngredientLines(input), results: ResolvedItem[] = [], choices: Food[][] = [], missing: string[] = [];
      for (const row of rows) {
        const options: Food[] = [...searchCatalog(state.foods, row.name), ...searchCatalog(catalog, row.name).slice(0, 5).map(candidateFood)]
          .filter((food, i, all) => all.findIndex(f => f.id === food.id) === i).slice(0, 6);
        if (!options.length) { missing.push(`No match for “${row.name}”. Try describing it to the assistant.`); continue; }
        const food = options[0]; choices.push(options);
        results.push({ food, grams: row.grams ?? food.serving?.grams ?? null, existing: state.foods.some(f => f.id === food.id), notes: 'Check the food and raw/cooked preparation before saving.' });
      }
      showItems(results); setAlternatives(choices); setDraft(results.map(row => ({ ref: row.existing ? `food:${row.food.id}` : `usda:${row.food.id}`, name: row.food.name, brand: row.food.brand ?? null, preparation: row.food.preparation, grams: row.grams, per100: row.food.per100, portionLabel: row.food.serving?.label ?? null, notes: row.notes, sourceUrls: [] }))); setWarnings(missing);
      setMessages([...messages, { role: 'user', content: input }, { role: 'assistant', content: `Found ${results.length} of ${rows.length} items. Check the matches below. You can save them together.` }]);
      setInput('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not search the food catalog.'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (saveLock.current || !reviewed || !items.length) return;
    saveLock.current = true; setSaving(true); setError('');
    try { await onSave(items, ids.current, logMeal ? { date: entryDate, meal, ...(time ? { time } : {}) } : null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { saveLock.current = false; setSaving(false); }
  }
  return <div className="food-assistant">
    {!messages.length && <div className="assistant-intro"><Sparkles size={24} /><h3>Tell me what you ate.</h3><p>Describe a meal, paste a list, or talk through a portion.</p><button type="button" className="assistant-example" onClick={() => setInput('I’m eating a tuna ftira from Panina in Malta. Help me log it.')}>“A tuna ftira from Panina”</button></div>}
    <details className="assistant-setup" open={!configured && !key}><summary>Groq connection {key ? '· session key added' : configured ? '· server configured' : '· add your key'}</summary>
      <Field label="Groq API key" hint="Kept only for this session. Sent through your server to Groq; never saved in your diary."><input type="password" autoComplete="off" spellCheck={false} value={key} placeholder={configured ? 'Server key configured' : 'gsk_…'} onChange={e => { setKey(e.target.value); setAssistantKey(e.target.value); }} /></Field>
      <p className="muted">For permanent setup, use GROQ_API_KEY and GROQ_ALLOWED_USER_IDS on Vercel. <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a key ↗</a></p>
    </details>
    <div className="assistant-chat" role="log" aria-label="Food conversation">{messages.map((m, i) => <div className={`assistant-message ${m.role}`} key={i}><small>{m.role === 'user' ? 'You' : 'Steady'}</small><p>{m.content}</p></div>)}<div ref={end} /></div>
    {warnings.length > 0 && <div className="callout" role="status">{warnings.map((w, i) => <p key={i}>{w}</p>)}</div>}
    {items.length > 0 && <section className="assistant-review" aria-label="Proposed food"><h3>Ready to review · {items.length} {items.length === 1 ? 'item' : 'items'}</h3>{items.map((item, i) => <article className="assistant-food" key={`${item.food.id}:${i}`}>
      <div className="assistant-food-heading"><div><strong>{item.food.name}</strong>{item.food.brand && <small>{item.food.brand}</small>}</div><button type="button" className="icon-button" aria-label={`Remove proposal ${item.food.name}`} disabled={busy || saving} onClick={() => { setItems(items.filter((_, j) => j !== i)); setAlternatives(alternatives.filter((_, j) => j !== i)); setDraft(draft.filter((_, j) => j !== i)); ids.current.splice(i, 1); setReviewed(false); }}><Trash2 size={16} /></button></div>
      <p className="assistant-food-status">{item.existing ? 'Already saved' : 'New food'} · {item.food.preparation} · {item.food.estimated ? 'Estimated nutrition' : item.food.source}</p>
      {alternatives[i]?.length > 1 && <Field label={`Match for item ${i + 1}`}><select value={item.food.id} onChange={e => { const food = alternatives[i].find(f => f.id === e.target.value)!; const existing = state.foods.some(f => f.id === food.id); setItems(items.map((row, j) => j === i ? { ...row, food, existing } : row)); setDraft(draft.map((row, j) => j === i ? { ...row, ref: `${existing ? 'food' : 'usda'}:${food.id}`, name: food.name, brand: food.brand || null, preparation: food.preparation, per100: food.per100, portionLabel: food.serving?.label || null } : row)); setReviewed(false); }}>{alternatives[i].map(food => <option key={food.id} value={food.id}>{food.name} · {food.preparation}</option>)}</select></Field>}
      <div className="assistant-portion"><Field label={`Grams · ${item.food.name}`}><input type="number" min="0.1" max="100000" step="any" value={item.grams ?? ''} placeholder="Confirm portion" onChange={e => { const grams = e.target.value ? Number(e.target.value) : null; setItems(items.map((row, j) => j === i ? { ...row, grams } : row)); setDraft(draft.map((row, j) => j === i ? { ...row, grams } : row)); setReviewed(false); }} /></Field><strong>{item.grams ? `${fmt(item.food.per100.kcal * item.grams / 100)} kcal` : `${fmt(item.food.per100.kcal)} kcal / 100 g`}</strong></div>
      <details><summary>Nutrition & source</summary><p className="muted">Per 100 g: {fmt(item.food.per100.kcal)} kcal · protein {fmt(item.food.per100.protein, 1)} g · carbs {fmt(item.food.per100.carbs, 1)} g · fat {fmt(item.food.per100.fat, 1)} g · fibre {fmt(item.food.per100.fibre, 1)} g</p><p>{item.notes || item.food.notes}</p><p className="muted">{item.food.source}{item.food.sourceUrl && <> · <a href={/^https?:/.test(item.food.sourceUrl) ? item.food.sourceUrl : undefined} target="_blank" rel="noreferrer">View source ↗</a></>}</p>{item.food.researchUrls?.map(url => <p key={url}><a href={/^https:/.test(url) ? url : undefined} target="_blank" rel="noreferrer">{new URL(url).hostname} ↗</a> <small>AI research lead</small></p>)}</details>
    </article>)}
      <label className="check-field"><input type="checkbox" checked={logMeal} onChange={e => setLogMeal(e.target.checked)} />Also log what I ate</label>
      {logMeal && <div className="form-grid"><Field label="Meal"><select value={meal} onChange={e => setMeal(e.target.value as Meal)}>{meals.map(m => <option key={m}>{m}</option>)}</select></Field><Field label="Date"><input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} required /></Field><Field label="Time eaten"><input type="time" value={time} onChange={e => setTime(e.target.value)} /></Field></div>}
      <label className="check-field"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I’ve checked the matches, portions and any estimates.</label>
    </section>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <ModalActions className="assistant-footer"><form onSubmit={send}><label className="sr-only" htmlFor="food-chat">Message the food assistant</label><textarea id="food-chat" value={input} onChange={e => setInput(e.target.value)} maxLength={6000} rows={2} placeholder="Tell me about your meal, or paste a list…" disabled={saving} />
      <div className="assistant-send"><button type="button" className="button secondary" disabled={busy || saving || !input.trim()} onClick={() => void findList()}>Find list</button><button className="button primary" disabled={busy || saving || !input.trim() || (!configured && key.trim().length < 20)}><ArrowUp size={16} />{busy ? 'Looking…' : 'Send'}</button></div>
      <label className="check-field assistant-web"><input type="checkbox" checked={web} onChange={e => setWeb(e.target.checked)} />Research menus online <span>· may use additional Groq quota</span></label>
      {!messages.length && <p className="assistant-disclosure">AI receives this conversation and matching saved foods. Find list uses your library and the offline food catalog.</p>}
    </form><div className="assistant-save"><button className="button secondary" onClick={onClose} disabled={saving}>Close</button><button className="button primary" disabled={!items.length || !reviewed || busy || saving || !!input.trim() || (logMeal && items.some(item => !item.grams || item.grams <= 0 || item.grams > 100000))} onClick={() => void save()}>{saving ? 'Saving…' : logMeal ? 'Save & log meal' : 'Save to library'}</button></div></ModalActions>
  </div>;
}
