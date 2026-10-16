import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { clearLocalData, readMetadata } from './storage';
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
