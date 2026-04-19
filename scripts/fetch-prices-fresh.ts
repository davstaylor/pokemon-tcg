import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';
import TCGdex from '@tcgdex/sdk';
import { extractPrices } from '../src/data/price-extract.ts';
import { PriceFileSchema, type PriceFile } from '../src/data/price-schema.ts';

const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CONFIG_PATH = resolve(REPO_ROOT, 'tracked-sets.yaml');
const OUT_FILE = resolve(REPO_ROOT, 'data', 'prices-fresh.json');

type TrackedConfig = { tracked: string[] };

async function main() {
  const start = Date.now();

  // 1. Parse tracked-sets.yaml — fail loudly on a bad config.
  const yamlText = readFileSync(CONFIG_PATH, 'utf8');
  const config = parseYaml(yamlText) as TrackedConfig;
  if (!config || !Array.isArray(config.tracked) || config.tracked.length === 0) {
    throw new Error(`tracked-sets.yaml: expected non-empty "tracked" array, got ${JSON.stringify(config)}`);
  }
  console.log(`Tracked sets: ${config.tracked.join(', ')}`);

  // 2. For each tracked set, fetch its card list, then each full card.
  const tcgdex = new TCGdex('en' as never);
  const rawCards: Array<{ id: string; pricing?: unknown }> = [];
  let failures = 0;
  let attempts = 0;

  for (const setId of config.tracked) {
    const setData = await tcgdex.fetch('sets', setId);
    if (!setData || !Array.isArray(setData.cards)) {
      throw new Error(`Set "${setId}" not found or has no cards at TCGdex — check tracked-sets.yaml`);
    }
    console.log(`Set ${setId}: ${setData.cards.length} cards`);
    for (const resume of setData.cards) {
      attempts++;
      try {
        const card = await tcgdex.fetch('cards', resume.id);
        if (card) rawCards.push(card as unknown as { id: string; pricing?: unknown });
      } catch (err) {
        failures++;
        console.warn(`Fetch failed for ${resume.id}: ${(err as Error).message}`);
      }
    }
  }

  // 3. Fail loud if more than half the fetches failed — something systemic is wrong.
  if (attempts > 0 && failures / attempts > 0.5) {
    throw new Error(`Fast-poll: ${failures}/${attempts} fetches failed — aborting to preserve last-known prices`);
  }

  // 4. Extract + validate + write.
  const priceRecords = extractPrices(rawCards as never);
  const priceFile: PriceFile = {
    generatedAt: new Date().toISOString(),
    records: Object.fromEntries(priceRecords.map((r) => [r.cardId, r])),
  };
  PriceFileSchema.parse(priceFile);
  writeFileSync(OUT_FILE, JSON.stringify(priceFile, null, 2));

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Wrote ${priceRecords.length} fresh price records to ${OUT_FILE} in ${secs}s`);
}

main().catch((err) => {
  console.error('Fast-poll failed:', err);
  process.exit(1);
});
