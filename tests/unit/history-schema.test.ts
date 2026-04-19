import { describe, it, expect } from 'vitest';
import { SparklineDumpSchema, RangeDumpSchema } from '@/data/history-schema';

describe('SparklineDumpSchema', () => {
  it('accepts a well-formed sparkline dump', () => {
    const dump = {
      days: 30,
      cutoff: '2026-03-20',
      records: {
        'base1-4': [
          { cardId: 'base1-4', date: '2026-04-19', trend: 359.17, low: 92.5, avg30: 409.46, avg7: 324.13, avg1: 361.73 },
        ],
      },
    };
    expect(() => SparklineDumpSchema.parse(dump)).not.toThrow();
  });
  it('accepts an empty records map', () => {
    const empty = { days: 30, cutoff: '2026-03-20', records: {} };
    expect(() => SparklineDumpSchema.parse(empty)).not.toThrow();
  });
  it('rejects a dump missing records', () => {
    expect(() => SparklineDumpSchema.parse({ days: 30, cutoff: '2026-03-20' })).toThrow();
  });
});

describe('RangeDumpSchema', () => {
  it('accepts a well-formed range dump', () => {
    const dump = {
      days: 90,
      cutoff: '2026-01-19',
      records: { 'base1-4': { low: 287, high: 478, latest: 386 } },
    };
    expect(() => RangeDumpSchema.parse(dump)).not.toThrow();
  });
  it('accepts null values in range records', () => {
    const dump = {
      days: 90,
      cutoff: '2026-01-19',
      records: { 'base1-4': { low: null, high: null, latest: null } },
    };
    expect(() => RangeDumpSchema.parse(dump)).not.toThrow();
  });
});
