#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runCleanupCommand } from './commands/cleanup.js';
import { runMatchCommand } from './commands/match.js';
import {
  runMatchForwardEndCommand,
  runMatchForwardInspectCommand,
  runMatchForwardListCommand,
  runMatchForwardRunCommand,
} from './commands/matchForward.js';
import { runMatchForwardPreviewCommand } from './commands/matchForwardPreview.js';
import { runMatchForwardRefreshCommand } from './commands/matchForwardRefresh.js';
import { runMatchForwardStatusCommand } from './commands/matchForwardStatus.js';
import { runMatchForwardPinStatusCommand } from './commands/matchForwardPinStatus.js';
import { runLiveDecideCommand } from './commands/liveDecide.js';
import { abortActiveMatch } from './lib/match-execution.js';

// Presentation layer only — no engine logic lives here; `match run` and `match forward ...` are
// the real, registry-backed behavior (see commands/match.ts and commands/matchForward*.ts).
const SUBCOMMANDS = ['games', 'bots', 'match', 'cleanup'] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

function printHelp(): void {
  console.log(`quant-fusion - research models and simulated portfolios

Usage:
  quant-fusion <command> [subcommand] [options]
  quant-fusion --help
  quant-fusion --version

Commands:
  games        Manage and inspect game definitions
  bots         Manage and inspect model submissions
  match        Run and inspect simulations (see "match run" and "match forward")
  live         Real-portfolio decisions (see "live decide")
  cleanup      Force-remove any leftover Quant Fusion model containers`);
}

/** Routed directly off argv[0], ahead of the generic flag parse below, so `match forward run`'s
 * own `--config`/`--store-dir` flags are never mistaken for top-level CLI flags — since
 * `forward` is itself a group of subcommands nested under `match` (roadmap Phase 3 — see
 * docs/adr/0013-forward-match-persistence.md). */
async function runMatchForwardSubcommand(argv: readonly string[]): Promise<number> {
  const [subcommand, ...rest] = argv;
  const rootDir = process.cwd();
  if (subcommand === 'run') {
    return runMatchForwardRunCommand(rest, { rootDir });
  }
  if (subcommand === 'list') {
    return runMatchForwardListCommand(rest, { rootDir });
  }
  if (subcommand === 'inspect') {
    return runMatchForwardInspectCommand(rest, { rootDir });
  }
  if (subcommand === 'preview') {
    return runMatchForwardPreviewCommand(rest, { rootDir });
  }
  if (subcommand === 'refresh') {
    return runMatchForwardRefreshCommand(rest, { rootDir });
  }
  if (subcommand === 'status') {
    return runMatchForwardStatusCommand(rest, { rootDir });
  }
  if (subcommand === 'end') {
    return runMatchForwardEndCommand(rest, { rootDir });
  }
  if (subcommand === 'pin-status') {
    return runMatchForwardPinStatusCommand(rest, { rootDir });
  }
  console.error(
    `Unknown match forward subcommand: "${String(subcommand)}". Only "run", "list", "inspect", ` +
      `"preview", "refresh", "status", "pin-status", and "end" exist today.`,
  );
  return 1;
}

/** Routed directly off argv[0], ahead of the generic flag parse below, so `match run`'s own
 * `--config` flag is never mistaken for a top-level CLI flag. */
async function runMatchSubcommand(argv: readonly string[]): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    console.log("'match' is not yet implemented.");
    return 0;
  }
  if (subcommand === 'run') {
    return runMatchCommand(rest, { rootDir: process.cwd() });
  }
  if (subcommand === 'forward') {
    return runMatchForwardSubcommand(rest);
  }
  console.error(`Unknown match subcommand: "${subcommand}". Only "run" and "forward" exist today.`);
  return 1;
}

export async function run(argv: readonly string[]): Promise<number> {
  if (argv[0] === 'match') {
    return runMatchSubcommand(argv.slice(1));
  }
  if (argv[0] === 'cleanup') {
    return runCleanupCommand();
  }
  // Real-portfolio (broker) decisions — see `commands/liveDecide.ts`.
  if (argv[0] === 'live') {
    if (argv[1] === 'decide')
      return runLiveDecideCommand(argv.slice(2), { rootDir: process.cwd() });
    console.error(`Unknown live subcommand: "${String(argv[1])}". Only "decide" exists today.`);
    return 1;
  }

  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.version) {
    console.log('0.1.0');
    return 0;
  }

  if (values.help === true || positionals.length === 0) {
    printHelp();
    return 0;
  }

  const [command] = positionals;
  if (command === undefined || !isSubcommand(command)) {
    console.error(`Unknown command: ${command ?? ''}`.trim());
    printHelp();
    return 1;
  }

  console.log(`'${command}' is not yet implemented.`);
  return 0;
}

/**
 * Closing the terminal, or an ordinary Ctrl+C, sends `SIGINT`/`SIGTERM` — without this, either
 * one would kill the process immediately, leaving whatever bot containers `match run`/
 * `tournament run` currently has running behind (nothing else would ever tell them to stop).
 * `abortActiveMatch()` (apps/cli/src/lib/match-execution.ts) tears down the one match currently
 * in flight, if any; a second interrupt while that's in progress exits immediately rather than
 * risk the user feeling stuck if Docker itself is unresponsive. Not registered under `vitest`
 * (only ever called from the real entrypoint below) so tests never install a process-wide signal
 * handler that outlives the test run.
 */
function registerInterruptHandler(): void {
  let shuttingDown = false;

  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
    shuttingDown = true;
    console.error(`\nReceived ${signal} — stopping any active bot containers before exiting...`);
    abortActiveMatch()
      .catch(() => {
        // Best-effort: still exit below even if teardown itself hit an error.
      })
      .finally(() => {
        process.exit(signal === 'SIGINT' ? 130 : 143);
      });
  };

  process.on('SIGINT', handle);
  process.on('SIGTERM', handle);
}

/** `import.meta.url` always resolves to this module's REAL path (symlinks followed), but
 * `process.argv[1]` retains whatever path was used to invoke it — including a symlink, which is
 * exactly what every real install goes through: package.json's `"bin"` entry becomes
 * `node_modules/.bin/quant-fusion`, a symlink to `dist/index.js`. A naive string comparison
 * between the two silently fails (and this whole CLI silently no-ops, with exit code 0 and zero
 * output) for that primary, documented invocation path — `realpathSync` resolves the symlink
 * first so the comparison matches regardless of how this file was invoked. */
function isRunAsCliEntryPoint(): boolean {
  if (process.argv[1] === undefined) {
    return false;
  }
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

/* node:coverage disable */
if (isRunAsCliEntryPoint()) {
  registerInterruptHandler();
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
/* node:coverage enable */
