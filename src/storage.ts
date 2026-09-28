import { openDB } from 'idb';
import { Capacitor } from '@capacitor/core';
import { stateSchema, type State } from './model';
import seedFoods from './foods.json';

export const initialState = (): State => stateSchema.parse({
  version: 1,
  profile: { name: '', age: null, height: null, startingWeight: null, calorieGoal: null, stepGoal: null, goalWeight: null },
  foods: seedFoods, recipes: [], entries: [], weights: [], activities: [], lastHealthSync: null,
});
const dbPromise = () => openDB('steady-fitness', 1, { upgrade(db) { db.createObjectStore('app'); } });
let connection: ReturnType<typeof dbPromise> | undefined;
const db = () => connection ??= dbPromise();
export async function readMetadata<T>(key: string): Promise<T | undefined> { return (await db()).get('app', key); }
export async function writeMetadata(key: string, value: unknown) { return (await db()).put('app', value, key); }
export async function clearLocalData() {
  const database = await db(); await database.clear('app'); return loadState();
}
export async function loadState(): Promise<State> {
  const database = await db();
  const stored = await database.get('app', 'state');
  if (stored) return stateSchema.parse(stored);
  // Seed inside a transaction so two first-open tabs cannot overwrite one another.
  return mutateState(s => s);
}
export async function mutateState(change: (s: State) => State, metadata?: { key: string; value: unknown }): Promise<State> {
  const database = await db();
  const tx = database.transaction('app', 'readwrite');
  const existing = await tx.store.get('state');
  const next = stateSchema.parse(change(existing ? stateSchema.parse(existing) : initialState()));
  await tx.store.put(next, 'state');
  if (metadata) await tx.store.put(metadata.value, metadata.key);
  await tx.done;
  return next;
}
export async function exportFile(contents: string, filename: string, type = 'application/json') {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const file = await Filesystem.writeFile({ path: filename, data: contents, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: 'Steady backup', files: [file.uri] });
    return;
  }
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
