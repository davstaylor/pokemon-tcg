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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlValue(v: number | null): string {
  return v === null ? 'NULL' : String(v);
}

async function main() {
  const file = PriceFileSchema.parse(JSON.parse(readFileSync(BASELINE_FILE, 'utf8')));
  const date = today();
  const statements: string[] = [];
  for (const record of Object.values(file.records)) {
    const cm = record.sources.cardmarket;
    if (!cm) continue;
    statements.push(
      `INSERT OR REPLACE INTO snapshots (cardId, date, trend, low, avg30, avg7, avg1) VALUES ('${escapeSqlString(record.cardId)}', '${date}', ${sqlValue(cm.trend)}, ${sqlValue(cm.low)}, ${sqlValue(cm.avg30)}, ${sqlValue(cm.avg7)}, ${sqlValue(cm.avg1)});`,
    );
  }
  console.log(`Prepared ${statements.length} INSERT statements for date ${date}`);

  const tmp = mkdtempSync(join(tmpdir(), 'd1-push-'));
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
  console.log(`Pushed ${pushed}/${statements.length} rows, ${failures} batch failures`);
  if (failures > 0 && pushed === 0) {
    throw new Error('All batches failed — D1 push aborted');
  }
}

main().catch((err) => {
  console.error('push-history-to-d1 failed:', err);
  process.exit(1);
});
