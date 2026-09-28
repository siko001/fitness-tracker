import { useEffect, useState, type FormEvent } from 'react';
import { Bell } from 'lucide-react';
import { defaultReminders } from './reminder-plan';
import { loadReminderSettings, saveReminderSettings, testReminder } from './reminders';
import { isNative } from './health';
import { Field, SectionHeading } from './ui';

export default function ReminderSettings() {
  const [settings, setSettings] = useState(defaultReminders), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { void loadReminderSettings().then(setSettings).catch(() => setMessage('Could not load reminder settings.')); }, []);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try { await saveReminderSettings(settings); setMessage(settings.enabled ? 'Reminders are ready on this phone.' : 'Food reminders are off.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save reminders.'); }
    finally { setBusy(false); }
  }
  return <section className="card"><SectionHeading title="Meal reminders" aside={<Bell size={20} />} />

    {!isNative ? <p className="muted">Manage reminders in the installed phone app.</p> : <form onSubmit={save}>
      <label className="check-label"><input type="checkbox" checked={settings.enabled} onChange={e => setSettings({ ...settings, enabled: e.target.checked })} />Remind me to log food</label>
      <Field label="Reminder style"><select value={settings.mode} onChange={e => setSettings({ ...settings, mode: e.target.value as 'meals' | 'daily' })}><option value="meals">After each meal</option><option value="daily">One daily check-in</option></select></Field>
      <div className="form-grid">{settings.mode === 'meals' && <><Field label="Breakfast check-in"><input type="time" required value={settings.breakfast} onChange={e => setSettings({ ...settings, breakfast: e.target.value })} /></Field><Field label="Lunch check-in"><input type="time" required value={settings.lunch} onChange={e => setSettings({ ...settings, lunch: e.target.value })} /></Field></>}
        <Field label={settings.mode === 'meals' ? 'Dinner check-in' : 'Daily check-in'}><input type="time" required value={settings.dinner} onChange={e => setSettings({ ...settings, dinner: e.target.value })} /></Field></div>
      <Field label="Stop reminders for the night"><select value={settings.quietStart} onChange={e => setSettings({ ...settings, quietStart: e.target.value })}><option value="22:00">22:00</option><option value="23:00">23:00</option><option value="00:00">Midnight</option></select></Field><p className="muted">{settings.mode === 'meals' ? 'Repeats every 20 minutes until you log or skip the meal.' : 'Only reminds you if no food is logged that day.'}</p>
      <div className="backup-buttons"><button className="button primary" disabled={busy}>Save reminders</button><button type="button" className="button secondary" disabled={busy} onClick={() => void testReminder().then(() => setMessage('A test notification is scheduled in 5 seconds.')).catch(e => setMessage(String(e)))}>Test notification</button></div>
      <details className="help-details"><summary>How reminders work</summary><p>Skipping applies to that meal and day only. Uses this phone’s diary and local time; desktop entries count once synced here.</p><p>Android reminders work with the app closed and resume after reboot. iPhone queues the next 60 notifications and refreshes them when you open the app. Battery saving may delay delivery.</p></details>
    </form>}{message && <p role="status">{message}</p>}
  </section>;
}
