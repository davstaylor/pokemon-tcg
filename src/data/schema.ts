import { z } from 'zod';

export const SUPPORTED_LANGUAGES = ['en', 'ja', 'ko', 'zh'] as const;
export type Language = typeof SUPPORTED_LANGUAGES[number];

export const AttackSchema = z.object({
  name: z.string(),
  cost: z.array(z.string()),
  damage: z.string(),
  text: z.string().nullable(),
});
export type Attack = z.infer<typeof AttackSchema>;

export const PrintDataSchema = z.object({
  name: z.string(),
  setName: z.string(),
  setSymbol: z.string(),
  rarity: z.string(),
  hp: z.number().nullable(),
  types: z.array(z.string()),
  attacks: z.array(AttackSchema),
  artist: z.string(),
  imageURL: z.string(),
  releaseDate: z.string(),
  flavorText: z.string().nullable(),
});
export type PrintData = z.infer<typeof PrintDataSchema>;

export const PrintsSchema = z
  .object({
    en: PrintDataSchema.optional(),
    ja: PrintDataSchema.optional(),
    ko: PrintDataSchema.optional(),
    zh: PrintDataSchema.optional(),
  })
  .strict()
  .refine((prints) => Object.keys(prints).length > 0, {
    message: 'A card identity must have at least one print',
  });

export const CardIdentitySchema = z.object({
  id: z.string(),
  defaultName: z.string(),
  prints: PrintsSchema,
  searchTokens: z.array(z.string()),
  filters: z.object({
    setId: z.string(),
    rarity: z.string(),
    types: z.array(z.string()),
    series: z.string(),
  }),
});
export type CardIdentity = z.infer<typeof CardIdentitySchema>;

export const CardIdentityArraySchema = z.array(CardIdentitySchema);
