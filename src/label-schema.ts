import { z } from 'zod';
import { foodSchema } from './model.ts';

const nutrient = z.number().finite().nonnegative().max(100000).nullable();
export const labelReadingSchema = z.object({
  name: z.string().max(200).nullable(), brand: z.string().max(200).nullable(),
  category: foodSchema.shape.group.nullable(), barcode: z.string().max(30).nullable(),
  basisAmount: z.number().positive().max(100000).nullable(), unit: z.enum(['g', 'ml']).nullable(),
  nutrients: z.object({ kcal: nutrient, kj: nutrient, protein: nutrient, carbs: nutrient, fat: nutrient, fibre: nutrient }),
  servingAmount: z.number().positive().max(100000).nullable(), servingUnit: z.enum(['g', 'ml']).nullable(),
  notes: z.string().max(1200), warnings: z.array(z.string().max(240)).max(8),
});
export const labelRequestSchema = z.object({
  operation: z.literal('scan_label'),
  images: z.array(z.string().max(850000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)).min(1).max(2),
  apiKey: z.string().trim().min(20).max(250).optional(),
});
export type LabelReading = z.infer<typeof labelReadingSchema>;
