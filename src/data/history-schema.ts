import { z } from 'zod';

export const SnapshotSchema = z.object({
  cardId: z.string(),
  date: z.string(),
  trend: z.number().nullable(),
  low: z.number().nullable(),
  avg30: z.number().nullable(),
  avg7: z.number().nullable(),
  avg1: z.number().nullable(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const SparklineDumpSchema = z.object({
  days: z.number(),
  cutoff: z.string(),
  records: z.record(z.string(), z.array(SnapshotSchema)),
});
export type SparklineDump = z.infer<typeof SparklineDumpSchema>;

export const RangeSchema = z.object({
  low: z.number().nullable(),
  high: z.number().nullable(),
  latest: z.number().nullable(),
});
export type Range = z.infer<typeof RangeSchema>;

export const RangeDumpSchema = z.object({
  days: z.number(),
  cutoff: z.string(),
  records: z.record(z.string(), RangeSchema),
});
export type RangeDump = z.infer<typeof RangeDumpSchema>;
