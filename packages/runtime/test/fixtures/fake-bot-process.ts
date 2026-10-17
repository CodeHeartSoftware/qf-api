import type { BotProcess, ExitInfo } from '../../src/bot-process.js';

/**
 * An in-memory `BotProcess` double so `BotLifecycle`'s state machine, timeout, and forfeit
 * logic can be tested without a Docker daemon. Tests drive the "far side" (the simulated bot)
 * via the `emit*` methods and inspect what the lifecycle sent via `sentLines`/`sentMessages`.
 */
export class FakeBotProcess implements BotProcess {
  readonly participantId: string;
  readonly sentLines: string[] = [];
  readonly killSignals: ('SIGTERM' | 'SIGKILL')[] = [];
  stdinClosed = false;

  private readonly lineHandlers: ((line: string) => void)[] = [];
  private readonly stderrHandlers: ((chunk: string) => void)[] = [];
  private readonly exitHandlers: ((info: ExitInfo) => void)[] = [];
  private readonly framingErrorHandlers: ((error: Error) => void)[] = [];

  constructor(participantId = 'p1') {
    this.participantId = participantId;
  }

  writeLine(line: string): void {
    this.sentLines.push(line);
  }

  onLine(handler: (line: string) => void): void {
    this.lineHandlers.push(handler);
  }

  onStderr(handler: (chunk: string) => void): void {
    this.stderrHandlers.push(handler);
  }

  onFramingError(handler: (error: Error) => void): void {
    this.framingErrorHandlers.push(handler);
  }

  onExit(handler: (info: ExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  closeStdin(): void {
    this.stdinClosed = true;
  }

  kill(signal: 'SIGTERM' | 'SIGKILL'): void {
    this.killSignals.push(signal);
  }

  get sentMessages(): unknown[] {
    return this.sentLines.map((line): unknown => JSON.parse(line));
  }

  get lastSentMessage(): unknown {
    return this.sentMessages.at(-1);
  }

  emitLine(line: string): void {
    for (const handler of this.lineHandlers) {
      handler(line);
    }
  }

  emitStderr(chunk: string): void {
    for (const handler of this.stderrHandlers) {
      handler(chunk);
    }
  }

  emitMessage(message: unknown): void {
    this.emitLine(JSON.stringify(message));
  }

  emitExit(info: ExitInfo): void {
    for (const handler of this.exitHandlers) {
      handler(info);
    }
  }

  emitFramingError(error: Error): void {
    for (const handler of this.framingErrorHandlers) {
      handler(error);
    }
  }
}
