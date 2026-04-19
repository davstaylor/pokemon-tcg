// Weekly schema-drift probe. Runs only the fetch + normalise + validate pipeline.
// No Astro build, no disk write. Exits 0 on valid shape, non-zero on Zod failure.
// Intended for CI use in schema-drift-check.yml — decouples "TCGdex shape changed"
// detection from nightly deployment health.
import { fetchAllLanguages } from '../src/data/fetch.ts';
import { normalise } from '../src/data/normalise.ts';
import { CardIdentityArraySchema } from '../src/data/schema.ts';

async function main() {
  console.log('Fetching all languages...');
  const dumps = await fetchAllLanguages();
  console.log('Normalising...');
  const identities = normalise(dumps);
  console.log('Validating...');
  CardIdentityArraySchema.parse(identities);
  console.log(`OK: ${identities.length} identities match current schema.`);
}

main().catch((err) => {
  console.error('DRIFT DETECTED:', err);
  process.exit(1);
});
