import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { clearLocalData, readMetadata, writeMetadata } from './storage';
import { newAssistantChat, readAssistantHistory, saveAssistantChat, selectAssistantChat } from './assistant-history';

beforeEach(async () => { await clearLocalData(); });
test('history persists drafts but strips session credentials and review approval', async () => {
  const chat = newAssistantChat('2026-10-16', 'Lunch', false);
  chat.input = 'Less dressing, please';
  chat.messages = [{ role: 'user', content: 'A tuna ftira' }, { role: 'assistant', content: 'Whole or half?' }];
  await saveAssistantChat({ ...chat, apiKey: 'gsk_never_store_me', reviewed: true } as typeof chat);
  const loaded = await readAssistantHistory();
  expect(loaded.activeId).toBe(chat.id);
  expect(loaded.chats[0]).toEqual(chat);
  expect(JSON.stringify(await readMetadata('food-assistant-history-v1'))).not.toContain('gsk_never_store_me');
});
test('independent concurrent chat saves preserve both histories and a new chat keeps them', async () => {
  const first = { ...newAssistantChat('2026-10-16', 'Lunch', false), input: 'A tuna ftira' };
  const second = { ...newAssistantChat('2026-10-16', 'Snacks', false), input: 'An apple' };
  await Promise.all([saveAssistantChat(first), saveAssistantChat(second)]);
  expect((await readAssistantHistory()).chats.map(c => c.id).sort()).toEqual([first.id, second.id].sort());
  await selectAssistantChat(null);
  expect((await readAssistantHistory()).activeId).toBe(null);
  expect((await readAssistantHistory()).chats).toHaveLength(2);
});
test('old chats load with recipe defaults and recipe choices survive reopening', async () => {
  const { recipeDraft, ...oldChat } = { ...newAssistantChat('2026-10-16', 'Lunch', false), input: 'Tuna ftira' };
  await writeMetadata('food-assistant-history-v1', { version: 1, activeId: oldChat.id, chats: [oldChat] });
  const loaded = (await readAssistantHistory()).chats[0];
  expect(loaded.recipeDraft).toEqual(recipeDraft);
  loaded.recipeDraft = { enabled: true, name: 'Panina ftira', yieldGrams: '350', servings: '2' };
  await saveAssistantChat(loaded);
  expect((await readAssistantHistory()).chats[0].recipeDraft).toEqual(loaded.recipeDraft);
});
