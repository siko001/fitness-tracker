import { registerPlugin } from '@capacitor/core';
import type { ReminderSettings } from './reminder-plan';
import type { SkippedMeal } from './model';

// Android runs the repeating alarm without a webview, internet or an open app.
export const AndroidMealReminders = registerPlugin<{
  configure(options: { settings: ReminderSettings; logged: SkippedMeal[]; skipped: SkippedMeal[] }): Promise<void>;
  pendingSkips(): Promise<{ skips: SkippedMeal[] }>;
  acknowledgeSkips(options: { skips: SkippedMeal[] }): Promise<void>;
  consumeOpen(): Promise<{ date?: string; meal?: string }>;
  clear(): Promise<void>;
}>('SteadyMealReminders');
