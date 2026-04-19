import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SparklineDumpSchema, RangeDumpSchema } from '../src/data/history-schema.ts';

const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
const SPARK_FILE = resolve(DATA_DIR, 'sparkline-snapshot.json');
const RANGE_FILE = resolve(DATA_DIR, 'range-snapshot.json');

const WORKER_URL = process.env.WORKER_URL;

const EMPTY_SPARK = { days: 30, cutoff: new Date(0).toISOString().slice(0, 10), records: {} };
const EMPTY_RANGE = { days: 90, cutoff: new Date(0).toISOString().slice(0, 10), records: {} };

async function fetchOrFallback<T>(url: string, schema: { parse: (x: unknown) => T }, fallback: T, label: string): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`${label}: HTTP ${res.status} from Worker — using empty fallback`);
      return fallback;
    }
    const body = await res.json();
    return schema.parse(body);
  } catch (err) {
    console.warn(`${label}: ${(err as Error).message} — using empty fallback`);
    return fallback;
  }
}

async function main() {
  if (!WORKER_URL) {
    console.warn('WORKER_URL not set — writing empty history snapshots');
    writeFileSync(SPARK_FILE, JSON.stringify(EMPTY_SPARK));
    writeFileSync(RANGE_FILE, JSON.stringify(EMPTY_RANGE));
    return;
  }

  console.log(`Pulling history from ${WORKER_URL}...`);
  const [spark, range] = await Promise.all([
    fetchOrFallback(`${WORKER_URL}/sparkline-dump?days=30`, SparklineDumpSchema, EMPTY_SPARK, 'sparkline-dump'),
    fetchOrFallback(`${WORKER_URL}/range-dump?days=90`, RangeDumpSchema, EMPTY_RANGE, 'range-dump'),
  ]);

  writeFileSync(SPARK_FILE, JSON.stringify(spark));
  writeFileSync(RANGE_FILE, JSON.stringify(range));
  console.log(`Wrote sparkline for ${Object.keys(spark.records).length} cards, range for ${Object.keys(range.records).length} cards`);
}

main().catch((err) => {
  console.error('pull-history-from-worker failed:', err);
  process.exit(1);
});
