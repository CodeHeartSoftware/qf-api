// The seam that lets a real terminal-typing human sit in for one participant in an otherwise
// Docker-bot-driven match (`quant-fusion play`). Every other participantId is delegated untouched
// to `fallback` (typically a `DockerActionCollector`) — this collector only ever intercepts
// requests for its one `humanParticipantId`.
import { createInterface, type Interface } from 'node:readline';
import type { ActionCollector, CollectedAction, RequestActionArgs } from '@quant-fusion/engine';
import type { AnyGameDefinition } from './match-execution.js';

const RESIGN_INPUTS = new Set(['quit', 'resign', 'exit']);

export interface TerminalHumanCollectorOptions {
  humanParticipantId: string;
  /** Must declare `humanInterface` — checked by the caller before construction, since prompting
   * with no way to render an observation or parse a reply isn't recoverable at this layer. */
  game: AnyGameDefinition;
  fallback: ActionCollector;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export class TerminalHumanCollector implements ActionCollector {
  private readonly rl: Interface;
  private readonly output: NodeJS.WritableStream;
  // A manual async-iterator pull, not repeated `rl.question()` calls: `readline/promises`'
  // `question()` can reject with "readline was closed" the moment piped/non-TTY input hits EOF
  // partway through answering, which a human-play session over piped input (tests, scripts) hits
  // constantly. Iterating the interface's own AsyncIterable<string> of lines doesn't have that
  // failure mode — a genuine EOF just ends the iterator, handled below as a clean disconnect.
  private readonly lines: AsyncIterator<string>;

  constructor(private readonly options: TerminalHumanCollectorOptions) {
    this.output = options.output ?? process.stdout;
    this.rl = createInterface({ input: options.input ?? process.stdin });
    this.lines = this.rl[Symbol.asyncIterator]();
  }

  async requestAction(args: RequestActionArgs): Promise<CollectedAction> {
    if (args.participantId !== this.options.humanParticipantId) {
      return this.options.fallback.requestAction(args);
    }

    const humanInterface = this.options.game.humanInterface;
    if (!humanInterface) {
      throw new Error(`"${this.options.game.id}" has no humanInterface — cannot prompt a human`);
    }

    // No deadline enforced here, unlike a bot's own requestAction path — a human, not a
    // container, sets this match's pace. Loops past an unparseable line (typing "roc" is a typo,
    // not a forfeit) rather than ever handing that on to validateAction/resolve — but says so
    // explicitly on a retry, rather than just silently reprinting the same prompt. Same treatment
    // for a well-formed but out-of-range action (e.g. a raise below the min or above the max) —
    // see `validateInput` on `humanInterface` — since otherwise it would reach `validateAction`,
    // fail there, and forfeit the match instead of just reprompting.
    let retryMessage: string | undefined;
    for (;;) {
      if (retryMessage !== undefined) {
        this.output.write(`${retryMessage}\n\n`);
      }
      // `describeObservation` deliberately ends with no trailing newline (a game's own choice —
      // see packages/engine/src/types.ts) — the `\n> ` here is what actually separates the
      // prompt from where you type, so your answer lands on its own line instead of running on
      // right after the prompt text.
      this.output.write(`${humanInterface.describeObservation(args.observation)}\n> `);
      const next = await this.lines.next();
      if (next.done) {
        return { ok: false, reason: 'disconnected' }; // stdin ended — nobody left to answer
      }

      const raw = next.value;
      if (RESIGN_INPUTS.has(raw.trim().toLowerCase())) {
        return { ok: false, reason: 'disconnected' };
      }
      const action = humanInterface.parseInput(raw);
      if (action === undefined) {
        retryMessage = "Sorry, I didn't understand that — try again.";
        continue;
      }
      const invalidReason = humanInterface.validateInput?.(action, args.observation);
      if (invalidReason !== undefined) {
        retryMessage = `${invalidReason} — try again.`;
        continue;
      }
      // Confirms exactly how the input was understood — not just that something was accepted —
      // so a valid-but-unintended parse (e.g. a typo that still happens to name a real card)
      // doesn't slip past unnoticed. Optional: a game with nothing useful to add here just omits it.
      const confirmation = humanInterface.describeAction?.(action);
      if (confirmation !== undefined) {
        // No leading newline: pressing Enter to submit already moved the terminal to a new
        // line, so one here would just add a stray blank line before the confirmation.
        this.output.write(`${confirmation}\n\n`);
      }
      return { ok: true, action };
    }
  }

  close(): void {
    this.rl.close();
  }
}
