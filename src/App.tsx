import { useCallback, useEffect, useRef, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import PwaStatus from './PwaStatus';
import { onFoodReminder, refreshReminders, consumeAndroidReminder, clearPhoneReminders } from './reminders';
import { LayoutDashboard, BookOpen, ChefHat, BarChart3, Footprints, Settings as SettingsIcon, Plus, WifiOff, Check, X, Leaf } from 'lucide-react';
import Dashboard, { Diary, Progress, DateSwitcher, type DiaryActions } from './Dashboard';
import { FoodLibrary, Recipes } from './Libraries';
import Settings, { type SyncMode } from './Settings';
import { ActivityForm, FoodForm, LogForm, RecipeForm, WeightForm } from './dialogs';
import { Logo, Modal, ModalActions } from './ui';
import { clearLocalData, exportFile, loadState, mutateState, readMetadata, writeMetadata } from './storage';
import { dayActivity, fmt, localDate, parseBackup, recipePer100, uid, type Entry, type Food, type Meal, type Recipe, type State } from './model';
import { isNative, syncHealth } from './health';
import { cloud, syncCloud } from './cloud';
import { SyncConflict, type ConflictChoice, type ConflictDetail } from './merge';
import { syncLocal } from './local-sync';
import { useAppearance } from './appearance';
import Activity from './Activity';
import ProfileMenu from './ProfileMenu';
import FoodImport from './FoodImport';
import { adoptBackgroundSession, clearBackground, configureBackground, consumeBackground, mergeHealthRecords } from './native-background';
import { usePage, type Page } from './navigation';
import { useZepp } from './useZepp';
import { withZeppSteps } from './zepp';

type Dialog = { type: 'import' } | { type: 'log'; meal: Meal; entry?: Entry } | { type: 'food'; food?: Food } | { type: 'recipe'; recipe?: Recipe } | { type: 'weight' } | { type: 'activity' } | { type: 'restore'; state: State } | { type: 'clear' } | { type: 'conflict'; details: ConflictDetail[] } | { type: 'delete'; title: string; remove: (s: State) => State };
const pages = [{ name: 'Overview', icon: LayoutDashboard }, { name: 'Food diary', icon: BookOpen }, { name: 'Food library', icon: Leaf }, { name: 'Recipes', icon: ChefHat }, { name: 'Progress', icon: BarChart3 }, { name: 'Activity', icon: Footprints }] as const;
export default function App() {
  const appearance = useAppearance();
  const [state, setState] = useState<State | null>(null), [loadError, setLoadError] = useState('');
  const [page, setPage] = usePage(), [date, setDate] = useState(localDate());
  const [dialog, setDialog] = useState<Dialog | null>(null), [toast, setToast] = useState(''), [period, setPeriod] = useState(30);
  const [online, setOnline] = useState(navigator.onLine), [healthBusy, setHealthBusy] = useState(false);
  const [healthAuto, setHealthAuto] = useState(false), [healthStatus, setHealthStatus] = useState('');
  const healthRunning = useRef(false), healthChecked = useRef(0);
  const [mode, setModeState] = useState<SyncMode>('off'), [syncBusy, setSyncBusy] = useState(false), [syncStatus, setSyncStatus] = useState(''), [syncProblem, setSyncProblem] = useState(false);
  const zepp = useZepp(mode);
  const syncing = useRef(false), stateRef = useRef(state), modeRef = useRef(mode); stateRef.current = state; modeRef.current = mode;
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    void consumeBackground().then(setState).catch(() => setLoadError('We could not open your saved diary. Your data has not been replaced. Check that this browser allows storage, then reload.'));
    void readMetadata<SyncMode>('syncMode').then(v => { if (v) setModeState(v); });
    void readMetadata<boolean>('healthAuto').then(v => setHealthAuto(v === true));
    const localChange = () => { void loadState().then(setState); channel.current?.postMessage('changed'); };
    window.addEventListener('steady-native-changed', localChange);
    const onlineChange = () => setOnline(navigator.onLine); window.addEventListener('online', onlineChange); window.addEventListener('offline', onlineChange);
    if ('BroadcastChannel' in window) { channel.current = new BroadcastChannel('steady-data'); channel.current.onmessage = () => { void loadState().then(setState); void readMetadata<SyncMode>('syncMode').then(v => setModeState(v ?? 'off')); }; }
    return () => { window.removeEventListener('steady-native-changed', localChange); window.removeEventListener('online', onlineChange); window.removeEventListener('offline', onlineChange); channel.current?.close(); };
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 7000); return () => clearTimeout(timer); }, [toast]);
  const change = useCallback(async (update: (s: State) => State, message?: string) => {
    const next = await mutateState(update); setState(next); channel.current?.postMessage('changed');
    if (message) setToast(message);
  }, []);
  const sync = useCallback(async (quiet = false, choice?: ConflictChoice) => {
    if (syncing.current || modeRef.current === 'off' || !navigator.onLine) return;
    syncing.current = true; setSyncBusy(true);
    try {
      const next = await (modeRef.current === 'cloud' ? syncCloud(choice) : syncLocal(choice)); setState(next); channel.current?.postMessage('changed');
      setSyncProblem(false); setSyncStatus(`Last synced at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
      if (!quiet) { setToast('Your devices are up to date.'); if (choice) setDialog(null); }
    } catch (e) { const message = e instanceof Error ? e.message : 'Sync failed. Your local data is safe.'; setSyncStatus(message); setSyncProblem(true); if (!quiet) { if (e instanceof SyncConflict) setDialog({ type: 'conflict', details: e.details }); else setToast(message); } }
    finally { syncing.current = false; setSyncBusy(false); }
  }, []);
  useEffect(() => {
    if (!state || mode === 'off') return;
    const timer = setTimeout(() => void sync(true), 1800);
    return () => clearTimeout(timer);
    // Sync after local changes; a successful sync updates the state so avoid a loop by comparing the serialized data.
  }, [state ? JSON.stringify(state) : '', mode, online, sync]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void sync(true); };
    const timer = setInterval(refresh, 30000); window.addEventListener('online', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [sync]);
  async function setMode(value: SyncMode) { if (syncing.current) { setToast('Wait for the current sync to finish.'); return; } await writeMetadata('syncMode', value); await configureBackground(cloud); modeRef.current = value; setModeState(value); setSyncProblem(false); channel.current?.postMessage('changed'); }
  async function save(update: (s: State) => State, message: string) { await change(update, message); setDialog(null); }
  function go(next: Page) { setPage(next); window.scrollTo({ top: 0, behavior: 'instant' }); }
  async function download() { try { if (stateRef.current) await exportFile(JSON.stringify(stateRef.current, null, 2), `steady-backup-${localDate()}.json`); } catch (e) { setToast(e instanceof Error ? e.message : 'Could not export the file.'); } }
  async function restore(file: File) { try { if (file.size > 20_000_000) throw new Error('Backup must be smaller than 20 MB.'); setDialog({ type: 'restore', state: parseBackup(await file.text()) }); } catch (e) { setToast(e instanceof Error ? e.message : 'Could not read this backup.'); } }
  const importHealth = useCallback(async (quiet = false, lookbackDays = 7) => {
    if (healthRunning.current || quiet && Date.now() - healthChecked.current < 2000) return;
    healthRunning.current = true; healthChecked.current = Date.now(); setHealthBusy(true);
    try {
      const { records, incomplete } = await syncHealth(!quiet, lookbackDays);
      if (!quiet) { await writeMetadata('healthAuto', true); setHealthAuto(true); }
      if (!records.length) {
        const message = 'Connected. Waiting for activity from Zepp.';
        setHealthStatus(message); if (!quiet) setToast(message); return;
      }
      await change(s => mergeHealthRecords(s, records, new Date().toISOString()));
      const message = incomplete ? 'Activity updated. Some measurements were unavailable; check health permissions.' : 'Activity updated. Auto-checks run every 30 seconds while open.';
      setHealthStatus(message); if (!quiet) setToast(message);
    } catch (e) { const message = e instanceof Error ? e.message : 'Could not import health data.'; setHealthStatus(message); if (!quiet) setToast(message); }
    finally { healthRunning.current = false; setHealthBusy(false); }
  }, [change]);
  useEffect(() => {
    if (!isNative || !healthAuto || !state) return;
    void importHealth(true);
    // Recheck today and yesterday for delayed Zepp exports without polling all 7 days.
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void importHealth(true, 2); }, 30000);
    return () => clearInterval(timer);
  }, [healthAuto, !!state, importHealth]);
  useEffect(() => {
    if (!isNative) return;
    const openMeal = (date: string, meal: Meal) => { setDate(date); setPage('Food diary'); setDialog({ type: 'log', meal }); };
    void consumeAndroidReminder(openMeal).catch(e => setToast(String(e)));
    const refresh = () => { void consumeAndroidReminder(openMeal).catch(e => setToast(String(e))); void consumeBackground().then(setState).then(() => sync(true)).catch(e => setToast(String(e))); if (healthAuto) void importHealth(true); void refreshReminders().catch(e => setToast(String(e))); };
    const handle = NativeApp.addListener('appStateChange', ({ isActive }) => { if (isActive) refresh(); });
    const notification = onFoodReminder(openMeal, setToast);
    return () => { void handle.then(h => h.remove()); void notification?.then(h => h.remove()); };
  }, [healthAuto, importHealth, sync]);
  useEffect(() => {
    if (state) void refreshReminders().catch(e => setToast(`Food reminders need attention: ${String(e)}`));
  }, [state ? JSON.stringify([state.entries, state.skippedMeals]) : '']);
  if (!state) return <div className="loading-screen"><Logo /><p>{loadError || 'Opening your diary…'}</p>{loadError && <button className="button primary" onClick={() => location.reload()}>Try again</button>}</div>;
  const actions: DiaryActions = { skip: meal => void change(s => ({ ...s, skippedMeals: [...s.skippedMeals.filter(x => x.date !== date || x.meal !== meal), { date, meal }] }), `${meal} skipped for this day.`).catch(e => setToast(String(e))), undoSkip: meal => void change(s => ({ ...s, skippedMeals: s.skippedMeals.filter(x => x.date !== date || x.meal !== meal) }), 'Meal check-in restored.').catch(e => setToast(String(e))), add: meal => setDialog({ type: 'log', meal }), edit: entry => setDialog({ type: 'log', meal: entry.meal, entry }), remove: entry => setDialog({ type: 'delete', title: `Remove ${entry.name}?`, remove: s => ({ ...s, entries: s.entries.filter(e => e.id !== entry.id) }) }), weight: () => setDialog({ type: 'weight' }), activity: () => go('Activity'), settings: () => go('Settings'), progress: () => go('Progress') };
  const activity = dayActivity(state, date);
  const displayState = withZeppSteps(state, zepp.data);
  const syncLabel = mode === 'off' ? 'Local only' : !online ? 'Offline' : syncProblem ? 'Sync issue' : syncBusy ? 'Syncing' : 'Saved';
  const syncDetail = mode === 'off' ? 'Sync is off. Changes stay on this device.' : !online ? 'Saved on this device. Sync resumes when connected.' : syncProblem ? 'Your diary is saved here. Review sync in Settings.' : syncBusy ? 'Syncing your diary' : 'Saved on this device. Automatic sync enabled.';
  function logFood(food: Food) { setDialog({ type: 'log', meal: 'Lunch', entry: { id: uid(), date, meal: 'Lunch', name: food.name, preparation: food.preparation, grams: food.serving?.grams ?? 100, per100: food.per100, foodId: food.id } }); }
  function logRecipe(recipe: Recipe) { setDialog({ type: 'log', meal: 'Lunch', entry: { id: uid(), date, meal: 'Lunch', name: recipe.name, preparation: 'Prepared recipe', grams: recipe.yieldGrams / recipe.servings, per100: recipePer100(recipe), recipeId: recipe.id } }); }
  return <div className="app-shell"><aside className="sidebar"><button className="brand-button" onClick={() => go('Overview')} aria-label="Steady home"><Logo /></button><nav>{pages.map(p => <button key={p.name} className={page === p.name ? 'active' : ''} aria-label={p.name} title={p.name} onClick={() => go(p.name)}><p.icon size={19} strokeWidth={1.7} /><span>{p.name}</span>{p.name === 'Overview' && <span className="nav-dot" />}</button>)}</nav><div className="sidebar-bottom"><button className={`settings-nav ${page === 'Settings' ? 'active' : ''}`} aria-label="Settings & sync" title="Settings & sync" onClick={() => go('Settings')}><SettingsIcon size={19} /><span>Settings & sync</span></button><div className="sidebar-profile"><span className="avatar">{state.profile.name?.[0]?.toUpperCase() || 'S'}</span><div><strong>{state.profile.name || 'Your space'}</strong></div></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><span>Your space</span><span>/</span><strong>{page}</strong></div><div className="mobile-brand"><Logo small /></div><div className="topbar-actions"><button className={`sync-indicator ${!online ? 'offline' : syncProblem ? 'problem' : ''}`} aria-label={syncDetail + ' Open sync settings'} title={syncDetail} onClick={() => go('Settings')}>{!online ? <WifiOff size={13} /> : <span className="status-dot" />}<span className="sync-label">{syncLabel}</span></button><button className="button primary" onClick={() => setDialog({ type: 'log', meal: 'Lunch' })}><Plus size={17} /><span>Log food</span></button><ProfileMenu name={state.profile.name} appearance={appearance} openSettings={() => go('Settings')} /></div></header>
      {!isNative && <PwaStatus />}
      {syncProblem && mode !== 'off' && <div className="update-banner"><span>Your diary is saved here. Sync needs attention.</span><button onClick={() => go('Settings')}>Review sync</button></div>}
      <main className="main-content">
        {page === 'Overview' && <Dashboard state={displayState} date={date} setDate={setDate} actions={actions} />}
        {page === 'Food diary' && <><div className="page-heading"><div><h1>Food diary</h1></div><DateSwitcher date={date} onChange={setDate} /></div><Diary state={state} date={date} actions={actions} /></>}
        {page === 'Food library' && <FoodLibrary state={state} importFood={() => setDialog({ type: 'import' })} add={() => setDialog({ type: 'food' })} edit={food => setDialog({ type: 'food', food })} log={logFood} />}
        {page === 'Recipes' && <Recipes state={state} add={() => setDialog({ type: 'recipe' })} edit={recipe => setDialog({ type: 'recipe', recipe })} log={logRecipe} />}
        {page === 'Progress' && <Progress state={displayState} date={date} period={period} setPeriod={setPeriod} logWeight={actions.weight} deleteWeight={d => setDialog({ type: 'delete', title: `Remove the weigh-in for ${d}?`, remove: s => ({ ...s, weights: s.weights.filter(w => w.date !== d) }) })} />}
        {page === 'Activity' && <Activity state={displayState} healthState={state} zepp={zepp} date={date} setDate={setDate} busy={healthBusy} automatic={healthAuto} status={healthStatus} sync={() => void importHealth()} enterTotals={() => setDialog({ type: 'activity' })} disableAuto={() => void writeMetadata('healthAuto', false).then(() => { setHealthAuto(false); setHealthStatus('Automatic activity checks are off.'); })} />}
        {page === 'Settings' && <Settings appearance={appearance} state={state} saveProfile={profile => change(s => ({ ...s, profile }))} download={() => void download()} restore={f => void restore(f)} clear={() => setDialog({ type: 'clear' })} sync={() => void sync()} syncBusy={syncBusy} mode={mode} setMode={m => void setMode(m)} status={syncStatus} />}
        <footer className="page-footer"><Logo small /></footer>
      </main><nav className="mobile-nav">{([{ name: 'Overview', icon: LayoutDashboard }, { name: 'Food library', icon: Leaf }, { name: 'Recipes', icon: ChefHat }, { name: 'Progress', icon: BarChart3 }, { name: 'Activity', icon: Footprints }, { name: 'Settings', icon: SettingsIcon }] as const).map(p => <button className={page === p.name ? 'active' : ''} key={p.name} aria-label={p.name === 'Food library' ? 'Foods' : p.name === 'Overview' ? 'Today' : p.name} title={p.name} onClick={() => go(p.name)}><p.icon size={20} /><span>{p.name === 'Food library' ? 'Foods' : p.name === 'Overview' ? 'Today' : p.name}</span></button>)}</nav></div>
    {toast && <div className="toast" role="status"><Check size={18} /><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={16} /></button></div>}
    {dialog && <Modal title={dialog.type === 'import' ? 'Import food' : dialog.type === 'log' ? dialog.entry && state.entries.some(e => e.id === dialog.entry!.id) ? 'Edit entry' : 'Log food' : dialog.type === 'food' ? dialog.food ? 'Edit food' : 'New food' : dialog.type === 'recipe' ? dialog.recipe ? 'Edit recipe' : 'New recipe' : dialog.type === 'weight' ? 'Log weight' : dialog.type === 'activity' ? 'Daily activity' : dialog.type === 'restore' ? 'Restore this backup?' : dialog.type === 'delete' ? dialog.title : dialog.type === 'conflict' ? 'Two edits, one choice' : 'Clear this device?'} onClose={() => setDialog(null)}>
      {dialog.type === 'log' && <LogForm state={state} date={dialog.entry?.date ?? date} meal={dialog.meal} entry={dialog.entry} onSave={entry => save(s => ({ ...s, entries: [...s.entries.filter(e => e.id !== entry.id), entry], skippedMeals: s.skippedMeals.filter(x => x.date !== entry.date || x.meal !== entry.meal) }), 'Food saved to your diary.')} onClose={() => setDialog(null)} />}
      {dialog.type === 'import' && <FoodImport foods={state.foods} onClose={() => setDialog(null)} onSave={food => save(s => { if (s.foods.some(f => f.id === food.id || f.sourceUrl === food.sourceUrl)) throw new Error('This food is already in your library.'); return { ...s, foods: [...s.foods, food] }; }, 'Food imported. Ready to use offline.')} />}
      {dialog.type === 'food' && <FoodForm food={dialog.food} onSave={food => save(s => ({ ...s, foods: [...s.foods.filter(f => f.id !== food.id), food] }), 'Food saved.')} onClose={() => setDialog(null)} />}
      {dialog.type === 'recipe' && <RecipeForm state={state} recipe={dialog.recipe} onSave={recipe => save(s => ({ ...s, recipes: [...s.recipes.filter(r => r.id !== recipe.id), recipe], foods: [...s.foods, ...recipe.ingredients.map(i => i.food).filter((f, i, all) => !s.foods.some(old => old.id === f.id || old.sourceUrl && old.sourceUrl === f.sourceUrl) && all.findIndex(x => x.id === f.id) === i)] }), 'Recipe saved.')} onClose={() => setDialog(null)} />}
      {dialog.type === 'weight' && <WeightForm date={date} kg={state.weights.find(w => w.date === date)?.kg} onSave={weight => save(s => ({ ...s, weights: [...s.weights.filter(w => w.date !== weight.date), weight] }), 'Weigh-in saved.')} onClose={() => setDialog(null)} />}
      {dialog.type === 'activity' && <ActivityForm date={date} activity={activity} onSave={value => save(s => ({ ...s, activities: [...s.activities.filter(a => a.date !== value.date || a.source !== 'manual'), value] }), 'Daily movement saved.')} onClose={() => setDialog(null)} onRemove={activity?.source === 'manual' ? () => void save(s => ({ ...s, activities: s.activities.filter(a => a.date !== date || a.source !== 'manual') }), 'Manual totals removed.').catch(e => setToast(String(e))) : undefined} />}
      {dialog.type === 'restore' && <><p>This backup contains {dialog.state.entries.length} food entries, {dialog.state.recipes.length} recipes and {dialog.state.weights.length} weigh-ins. It will replace this device’s diary.</p><p className="muted">Export your current diary first if you want to keep a copy. Sync will be turned off until you choose to reconnect.</p><ModalActions><button className="button secondary" onClick={() => void download()}>Export current diary</button><button className="button primary" disabled={syncBusy || healthBusy} onClick={() => void (async () => { await setMode('off'); await clearBackground(); await clearPhoneReminders(); await save(() => dialog.state, 'Backup restored. Sync is paused.'); })().catch(e => setToast(String(e)))}>Restore backup</button></ModalActions></>}
      {dialog.type === 'clear' && <><p>This removes your diary and sync settings from this installation. Export a backup first if you want to keep your local records.</p><p className="muted">Cloud records, local server records and exported backups remain available. Connecting again can download them.</p><ModalActions><button className="button secondary" onClick={() => void download()}>Export backup</button><button className="button danger-button" disabled={syncBusy || healthBusy} onClick={() => void (async () => { if (cloud) await adoptBackgroundSession(cloud); await clearBackground(); await cloud?.auth.signOut(); await clearPhoneReminders(); const fresh = await clearLocalData(); setState(fresh); modeRef.current = 'off'; setModeState('off'); setHealthAuto(false); await refreshReminders(); setSyncStatus(''); setDialog(null); channel.current?.postMessage('changed'); setToast('This device’s data has been cleared.'); })().catch(e => setToast(String(e)))}>Clear local data</button></ModalActions></>}
      {dialog.type === 'conflict' && <><p>These records changed on both devices. Choose which version of these conflicting records to keep. All other changes will still be combined.</p><div className="conflict-list">{dialog.details.map((d, i) => <div className="conflict-item" key={i}><h3>{d.label}</h3><p><strong>This device:</strong> {d.local}</p><p><strong>Synced version:</strong> {d.remote}</p></div>)}</div><ModalActions className="sync-conflict-actions"><button className="button secondary" onClick={() => void download()}>Export this device’s backup first</button><button className="button primary" disabled={syncBusy} onClick={() => void sync(false, 'local')}>Keep this device’s conflicting records</button><button className="button secondary" disabled={syncBusy} onClick={() => void sync(false, 'remote')}>Keep the synced conflicting records</button></ModalActions></>}
      {dialog.type === 'delete' && <><p>This record will be removed from your diary.</p><ModalActions><button className="button secondary" onClick={() => setDialog(null)}>Cancel</button><button className="button danger-button" onClick={() => void save(dialog.remove, 'Record removed.').catch(e => setToast(String(e)))}>Remove entry</button></ModalActions></>}
    </Modal>}
  </div>;
}
