import {
  createResearchSnapshot,
  type ResearchDataset,
  type ResearchSnapshot,
} from '@quant-fusion/research-core';

/** One entry a real `stock-market-4` match's `config.researchTimeline` expects — kept local
 * (not imported from `@quant-fusion/game-stock-market-4`) for the same boundary reason
 * `bots/**`'s own research types are hand-copied: this package doesn't depend on any game. */
export interface ForwardMatchResearchEntry {
  date: string;
  payload: ResearchSnapshot;
}

/** Every ISO `YYYY-MM-DDTHH:MM:SSZ` timestamp appearing anywhere in `dataset`, as calendar days
 * (deduplicated, ascending) — a superset of every date `computeResearchStateAt` (see
 * `@quant-fusion/research-core`'s `state/provider.ts`) could possibly treat as "new state became
 * knowable." A generic full-object scan rather than one accessor per record type (entities'
 * `recordedAt`, evidence's `observedAt`, relationships' `states[].recordedAt`, etc. — see that
 * file's own table) so this never silently misses a field the schema adds later; the only risk
 * is a rare false-positive date embedded in free-text prose, which costs one harmless extra
 * (identical-to-neighbor) snapshot entry, never a wrong one. */
function distinctDatasetDates(dataset: ResearchDataset): string[] {
  const timestampPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g;
  const matches = JSON.stringify(dataset).match(timestampPattern) ?? [];
  const days = new Set(matches.map((timestamp) => timestamp.slice(0, 'YYYY-MM-DD'.length)));
  return [...days].sort();
}

/**
 * Builds a full `researchTimeline` for a real forward match from `dataset` — one entry per
 * distinct day anything in the dataset became knowable, each a complete cumulative snapshot as
 * of that day (`createResearchSnapshot`, the exact function `runBacktest.ts` already uses per
 * simulated day). Satisfies `ResearchTimelineSchema`'s "strictly increasing, no duplicate
 * dates" requirement by construction (one entry per distinct day, sorted).
 *
 * Every entry, including ones dated before `asOfDate`, is included — an entry earlier than a
 * match's own `startDate` is harmless (the game's "most recent entry at or before this
 * observation's date" lookup collapses them; see `games/stock-market-4/src/types.ts`), and
 * keeping them means the very first observation already carries the dataset's full background
 * knowledge rather than nothing at all.
 */
export function buildResearchTimeline(
  dataset: ResearchDataset,
  asOfDate: string,
): ForwardMatchResearchEntry[] {
  return distinctDatasetDates(dataset)
    .filter((date) => date <= asOfDate)
    .map((date) => ({
      date,
      payload: createResearchSnapshot(dataset, `${date}T23:59:59Z`),
    }));
}
