import { RefreshCw, Watch } from 'lucide-react';
import { DateSwitcher } from './Dashboard';
import { healthName, isNative } from './health';
import { dayActivity, fmt, type State } from './model';
import { Empty } from './ui';

export default function Activity({ state, date, setDate, busy, automatic, status, sync, disableAuto, enterTotals }: {
  state: State; date: string; setDate: (date: string) => void; busy: boolean; automatic: boolean;
  status: string; sync: () => void; disableAuto: () => void; enterTotals: () => void;
}) {
  const activity = dayActivity(state, date);
  return <>
    <div className="page-heading"><div><h1>Activity</h1></div><DateSwitcher date={date} onChange={setDate} /></div>
    <section className="card activity-sync">
      <div className="activity-sync-top"><Watch size={22} /><div><h2>Activity sync</h2><p>{state.lastHealthSync ? `Last import: ${new Date(state.lastHealthSync).toLocaleString('en-GB')}` : isNative ? `Connect ${healthName} to import activity.` : 'Connect health in the phone app.'}</p></div>
        <div className="connection-actions">{isNative && <button className="button primary" disabled={busy} onClick={sync}><RefreshCw size={16} className={busy ? 'spin' : ''} />{busy ? 'Checking…' : automatic ? 'Check activity now' : 'Connect health'}</button>}<button className="button secondary" onClick={enterTotals}>Enter totals</button></div>
      </div>
      {status && <p className="activity-status" role="status">{status}</p>}
      <details className="help-details"><summary>Sync help</summary>
        <p>Watch → Zepp → {healthName} → Steady. Allow Zepp to share activity, then connect health in the installed phone app.</p>
        <p>Steady checks the last 7 days on opening and returning to the app, then today and yesterday every 30 seconds while open. Health imports stop when the app is closed. Hosted sync shares the results with your desktop while Steady is open and online.</p>
        <p>If phone and watch both record steps, check source priority in {healthName}. Detailed routes stay in Zepp.</p>
        {isNative && automatic && <button className="text-button" onClick={disableAuto}>Turn off automatic activity checks</button>}
      </details>
    </section>
    <div className="stats-row">
      <div className="card"><p>Steps</p><strong>{activity?.steps != null ? fmt(activity.steps) : '—'}</strong><span>{state.profile.stepGoal ? `Goal: ${fmt(state.profile.stepGoal)}` : 'No goal set'}</span></div>
      <div className="card"><p>Active calories</p><strong>{activity?.activeKcal != null ? fmt(activity.activeKcal) : '—'}<small> kcal</small></strong><span>Estimated · excludes resting energy</span></div>
      <div className="card"><p>Walking / running distance</p><strong>{activity?.distanceKm != null ? fmt(activity.distanceKm, 2) : '—'}<small> km</small></strong><span>{activity ? activity.source === 'manual' ? 'Manual entry' : 'Imported' : 'No data yet'}</span></div>
    </div>
    {!activity && <section className="card"><Empty title="No activity yet" detail="Import from your phone or enter daily totals." /></section>}
  </>;
}
