import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExchangeRatesSchema } from '../src/data/currency-schema.ts';

const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, '..', 'data', 'exchange-rates.json');

async function main() {
  const url = 'https://api.frankfurter.app/latest?from=EUR&to=USD,GBP,JPY';
  console.log(`Fetching ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Frankfurter responded ${res.status}`);
  const body = (await res.json()) as unknown;
  // Frankfurter returns `amount` and other fields; drop them and validate our shape.
  const rawObj = body as { base: unknown; date: unknown; rates: unknown };
  const parsed = ExchangeRatesSchema.parse({ base: rawObj.base, date: rawObj.date, rates: rawObj.rates });
  writeFileSync(OUT_FILE, JSON.stringify(parsed, null, 2));
  console.log(`Wrote rates for ${parsed.date}: USD=${parsed.rates.USD}, GBP=${parsed.rates.GBP}, JPY=${parsed.rates.JPY}`);
}

main().catch((err) => {
  console.error('fetch-exchange-rates failed:', err);
  process.exit(1);
});
