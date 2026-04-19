import type { CardIdentity, PrintData, Language } from './schema';
import { SUPPORTED_LANGUAGES } from './schema';

type RawCard = {
  id: string;
  localId: string;
  name: string;
  image: string | null;
  set?: {
    id: string;
    name: string;
    symbol: string | null;
    // serie is present in fixture data but absent in the live TCGdex API response;
    // derive series from the set ID prefix instead (see deriveSeriesId below).
    serie?: { id: string; name: string };
    releaseDate: string;
  };
  rarity: string | null;
  hp: number | null;
  types?: string[];
  attacks?: Array<{ name?: string; cost?: string[]; damage?: string | number; effect?: string | null }>;
  illustrator: string | null | undefined;
  description: string | null | undefined;
};

export type RawDumps = Partial<Record<Language, RawCard[]>>;

// Derive a series ID from a set ID by extracting the alphabetic prefix.
// TCGdex card detail doesn't include serie in the set object, so we infer it:
//   swsh1 → swsh, sv9 → sv, base1 → base, gym1 → gym, exu → exu
// If serie IS present in the raw data (e.g. fixture files), prefer it.
function deriveSeriesId(set: NonNullable<RawCard['set']>): string {
  if (set.serie?.id) return set.serie.id;
  const match = set.id.match(/^([a-z-]+)/i);
  return match ? match[1].toLowerCase() : set.id;
}

function toImageURL(base: string | null): string {
  if (!base) return '';
  return `${base}/high.webp`;
}

function toPrint(raw: RawCard): PrintData {
  return {
    name: raw.name,
    setName: raw.set?.name ?? '',
    setSymbol: raw.set?.symbol ? `${raw.set.symbol}.png` : '',
    rarity: raw.rarity ?? 'Unknown',
    hp: raw.hp ?? null,
    types: raw.types ?? [],
    attacks: (raw.attacks ?? [])
      .filter((a) => a.name != null)
      .map((a) => ({
        name: a.name!,
        cost: a.cost ?? [],
        damage: a.damage != null ? String(a.damage) : '',
        text: a.effect ?? null,
      })),
    artist: raw.illustrator ?? 'Unknown',
    imageURL: toImageURL(raw.image),
    releaseDate: raw.set?.releaseDate ?? '',
    flavorText: raw.description ?? null,
  };
}

// pickDefaultName preference: EN first, then JA (TCG source language),
// then the European block, then the Asian block. If a card has no prints
// in any of those, pickDefaultName throws — which is an invariant violation
// because we also require at least one print in PrintsSchema.
function pickDefaultName(prints: Partial<Record<Language, PrintData>>): string {
  for (const lang of SUPPORTED_LANGUAGES) {
    const p = prints[lang];
    if (p) return p.name;
  }
  throw new Error('normalise: card has no prints — invariant violated');
}

export function normalise(dumps: RawDumps): CardIdentity[] {
  const byId = new Map<string, {
    prints: Partial<Record<Language, PrintData>>;
    filters: CardIdentity['filters'];
  }>();

  for (const lang of SUPPORTED_LANGUAGES) {
    for (const raw of dumps[lang] ?? []) {
      const existing = byId.get(raw.id);
      const print = toPrint(raw);
      if (!existing) {
        // Non-EN summary records have no set/serie info. If we haven't seen
        // this card in EN yet (where full detail is always fetched), we can't
        // build a valid CardIdentity — skip and wait for the EN record to
        // create the entry. Any non-EN print for a card the EN dump lacks
        // entirely is silently dropped.
        if (!raw.set) continue;
        byId.set(raw.id, {
          prints: { [lang]: print },
          filters: {
            setId: raw.set.id,
            rarity: raw.rarity ?? 'Unknown',
            types: raw.types ?? [],
            series: deriveSeriesId(raw.set),
          },
        });
      } else {
        existing.prints[lang] = print;
      }
    }
  }

  return Array.from(byId.entries()).map(([id, { prints, filters }]) => ({
    id,
    defaultName: pickDefaultName(prints),
    prints,
    searchTokens: Object.values(prints)
      .map((p) => p!.name)
      .filter((n): n is string => !!n),
    filters,
  }));
}
