import { describe, it, expect } from 'vitest';
import { freshnessBadge } from '@/data/price-freshness';

const now = new Date('2026-04-19T12:00:00Z');

describe('freshnessBadge', () => {
  it('returns LIVE when the age is under 30 minutes', () => {
    expect(freshnessBadge({ updatedAt: '2026-04-19T11:45:00Z', now }).label).toBe('LIVE');
    expect(freshnessBadge({ updatedAt: '2026-04-19T11:35:00Z', now }).kind).toBe('live');
  });

  it('switches to "N min ago" at 30+ minutes', () => {
    const b = freshnessBadge({ updatedAt: '2026-04-19T11:15:00Z', now });
    expect(b.kind).toBe('recent');
    expect(b.label).toBe('updated 45 min ago');
  });

  it('uses hours for ages 1–48 h', () => {
    const b = freshnessBadge({ updatedAt: '2026-04-19T01:00:00Z', now });
    expect(b.kind).toBe('recent');
    expect(b.label).toBe('updated 11h ago');
  });

  it('uses days for ages 48 h – 7 d, and flags stale', () => {
    const b = freshnessBadge({ updatedAt: '2026-04-16T12:00:00Z', now });
    expect(b.kind).toBe('stale');
    expect(b.label).toBe('updated 3d ago');
  });

  it('returns stale for anything older than 7 days as "N d ago"', () => {
    const b = freshnessBadge({ updatedAt: '2026-04-01T12:00:00Z', now });
    expect(b.kind).toBe('stale');
    expect(b.label).toBe('updated 18d ago');
  });
});
