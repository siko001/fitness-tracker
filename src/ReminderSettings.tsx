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
  return <section className="card"><SectionHeading title="A gentle nudge" aside={<Bell size={20} />} />
    <p className="muted">Breakfast at 10:00, lunch at 14:00 and dinner at 21:00. Repeats every 20 minutes until you log the meal or skip it for today.</p>
    {!isNative ? <div className="callout"><strong>Set up on your phone</strong><p>Install the Android or iPhone app to enable food reminders. Browser notifications are not supported in this version.</p></div> : <form onSubmit={save}>
      <label className="check-label"><input type="checkbox" checked={settings.enabled} onChange={e => setSettings({ ...settings, enabled: e.target.checked })} />Remind me to log food</label>
      <Field label="Reminder style"><select value={settings.mode} onChange={e => setSettings({ ...settings, mode: e.target.value as 'meals' | 'daily' })}><option value="meals">After each meal</option><option value="daily">One daily check-in</option></select></Field>
      <div className="form-grid">{settings.mode === 'meals' && <><Field label="Breakfast check-in"><input type="time" required value={settings.breakfast} onChange={e => setSettings({ ...settings, breakfast: e.target.value })} /></Field><Field label="Lunch check-in"><input type="time" required value={settings.lunch} onChange={e => setSettings({ ...settings, lunch: e.target.value })} /></Field></>}
        <Field label={settings.mode === 'meals' ? 'Dinner check-in' : 'Daily check-in'}><input type="time" required value={settings.dinner} onChange={e => setSettings({ ...settings, dinner: e.target.value })} /></Field></div>
      <Field label="Stop reminders for the night"><select value={settings.quietStart} onChange={e => setSettings({ ...settings, quietStart: e.target.value })}><option value="22:00">22:00</option><option value="23:00">23:00</option><option value="00:00">Midnight</option></select></Field><p className="muted">{settings.mode === 'meals' ? 'Log food or tap Skip today to stop that meal’s reminders.' : 'Skips the check-in if you have logged any food that day.'} Uses this phone’s diary and local time. Desktop entries count after they reach this phone.</p>
      <div className="backup-buttons"><button className="button primary" disabled={busy}>Save reminders</button><button type="button" className="button secondary" disabled={busy} onClick={() => void testReminder().then(() => setMessage('A test notification is scheduled in 5 seconds.')).catch(e => setMessage(String(e)))}>Test notification</button></div>
      <p className="muted">Each day starts fresh. Skipping weekday breakfast does not skip weekend breakfast. Android repeats work with the app closed and resume after reboot. iPhone holds the next 60 notifications and refreshes them when you use the app. Your phone may delay delivery to save battery.</p>
    </form>}{message && <p role="status">{message}</p>}
  </section>;
}
