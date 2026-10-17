import type { Migration } from '@quant-fusion/sqlite-migrations';
import { migration0001Init } from './0001_init.js';
import { migration0002AddEndedStatus } from './0002_add_ended_status.js';
import { migration0003AddPins } from './0003_add_pins.js';
import { migration0004RoundAudit } from './0004_round_audit.js';

/** Every migration this package's tables apply, in the order new ones get appended —
 * `applyMigrations` itself re-sorts by `id`, so this array's order is for readability only. */
export const forwardMatchStoreMigrations: Migration[] = [
  migration0001Init,
  migration0002AddEndedStatus,
  migration0003AddPins,
  migration0004RoundAudit,
];
