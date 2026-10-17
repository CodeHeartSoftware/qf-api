import {
  CURRENT_PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
  isSupportedProtocolVersion,
  type ForfeitReason,
  type InitMessage,
  type MatchEndMessage,
  type ObservationMessage,
  type ProtocolMessage,
  type ResultMessage,
} from '@quant-fusion/protocol';
import type { BotProcess, ExitInfo } from './bot-process.js';

/**
 * Drives one bot's process through the lifecycle state machine in
 * docs/adr/0003-docker-bot-isolation.md:
 *
 *   SPAWNING -> AWAITING_READY -> RUNNING (per round: AWAITING_ACTION*)
 *   -> MATCH_END_SENT -> GRACE_PERIOD -> TERMINATED
 *
 * Deliberately game-agnostic and Docker-agnostic: it only knows about one `BotProcess` and the
 * wire protocol. `@quant-fusion/engine`'s match-runner drives N of these per match; this class
 * never knows how many participants exist or what game is being played.
 */
export type BotLifecycleState =
  'spawning' | 'awaiting-ready' | 'running' | 'match-end-sent' | 'grace-period' | 'terminated';

export interface BotFailure {
  forfeitReason: ForfeitReason;
  detail: string;
}

export type BotOutcome = { ok: true } | ({ ok: false } & BotFailure);
export type ActionOutcome = { ok: true; action: unknown } | ({ ok: false } & BotFailure);

export interface BotLifecycleOptions {
  process: BotProcess;
  matchId: string;
  gracePeriodMs?: number;
}

const DEFAULT_GRACE_PERIOD_MS = 2000;

type PendingWait =
  | { kind: 'ready'; settle: (outcome: BotOutcome) => void; timer: ReturnType<typeof setTimeout> }
  | {
      kind: 'action';
      roundId: number;
      settle: (outcome: ActionOutcome) => void;
      timer: ReturnType<typeof setTimeout>;
    };

export class BotLifecycle {
  readonly participantId: string;
  private readonly process: BotProcess;
  private readonly matchId: string;
  private readonly gracePeriodMs: number;
  private readonly stderrChunks: string[] = [];
  private exitWaiters: (() => void)[] = [];

  private _state: BotLifecycleState = 'spawning';
  private outgoingSeq = 0;
  private lastIncomingSeq: number | undefined;
  private exitInfo: ExitInfo | undefined;
  private terminalFailure: BotFailure | undefined;
  private activeWait: PendingWait | undefined;
  private toleratedDuplicateReady = false;

  constructor(options: BotLifecycleOptions) {
    this.process = options.process;
    this.participantId = options.process.participantId;
    this.matchId = options.matchId;
    this.gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;

    this.process.onLine((line) => {
      this.handleLine(line);
    });
    this.process.onStderr((chunk) => this.stderrChunks.push(chunk));
    this.process.onExit((info) => {
      this.handleExit(info);
    });
    this.process.onFramingError((error) => {
      this.fail({ forfeitReason: 'PROTOCOL_VIOLATION', detail: `framing error: ${error.message}` });
    });
  }

  get state(): BotLifecycleState {
    return this._state;
  }

  /**
   * A plain `this._state === 'terminated'` check inside `finish()` false-positives as
   * "no overlap" once TS has narrowed `_state` to a specific earlier literal within the same
   * function — it can't see that an awaited exit event asynchronously reassigns it. Routing
   * the check through a method call gives each check a fresh, unnarrowed read.
   */
  private isTerminated(): boolean {
    return this._state === 'terminated';
  }

  getStderrLog(): string {
    return this.stderrChunks.join('');
  }

  getExitInfo(): ExitInfo | undefined {
    return this.exitInfo;
  }

  getTerminalFailure(): BotFailure | undefined {
    return this.terminalFailure;
  }

  /** SPAWNING -> AWAITING_READY -> RUNNING (on success) or TERMINATED (on failure/timeout). */
  async initialize(
    payload: InitMessage['payload'],
    opts: { initTimeoutMs: number },
  ): Promise<BotOutcome> {
    if (this._state === 'terminated') {
      return this.terminalFailure ? { ok: false, ...this.terminalFailure } : { ok: true };
    }
    if (this._state !== 'spawning') {
      throw new Error(`initialize() called in state "${this._state}"`);
    }

    this._state = 'awaiting-ready';
    this.send({ ...this.envelopeBase(), type: 'init', payload });

    return new Promise<BotOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.fail({
          forfeitReason: 'INIT_TIMEOUT',
          detail: `no "ready" received within ${String(opts.initTimeoutMs)}ms`,
        });
      }, opts.initTimeoutMs);
      this.activeWait = { kind: 'ready', settle: resolve, timer };
    });
  }

  /** Fire-and-forget: send this round's observation. Follow with `awaitAction` iff it's awaited. */
  sendObservation(roundId: number, payload: ObservationMessage['payload']): void {
    if (this._state !== 'running') {
      return;
    }
    this.send({ ...this.envelopeBase(), type: 'observation', roundId, payload });
  }

  /** Waits up to `deadlineMs` for the `action` correlated to `roundId` (or a resign/error/timeout). */
  async awaitAction(roundId: number, deadlineMs: number): Promise<ActionOutcome> {
    if (this._state === 'terminated') {
      return this.terminalFailure
        ? { ok: false, ...this.terminalFailure }
        : { ok: false, forfeitReason: 'ENGINE_ERROR', detail: 'lifecycle already terminated' };
    }
    if (this._state !== 'running') {
      throw new Error(`awaitAction() called in state "${this._state}"`);
    }

    return new Promise<ActionOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.fail({
          forfeitReason: 'TURN_TIMEOUT',
          detail: `no action received for round ${String(roundId)} within ${String(deadlineMs)}ms`,
        });
      }, deadlineMs);
      this.activeWait = { kind: 'action', roundId, settle: resolve, timer };
    });
  }

  /** Fire-and-forget: reveal a round- or match-scoped result. */
  sendResult(payload: ResultMessage['payload'], roundId?: number): void {
    if (this._state !== 'running') {
      return;
    }
    if (roundId !== undefined) {
      this.send({ ...this.envelopeBase(), type: 'result', roundId, payload });
    } else {
      this.send({ ...this.envelopeBase(), type: 'result', payload });
    }
  }

  /** RUNNING -> MATCH_END_SENT -> GRACE_PERIOD -> TERMINATED. Never rejects. */
  async finish(payload: MatchEndMessage['payload']): Promise<void> {
    if (this._state === 'terminated') {
      return;
    }
    this._state = 'match-end-sent';
    this.send({ ...this.envelopeBase(), type: 'match-end', payload });
    this.process.closeStdin();
    this._state = 'grace-period';

    await this.waitForExitOrTimeout(this.gracePeriodMs);
    if (this.isTerminated()) {
      return;
    }
    this.process.kill('SIGTERM');
    await this.waitForExitOrTimeout(this.gracePeriodMs);
    if (this.isTerminated()) {
      return;
    }
    this.process.kill('SIGKILL');
    await this.waitForExitOrTimeout(this.gracePeriodMs);
  }

  /** Any state -> TERMINATED immediately (e.g. a whole-match wall-clock safety net). */
  forceTerminate(reason: ForfeitReason, detail: string): BotOutcome {
    if (this._state === 'terminated') {
      return this.terminalFailure ? { ok: false, ...this.terminalFailure } : { ok: true };
    }
    this.fail({ forfeitReason: reason, detail });
    return { ok: false, forfeitReason: reason, detail };
  }

  // -------------------------------------------------------------------------

  private envelopeBase(): {
    protocolVersion: string;
    matchId: string;
    seq: number;
    sentAt: string;
  } {
    return {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      matchId: this.matchId,
      seq: this.outgoingSeq++,
      sentAt: new Date().toISOString(),
    };
  }

  private send(message: ProtocolMessage): void {
    this.process.writeLine(encodeMessage(message));
  }

  private handleLine(line: string): void {
    if (this._state === 'terminated') {
      return; // stray output after termination — ignore rather than resurrect a dead lifecycle
    }

    const result = decodeMessage(line);
    if (!result.ok) {
      this.fail({
        forfeitReason: 'PROTOCOL_VIOLATION',
        detail: `malformed message: ${result.reason}`,
      });
      return;
    }
    const message = result.message;

    if (this.lastIncomingSeq !== undefined && message.seq <= this.lastIncomingSeq) {
      this.fail({
        forfeitReason: 'PROTOCOL_VIOLATION',
        detail: `out-of-order or duplicate seq ${String(message.seq)} (last seen ${String(this.lastIncomingSeq)})`,
      });
      return;
    }
    this.lastIncomingSeq = message.seq;

    if (!this.activeWait) {
      // A benign side effect of DockerBotProcess's first-write retry (packages/runtime/src/
      // first-write-retry.ts): if the original "init" write was merely slow rather than truly
      // lost, a resend can provoke a second "ready" the bot never should have needed to send.
      // Tolerate exactly one, ever, per lifecycle — anything beyond that is a real violation.
      if (message.type === 'ready' && !this.toleratedDuplicateReady) {
        this.toleratedDuplicateReady = true;
        return;
      }
      this.fail({
        forfeitReason: 'PROTOCOL_VIOLATION',
        detail: `unexpected message of type "${message.type}" with no pending request`,
      });
      return;
    }

    this.handleReply(this.activeWait, message);
  }

  private handleReply(wait: PendingWait, message: ProtocolMessage): void {
    if (wait.kind === 'ready') {
      if (message.type !== 'ready') {
        this.fail({
          forfeitReason: 'PROTOCOL_VIOLATION',
          detail: `expected "ready", got "${message.type}"`,
        });
        return;
      }
      if (!isSupportedProtocolVersion(message.payload.protocolVersion)) {
        this.fail({
          forfeitReason: 'PROTOCOL_VERSION_UNSUPPORTED',
          detail: `bot declared unsupported protocolVersion "${message.payload.protocolVersion}"`,
        });
        return;
      }
      this._state = 'running';
      this.settle(wait, { ok: true });
      return;
    }

    // wait.kind === 'action'
    if (message.type === 'action') {
      if (message.roundId !== wait.roundId) {
        this.fail({
          forfeitReason: 'PROTOCOL_VIOLATION',
          detail: `action roundId ${String(message.roundId)} does not match awaited roundId ${String(wait.roundId)}`,
        });
        return;
      }
      this.settle(wait, { ok: true, action: message.payload.action });
      return;
    }
    if (message.type === 'resign') {
      this.settle(wait, {
        ok: false,
        forfeitReason: 'RESIGNED',
        detail: message.payload.note ?? 'bot resigned',
      });
      return;
    }
    if (message.type === 'error') {
      this.settle(wait, {
        ok: false,
        forfeitReason: 'BOT_CRASHED',
        detail:
          message.payload.detail ?? `bot reported error: ${message.payload.reason ?? 'unknown'}`,
      });
      return;
    }
    this.fail({
      forfeitReason: 'PROTOCOL_VIOLATION',
      detail: `expected "action" or "resign", got "${message.type}"`,
    });
  }

  private settle(wait: PendingWait, outcome: BotOutcome | ActionOutcome): void {
    clearTimeout(wait.timer);
    this.activeWait = undefined;
    if (wait.kind === 'ready') {
      wait.settle(outcome);
    } else {
      wait.settle(outcome as ActionOutcome);
    }
  }

  /** Records a fault, terminates the lifecycle, kills the process, and settles any pending wait. */
  private fail(failure: BotFailure): void {
    if (this._state === 'terminated') {
      return;
    }
    this.terminalFailure = failure;
    this._state = 'terminated';
    if (this.activeWait) {
      this.settle(this.activeWait, { ok: false, ...failure });
    }
    this.process.kill('SIGKILL');
  }

  private handleExit(info: ExitInfo): void {
    this.exitInfo = info;
    const wasExpected = this._state === 'match-end-sent' || this._state === 'grace-period';
    this._state = 'terminated';

    if (!wasExpected) {
      const failure: BotFailure = info.oomKilled
        ? { forfeitReason: 'RESOURCE_LIMIT_EXCEEDED', detail: 'container was OOM-killed' }
        : {
            forfeitReason: 'BOT_CRASHED',
            detail: `process exited unexpectedly (code=${String(info.code)}, signal=${String(info.signal)})`,
          };
      this.terminalFailure = failure;
      if (this.activeWait) {
        this.settle(this.activeWait, { ok: false, ...failure });
      }
    }

    for (const notify of this.exitWaiters) {
      notify();
    }
    this.exitWaiters = [];
  }

  private waitForExitOrTimeout(ms: number): Promise<void> {
    if (this._state === 'terminated') {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.exitWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
