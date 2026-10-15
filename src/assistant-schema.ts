import { z } from 'zod';
import { foodSchema, macrosSchema, recipeSchema } from './model.ts';

export const chatMessageSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(6000) });
export const draftItemSchema = z.object({
  ref: z.string().max(140).nullable(), name: z.string().min(1).max(200),
  brand: z.string().max(200).nullable(), grams: z.number().positive().max(100000).nullable(),
  preparation: foodSchema.shape.preparation,
  per100: macrosSchema.nullable(),
  portionLabel: z.string().max(200).nullable(),
  notes: z.string().max(1200), sourceUrls: z.array(z.string().url()).max(8),
});
export const proposalSchema = z.object({ reply: z.string().min(1).max(6000), items: z.array(draftItemSchema).max(20) });
export const assistantRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(24),
  foods: z.array(foodSchema).max(10000), recipes: z.array(recipeSchema).max(1000),
  draft: z.array(draftItemSchema).max(20).default([]), webSearch: z.boolean().default(false),
  apiKey: z.string().trim().min(20).max(250).optional(),
});
export const resolvedItemSchema = z.object({
  food: foodSchema, grams: z.number().positive().max(100000).nullable(),
  recipeId: z.string().max(100).optional(), notes: z.string().max(1200),
  existing: z.boolean(),
});
export const assistantResponseSchema = z.object({
  reply: z.string(), items: z.array(resolvedItemSchema).max(20), draft: z.array(draftItemSchema).max(20),
  warnings: z.array(z.string()),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type DraftItem = z.infer<typeof draftItemSchema>;
export type ResolvedItem = z.infer<typeof resolvedItemSchema>;
export type AssistantResponse = z.infer<typeof assistantResponseSchema>;

export function foodIdentity(food: { name: string; brand?: string; preparation: string }) {
  const normal = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return [normal(food.name), normal(food.brand || ''), food.preparation].join('|');
}
