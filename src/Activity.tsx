import { RefreshCw, Watch } from 'lucide-react';
import { DateSwitcher } from './Dashboard';
import { healthName, isNative } from './health';
import { dayActivity, fmt, type State } from './model';
import { Empty } from './ui';
import BackgroundActivity from './BackgroundActivity';
import ZeppActivity from './ZeppActivity';
import type { ZeppController } from './useZepp';

export default function Activity({ state, healthState, zepp, date, setDate, busy, automatic, status, sync, disableAuto, enterTotals }: {
  state: State; healthState: State; zepp: ZeppController; date: string; setDate: (date: string) => void; busy: boolean; automatic: boolean;
  status: string; sync: () => void; disableAuto: () => void; enterTotals: () => void;
}) {
  const activity = dayActivity(state, date);
  return <>
    <div className="page-heading"><div><h1>Activity</h1></div><DateSwitcher date={date} onChange={setDate} /></div>
    <section className="card activity-sync">
      <div className="activity-sync-top"><Watch size={22} /><div><h2>Activity sync</h2><p>{state.lastHealthSync ? `Health data checked: ${new Date(state.lastHealthSync).toLocaleString('en-GB')}` : isNative ? `Connect ${healthName} to import activity.` : 'Connect health in the phone app.'}</p></div>
        <div className="connection-actions">{isNative && <button className="button primary" disabled={busy} onClick={sync}><RefreshCw size={16} className={busy ? 'spin' : ''} />{busy ? 'Checking…' : automatic ? 'Check activity now' : 'Connect health'}</button>}<button className="button secondary" onClick={enterTotals}>Enter totals</button></div>
      </div>
      {status && <p className="activity-status" role="status">{status}</p>}
      <BackgroundActivity />
      <details className="help-details"><summary>Sync help</summary>
        <p>Watch → Zepp → {healthName} → Steady. Allow Zepp to share activity, then connect health in the installed phone app.</p>
        <p>Steady checks the last 7 days on opening and returning to the app, then today and yesterday every 30 seconds while open. Enable background checks in the Android app to import and sync activity about every 15 minutes while closed. Android may delay checks to save battery. The phone must reach your hosted or local server for the desktop to receive updates.</p>
        <p>The time above is when Steady checked the phone’s health data. Zepp may not have shared the latest watch readings yet; Steady cannot force that transfer. If totals differ, open Zepp and let it sync with the watch.</p>
        <p>On iPhone, health imports still run only while Steady is open. Food and recipe changes sync while the app is open on either platform. Health checks are separate from diary sync.</p>
        <p>Android steps use Zepp watch records only, excluding the phone’s step counter. This needs Android 14 or later. Other measurements use the health store’s totals. Detailed routes stay in Zepp.</p>
        {isNative && automatic && <button className="text-button" onClick={disableAuto}>Turn off checks while open</button>}
      </details>
    </section>
    <div className="stats-row">
      <div className="card"><p>{activity?.stepSource === 'zepp-direct' ? 'Steps · Direct watch' : activity?.stepSource === 'zepp' ? 'Steps · Zepp watch' : 'Steps'}</p><strong>{activity?.steps != null ? fmt(activity.steps) : '—'}</strong><span>{state.profile.stepGoal ? `Goal: ${fmt(state.profile.stepGoal)}` : 'No goal set'}</span></div>
      <div className="card"><p>Active calories</p><strong>{activity?.activeKcal != null ? fmt(activity.activeKcal) : '—'}<small> kcal</small></strong><span>Estimated · excludes resting energy</span></div>
      <div className="card"><p>Walking / running distance</p><strong>{activity?.distanceKm != null ? fmt(activity.distanceKm, 2) : '—'}<small> km</small></strong><span>{activity ? activity.source === 'manual' ? 'Manual entry' : 'Imported' : 'No data yet'}</span></div>
    </div>
    <ZeppActivity zepp={zepp} state={healthState} date={date} />
    {!activity && <section className="card"><Empty title="No activity yet" detail="Import from your phone or enter daily totals." /></section>}
  </>;
}
