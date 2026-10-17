// `quant-fusion match forward run|list|inspect` — roadmap Phase 3's persistent, resumable forward
// match lifecycle (see docs/adr/0013-forward-match-persistence.md). Mirrors `tournament
// run/list/inspect`'s one-level dispatch pattern (index.ts), one level deeper (`match forward
// run` vs. `tournament run`). Explicitly SM4-specific for now via duck-typing (see
// `loadForwardResumableModule` below), not a generic `GameDefinition` capability — only one game
// needs this today; see the ADR's own consequences section for why that's deliberate.
import { parseArgs } from 'node:util';
import { computeBotSourceSha256, configSha256, dockerImageId } from '../lib/botSourcePin.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  attachRoundRationale,
  listForwardMatchRecords,
  loadForwardMatchRecord,
  recordRoundAudit,
  saveForwardMatchRecord,
  type ForwardMatchRecord,
  type RoundAuditEntry,
} from '@quant-fusion/forward-match-store';
import { runAvailableRounds } from '@quant-fusion/engine';
import {
  createRng,
  deriveSeed,
  generateTournamentSeed,
  seedFromHex,
  seedToHex,
} from '@quant-fusion/rng';
import { DockerActionCollector, botImageTag } from '@quant-fusion/runtime';
import type { GameRegistryEntry } from '@quant-fusion/registry';
import {
  buildBotImages,
  loadGame,
  resolveBotsAndGame,
  startBotLifecycles,
  untrackLifecycles,
} from '../lib/match-execution.js';
import {
  AuditingActionCollector,
  equityCentsFor,
  RationaleCollector,
  roundDateAndFills,
} from '../lib/roundAudit.js';
import { printForwardStandings, printRoundEvents } from './match.js';

/** How long to let bots' relayed stderr drain before tearing their containers down — Docker can
 * deliver a bot's action before the stderr it wrote first, and teardown drops whatever is still
 * in flight (the last round's rationale lines). */
const STDERR_DRAIN_MS = 1_500;

// Despite the name (kept for call-site/flag-name compatibility — `--store-dir`), this now
// resolves to the ONE shared Stock Market 4 SQLite file, not a directory of per-match JSON files
// — see docs/adr/0014-sqlite-standard-and-migrations.md. `@quant-fusion/forward-match-store`
// creates this file (and its parent directory) on first use if it doesn't exist yet.
function defaultForwardMatchStoreDir(rootDir: string): string {
  return path.join(rootDir, '.quant-fusion', 'db.sqlite');
}

/**
 * The three functions a game must export (alongside its usual `game`) to be usable with `match
 * forward run` — `games/stock-market-4/src/game.ts`'s `serializeForwardState`/
 * `resumeForwardState`/`isForwardMatchFullyResolved`. Duck-typed the same way `loadGame`
 * (`lib/match-execution.ts`) duck-types a `GameDefinition` itself, rather than a new engine-level
 * interface — see this file's own module comment for why.
 */
interface ForwardResumableGameModule {
  serializeForwardState: (state: unknown) => unknown;
  resumeForwardState: (args: {
    config: unknown;
    participantIds: readonly string[];
    snapshot: unknown;
  }) => unknown;
  isForwardMatchFullyResolved: (state: unknown) => boolean;
  /** Optional: a game that also exports this (stock-market-4's `getCurrentStandings`) gets a
   * standings/portfolio/"what each bot did today" summary printed after `run` processes whatever
   * new rounds were available — see `printForwardStandings` (`./match.js`). Absent for any other
   * forward-resumable game, which just skips the summary rather than failing. */
  getCurrentStandings?: (state: unknown) => unknown;
}

function isForwardResumableGameModule(value: unknown): value is ForwardResumableGameModule {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.serializeForwardState === 'function' &&
    typeof candidate.resumeForwardState === 'function' &&
    typeof candidate.isForwardMatchFullyResolved === 'function'
  );
}

async function loadForwardResumableModule(
  entry: GameRegistryEntry,
): Promise<ForwardResumableGameModule> {
  const loaded: unknown = await import(entry.manifest.entryPackage);
  if (!isForwardResumableGameModule(loaded)) {
    throw new Error(
      `"${entry.manifest.entryPackage}" does not export serializeForwardState/resumeForwardState/` +
        `isForwardMatchFullyResolved — match forward run requires a FORWARD_SHADOW-capable game ` +
        `(see games/stock-market-4/src/game.ts for the convention).`,
    );
  }
  return loaded;
}

/** Same whole-invocation wall-clock safety net as `runSingleMatch`'s own `MATCH_DEADLINE_MS`
 * (docs/adr/0003-docker-bot-isolation.md) — bounds how long ONE `match forward run` invocation
 * can run, not the forward match's own lifetime (which may span weeks via repeated invocations). */
const MATCH_DEADLINE_MS = 120_000;

export interface MatchForwardRunOptions {
  rootDir: string;
}

const RUN_USAGE =
  'Usage: quant-fusion match forward run <matchId> <botId> [<botId>...] ' +
  '[--config \'{"gameType":"FORWARD_SHADOW",...}\' | --config-file <path>] [--store-dir <path>] ' +
  '[--no-pin] [--repin]';

export async function runMatchForwardRunCommand(
  argv: readonly string[],
  options: MatchForwardRunOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: {
      config: { type: 'string' },
      'config-file': { type: 'string' },
      'store-dir': { type: 'string' },
      'no-pin': { type: 'boolean' },
      repin: { type: 'boolean' },
    },
    allowPositionals: true,
  });

  const [matchId, ...botIds] = positionals;
  if (matchId === undefined || botIds.length < 1) {
    console.error(RUN_USAGE);
    return 1;
  }
  if (values.config !== undefined && values['config-file'] !== undefined) {
    console.error(`--config and --config-file are mutually exclusive.\n${RUN_USAGE}`);
    return 1;
  }
  // A researchTimeline-bearing config (see @quant-fusion/research-fusion's `buildResearchTimeline`)
  // can run to megabytes — comfortably past a shell's argv length limit for inline `--config`, so
  // `--config-file` exists specifically to carry a config that large.
  let configString: string | undefined = values.config;
  if (values['config-file'] !== undefined) {
    try {
      configString = await readFile(values['config-file'], 'utf8');
    } catch (error) {
      console.error(
        `Could not read --config-file "${values['config-file']}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
  }
  const storeDir = values['store-dir'] ?? defaultForwardMatchStoreDir(options.rootDir);

  const loadOutcome = await loadForwardMatchRecord(storeDir, matchId);
  if (loadOutcome.status === 'corrupt') {
    // Never silently treated as "not found" — that would quietly create a brand-new match under
    // this same id, discarding whatever trading history the corrupted file held.
    console.error(loadOutcome.reason);
    return 1;
  }

  const resolved = await resolveBotsAndGame(options.rootDir, botIds);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const { entries, gameEntry } = resolved;
  // Each bot's build-input hash (see `botSourcePin.ts`) — what a pinned match is frozen to.
  const sourceSha256ByBotId = new Map<string, string>();
  for (const entry of entries) {
    sourceSha256ByBotId.set(
      entry.manifest.id,
      await computeBotSourceSha256(entry.dir, entry.manifest.build.context),
    );
  }
  const game = await loadGame(gameEntry);
  let forwardModule;
  try {
    forwardModule = await loadForwardResumableModule(gameEntry);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  let record: ForwardMatchRecord;
  let state: unknown;

  if (loadOutcome.status === 'not-found') {
    if (configString === undefined) {
      console.error(
        `No existing forward match "${matchId}" — provide --config or --config-file to create one.\n${RUN_USAGE}`,
      );
      return 1;
    }
    let configRaw: unknown;
    try {
      configRaw = JSON.parse(configString);
    } catch (error) {
      console.error(
        `--config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
    const configResult = game.parseConfig(configRaw);
    if (!configResult.ok) {
      console.error(`Invalid --config for game "${gameEntry.manifest.id}": ${configResult.reason}`);
      return 1;
    }
    const config = configResult.value;
    const gameType = (config as Record<string, unknown>).gameType;
    if (gameType !== 'FORWARD_SHADOW') {
      console.error(
        `match forward run requires config.gameType === "FORWARD_SHADOW" (got ${String(gameType)}).`,
      );
      return 1;
    }

    const matchSeed = generateTournamentSeed();
    const initState = game.initialize({
      config,
      participantIds: botIds,
      rng: createRng(deriveSeed(matchSeed, 'match', matchId)),
    });
    const nowIso = new Date().toISOString();
    record = {
      matchId,
      gameId: gameEntry.manifest.id,
      gameVersion: gameEntry.manifest.version,
      config,
      participantIds: botIds,
      matchSeed: seedToHex(matchSeed),
      createdAt: nowIso,
      updatedAt: nowIso,
      status: 'active',
      roundsPlayed: 0,
      snapshot: forwardModule.serializeForwardState(initState),
      ...(values['no-pin'] === true
        ? {}
        : {
            pins: {
              pinnedAt: nowIso,
              configSha256: configSha256(config),
              bots: Object.fromEntries(
                [...sourceSha256ByBotId].map(([botId, sourceSha256]) => [botId, { sourceSha256 }]),
              ),
            },
          }),
    };
    const saved = await saveForwardMatchRecord(storeDir, record);
    if (!saved.ok) {
      console.error(saved.reason);
      return 1;
    }
    state = initState;
    console.log(`Created forward match "${matchId}" (${gameEntry.manifest.name}).`);
  } else {
    record = loadOutcome.record;
    if (record.gameId !== gameEntry.manifest.id) {
      console.error(
        `Forward match "${matchId}" was created for game "${record.gameId}", not "${gameEntry.manifest.id}".`,
      );
      return 1;
    }
    if (configString !== undefined) {
      console.error(
        `warning: ignoring --config/--config-file — resuming "${matchId}" uses its own stored config.`,
      );
    }
    if (record.status !== 'active') {
      console.log(
        `Forward match "${matchId}" is already ${record.status} — nothing to do. ` +
          `Run "quant-fusion match forward inspect ${matchId}" to see its final state.`,
      );
      return 0;
    }
    // Pinned matches refuse to resume on changed bot code — e.g. the quant-v0 paper-trading gate's
    // G5 run requires the code to stay frozen. `--repin` accepts the new code explicitly.
    if (record.pins !== undefined) {
      const changed = record.participantIds.filter(
        (botId) =>
          record.pins?.bots[botId] !== undefined &&
          record.pins.bots[botId].sourceSha256 !== sourceSha256ByBotId.get(botId),
      );
      if (changed.length > 0 && values.repin !== true) {
        console.error(
          `Forward match "${matchId}" is pinned, and the code of ${changed.join(', ')} has changed ` +
            `since it was pinned (${record.pins.pinnedAt}). Restore that code, or pass --repin to ` +
            `accept the new code (this ends the match's frozen-code guarantee).`,
        );
        return 1;
      }
      if (changed.length > 0) {
        console.error(`warning: --repin — re-pinning ${changed.join(', ')} to their current code.`);
        record = {
          ...record,
          pins: {
            ...record.pins,
            pinnedAt: new Date().toISOString(),
            bots: {
              ...record.pins.bots,
              ...Object.fromEntries(
                changed.map((botId) => [
                  botId,
                  { sourceSha256: sourceSha256ByBotId.get(botId) ?? '' },
                ]),
              ),
            },
          },
        };
      }
    }
    const configResult = game.parseConfig(record.config);
    if (!configResult.ok) {
      console.error(
        `Cannot resume "${matchId}": stored config is no longer valid: ${configResult.reason}`,
      );
      return 1;
    }
    state = forwardModule.resumeForwardState({
      config: configResult.value,
      participantIds: record.participantIds,
      snapshot: record.snapshot,
    });
    console.log(
      `Resuming forward match "${matchId}" (${String(record.roundsPlayed)} round(s) played so far).`,
    );
  }

  // A pinned bot whose source still matches its pin AND whose local image is still the exact one
  // recorded at pin time needs no rebuild — the image IS the pinned code. Anything else (unpinned,
  // drifted, re-pinned, or the tag rebuilt/pruned since) still goes through a normal build.
  const reusableTagsByBotId = new Map<string, string>();
  for (const entry of entries) {
    const botId = entry.manifest.id;
    const pin = record.pins?.bots[botId];
    if (pin?.imageId === undefined || pin.sourceSha256 !== sourceSha256ByBotId.get(botId)) continue;
    const tag = botImageTag(botId);
    if ((await dockerImageId(tag)) === pin.imageId) reusableTagsByBotId.set(botId, tag);
  }
  const entriesToBuild = entries.filter((entry) => !reusableTagsByBotId.has(entry.manifest.id));
  if (reusableTagsByBotId.size > 0) {
    console.log(
      `Reusing pinned image(s) for ${[...reusableTagsByBotId.keys()].join(', ')} (code unchanged).`,
    );
  }
  if (entriesToBuild.length > 0) {
    console.log(`Building ${String(entriesToBuild.length)} bot image(s)...`);
  }
  const imageTagsByBotId = new Map([
    ...reusableTagsByBotId,
    ...(await buildBotImages(entriesToBuild)),
  ]);
  if (record.pins !== undefined) {
    const bots = { ...record.pins.bots };
    for (const [botId, pin] of Object.entries(bots)) {
      if (pin.imageId !== undefined) continue;
      const tag = imageTagsByBotId.get(botId);
      const imageId = tag === undefined ? undefined : await dockerImageId(tag);
      if (imageId !== undefined) bots[botId] = { ...pin, imageId };
    }
    record = { ...record, pins: { ...record.pins, bots } };
  }
  const matchSeedBuffer = seedFromHex(record.matchSeed);
  const matchRng = createRng(deriveSeed(matchSeedBuffer, 'match', matchId));

  const rationale = new RationaleCollector();
  const lifecycles = await startBotLifecycles({
    game,
    gameEntry,
    config: record.config,
    matchId,
    participantIds: record.participantIds,
    imageTagsByBotId,
    tournamentSeed: matchSeedBuffer,
    onBotStderr: (participantId, chunk) => {
      rationale.push(participantId, chunk);
    },
  });
  const auditingCollector = new AuditingActionCollector(new DockerActionCollector(lifecycles));
  const currentConfigSha256 = configSha256(record.config);

  let roundsThisInvocation = 0;
  try {
    const outcome = await runAvailableRounds({
      game,
      state,
      participantIds: record.participantIds,
      rng: matchRng,
      collector: auditingCollector,
      defaultDeadlineMs: 5_000,
      matchDeadlineMs: MATCH_DEADLINE_MS,
      startingRoundId: record.roundsPlayed,
      onRoundResolved: async ({ state: newState, events }) => {
        const roundIndex = record.roundsPlayed;
        roundsThisInvocation += 1;
        record = {
          ...record,
          roundsPlayed: record.roundsPlayed + 1,
          snapshot: forwardModule.serializeForwardState(newState),
          updatedAt: new Date().toISOString(),
        };
        const saved = await saveForwardMatchRecord(storeDir, record);
        if (!saved.ok) {
          // Aborts the loop rather than silently continuing to play rounds whose results might
          // never be persisted — see runAvailableRounds's own onRoundResolved doc comment.
          throw new Error(`failed to persist forward match progress: ${saved.reason}`);
        }
        printRoundEvents([events]);

        // Decision audit trail — supplementary to the match itself, so a failure to record it
        // warns rather than aborting a round that has already been persisted.
        const collected = auditingCollector.take(roundIndex);
        const standings = forwardModule.getCurrentStandings?.(newState);
        const recordedAt = new Date().toISOString();
        const entries: RoundAuditEntry[] = record.participantIds.map((participantId) => {
          const c = collected.get(participantId);
          const { date, fills } = roundDateAndFills(events, participantId);
          const equityCents = equityCentsFor(standings, participantId);
          const sourceSha256 = sourceSha256ByBotId.get(participantId);
          const roundDate = date ?? c?.date;
          return {
            matchId,
            roundIndex,
            participantId,
            ...(roundDate !== undefined ? { date: roundDate } : {}),
            recordedAt,
            ...(c !== undefined ? { observationSha256: c.observationSha256 } : {}),
            collection: c?.collection ?? 'disconnected',
            ...(c?.action !== undefined ? { action: c.action } : {}),
            ...(fills !== undefined ? { fills } : {}),
            ...(equityCents !== undefined ? { equityCents } : {}),
            ...(sourceSha256 !== undefined ? { sourceSha256 } : {}),
            configSha256: currentConfigSha256,
          };
        });
        const audited = recordRoundAudit(storeDir, entries);
        if (!audited.ok) console.error(`warning: ${audited.reason}`);
      },
    });

    // Let the last round's rationale finish arriving, then attach every decision's rationale to
    // the audit row for its date.
    await new Promise((resolve) => setTimeout(resolve, STDERR_DRAIN_MS));
    for (const { participantId, date, rationale: decisions } of rationale.entries()) {
      const attached = attachRoundRationale(storeDir, matchId, participantId, date, decisions);
      if (!attached.ok) console.error(`warning: ${attached.reason}`);
    }

    const fullyResolved = forwardModule.isForwardMatchFullyResolved(outcome.finalState);
    const forfeited = outcome.terminalOutcome?.status === 'forfeit';
    const matchEndPayload: { result: unknown; reason: 'completed' | 'aborted' | 'suspended' } =
      forfeited
        ? { result: null, reason: 'aborted' }
        : fullyResolved
          ? {
              result:
                outcome.terminalOutcome?.status === 'completed'
                  ? outcome.terminalOutcome.result
                  : null,
              reason: 'completed',
            }
          : { result: null, reason: 'suspended' };
    await Promise.all(
      [...lifecycles.values()].map((lifecycle) => lifecycle.finish(matchEndPayload)),
    );

    if (forfeited && outcome.terminalOutcome?.status === 'forfeit') {
      record = {
        ...record,
        status: 'forfeited',
        forfeitedParticipantIds: outcome.terminalOutcome.forfeitedParticipantIds,
      };
    } else if (fullyResolved) {
      record = { ...record, status: 'completed' };
    }
    const finalSave = await saveForwardMatchRecord(storeDir, record);
    if (!finalSave.ok) {
      console.error(finalSave.reason);
      return 1;
    }

    const standingsSummary = forwardModule.getCurrentStandings?.(outcome.finalState);
    if (standingsSummary !== undefined) {
      printForwardStandings(standingsSummary, record.participantIds);
    }

    console.log(
      `\nForward match "${matchId}": played ${String(roundsThisInvocation)} new round(s) this ` +
        `invocation (${String(record.roundsPlayed)} total).`,
    );
    console.log(
      record.status === 'active'
        ? 'Still resumable — more data may arrive later; re-run the same command to continue.'
        : `Status: ${record.status}.`,
    );
    return 0;
  } catch (error) {
    await Promise.all(
      [...lifecycles.values()].map((lifecycle) =>
        lifecycle.finish({ result: null, reason: 'aborted' }),
      ),
    );
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    untrackLifecycles(lifecycles);
  }
}

export interface MatchForwardEndOptions {
  rootDir: string;
}

const END_USAGE = 'Usage: quant-fusion match forward end <matchId> [--store-dir <path>]';

/** Deliberately stops an `'active'` forward match early — distinct from a match reaching
 * `'completed'` on its own through `runMatchForwardRunCommand` (see `ForwardMatchStatusSchema`'s
 * own doc comment for why these stay two different status values). A pure metadata mutation, no
 * bots/Docker involved: unlike `run`/`preview`, ending a match never needs to resolve a game
 * module or build a bot image, since it doesn't play anything. Refuses (a normal `0`-exit no-op,
 * not an error) on a match that's already non-`'active'` — ending an already-ended match twice is
 * meaningless, not a mistake worth failing loudly over. */
export async function runMatchForwardEndCommand(
  argv: readonly string[],
  options: MatchForwardEndOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: { 'store-dir': { type: 'string' } },
    allowPositionals: true,
  });
  const [matchId] = positionals;
  if (matchId === undefined) {
    console.error(END_USAGE);
    return 1;
  }
  const storeDir = values['store-dir'] ?? defaultForwardMatchStoreDir(options.rootDir);

  const outcome = await loadForwardMatchRecord(storeDir, matchId);
  if (outcome.status === 'not-found') {
    console.error(`No forward match record found for "${matchId}".`);
    return 1;
  }
  if (outcome.status === 'corrupt') {
    console.error(outcome.reason);
    return 1;
  }
  const { record } = outcome;
  if (record.status !== 'active') {
    console.log(`Forward match "${matchId}" is already ${record.status} — nothing to do.`);
    return 0;
  }

  const ended: ForwardMatchRecord = {
    ...record,
    status: 'ended',
    updatedAt: new Date().toISOString(),
  };
  const saved = await saveForwardMatchRecord(storeDir, ended);
  if (!saved.ok) {
    console.error(saved.reason);
    return 1;
  }
  console.log(
    `Forward match "${matchId}" ended at round ${String(record.roundsPlayed)} — no longer resumable.`,
  );
  return 0;
}

export interface MatchForwardListOptions {
  rootDir: string;
}

export async function runMatchForwardListCommand(
  argv: readonly string[],
  options: MatchForwardListOptions,
): Promise<number> {
  const { values } = parseArgs({
    args: argv as string[],
    options: { 'store-dir': { type: 'string' } },
    allowPositionals: false,
  });
  const storeDir = values['store-dir'] ?? defaultForwardMatchStoreDir(options.rootDir);

  const { summaries, issues } = await listForwardMatchRecords(storeDir);
  if (summaries.length === 0) {
    console.log('No forward matches recorded yet.');
  }
  for (const summary of summaries) {
    console.log(
      `${summary.matchId}  ${summary.updatedAt}  ${summary.status}  ${summary.gameId}  ` +
        `${String(summary.roundsPlayed)} round(s)  ${summary.participantIds.join(', ')}`,
    );
  }
  for (const issue of issues) {
    console.error(`warning: could not read ${issue.path}: ${issue.message}`);
  }
  return 0;
}

export interface MatchForwardInspectOptions {
  rootDir: string;
}

export async function runMatchForwardInspectCommand(
  argv: readonly string[],
  options: MatchForwardInspectOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: { 'store-dir': { type: 'string' } },
    allowPositionals: true,
  });
  const [matchId] = positionals;
  if (matchId === undefined) {
    console.error('Usage: quant-fusion match forward inspect <matchId> [--store-dir <path>]');
    return 1;
  }
  const storeDir = values['store-dir'] ?? defaultForwardMatchStoreDir(options.rootDir);

  const outcome = await loadForwardMatchRecord(storeDir, matchId);
  if (outcome.status === 'not-found') {
    console.error(`No forward match record found for "${matchId}".`);
    return 1;
  }
  if (outcome.status === 'corrupt') {
    console.error(outcome.reason);
    return 1;
  }
  const { record } = outcome;

  console.log(`Forward match ${record.matchId}`);
  console.log(`  status: ${record.status}`);
  console.log(`  game: ${record.gameId}@${record.gameVersion}`);
  console.log(`  participants: ${record.participantIds.join(', ')}`);
  console.log(`  created: ${record.createdAt}, updated: ${record.updatedAt}`);
  console.log(`  rounds played: ${String(record.roundsPlayed)}`);
  if (record.forfeitedParticipantIds !== undefined) {
    console.log(`  forfeited: ${record.forfeitedParticipantIds.join(', ')}`);
  }
  if (record.pins === undefined) {
    console.log('  pins: none (not pinned)');
  } else {
    console.log(
      `  pinned: ${record.pins.pinnedAt} (config sha256 ${record.pins.configSha256.slice(0, 12)})`,
    );
    for (const [botId, pin] of Object.entries(record.pins.bots)) {
      console.log(
        `    ${botId}: source ${pin.sourceSha256.slice(0, 12)}, image ${pin.imageId?.slice(0, 19) ?? '(not built yet)'}`,
      );
    }
  }
  return 0;
}
