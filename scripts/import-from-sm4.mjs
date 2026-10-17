#!/usr/bin/env node
// One-time import of a frozen Stock Market 4 installation's local state into this repo's
// `.quant-fusion/` directory — run once at the SM4 -> Quant Fusion cutover, never again.
//
//   node scripts/import-from-sm4.mjs [--from ../thunderdome]
//
// Price data and research are NOT imported: they're entirely migration-driven, and this repo
// already carries every one of those migrations. What's imported is the runtime state migrations
// never held:
//   - db.sqlite        the forward simulations (forward_matches) and everything else in the file;
//                      on first open Quant Fusion applies only the migrations SM4 hadn't run yet
//   - job-runs.sqlite  Jobs tab history
//   - settings.json    daily-cycle schedule (left as SM4 had it — re-enable in Settings)
//   - custom-universes.json
// Not imported: live.sqlite / live/ / live-jobs/ (Live tab state — empty at cutover).
//
// Each forward simulation's config embeds an ABSOLUTE path to SM4's db.sqlite; it's rewritten to
// this repo's, or the imported simulations would silently keep reading SM4's data. Pins are left
// untouched: the rebranded models' source differs from what was pinned, so each simulation
// reports drift and refuses to run until it's deliberately re-pinned.
//
// Refuses to run if .quant-fusion/db.sqlite already exists, so it can never overwrite live data.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

const repoRoot = path.resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: { from: { type: 'string', default: '../thunderdome' } } });
const fromRoot = path.resolve(repoRoot, values.from);
const srcDir = path.join(fromRoot, '.thunderdome', 'stock-market-4');
const destDir = path.join(repoRoot, '.quant-fusion');

function fail(message) {
  console.error(`import-from-sm4: ${message}`);
  process.exit(1);
}
const sha1 = (file) => createHash('sha1').update(readFileSync(file)).digest('hex');

if (!existsSync(path.join(srcDir, 'db.sqlite'))) fail(`no SM4 database at ${srcDir}/db.sqlite`);
if (existsSync(path.join(destDir, 'db.sqlite')))
  fail(`${destDir}/db.sqlite already exists — this is a one-time import and never overwrites.`);
for (const suffix of ['-wal', '-shm', '-journal']) {
  if (existsSync(path.join(srcDir, `db.sqlite${suffix}`)))
    fail(`db.sqlite${suffix} exists — SM4 looks like it's still running; stop it first.`);
}

mkdirSync(destDir, { recursive: true });
const copied = [];
for (const name of ['db.sqlite', 'job-runs.sqlite', 'settings.json', 'custom-universes.json']) {
  const from = path.join(srcDir, name);
  if (!existsSync(from)) continue;
  copyFileSync(from, path.join(destDir, name));
  copied.push(`${name} (sha1 ${sha1(from).slice(0, 8)})`);
}
console.log(`Copied from ${srcDir}:\n  ${copied.join('\n  ')}`);

// Rewrite every embedded SM4 data-dir reference (absolute, then repo-relative) in the simulations.
const destDb = path.join(destDir, 'db.sqlite');
const db = new DatabaseSync(destDb);
const rewrites = [
  [`${srcDir}/`, `${destDir}/`],
  ['./.thunderdome/stock-market-4/', './.quant-fusion/'],
  ['.thunderdome/stock-market-4/', '.quant-fusion/'],
];
const rows = db.prepare('SELECT match_id, config, snapshot, pins FROM forward_matches').all();
const update = db.prepare('UPDATE forward_matches SET config = ? WHERE match_id = ?');
for (const row of rows) {
  let config = row.config;
  for (const [from, to] of rewrites) config = config.split(from).join(to);
  update.run(config, row.match_id);
  for (const [column, text] of [
    ['config', config],
    ['snapshot', row.snapshot],
    ['pins', row.pins ?? ''],
  ]) {
    if (text.includes('thunderdome'))
      fail(`${row.match_id}.${column} still references thunderdome after rewrite`);
  }
}
const summary = db
  .prepare('SELECT match_id, status, rounds_played FROM forward_matches ORDER BY match_id')
  .all();
db.close();
console.log(`Rewrote data-dir paths in ${String(rows.length)} simulation config(s):`);
for (const s of summary)
  console.log(`  ${s.match_id}  ${s.status}  ${String(s.rounds_played)} trading days`);
console.log(
  '\nDone. Simulations are pinned to the pre-rebrand model source and will refuse to run until\n' +
    're-pinned (Run Daily Cycle -> Re-pin & run, or `yarn qf match forward run <id> --repin`).',
);
