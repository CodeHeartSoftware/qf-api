#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { startDailyCycleScheduler } from './lib/dailyCycleScheduler.js';

const PORT = Number(process.env.PORT ?? 4410);
// Resolved from this file's own location, NOT `process.cwd()` — `yarn workspace
// @quant-fusion/api start` (and `dev`) changes the working directory to this
// package before running the script, which would otherwise silently point every route at the
// wrong "monorepo root" (this package's own directory) instead of the real one. This file always
// lives at `apps/api/{src,dist}/index.{ts,js}`, three directories below the repo
// root, regardless of invocation cwd — true for `tsx watch`, the compiled `node dist/index.js`,
// and the Docker image (WORKDIR /app) alike.
const rootDir =
  process.env.QUANT_FUSION_ROOT_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const app = createApp(rootDir);
startDailyCycleScheduler(rootDir);
app.listen(PORT, () => {
  console.log(`quant-fusion-api listening on http://localhost:${String(PORT)} (root: ${rootDir})`);
});
