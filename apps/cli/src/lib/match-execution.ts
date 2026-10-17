// Shared by `match run` and `tournament run`: resolving bot/game ids through
// the registry, building bot images on demand, and driving one real match through the engine and
// runtime. Neither command duplicates this — a tournament is just this same single-match wiring,
// called once per `MatchDescriptor` a `TournamentFormat` unlocks.
import type { GameDefinition, RoundEvent, StandingOutcome } from '@quant-fusion/engine';
import { runMatch } from '@quant-fusion/engine';
import { createRng, deriveSeed, seedToHex } from '@quant-fusion/rng';
import {
  scanBots,
  scanGames,
  type BotRegistryEntry,
  type GameRegistryEntry,
} from '@quant-fusion/registry';
import {
  BotLifecycle,
  buildBotImage,
  botImageTag,
  DEFAULT_RESOURCE_LIMITS,
  DockerActionCollector,
  DockerBotProcess,
} from '@quant-fusion/runtime';
import { TerminalHumanCollector } from './human-collector.js';

export type AnyGameDefinition = GameDefinition<unknown, unknown, unknown, unknown, unknown>;

const GAME_DEFINITION_METHODS = [
  'parseConfig',
  'initialize',
  'getObservation',
  'getPendingActions',
  'validateAction',
  'resolve',
  'isTerminal',
  'getResult',
  'getStandingOutcomes',
] as const;

function isGameDefinitionLike(value: unknown): value is AnyGameDefinition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return GAME_DEFINITION_METHODS.every((method) => typeof candidate[method] === 'function');
}

export async function loadGame(entry: GameRegistryEntry): Promise<AnyGameDefinition> {
  const loaded: unknown = await import(entry.manifest.entryPackage);
  const candidate = (loaded as Record<string, unknown>).game;
  if (!isGameDefinitionLike(candidate)) {
    throw new Error(
      `"${entry.manifest.entryPackage}" does not export a "game" GameDefinition (see games/rock-paper-scissors/src/index.ts for the convention)`,
    );
  }
  return candidate;
}

export type ResolveBotsAndGameResult =
  | { ok: true; entries: BotRegistryEntry[]; gameEntry: GameRegistryEntry }
  | { ok: false; message: string };

/** Resolves every bot id through the registry and confirms they all share one game. */
export async function resolveBotsAndGame(
  rootDir: string,
  botIds: readonly string[],
): Promise<ResolveBotsAndGameResult> {
  const [botsResult, gamesResult] = await Promise.all([scanBots(rootDir), scanGames(rootDir)]);

  const entries: BotRegistryEntry[] = [];
  for (const id of botIds) {
    const entry = botsResult.entries.get(id);
    if (!entry) {
      const known = [...botsResult.entries.keys()].join(', ') || '(none found)';
      return { ok: false, message: `Unknown bot id "${id}". Known bots: ${known}` };
    }
    entries.push(entry);
  }

  const gameIds = new Set(entries.map((entry) => entry.manifest.game));
  if (gameIds.size > 1) {
    return {
      ok: false,
      message: `All bots must play the same game; got: ${[...gameIds].join(', ')}`,
    };
  }
  const [gameId] = gameIds;
  const gameEntry = gameId === undefined ? undefined : gamesResult.entries.get(gameId);
  if (!gameEntry) {
    const known = [...gamesResult.entries.keys()].join(', ') || '(none found)';
    return { ok: false, message: `Unknown game "${String(gameId)}". Known games: ${known}` };
  }

  return { ok: true, entries, gameEntry };
}

/** Builds every bot's image on demand, once, keyed by bot id — never once per match. */
export async function buildBotImages(
  entries: readonly BotRegistryEntry[],
): Promise<Map<string, string>> {
  const imageTagsByBotId = new Map<string, string>();
  for (const entry of entries) {
    const imageTag = botImageTag(entry.manifest.id);
    await buildBotImage({
      botDir: entry.dir,
      dockerfile: entry.manifest.build.dockerfile,
      context: entry.manifest.build.context,
      imageTag,
    });
    imageTagsByBotId.set(entry.manifest.id, imageTag);
  }
  return imageTagsByBotId;
}

export interface RunSingleMatchArgs {
  game: AnyGameDefinition;
  gameEntry: GameRegistryEntry;
  config: unknown;
  matchId: string;
  participantIds: readonly string[];
  imageTagsByBotId: ReadonlyMap<string, string>;
  /** The tournament's one entropy boundary (ADR-0004) — everything else derives from this. */
  tournamentSeed: Buffer;
}

export interface SingleMatchOutcome {
  status: 'completed' | 'forfeit' | 'match-timeout';
  events: RoundEvent[][];
  standingOutcomes: StandingOutcome[];
  forfeitedParticipantIds?: string[];
  /** The game's own `getResult()` value — present only when `status === 'completed'`. Untyped
   * here because this module is game-agnostic (`AnyGameDefinition` erases `TResult`); a
   * game-specific field on it, e.g. Hearts's `handsPlayed`, is read back out by whatever prints
   * the match summary (see `printHandsPlayed` in commands/match.ts). */
  result?: unknown;
}

/**
 * The whole-match wall-clock safety net (docs/adr/0003-docker-bot-isolation.md): protects
 * against a game state that never satisfies `isTerminal()` even though every participant is
 * responding correctly and on time every round. Rock-Paper-Scissors itself no longer has this
 * problem — it's bounded by a fixed `totalRounds` regardless of how the hands fall
 * (games/rock-paper-scissors/src/types.ts) — so in practice this is defense-in-depth against a
 * different or future game whose own termination logic has a similar gap, not something normal
 * RPS play should ever actually hit.
 */
const MATCH_DEADLINE_MS = 120_000;

/**
 * Every `BotLifecycle` currently in flight, across whichever single match `runSingleMatch` is
 * driving right now — `match run`/`tournament run` only ever run one match at a time (each
 * awaits the previous before starting the next), so this never needs to track more than one
 * match's worth of containers. Exists so a process-level interrupt (`apps/cli/src/index.ts`'s
 * `SIGINT`/`SIGTERM` handler) has something to reach into: closing the terminal mid-tournament
 * would otherwise leave every currently-running container behind, since nothing else outside
 * this module's own call stack knows they exist.
 */
const activeLifecycles = new Set<BotLifecycle>();

/** Best-effort teardown of every container currently in flight — used by the CLI's interrupt
 * handler. A no-op if nothing is running right now. Never throws: `BotLifecycle.finish()` itself
 * never rejects, and an already-terminated lifecycle just resolves immediately. */
export async function abortActiveMatch(): Promise<void> {
  await Promise.all(
    [...activeLifecycles].map((lifecycle) => lifecycle.finish({ result: null, reason: 'aborted' })),
  );
}

/** Removes each lifecycle from the interrupt handler's tracking set — call once a caller's own
 * work with lifecycles `startBotLifecycles` returned is finished, success or failure (see
 * `runSingleMatch`/`runHumanMatch` below, and `commands/matchForward.ts`'s own use of it). */
export function untrackLifecycles(lifecycles: ReadonlyMap<string, BotLifecycle>): void {
  for (const lifecycle of lifecycles.values()) {
    activeLifecycles.delete(lifecycle);
  }
}

export interface StartBotLifecyclesArgs {
  game: AnyGameDefinition;
  gameEntry: GameRegistryEntry;
  config: unknown;
  matchId: string;
  /** Which participants to start a container + init handshake for. */
  participantIds: readonly string[];
  /** The full roster reported in each started bot's own `init` payload. Defaults to
   * `participantIds` when omitted; only needs to differ when a match includes a seat that never
   * gets its own container (e.g. `runHumanMatch`'s human) — that seat still belongs in every
   * bot's own opponent-awareness roster, without ever being one of the ids this function starts a
   * container for. */
  roster?: readonly string[];
  /** Also receives every chunk of each bot's stderr (in addition to the live relay to this
   * process's own stderr) — e.g. `match forward run`'s audit trail collecting a bot's
   * `QUANT_DECISION_JSON` rationale lines per participant. */
  onBotStderr?: (participantId: string, chunk: string) => void;
  imageTagsByBotId: ReadonlyMap<string, string>;
  /** The one entropy boundary every participant's `rngSeed` derives from (ADR-0004) — a real
   * tournament's own seed for `match run`/`tournament run`, or a forward match's own persisted
   * `matchSeed` for `match forward run` (roadmap Phase 3) — this function itself has no opinion
   * on which. */
  tournamentSeed: Buffer;
}

/**
 * Spins up one container per participant and completes its init handshake — the shared first
 * half of `runSingleMatch`'s, `runHumanMatch`'s, and (roadmap Phase 3) `match forward run`'s own
 * bot-startup loop; extracted so none of them duplicate it. Guarantees, via its own
 * `try`/`catch`, that a later participant's container failing to start or initialize still tears
 * down every lifecycle started so far — including removing each from `activeLifecycles`, so a
 * caller that never gets a `Map` back (this function threw) has nothing left to clean up itself.
 * A caller that DOES get a `Map` back owns tearing those down (and untracking them) once ITS OWN
 * later work (e.g. `runMatch` itself) finishes or fails — see `runSingleMatch` below for that
 * second half.
 */
export async function startBotLifecycles(
  args: StartBotLifecyclesArgs,
): Promise<Map<string, BotLifecycle>> {
  const { game, gameEntry, config, matchId, participantIds, imageTagsByBotId, tournamentSeed } =
    args;
  const roster = [...(args.roster ?? participantIds)];
  const lifecycles = new Map<string, BotLifecycle>();
  try {
    for (const participantId of participantIds) {
      const imageTag = imageTagsByBotId.get(participantId);
      if (imageTag === undefined) {
        throw new Error(`unreachable: no image built for participant "${participantId}"`);
      }
      const botProcess = new DockerBotProcess({
        imageRef: imageTag,
        matchId,
        participantId,
        resourceLimits: DEFAULT_RESOURCE_LIMITS,
      });
      await botProcess.start();
      // Relayed live to this process's own stderr — `BotLifecycle` separately buffers stderr
      // internally for failure diagnostics (`getStderrLog()`), but nothing before this forwarded
      // it anywhere a human (or `runCli`'s captured combined output, which `apps/api`
      // relies on to surface a run/preview's own log) could actually see it during a normal,
      // successful round. A bot writing its own per-round reasoning to stderr (e.g.
      // `@quant-fusion/quant-sdk-js`'s `formatStrategyTrace`) was previously invisible outside a
      // crash; this line, and only this line, is what makes it visible.
      botProcess.onStderr((chunk) => {
        process.stderr.write(chunk);
        args.onBotStderr?.(participantId, chunk);
      });
      const lifecycle = new BotLifecycle({ process: botProcess, matchId });
      // Tracked immediately — before `initialize()` even resolves — so that a later
      // participant's `start()`/`initialize()` failing still tears this one down too, via the
      // catch block below, without needing its own special-cased cleanup.
      lifecycles.set(participantId, lifecycle);
      activeLifecycles.add(lifecycle);

      const rngSeedHex = seedToHex(deriveSeed(tournamentSeed, 'bot', matchId, participantId));
      const initOutcome = await lifecycle.initialize(
        {
          gameId: gameEntry.manifest.id,
          gameVersion: gameEntry.manifest.version,
          participantId,
          roster,
          rngSeed: rngSeedHex,
          config: game.redactConfigForBots?.(config) ?? config,
        },
        { initTimeoutMs: 10_000 },
      );
      if (!initOutcome.ok) {
        throw new Error(`${participantId} failed to initialize: ${initOutcome.detail}`);
      }
    }
    return lifecycles;
  } catch (error) {
    await Promise.all(
      [...lifecycles.values()].map((lifecycle) =>
        lifecycle.finish({ result: null, reason: 'aborted' }),
      ),
    );
    untrackLifecycles(lifecycles);
    throw error;
  }
}

/** Runs one real match against already-started lifecycles, tears them down once it's done —
 * guaranteed by the `try`/`catch`/`finally` below regardless of *how* things go wrong: `runMatch()`
 * itself throwing unexpectedly still leaves zero containers behind. Spins up those lifecycles via
 * `startBotLifecycles` first, whose own guarantee covers container-startup failures the same way. */
export async function runSingleMatch(args: RunSingleMatchArgs): Promise<SingleMatchOutcome> {
  const { game, gameEntry, config, matchId, participantIds, imageTagsByBotId, tournamentSeed } =
    args;
  const roster = [...participantIds];
  const matchRng = createRng(deriveSeed(tournamentSeed, 'match', matchId));

  const lifecycles = await startBotLifecycles({
    game,
    gameEntry,
    config,
    matchId,
    participantIds: roster,
    imageTagsByBotId,
    tournamentSeed,
  });
  try {
    const outcome = await runMatch({
      game,
      config,
      participantIds: roster,
      rng: matchRng,
      collector: new DockerActionCollector(lifecycles),
      defaultDeadlineMs: 5_000,
      matchDeadlineMs: MATCH_DEADLINE_MS,
    });

    const matchEndPayload =
      outcome.status === 'completed'
        ? { result: outcome.result, reason: 'completed' as const }
        : { result: null, reason: 'aborted' as const };
    await Promise.all(
      [...lifecycles.values()].map((lifecycle) => lifecycle.finish(matchEndPayload)),
    );

    return {
      status: outcome.status,
      events: outcome.events,
      standingOutcomes: outcome.standingOutcomes,
      // Omit the key entirely when absent, rather than setting it to `undefined` — required by
      // tsconfig.base.json's `exactOptionalPropertyTypes`.
      ...(outcome.forfeitedParticipantIds !== undefined
        ? { forfeitedParticipantIds: outcome.forfeitedParticipantIds }
        : {}),
      ...(outcome.result !== undefined ? { result: outcome.result } : {}),
    };
  } catch (error) {
    // `runMatch()` itself threw — every lifecycle still gets torn down. `finish()` on an
    // already-terminated lifecycle is a safe no-op, so this needs no special-casing.
    await Promise.all(
      [...lifecycles.values()].map((lifecycle) =>
        lifecycle.finish({ result: null, reason: 'aborted' }),
      ),
    );
    throw error;
  } finally {
    untrackLifecycles(lifecycles);
  }
}

export interface RunHumanMatchArgs {
  game: AnyGameDefinition;
  gameEntry: GameRegistryEntry;
  config: unknown;
  matchId: string;
  humanParticipantId: string;
  /** One or more bots filling every non-human seat — a 2-player game passes exactly one; a
   * 4-player game like Hearts passes three. */
  botParticipantIds: readonly string[];
  botImageTagsByBotId: ReadonlyMap<string, string>;
  /** The tournament's one entropy boundary (ADR-0004) — everything else derives from this. */
  tournamentSeed: Buffer;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/**
 * A human, unlike a Docker container, sets their own pace — this is a generous outer bound
 * against a genuinely abandoned session (docs/adr/0003's whole-match wall-clock safety net,
 * `runSingleMatch`'s own `MATCH_DEADLINE_MS` above), not a per-turn deadline. The human's own
 * `TerminalHumanCollector.requestAction` never times out on its own.
 */
const HUMAN_MATCH_DEADLINE_MS = 60 * 60 * 1000; // 1 hour

/** `quant-fusion play`'s single-human counterpart to `runSingleMatch` — one real Docker container
 * per bot (one for a 2-player game, more for a game like Hearts that needs a full roster), one
 * `TerminalHumanCollector` prompting a real terminal for the human and delegating every other
 * participant to a `DockerActionCollector` over those containers, driven through the same
 * `runMatch()` loop either way. Mirrors `runSingleMatch`'s per-participant container loop and its
 * teardown-on-any-failure guarantee — the only structural difference is the human's own seat. */
export async function runHumanMatch(args: RunHumanMatchArgs): Promise<SingleMatchOutcome> {
  const {
    game,
    gameEntry,
    config,
    matchId,
    humanParticipantId,
    botParticipantIds,
    botImageTagsByBotId,
    tournamentSeed,
    input,
    output,
  } = args;
  const roster = [humanParticipantId, ...botParticipantIds];
  const matchRng = createRng(deriveSeed(tournamentSeed, 'match', matchId));
  const writeStream = output ?? process.stdout;

  // Throws with full self-cleanup (containers torn down, activeLifecycles untracked) on any
  // bot's own startup/init failure — nothing else for this function to clean up in that case,
  // since the human collector below doesn't exist yet.
  const lifecycles = await startBotLifecycles({
    game,
    gameEntry,
    config,
    matchId,
    participantIds: botParticipantIds,
    roster, // includes humanParticipantId — a seat every bot's init roster must list
    imageTagsByBotId: botImageTagsByBotId,
    tournamentSeed,
  });
  const collector = new TerminalHumanCollector({
    humanParticipantId,
    game,
    fallback: new DockerActionCollector(lifecycles),
    // Omitted entirely when absent, rather than set to `undefined` — required by
    // tsconfig.base.json's `exactOptionalPropertyTypes`.
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
  });

  try {
    const outcome = await runMatch({
      game,
      config,
      participantIds: roster,
      rng: matchRng,
      collector,
      defaultDeadlineMs: 5_000,
      matchDeadlineMs: HUMAN_MATCH_DEADLINE_MS,
      // Narrates every round live — including ones where it isn't the human's turn — so a
      // human still learns what happened even once they're no longer ever asked to act again
      // (e.g. busted out of the hand they just went all-in on).
      onRoundResolved: (events) => {
        const line = game.humanInterface?.describeRoundEvents?.(events, humanParticipantId);
        if (line !== undefined) {
          writeStream.write(`${line}\n`);
        }
      },
    });

    const matchEndPayload =
      outcome.status === 'completed'
        ? { result: outcome.result, reason: 'completed' as const }
        : { result: null, reason: 'aborted' as const };
    await Promise.all(
      [...lifecycles.values()].map((lifecycle) => lifecycle.finish(matchEndPayload)),
    );

    return {
      status: outcome.status,
      events: outcome.events,
      standingOutcomes: outcome.standingOutcomes,
      ...(outcome.forfeitedParticipantIds !== undefined
        ? { forfeitedParticipantIds: outcome.forfeitedParticipantIds }
        : {}),
      ...(outcome.result !== undefined ? { result: outcome.result } : {}),
    };
  } catch (error) {
    await Promise.all(
      [...lifecycles.values()].map((lifecycle) =>
        lifecycle.finish({ result: null, reason: 'aborted' }),
      ),
    );
    throw error;
  } finally {
    untrackLifecycles(lifecycles);
    collector.close();
  }
}
