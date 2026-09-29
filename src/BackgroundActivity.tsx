import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { cloud } from './cloud';
import { adoptBackgroundSession, backgroundStatus, disableBackground, enableBackground, hasAndroidBackground, type BackgroundStatus } from './native-background';

export default function BackgroundActivity() {
  const [status, setStatus] = useState<BackgroundStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!hasAndroidBackground) return;
    const refresh = () => { void backgroundStatus().then(setStatus).catch(() => setError('Install the latest Android app to enable background sync.')); };
    refresh(); const timer = setInterval(refresh, 30000);
    const listener = App.addListener('appStateChange', ({ isActive }) => { if (isActive) refresh(); });
    return () => { clearInterval(timer); void listener.then(h => h.remove()); };
  }, []);
  async function toggle() {
    setBusy(true); setError('');
    try { if (cloud) await adoptBackgroundSession(cloud); if (status?.enabled && status.granted) await disableBackground(); else await enableBackground(cloud); setStatus(await backgroundStatus()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not change background sync.'); }
    finally { setBusy(false); }
  }
  if (!hasAndroidBackground) return null;
  return <div className="background-health"><div><strong>While the app is closed</strong><p>{status?.enabled && status.granted ? 'Background checks on · about every 15 minutes' : 'Enable background checks to keep activity up to date.'}</p></div><button className="button secondary" disabled={busy || !status?.available} onClick={() => void toggle()}>{busy ? 'Updating…' : status?.enabled && status.granted ? 'Turn off background checks' : 'Enable background checks'}</button>
    {status?.enabled && <p className="background-detail">{status.message}{status.lastUploaded ? ` Last background upload: ${new Date(status.lastUploaded).toLocaleString('en-GB')}.` : ''}</p>}
    {status && !status.available && <p className="background-detail">Background health access needs a supported Android 15 or later device.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
