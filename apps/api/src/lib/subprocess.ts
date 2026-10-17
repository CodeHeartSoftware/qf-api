import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import path from 'node:path';

export interface CommandResult {
  ok: boolean;
  exitCode: number | null;
  /** Combined stdout+stderr, interleaved in arrival order — what a human watching a terminal
   * would have seen; every action route returns this to the UI as its "what happened" log. */
  output: string;
  /** Stdout alone, for the one caller (`emitForwardConfig` below) that needs to parse it as JSON
   * without stray stderr text corrupting the parse. */
  stdout: string;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Runs `command` to completion and resolves with its output — never rejects, so a route handler
 * can always turn the result into a JSON response rather than an unhandled error path. Uses async
 * `spawn`, not `spawnSync` — this server keeps handling other requests (read endpoints, health
 * checks) while a Docker build/match run/price fetch is in flight, which a synchronous spawn
 * would block the whole event loop for. */
export function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number; onChunk?: (text: string) => void },
): Promise<CommandResult> {
  const onChunk = options.onChunk ?? currentJobSinkOrUndefined();
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd });
    let output = '';
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      output += text;
      stdout += text;
      onChunk?.(text);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      output += text;
      onChunk?.(text);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code, output, stdout });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, exitCode: null, output: `${output}\n${error.message}`, stdout });
    });
  });
}

/** `apps/cli` is an app, not a library this package depends on (see `forwardShadowConfig.ts`'s
 * own comment on that boundary) — every action route below reuses its REAL, already-tested
 * commands by spawning the built CLI as a separate process, the same way a developer would type
 * them by hand, rather than re-implementing Docker/game execution logic a second time here. */
export function runCli(
  rootDir: string,
  args: string[],
  timeoutMs?: number,
): Promise<CommandResult> {
  const cliEntry = path.join(rootDir, 'apps', 'cli', 'dist', 'index.js');
  return runCommand(process.execPath, [cliEntry, ...args], {
    cwd: rootDir,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

/** Set by `jobRunner.ts` for the duration of a job step, so every `runCli`/`runCommand` call a
 * step makes (however deeply nested — e.g. `fetchLatestPriceData`'s own `yarn` spawns) streams its
 * output into that job's live log without each caller threading a callback through. Steps run one
 * at a time per job, but two jobs CAN overlap — `AsyncLocalStorage` keeps each one's sink scoped
 * to its own async call chain. */
export const jobOutputContext = new AsyncLocalStorage<(text: string) => void>();

function currentJobSinkOrUndefined(): ((text: string) => void) | undefined {
  return jobOutputContext.getStore();
}

const locksInFlight = new Set<string>();

export function isLocked(key: string): boolean {
  return locksInFlight.has(key);
}

/** Prevents two concurrent invocations of the SAME action (e.g. two "run next round" clicks on
 * the same match) from racing each other's Docker containers/persisted-record writes — a real
 * risk `match forward run`'s own `saveForwardMatchRecord` calls have no protection against on
 * their own. Different keys (a different match, or a different action) never contend. */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  locksInFlight.add(key);
  try {
    return await fn();
  } finally {
    locksInFlight.delete(key);
  }
}
