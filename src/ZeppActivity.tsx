import { useState } from 'react';
import { fmt, type State } from './model';
import type { ZeppController } from './useZepp';

export default function ZeppActivity({ zepp, state, date }: { zepp: ZeppController; state: State; date: string }) {
  const [copied, setCopied] = useState(false);
  const connection = zepp.data.connection;
  const paired = connection && !connection.revoked_at;
  const snapshot = zepp.data.snapshots.find(s => s.date === date && s.device_id === connection?.device_id);
  const health = state.activities.find(a => a.date === date && a.source === 'health');
  const fresh = zepp.data.snapshots.some(s => s.device_id === connection?.device_id && Date.now() - Date.parse(s.captured_at) < 3600000);
  return <section className="card zepp-sync" aria-label="Direct Zepp sync">
    <h2>Direct Zepp sync <span className="muted">· {paired ? connection.enabled ? 'Enabled' : 'Testing' : 'Setup'}</span></h2>
    <p>Watch → Zepp → Steady. The Steady mini app on your watch sends steps directly, bypassing Health Connect’s export delay.</p>
    {zepp.mode !== 'cloud' ? <p>Enable hosted sync in Settings to pair your watch. Your current sync keeps working.</p> : <>
      <p>{paired && connection.enabled ? 'Direct watch steps are used when available. A higher Zepp Health Connect total takes over if the direct relay falls behind. Manual totals still take priority.' : 'Health Connect stays in use while you install and test the watch mini app.'} Calories and distance still come from the phone’s health data.</p>
      {paired && <div className="zepp-comparison"><p><strong>Direct watch:</strong> {snapshot ? `${fmt(snapshot.steps)} steps` : 'No reading for this date yet'}</p><p><strong>Health Connect:</strong> {health?.steps != null ? `${fmt(health.steps)} steps` : 'No steps for this date yet'}</p>
        {snapshot && <p className="muted">Watch captured: {new Date(snapshot.captured_at).toLocaleString('en-GB')}<br />Server received: {new Date(snapshot.received_at).toLocaleString('en-GB')}</p>}
      </div>}
      <div className="connection-actions">
        {!paired && <button className="button secondary" disabled={!zepp.ready || zepp.busy} onClick={() => void zepp.action('pair')}>Create watch pairing</button>}
        {paired && !connection.enabled && <button className="button primary" disabled={!fresh || zepp.busy || !zepp.ready} onClick={() => void zepp.action('enable')}>I verified my watch · use direct steps</button>}
        {paired && connection.enabled && <button className="button secondary" disabled={zepp.busy} onClick={() => void zepp.action('disable')}>Use Health Connect totals</button>}
        {paired && <button className="button secondary" disabled={zepp.busy} onClick={() => void zepp.action('revoke')}>Disconnect direct sync</button>}
      </div>
      {zepp.pairing && <div className="zepp-pairing"><label>Pairing configuration · paste into Steady’s settings in Zepp<textarea readOnly value={zepp.pairing} spellCheck={false} /></label><p>This can upload watch steps to your account. Keep it private. Disconnecting revokes it.</p><div className="connection-actions"><button className="button secondary" onClick={() => { void navigator.clipboard.writeText(zepp.pairing).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? 'Copied' : 'Copy pairing'}</button><button className="text-button" onClick={zepp.hidePairing}>Hide pairing</button></div></div>}
    </>}
    {zepp.error && <p className="form-error" role="status">{zepp.error}</p>}
    <details className="help-details"><summary>Watch setup and testing</summary><ol>
      <li>Install the Steady watch mini app using Zepp Developer Mode. This needs a Zepp developer account and an app ID.</li>
      <li>Create pairing here, then paste it into the Steady mini app’s settings inside Zepp. The pairing is shown only once. To replace it, disconnect and pair again.</li>
      <li>Open Steady on the watch and start background sync. Grant step and background-service access on the watch.</li>
      <li>Compare the direct reading above with your watch. Then test with Steady closed and after a Bluetooth disconnect/reconnect before enabling direct totals.</li>
    </ol><p>The watch attempts delivery about every 15 minutes while its service runs. Zepp, Bluetooth and internet availability can delay it. Only one watch background service can run at a time. Previous days contain only snapshots this mini app actually captured; Health Connect remains the fallback.</p></details>
  </section>;
}
