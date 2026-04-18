import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllLanguages } from '../src/data/fetch.ts';
import { normalise, type RawDumps } from '../src/data/normalise.ts';
import { CardIdentityArraySchema } from '../src/data/schema.ts';

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

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Wrote ${identities.length} card identities to data/cards.json in ${secs}s`);
}

main().catch((err) => {
  console.error('Data build failed:', err);
  process.exit(1);
});
