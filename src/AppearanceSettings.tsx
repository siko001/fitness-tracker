import { Monitor, Moon, Sun } from 'lucide-react';
import type { AppearancePreference } from './appearance';
import { Field, SectionHeading } from './ui';

export default function AppearanceSettings({ preference, set }: { preference: AppearancePreference; set: (value: AppearancePreference) => void }) {
  const Icon = preference === 'system' ? Monitor : preference === 'dark' ? Moon : Sun;
  return <section className="card appearance-card">
    <div><SectionHeading title="Appearance" aside={<Icon size={20} />} /></div>
    <Field label="Colour theme">
      <select value={preference} onChange={event => set(event.target.value as AppearancePreference)}>
        <option value="system">System (default)</option><option value="light">Light</option><option value="dark">Dark</option>
      </select>
    </Field>
  </section>;
}
