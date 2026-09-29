import { stateSchema, type State } from './model';

export type ConflictChoice = 'local' | 'remote';
export type ConflictDetail = { label: string; local: string; remote: string };
function describe(value: unknown): string {
  if (value === undefined) return 'Removed';
  if (value === null) return 'Not set';
  if (typeof value !== 'object') return String(value);
  const v = value as Record<string, unknown>;
  if (v.grams) return `${v.name} · ${v.grams} g · ${v.meal}`;
  if (v.kg) return `${v.kg} kg`;
  if (v.steps !== undefined) return `${v.steps ?? '—'} steps · ${v.activeKcal ?? '—'} active kcal · ${v.distanceKm ?? '—'} km`;
  if (v.per100) return `${v.name} · ${JSON.stringify(v.per100)} per 100 g`;
  if (v.yieldGrams) return `${v.name} · ${v.yieldGrams} g · ${v.servings} servings`;
  return JSON.stringify(value);
}
export class SyncConflict extends Error {
  constructor(public details: ConflictDetail[]) { super(`Some records changed on both devices. Use Sync now to review ${details.length} conflicting change${details.length === 1 ? '' : 's'}.`); this.name = 'SyncConflict'; }
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function mergeStates(base: State, local: State, remote: State, choice?: ConflictChoice): State {
  const conflicts: ConflictDetail[] = [];
  function choose<T>(old: T, ours: T, theirs: T, label: string): T {
    if (equal(ours, theirs) || equal(old, theirs)) return ours;
    if (equal(old, ours)) return theirs;
    if (choice) return choice === 'local' ? ours : theirs;
    conflicts.push({ label, local: describe(ours), remote: describe(theirs) }); return ours;
  }
  function rows<T>(old: T[], ours: T[], theirs: T[], key: (x: T) => string, label: string, resolve?: (a: T, b: T) => T | undefined) {
    const maps = [old, ours, theirs].map(xs => new Map(xs.map(x => [key(x), x])));
    const keys = new Set(maps.flatMap(m => [...m.keys()]));
    return [...keys].map(k => { const a = maps[1].get(k), b = maps[2].get(k); return a && b && resolve?.(a, b) || choose(maps[0].get(k), a, b, `${label} ${k}`); }).filter((v): v is T => v !== undefined);
  }
  const profile = { ...local.profile };
  for (const key of Object.keys(profile) as (keyof State['profile'])[]) {
    Object.assign(profile, { [key]: choose(base.profile[key], local.profile[key], remote.profile[key], `profile ${key}`) });
  }
  const result: State = {
    version: 1, profile,
    foods: rows(base.foods, local.foods, remote.foods, x => x.id, 'food'),
    recipes: rows(base.recipes, local.recipes, remote.recipes, x => x.id, 'recipe'),
    entries: rows(base.entries, local.entries, remote.entries, x => x.id, 'diary entry'),
    skippedMeals: rows(base.skippedMeals ?? [], local.skippedMeals ?? [], remote.skippedMeals ?? [], x => `${x.date}:${x.meal}`, 'skipped meal'),
    weights: rows(base.weights, local.weights, remote.weights, x => x.date, 'weigh-in'),
    activities: rows(base.activities, local.activities, remote.activities, x => `${x.date}:${x.source}`, 'activity', (a, b) => {
      if (a.source !== 'health' || b.source !== 'health') return undefined;
      const [latest, older] = Date.parse(a.updatedAt) >= Date.parse(b.updatedAt) ? [a, b] : [b, a];
      return { ...latest, steps: latest.steps ?? older.steps, activeKcal: latest.activeKcal ?? older.activeKcal, distanceKm: latest.distanceKm ?? older.distanceKm };
    }),
    lastHealthSync: [local.lastHealthSync, remote.lastHealthSync].filter((x): x is string => !!x).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null,
  };
  if (conflicts.length) throw new SyncConflict(conflicts);
  return stateSchema.parse(result);
}
