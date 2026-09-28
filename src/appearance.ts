import { useEffect, useState } from 'react';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';

export type AppearancePreference = 'system' | 'light' | 'dark';
const storageKey = 'steady-appearance';

export function readAppearance(): AppearancePreference {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* System appearance still works when storage is unavailable. */ }
  return 'system';
}

export function applyAppearance(preference: AppearancePreference) {
  const dark = preference === 'dark' || preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#142019' : '#fafbf7');
  if (Capacitor.isNativePlatform()) {
    // Capacitor's Dark style means light icons over a dark background.
    void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light })
      .catch(() => console.warn('Could not update the system bar appearance.'));
  }
}

export function useAppearance() {
  const [preference, setPreference] = useState<AppearancePreference>(readAppearance);
  useEffect(() => {
    const refresh = () => applyAppearance(preference);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const resume = () => { if (document.visibilityState === 'visible') refresh(); };
    const storage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setPreference(readAppearance());
    };
    refresh();
    media.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('storage', storage);
    const native = Capacitor.isNativePlatform()
      ? NativeApp.addListener('appStateChange', ({ isActive }) => { if (isActive) refresh(); }) : null;
    return () => {
      media.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('storage', storage);
      void native?.then(handle => handle.remove());
    };
  }, [preference]);
  const set = (value: AppearancePreference) => {
    try { localStorage.setItem(storageKey, value); } catch { /* Keep the session preference usable. */ }
    setPreference(value);
  };
  return { preference, set };
}
