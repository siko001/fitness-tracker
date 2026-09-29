import { z } from 'zod';
import { activitySchema, type State } from './model';

export const zeppSnapshotSchema = z.object({
  device_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  steps: z.number().int().min(0).max(500000), captured_at: z.string().datetime({ offset: true }), received_at: z.string().datetime({ offset: true }),
});
export const zeppDataSchema = z.object({
  connection: z.object({ device_id: z.string().uuid(), enabled: z.boolean(), revoked_at: z.string().nullable(), last_received_at: z.string().nullable() }).nullable(),
  snapshots: z.array(zeppSnapshotSchema),
});
export type ZeppData = z.infer<typeof zeppDataSchema>;
export const emptyZepp: ZeppData = { connection: null, snapshots: [] };

// Render-only projection: the diary remains compatible with older apps, and native
// Health Connect uploads cannot overwrite the separately stored direct readings.
export function withZeppSteps(state: State, data: ZeppData): State {
  if (!data.connection?.enabled || data.connection.revoked_at) return state;
  const activities = [...state.activities];
  for (const snapshot of data.snapshots) {
    if (snapshot.device_id !== data.connection.device_id) continue;
    const index = activities.findIndex(a => a.date === snapshot.date && a.source === 'health');
    const health = activities[index];
    // Both counters are cumulative watch totals. Never sum them. A later Zepp
    // export can overtake a disconnected direct relay and remains a useful fallback.
    if (health?.stepSource === 'zepp' && health.steps !== null && health.steps > snapshot.steps) continue;
    const projected = activitySchema.parse({ ...health, date: snapshot.date, source: 'health', steps: snapshot.steps,
      stepSource: 'zepp-direct', activeKcal: health?.activeKcal ?? null, distanceKm: health?.distanceKm ?? null,
      updatedAt: new Date(snapshot.captured_at).toISOString() });
    if (index >= 0) activities[index] = projected; else activities.push(projected);
  }
  return { ...state, activities };
}
