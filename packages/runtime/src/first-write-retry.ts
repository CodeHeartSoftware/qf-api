/**
 * Works around a real, reproduced Docker `attach()` race (previously documented only as an
 * observed symptom in scripts/README.md's "known Docker reliability issue" — root-caused here):
 * the very first write into a freshly attached container's stdin is occasionally (reproduced at
 * roughly 1-in-5 to 1-in-3, against a container and process that are both otherwise healthy)
 * silently dropped by the daemon before the hijacked stream's write side is fully wired to the
 * new container's stdin. Every *retried* write, by contrast, lands within milliseconds — so this
 * resends exactly the first line ever written, once, if no stdout data has arrived within
 * `retryDelayMs` of it, and never fires again once any data has been seen.
 *
 * Deliberately silence-triggered rather than a fixed startup delay: a fixed delay would either
 * be too short to help on a slow daemon or needlessly slow down the common case, since the
 * actual daemon-side wiring delay varies and often isn't the bottleneck at all.
 */
export interface FirstWriteRetryGuardOptions {
  /** How long to wait for any stdout data before concluding the first write was lost. Default 500ms — comfortably above every observed successful response time (single-digit to double-digit ms), so it never fires against a merely-slow-but-healthy process. */
  retryDelayMs?: number;
  write: (line: string) => void;
}

export class FirstWriteRetryGuard {
  private readonly retryDelayMs: number;
  private readonly write: (line: string) => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private armed = false;

  constructor(options: FirstWriteRetryGuardOptions) {
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.write = options.write;
  }

  /** Call on every write, in order — only the very first call arms a retry. */
  notifyWrite(line: string): void {
    if (this.armed) {
      return;
    }
    this.armed = true;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.write(line);
    }, this.retryDelayMs);
  }

  /** Call whenever any stdout data arrives — cancels a pending retry, since the write landed. */
  notifyDataReceived(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Call on teardown so a pending timer never fires against an already torn-down process. */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
