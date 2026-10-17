import type { Migration } from '@quant-fusion/sqlite-migrations';
import { migration0001Init } from './0001_init.js';

export const jobRunStoreMigrations: Migration[] = [migration0001Init];
