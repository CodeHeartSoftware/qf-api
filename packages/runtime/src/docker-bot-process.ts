import { PassThrough } from 'node:stream';
import Docker from 'dockerode';
import { LineFramingError, NdjsonReader } from '@quant-fusion/protocol';
import type { BotProcess, ExitInfo } from './bot-process.js';
import { buildContainerCreateOptions, type BotContainerSpec } from './docker-config.js';
import { FirstWriteRetryGuard } from './first-write-retry.js';

/**
 * `@types/dockerode` types `Container.modem` as `any` and doesn't declare `demuxStream` at all
 * (it belongs to the underlying `docker-modem` package, which ships no types). This narrows the
 * gap to one documented, intentional assertion instead of letting `any` leak further.
 */
interface DemuxCapableModem {
  demuxStream(
    stream: NodeJS.ReadableStream,
    stdout: NodeJS.WritableStream,
    stderr: NodeJS.WritableStream,
  ): void;
}

/**
 * The real `BotProcess`: one Docker container per participant per match, controlled via
 * `dockerode` (never by shelling out to the `docker` CLI — docs/adr/0003-docker-bot-isolation.md)
 * so exit codes, `OOMKilled`, and stream handling are typed rather than string-parsed.
 */
export class DockerBotProcess implements BotProcess {
  readonly participantId: string;

  private readonly docker: Docker;
  private readonly spec: BotContainerSpec;
  private container: Docker.Container | undefined;
  private attachStream: NodeJS.ReadWriteStream | undefined;
  private readonly reader = new NdjsonReader();

  private readonly lineHandlers: ((line: string) => void)[] = [];
  private readonly stderrHandlers: ((chunk: string) => void)[] = [];
  private readonly exitHandlers: ((info: ExitInfo) => void)[] = [];
  private readonly framingErrorHandlers: ((error: Error) => void)[] = [];
  private exitReported = false;
  private readonly firstWriteRetry: FirstWriteRetryGuard;

  constructor(spec: BotContainerSpec, docker: Docker = new Docker()) {
    this.spec = spec;
    this.participantId = spec.participantId;
    this.docker = docker;
    this.firstWriteRetry = new FirstWriteRetryGuard({
      write: (line) => this.attachStream?.write(line),
    });
  }

  /** Creates, attaches to, and starts the container. Must resolve before use as a `BotProcess`. */
  async start(): Promise<void> {
    const container = await this.docker.createContainer(buildContainerCreateOptions(this.spec));
    this.container = container;

    try {
      const attachStream = await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true,
        hijack: true,
      });
      this.attachStream = attachStream;

      const stdout = new PassThrough();
      const stderr = new PassThrough();
      (container.modem as DemuxCapableModem).demuxStream(attachStream, stdout, stderr);

      stdout.on('data', (chunk: Buffer) => {
        this.handleStdoutChunk(chunk);
      });
      stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        for (const handler of this.stderrHandlers) {
          handler(text);
        }
      });

      await container.start();
    } catch (error) {
      // Creation succeeded but something after it didn't — without this, the container would
      // sit there forever with nothing to remove it: `reportExit()` is only ever wired up via
      // `container.wait()` below, which a throw here means we never reached.
      await container.remove({ force: true }).catch(() => {
        // Best-effort cleanup only — nothing further we can do if this fails too.
      });
      throw error;
    }

    container
      .wait()
      .then(() => this.reportExit())
      .catch(() => this.reportExit());
  }

  writeLine(line: string): void {
    this.attachStream?.write(line);
    this.firstWriteRetry.notifyWrite(line);
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
    this.attachStream?.end();
  }

  kill(signal: 'SIGTERM' | 'SIGKILL'): void {
    this.container?.kill({ signal }).catch(() => {
      // Already stopped/removed — nothing further to do.
    });
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.firstWriteRetry.notifyDataReceived();
    let lines: string[];
    try {
      lines = this.reader.push(chunk.toString('utf8'));
    } catch (error) {
      if (error instanceof LineFramingError) {
        for (const handler of this.framingErrorHandlers) {
          handler(error);
        }
        return;
      }
      throw error;
    }
    for (const line of lines) {
      for (const handler of this.lineHandlers) {
        handler(line);
      }
    }
  }

  private async reportExit(): Promise<void> {
    if (this.exitReported || !this.container) {
      return;
    }
    this.exitReported = true;
    this.firstWriteRetry.dispose();

    let info: ExitInfo;
    try {
      const inspection = await this.container.inspect();
      const exitCode: number = inspection.State.ExitCode;
      info = {
        code: exitCode,
        // Docker's inspect API does not reliably expose the terminating signal by name across
        // platforms; by Linux convention an exit code > 128 is 128 + signal number.
        signal: exitCode > 128 ? `signal-${String(exitCode - 128)}` : null,
        oomKilled: inspection.State.OOMKilled,
      };
    } catch {
      info = { code: null, signal: null, oomKilled: false };
    }

    try {
      await this.container.remove({ force: true });
    } catch {
      // Best-effort cleanup only — nothing further we can do if this fails.
    }

    for (const handler of this.exitHandlers) {
      handler(info);
    }
  }
}
