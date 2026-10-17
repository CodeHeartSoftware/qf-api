/**
 * The Docker-agnostic surface a bot's underlying OS process exposes to `BotLifecycle`
 * (docs/adr/0003-docker-bot-isolation.md). `DockerBotProcess` is the real implementation;
 * tests drive `BotLifecycle` against an in-memory fake implementing this same interface, so
 * the state-machine/timeout/forfeit logic is fully testable without a Docker daemon.
 */
export interface ExitInfo {
  code: number | null;
  signal: string | null;
  /** Whether the container's cgroup OOM-killed the process (RESOURCE_LIMIT_EXCEEDED, not BOT_CRASHED). */
  oomKilled: boolean;
}

export interface BotProcess {
  readonly participantId: string;

  /** Write one already-newline-terminated NDJSON line to the process's stdin. */
  writeLine(line: string): void;

  /** Registers a handler for each complete NDJSON line read from stdout. */
  onLine(handler: (line: string) => void): void;

  /** Registers a handler for raw stderr chunks — diagnostic-only, never parsed as protocol. */
  onStderr(handler: (chunk: string) => void): void;

  /** Registers a handler for a framing-level fault (e.g. an oversized/unterminated line). */
  onFramingError(handler: (error: Error) => void): void;

  /** Registers a handler that fires exactly once, when the process exits. */
  onExit(handler: (info: ExitInfo) => void): void;

  /** Close stdin (EOF) — the first step of graceful shutdown. */
  closeStdin(): void;

  /** Send a termination signal. */
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}
