// `quant-fusion live decide <botId> --config-file <path> --portfolio-file <path>` — asks a bot
// what it would trade for a REAL portfolio (cash + positions read from a broker by the caller),
// on the latest trading day the config's market data knows about. The exact same bot image and
// observation shape a forward match uses — only the portfolio comes from outside. Never persists
// anything and never talks to a broker: the caller (the web API's Live tab) owns the risk gate,
// human approval, and order submission.
//
// Ends with one `LIVE_DECISION_JSON:{date, orders}` line for the caller to parse. Each bot's own
// `QUANT_DECISION_JSON:` rationale lines (relayed from its stderr) appear above it.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { generateTournamentSeed } from '@quant-fusion/rng';
import { DockerActionCollector } from '@quant-fusion/runtime';
import {
  buildBotImages,
  loadGame,
  resolveBotsAndGame,
  startBotLifecycles,
  untrackLifecycles,
} from '../lib/match-execution.js';

const USAGE =
  'Usage: quant-fusion live decide <botId> --config-file <path> --portfolio-file <path>';

export const LIVE_DECISION_MARKER = 'LIVE_DECISION_JSON:';
const STDERR_DRAIN_MS = 1_500;

interface LiveGameModule {
  observeLivePortfolio: (args: { config: unknown; participantId: string; portfolio: unknown }) => {
    observation: unknown;
    date: string;
  };
}

function isLiveGameModule(value: unknown): value is LiveGameModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).observeLivePortfolio === 'function'
  );
}

async function readJson(path: string, flag: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `Could not read ${flag} "${path}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function runLiveDecideCommand(
  argv: readonly string[],
  options: { rootDir: string },
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: {
      'config-file': { type: 'string' },
      'portfolio-file': { type: 'string' },
    },
    allowPositionals: true,
  });
  const [botId] = positionals;
  const configFile = values['config-file'];
  const portfolioFile = values['portfolio-file'];
  if (botId === undefined || configFile === undefined || portfolioFile === undefined) {
    console.error(USAGE);
    return 1;
  }

  let configRaw: unknown;
  let portfolio: unknown;
  try {
    configRaw = await readJson(configFile, '--config-file');
    portfolio = await readJson(portfolioFile, '--portfolio-file');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const resolved = await resolveBotsAndGame(options.rootDir, [botId]);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const { entries, gameEntry } = resolved;
  const game = await loadGame(gameEntry);
  const gameModule: unknown = await import(gameEntry.manifest.entryPackage);
  if (!isLiveGameModule(gameModule)) {
    console.error(`"${gameEntry.manifest.entryPackage}" does not export observeLivePortfolio.`);
    return 1;
  }
  const configResult = game.parseConfig(configRaw);
  if (!configResult.ok) {
    console.error(`Invalid --config-file: ${configResult.reason}`);
    return 1;
  }

  let observation: unknown;
  let date: string;
  try {
    ({ observation, date } = gameModule.observeLivePortfolio({
      config: configResult.value,
      participantId: botId,
      portfolio,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  console.log(`Deciding for ${botId} as of ${date} (latest market data)...`);

  const imageTagsByBotId = await buildBotImages(entries);
  const lifecycles = await startBotLifecycles({
    game,
    gameEntry,
    config: configResult.value,
    matchId: `live-${botId}-${String(Date.now())}`,
    participantIds: [botId],
    imageTagsByBotId,
    tournamentSeed: generateTournamentSeed(),
  });
  let action: unknown;
  let failure: string | undefined;
  try {
    const outcome = await new DockerActionCollector(lifecycles).requestAction({
      participantId: botId,
      roundId: (observation as { round?: number }).round ?? 0,
      observation,
      deadlineMs: 15_000,
      required: true,
    });
    if (outcome.ok) action = outcome.action;
    else failure = JSON.stringify(outcome);
    // The bot writes its rationale to stderr BEFORE returning its action, but Docker's attach
    // stream can deliver the action first — tearing the container down immediately drops the
    // still-in-flight stderr (its QUANT_DECISION_JSON lines). A short drain keeps them.
    await new Promise((resolve) => setTimeout(resolve, STDERR_DRAIN_MS));
  } finally {
    await Promise.all(
      [...lifecycles.values()].map((lifecycle) =>
        lifecycle.finish({ result: null, reason: 'aborted' }),
      ),
    );
    untrackLifecycles(lifecycles);
  }

  if (failure !== undefined) {
    console.error(`${botId} did not return a valid action: ${failure}`);
    return 1;
  }
  const orders = (action as { orders?: unknown } | undefined)?.orders;
  // The closes the bot itself decided on (USD, as this game stores them) — the caller's risk gate
  // sizes notional/weights off these, so its checks see exactly the prices the bot saw.
  const pricesUsd: Record<string, number> = {};
  const securities = (observation as { securities?: unknown }).securities;
  if (Array.isArray(securities)) {
    for (const security of securities as { ticker: string; history: { close: number }[] }[]) {
      const close = security.history.at(-1)?.close;
      if (close !== undefined) pricesUsd[security.ticker] = close;
    }
  }
  console.log(
    `${LIVE_DECISION_MARKER}${JSON.stringify({ botId, date, orders: Array.isArray(orders) ? orders : [], pricesUsd })}`,
  );
  return 0;
}
