import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllLanguages } from '../src/data/fetch.ts';
import { normalise, type RawDumps } from '../src/data/normalise.ts';
import { CardIdentityArraySchema } from '../src/data/schema.ts';
import { extractPrices } from '../src/data/price-extract.ts';
import { PriceFileSchema, type PriceFile } from '../src/data/price-schema.ts';

const USE_FIXTURES = process.env.FIXTURES === '1';
// import.meta.dirname requires ESM; fall back to fileURLToPath for tsx CJS mode
const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'data');
const OUT_FILE = resolve(OUT_DIR, 'cards.json');

async function main() {
  const start = Date.now();
  console.log(USE_FIXTURES ? 'Loading fixture dumps...' : 'Fetching TCGdex dumps for 4 languages...');

  let dumps: RawDumps;
  if (USE_FIXTURES) {
    dumps = JSON.parse(
      readFileSync(resolve(OUT_DIR, 'fixtures', 'sample-cards.json'), 'utf8'),
    );
  } else {
    dumps = await fetchAllLanguages();
  }

  console.log('Normalising...');
  const identities = normalise(dumps);

  console.log('Validating schema...');
  CardIdentityArraySchema.parse(identities);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(identities));

  console.log('Extracting prices from EN dump...');
  const priceRecords = extractPrices(dumps.en ?? []);
  const priceFile: PriceFile = {
    generatedAt: new Date().toISOString(),
    records: Object.fromEntries(priceRecords.map((r) => [r.cardId, r])),
  };
  PriceFileSchema.parse(priceFile);  // fail loud on any shape drift
  const PRICE_FILE = resolve(OUT_DIR, 'prices-baseline.json');
  writeFileSync(PRICE_FILE, JSON.stringify(priceFile));
  console.log(`Wrote ${priceRecords.length} price records to data/prices-baseline.json`);

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Wrote ${identities.length} card identities to data/cards.json in ${secs}s`);
}

main().catch((err) => {
  console.error('Data build failed:', err);
  process.exit(1);
});
