import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface PerfResultRow {
  calls: number;
  mean_ms: string;
  query: string;
  total_ms: string;
}

const RESULTS_DIR = join(__dirname, '..', 'results', 'db-profiling');

/**
 * Saves pg_stat_statements rows to a timestamped JSON file under
 * `test/performance/results/db-profiling/`.  Call after every `console.table` so that
 * results accumulate across runs and can be diff-ed before/after each
 * optimisation.
 *
 * File name: `<ISO-timestamp>-<sanitized-label>.json`
 */
export function savePerfResults(label: string, rows: PerfResultRow[]): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = label.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const file = join(RESULTS_DIR, `${timestamp}-${safeName}.json`);
  writeFileSync(file, JSON.stringify({ label, rows, timestamp }, null, 2), 'utf-8');
  console.log(`[Perf] Results saved → ${file}`);
}
