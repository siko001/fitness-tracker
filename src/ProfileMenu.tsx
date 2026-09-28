import { useId, useRef, useState } from 'react';
import { Monitor, Moon, Settings, Sun } from 'lucide-react';
import type { AppearancePreference } from './appearance';

export default function ProfileMenu({ name, appearance, openSettings }: {
  name: string; appearance: { preference: AppearancePreference; set: (value: AppearancePreference) => void }; openSettings: () => void;
}) {
  const id = useId(), panel = useRef<HTMLDivElement>(null), [open, setOpen] = useState(false);
  return <>
    <button className="avatar-button" popoverTarget={id} aria-label="Open profile menu" aria-expanded={open} aria-controls={id}>{name?.[0]?.toUpperCase() || <Settings size={18} />}</button>
    <div id={id} ref={panel} popover="auto" className="profile-menu" onToggle={e => setOpen(e.newState === 'open')}>
      <strong>{name || 'Your profile'}</strong>
      <p>Appearance</p>
      <div className="segmented" aria-label="Quick theme choices">
        {([{ value: 'system', label: 'System', icon: Monitor }, { value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }] as const).map(item => <button key={item.value} className={appearance.preference === item.value ? 'selected' : ''} aria-pressed={appearance.preference === item.value} onClick={() => appearance.set(item.value)}><item.icon size={16} />{item.label}</button>)}
      </div>
      <button className="button secondary" onClick={() => { panel.current?.hidePopover(); openSettings(); }}><Settings size={16} />Profile & settings</button>
    </div>
  </>;
}
