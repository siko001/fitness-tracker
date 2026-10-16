import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Sparkles, Trash2, History, Plus, Settings2, Check, Search } from 'lucide-react';
import { chatTitle, emptyRecipeDraft, hasChatContent, newAssistantChat, readAssistantHistory, saveAssistantChat, selectAssistantChat, type AssistantChat, type AssistantHistory } from './assistant-history';
import { assistantRecipeId, assistantRecipeName, type AssistantRecipeOptions } from './assistant-recipes';
import { askAssistant, assistantConfigured, getAssistantKey, setAssistantKey } from './food-assistant';
import { type ChatMessage, type DraftItem, type ResolvedItem } from './assistant-schema';
import { candidateFood, loadFoodCatalog, searchCatalog } from './food-import';
import { parseIngredientLines } from './quick-ingredients';
import { fmt, meals, uid, type Food, type Meal, type State } from './model';
import { Field, ModalActions } from './ui';

type AssistantProps = {
  state: State; date: string; meal: Meal; libraryOnly?: boolean; onClose: () => void;
  onSave: (items: ResolvedItem[], ids: string[], log: { date: string; meal: Meal; time?: string } | null, recipe?: AssistantRecipeOptions) => Promise<void>;
};
export default function FoodAssistant(props: AssistantProps) {
  const [history, setHistory] = useState<AssistantHistory>(), [active, setActive] = useState<AssistantChat>();
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void readAssistantHistory().then(saved => {
      if (cancelled) return;
      setHistory(saved);
      setActive(saved.chats.find(c => c.id === saved.activeId) || newAssistantChat(props.date, props.meal, !!props.libraryOnly));
    }).catch(() => { if (!cancelled) setLoadError('Could not open your chat history. Check browser storage and try reopening. Your saved chats have not been replaced.'); });
    return () => { cancelled = true; };
  }, []);
  const persist = useCallback(async (chat: AssistantChat) => { setHistory(await saveAssistantChat(chat)); }, []);
  async function select(chat?: AssistantChat) {
    try {
      await selectAssistantChat(chat?.id ?? null);
      setActive(chat || newAssistantChat(props.date, props.meal, !!props.libraryOnly));
    } catch { setLoadError('Could not switch chats. Check browser storage and try again.'); }
  }
  if (!active || !history) return <p role="status">{loadError || 'Opening your conversations…'}</p>;
  return <><div role="alert" hidden={!loadError}>{loadError}</div><AssistantConversation key={active.id} {...props} initial={active} chats={history.chats} persist={persist} select={select} /></>;
}
function AssistantReply({ content }: { content: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml allowedElements={['p', 'strong', 'em', 'del', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td']} components={{
    a: ({ href, children }) => /^https?:\/\//i.test(href || '') ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  }}>{content}</Markdown>;
}
function AssistantConversation({ state, initial, chats, persist, select, onClose, onSave }: AssistantProps & {
  initial: AssistantChat; chats: AssistantChat[]; persist: (chat: AssistantChat) => Promise<void>; select: (chat?: AssistantChat) => Promise<void>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages), [input, setInput] = useState(initial.input || (initial.pending ? initial.messages.at(-1)?.content || '' : ''));
  const [draft, setDraft] = useState<DraftItem[]>(initial.draft), [items, setItems] = useState<ResolvedItem[]>(initial.items);
  const [alternatives, setAlternatives] = useState<Food[][]>(initial.alternatives), [warnings, setWarnings] = useState<string[]>(initial.warnings);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [pendingReply, setPendingReply] = useState(initial.pending), [savedAt, setSavedAt] = useState(initial.savedAt);
  const [configured, setConfigured] = useState(false), [key, setKey] = useState(getAssistantKey());
  const [web, setWeb] = useState(initial.web), [logMeal, setLogMeal] = useState(initial.logMeal), [meal, setMeal] = useState(initial.meal);
  const [entryDate, setEntryDate] = useState(initial.date), [time, setTime] = useState(initial.time);
  const [reviewed, setReviewed] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [historyQuery, setHistoryQuery] = useState('');
  const [listHelp, setListHelp] = useState(false);
  const [recipeDraft, setRecipeDraft] = useState(initial.recipeDraft);
  const [storageError, setStorageError] = useState(''), [stored, setStored] = useState(true);
  const pending = useRef<AbortController | null>(null), end = useRef<HTMLDivElement>(null), saveLock = useRef(false);
  const ids = useRef<string[]>(initial.entryIds);
  useEffect(() => { void assistantConfigured().then(setConfigured).catch(() => {}); return () => pending.current?.abort(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }, [messages.length, busy]);
  const recipeId = ids.current[0] ? assistantRecipeId(ids.current[0]) : '';
  const savedRecipe = state.recipes.find(r => r.id === recipeId || items.length === 1 && r.id === items[0].recipeId);
  const recipePending = recipeDraft.enabled && !savedRecipe;
  const recipeWeight = recipeDraft.yieldGrams === null ? items.reduce((sum, item) => sum + (item.grams || 0), 0) : Number(recipeDraft.yieldGrams);
  const recipeServings = Number(recipeDraft.servings);
  const missingPortion = items.some(item => !item.grams || item.grams <= 0 || item.grams > 100000);
  const recipeValid = !!recipeDraft.name.trim() && !missingPortion && recipeWeight > 0 && recipeWeight <= 1000000 && recipeServings > 0 && recipeServings <= 10000;
  const snapshot: AssistantChat = { ...initial, messages, input, draft, items, alternatives, warnings, entryIds: ids.current, web, logMeal, meal, date: entryDate, time, pending: pendingReply, savedAt, recipeDraft };
  const serialized = JSON.stringify(snapshot);
  useEffect(() => {
    if (!hasChatContent(snapshot)) return;
    let current = true;
    setStored(false);
    void persist({ ...snapshot, updatedAt: new Date().toISOString() }).then(() => { if (current) { setStored(true); setStorageError(''); } }).catch(() => { if (current) setStorageError('Could not save this conversation. Keep it open and check browser storage.'); });
    return () => { current = false; };
  }, [serialized, persist]);
  function showItems(next: ResolvedItem[]) { setItems(next); ids.current = next.map(() => uid()); setReviewed(false); if (savedAt) setRecipeDraft(emptyRecipeDraft()); setSavedAt(null); }
  async function send(e: FormEvent) {
    e.preventDefault(); await sendMessage(input.trim());
  }
  async function sendMessage(text: string) {
    if (!text || busy || saving) return;
    setError(''); setBusy(true); setAssistantKey(key);
    setListHelp(false);
    const previous = pendingReply && messages.at(-1)?.role === 'user' ? messages.slice(0, -1) : messages;
    const next: ChatMessage[] = [...previous, { role: 'user', content: text }];
    setMessages(next); setInput(''); setPendingReply(true);
    const controller = new AbortController(); pending.current = controller;
    try {
      const result = await askAssistant(state, next, draft, web, controller.signal);
      setMessages([...next, { role: 'assistant', content: result.reply }]); setInput(''); setPendingReply(false); setDraft(result.draft);
      // An unresolved correction must not leave an old proposal saveable.
      showItems(result.items); setAlternatives([]); setWarnings(result.warnings);
    } catch (e) { if (!controller.signal.aborted) { setInput(text); setError(e instanceof Error ? e.message : 'Could not reach Groq. Your draft is safe.'); } }
    finally { setBusy(false); }
  }
  async function findList() {
    if (busy || saving) return;
    if (!input.trim()) { setListHelp(true); document.getElementById('food-chat')?.focus(); return; }
    setListHelp(false);
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
      setInput(''); setPendingReply(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not search the food catalog.'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (saveLock.current || !reviewed || !items.length || (savedAt && !recipePending) || pendingReply || busy || input.trim() || (recipePending && !recipeValid)) return;
    saveLock.current = true; setSaving(true); setError('');
    try {
      await onSave(items, ids.current, !savedAt && logMeal ? { date: entryDate, meal, ...(time ? { time } : {}) } : null,
        recipePending ? { id: recipeId, name: recipeDraft.name, yieldGrams: recipeWeight, servings: recipeServings } : undefined);
      const now = new Date().toISOString();
      await persist({ ...snapshot, savedAt: savedAt || now, updatedAt: now });
      setSavedAt(savedAt || now); onClose();
    }
    catch (e) { setError(e instanceof Error && e.name !== 'ZodError' ? e.message : 'Check the recipe name, portions, finished weight and servings.'); }
    finally { saveLock.current = false; setSaving(false); }
  }
  return <div className="food-assistant">
    <div className="assistant-toolbar">
      <button className="button secondary" onClick={() => setHistoryOpen(v => !v)} aria-expanded={historyOpen}><History size={16} />History</button>
      <button className="button secondary" disabled={busy || saving} onClick={() => void select()}><Plus size={16} />New chat</button>
      <span className="assistant-autosave" role="status">{storageError ? 'Not saved' : hasChatContent(snapshot) ? stored ? <><Check size={13} />Saved on this device</> : 'Saving…' : ''}</span>
      <button className="icon-button" aria-label="Assistant settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(v => !v)}><Settings2 size={18} /></button>
    </div>
    <div className="assistant-workspace">
    {historyOpen && <aside className="assistant-history" aria-label="Conversation history"><h3>Conversations</h3><label className="assistant-history-search"><Search size={15} /><input aria-label="Search conversations" value={historyQuery} onChange={e => setHistoryQuery(e.target.value)} placeholder="Search chats" /></label><div className="assistant-history-list">{[...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter(c => chatTitle(c).toLowerCase().includes(historyQuery.toLowerCase())).map(c => <button key={c.id} aria-current={c.id === initial.id ? 'true' : undefined} disabled={busy || saving} onClick={() => void select(c)}><strong>{chatTitle(c)}</strong><span>{new Date(c.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {c.savedAt ? 'Meal saved' : 'Conversation'}</span></button>)}{!chats.length && <p>Your chats will appear here.</p>}</div></aside>}
    <div className="assistant-scroll">
    {settingsOpen && <section className="assistant-setup" aria-label="Assistant settings"><h3>AI settings</h3>
      <Field label="Groq API key" hint="Session only. Your key is never saved in chat history."><input type="password" autoComplete="off" spellCheck={false} value={key} placeholder={configured ? 'Server key configured' : 'gsk_…'} onChange={e => { setKey(e.target.value); setAssistantKey(e.target.value); }} /></Field>
      <p className="muted">AI receives this conversation and matching foods. Online research may use extra Groq quota. <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a key ↗</a></p>
    </section>}
    {!configured && key.trim().length < 20 && !settingsOpen && <p className="assistant-key-notice">Add your API key in <button onClick={() => setSettingsOpen(true)}>AI settings</button> to chat. Food list search works without a key.</p>}
    {!messages.length && <div className="assistant-intro"><Sparkles size={30} /><h3>What’s on your plate?</h3><p>Describe your meal. We’ll work out the details together.</p></div>}
    <div className="assistant-chat" role="log" aria-label="Food conversation">{messages.map((m, i) => <div className={`assistant-message ${m.role}`} key={i}><small>{m.role === 'user' ? 'You' : <><Sparkles size={13} />Steady</>}</small><div className="assistant-message-content">{m.role === 'assistant' ? <AssistantReply content={m.content} /> : <p>{m.content}</p>}</div></div>)}
      {busy && <div className="assistant-message assistant assistant-typing" role="status"><small><Sparkles size={13} />Steady</small><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span><span className="sr-only">Steady is replying…</span></div>}
      <div ref={end} />
    </div>
    {pendingReply && !busy && !error && <p className="assistant-key-notice">Your last reply was interrupted. Send your message again to continue.</p>}
    {storageError && <p className="form-error" role="alert">{storageError}</p>}
    {warnings.length > 0 && <div className="callout" role="status">{warnings.map((w, i) => <p key={i}>{w}</p>)}</div>}
    {items.length > 0 && <section className="assistant-review" aria-label="Proposed food"><h3>{savedAt ? 'Saved meal' : 'Ready to review'} · {items.length} {items.length === 1 ? 'item' : 'items'}</h3><div className="assistant-review-grid">{items.map((item, i) => <article className="assistant-food" key={`${item.food.id}:${i}`}>
      <div className="assistant-food-heading"><div><strong>{item.food.name}</strong>{item.food.brand && <small>{item.food.brand}</small>}</div><button type="button" className="icon-button" aria-label={`Remove proposal ${item.food.name}`} disabled={!!savedAt || busy || saving} onClick={() => { setItems(items.filter((_, j) => j !== i)); setAlternatives(alternatives.filter((_, j) => j !== i)); setDraft(draft.filter((_, j) => j !== i)); ids.current.splice(i, 1); setReviewed(false); }}><Trash2 size={16} /></button></div>
      <p className="assistant-food-status">{item.existing ? 'Already saved' : 'New food'} · {item.food.preparation} · {item.food.estimated ? 'Estimated nutrition' : item.food.source}</p>
      {alternatives[i]?.length > 1 && <Field label={`Match for item ${i + 1}`}><select value={item.food.id} disabled={!!savedAt || busy || saving} onChange={e => { const food = alternatives[i].find(f => f.id === e.target.value)!; const existing = state.foods.some(f => f.id === food.id); setItems(items.map((row, j) => j === i ? { ...row, food, existing } : row)); setDraft(draft.map((row, j) => j === i ? { ...row, ref: `${existing ? 'food' : 'usda'}:${food.id}`, name: food.name, brand: food.brand || null, preparation: food.preparation, per100: food.per100, portionLabel: food.serving?.label || null } : row)); setReviewed(false); }}>{alternatives[i].map(food => <option key={food.id} value={food.id}>{food.name} · {food.preparation}</option>)}</select></Field>}
      <div className="assistant-portion"><Field label={`Grams · ${item.food.name}`}><input type="number" min="0.1" max="100000" step="any" value={item.grams ?? ''} placeholder="Confirm portion" disabled={!!savedAt || busy || saving} onChange={e => { const grams = e.target.value ? Number(e.target.value) : null; setItems(items.map((row, j) => j === i ? { ...row, grams } : row)); setDraft(draft.map((row, j) => j === i ? { ...row, grams } : row)); setReviewed(false); }} /></Field><strong>{item.grams ? `${fmt(item.food.per100.kcal * item.grams / 100)} kcal` : `${fmt(item.food.per100.kcal)} kcal / 100 g`}</strong></div>
      <details><summary>Nutrition & source</summary><p className="muted">Per 100 g: {fmt(item.food.per100.kcal)} kcal · protein {fmt(item.food.per100.protein, 1)} g · carbs {fmt(item.food.per100.carbs, 1)} g · fat {fmt(item.food.per100.fat, 1)} g · fibre {fmt(item.food.per100.fibre, 1)} g</p><p>{item.notes || item.food.notes}</p><p className="muted">{item.food.source}{item.food.sourceUrl && <> · <a href={/^https?:/.test(item.food.sourceUrl) ? item.food.sourceUrl : undefined} target="_blank" rel="noreferrer">View source ↗</a></>}</p>{item.food.researchUrls?.map(url => <p key={url}><a href={/^https:/.test(url) ? url : undefined} target="_blank" rel="noreferrer">{new URL(url).hostname} ↗</a> <small>AI research lead</small></p>)}</details>
    </article>)}</div>
      {savedRecipe ? <p className="assistant-recipe-saved"><Check size={16} />In Recipes: {savedRecipe.name}</p> : <label className="check-field"><input type="checkbox" checked={recipeDraft.enabled} disabled={busy || saving} onChange={e => { setRecipeDraft({ ...recipeDraft, enabled: e.target.checked, name: recipeDraft.name || assistantRecipeName(items) }); setReviewed(false); }} />Save as recipe</label>}
      {recipePending && <section className="assistant-recipe-options" aria-label="Recipe details">
        <Field label="Recipe name"><input value={recipeDraft.name} maxLength={200} required onChange={e => { setRecipeDraft({ ...recipeDraft, name: e.target.value }); setReviewed(false); }} /></Field>
        <div className="form-grid"><Field label="Finished dish weight (g)" hint="Use the cooked batch weight if ingredients were weighed raw."><input type="number" min="0.1" max="1000000" step="any" value={recipeDraft.yieldGrams ?? (recipeWeight || '')} onChange={e => { setRecipeDraft({ ...recipeDraft, yieldGrams: e.target.value }); setReviewed(false); }} /></Field><Field label="Number of servings"><input type="number" min="0.1" max="10000" step="any" value={recipeDraft.servings} onChange={e => { setRecipeDraft({ ...recipeDraft, servings: e.target.value }); setReviewed(false); }} /></Field></div>
        {recipeValid && <p>{fmt(items.reduce((sum, item) => sum + item.food.per100.kcal * (item.grams || 0) / 100, 0) / recipeServings)} kcal · {fmt(recipeWeight / recipeServings, 1)} g per serving</p>}
        {savedAt ? <p className="muted">Creates a reusable recipe. Your diary stays as logged.</p> : logMeal && <p className="muted">Logs the portions above. Recipe servings are for next time.</p>}
      </section>}
      {!savedAt && <><label className="check-field"><input type="checkbox" checked={logMeal} onChange={e => setLogMeal(e.target.checked)} />Also log what I ate</label>
      {logMeal && <div className="form-grid"><Field label="Meal"><select value={meal} onChange={e => setMeal(e.target.value as Meal)}>{meals.map(m => <option key={m}>{m}</option>)}</select></Field><Field label="Date"><input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} required /></Field><Field label="Time eaten"><input type="time" value={time} onChange={e => setTime(e.target.value)} /></Field></div>}</>}
      <label className="check-field"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I’ve checked the matches, portions and any estimates.</label>
    </section>}
    {error && <p className="form-error" role="alert">{error}</p>}
    </div></div>
    <ModalActions className="assistant-footer"><form onSubmit={send}>
      <div className="assistant-composer"><label className="sr-only" htmlFor="food-chat">Message the food assistant</label><textarea id="food-chat" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (configured || key.trim().length >= 20)) { e.preventDefault(); void send(e); } }} maxLength={6000} rows={2} placeholder="Tell me about your meal…" disabled={saving || busy} />
      <button className="button primary assistant-send-button" aria-label="Send" disabled={busy || saving || !input.trim() || (!configured && key.trim().length < 20)}><ArrowUp size={19} /></button></div>
      <div className="assistant-composer-tools"><button type="button" className="text-button" disabled={busy || saving} title="Search saved foods and the offline catalog. Enter one food per line." aria-describedby={listHelp ? 'assistant-list-help' : undefined} onClick={() => void findList()}>Search food list</button><label className="check-field assistant-web"><input type="checkbox" checked={web} onChange={e => setWeb(e.target.checked)} />Research menus online</label><span className="assistant-keyboard-hint">Enter to send · Shift + Enter for a new line</span></div>
      {listHelp && <p className="assistant-list-help" id="assistant-list-help" role="note">Enter one food per line, e.g. <strong>Chicken breast 150 g</strong>, then choose <strong>Search food list</strong>. Searches your library and the offline catalog, without AI.</p>}
    </form>{!items.length && warnings.length > 0 && !pendingReply && <div className="assistant-save assistant-retry"><span>Prepare a preview with a labelled estimate if needed.</span><button className="button secondary" disabled={busy || saving || !!input.trim() || (!configured && key.trim().length < 20)} onClick={() => void sendMessage('Please prepare the meal from our conversation for review. Use a clearly labelled estimate if exact nutrition is unavailable, keeping the portion I gave you. Ask me for any missing portion details.')} >Prepare meal preview</button></div>}
    {items.length > 0 && <div className="assistant-save"><span>{savedAt && !recipePending ? 'This meal has been saved.' : !reviewed ? 'Check the review box above to enable Save.' : 'Ready to save.'}</span><button className="button primary" disabled={!!savedAt && !recipePending || !reviewed || pendingReply || busy || saving || !!input.trim() || (recipePending && !recipeValid) || (!savedAt && logMeal && missingPortion)} onClick={() => void save()}>{saving ? 'Saving…' : recipePending ? !savedAt && logMeal ? 'Save recipe & log meal' : 'Save recipe' : savedAt ? 'Saved' : logMeal ? 'Save & log meal' : 'Save to library'}</button></div>}</ModalActions>
  </div>;
}
