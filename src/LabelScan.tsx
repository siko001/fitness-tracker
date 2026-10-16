import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, ImagePlus, LoaderCircle, ScanLine, X } from 'lucide-react';
import { z } from 'zod';
import AssistantKeySettings, { useAssistantCredentials } from './AssistantKeySettings';
import { Field, ModalActions } from './ui';
import { dateSchema, fmt, foodSchema, meals, uid, type Food, type Meal, type State } from './model';
import { readMetadata, writeMetadata } from './storage';
import { draftFromLabel, draftFromSavedFood, foodFromLabel, labelMatch, labelNutrients, prepareLabelPhoto, readLabelPhotos, type LabelDraft } from './label-scan';

const savedDraftSchema = z.object({
  draft: z.object({ id: z.string(), name: z.string(), brand: z.string(), category: foodSchema.shape.group, barcode: z.string(),
    basisAmount: z.string(), unit: z.enum(['g', 'ml', '']), values: z.object({ kcal: z.string(), protein: z.string(), carbs: z.string(), fat: z.string(), fibre: z.string() }),
    fibreMissing: z.boolean(), servingAmount: z.string(), notes: z.string(), warnings: z.array(z.string()), }),
  entryId: z.string().min(1).max(100), meal: z.enum(meals), date: dateSchema, time: z.string(), amount: z.string(), logNow: z.boolean(),
});
type Props = { state: State; date: string; meal?: Meal; onClose: () => void;
  onSave: (food: Food, entryId: string, log: { date: string; meal: Meal; amount: number; time?: string } | null) => Promise<void> };

export default function LabelScan(props: Props) {
  const access = useAssistantCredentials();
  const [expandedPhoto, setExpandedPhoto] = useState<number | null>(null);
  const [photos, setPhotos] = useState<string[]>([]), [draft, setDraft] = useState<LabelDraft | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [processing, setProcessing] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [reviewed, setReviewed] = useState(false), [restored, setRestored] = useState(false);
  const [logNow, setLogNow] = useState(true), [meal, setMeal] = useState<Meal>(props.meal ?? 'Drinks'), [date, setDate] = useState(props.date), [time, setTime] = useState(new Date().toTimeString().slice(0, 5)), [amount, setAmount] = useState('');
  const request = useRef<AbortController | null>(null), generation = useRef(0), lock = useRef(false), entryId = useRef<string>(uid());
  useEffect(() => {
    let active = true;
    void readMetadata('labelScanDraft').then(raw => {
      if (!active) return;
      const saved = savedDraftSchema.safeParse(raw);
      if (saved.success) { const d = saved.data; entryId.current = d.entryId; setDraft(d.draft); setMeal(d.meal); setDate(d.date); setTime(d.time); setAmount(d.amount); setLogNow(d.logNow); setRestored(true); }
      setLoaded(true);
    }).catch(() => { if (active) { setLoaded(true); setError('The previous scan draft could not be opened.'); } });
    return () => { active = false; generation.current++; request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (loaded) void writeMetadata('labelScanDraft', draft ? { draft, entryId: entryId.current, meal, date, time, amount, logNow } : null).catch(() => setError('This draft could not be kept on this device. Keep this window open until you save.'));
  }, [loaded, draft, meal, date, time, amount, logNow]);
  function update(change: Partial<LabelDraft>) { setDraft(d => d ? { ...d, ...change } : d); setReviewed(false); setError(''); }
  async function photo(file?: File) {
    if (!file || photos.length >= 2 || processing || busy) return;
    const id = ++generation.current; setProcessing(true); setError('');
    try { const data = await prepareLabelPhoto(file); if (id === generation.current) setPhotos(current => [...current, data].slice(0, 2)); }
    catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : 'Could not open that photo.'); }
    finally { if (id === generation.current) setProcessing(false); }
  }
  async function scan() {
    if (busy || !photos.length) return;
    request.current?.abort(); request.current = new AbortController(); const id = ++generation.current;
    setBusy(true); setError('');
    try {
      const reading = await readLabelPhotos(photos, request.current.signal);
      if (id !== generation.current) return;
      const next = draftFromLabel(reading); setDraft(next); setReviewed(false); setRestored(false); setAmount('');
      setMeal(props.meal ?? (next.category === 'Drinks' || next.unit === 'ml' ? 'Drinks' : 'Snacks'));
    } catch (e) { if (id === generation.current) setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'Scan cancelled. Your photos are still here.'); }
    finally { if (id === generation.current) setBusy(false); }
  }
  const existing = draft ? labelMatch(props.state.foods, draft) : undefined;
  let food: Food | null = null, validation = '';
  if (draft) { try { food = foodFromLabel(draft); } catch (e) { validation = e instanceof Error ? e.message : 'Check the label values.'; } }
  const portion = Number(amount), validPortion = amount.trim() && Number.isFinite(portion) && portion > 0 && portion <= 100000;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (lock.current || !food || !reviewed || logNow && !validPortion) return;
    lock.current = true; setSaving(true); setError('');
    try { await props.onSave(food, entryId.current, logNow ? { date, meal, amount: portion, time: time || undefined } : null); await writeMetadata('labelScanDraft', null); props.onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Your draft is safe.'); }
    finally { lock.current = false; setSaving(false); }
  }
  const showSetup = !access.checking && !access.status.configured && !access.key;
  return <div className="label-scan">
    {!loaded ? <p role="status">Opening scanner…</p> : <>
      {draft && <div className="scan-topline"><span>{restored ? 'Unsaved draft restored' : 'Review your label'} · draft kept on this device</span><button className="text-button" disabled={busy || saving} onClick={() => { setDraft(null); setReviewed(false); setRestored(false); setError(''); setPhotos([]); setExpandedPhoto(null); entryId.current = uid(); }}>New scan</button></div>}
      {!draft && <><p className="muted">Photograph the nutrition panel. Add the front of the pack for its name and brand.</p><div className="scan-capture-actions"><label className={`button secondary scan-file ${photos.length >= 2 || processing || busy ? 'disabled' : ''}`}><Camera size={18} />Take photo<input aria-label="Take label photo" type="file" accept="image/*" capture="environment" disabled={photos.length >= 2 || processing || busy} onChange={e => { void photo(e.target.files?.[0]); e.target.value = ''; }} /></label><label className={`button secondary scan-file ${photos.length >= 2 || processing || busy ? 'disabled' : ''}`}><ImagePlus size={18} />Upload photo<input aria-label="Upload label photo" type="file" accept="image/*" disabled={photos.length >= 2 || processing || busy} onChange={e => { void photo(e.target.files?.[0]); e.target.value = ''; }} /></label></div></>}
      {photos.length > 0 && <div className={`scan-photos ${draft ? 'compact' : ''}`}>{photos.map((src, i) => <figure key={i}><button type="button" className="scan-photo-preview" aria-label={`View label photo ${i + 1}`} aria-expanded={expandedPhoto === i} onClick={() => setExpandedPhoto(expandedPhoto === i ? null : i)}><img src={src} alt={`Your label photo ${i + 1}`} /></button>{!draft && <button className="icon-button" disabled={busy} aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos(photos.filter((_, n) => n !== i))}><X size={16} /></button>}<figcaption>Photo {i + 1}</figcaption></figure>)}</div>}
      {expandedPhoto !== null && photos[expandedPhoto] && <div className="scan-photo-expanded"><button type="button" className="text-button" onClick={() => setExpandedPhoto(null)}>Close photo</button><img src={photos[expandedPhoto]} alt="Expanded nutrition label" /></div>}
      {processing && <p role="status" className="muted">Preparing photo…</p>}
      {showSetup && <AssistantKeySettings access={access} />}
      {!draft && <p className="scan-privacy">Up to two photos. Sent to Groq only when you press Read label. Steady keeps the extracted draft, not the photos.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {draft ? <form id="label-review-form" onSubmit={e => void save(e)}><fieldset disabled={saving}>
        {!!draft.warnings.length && <div className="scan-warning" role="status">{draft.warnings.map((w, i) => <p key={i}>{w}</p>)}</div>}
        {existing && <div className="scan-existing"><p>Already in your library: <strong>{existing.name}{existing.brand ? ` · ${existing.brand}` : ''}</strong></p><button type="button" className="button secondary small-button" onClick={() => update(draftFromSavedFood(existing))}>Use saved product</button><small>Saving reuses it when the nutrition matches. Existing values are never overwritten by a scan.</small></div>}
        <div className="form-grid"><Field label="Product name"><input required maxLength={200} value={draft.name} onChange={e => update({ name: e.target.value })} /></Field><Field label="Brand · optional"><input maxLength={200} value={draft.brand} onChange={e => update({ brand: e.target.value })} /></Field><Field label="Category"><select value={draft.category} onChange={e => update({ category: e.target.value as Food['group'] })}>{foodSchema.shape.group.options.map(c => <option key={c}>{c}</option>)}</select></Field><Field label="Barcode · optional"><input inputMode="numeric" maxLength={14} value={draft.barcode} onChange={e => update({ barcode: e.target.value })} /></Field></div>
        <h3>Values on your label</h3><div className="form-grid"><Field label="Label values are per"><input type="number" required min="0.1" max="100000" step="any" value={draft.basisAmount} onChange={e => update({ basisAmount: e.target.value })} placeholder="100 or stated serving size" /></Field><Field label="Label unit"><select required value={draft.unit} onChange={e => update({ unit: e.target.value as LabelDraft['unit'], servingAmount: '' })}><option value="">Choose g or ml</option><option value="g">g · grams</option><option value="ml">ml · millilitres</option></select></Field></div>
        <div className="form-grid scan-nutrients">{labelNutrients.map(k => <Field key={k} label={k === 'kcal' ? 'Energy (kcal)' : `${k[0].toUpperCase() + k.slice(1)} (g)`}><input type="number" min="0" max="100000" step="any" required={k !== 'fibre' || !draft.fibreMissing} disabled={k === 'fibre' && draft.fibreMissing} value={draft.values[k]} placeholder="Not readable · enter from label" onChange={e => update({ values: { ...draft.values, [k]: e.target.value } })} /></Field>)}</div>
        <label className="check-field"><input type="checkbox" checked={draft.fibreMissing} onChange={e => update({ fibreMissing: e.target.checked })} />Fibre is not listed or cannot be read</label>{draft.fibreMissing && <p className="scan-privacy">Fibre stays marked unknown; it won’t count as confirmed zero in your progress review.</p>}
        <Field label={`Saved serving size (${draft.unit || 'g / ml'}) · optional`}><input type="number" min="0.1" max="100000" step="any" value={draft.servingAmount} onChange={e => update({ servingAmount: e.target.value })} placeholder="Use a serving printed on the label" /></Field>
        {draft.notes && <p className="scan-privacy">{draft.notes}</p>}
        {food && <div className="scan-normalised"><strong>{fmt(food.per100.kcal, 1)} kcal / 100 {draft.unit}</strong><span>Saved in this unit · no g-to-ml conversion</span></div>}
        <label className="check-field"><input type="checkbox" checked={logNow} onChange={e => setLogNow(e.target.checked)} />Also log it now</label>
        {logNow && <><div className="form-grid"><Field label={`Amount ${draft.unit === 'ml' ? 'drunk (ml)' : 'eaten (g)'}`}><input type="number" required min="0.1" max="100000" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder={draft.unit === 'ml' ? 'e.g. 250' : 'Your portion'} /></Field><Field label="Meal"><select value={meal} onChange={e => setMeal(e.target.value as Meal)}>{meals.map(m => <option key={m}>{m}</option>)}</select></Field><Field label="Date"><input type="date" required value={date} onChange={e => setDate(e.target.value)} /></Field><Field label="Time"><input type="time" value={time} onChange={e => setTime(e.target.value)} /></Field></div>{food && validPortion && <p className="scan-portion"><strong>{fmt(food.per100.kcal * portion / 100)} kcal</strong> for {fmt(portion, 1)} {draft.unit}</p>}</>}
        <label className="check-field scan-review"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I’ve checked the product, label column and nutrition.</label>
        {validation && <p className="scan-privacy" role="status">{validation}</p>}
        </fieldset><ModalActions><button type="button" className="button secondary" disabled={saving} onClick={props.onClose}>Close</button><button type="submit" form="label-review-form" className="button primary" disabled={saving || !reviewed || !food || logNow && !validPortion}>{saving ? 'Saving…' : logNow ? meal === 'Drinks' ? 'Save & log drink' : 'Save & log food' : 'Save to library'}</button></ModalActions>
      </form> : <ModalActions><button className="button secondary" onClick={props.onClose}>Close</button><button className="button primary" disabled={busy || processing || !photos.length || access.checking || !access.status.configured && !access.key} onClick={() => void scan()}>{busy ? <><LoaderCircle size={17} className="spin" />Reading label…</> : <><ScanLine size={17} />Read label</>}</button></ModalActions>}
    </>}
  </div>;
}
