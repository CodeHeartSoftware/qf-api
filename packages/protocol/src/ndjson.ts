/**
 * NDJSON framing (docs/adr/0002-universal-bot-protocol.md): one JSON message per line over a
 * bot container's stdout. A child process's stdout arrives as arbitrarily-chunked bytes, not
 * pre-split into lines, so this buffers partial lines across chunks and enforces the
 * line-length cap that turns "a bot streams an unterminated or oversized line" into a
 * detectable protocol violation instead of unbounded memory growth.
 */
export const DEFAULT_MAX_LINE_BYTES = 1024 * 1024; // 1 MiB

export class LineFramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LineFramingError';
  }
}

export class NdjsonReader {
  private buffer = '';

  constructor(private readonly maxLineBytes: number = DEFAULT_MAX_LINE_BYTES) {}

  /** Feed a chunk of text; returns any complete lines it produced (newlines stripped). */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];

    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.assertWithinLimit(line);
      lines.push(line);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf('\n');
    }

    this.assertWithinLimit(this.buffer);
    return lines;
  }

  /** Whatever remains buffered with no trailing newline yet. */
  pending(): string {
    return this.buffer;
  }

  private assertWithinLimit(text: string): void {
    if (Buffer.byteLength(text, 'utf8') > this.maxLineBytes) {
      throw new LineFramingError(
        `line exceeds maximum length of ${String(this.maxLineBytes)} bytes`,
      );
    }
  }
}
