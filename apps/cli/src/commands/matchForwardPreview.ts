// `quant-fusion match forward preview` — a read-only "what would the bot do right now, compared to
// what it would have done at the config this match was created/last configured with" check for a
// FORWARD_SHADOW match. Never mutates or persists anything: no `ForwardMatchRecord` write, no
// round resolved. See docs/adr/0013-forward-match-persistence.md for the forward-match lifecycle
// this reads from, and this file's own module doc comment below for why the comparison is framed
// as "stored config" vs. "a freshly supplied one," not "this morning" vs. "this instant."
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadForwardMatchRecord } from '@quant-fusion/forward-match-store';
import { generateTournamentSeed } from '@quant-fusion/rng';
import { DockerActionCollector } from '@quant-fusion/runtime';
import {
  buildBotImages,
  loadGame,
  resolveBotsAndGame,
  startBotLifecycles,
  untrackLifecycles,
} from '../lib/match-execution.js';

// Despite the name (kept for call-site/flag-name compatibility — `--store-dir`), this now
// resolves to the ONE shared Stock Market 4 SQLite file, not a directory of per-match JSON files
// — see docs/adr/0014-sqlite-standard-and-migrations.md.
function defaultForwardMatchStoreDir(rootDir: string): string {
  return path.join(rootDir, '.quant-fusion', 'db.sqlite');
}

interface ForwardResumableGameModule {
  resumeForwardState: (args: {
    config: unknown;
    participantIds: readonly string[];
    snapshot: unknown;
    allowProvisional?: boolean;
  }) => unknown;
}

function isForwardResumableGameModule(value: unknown): value is ForwardResumableGameModule {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>).resumeForwardState === 'function';
}

/** Duck-types `{side: string, quantity: number}` out of an otherwise-opaque order object (see
 * `ordersByTicker` below) into a short, human-readable label — "BUY 2,271" — instead of the raw
 * `{"kind":"MARKET","ticker":"OPTX","side":"BUY","quantity":2271}` a person would otherwise have
 * to parse by eye. Falls back to a compact JSON dump for an order shape this doesn't recognize,
 * staying game-agnostic the same way `ordersByTicker` does — never throws on an unexpected shape. */
function describeOrder(order: unknown): string {
  if (typeof order !== 'object' || order === null) return 'HOLD';
  const o = order as Record<string, unknown>;
  if (typeof o.side === 'string' && typeof o.quantity === 'number') {
    return `${o.side} ${o.quantity.toLocaleString('en-US')}`;
  }
  return JSON.stringify(order);
}

/** Duck-types `{orders: {ticker: string, ...}[]}` out of an otherwise-opaque game action —
 * `AnyGameDefinition` erases the action type, and this command stays game-agnostic the same way
 * `matchForward.ts` duck-types `ForwardResumableGameModule` rather than importing SM4 types. A
 * game whose action doesn't look like this just gets an empty diff, not a crash. */
function ordersByTicker(action: unknown): Map<string, unknown> {
  const byTicker = new Map<string, unknown>();
  if (typeof action !== 'object' || action === null) return byTicker;
  const orders = (action as Record<string, unknown>).orders;
  if (!Array.isArray(orders)) return byTicker;
  for (const order of orders) {
    if (
      typeof order === 'object' &&
      order !== null &&
      typeof (order as Record<string, unknown>).ticker === 'string'
    ) {
      byTicker.set((order as Record<string, unknown>).ticker as string, order);
    }
  }
  return byTicker;
}

/** See `matchForward.ts`'s constant of the same name. */
const STDERR_DRAIN_MS = 1_500;

const USAGE =
  'Usage: quant-fusion match forward preview <matchId> --config-file <path> ' +
  '[--participant <botId>[,<botId>...]] [--store-dir <path>]';

export interface MatchForwardPreviewOptions {
  rootDir: string;
}

/**
 * Compares the trading decision a match's bot(s) would make against two hypothetical configs for
 * the SAME already-persisted state (same portfolio/round/fills — this never resumes for real):
 * the match's own STORED config (frozen since it was created — a stand-in for "what was known at
 * market open," since nothing in this system updates an existing match's config after creation)
 * against a freshly supplied `--config-file` (e.g. re-run `emit:forward-config` against the
 * live research fixture right now — a stand-in for "what's knowable this instant," since new
 * research can be recorded between a match's creation and any later moment even though prices
 * themselves only ever update once a day). Both configs must describe the SAME
 * `marketDataUniverse`/`marketDataset`/`startDate` — this only ever varies `researchTimeline` (or
 * any other config field), never mutates the match record. Every bot container started here is
 * torn down before returning; nothing about the match itself changes.
 */
export async function runMatchForwardPreviewCommand(
  argv: readonly string[],
  options: MatchForwardPreviewOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: {
      'config-file': { type: 'string' },
      'store-dir': { type: 'string' },
      participant: { type: 'string' },
    },
    allowPositionals: true,
  });
  const [matchId] = positionals;
  if (matchId === undefined || values['config-file'] === undefined) {
    console.error(USAGE);
    return 1;
  }
  const storeDir = values['store-dir'] ?? defaultForwardMatchStoreDir(options.rootDir);
  // Restricts the preview loop below to a subset of the match's own roster — e.g. the Fleet tab's
  // per-bot preview button, which only ever cares about the one bot whose card it's on, not every
  // other participant in that bot's match.
  const participantFilter =
    values.participant === undefined
      ? undefined
      : new Set(
          values.participant
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0),
        );

  const loadOutcome = await loadForwardMatchRecord(storeDir, matchId);
  if (loadOutcome.status !== 'found') {
    console.error(
      loadOutcome.status === 'corrupt'
        ? loadOutcome.reason
        : `No forward match record found for "${matchId}".`,
    );
    return 1;
  }
  const { record } = loadOutcome;

  const previewParticipantIds =
    participantFilter === undefined
      ? record.participantIds
      : record.participantIds.filter((id) => participantFilter.has(id));
  if (previewParticipantIds.length === 0) {
    console.error(
      `--participant matched none of "${matchId}"'s own roster (${record.participantIds.join(', ')}).`,
    );
    return 1;
  }

  let freshConfigString: string;
  try {
    freshConfigString = await readFile(values['config-file'], 'utf8');
  } catch (error) {
    console.error(
      `Could not read --config-file "${values['config-file']}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  let freshConfigRaw: unknown;
  try {
    freshConfigRaw = JSON.parse(freshConfigString);
  } catch (error) {
    console.error(
      `--config-file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  const resolved = await resolveBotsAndGame(options.rootDir, previewParticipantIds);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const { entries, gameEntry } = resolved;
  const game = await loadGame(gameEntry);
  const gameModule: unknown = await import(gameEntry.manifest.entryPackage);
  if (!isForwardResumableGameModule(gameModule)) {
    console.error(`"${gameEntry.manifest.entryPackage}" does not export resumeForwardState.`);
    return 1;
  }

  const storedConfigResult = game.parseConfig(record.config);
  if (!storedConfigResult.ok) {
    console.error(
      `Match "${matchId}"'s own stored config is no longer valid: ${storedConfigResult.reason}`,
    );
    return 1;
  }
  const freshConfigResult = game.parseConfig(freshConfigRaw);
  if (!freshConfigResult.ok) {
    console.error(`Invalid --config-file: ${freshConfigResult.reason}`);
    return 1;
  }

  // `allowProvisional: true` on BOTH — a preview's whole point is "what does the market look like
  // right now," which should be the SAME live market snapshot regardless of which config
  // hypothetical is being asked about; only `config` differs between the two calls. This is the
  // ONLY caller in this codebase that ever sets it — `match forward run` (`matchForward.ts`) never
  // does, which is what keeps a real, persisted round from ever completing on unfinalized data
  // (see `resumeForwardState`'s own doc comment).
  const stateOpen = gameModule.resumeForwardState({
    config: storedConfigResult.value,
    participantIds: record.participantIds,
    snapshot: record.snapshot,
    allowProvisional: true,
  });
  const stateNow = gameModule.resumeForwardState({
    config: freshConfigResult.value,
    participantIds: record.participantIds,
    snapshot: record.snapshot,
    allowProvisional: true,
  });

  console.log(`Building ${String(entries.length)} bot image(s)...`);
  const imageTagsByBotId = await buildBotImages(entries);

  for (const participantId of previewParticipantIds) {
    const observationOpen = game.getObservation(stateOpen, participantId);
    const observationNow = game.getObservation(stateNow, participantId);
    const observedDate = (observationNow as { date?: string | null } | null)?.date ?? null;
    if (observedDate === null) {
      // Distinct from "no orders under either scenario" below — that means the bot looked at a
      // real round and chose to do nothing; this means there's no NEW round to decide at all yet
      // (this match has already played every day its dataset currently knows about), so the two
      // hypotheticals trivially agree with nothing to compare.
      console.log(
        `\n${participantId}: no round to preview yet — this match has already played every ` +
          `trading day its dataset currently knows about.`,
      );
      continue;
    }
    // The only date this preview could EVER see that a real resume couldn't is today's — every
    // earlier date is always final by construction (see `resumeForwardState`'s own doc comment on
    // `allowProvisional`) — so this is a simple, sufficient signal without reaching into the
    // duck-typed state for which specific ticker's bar is provisional.
    if (observedDate === new Date().toISOString().slice(0, 10)) {
      console.log(
        `\n${participantId}: previewing ${observedDate} — today's trading day may still be in ` +
          "progress; some tickers' prices could be live/provisional, not the day's final close. " +
          'This round can never be run for real until the trading day has ended.',
      );
    }

    // One freshly-started container per hypothetical, never reused between the two calls: a bot
    // may keep its own in-process hysteresis/previous-state between decisions (e.g.
    // fusion-fundamental-v6's `previousByTicker` — see its own doc comment), which would leak the
    // "at open" call's output into the "now" call's baseline if the same running container
    // answered both. Matches how a real resumed `match forward run` invocation already starts a
    // brand-new container per invocation, with no memory of an earlier invocation's decisions.
    const openLifecycles = await startBotLifecycles({
      game,
      gameEntry,
      config: storedConfigResult.value,
      matchId: `${matchId}-preview-open`,
      participantIds: [participantId],
      imageTagsByBotId,
      tournamentSeed: generateTournamentSeed(),
    });
    let openAction: unknown;
    try {
      const outcome = await new DockerActionCollector(openLifecycles).requestAction({
        participantId,
        roundId: (stateOpen as { round: number }).round,
        observation: observationOpen,
        deadlineMs: 5_000,
        required: true,
      });
      openAction = outcome.ok ? outcome.action : undefined;
      // Let the bot's relayed stderr (its rationale lines) arrive before teardown drops it.
      await new Promise((resolve) => setTimeout(resolve, STDERR_DRAIN_MS));
    } finally {
      await Promise.all(
        [...openLifecycles.values()].map((lifecycle) =>
          lifecycle.finish({ result: null, reason: 'aborted' }),
        ),
      );
      untrackLifecycles(openLifecycles);
    }

    const nowLifecycles = await startBotLifecycles({
      game,
      gameEntry,
      config: freshConfigResult.value,
      matchId: `${matchId}-preview-now`,
      participantIds: [participantId],
      imageTagsByBotId,
      tournamentSeed: generateTournamentSeed(),
    });
    let nowAction: unknown;
    try {
      const outcome = await new DockerActionCollector(nowLifecycles).requestAction({
        participantId,
        roundId: (stateNow as { round: number }).round,
        observation: observationNow,
        deadlineMs: 5_000,
        required: true,
      });
      nowAction = outcome.ok ? outcome.action : undefined;
      // Let the bot's relayed stderr (its rationale lines) arrive before teardown drops it.
      await new Promise((resolve) => setTimeout(resolve, STDERR_DRAIN_MS));
    } finally {
      await Promise.all(
        [...nowLifecycles.values()].map((lifecycle) =>
          lifecycle.finish({ result: null, reason: 'aborted' }),
        ),
      );
      untrackLifecycles(nowLifecycles);
    }

    const openOrders = ordersByTicker(openAction);
    const nowOrders = ordersByTicker(nowAction);
    const tickers = new Set([...openOrders.keys(), ...nowOrders.keys()]);

    console.log(`\n${participantId}:`);
    if (tickers.size === 0) {
      console.log('  No trades — held every position.');
      continue;
    }
    for (const ticker of tickers) {
      const openOrder = openOrders.get(ticker);
      const nowOrder = nowOrders.get(ticker);
      const changed = JSON.stringify(openOrder) !== JSON.stringify(nowOrder);
      // The common case (this match's own stored config never changed since it was created): show
      // the one real decision once, not the same thing twice under two different labels. Only a
      // GENUINE difference (new research changed the call between "at open" and "right now") gets
      // the fuller before/after line.
      if (!changed) {
        console.log(`  ${ticker}: ${describeOrder(nowOrder)}`);
      } else {
        console.log(
          `  ${ticker}: ${describeOrder(nowOrder)}  [CHANGED from ${describeOrder(openOrder)} at stored config]`,
        );
      }
      // Machine-readable, one line per (participant, ticker) — lets the UI render a clean moves
      // list without re-parsing `describeOrder`'s own human-facing text. `quantity` is omitted
      // (not just `undefined`) for an order shape `describeOrder` didn't recognize, rather than
      // asserting a number that isn't really there.
      const nowRecord =
        typeof nowOrder === 'object' && nowOrder !== null
          ? (nowOrder as Record<string, unknown>)
          : {};
      const quantity = typeof nowRecord.quantity === 'number' ? nowRecord.quantity : undefined;
      const side = typeof nowRecord.side === 'string' ? nowRecord.side : 'HOLD';
      console.log(
        `PREVIEW_MOVE_JSON:${JSON.stringify({
          participantId,
          ticker,
          side,
          ...(quantity !== undefined ? { quantity } : {}),
          changed,
        })}`,
      );
    }
  }

  return 0;
}
