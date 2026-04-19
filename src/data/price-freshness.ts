export type BadgeKind = 'live' | 'recent' | 'stale';
export type Badge = { kind: BadgeKind; label: string };

export function freshnessBadge({ updatedAt, now }: { updatedAt: string; now?: Date }): Badge {
  const then = new Date(updatedAt);
  const n = now ?? new Date();
  const ageMs = n.getTime() - then.getTime();
  const ageMin = Math.floor(ageMs / 60_000);
  const ageHr = Math.floor(ageMs / 3_600_000);
  const ageDay = Math.floor(ageMs / 86_400_000);

  if (ageMin < 30) return { kind: 'live', label: 'LIVE' };
  if (ageMin < 60) return { kind: 'recent', label: `updated ${ageMin} min ago` };
  if (ageHr < 48) return { kind: 'recent', label: `updated ${ageHr}h ago` };
  return { kind: 'stale', label: `updated ${ageDay}d ago` };
}
