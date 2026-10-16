import { z } from 'zod';
import { chatMessageSchema, draftItemSchema, resolvedItemSchema } from './assistant-schema';
import { dateSchema, foodSchema, localDate, meals, uid, type Meal } from './model';
import { mutateMetadata, readMetadata } from './storage';

export const emptyRecipeDraft = () => ({ enabled: false, name: '', yieldGrams: null as string | null, servings: '1' });
const recipeDraftSchema = z.object({ enabled: z.boolean(), name: z.string().max(200), yieldGrams: z.string().max(20).nullable(), servings: z.string().max(20) });
const chatSchema = z.object({
  id: z.string().min(1).max(100), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  messages: z.array(chatMessageSchema).max(1000), input: z.string().max(6000),
  draft: z.array(draftItemSchema).max(20), items: z.array(resolvedItemSchema).max(20),
  alternatives: z.array(z.array(foodSchema).max(6)).max(20), warnings: z.array(z.string()),
  entryIds: z.array(z.string().min(1).max(100)).max(20),
  logMeal: z.boolean(), meal: z.enum(meals), date: dateSchema, time: z.string(),
  web: z.boolean(), pending: z.boolean(), savedAt: z.string().datetime().nullable(),
  recipeDraft: recipeDraftSchema.default(emptyRecipeDraft),
});
const historySchema = z.object({ version: z.literal(1), activeId: z.string().nullable(), chats: z.array(chatSchema) });
export type AssistantChat = z.infer<typeof chatSchema>;
export type AssistantHistory = z.infer<typeof historySchema>;
const key = 'food-assistant-history-v1';
const empty = (): AssistantHistory => ({ version: 1, activeId: null, chats: [] });
export const readAssistantHistory = async () => historySchema.parse(await readMetadata(key) ?? empty());
export function newAssistantChat(date: string, meal: Meal, libraryOnly: boolean): AssistantChat {
  const now = new Date().toISOString();
  return { id: uid(), createdAt: now, updatedAt: now, messages: [], input: '', draft: [], items: [], alternatives: [], warnings: [], entryIds: [], logMeal: !libraryOnly, meal, date, time: date === localDate() ? new Date().toTimeString().slice(0, 5) : '', web: false, pending: false, savedAt: null, recipeDraft: emptyRecipeDraft() };
}
export const chatTitle = (chat: AssistantChat) => (chat.messages.find(m => m.role === 'user')?.content || chat.input || 'New conversation').slice(0, 80);
export const hasChatContent = (chat: AssistantChat) => !!(chat.messages.length || chat.input.trim() || chat.items.length);
export function saveAssistantChat(value: AssistantChat) {
  // Parse an explicit schema: the session API key can never enter history.
  const chat = chatSchema.parse(value);
  return mutateMetadata(key, previous => {
    const history = historySchema.parse(previous ?? empty());
    return { ...history, activeId: chat.id, chats: [...history.chats.filter(c => c.id !== chat.id), chat] };
  });
}
export function selectAssistantChat(id: string | null) {
  return mutateMetadata(key, previous => ({ ...historySchema.parse(previous ?? empty()), activeId: id }));
}
