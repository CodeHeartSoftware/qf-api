// `quant-fusion match forward pin-status <matchId> [--json]` — read-only: compares each
// participant's CURRENT bot source hash against what the match was pinned to, so a caller (the
// web UI's daily cycle, or a person) can find out a resume would be refused BEFORE trying it,
// rather than parsing `match forward run`'s refusal message after the fact.
import { parseArgs } from 'node:util';
import { loadForwardMatchRecord } from '@quant-fusion/forward-match-store';
import { computeBotSourceSha256 } from '../lib/botSourcePin.js';
import { defaultForwardMatchStoreDir } from '../lib/forwardShadowConfig.js';
import { resolveBotsAndGame } from '../lib/match-execution.js';

const USAGE =
  'Usage: quant-fusion match forward pin-status <matchId> [--json] [--store-dir <path>]';

export type BotPinState = 'pinned' | 'drifted' | 'unpinned';

export interface BotPinStatus {
  botId: string;
  state: BotPinState;
  pinnedSourceSha256?: string;
  currentSourceSha256: string;
}

export interface MatchPinStatus {
  matchId: string;
  pinnedAt?: string;
  bots: BotPinStatus[];
}

export interface MatchForwardPinStatusOptions {
  rootDir: string;
}

export async function computeMatchPinStatus(
  rootDir: string,
  storeDir: string,
  matchId: string,
): Promise<{ ok: true; value: MatchPinStatus } | { ok: false; message: string }> {
  const outcome = await loadForwardMatchRecord(storeDir, matchId);
  if (outcome.status === 'not-found')
    return { ok: false, message: `No forward match "${matchId}".` };
  if (outcome.status === 'corrupt') return { ok: false, message: outcome.reason };
  const { record } = outcome;

  const resolved = await resolveBotsAndGame(rootDir, record.participantIds);
  if (!resolved.ok) return { ok: false, message: resolved.message };

  const bots: BotPinStatus[] = [];
  for (const entry of resolved.entries) {
    const botId = entry.manifest.id;
    const currentSourceSha256 = await computeBotSourceSha256(
      entry.dir,
      entry.manifest.build.context,
    );
    const pinnedSourceSha256 = record.pins?.bots[botId]?.sourceSha256;
    bots.push({
      botId,
      state:
        pinnedSourceSha256 === undefined
          ? 'unpinned'
          : pinnedSourceSha256 === currentSourceSha256
            ? 'pinned'
            : 'drifted',
      ...(pinnedSourceSha256 !== undefined ? { pinnedSourceSha256 } : {}),
      currentSourceSha256,
    });
  }
  return {
    ok: true,
    value: {
      matchId,
      ...(record.pins !== undefined ? { pinnedAt: record.pins.pinnedAt } : {}),
      bots,
    },
  };
}

export async function runMatchForwardPinStatusCommand(
  argv: readonly string[],
  options: MatchForwardPinStatusOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: { json: { type: 'boolean' }, 'store-dir': { type: 'string' } },
    allowPositionals: true,
  });
  const [matchId] = positionals;
  if (matchId === undefined) {
    console.error(USAGE);
    return 1;
  }
  const storeDir = values['store-dir'] ?? defaultForwardMatchStoreDir(options.rootDir);
  const result = await computeMatchPinStatus(options.rootDir, storeDir, matchId);
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
  if (values.json === true) {
    console.log(JSON.stringify(result.value));
    return 0;
  }
  console.log(
    result.value.pinnedAt === undefined
      ? `"${matchId}" is not pinned.`
      : `"${matchId}" pinned ${result.value.pinnedAt}:`,
  );
  for (const bot of result.value.bots) {
    console.log(`  ${bot.botId}: ${bot.state}`);
  }
  return 0;
}
