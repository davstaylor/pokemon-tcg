import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { PriceFileSchema } from '../src/data/price-schema.ts';

const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = resolve(__dirname, '..', 'data', 'prices-baseline.json');
const WORKER_DIR = resolve(__dirname, '..', 'workers', 'history-api');
const BATCH_SIZE = 200;

function isoDateDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlValue(v: number | null): string {
  return v === null ? 'NULL' : String(v);
}

// Seeds D1 with 4 synthetic points per card so sparklines aren't empty on day 1:
//   today-29: trend = avg30    (Cardmarket's own 30-day average)
//   today-7:  trend = avg7
//   today-1:  trend = avg1
//   today:    trend = trend    (current)
// Idempotent: safe to re-run (INSERT OR REPLACE).
async function main() {
  const file = PriceFileSchema.parse(JSON.parse(readFileSync(BASELINE_FILE, 'utf8')));
  const seedPlan: Array<{ days: number; field: 'trend' | 'avg30' | 'avg7' | 'avg1' }> = [
    { days: 29, field: 'avg30' },
    { days: 7,  field: 'avg7'  },
    { days: 1,  field: 'avg1'  },
    { days: 0,  field: 'trend' },
  ];
  const statements: string[] = [];
  for (const record of Object.values(file.records)) {
    const cm = record.sources.cardmarket;
    if (!cm) continue;
    for (const { days, field } of seedPlan) {
      const trend = cm[field];
      if (trend === null) continue;
      statements.push(
        `INSERT OR REPLACE INTO snapshots (cardId, date, trend, low, avg30, avg7, avg1) VALUES ('${escapeSqlString(record.cardId)}', '${isoDateDaysAgo(days)}', ${sqlValue(trend)}, ${sqlValue(cm.low)}, ${sqlValue(cm.avg30)}, ${sqlValue(cm.avg7)}, ${sqlValue(cm.avg1)});`,
      );
    }
  }
  console.log(`Prepared ${statements.length} bootstrap INSERT statements (~4 per card)`);

  const tmp = mkdtempSync(join(tmpdir(), 'd1-bootstrap-'));
  let pushed = 0;
  let failures = 0;
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const batch = statements.slice(i, i + BATCH_SIZE).join('\n');
    const batchFile = join(tmp, `batch-${i}.sql`);
    writeFileSync(batchFile, batch);
    try {
      execSync(
        `npx wrangler d1 execute pokemon-tcg-history --remote --file=${batchFile}`,
        { cwd: WORKER_DIR, stdio: 'pipe' },
      );
      pushed += statements.slice(i, i + BATCH_SIZE).length;
    } catch (err) {
      failures++;
      console.warn(`Batch ${i / BATCH_SIZE} failed: ${(err as Error).message.slice(0, 200)}`);
    }
  }
  console.log(`Bootstrapped ${pushed}/${statements.length} rows, ${failures} batch failures`);
}

main().catch((err) => {
  console.error('bootstrap-d1-history failed:', err);
  process.exit(1);
});
